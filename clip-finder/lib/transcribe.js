const fs = require('fs');
const OpenAI = require('openai');

async function transcribe(audioPath) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
