// Deterministic hybrid-ready retrieval over the canonical master (data/master.json).
// Self-contained (no imports) so Node's type stripping can run it in scripts/test-master.mjs.
// Lexical BM25 over chunks generated from enabled (indexable) records only; optional vectors are combined by
// lib/rag.ts only when data/vectors.json was built from exactly these chunks (see chunksVersion).

export type MasterEmployer = { status: string; employer: string | null; position: string | null } | null;
export type MasterRole = { title: string | null; company: string | null; dates: string | null; bullets: string[] };
export type MasterRecordLite = {
  id: string;
  kind: "repository" | "resume";
  indexable: boolean;
  recommendation: string | null;
  title: string;
  description: string | null;
  functional_keywords: { term: string }[];
  keywords: string[];
  skills: string[];
  contribution_note: string;
  employer: MasterEmployer;
  experience_evidence: string;
  dates: { display: string } | null;
  family: string | null;
  why: string;
  note: string;
  repository: { name: string } | null;
  deployment: { live_url: string | null; links: { url: string; title: string | null }[] };
  resume?: { name: string | null; title_line: string | null; summary: string; roles: MasterRole[]; skills_paragraphs: string[]; education: string };
};
/** `evidence`: the record's own substantive fields (description, keywords, functional keywords, skills) — the text a
 * card must match on its own; resume restatements in experience/why/note text do not qualify a card. */
export type Chunk = { id: string; record_id: string; part: string; text: string; group: string; evidence: string };
export type Hit = { chunk: Chunk; score: number };
export type Intent = "industries" | "employers" | "skills" | "capabilities" | "resume" | "general";

const STOP = new Set("a an and are as at be been by can did do does for from had has have he her his how i in into is it its me of on or our over show tell than that the their them there these they this to was were what when where which who whom why will with would you your about any all also more most some such via used using".split(" "));

