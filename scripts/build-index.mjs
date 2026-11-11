// Optional semantic layer: embeds the chunks of ENABLED master records into data/vectors.json.
// Runtime uses it only when its `version` equals the current chunk version (lib/retrieval.ts chunksVersion), so a
// stale file (older sources, changed toggles) is ignored rather than mixed in. Needs GEMINI_KEYS; never prints keys.
// Without this file, retrieval is the deterministic lexical BM25 path.
import fs from "node:fs";
import { buildChunks, chunksVersion } from "../lib/retrieval.ts";
const KEYS = (process.env.GEMINI_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
if (!KEYS.length) { console.error("GEMINI_KEYS missing — lexical retrieval stays in use; data/vectors.json not written"); process.exit(1); }
const master = JSON.parse(fs.readFileSync("data/master.json", "utf8"));
const chunks = buildChunks(master.records);
let ki = 0;
async function embed(texts) {
  for (let attempt = 0; attempt < KEYS.length * 2; attempt++) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEYS[ki % KEYS.length] },
      body: JSON.stringify({ requests: texts.map(t => ({ model: "models/gemini-embedding-001", content: { parts: [{ text: t }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 })) }) });
    if (r.ok) return (await r.json()).embeddings.map(e => e.values.map(v => +v.toFixed(5)));
    console.warn(`embed: key #${ki % KEYS.length + 1} -> HTTP ${r.status}`); ki++;
    if (r.status === 429) await new Promise(s => setTimeout(s, 3000));
  }
  throw new Error("all keys failed");
}
const vectors = {};
for (let i = 0; i < chunks.length; i += 50) {
  const batch = chunks.slice(i, i + 50);
  const v = await embed(batch.map(c => c.text));
  batch.forEach((c, j) => (vectors[c.id] = v[j]));
}
fs.writeFileSync("data/vectors.json", JSON.stringify({ version: chunksVersion(chunks), model: "gemini-embedding-001", dims: 768, vectors }));
console.log(`vectors: ${chunks.length} chunks, version ${chunksVersion(chunks)}`);
