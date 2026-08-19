const fs = require('fs');
const OpenAI = require('openai');
const { toFile } = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,       // retry automatically on network errors like ECONNRESET
  timeout: 60 * 1000,  // 60s timeout per attempt
});

async function transcribe(audioPath) {
  // Read the whole file into memory rather than streaming it — streaming
  // uploads have been triggering ECONNRESET on some hosting networks.
  // Clips are short, so buffering the file fully is not a concern.
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
