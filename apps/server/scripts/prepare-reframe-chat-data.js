// Convert reframing_dataset.json (or CSV -> JSON) into chat fine-tune format for GPT-3.5/4.
// Usage:
//   node apps/server/scripts/prepare-reframe-chat-data.js input.json output.jsonl
// Defaults: input = ../../data/reframing_dataset.json, output = ../../data/reframing_prepared.jsonl

const fs = require('fs');
const path = require('path');

const inputPath =
  process.argv[2] || path.join(__dirname, '../../data/reframing_dataset.json');
const outputPath =
  process.argv[3] || path.join(__dirname, '../../data/reframing_prepared.jsonl');

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`[prepare-reframe] input not found: ${inputPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error('[prepare-reframe] expected input JSON array');
    process.exit(1);
  }

  const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  raw.forEach((row, idx) => {
    const situation = typeof row.situation === 'string' ? row.situation.trim() : '';
    const thought = typeof row.thought === 'string' ? row.thought.trim() : '';
    const reframe = typeof row.reframe === 'string' ? row.reframe.trim() : '';
    if (!situation || !thought || !reframe) return;
    const record = {
      messages: [
        {
          role: 'system',
          content:
            'You generate a rational response (reframe) for a distorted thought, grounded in the situation. Keep tone supportive and concise.',
        },
        {
          role: 'user',
          content: `Situation: ${situation}\nDistorted Thought: ${thought}\nRational Response:`,
        },
        { role: 'assistant', content: reframe },
      ],
    };
    out.write(JSON.stringify(record));
    out.write('\n');
  });
  out.end();
  console.log(`[prepare-reframe] wrote chat fine-tune file: ${outputPath} (from ${raw.length} rows)`);
}

main();
