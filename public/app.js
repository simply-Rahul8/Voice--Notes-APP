// ── State ──────────────────────────────────────────────
let mediaRecorder, audioChunks = [], stream, timerInterval, seconds = 0;
let isRecording = false, mode = 'realtime';
let finalText = '', partialText = '', socket = null;
let animFrame, analyser, dataArr;

// ── Waveform setup ─────────────────────────────────────
const BARS = 28;
const wf = document.getElementById('waveform');
for (let i = 0; i < BARS; i++) {
  const b = document.createElement('div');
  b.className = 'wave-bar';
  wf.appendChild(b);
}

// ── Utilities ──────────────────────────────────────────
function setStatus(msg, type = '') {
  const el = document.getElementById('statusBar');
  el.textContent = msg;
  el.className = 'status-bar' + (type ? ' ' + type : '');
}

function renderTranscript() {
  const el = document.getElementById('transcript');
  if (!finalText && !partialText) {
    el.innerHTML = '<span class="placeholder">Press record to begin…</span>';
    return;
  }
  el.innerHTML =
    (finalText || '') +
    (partialText ? '<span class="partial"> ' + partialText + '</span>' : '');
}

// ── Server status & balance ────────────────────────────
async function checkStatus() {
  const dot = document.getElementById('keyDot');
  const txt = document.getElementById('keyStatusText');
  dot.className = 'key-dot';
  txt.textContent = 'Checking…';
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (d.configured) {
      dot.className = 'key-dot ok';
      txt.textContent = 'API key loaded from .env — not exposed to browser';
      fetchBalance();
    } else {
      dot.className = 'key-dot err';
      txt.textContent = d.message || 'API key not configured';
    }
  } catch {
    dot.className = 'key-dot err';
    txt.textContent = 'Server not reachable — run: npm start';
  }
}

async function fetchBalance() {
  try {
    const r = await fetch('/api/balance');
    const d = await r.json();
    if (d.balance != null) {
      document.getElementById('balance').textContent = '$' + Number(d.balance).toFixed(4);
    } else {
      document.getElementById('balance').textContent = d.error ? 'Error' : '—';
    }
  } catch {
    document.getElementById('balance').textContent = '—';
  }
}

// ── Mode toggle ────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.getElementById('modeRT').classList.toggle('active', m === 'realtime');
  document.getElementById('modePost').classList.toggle('active', m === 'post');
}

// ── Recording ──────────────────────────────────────────
async function toggleRecord() {
  if (!isRecording) await startRecording();
  else stopRecording();
}

async function startRecording() {
  // Verify server/key first
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (!d.configured) {
      setStatus('API key not set in .env — see README.', 'err');
      return;
    }
  } catch {
    setStatus('Server not reachable — run: npm start', 'err');
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setStatus('Mic access denied.', 'err');
    return;
  }

  finalText = '';
  partialText = '';
  renderTranscript();
  isRecording = true;
  seconds = 0;

  document.getElementById('recBtn').classList.add('recording');
  document.getElementById('recStatus').textContent = 'Recording';
  document.getElementById('recStatus').classList.add('active');

  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    document.getElementById('recTimer').textContent = m + ':' + s;
  }, 1000);

  startWaveform(stream);

  if (mode === 'realtime') {
    await startRealtime(stream);
  } else {
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(250);
    setStatus('Recording…');
  }
}

