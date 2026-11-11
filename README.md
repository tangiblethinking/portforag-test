# portforag-test

Portfolio RAG chat for Christopher Kenreigh — Product Design, Product Management, Product Strategy.

- `data/master.json` — the ONE canonical master: all 86 evidence-map repository records + the supplied resume, stable ids, `indexable` toggle, `manual` verified corrections, sources/last-checked, missing/conflict `flags`, alias map for old runtime ids and Recent Work URLs, and `unaccounted` runtime items. Cards and retrieval are both derived from it.
- `npm run build:master` — regenerates the master from repo inputs only: `data/source/evidence-map/index.html` (+ `src/images/*.webp`), `public/resume.html` (the supplied resume, served unchanged), `projects.json` and `data/recent-work.json` (aliases/accounting only). Carries over `indexable` and `manual` for existing ids. Copies referenced captures to `public/evidence/`.
- `/api/chat` — deterministic BM25 over chunks of enabled records (`lib/retrieval.ts`; broad industries/employers/skills/capabilities questions pin the resume parts and add relevant projects) → Gemini answer → record ids filtered to enabled ids that were in context.
- `npm run index` (optional, needs `GEMINI_KEYS`) — writes `data/vectors.json`; used only when its version matches the current enabled chunk set, otherwise ignored.
- `npm test` — deterministic master/retrieval/UI-contract tests. `npm run typecheck`.
- `/api/suggestions` — chips.
- Keys: `GEMINI_KEYS` = ordered, comma-separated (primary first). States ready/cooling(60s)/exhausted(until midnight Pacific)/disabled, ≤3 attempts per request. Shared state uses Upstash/Vercel KV REST env vars if present (`KV_REST_API_URL`, `KV_REST_API_TOKEN`); otherwise per-instance memory (state not shared across serverless instances).
- Model: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`).
