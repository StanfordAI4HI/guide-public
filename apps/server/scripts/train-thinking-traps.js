// Fine-tune a thinking-trap classifier on thinking_traps.jsonl or the chat-prepared file.
// Usage:
//   node apps/server/scripts/train-thinking-traps.js --data ../data/thinking_traps_prepared.jsonl --model gpt-3.5-turbo-1106
// Env:
//   OPENAI_API_KEY=... (required; loaded from repo .env or apps/server/.env if present)
//   TRAP_BASE_MODEL (optional override of the base model)
// Output: logs file id and fine-tune job id.

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Load env from repo root and apps/server/.env so you do not have to export every run.
const rootEnv = path.join(__dirname, '../../.env');
const serverEnv = path.join(__dirname, '../.env');
dotenv.config({ path: rootEnv, override: false });
dotenv.config({ path: serverEnv, override: false });
dotenv.config(); // fallback current cwd

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
};

const dataPath = getArg('--data', path.join(__dirname, '../../data/thinking_traps_prepared.jsonl'));
const baseModel = getArg('--model', process.env.TRAP_BASE_MODEL || 'gpt-3.5-turbo-1106');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found at ${dataPath}`);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('[thinking-traps] uploading training file', dataPath);
  const fileResp = await client.files.create({
    file: fs.createReadStream(dataPath),
    purpose: 'fine-tune',
  });
  console.log('[thinking-traps] file uploaded', { fileId: fileResp.id, size: fileResp.bytes });

  console.log('[thinking-traps] creating fine-tune job', { baseModel });
  const job = await client.fineTuning.jobs.create({
    training_file: fileResp.id,
    model: baseModel,
    suffix: 'thinking-traps',
  });
  console.log('[thinking-traps] job created', {
    jobId: job.id,
    status: job.status,
    baseModel,
  });
  console.log('Track job:', `openai api fine_tuning.jobs.retrieve -i ${job.id}`);
}

main().catch((err) => {
  console.error('[thinking-traps] error', err?.message || err);
  process.exit(1);
});
