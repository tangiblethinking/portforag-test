// Understanding step + guided offers. Self-contained (no imports) so scripts/test-master.mjs can run it directly.
// The understanding step only INTERPRETS the visitor's message (intent, a rewritten search query, record ids it refers
// to); it never produces facts. Answers still come only from retrieved master records (lib/rag.ts).

export type UIntent = "identity" | "work" | "project" | "open" | "followup" | "resume" | "accept_offer" | "decline" | "other";
export type Understanding = { intent: UIntent; query: string; topics: string[]; record_id: string | null; source: "direct" | "model" | "fallback" };
export type Turn = { role: string; text: string };
/** Records the understanding step and offers may name: every enabled (indexable) record that can be a card, plus the
 * resume. `label`: a short, record-derived description (category, public address, what it is) so the understanding
 * step can tell records that share a title apart (e.g. a live site vs the resume vs a case study). */
export type OfferRec = { id: string; title: string; label?: string };

const INTENTS: UIntent[] = ["identity", "work", "project", "open", "followup", "resume", "other"];
/** Intents whose topics are records the visitor asked for by reference (they may be shown as cards; see pickCardIds). */
export const ASKS_FOR_RECORD: UIntent[] = ["project", "open"];
/** Search query used for identity/overview questions: steers retrieval to the resume summary, title and roles. */
export const IDENTITY_QUERY = "Resume of Christopher Kenreigh: who he is, his title, professional summary and experience";
export const OFFER_PREFIX = "Would you like to know about ";
const OFFER_RE = /Would you like to know about (.+?)\?\s*$/;
const YES_RE = /^\s*(y|yes|yeah|yea|yep|yup|sure|ok|okay|please|absolutely|definitely|of course|go ahead|sounds good|let'?s see|show me)(\s+(please|sure|thanks))?[\s!.]*$/i;
const NO_RE = /^\s*(n|no|nope|nah|no thanks|no thank you|not now|not really|maybe later|skip( it)?|pass)[\s!.,]*$/i;
const YES_NAMED_RE = /^\s*yes,?\s+show me\s+(.+?)[\s.!]*$/i;
const IDENTITY_RE = /^\s*(who('?s| is| are)\s+(he|him|this|that|it|you|christopher|kenreigh|christopher kenreigh|this guy|the (designer|owner|person))|what does he do|what do(es)? (he|christopher) do( for (work|a living))?|tell me about (him|christopher|christopher kenreigh|this guy|the designer)|introduce (him|christopher|yourself)|about him|who am i (talking|chatting) (to|with|about))\b/i;
const FOLLOWUP_RE = /^\s*(tell me more|more|go on|continue|keep going|what else|and( then)?|details|more details|elaborate|expand( on (that|this|it))?|why|how so|like what|such as)\b[\s?!.]*$/i;

export const offerLine = (title: string) => `${OFFER_PREFIX}${title}?`;
export const yesMessage = (title: string) => `Yes, show me ${title}.`;

// Several records can share a title (alternate builds); the FIRST record with a title in `recs` order is canonical for
// it, so an offered title and its Yes always resolve to the same record (see orderOfferRecs).
const byTitle = (recs: OfferRec[], t: string) => { const k = t.trim().toLowerCase(); return recs.find((r) => r.title.toLowerCase() === k) || null; };
const RANK: Record<string, number> = { Feature: 0, Supporting: 1 };
/** Orders offerable records so that, among records sharing a title, the Feature (then Supporting) build is canonical.
 * Only a tie-break among already-indexable records; it never adds a record. */
export function orderOfferRecs<T extends OfferRec & { recommendation?: string | null }>(recs: T[]): OfferRec[] {
  const groups = new Map<string, T[]>(); // title -> records, in order of the title's first appearance
  for (const r of recs) groups.set(r.title, [...(groups.get(r.title) || []), r]);
  const rank = (r: T) => RANK[r.recommendation || ""] ?? 2;
  return [...groups.values()].flatMap((g) => g.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => ({ id: r.id, title: r.title, ...(r.label ? { label: r.label } : {}) })));
}

/** The offer made in the most recent model turn (exact indexable title), or null. */
export function lastOffer(history: Turn[], recs: OfferRec[]): OfferRec | null {
  const last = [...history].reverse().find((h) => h.role !== "user");
  const m = last?.text.trim().match(OFFER_RE);
  return m ? byTitle(recs, m[1]) : null;
}
/** Every title offered so far in the visible conversation (used offers never come back). */
export function offeredTitles(history: Turn[]): string[] {
  return history.filter((h) => h.role !== "user").map((h) => h.text.trim().match(OFFER_RE)?.[1]).filter((x): x is string => !!x);
}

/** Deterministic resolution: named Yes chip, typed yes/no answering the last offer. No model call. */
export function resolveDirect(message: string, history: Turn[], recs: OfferRec[]): Understanding | null {
  const named = message.match(YES_NAMED_RE);
  if (named) {
    const r = byTitle(recs, named[1]);
    if (r && r.id !== "resume") return { intent: "accept_offer", query: r.title, topics: [r.id], record_id: r.id, source: "direct" };
  }
  const offer = lastOffer(history, recs);
  if (offer && YES_RE.test(message)) return { intent: "accept_offer", query: offer.title, topics: [offer.id], record_id: offer.id, source: "direct" };
  if (offer && NO_RE.test(message)) return { intent: "decline", query: "", topics: [], record_id: null, source: "direct" };
  return null;
}

/** Rule-based interpretation used when the model call fails (or is unavailable): the chat still responds. */
export function fallbackUnderstanding(message: string, history: Turn[]): Understanding {
  if (IDENTITY_RE.test(message)) return { intent: "identity", query: IDENTITY_QUERY, topics: [], record_id: null, source: "fallback" };
  if (FOLLOWUP_RE.test(message)) {
    const prev = [...history].reverse().find((h) => h.role === "user" && h.text.trim() !== message.trim());
    if (prev) return { intent: "followup", query: `${prev.text} ${message}`.trim(), topics: [], record_id: null, source: "fallback" };
  }
  return { intent: "other", query: message, topics: [], record_id: null, source: "fallback" };
}

export function understandPrompt(message: string, history: Turn[], recs: OfferRec[]): string {
  const conv = history.slice(-4).map((h) => `${h.role === "user" ? "visitor" : "assistant"}: ${h.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n") || "(none)";
  return [
    "You interpret a visitor's chat message to the portfolio assistant of Christopher Kenreigh, a product designer. You do NOT answer it.",
    'Return JSON only: {"intent": "identity"|"work"|"project"|"open"|"followup"|"resume"|"other", "query": string, "topics": string[]}.',
    "- intent: identity = who he is / what he does / overview of him; work = a kind of work or skill; project = a question about a specific project; open = the visitor wants to see, open, visit or pull up a specific site, page, project or document; followup = continues the previous turn (\"tell me more\", \"that\"); resume = his resume, roles, education; other = anything else.",
    '- query: a short search query in plain words with pronouns and shorthand resolved from the conversation ("he"/"him" = Christopher Kenreigh; "that"/"it" = what the previous turn was about). Only rephrase what was asked; add no facts.',
    "- topics: ids from the list below that the message (or the turn it follows up) refers to; [] if none. Never invent ids. For project/open, name the record(s) the visitor means, using the descriptions to tell records with the same title apart (prefer the one whose description matches what was asked).",
    "Records (id | title | description):",
    ...recs.map((r) => `${r.id} | ${r.title}${r.label ? ` | ${r.label}` : ""}`),
    "Conversation (most recent last):",
    conv,
    `Message: ${message}`,
  ].join("\n");
}

/** Validates the model's JSON; returns null when unusable (caller falls back). Topics are limited to known ids/titles. */
export function parseUnderstanding(raw: string, message: string, recs: OfferRec[]): Understanding | null {
  let j: any;
  try { j = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); } catch { return null; }
  if (!j || typeof j !== "object" || !INTENTS.includes(j.intent)) return null;
  const ids = new Set(recs.map((r) => r.id));
  const topics = [...new Set((Array.isArray(j.topics) ? j.topics : []).map((t: unknown) => (typeof t !== "string" ? null : ids.has(t) ? t : byTitle(recs, t)?.id ?? null)).filter((x: string | null): x is string => !!x))] as string[];
  const q = typeof j.query === "string" && j.query.trim() ? j.query.trim().slice(0, 300) : message;
  const intent = j.intent as UIntent;
  if (intent === "identity") return { intent, query: IDENTITY_QUERY, topics, record_id: null, source: "model" };
  if (intent === "followup") return { intent, query: q, topics, record_id: null, source: "model" };
  // keep the visitor's own words in the search; the rewrite adds the resolved references
  return { intent, query: q.toLowerCase() === message.toLowerCase() ? message : `${message} ${q}`, topics, record_id: null, source: "model" };
}

/** Understanding step: direct offer resolution, else the compact model call, else the rule-based fallback. */
export async function understand(message: string, history: Turn[], recs: OfferRec[], callModel?: (prompt: string) => Promise<string>): Promise<Understanding> {
  const direct = resolveDirect(message, history, recs);
  if (direct) return direct;
  const fb = fallbackUnderstanding(message, history);
  if (fb.intent === "identity") return fb; // unambiguous: no model call needed
  if (callModel) {
    try {
      const u = parseUnderstanding(await callModel(understandPrompt(message, history, recs)), message, recs);
      if (u) return u;
    } catch { /* fall back */ }
  }
  return fb;
}

/**
 * Guided offer: one related record to offer next. Candidates: supported records the answer cited/named that did not fit
 * in the cards, then this turn's in-context records that the question supports (hit order), then records related to the
 * answer's topic. Only enabled records with a known title (no record class is excluded); never the resume or a
 * restatement of it, a record shown in this answer's cards (or sharing a shown card's title, or restating one —
 * `restates`, the same rule the cards use), or anything offered before.
 */
export function pickOffer(opts: { preferred?: string[]; candidates: { id: string; supported: boolean }[]; related: string[]; cards: string[]; recs: OfferRec[]; exclude: string[]; restates?: (a: string, b: string) => boolean }): OfferRec | null {
  const rec = new Map(opts.recs.map((r) => [r.id, r]));
  const shownTitles = new Set(opts.cards.map((id) => rec.get(id)?.title.toLowerCase()).filter(Boolean));
  const ex = new Set(opts.exclude.map((s) => s.toLowerCase()));
  const re = opts.restates || (() => false);
  const ok = (id: string) => { const r = rec.get(id); return !!r && id !== "resume" && !re(id, "resume") && !opts.cards.includes(id) && !opts.cards.some((c) => re(id, c)) && !shownTitles.has(r.title.toLowerCase()) && !ex.has(r.title.toLowerCase()) && !ex.has(id.toLowerCase()); };
  // in-context records whose own evidence supports the question first, then records related to the answer's topic;
  // unsupported in-context records are never offered (weakly related)
  // preferred: supported records the answer itself cited or named but that did not fit in the cards
  const order = [...(opts.preferred || []), ...opts.candidates.filter((c) => c.supported).map((c) => c.id), ...opts.related];
  const id = order.find(ok);
  return id ? byTitle(opts.recs, rec.get(id)!.title) : null;
}
