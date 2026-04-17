const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { TRAPS, canonicalizeTrapId, normalizeTrapScores } = require('./trapMetadata');

const DATA_PATH =
  process.env.THINKING_TRAP_DATA || path.join(__dirname, '../../data/thinking_traps.jsonl');
// Primary: fine-tuned classifier (paper-style). Fallback: embedding centroid similarity.
const FT_MODEL =
  process.env.THINKING_TRAP_MODEL ||
  process.env.THINKING_TRAP_COMPLETION_MODEL ||
  'ft:gpt-4.1-2025-04-14:personal:thinking-traps:D2p9H6ln';
const EMBEDDING_MODEL = process.env.THINKING_TRAP_EMBED_MODEL || 'text-embedding-3-small';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let cachedExamples = [];
let cachedEmbeddings = [];
let classCentroids = {};
let embeddingReadyPromise = null;

function loadDataset() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`thinking_traps.jsonl not found at ${DATA_PATH}`);
  }
  const lines = fs.readFileSync(DATA_PATH, 'utf8').split('\n').filter(Boolean);
  const examples = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const rawLabel = String(row.completion || '').replace(/^\\s+/, '').replace(/^\\>\\s*/, '').trim();
      if (!rawLabel) continue;
      const label = canonicalizeTrapId(rawLabel) || rawLabel;
      const prompt = typeof row.prompt === 'string' ? row.prompt.trim() : '';
      if (!prompt) continue;
      examples.push({ text: prompt, label });
    } catch (err) {
      // skip malformed lines
    }
  }
  return examples;
}

async function ensureEmbeddings() {
  if (
    cachedExamples.length &&
    cachedEmbeddings.length === cachedExamples.length &&
    Object.keys(classCentroids).length
  )
    return;
  if (embeddingReadyPromise) return embeddingReadyPromise;

  cachedExamples = loadDataset();
  const inputs = cachedExamples.map((ex) => ex.text);
  const batchSize = 50;
  const vectors = [];

  embeddingReadyPromise = (async () => {
    for (let i = 0; i < inputs.length; i += batchSize) {
      const chunk = inputs.slice(i, i + batchSize);
      const resp = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk,
      });
      resp.data.forEach((item) => vectors.push(item.embedding));
    }
    cachedEmbeddings = vectors;

    // compute class centroids
    const grouped = {};
    cachedExamples.forEach((ex, idx) => {
      const label = ex.label;
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(cachedEmbeddings[idx]);
    });
    const centroids = {};
    Object.entries(grouped).forEach(([label, vecs]) => {
      if (!vecs.length) return;
      const dim = vecs[0].length;
      const sum = new Array(dim).fill(0);
      vecs.forEach((v) => {
        for (let i = 0; i < dim; i++) sum[i] += v[i];
      });
      const c = sum.map((s) => s / vecs.length);
      centroids[label] = c;
    });
    classCentroids = centroids;
  })();

  return embeddingReadyPromise;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) || 1;
  return dot / denom;
}

async function getQueryEmbedding(text) {
  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return resp.data[0].embedding;
}

function buildRetrievalPrompt(examples) {
  const parts = [];
  parts.push('Examples of thoughts and their thinking traps:');
  examples.forEach((ex) => {
    const trap = TRAPS.find((t) => t.id === ex.label || t.label === ex.label);
    const label = trap ? trap.label : ex.label;
    parts.push(`Thought: ${ex.text}`);
    parts.push(`Thinking trap: ${label}`);
    parts.push('');
  });
  parts.push('Classify the thinking trap for the new input.');
  return parts.join('\n');
}

async function classifyThinkingTrap({ thought, situation }) {
  const query = [thought || '', situation || ''].filter(Boolean).join(' ').trim();
  if (!query) {
    throw new Error('Missing thought or situation');
  }

  // First, try the fine-tuned classifier (single call, JSON probs)
  try {
    const trapList = TRAPS.map((t) => `${t.id}`).join(', ');
    const resp = await client.chat.completions.create({
      model: FT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a classifier for 13 cognitive thinking traps. ' +
            'Return a JSON object where keys are trap ids and values are probabilities between 0 and 1 that sum to 1. ' +
            `Trap ids: ${trapList}. Respond with JSON only.`,
        },
        {
          role: 'user',
          content: `Thought: ${thought || ''}\nSituation: ${situation || ''}`,
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content;
    const parsed = raw ? JSON.parse(raw) : {};
    const scores = normalizeTrapScores(parsed, 1);
    const topLabels = scores.slice(0, 4).map((s) => s.id);
    console.info('[thinking-traps] classify', {
      model: FT_MODEL,
      source: 'fine-tune-json',
      thought_preview: thought?.slice(0, 120),
      situation_preview: situation?.slice(0, 120),
      topLabels,
      topPercents: scores.slice(0, 4).map((s) => `${s.id}:${s.percent}`),
    });
    return {
      model: FT_MODEL,
      source: 'fine-tune-json',
      scores,
      topLabels,
    };
  } catch (err) {
    console.warn('[thinking-traps] fine-tune classify failed, falling back to centroid', err?.message);
  }

  // Fallback: centroid similarity over embeddings
  await ensureEmbeddings();

  let queryEmbedding = null;
  try {
    queryEmbedding = await getQueryEmbedding(query);
  } catch (err) {
    return {
      model: EMBEDDING_MODEL,
      source: 'fallback',
      scores: normalizeTrapScores(null),
      topLabels: TRAPS.slice(0, 4).map((t) => t.id),
    };
  }

  // cosine similarity to each class centroid
  const rawScores = {};
  TRAPS.forEach((trap) => {
    const centroid = classCentroids[trap.id];
    if (centroid) {
      rawScores[trap.id] = Math.max(0, cosineSimilarity(queryEmbedding, centroid));
    }
  });

  // Sharpen with softmax (temperature makes the ranking clearer)
  const temp = Number(process.env.THINKING_TRAP_TEMP || 0.7);
  const logits = Object.fromEntries(
    Object.entries(rawScores).map(([k, v]) => [k, v / Math.max(temp, 1e-6)])
  );

  const scores = normalizeTrapScores(logits, 1); // small floor for visibility
  const topLabels = scores.slice(0, 4).map((s) => s.id);

  try {
    console.info('[thinking-traps] classify', {
      model: EMBEDDING_MODEL,
      source: 'centroid-similarity',
      thought_preview: thought?.slice(0, 120),
      situation_preview: situation?.slice(0, 120),
      topLabels,
      topPercents: scores.slice(0, 4).map((s) => `${s.id}:${s.percent}`),
    });
  } catch (err) {
    // ignore logging errors
  }

  return {
    model: EMBEDDING_MODEL,
    source: 'centroid-similarity',
    scores,
    topLabels,
  };
}

module.exports = {
  classifyThinkingTrap,
  TRAPS,
};
