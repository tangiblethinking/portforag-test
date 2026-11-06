# portforag-test

Portfolio RAG chat for Christopher Kenreigh — Product Design, Product Management, Product Strategy.

- `projects.json` — repos allowed into the index (set `allowed:false` to drop one; edit `brand` blocks).
- `npm run index` — builds `data/index.json` (README, portfolio.json, live page text; `gemini-embedding-001`, 768 dims). Needs `GEMINI_KEYS`.
- `npm run qa` — retrieval check.
- `/api/chat` — embed question → cosine search over `data/index.json` → Gemini answer + project ids. `/api/suggestions` — chips.
- Keys: `GEMINI_KEYS` = ordered, comma-separated (primary first). States ready/cooling(60s)/exhausted(until midnight Pacific)/disabled, ≤3 attempts per request. Shared state uses Upstash/Vercel KV REST env vars if present (`KV_REST_API_URL`, `KV_REST_API_TOKEN`); otherwise per-instance memory (state not shared across serverless instances).
- Model: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`).
- Nightly/auto reindex: `.github/workflows/index.yml` (needs repo secret `GEMINI_KEYS`).
