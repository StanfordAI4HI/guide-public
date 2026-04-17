// Convert thinking_traps.jsonl (prompt/completion) into chat fine-tune format for gpt-3.5-turbo.
// Usage:
//   node apps/server/scripts/prepare-trap-chat-data.js input.jsonl output.jsonl
// If paths are omitted, defaults to ../data/thinking_traps.jsonl and ../data/thinking_traps_prepared.jsonl

const fs = require('fs');
const path = require('path');

const inputPath =
  process.argv[2] || path.join(__dirname, '../../../data/thinking_traps.jsonl');
const outputPath =
  process.argv[3] || path.join(__dirname, '../../../data/thinking_traps_prepared.jsonl');

function loadLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.warn(`[prepare] skipping malformed line ${idx + 1}`);
        return null;
      }
    })
    .filter(Boolean);
}

function sanitizePrompt(prompt = '') {
  return prompt.replace(/\\s*->\\s*$/, '').trim();
}

function sanitizeCompletion(completion = '') {
  return completion.replace(/^\\s+/, '').replace(/^>/, '').trim();
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`[prepare] input not found: ${inputPath}`);
    process.exit(1);
  }
  const rows = loadLines(inputPath);
  if (!rows.length) {
    console.error('[prepare] no rows loaded');
    process.exit(1);
  }
  const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  rows.forEach((row) => {
    const thought = sanitizePrompt(typeof row.prompt === 'string' ? row.prompt : '');
    const label = sanitizeCompletion(typeof row.completion === 'string' ? row.completion : '');
    if (!thought || !label) return;
    const record = {
      messages: [
        {
          role: 'system',
          content:
            'You are a classifier that labels a thought with one thinking trap name from the dataset. Reply with only the trap label.',
        },
        { role: 'user', content: thought },
        { role: 'assistant', content: label },
      ],
    };
    out.write(JSON.stringify(record));
    out.write('\n');
  });
  out.end();
  console.log(`[prepare] wrote chat fine-tune file: ${outputPath}`);
}

main();
