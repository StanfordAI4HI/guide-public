const { spawnSync } = require('child_process');
const path = require('path');

function runDspy(command, payload = {}) {
  const scriptPath = path.join(__dirname, '..', 'engine', 'engine.py');
  const proc = spawnSync('python3', [scriptPath, command], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: {
      ...process.env
    }
  });

  if (proc.error) {
    throw proc.error;
  }

  const stdout = proc.stdout?.trim() || '';
  const stderr = proc.stderr?.trim() || '';

  if (proc.status !== 0) {
    const detail = stderr || stdout || `exit code ${proc.status}`;
    throw new Error(`DSPy command failed: ${detail}`);
  }

  try {
    return JSON.parse(stdout || '{}');
  } catch (err) {
    throw new Error(`DSPy output was not valid JSON: ${stdout || '(empty)'}`);
  }
}

module.exports = {
  runDspy
};
