const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const DATA_PATH = process.env.REFRAME_DATA || path.join(__dirname, '../../data/reframing_dataset.json');
const MODEL = process.env.REFRAME_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4.1';
const EMBEDDING_MODEL = process.env.REFRAME_EMBED_MODEL || 'text-embedding-3-small';
const TOP_K = Number(process.env.REFRAME_TOP_K || 5);
const NUM_GENERATIONS = Number(process.env.REFRAME_GENERATIONS || 6);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let dataset = [];
let datasetEmbeddings = [];
let embeddingReady = null;

function loadDataset() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`reframing dataset not found at ${DATA_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  return Array.isArray(raw) ? raw : [];
}

async function ensureEmbeddings() {
  if (dataset.length && datasetEmbeddings.length === dataset.length) return;
  if (embeddingReady) return embeddingReady;

  dataset = loadDataset();
  const inputs = dataset.map((row) => `${row.situation || ''} ${row.thought || ''}`.trim());
  const batchSize = 50;
  const vectors = [];

  embeddingReady = (async () => {
    for (let i = 0; i < inputs.length; i += batchSize) {
      const chunk = inputs.slice(i, i + batchSize);
      const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: chunk });
      resp.data.forEach((item) => vectors.push(item.embedding));
    }
    datasetEmbeddings = vectors;
  })();
  return embeddingReady;
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

async function getEmbedding(text) {
  const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return resp.data[0].embedding;
}

function buildRetrievalPrompt(examples, traps) {
  const parts = [];
  parts.push(
    'You generate rational responses (reframes) for distorted thoughts. Stay strictly on the same situation and thought; do not invent new facts or people.'
  );
  parts.push('Here are examples:');
  examples.forEach((ex) => {
    parts.push(`Situation: ${ex.situation || ''}`);
    parts.push(`Distorted Thought: ${ex.thought || ''}`);
    parts.push(`Rational Response: ${ex.reframe || ''}`);
    parts.push('');
  });
  if (traps?.length) {
    parts.push(`Consider these thinking traps (as guidance, not to be listed): ${traps.join(', ')}.`);
  }
  parts.push(
    `Now generate ${NUM_GENERATIONS} supportive rational responses, each distinct from the others. ` +
      'Address the specific thought and situation given. Do not add new events or people. Return JSON only.'
  );
  return parts.join('\n');
}

async function generateReframe({ thought, situation, traps }) {
  const query = [thought || '', situation || ''].filter(Boolean).join(' ').trim();
  if (!query) throw new Error('Missing thought or situation');

  await ensureEmbeddings();
  let queryEmb;
  try {
    queryEmb = await getEmbedding(query);
  } catch (err) {
    throw new Error('embedding_failed');
  }

  const scored = dataset.map((row, idx) => {
    const score = cosineSimilarity(queryEmb, datasetEmbeddings[idx]);
    return { ...row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Deduplicate on reframe text to avoid near-identical outputs
  const top = [];
  const seen = new Set();
  for (const row of scored) {
    const key = (row.reframe || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    top.push(row);
    if (top.length >= TOP_K) break;
  }

  const prompt = buildRetrievalPrompt(top, traps);
  const completionPrompt = `${prompt}\nSituation: ${situation || ''}\nDistorted Thought: ${thought || ''}\nReturn JSON of the form {"reframes": ["...", "..."]}`;

  const useChat = !/instruct/i.test(MODEL) && !/^text-davinci|^davinci|^babbage|^curie|^ada/i.test(MODEL);
  let generations = [];
  if (useChat) {
    const chat = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You generate helpful rational responses (reframes) for distorted thoughts. Return JSON only with key "reframes" as an array of distinct responses, each directly relevant to the provided thought and situation. Do not invent new events or people.',
        },
        { role: 'user', content: completionPrompt },
      ],
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: 320,
    });
    const raw = (chat.choices?.[0]?.message?.content || '').trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.reframes)) generations = parsed.reframes.map((r) => String(r).trim());
    } catch (err) {
      // fall back below
    }
  } else {
    const resp = await client.completions.create({
      model: MODEL,
      prompt: completionPrompt,
      max_tokens: 180,
      temperature: 0.4,
      top_p: 0.9,
      stop: ['\n\n', '\nSituation:', '\nDistorted Thought:'],
    });
    const raw = (resp.choices?.[0]?.text || '').trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.reframes)) generations = parsed.reframes.map((r) => String(r).trim());
    } catch (err) {
      // fall back: split by newline/delimiters into options
      generations = raw
        .split(/[\n;]+/)
        .map((s) => s.replace(/^[\-\*\d\.\s]+/, '').trim())
        .filter(Boolean);
    }
  }
  if (!generations.length && top.length) {
    // backup: use top retrieved reframes if model returned nothing usable
    generations = top.map((t) => t.reframe).filter(Boolean).slice(0, NUM_GENERATIONS);
  }
  const uniqueGen = Array.from(new Set(generations)).filter(Boolean);
  const reasoning = top.map((t) => ({
    thought: t.thought,
    situation: t.situation,
    reframe: t.reframe,
    score: t.score,
  }));

  try {
    console.info('[reframe] generate', {
      model: MODEL,
      traps,
      thought_preview: thought?.slice(0, 80),
      situation_preview: situation?.slice(0, 80),
      top_examples: top.slice(0, 3).map((t) => t.reframe?.slice(0, 60)),
      generated: uniqueGen.slice(0, 3),
    });
  } catch (err) {
    // ignore logging errors
  }

  return {
    model: MODEL,
    rational_response: uniqueGen[0] || '',
    references: uniqueGen.slice(1).map((r) => ({ reframe: r })),
    context_examples: reasoning,
  };
}

module.exports = { generateReframe };

async function assistReframe({ thought, situation, traps, current, goal, additional_context }) {
  const count = Number(process.env.REFRAME_ASSIST_COUNT || 3);
  const messages = [
    {
      role: 'system',
      content:
        'You refine rational responses (reframes) to make them clearer, more helpful, and supportive. Return JSON only with key "reframes" as an array of distinct refinements. Do not invent new events or people.',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          thought,
          situation,
          traps,
          goal,
          current_reframe: current,
          additional_context,
          instructions: `Provide ${count} alternative refinements. Each should be 1–3 sentences, supportive, and relevant.`,
        },
        null,
        2
      ),
    },
  ];
  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 320,
  });
  const raw = (resp.choices?.[0]?.message?.content || '').trim();
  let list = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.reframes)) {
      list = parsed.reframes.map((r) => String(r).trim()).filter(Boolean);
    }
  } catch (err) {
    // fall back to splitting lines
    list = raw
      .split(/[\n;]/)
      .map((s) => s.replace(/^[\-\*\d\.\s]+/, '').trim())
      .filter(Boolean);
  }
  const unique = Array.from(new Set(list)).slice(0, count);
  try {
    console.info('[reframe] assist', {
      model: MODEL,
      goal,
      traps,
      thought_preview: thought?.slice(0, 80),
      situation_preview: situation?.slice(0, 80),
      suggestions: unique.slice(0, 3),
    });
  } catch {}
  return { model: MODEL, suggestions: unique };
}

module.exports.assistReframe = assistReframe;
