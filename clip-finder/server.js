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

app.post('/api/analyze', async (req, res) => {
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
app.listen(PORT, () => console.log(`Clip Finder running on http://localhost:${PORT}`));
