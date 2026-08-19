const fs = require('fs');
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,       // retry automatically on network errors like ECONNRESET
  timeout: 60 * 1000,  // 60s timeout per attempt
});

async function transcribe(audioPath) {
  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json' // gives us per-segment timing within the CLIP itself
  });
  return {
    text: transcription.text,
    segments: transcription.segments || []
  };
}
module.exports = { transcribe };
