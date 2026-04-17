// Fine-tune a reframing model on chat-format data (train + optional validation).
// Usage:
//   node apps/server/scripts/train-reframe.js --data ../../data/reframing_train.jsonl --val ../../data/reframing_val.jsonl --model gpt-4.1
// Flags:
//   --data   Path to training JSONL (messages format) OR a file id (file-xxx)
//   --val    Optional validation JSONL OR file id (file-xxx)
//   --model  Target model (default: env REFRAME_BASE_MODEL or gpt-3.5-turbo-1106)
//   --suffix Optional job suffix
// Env:
//   OPENAI_API_KEY=... (required)
//   REFRAME_BASE_MODEL (optional)

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

dotenv.config({ path: path.join(__dirname, '../../.env'), override: false });
dotenv.config({ path: path.join(__dirname, '../.env'), override: false });
dotenv.config();

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
};

const dataPath = getArg('--data', path.join(__dirname, '../../data/reframing_prepared.jsonl'));
const valPath = getArg('--val', null);
const baseModel = getArg('--model', process.env.REFRAME_BASE_MODEL || 'gpt-3.5-turbo-1106');
const suffix = getArg('--suffix', 'reframing');

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Training file: accept file id or upload.
  let trainFileId = dataPath;
  if (!trainFileId.startsWith('file-')) {
    if (!fs.existsSync(trainFileId)) throw new Error(`Data file not found at ${trainFileId}`);
    console.log('[reframe] uploading training file', trainFileId);
    const fileResp = await client.files.create({
      file: fs.createReadStream(trainFileId),
      purpose: 'fine-tune',
    });
    trainFileId = fileResp.id;
    console.log('[reframe] train file uploaded', { fileId: trainFileId, size: fileResp.bytes });
  }

  // Validation file (optional)
  let valFileId = valPath;
  if (valFileId && !valFileId.startsWith('file-')) {
    if (!fs.existsSync(valFileId)) throw new Error(`Val file not found at ${valFileId}`);
    console.log('[reframe] uploading validation file', valFileId);
    const fileResp = await client.files.create({
      file: fs.createReadStream(valFileId),
      purpose: 'fine-tune',
    });
    valFileId = fileResp.id;
    console.log('[reframe] val file uploaded', { fileId: valFileId, size: fileResp.bytes });
  }

  console.log('[reframe] creating fine-tune job', { baseModel, suffix, val: Boolean(valFileId) });
  const job = await client.fineTuning.jobs.create({
    training_file: trainFileId,
    validation_file: valFileId || undefined,
    model: baseModel,
    suffix,
  });
  console.log('[reframe] job created', {
    jobId: job.id,
    status: job.status,
    baseModel,
  });
  console.log('Track job:', `openai api fine_tuning.jobs.retrieve -i ${job.id}`);
}

main().catch((err) => {
  console.error('[reframe] error', err?.message || err);
  process.exit(1);
});
