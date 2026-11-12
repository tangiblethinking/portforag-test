import { retrieve, answer, interpretModel, recordHits } from "@/lib/rag";
import { cardSupport, mentionedIds, pickCardIds, type Hit, type SearchResult } from "@/lib/retrieval";
import { enabledIds, enabledRecords, getMaster, resolveId } from "@/lib/master";
import { understand, offeredTitles, orderOfferRecs, pickOffer, offerLine, yesMessage, type OfferRec, type Understanding } from "@/lib/understand";
import { NoKeyError } from "@/lib/keys";
import { FOLLOWUPS, LOADING, intent, type Chip } from "@/lib/config";
export const runtime = "nodejs";
export const maxDuration = 30;
const hits = new Map<string, number[]>(); // per-instance rate limit
function limited(ip: string) { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 60_000); a.push(now); hits.set(ip, a); return a.length > 12; }

/** Records the understanding step and offers may name: enabled (indexable) records, never portfolio-site records. */
function offerRecs(): OfferRec[] {
  return orderOfferRecs(enabledRecords().filter((r) => r.kind === "resume" || r.employer?.status !== "portfolio").map((r) => ({ id: r.id, title: r.title, recommendation: r.recommendation })));
}
/** Records related to a topic record: same family, in master order (enabled, non-portfolio only via offerRecs). */
function relatedTo(ids: string[]): string[] {
  const recs = getMaster().records;
  const fams = new Set(ids.map((id) => recs.find((r) => r.id === id)?.family).filter(Boolean));
  return recs.filter((r) => r.indexable && fams.has(r.family) && !ids.includes(r.id)).map((r) => r.id);
}
/** Identity questions: records from the resume's current employer (named-employer evidence only). */
function currentWork(): string[] {
  const m = getMaster();
  const co = m.records.find((r) => r.id === "resume")?.resume?.roles?.[0]?.company?.toLowerCase();
  return co ? m.records.filter((r) => r.indexable && r.employer?.status === "named" && r.employer.employer?.toLowerCase() === co).map((r) => r.id) : [];
}
const chips = (list: string[]): Chip[] => list.map((s) => ({ label: s, message: s }));
const chipKey = (u: Understanding, q: string, title?: string) => (u.intent === "identity" ? "who" : u.intent === "resume" ? "resume" : intent(title || u.query || q));

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "x";
  if (limited(ip)) return Response.json({ error: "rate_limited", message: "Easy there — try again in a minute." }, { status: 429 });
  let body: any; try { body = await req.json(); } catch { body = null; }
  const q = typeof body?.message === "string" ? body.message.trim() : "";
  if (!q || q.length > 500) return Response.json({ error: "bad_request", message: "Please ask a question under 500 characters." }, { status: 400 });
  const history = Array.isArray(body.history) ? body.history.filter((h: any) => typeof h?.text === "string").slice(-6) : [];
  // titles already offered in this conversation (client keeps the full list; history covers the visible turns)
  const clientOffered: string[] = Array.isArray(body.offered) ? body.offered.filter((s: any) => typeof s === "string" && s.length <= 200).slice(0, 50) : [];
  try {
    const recs = offerRecs();
    const titleOf = new Map(recs.map((r) => [r.id, r.title]));
    // 1. Understanding step: interpret the message with recent turns (intent, rewritten query, record ids). No facts.
    const u = await understand(q, history, recs, interpretModel);
    const exclude = [...offeredTitles(history), ...clientOffered];
    const understanding = { intent: u.intent, query: u.query, topics: u.topics, source: u.source };
    if (u.intent === "decline") {
      return Response.json({ answer: "No problem. What else would you like to know?", project_ids: [], sources: [], retrieval: "none", understanding, offer: null, suggestions: chips(FOLLOWUPS.default), loading: LOADING.default });
    }
    let text: string, ids: string[], sources: string[], mode: string, candidates: { id: string; supported: boolean }[] = [], related: string[], preferred: string[] = [];
    if (u.intent === "accept_offer" && u.record_id && titleOf.has(u.record_id)) {
      // 2a. Accepted offer: direct path — the record's own chunks and its card, no new search that could miss.
      const id = u.record_id, title = titleOf.get(id)!;
      const own = recordHits(id);
      text = (await answer(`Tell me about ${title}.`, history, own)).replace(/IDS:.*$/is, "").trim();
      ids = enabledIds().has(id) ? [id] : [];
      sources = [id];
      mode = "direct";
      related = relatedTo([id]);
    } else {
      // 2b. Retrieval on the rewritten query (+ records the message refers to), then the answer from records only.
      const base = await retrieve(u.query);
      const have = new Set(base.hits.map((h) => h.chunk.record_id));
      const extra: Hit[] = u.topics.filter((id) => id !== "resume" && !have.has(id)).flatMap((id) => recordHits(id).map((h) => ({ ...h, score: 0 })));
      const found: SearchResult = { ...base, hits: [...base.hits, ...extra] };
      const raw = await answer(q, history, found.hits, u.query !== q ? u.query : undefined);
      const m = raw.match(/IDS:\s*(.*)\s*$/i);
      text = raw.replace(/IDS:.*$/is, "").trim();
      // Cited ids are resolved to canonical master ids and kept only if enabled AND in this answer's context.
      const cited = (m?.[1] || "").split(",").map(s => resolveId(s.replace(/[*`\[\]]/g, "").trim())).filter((x): x is string => !!x);
      const titles = new Map(getMaster().records.map((r) => [r.id, r.title]));
      const mentioned = mentionedIds(text, found, titles);
      ids = pickCardIds(cited, found, enabledIds(), { includeResume: intent(q) === "resume" || u.intent === "identity" || u.intent === "resume", mentioned, titles, max: 3 }); // the chat shows at most 3 cards
      preferred = pickCardIds(cited, found, enabledIds(), { mentioned, titles, max: 20 }).filter((id) => !ids.includes(id));
      sources = [...new Set(found.hits.map(h => h.chunk.record_id))];
      mode = base.mode;
      // identity questions search the resume wording ("resume", "title" …), which says nothing about which project to
      // offer: offer current-employer work instead of keyword matches
      candidates = u.intent === "identity" ? [] : sources.filter((id) => id !== "resume").map((id) => ({ id, supported: cardSupport(found, id).length > 0 }));
      const firstProject = ids.find((id) => id !== "resume");
      related = u.intent === "identity" ? currentWork() : relatedTo(firstProject ? [firstProject] : u.topics);
    }
    // 3. Guided offer: one related, indexable, not-shown, not-yet-offered record by its exact title.
    const offer = pickOffer({ preferred, candidates, related, cards: ids, recs, exclude });
    if (offer) text = `${text}\n\n${offerLine(offer.title)}`;
    const key = chipKey(u, q, u.intent === "accept_offer" ? titleOf.get(u.record_id || "") : undefined);
    const suggestions: Chip[] = [...(offer ? [{ label: "Yes", message: yesMessage(offer.title) }] : []), ...chips(FOLLOWUPS[key] || FOLLOWUPS.default)];
    return Response.json({ answer: text, project_ids: ids, sources, retrieval: mode, understanding, offer: offer ? { record_id: offer.id, title: offer.title } : null, suggestions, loading: LOADING[key] });
  } catch (e) {
    if (e instanceof NoKeyError) return Response.json({ error: "all_keys_busy", message: "I’m catching my breath — the AI is busy right now. Try a suggestion below or open the resume." }, { status: 503 });
    console.error(e);
    return Response.json({ error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
