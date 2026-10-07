# 9Ja Speak — Backend

Nigerian multilingual AI companion API. **"Your AI. Your Language. Your Voice."**

Stateless Node.js backend deployed as Vercel serverless functions. No database —
conversation persistence lives on the device.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{ status: 'ok', version, time }` |
| `GET` | `/api/health/providers` | Per-provider health: config state, requests, failures, last success/error, rolling avg latency |
| `POST` | `/api/chat` | SSE streaming chat (see below) |

### POST /api/chat

Auth: `x-api-key: <APP_API_KEY>` **or** guest mode via `x-guest: true`.
Rate limits: 60 req/min per API key, 10/min for guests (`429` + `Retry-After`).

Request body (JSON; 1MB max, 25MB max when attachments are included):

```json
{
  "messages": [{ "role": "user", "content": "Abeg explain this thing for me." }],
  "companion": {
    "name": "Adaeze", "nickname": "Ada",
    "personalityTraits": ["warm", "witty"],
    "formality": 30, "humor": 80, "energy": 70,
    "responseLength": "short", "emojiPreference": "some",
    "customInstructions": "...", "primaryLanguage": "auto",
    "secondaryLanguages": ["yo", "pcm"]
  },
  "user": { "name": "David", "username": "dara", "bio": "...", "preferredLanguage": "pcm", "timezone": "Africa/Lagos" },
  "memory": [{ "key": "likes", "value": "Burna Boy" }],
  "languageMode": "auto",
  "providerMode": "auto",
  "attachments": [{ "name": "photo.png", "mimeType": "image/png", "dataBase64": "..." }]
}
```

- `languageMode`: `auto` (detect) or `yo` | `ha` | `en` | `en-NG` | `pcm` (strict).
- `providerMode`: `auto` (Gemini → Groq failover) or `gemini` | `groq` (pinned, 1 retry).
- `attachments`: max 3 files, each ≤ 5MB base64. Allowed types:
  `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/wav`, `application/pdf`.
  Gemini accepts all types as `inlineData`; Groq accepts images as `image_url`
  data URLs only — other types return an honest `attachments_unsupported` error
  (never silently dropped).
- Unknown extra fields are ignored gracefully.

Response: `text/event-stream`

```
event: token
data: {"text": "Hello! "}

event: metadata
data: {"provider":"gemini","model":"gemini-2.5-flash","latencyMs":812,"language":"pcm","detectedMix":[],"usage":{...}}

event: error
data: {"error":"provider_not_configured","provider":"gemini","message":"...","retryable":false}

data: [DONE]
```

Errors are always graceful SSE `error` events — the app renders them as
retryable errors and the device-side conversation stays intact. The user's
message is never lost on provider failure. Error payloads are sanitized
(no stack traces, keys, or key-bearing URLs).

## AI providers

- `lib/providers/base.js` — `AIProvider` interface + `ProviderError`.
- `lib/providers/gemini.js` — Gemini REST `:streamGenerateContent?alt=sse`, key via `x-goog-api-key`.
- `lib/providers/groq.js` — Groq OpenAI-compatible `/chat/completions` with `stream: true`.
- `lib/router.js` — auto failover (Gemini first; on timeout/429/5xx/network → Groq,
  2 retries with 500ms→1s backoff), pinned-mode retry, in-memory health tracking.
- `lib/config/models.js` — all model names/endpoints. **No hard-coded model names in routes.**

## Services (`lib/`)

- `auth.js` — stateless `x-api-key` / `x-guest` auth; `AuthProvider` interface for future OAuth.
- `companion.js` — companion config normalization.
- `conversation.js` — message list normalization/validation.
- `memory.js` — user-approved memory facts sanitizing.
- `providerRouter` — see `lib/router.js`.
- `usage.js` — in-memory per-key daily request/token counters.
- `rateLimit.js` — in-memory sliding-window rate limiting.
- `prompt.js` — language detection (Yoruba/Hausa/English/Nigerian English/Pidgin
  incl. code-switching) + dynamic system prompt builder.
- `sse.js`, `http.js`, `validate.js` — SSE/HTTP/validation helpers.

## Environment variables

| Var | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | for Gemini | Gemini API key (empty = provider disabled, honest error returned) |
| `GROQ_API_KEY` | for Groq | Groq API key (empty = provider disabled, honest error returned) |
| `GEMINI_MODEL` | no | default `gemini-2.5-flash` |
| `GROQ_MODEL` | no | default `openai/gpt-oss-120b` |
| `APP_API_KEY` | yes | long random key for `x-api-key` auth |
| `APP_ORIGIN` | no | CORS origin, default `*` |

Add the AI keys later with one command (no redeploy of code needed, but Vercel
needs a redeploy for new env vars to take effect — use the dashboard or
`vercel call-tool`):

```bash
vercel call-tool --name create_project_env --arguments-json \
  '{"idOrName":"9ja-speak-backend","requestBody":{"key":"GEMINI_API_KEY","value":"<PASTE_KEY>","type":"encrypted","target":["production"]}}'
```

(repeat for `GROQ_API_KEY`), then redeploy.

## Local dev

```bash
node local-server.js   # tiny static file server for manual testing (optional)
```

No dependencies — plain Node 18+ (`fetch` is global).
