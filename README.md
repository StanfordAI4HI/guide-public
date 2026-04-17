# GUIDE (Public)

GUIDE is a monorepo with:
- `apps/app` (Expo web frontend)
- `apps/server` (Express backend)

## Abstract

Digital mental health (DMH) tools have extensively explored personalization of interventions to users' needs and contexts. However, this personalization often targets what support is provided, not how it is experienced. Even well-matched content can fail when the interaction format misaligns with how someone can engage. We introduce generative experience as a paradigm for DMH support, where the intervention experience is composed at runtime. We instantiate this in GUIDE, a system that generates personalized intervention content and multimodal interaction structure through rubric-guided generation of modular components. In a preregistered study with N=237 participants, GUIDE significantly reduced stress (p=.02) and improved the user experience (p=.04) compared to an LLM-based cognitive restructuring control. GUIDE also supported diverse forms of reflection and action through varied interaction flows, while revealing tensions around personalization across the interaction sequence. This work lays the foundation for interventions that dynamically shape how support is experienced and enacted in digital settings.

Paper: `https://arxiv.org/abs/2604.07558`  
Project page: `https://ananya-bhattacharjee.github.io/guide/`  
Code: `https://github.com/StanfordAI4HI/guide-public`

## Important Disclaimer

This public demo showcases the system’s ability to generate interventions for general stress situations. It is not intended to address safety-critical use cases or complex edge cases.

Interactions are not monitored, and no real-time support is provided. Do not use this tool for crisis, emergency, or high-risk situations.

While some basic safeguards are included, this system does not replace professional care. If you need additional support, please contact a qualified professional or local services.

## Prerequisites

- Node.js 20+
- npm 10+

## Quick Start (Install + Run)

```bash
git clone https://github.com/StanfordAI4HI/guide-public.git
cd guide-public
npm install
npm --prefix apps/app install
npm --prefix apps/server install
cp apps/server/.env.example apps/server/.env
cp apps/app/.env.example apps/app/.env.local
```

Set your OpenAI key in `apps/server/.env`:

```env
OPENAI_API_KEY=your_key_here
```

Start backend:

```bash
npm --prefix apps/server run dev
```

Start frontend (new terminal):

```bash
npm --prefix apps/app run web
```

Open the URL shown by Expo (usually `http://localhost:8081`).

## Environment Variables

Server (`apps/server/.env`):
- `OPENAI_API_KEY` (required)
- `PORT` (optional, default `8787`)
- `OPENAI_IMAGE_MODEL` (optional, default `dall-e-3`)
- `CORS_ORIGINS` (recommended in production; comma-separated allowlist)
- `ALLOW_SESSION_READS` (optional; default off in production)
- `ALLOW_LOG_STREAM` (optional; default off in production)
- `RATE_LIMIT_ENABLED` (optional; default on in production)
- `RATE_LIMIT_MAX` (optional; default `120`)
- `RATE_LIMIT_WINDOW_MS` (optional; default `60000`)

App (`apps/app/.env.local`):
- `EXPO_PUBLIC_API_BASE` (default template: `http://localhost:8787`)

## Security Notes

- Keep real secrets only in local env files or your cloud secret manager.
- Do not put real secrets in `.env.example` or source files.

## Contact

For questions, contact: `ananyabh@stanford.edu`
