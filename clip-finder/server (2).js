require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { fetchTweet } = require('./lib/twitter');
const { downloadVideo, extractAudio, cleanup } = require('./lib/media');
const { transcribe } = require('./lib/transcribe');
const { searchCandidates, getWatchProviders } = require('./lib/identify');
const { fetchSubtitleForTitle, findBestTimestamp } = require('./lib/subtitles');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Simple in-memory rate limiter ---
// Not shared across multiple instances/restarts, but fine for a
// hobby-scale single-instance deploy. Caps how often any one IP can hit
// the expensive /api/analyze route, since each request costs real money
// (Whisper + GPT) and burns OpenSubtitles' daily quota.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10; // 10 requests per IP per hour
const requestLog = new Map(); // ip -> array of timestamps

function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - timestamps[0]);
    return res.status(429).json({
      ok: false,
      reason: 'rate_limited',
      message: `You've hit the limit of ${RATE_LIMIT_MAX} clips per hour. Try again in about ${Math.ceil(retryAfterMs / 60000)} minute(s).`
    });
  }
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  next();
}

// Periodically clean up old entries so this Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) requestLog.delete(ip);
    else requestLog.set(ip, fresh);
  }
}, 15 * 60 * 1000).unref();

app.post('/api/analyze', rateLimit, async (req, res) => {
  const { tweetUrl } = req.body;
  if (!tweetUrl) return res.status(400).json({ error: 'tweetUrl is required' });
  const jobId = crypto.randomBytes(6).toString('hex');
  const steps = []; // sent back so the UI can show what happened, not just the final answer
  try {
    steps.push('Reading tweet');
    const tweet = await fetchTweet(tweetUrl);
    steps.push('Downloading clip');
    const videoPath = await downloadVideo(tweet.videoUrl, jobId);
    steps.push('Extracting audio');
    const audioPath = await extractAudio(videoPath, jobId);
    steps.push('Transcribing dialogue');
    const transcript = await transcribe(audioPath);
    if (!transcript.text || transcript.text.trim().length < 3) {
      return res.json({
        ok: false,
        reason: 'no_dialogue',
        message: "Couldn't find enough dialogue in this clip to identify it. This approach relies on spoken lines — silent or music-only clips won't match.",
        steps
      });
    }
    steps.push('Guessing candidate titles');
    const candidates = await searchCandidates({
      caption: tweet.caption,
      hashtags: tweet.hashtags,
      transcriptText: transcript.text
    });
    if (!candidates.length) {
      return res.json({
        ok: false,
        reason: 'no_candidates',
        message: "Couldn't guess a title from the tweet's caption or hashtags. This works best when the poster mentions the show/movie somewhere in the tweet.",
        transcript: transcript.text,
        steps
      });
    }
    steps.push('Matching against subtitles');
    let result = null;
    for (const candidate of candidates) {
      const cues = await fetchSubtitleForTitle(candidate);
      if (!cues) continue;
      const match = findBestTimestamp(transcript.text, cues);
      if (match && (!result || match.confidence > result.match.confidence)) {
        result = { candidate, match };
      }
    }
    if (!result) {
      return res.json({
        ok: false,
        reason: 'no_subtitle_match',
        message: 'Found some title guesses but could not line the dialogue up against a subtitle file confidently enough.',
        candidates,
        transcript: transcript.text,
        steps
      });
    }
    steps.push('Looking up where to watch');
    const providers = await getWatchProviders(result.candidate.id, result.candidate.mediaType);
    res.json({
      ok: true,
      title: result.candidate.title,
      year: result.candidate.year,
      mediaType: result.candidate.mediaType,
      posterPath: result.candidate.posterPath,
      timestamp: result.match.timestamp,
      confidence: result.match.confidence,
      providers,
      transcript: transcript.text,
      steps
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, reason: 'error', message: err.message, steps });
  } finally {
    cleanup(jobId);
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Clip Finder running on http://localhost:${PORT}`));
