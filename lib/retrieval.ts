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
/** `evidence`: the record's own substantive fields (named employer, description, keywords, functional keywords, skills) — the text a
 * card must match on its own; resume restatements in experience/why/note text do not qualify a card. */
/** `same`: the chunk's restatement group (see restatementGroups) — records that restate one another share it. */
export type Chunk = { id: string; record_id: string; part: string; text: string; group: string; evidence: string; same?: string };
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
  const groups = restatementGroups(records);
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
    const named = r.employer?.status === "named" && r.employer.employer ? r.employer.employer : "";
    const evidence = [named, r.description || "", r.keywords.join(", "), r.functional_keywords.map((k) => k.term).join(", "), r.skills.join(", ")].join("\n");
    out.push({ id: r.id, record_id: r.id, group: r.employer?.status || "unknown", part: "record", text: lines.filter(Boolean).join("\n"), evidence });
  }
  for (const c of out) c.same = groups.get(c.record_id) ?? c.record_id;
  return out;
}

/** Stable version of the chunk set (FNV-1a over ids + text); vectors are only valid for the same version. */
export function chunksVersion(chunks: Chunk[]): string {
  let h = 0x811c9dc5;
  const s = chunks.map((c) => `${c.id}\u0000${c.text}`).join("\u0001");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a-${chunks.length}-${h.toString(16)}`;
}

// Words too generic to show that a record is about the question on its own.
const GENERIC = new Set(tokenize("design designed designer ux ui product work worked project build built experience christopher kenreigh portfolio case study page site web app application system user"));

// Multi-word topic phrases built from GENERIC words ("design" + "system" …). Each word alone stays too generic, but the
// phrase is specific: a question naming the phrase can be supported by a record whose OWN evidence (description,
// keywords, functional keywords, skills, named employer) contains it. Variants that appear in the records are covered
// (design-system, design systems, design language system, DesignOps, design operations).
export const TOPIC_PHRASES: { key: string; re: RegExp }[] = [
  { key: "design system", re: /\bdesign[- ]?(?:language[- ])?systems?\b/i },
  { key: "design language", re: /\bdesign[- ]language\b/i },
  { key: "design ops", re: /\bdesign[- ]?op(?:eration)?s\b/i },
  { key: "design tokens", re: /\bdesign[- ]tokens?\b/i },
  { key: "design-to-code", re: /\bdesign[- ]to[- ]code\b/i },
];
const PHRASE = new Map(TOPIC_PHRASES.map((p) => [p.key, p.re]));

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
    // No record class is dropped or demoted here (e.g. by employer status): near-identical records are handled at
    // card/offer time by the restatement rule (restates / pickCardIds).
    return { chunk, score: s };
  });
  // Broad questions about the person: the resume parts that answer them are always in context (if enabled).
  const pinParts: Record<Intent, string[]> = { industries: ["summary", "experience"], employers: ["experience"], skills: ["skills", "summary"], capabilities: ["summary", "skills"], resume: ["summary", "experience", "skills", "education"], general: [] };
  const pinned = scored.filter((h) => h.chunk.record_id === "resume" && pinParts[intent].includes(h.chunk.part));
  const rest = scored.filter((h) => h.score > 0 && !pinned.includes(h)).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  // Diversity: at most `perRecord` chunks per restatement group (a record and its copies / restatements share the
  // slots, so near-identical records cannot crowd out distinct ones). The resume's own chunks are never limited, and
  // once the resume itself is in context its restatements add nothing, so they are left out (records the visitor
  // asks for by reference are added by the caller regardless; see app/api/chat/route.ts).
  const resumeIn = pinned.length > 0 || rest.some((h) => h.chunk.record_id === "resume");
  const per = new Map<string, number>();
  const hits: Hit[] = [];
  for (const h of pinned) hits.push(h);
  for (const h of rest) {
    if (hits.length >= k + pinned.length) break;
    if (h.chunk.record_id !== "resume") {
      const key = h.chunk.same ?? h.chunk.record_id;
      if (key === "resume" && resumeIn) continue;
      const c = per.get(key) || 0;
      if (c >= perRecord) continue;
      per.set(key, c + 1);
    }
    hits.push(h);
  }
  const best = new Map<string, number>();
  for (const h of hits) if (h.score > 0) best.set(h.chunk.record_id, Math.max(best.get(h.chunk.record_id) || 0, h.score));
  const inHits = new Set(hits.map((h) => h.chunk.record_id));
  const records = [...best].filter(([id]) => inHits.has(id)).map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // An explicit resume request ranks the resume record first.
  if (intent === "resume" && inHits.has("resume")) records.sort((a, b) => (a.id === "resume" ? -1 : b.id === "resume" ? 1 : 0));
  const terms = [...weights.keys()].filter((t) => !GENERIC.has(t));
  for (const p of TOPIC_PHRASES) if (p.re.test(query)) terms.push(p.key);
  return { intent, hits, records, terms };
}

/** Query terms (single words, or topic phrases from TOPIC_PHRASES) the record's own substantive evidence contains
 * (empty = the card is not supported on its own). */
export function cardSupport(result: SearchResult, recordId: string): string[] {
  const own = result.hits.filter((h) => h.chunk.record_id === recordId).map((h) => h.chunk.evidence);
  const ev = new Set(own.flatMap((e) => tokenize(e)));
  const raw = own.join("\n");
  return result.terms.filter((t) => { const re = PHRASE.get(t); return re ? re.test(raw) : ev.has(t); });
}

/** Titles (or their distinctive part after ":" / "—", 3+ words) of in-context records that the answer text names. */
export function mentionedIds(answer: string, result: SearchResult, titles: Map<string, string>): string[] {
  const a = answer.toLowerCase();
  const out: string[] = [];
  for (const id of new Set(result.hits.map((h) => h.chunk.record_id))) {
    const t = (titles.get(id) || "").toLowerCase();
    if (!t || id === "resume") continue;
    const tail = t.split(/\s*[:—|]\s*/).filter((x) => x.split(/\s+/).length >= 3);
    if (a.includes(t) || tail.some((x) => a.includes(x))) out.push(id);
  }
  return out;
}

/**
 * Card ids for an answer (general order for every question):
 *  - candidates: records the visitor asked for (`asked`: records the understanding step named for a specific project or
 *    a "show me / open this" request), then records the first answer cites (IDS line) or names by title;
 *  - each must be enabled and in this answer's context; an asked-for record needs nothing more, any other record's own
 *    evidence (named employer, description, keywords, skills) must contain a specific query term (cardSupport). No
 *    score-based fallback: an answer that cites no supported record shows no cards;
 *  - restatement rule: records in the same restatement group (restatementGroups; same title, near-copy description,
 *    or about the person like the resume) collapse to ONE card, chosen in priority order: asked-for > the resume >
 *    cited/named order. So a "who is he" answer shows the resume, not several near-identical site cards, while a record
 *    the visitor asked to open is shown even if it restates the resume;
 *  - project cards are ordered before the resume unless the question asks for the resume (includeResume); cap `max`.
 */
export function pickCardIds(cited: string[], result: SearchResult, enabled: Set<string>, opts: { max?: number; includeResume?: boolean; mentioned?: string[]; titles?: Map<string, string>; asked?: string[] } = {}): string[] {
  const max = opts.max ?? 4;
  const asked = new Set(opts.asked || []);
  const ctx = new Map<string, Chunk>();
  for (const h of result.hits) if (!ctx.has(h.chunk.record_id)) ctx.set(h.chunk.record_id, h.chunk);
  const supported = (id: string) => {
    if (!ctx.has(id) || !enabled.has(id)) return false;
    if (id === "resume" || asked.has(id)) return true;
    return cardSupport(result, id).length > 0;
  };
  const cands = [...new Set([...asked, ...cited, ...(opts.mentioned || [])])].filter(supported);
  const hasResume = cands.includes("resume") || (!!opts.includeResume && supported("resume"));
  const priority = [...cands.filter((id) => asked.has(id)), ...(hasResume ? ["resume"] : []), ...cands.filter((id) => !asked.has(id) && id !== "resume")];
  const groupOf = (id: string) => ctx.get(id)?.same ?? id;
  const seenGroup = new Set<string>(), seenTitle = new Set<string>();
  const kept: string[] = [];
  for (const id of priority) {
    const g = groupOf(id), t = (opts.titles?.get(id) ?? id).toLowerCase();
    if (seenGroup.has(g) || seenTitle.has(t)) continue;
    seenGroup.add(g); seenTitle.add(t); kept.push(id);
  }
  // Supported project cards come first; unless the question is about the resume, the resume is one card among them
  // (after the projects), not slot 1. It stays the only card when no project is supported (e.g. Freeport).
  const projects = kept.filter((id) => id !== "resume"), resume = kept.includes("resume") ? ["resume"] : [];
  return (opts.includeResume && !asked.size ? [...resume, ...projects] : [...projects, ...resume]).slice(0, max);
}

// ---- restatement rule (general: no record, record class or prompt word is special-cased) ----
const normT = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Jaccard overlap of two descriptions' word sets (0..1). */
export function descOverlap(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const x = new Set(tokenize(a)), y = new Set(tokenize(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / (x.size + y.size - n);
}
/** Descriptions at least this similar describe the same thing (copies / alternate builds of one site or app). */
export const NEAR_COPY = 0.8;
/** A record titled with the person's own name (its first title segment before "—", "|" or ":" is the resume's name)
 * is about the person, i.e. a restatement of the resume. */
export function aboutPerson(title: string | undefined, person: string | null | undefined): boolean {
  if (!title || !person) return false;
  return normT(title.split(/\s*[—|:]\s*/)[0] || "") === normT(person);
}
/**
 * Restatement groups over enabled records. Two records restate each other when
 *  1. they share a title (alternate builds), or
 *  2. their descriptions are near-copies (word overlap >= NEAR_COPY), or
 *  3. both are about the person: the resume itself, or a record titled with the person's name (aboutPerson);
 * and restatement is transitive (a near-copy of a restatement is a restatement). Returns record id -> group key
 * ("resume" for the resume's group, otherwise the group's first record in master order).
 */
export function restatementGroups(records: MasterRecordLite[]): Map<string, string> {
  const recs = records.filter((r) => r.indexable);
  const person = recs.find((r) => r.kind === "resume")?.resume?.name ?? null;
  const parent = recs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const isPerson = recs.map((r) => r.kind === "resume" || aboutPerson(r.title, person));
  for (let i = 0; i < recs.length; i++)
    for (let j = i + 1; j < recs.length; j++)
      if (normT(recs[i].title) === normT(recs[j].title) || (isPerson[i] && isPerson[j]) || descOverlap(recs[i].description, recs[j].description) >= NEAR_COPY) join(i, j);
  const resumeIdx = recs.findIndex((r) => r.kind === "resume");
  const out = new Map<string, string>();
  recs.forEach((r, i) => out.set(r.id, resumeIdx >= 0 && find(i) === find(resumeIdx) ? "resume" : recs[find(i)].id));
  return out;
}
/** Whether record a restates record b (same restatement group). */
export const restates = (groups: Map<string, string>, a: string, b: string) => a === b || (groups.has(a) && groups.get(a) === groups.get(b));
