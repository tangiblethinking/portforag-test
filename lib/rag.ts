import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withKey, type KeyOpts } from "./keys";
import { answerSystem, refineAnswer } from "./refine";
import { displayText, enabledRecords, getMaster } from "./master";
import { buildChunks, chunksVersion, search, type Chunk, type Hit, type SearchResult } from "./retrieval";
const G = "https://generativelanguage.googleapis.com/v1beta/models";
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Retrieval = deterministic BM25 over chunks of ENABLED master records (lib/retrieval.ts).
// Optional semantic layer: data/vectors.json (npm run index) is used only when its `version` equals the current chunk
// version, so vectors from an older source (or including since-disabled records) are never mixed in.
type Vectors = { version: string; model: string; dims: number; vectors: Record<string, number[]> };
type Artifact = { master_sha256: string; chunks_version: string; records: number; enabled: number; chunks: Chunk[] };
let R: { chunks: Chunk[]; version: string; employers: string[]; vectors: Vectors | null; masterSha: string; artifactMasterSha: string | null; fromArtifact: boolean } | null = null;
// Chunks come from the build artifact data/retrieval-index.json (scripts/build-retrieval-index.mjs) when it was built
// from this exact master file; otherwise they are regenerated from the master here, so a stale index is never used.
export function retrieval() {
  if (!R) {
    const masterSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), "data/master.json"))).digest("hex");
    const ap = path.join(process.cwd(), "data/retrieval-index.json");
    const art = fs.existsSync(ap) ? (JSON.parse(fs.readFileSync(ap, "utf8")) as Artifact) : null;
    const fromArtifact = !!art && art.master_sha256 === masterSha;
    const chunks = fromArtifact ? art!.chunks : buildChunks(enabledRecords());
    const version = chunksVersion(chunks);
    const employers = [...new Set(getMaster().records.filter((r) => r.indexable).flatMap((r) => [r.employer?.status === "named" ? r.employer.employer : null, ...(r.resume?.roles ?? []).map((x) => x.company)]).filter((x): x is string => !!x))];
    let vectors: Vectors | null = null;
    const vp = path.join(process.cwd(), "data/vectors.json");
    if (fs.existsSync(vp)) {
      const v = JSON.parse(fs.readFileSync(vp, "utf8")) as Vectors;
      if (v.version === version && chunks.every((c) => Array.isArray(v.vectors[c.id]))) vectors = v;
    }
    R = { chunks, version, employers, vectors, masterSha, artifactMasterSha: art?.master_sha256 ?? null, fromArtifact };
  }
  return R;
}
export function indexInfo() {
  const r = retrieval();
  const recs = getMaster().records;
  return { masterSha: r.masterSha, artifactMasterSha: r.artifactMasterSha, fromArtifact: r.fromArtifact, version: r.version, chunks: r.chunks.length, enabled: recs.filter((x) => x.indexable).length, records: recs.length };
}

// Per-call time budget inside the chat route's 60 s limit (app/api/chat/route.ts): understanding 8 s, answer 20 s,
// refinement 12 s, each also capped by the request deadline so a retry on the next key still fits.
export const BUDGET = { understand: 8_000, embed: 5_000, answer: 20_000, refine: 12_000 };
const post = (url: string, key: string, body: unknown, signal: AbortSignal) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal });
const textOf = async (r: Response) => { const j = await r.json(); return (j.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("") as string; };
async function embedQuery(q: string): Promise<number[]> {
  return withKey((k, sig) => post(`${G}/gemini-embedding-001:embedContent`, k, { content: { parts: [{ text: q }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }, sig), async r => (await r.json()).embedding.values, { timeoutMs: BUDGET.embed });
}
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };

/** Lexical retrieval, plus up to 4 semantically closest chunks when version-matched vectors exist. */
export async function retrieve(q: string): Promise<SearchResult & { mode: "lexical" | "hybrid" }> {
  const { chunks, employers, vectors } = retrieval();
  const res = search(chunks, q, { employerNames: employers });
  if (!vectors) return { ...res, mode: "lexical" };
  let qv: number[];
  try { qv = await embedQuery(q); } catch { return { ...res, mode: "lexical" }; }
  const have = new Set(res.hits.map((h) => h.chunk.id));
  const extra: Hit[] = chunks.filter((c) => !have.has(c.id)).map((c) => ({ chunk: c, score: cos(qv, vectors.vectors[c.id]) })).filter((h) => h.score > 0.6).sort((a, b) => b.score - a.score).slice(0, 4).map((h) => ({ ...h, score: 0 }));
  const hits = [...res.hits, ...extra];
  const records = [...res.records, ...extra.filter((h) => !res.records.some((r) => r.id === h.chunk.record_id)).map((h) => ({ id: h.chunk.record_id, score: 0 }))];
  return { ...res, hits, records, mode: "hybrid" };
}

/** Compact interpretation call for the understanding step (lib/understand.ts): JSON only, short timeout. */
export async function interpretModel(prompt: string, deadline?: number): Promise<string> {
  return withKey((k, sig) => post(`${G}/${MODEL}:generateContent`, k, { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600, temperature: 0, responseMimeType: "application/json" } }, sig),
    textOf, { timeoutMs: BUDGET.understand, deadline });
}
/** Hits for one record's own chunks (direct path when a visitor accepts an offer). */
export function recordHits(id: string): Hit[] {
  return retrieval().chunks.filter((c) => c.record_id === id).map((chunk) => ({ chunk, score: 1 }));
}

const contextOf = (hits: Hit[]) => {
  const byId = new Map(getMaster().records.map((r) => [r.id, r]));
  return hits.map((h, i) => `[${i + 1}] (record_id=${h.chunk.record_id}; title=${byId.get(h.chunk.record_id)?.title ?? h.chunk.record_id})\n${displayText(h.chunk.text)}`).join("\n\n");
};

/** First pass: the draft answer from records only, ending with an IDS line (system prompt: lib/refine.ts answerSystem). */
export async function answer(q: string, history: { role: string; text: string }[], hits: Hit[], interpreted?: string, opts: KeyOpts = {}) {
  const ctx = contextOf(hits);
  const contents = [...history.slice(-6).map(h => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text.slice(0, 1000) }] })), { role: "user", parts: [{ text: `Context:\n${ctx}\n\nQuestion: ${q}${interpreted ? `\n(Interpreted as: ${interpreted})` : ""}` }] }];
  return withKey((k, sig) => post(`${G}/${MODEL}:generateContent`, k, { systemInstruction: { parts: [{ text: answerSystem() }] }, contents, generationConfig: { maxOutputTokens: 700, temperature: 0.3 } }, sig),
    textOf, { timeoutMs: BUDGET.answer, ...opts });
}

/**
 * Refinement pass over the visitor-facing draft (IDS line already removed): same question, interpretation and hits
 * (no new retrieval). Never throws; on failure/timeout the cleaned draft comes back. Card ids are not touched here.
 */
export async function refine(q: string, hits: Hit[], draft: string, interpreted?: string, deadline?: number) {
  const left = deadline ? deadline - Date.now() : Infinity;
  const call = left < 3_000 ? undefined : (system: string, prompt: string) =>
    withKey((k, sig) => post(`${G}/${MODEL}:generateContent`, k, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 500, temperature: 0.2 } }, sig),
      textOf, { timeoutMs: BUDGET.refine, deadline, minMs: 3_000 });
  return refineAnswer({ question: q, interpreted, ctx: contextOf(hits), draft }, call);
}
