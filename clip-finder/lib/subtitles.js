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
  if (!res.ok) throw new Error(`OpenSubtitles login failed (${res.status})`);
  const data = await res.json();