export function tokenize(s: string): string[] {
  const t = s.toLowerCase()
    .replace(/e-?commerce/g, "ecommerce").replace(/k-12/g, "k12").replace(/self-storage/g, "selfstorage")
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9+#]+/);
  const out: string[] = [];
  for (let w of t) {
    if (w.length < 2 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

function employerLine(r: MasterRecordLite): string {
  const e = r.employer;
  if (!e) return "Employer: not recorded.";
  if (e.status === "named" && e.employer) return `Employer: ${e.employer}${e.position ? `; position: ${e.position}` : ""}.`;
  return `Employer: not confirmed (evidence status: ${e.status}) — do not attribute this project to any employer.`;
}

/** Chunks for enabled records only. Repository records stay whole (no truncation); the resume is split by section/role. */
export function buildChunks(records: MasterRecordLite[]): Chunk[] {
  const out: Chunk[] = [];
  for (const r of records) {
    if (!r.indexable) continue;
    if (r.kind === "resume" && r.resume) {
      const R = r.resume;
      const head = `Resume of ${R.name ?? "the portfolio owner"} — ${R.title_line ?? ""}.`;
      out.push({ id: `${r.id}#summary`, record_id: r.id, group: "resume", part: "summary", text: `${head}\nSummary: ${R.summary}`, evidence: R.summary });
      R.roles.forEach((x, i) => out.push({ id: `${r.id}#role-${i + 1}`, record_id: r.id, group: "resume", part: "experience", text: `${head}\nExperience: ${x.title}, ${x.company} (${x.dates}). ${x.bullets.join(" ")}`, evidence: x.bullets.join(" ") }));
      out.push({ id: `${r.id}#skills`, record_id: r.id, group: "resume", part: "skills", text: `${head}\nSkills: ${R.skills_paragraphs.join(" ")}`, evidence: R.skills_paragraphs.join(" ") });
      out.push({ id: `${r.id}#education`, record_id: r.id, group: "resume", part: "education", text: `${head}\nEducation: ${R.education}`, evidence: R.education });
      continue;
    }
    const lines = [
      `Project: ${r.title}${r.repository ? ` (repository ${r.repository.name})` : ""}. ${employerLine(r)}${r.dates ? ` Dates: ${r.dates.display}.` : ""}${r.family ? ` Category: ${r.family}.` : ""}${r.recommendation ? ` Recommendation: ${r.recommendation}.` : ""}`,
      r.description ? `Description: ${r.description}` : "",
      r.functional_keywords.length ? `Functional keywords: ${r.functional_keywords.map((k) => k.term).join(", ")}.` : "",
      r.keywords.length ? `Keywords: ${r.keywords.join(", ")}.` : "",
      r.skills.length ? `Skills shown: ${r.skills.join(", ")}.` : "",
      r.contribution_note ? `Contribution: ${r.contribution_note}` : "",
      r.experience_evidence ? `Experience evidence: ${r.experience_evidence}` : "",
      r.why ? `Why: ${r.why}` : "",
      r.note ? `Note: ${r.note}` : "",
      r.deployment.links.length ? `Deployments: ${r.deployment.links.map((l) => `${l.url}${l.title ? ` (${l.title})` : ""}`).join("; ")}.` : "",
    ];
    const evidence = [r.description || "", r.keywords.join(", "), r.functional_keywords.map((k) => k.term).join(", "), r.skills.join(", ")].join("\n");
    out.push({ id: r.id, record_id: r.id, group: r.employer?.status || "unknown", part: "record", text: lines.filter(Boolean).join("\n"), evidence });
  }
  return out;
}

/** Stable version of the chunk set (FNV-1a over ids + text); vectors are only valid for the same version. */
export function chunksVersion(chunks: Chunk[]): string {
  let h = 0x811c9dc5;
  const s = chunks.map((c) => `${c.id}\u0000${c.text}`).join("\u0001");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a-${chunks.length}-${h.toString(16)}`;
}

const PORTFOLIO_WEIGHT = 0.6, PORTFOLIO_CAP = 2;
// Words too generic to show that a record is about the question on its own.
const GENERIC = new Set(tokenize("design designed designer ux ui product work worked project build built experience christopher kenreigh portfolio case study page site web app application system user"));

// Query vocabulary for broad questions. These terms only steer retrieval; answers must still come from context.
const INDUSTRY_TERMS = "industry industrial ecommerce commerce retail checkout cart b2b saas enterprise mining operational edtech education educational k12 lms learning curriculum school selfstorage storage kiosk legal compliance healthcare wellness nutrition supplement finance recruiting hiring hr manufacturing automation".split(" ");
const SKILL_TERMS = "skill design system token figma react typescript next tailwind accessibility wcag research prototyping information architecture ai rag prompt".split(" ");
const CAPABILITY_TERMS = "leadership strategy research prototyping system pipeline dashboard simulation integration collaboration automation governance".split(" ");

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/\bindustr|\bsector|\bverticals?\b|\bdomains?\b|\bmarkets?\b/.test(s)) return "industries";
  if (/\bemployer|\bcompan(y|ies)|worked (for|at)|where (has|did|does) he work|\bclients?\b|\borgani[sz]ations?\b/.test(s)) return "employers";
  if (/\bskill|\btools?\b|\bstack\b|\btechnolog|\bproficien|\bexpertise\b/.test(s)) return "skills";
  if (/\bcapabilit|\bcan he\b|\bgood at\b|\bstrengths?\b|\bexperience (with|in)\b/.test(s)) return "capabilities";
  if (/\bresume\b|\bcv\b|\beducation\b|\bdegree\b|\bcertif/.test(s)) return "resume";
  return "general";
}

export type SearchOptions = { k?: number; perRecord?: number; employerNames?: string[] };
export type SearchResult = { intent: Intent; hits: Hit[]; records: { id: string; score: number }[]; terms: string[] };

/** BM25 (k1 1.2, b 0.75) with intent expansion, resume pinning for broad questions and per-record diversity. */
export function search(chunks: Chunk[], query: string, opts: SearchOptions = {}): SearchResult {
  const k = opts.k ?? 12, perRecord = opts.perRecord ?? 2;
  const intent = detectIntent(query);
  const docs = chunks.map((c) => tokenize(c.text));
  const N = docs.length || 1;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const weights = new Map<string, number>();
  for (const t of tokenize(query)) weights.set(t, 1);
  const expand = (terms: string[], w: number) => { for (const t of terms.flatMap(tokenize)) if (!weights.has(t)) weights.set(t, w); };
  if (intent === "industries") expand(INDUSTRY_TERMS, 0.5);
  if (intent === "employers") expand(opts.employerNames || [], 0.6);
  if (intent === "skills") expand(SKILL_TERMS, 0.35);
  if (intent === "capabilities") expand(CAPABILITY_TERMS, 0.35);
  const scored: Hit[] = chunks.map((chunk, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const [t, w] of weights) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += w * idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * d.length) / avg)));
    }
    // Portfolio-site records restate the resume across many near-identical repos: demote and cap them so they do
    // not crowd out the resume itself and the project work it describes.
    return { chunk, score: chunk.group === "portfolio" ? s * PORTFOLIO_WEIGHT : s };
  });
  // Broad questions about the person: the resume parts that answer them are always in context (if enabled).
  const pinParts: Record<Intent, string[]> = { industries: ["summary", "experience"], employers: ["experience"], skills: ["skills", "summary"], capabilities: ["summary", "skills"], resume: ["summary", "experience", "skills", "education"], general: [] };
  const pinned = scored.filter((h) => h.chunk.record_id === "resume" && pinParts[intent].includes(h.chunk.part));
  const rest = scored.filter((h) => h.score > 0 && !pinned.includes(h)).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  const per = new Map<string, number>();
  let portfolio = 0;
  const hits: Hit[] = [];
  for (const h of pinned) hits.push(h);
  for (const h of rest) {
    if (hits.length >= k + pinned.length) break;
    const c = per.get(h.chunk.record_id) || 0;
    if (h.chunk.record_id !== "resume" && c >= perRecord) continue;
    if (h.chunk.group === "portfolio" && portfolio >= PORTFOLIO_CAP) continue;
    if (h.chunk.group === "portfolio") portfolio++;
    per.set(h.chunk.record_id, c + 1);
    hits.push(h);
  }
  const best = new Map<string, number>();
  for (const h of hits) if (h.score > 0) best.set(h.chunk.record_id, Math.max(best.get(h.chunk.record_id) || 0, h.score));
  const inHits = new Set(hits.map((h) => h.chunk.record_id));
  const records = [...best].filter(([id]) => inHits.has(id)).map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // An explicit resume request ranks the resume record first.
  if (intent === "resume" && inHits.has("resume")) records.sort((a, b) => (a.id === "resume" ? -1 : b.id === "resume" ? 1 : 0));
  const terms = [...weights.keys()].filter((t) => !GENERIC.has(t));
  return { intent, hits, records, terms };
}

/** Query terms the record's own substantive evidence contains (empty = the card is not supported on its own). */
export function cardSupport(result: SearchResult, recordId: string): string[] {
  const ev = new Set(result.hits.filter((h) => h.chunk.record_id === recordId).flatMap((h) => tokenize(h.chunk.evidence)));
  return result.terms.filter((t) => ev.has(t));
}

/**
 * Card ids for an answer. A project card must be enabled, in this answer's context, not a portfolio-site record (those
 * restate the resume), and its own substantive evidence must contain a specific query term. The model's cited ids
 * are used first (still subject to these checks); otherwise the best-scoring supported projects. No forced count.
 */
export function pickCardIds(cited: string[], result: SearchResult, enabled: Set<string>, opts: { max?: number; ratio?: number; includeResume?: boolean } = {}): string[] {
  const max = opts.max ?? 4, ratio = opts.ratio ?? 0.55;
  const ctx = new Map<string, Chunk>();
  for (const h of result.hits) if (!ctx.has(h.chunk.record_id)) ctx.set(h.chunk.record_id, h.chunk);
  const supported = (id: string) => {
    const c = ctx.get(id);
    if (!c || !enabled.has(id)) return false;
    if (id === "resume") return true;
    return c.group !== "portfolio" && cardSupport(result, id).length > 0;
  };
  let picked = [...new Set(cited)].filter(supported);
  if (!picked.some((id) => id !== "resume")) {
    const projects = result.records.filter((r) => r.id !== "resume" && supported(r.id));
    const top = projects[0]?.score || 0;
    const extra = top > 0 ? projects.filter((r) => r.score >= top * ratio).map((r) => r.id) : [];
    picked = [...picked, ...extra];
  }
  if (opts.includeResume && supported("resume") && !picked.includes("resume")) picked.unshift("resume");
  return [...new Set(picked)].slice(0, max);
}
