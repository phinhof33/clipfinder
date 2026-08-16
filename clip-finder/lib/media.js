const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const TMP_DIR = path.join(__dirname, '..', 'tmp');

async function downloadVideo(videoUrl, jobId) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const videoPath = path.join(TMP_DIR, `${jobId}.mp4`);

  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Failed to download clip video (${res.status})`);

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(videoPath);
    res.body.pipe(dest);
    res.body.on('error', reject);
    dest.on('finish', resolve);
  });

  return videoPath;
}

function extractAudio(videoPath, jobId) {
  const audioPath = path.join(TMP_DIR, `${jobId}.mp3`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(audioPath))
      .on('error', reject)
      .save(audioPath);
  });
}

function cleanup(jobId) {
  for (const ext of ['mp4', 'mp3']) {
    const p = path.join(TMP_DIR, `${jobId}.${ext}`);
    fs.promises.unlink(p).catch(() => {});
  }
}

module.exports = { downloadVideo, extractAudio, cleanup };
