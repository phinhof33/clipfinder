const fetch = require('node-fetch');

/**
 * Twitter/X locks its official API behind paid tiers that are overkill for
 * reading one public tweet. Instead we use the syndication endpoint that
 * powers embedded tweets (embed.twitter.com) — no key required, but it's
 * unofficial and undocumented, so it can change or break without notice.
 * If it stops working, the fix is almost always: re-derive the `token`
 * formula below by inspecting requests from a live embedded tweet in
 * devtools.
 */

function extractTweetId(url) {
  const match = url.match(/status(?:es)?\/(\d+)/);
  if (!match) {
    throw new Error(
      "Couldn't find a tweet ID in that URL. Expected something like " +
      'https://x.com/user/status/1234567890'
    );
  }
  return match[1];
}

// Reverse-engineered token the syndication endpoint expects alongside the id.
function syndicationToken(tweetId) {
  const num = Number(tweetId) / 1e15;
  return (num * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

async function fetchTweet(tweetUrl) {
  const id = extractTweetId(tweetUrl);
  const token = syndicationToken(id);
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;

  const res = await fetch(endpoint, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClipFinder/0.1)' }
  });

  if (!res.ok) {
    throw new Error(
      `Twitter syndication endpoint returned ${res.status}. The tweet may be ` +
      'private/deleted, or Twitter has changed this endpoint (it is unofficial).'
    );
  }

  const data = await res.json();

  const caption = data.text || '';
  const hashtags = (caption.match(/#\w+/g) || []).map(h => h.slice(1));

  const media = (data.mediaDetails || []).find(m => m.type === 'video' || m.type === 'animated_gif');
  if (!media || !media.video_info || !media.video_info.variants) {
    throw new Error('No video found on that tweet.');
  }

  const mp4Variants = media.video_info.variants
    .filter(v => v.content_type === 'video/mp4' && v.bitrate)
    .sort((a, b) => b.bitrate - a.bitrate);

  if (!mp4Variants.length) {
    throw new Error('Found media on the tweet, but no downloadable mp4 variant.');
  }

  return {
    videoUrl: mp4Variants[0].url,
    caption,
    hashtags,
    authorHandle: data.user && data.user.screen_name
  };
}

module.exports = { fetchTweet, extractTweetId };
