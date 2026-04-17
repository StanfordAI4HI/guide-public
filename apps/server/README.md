# ai-multi-support Server

This package powers the API layer that supports the guided reflection experience in the ai-multi-support app. It exposes HTTP endpoints for evaluation, step control, acknowledgements, summaries, and intervention planning, all backed by OpenAI models.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   Create a `.env` file alongside this README:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_CHAT_MODEL=gpt-4o-mini
   MAX_FOLLOW_UPS_PER_STEP=1
   PORT=8787
   ```
   Only `OPENAI_API_KEY` is required; the other values are optional overrides.

3. **Run the server**
   ```bash
   npm run dev
   ```

   The server starts on `http://localhost:8787` by default.

## Key Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/chat` | POST | General assistant replies outside the step flow. |
| `/evaluate` | POST | Decide if a user answer needs a clarifying follow-up. |
| `/step-control` | POST | Choose whether to stay on the current step or move on. |
| `/acknowledge` | POST | Craft the assistant message for the current step. |
| `/summary` | POST | Produce the end-of-session recap. |
| `/intervention` | POST | Generate a 20-minute self-support plan. |
| `/sessions` | GET | List recent chat sessions with timestamps and last message previews. |
| `/sessions/:id` | GET | Retrieve the stored messages and summaries for a session. |

Request/response payloads are JSON; see `index.js` for exact shapes.

## Logging

Structured logs are appended to `apps/logs/server.log`. Each entry includes a timestamp, event name, and the relevant payload fragment for quick debugging.

## Session storage

Chat transcripts and summaries are persisted in a lightweight SQLite database (`apps/server/data/support.db` by default) via `better-sqlite3`. Override the path with the `SUPPORT_DB_PATH` environment variable if you need the file elsewhere. The `/chat` and `/summary` routes automatically write into this store, while `/sessions` and `/sessions/:id` provide a simple way to browse history for debugging or future UI surfaces.

## Customising Prompts

Prompts for the system messages live in `prompts.js`. Adjusting those strings lets you tweak behaviour without touching the endpoint logic.

## Follow-up Limit

The `MAX_FOLLOW_UPS_PER_STEP` environment variable constrains the number of clarifying questions asked per step. The default is one, but you can raise it if you need deeper probing.

## Production Safety Defaults

When `NODE_ENV=production`, this server now applies safer defaults:

- Browser CORS is blocked unless `CORS_ORIGINS` is configured.
- Session read endpoints are disabled unless `ALLOW_SESSION_READS=1`.
- Log stream endpoint is disabled unless `ALLOW_LOG_STREAM=1`.
- In-memory per-IP rate limiting is enabled for expensive model/media routes (configurable with `RATE_LIMIT_*` env vars).
