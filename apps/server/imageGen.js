const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateImage(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt is required');
  }

  const {
    model = process.env.OPENAI_IMAGE_MODEL || 'dall-e-3',
    size = '1024x1024',
    n = 1,
    response_format = 'url',
    quality = 'standard',
  } = options || {};

  const response = await client.images.generate({
    model,
    prompt: prompt.trim(),
    size,
    n,
    response_format,
    quality,
  });

  const first = Array.isArray(response?.data) ? response.data[0] : null;
  if (!first) {
    throw new Error('Image generation returned no results');
  }

  return {
    url: first.url || null,
    b64_json: first.b64_json || null,
    revised_prompt: first.revised_prompt || null,
  };
}

module.exports = { generateImage };
