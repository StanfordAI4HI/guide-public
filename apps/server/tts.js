const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function synthesizeSpeech(text, opts = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('text is required');
  }
  const {
    model = 'gpt-4o-mini-tts',
    voice = 'alloy', // OpenAI default voice
    format = 'mp3',
    speed = 1,
  } = opts;

  const response = await client.audio.speech.create({
    model,
    voice,
    input: text.trim(),
    format,
    speed,
  });

  const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
  return {
    format,
    base64,
    url: `data:audio/${format};base64,${base64}`,
  };
}

module.exports = { synthesizeSpeech };
