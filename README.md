# Voice Notes — Deepgram

A minimal voice-to-text notes app. Your API key lives only in `.env` on the server — it is never sent to or visible in the browser.

---

## Setup

### 1. Install dependencies

```bash
cd voice-notes
npm install
```

> `.env` is listed in `.gitignore` — it will never be committed.

### 2. Start the server

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## How the key stays hidden

| Request | Route |
|---|---|
| Check key is set | `GET /api/status` → returns `{ configured: true }` — never the key |
| Fetch balance | `GET /api/balance` → server calls Deepgram, returns `{ balance: ... }` |
| Live transcription | `GET /api/deepgram-token` → server issues a short-lived token; WS uses that token |
| Post-recording | `POST /api/transcribe` → audio bytes go server → Deepgram → transcript returned |

The browser never sees `DEEPGRAM_API_KEY`.

---

## Project structure

```
voice-notes/
├── .env                  ← your key (gitignored)
├── .env.example          ← template to share
├── .gitignore
├── package.json
├── server/
│   └── index.js          ← Express server + API proxy routes
└── public/
    ├── index.html
    ├── style.css
    └── app.js            ← frontend (zero API keys)
```

---

## Modes

- **Live** — streams audio over WebSocket using a short-lived token; transcription appears word by word
- **After recording** — records full audio, then POSTs to `/api/transcribe` on stop

> Live mode requires Deepgram's token grant endpoint (`/v1/auth/grant`), available on paid plans. On free plans it auto-falls back to post-recording mode.
