const fs = require('fs');
const https = require('https');
const OpenAI = require('openai');
const { toFile } = require('openai');

// Force IPv4 — on some hosting networks, IPv6 routes to api.openai.com
// are broken/blackholed, which shows up as ECONNRESET rather than a
// clear timeout. Pinning to IPv4 avoids that path entirely.
const httpAgent = new https.Agent({ family: 4, keepAlive: true });

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 60 * 1000,
  httpAgent,
});

async function transcribe(audioPath) {
  const buffer = fs.readFileSync(audioPath);
  const file = await toFile(buffer, 'audio.mp3', { type: 'audio/mpeg' });

  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json' // gives us per-segment timing within the CLIP itself
  });
  return {
    text: transcription.text,
    segments: transcription.segments || []
  };
}
module.exports = { transcribe };
