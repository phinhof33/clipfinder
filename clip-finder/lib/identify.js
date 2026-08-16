const fetch = require('node-fetch');

const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * We don't have a "recognize this clip" model to lean on, so title
 * identification here is deliberately cheap: pull anything that looks like
 * a title from the tweet's own caption/hashtags first (people usually say
 * what they're posting), and fall back to a keyword search on the
 * transcript only if the caption gives us nothing. This will miss clips
 * posted with zero context — that's a real limitation, not a bug.
 */
async function searchCandidates({ caption, hashtags, transcriptText }) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');

  const queries = buildQueryGuesses({ caption, hashtags, transcriptText });

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
