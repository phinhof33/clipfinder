const form = document.getElementById('analyzeForm');
const submitBtn = document.getElementById('submitBtn');
const readout = document.getElementById('readout');
const stepsList = document.getElementById('stepsList');
const timecodeEl = document.getElementById('timecode');
const resultEl = document.getElementById('result');

const PIPELINE_STEPS = [
  'Reading tweet',
  'Downloading clip',
  'Extracting audio',
  'Transcribing dialogue',
  'Guessing candidate titles',
  'Matching against subtitles',
  'Looking up where to watch'
];

let timecodeInterval = null;

function startTimecode() {
  let seconds = 0;
  timecodeEl.textContent = '00:00:00';
  timecodeInterval = setInterval(() => {
    seconds += 1;
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timecodeEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimecode() {
  clearInterval(timecodeInterval);
}

function renderSteps(completedCount) {
  stepsList.innerHTML = PIPELINE_STEPS.map((label, i) => {
    const cls = i < completedCount ? 'done' : i === completedCount ? 'active' : '';
    return `<li class="${cls}">${label}</li>`;
  }).join('');
}

// We don't get real progress events from a single fetch, so we advance the
// step list on a timer as a best-effort approximation of where the backend
// probably is. The final render (success or error) always corrects it.
function fakeAdvanceSteps() {
  let i = 0;
  renderSteps(i);
  return setInterval(() => {
    if (i < PIPELINE_STEPS.length - 1) {
      i += 1;
      renderSteps(i);
    }
  }, 1400);
}

function formatTimestamp(srtTime) {
  // srt-parser-2 gives "HH:MM:SS,mmm"
  if (!srtTime) return '—';
  return srtTime.split(',')[0];
}

function renderResult(data) {
  if (!data.ok) {
    resultEl.innerHTML = `
      <div class="error-box">
        <strong>No confident match.</strong><br>
        ${escapeHtml(data.message || 'Something about this clip made it hard to identify.')}
      </div>`;
    resultEl.hidden = false;
    return;
  }

  const posterUrl = data.posterPath
    ? `https://image.tmdb.org/t/p/w200${data.posterPath}`
    : '';

  resultEl.innerHTML = `
    <div class="result-header">
      <div class="result-eyebrow">${data.mediaType === 'tv' ? 'TV SERIES' : 'FILM'} · MATCH FOUND</div>
      <h2 class="result-title">${escapeHtml(data.title)}${data.year ? ` (${data.year})` : ''}</h2>
    </div>
    <div class="result-body">
      ${posterUrl ? `<img class="result-poster" src="${posterUrl}" alt="${escapeHtml(data.title)} poster" />` : '<div class="result-poster"></div>'}
      <div class="result-facts">
        <div>
          <div class="fact-label">START AROUND</div>
          <div class="fact-value">${formatTimestamp(data.timestamp)}</div>
        </div>
        <div>
          <div class="fact-label">MATCH CONFIDENCE</div>
          <div class="fact-value small">${data.confidence}%</div>
          <div class="confidence-bar"><div class="confidence-bar-fill" style="width:${data.confidence}%"></div></div>
        </div>
        ${data.providers && data.providers.length ? `
        <div>
          <div class="fact-label">WHERE TO WATCH</div>
          <div class="providers">
            ${data.providers.map(p => `<span class="provider-chip">${escapeHtml(p)}</span>`).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;
  resultEl.hidden = false;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tweetUrl = document.getElementById('tweetUrl').value.trim();
  if (!tweetUrl) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Working…';
  resultEl.hidden = true;
  readout.hidden = false;
  startTimecode();
  const stepTimer = fakeAdvanceSteps();

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetUrl })
    });
    const data = await res.json();
    renderSteps(PIPELINE_STEPS.length);
    renderResult(data);
  } catch (err) {
    renderResult({ ok: false, message: err.message });
  } finally {
    clearInterval(stepTimer);
    stopTimecode();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Find the scene';
  }
});
