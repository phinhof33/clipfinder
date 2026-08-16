# Clip Finder

Paste a link to a movie/TV clip posted on X, and this tries to figure out
what it's from and roughly where in the runtime it falls.

## How it actually works

There's no public "identify this movie clip" API, so this doesn't do visual
recognition. Instead it matches on **dialogue**:

1. Pull the video off the tweet (via X's embed/syndication endpoint — unofficial, no key needed, but can break if X changes it)
2. Extract the audio and transcribe it with Whisper
3. Guess candidate titles from the tweet's caption/hashtags (this is the weakest link — a clip with no context in the caption gives us nothing to search on)
4. Pull an English subtitle file for the best candidate(s) and fuzzy-match the transcript against subtitle cue timing
5. Report the title, the matched timestamp, and (via TMDb) where it's currently streaming

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with three free-tier API keys:

| Key | Where to get it |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com — pay-as-you-go, Whisper is cheap (~$0.006/min) |
| `TMDB_API_KEY` | themoviedb.org/settings/api — free |
| `OPENSUBTITLES_API_KEY` + username/password | opensubtitles.com/consumers — free tier, rate-limited |

You'll also need `ffmpeg` available on the system (handled automatically via `ffmpeg-static`, no separate install needed).

```bash
npm start
```

Then open `http://localhost:3000`.

## Known limitations (real ones, not hedging)

- **Silent or music-heavy clips won't match.** No dialogue, no transcript, no match. This is the core constraint of a dialogue-matching approach.
- **Captionless tweets are a dead end as-is.** Title guessing currently leans on the tweet's own text/hashtags. A clip posted with zero context has nothing to search on. (A future improvement: let the user optionally type the title themselves as a fallback — see "Ideas to extend" below.)
- **Twitter's syndication endpoint is unofficial.** It's the same one embed.twitter.com uses, so it's reasonably stable, but it's not a documented/supported API and can change without notice.
- **OpenSubtitles' free tier is rate-limited** and subtitle timing quality varies by upload — expect noise, not perfect timestamps.
- **No real deep-linking into streaming apps.** DRM'd players (Netflix, Max, etc.) don't expose a "seek to timestamp" URL scheme, so the output is "here's the title and here's the streaming providers and the rough minute mark" — not an autoplay-at-that-second experience. That was true of every version of this idea, not just this implementation.
- **Not tested end-to-end** — this was scaffolded in an environment without network access, so the individual pieces (syndication scraping, Whisper call, OpenSubtitles flow) are each implemented against their real documented/observed behavior, but the full chain hasn't been run against a live tweet. Treat this as a strong first draft, not a finished product — you'll likely need to debug the first few runs.

## Ideas to extend

- Add a manual "tell us the title" fallback input for when auto-guessing fails
- Cache subtitle files locally so repeat lookups for the same title are instant
- Show the matched subtitle line itself in the result, so the user can sanity-check the match
- Support non-English audio (Whisper handles it; you'd need non-English subtitle search too)
# clipfinder