async function startRealtime(stream) {
  // Fetch a short-lived token from the server so the WS key never hits the browser
  let token = null;
  try {
    const r = await fetch('/api/deepgram-token');
    const d = await r.json();
    if (d.token) token = d.token;
  } catch {}

  if (!token) {
    // Deepgram token endpoint not available on free plans — fall back to post-recording
    setStatus('Live token unavailable — switching to post-recording mode.', 'err');
    setMode('post');
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(250);
    setStatus('Recording (will transcribe on stop)…');
    return;
  }

  const url =
    'wss://api.deepgram.com/v1/listen' +
    '?encoding=opus&sample_rate=48000&channels=1' +
    '&model=nova-2&interim_results=true&punctuate=true&smart_format=true';

  socket = new WebSocket(url, ['token', token]);

  socket.onopen = () => {
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder = mr;
    mr.ondataavailable = e => {
      if (socket.readyState === WebSocket.OPEN && e.data.size > 0) socket.send(e.data);
    };
    mr.start(100);
    setStatus('Streaming live…', 'ok');
  };

  socket.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      const t = d.channel?.alternatives?.[0]?.transcript || '';
      if (d.is_final) {
        if (t) { finalText += (finalText ? ' ' : '') + t; partialText = ''; }
      } else {
        partialText = t;
      }
      renderTranscript();
    } catch {}
  };

  socket.onerror = () => setStatus('WebSocket error.', 'err');
  socket.onclose = ev => {
    if (ev.code === 1008) setStatus('Auth failed — check your API key in .env.', 'err');
  };
}

function stopRecording() {
  isRecording = false;
  clearInterval(timerInterval);
  resetWaveform();

  document.getElementById('recBtn').classList.remove('recording');
  document.getElementById('recStatus').textContent = 'Ready';
  document.getElementById('recStatus').classList.remove('active');

  if (socket) { socket.close(); socket = null; }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    if (mode === 'post') {
      mediaRecorder.onstop = () => transcribePost();
    }
  }

  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

  if (mode === 'realtime') {
    partialText = '';
    renderTranscript();
    setStatus('Done.', 'ok');
  }
}

// ── Post-recording transcription (via server proxy) ────
async function transcribePost() {
  setStatus('Transcribing via server…');
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  try {
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob
    });
    if (!r.ok) { setStatus('Transcription failed (' + r.status + ').', 'err'); return; }
    const d = await r.json();
    finalText = d.transcript || '';
    renderTranscript();
    setStatus('Transcription complete.', 'ok');
  } catch (e) {
    setStatus('Error: ' + e.message, 'err');
  }
}

// ── Waveform animation ─────────────────────────────────
function startWaveform(stream) {
  const ctx = new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  ctx.createMediaStreamSource(stream).connect(analyser);
  dataArr = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    if (!isRecording) return;
    analyser.getByteFrequencyData(dataArr);
    wf.querySelectorAll('.wave-bar').forEach((b, i) => {
      const v = dataArr[Math.floor(i * dataArr.length / BARS)];
      b.style.height = Math.max(3, Math.min(36, (v / 255) * 36)) + 'px';
      b.style.background = v > 60 ? 'var(--text)' : 'var(--border2)';
    });
    animFrame = requestAnimationFrame(draw);
  }
  draw();
}

function resetWaveform() {
  cancelAnimationFrame(animFrame);
  wf.querySelectorAll('.wave-bar').forEach(b => {
    b.style.height = '4px';
    b.style.background = 'var(--border2)';
  });
}

// ── Notes actions ──────────────────────────────────────
function copyTranscript() {
  const t = finalText + (partialText ? ' ' + partialText : '');
  if (!t) { setStatus('Nothing to copy.', 'err'); return; }
  navigator.clipboard.writeText(t)
    .then(() => setStatus('Copied.', 'ok'))
    .catch(() => setStatus('Copy failed.', 'err'));
}

function appendToNotes() {
  const t = finalText + (partialText ? ' ' + partialText : '');
  if (!t) { setStatus('No transcript to append.', 'err'); return; }
  const ta = document.getElementById('notes');
  ta.value += (ta.value ? '\n\n' : '') + t;
  setStatus('Appended to notes.', 'ok');
}

function clearNotes() {
  document.getElementById('notes').value = '';
  setStatus('');
}

function downloadNotes() {
  const txt = document.getElementById('notes').value.trim();
  if (!txt) { setStatus('Notes are empty.', 'err'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = 'voice-notes-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  setStatus('Downloaded.', 'ok');
}

// ── Init ───────────────────────────────────────────────
checkStatus();
