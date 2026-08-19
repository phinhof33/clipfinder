const fs = require('fs');

// The OpenAI SDK's internal upload path was hanging/resetting on this
// network for multipart file uploads (still unclear why — plain GET
// requests through the SDK work fine). Native fetch + FormData was
// confirmed to work in isolation, so we use that directly here instead
// of going through client.audio.transcriptions.create().
async function transcribe(audioPath) {
  const buffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper transcription failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const transcription = await res.json();
  return {
    text: transcription.text,
    segments: transcription.segments || []
  };
}
module.exports = { transcribe };
