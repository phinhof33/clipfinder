const fetch = require('node-fetch');
let SrtParser = null;
async function getSrtParser() {
  if (!SrtParser) {
    SrtParser = (await import('srt-parser-2')).default;
  }
  return SrtParser;
}
const OS_BASE = 'https://api.opensubtitles.com/api/v1';
let cachedToken = null;
async function login() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${OS_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': process.env.OPENSUBTITLES_API_KEY,
      'User-Agent': 'ClipFinder v0.1'
    },
    body: JSON.stringify({
      username: process.env.OPENSUBTITLES_USERNAME,
      password: process.env.OPENSUBTITLES_PASSWORD
    })
  });
  console.log(`[subtitles] login status: ${res.status}`);
  if (!res.ok) {
    const errText = await res.text();
    console.log(`[subtitles] login failed body: ${errText.slice(0, 300)}`);
    throw new Error(`OpenSubtitles login failed (${res.status})`);
  }
  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}
async function getImdbId(tmdbId, mediaType) {
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${process.env.TMDB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`[subtitles] TMDB external_ids lookup failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  console.log(`[subtitles] imdb_id for tmdbId=${tmdbId}: ${data.imdb_id}`);
  return data.imdb_id || null;
}
async function fetchSubtitleForTitle({ tmdbId, mediaType, title }) {
  const imdbId = await getImdbId(tmdbId, mediaType);
  if (!imdbId) {
    console.log(`[subtitles] ${title}: no imdb_id found, skipping`);
    return null;
  }
  let token;
  try {
    token = await login();
  } catch (e) {
    console.log(`[subtitles] ${title}: login threw: ${e.message}`);
    return null;
  }
  const numericImdb = imdbId.replace('tt', '');
  const searchUrl = `${OS_BASE}/subtitles?imdb_id=${numericImdb}&languages=en`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'Api-Key': process.env.OPENSUBTITLES_API_KEY, 'User-Agent': 'ClipFinder v0.1' }
  });
  console.log(`[subtitles] ${title}: search status ${searchRes.status}`);
  if (!searchRes.ok) {
    const errText = await searchRes.text();
    console.log(`[subtitles] ${title}: search failed body: ${errText.slice(0, 300)}`);
    return null;
  }
  const searchData = await searchRes.json();
  console.log(`[subtitles] ${title}: search returned ${(searchData.data || []).length} results`);
  const best = (searchData.data || [])[0];
  if (!best) return null;
  const fileId = best.attributes.files[0].file_id;
  const downloadRes = await fetch(`${OS_BASE}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': process.env.OPENSUBTITLES_API_KEY,
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'ClipFinder v0.1'
    },
    body: JSON.stringify({ file_id: fileId })
  });
  console.log(`[subtitles] ${title}: download status ${downloadRes.status}`);
  if (!downloadRes.ok) {
    const errText = await downloadRes.text();
    console.log(`[subtitles] ${title}: download failed body: ${errText.slice(0, 300)}`);
    return null;
  }
  const downloadData = await downloadRes.json();
  const srtRes = await fetch(downloadData.link);
  const srtText = await srtRes.text();
  const SrtParserClass = await getSrtParser();
  const parser = new SrtParserClass();
  return parser.fromSrt(srtText); // [{ startTime, endTime, text, ... }]
}
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function wordOverlapScore(a, b) {
  const setA = new Set(normalize(a).split(' '));
  const setB = new Set(normalize(b).split(' '));
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / Math.max(setA.size, setB.size);
}
// Slide the transcript over the subtitle cue list looking for the best-matching window.
function findBestTimestamp(transcriptText, subtitleCues) {
  const target = normalize(transcriptText);
  if (!target || !subtitleCues.length) return null;
  let best = { score: 0, index: -1 };
  const windowSize = 6; // ~6 subtitle cues is roughly a short clip's worth of dialogue
  for (let i = 0; i < subtitleCues.length; i++) {
    const windowText = subtitleCues
      .slice(i, i + windowSize)
      .map(c => c.text)
      .join(' ');
    const score = wordOverlapScore(target, windowText);
    if (score > best.score) best = { score, index: i };
  }
  if (best.index === -1 || best.score < 0.15) return null; // too weak to trust
  const cue = subtitleCues[best.index];
  return {
    timestamp: cue.startTime, // "HH:MM:SS,mmm"
    confidence: Math.round(best.score * 100)
  };
}
module.exports = { fetchSubtitleForTitle, findBestTimestamp };
