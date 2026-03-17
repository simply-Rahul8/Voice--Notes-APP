require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

app.use(express.static(path.join(__dirname, '../public')));

// Health check — also confirms the key is loaded (never exposes the key itself)
app.get('/api/status', (req, res) => {
  if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'your_deepgram_api_key_here') {
    return res.json({ configured: false, message: 'API key not set in .env' });
  }
  res.json({ configured: true, message: 'API key loaded' });
});

// Proxy: fetch Deepgram balance (bypasses browser CORS)
app.get('/api/balance', async (req, res) => {
  if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'your_deepgram_api_key_here') {
    return res.status(500).json({ error: 'API key not configured in .env' });
  }
  try {
    const r1 = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` }
    });
    if (!r1.ok) {
      return res.status(r1.status).json({ error: `Deepgram auth failed (${r1.status})` });
    }
    const d1 = await r1.json();
    const projectId = d1.projects?.[0]?.project_id;
    if (!projectId) return res.status(404).json({ error: 'No project found' });

    const r2 = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/balances`, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` }
    });
    if (!r2.ok) return res.status(r2.status).json({ error: `Balance fetch failed (${r2.status})` });

    const d2 = await r2.json();
    const amount = d2.balances?.[0]?.amount ?? null;
    res.json({ balance: amount, currency: 'USD' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy: Deepgram token for frontend WebSocket (short-lived, scoped)
app.get('/api/deepgram-token', async (req, res) => {
  if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'your_deepgram_api_key_here') {
    return res.status(500).json({ error: 'API key not configured in .env' });
  }
  try {
    // Issue a short-lived token via Deepgram's on-premise auth endpoint
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ time_to_live_in_seconds: 60 })
    });

    if (r.ok) {
      const d = await r.json();
      return res.json({ token: d.key, ephemeral: true });
    }

    // Fallback: return a flag so the frontend uses the server-side WS proxy approach
    res.json({ token: null, ephemeral: false, useProxy: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy: post-recording transcription (audio bytes flow through server)
app.post('/api/transcribe', async (req, res) => {
  if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'your_deepgram_api_key_here') {
    return res.status(500).json({ error: 'API key not configured in .env' });
  }
  try {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || 'audio/webm';
      const r = await fetch(
        'https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&smart_format=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${DEEPGRAM_API_KEY}`,
            'Content-Type': contentType
          },
          body
        }
      );
      if (!r.ok) return res.status(r.status).json({ error: `Transcription failed (${r.status})` });
      const d = await r.json();
      const transcript = d.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      res.json({ transcript });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Voice Notes running at http://localhost:${PORT}`);
  console.log(`  API key: ${DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'your_deepgram_api_key_here' ? '✓ loaded from .env' : '✗ not set — edit .env'}\n`);
});
