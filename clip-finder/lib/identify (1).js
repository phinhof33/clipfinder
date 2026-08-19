const fetch = require('node-fetch');
const TMDB_BASE = 'https://api.themoviedb.org/3';
/**
 * We don't have a "recognize this clip" model to lean on, so title
 * identification here is deliberately cheap: pull anything that looks like
 * a title from the tweet's own caption/hashtags first (people usually say
 * what they're posting), and ALSO ask GPT to guess likely titles directly
 * from the transcribed dialogue (many posters give zero context, so
 * dialogue is often the only signal we have). Both sets of guesses get
 * fed into the same TMDB search/verification step below, so a wrong GPT
 * guess just fails to find a real title rather than producing a false
 * positive.
 */
async function searchCandidates({ caption, hashtags, transcriptText }) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');
  const captionGuesses = buildQueryGuesses({ caption, hashtags });
  const dialogueGuesses = await guessTitlesFromDialogue(transcriptText);
  const queries = [...captionGuesses, ...dialogueGuesses];
  const seen = new Map();
  for (const q of queries) {
    if (!q) continue;
    const url = `${TMDB_BASE}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of (data.results || [])) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      if (!seen.has(r.id)) seen.set(r.id, r);
    }
    if (seen.size >= 5) break; // enough candidates, stop burning search quota
  }
  return [...seen.values()]
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      mediaType: r.media_type,
      posterPath: r.poster_path
    }));
}
function buildQueryGuesses({ caption, hashtags }) {
  const guesses = [];
  // Quoted phrases in the caption are a strong signal ("...from The Bear")
  const quoted = (caption.match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ''));
  guesses.push(...quoted);
  // "from X", "X (year)", "X s01e03" style patterns
  const fromMatch = caption.match(/from\s+([A-Z][\w:'\- ]{2,40})/);
  if (fromMatch) guesses.push(fromMatch[1].trim());
  guesses.push(...hashtags.filter(h => /^[A-Z]/.test(h) || h.length > 3));
  // Last resort: the caption itself, stripped of URLs/emoji-ish noise
  const stripped = caption.replace(/https?:\/\/\S+/g, '').trim();
  if (stripped) guesses.push(stripped);
  return [...new Set(guesses)];
}
// Ask GPT to name plausible movies/shows a transcribed line of dialogue
// could be from. Best-effort: on any failure (missing key, bad response,
// network hiccup) we just return no extra guesses rather than throwing,
// since the caption-based guesses can still carry the request.
async function guessTitlesFromDialogue(transcriptText) {
  if (!transcriptText || transcriptText.trim().length < 3) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You identify movies and TV shows from short transcribed clips of dialogue. Reply with ONLY a JSON array of up to 3 likely title strings, most likely first, e.g. ["Breaking Bad","Better Call Saul"]. If you have no reasonable guess, reply with [].'
          },
          {
            role: 'user',
            content: `Dialogue transcript from a short video clip:\n"${transcriptText.slice(0, 500)}"\n\nWhat movie or TV show is this most likely from?`
          }
        ],
        temperature: 0.3
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string') : [];
  } catch {
    return []; // best-effort — never let a bad GPT response break the pipeline
  }
}
async function getWatchProviders(tmdbId, mediaType, region = 'US') {
  const apiKey = process.env.TMDB_API_KEY;
  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/watch/providers?api_key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const entry = data.results && data.results[region];
  if (!entry) return [];
  const buckets = ['flatrate', 'ads', 'free'];
  const names = new Set();
  for (const b of buckets) {
    for (const p of (entry[b] || [])) names.add(p.provider_name);
  }
  return [...names];
}
module.exports = { searchCandidates, getWatchProviders };
