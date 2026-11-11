import { retrieve, answer } from "@/lib/rag";
import { pickCardIds } from "@/lib/retrieval";
import { enabledIds, resolveId } from "@/lib/master";
import { NoKeyError } from "@/lib/keys";
import { FOLLOWUPS, LOADING, intent } from "@/lib/config";
export const runtime = "nodejs";
export const maxDuration = 30;
const hits = new Map<string, number[]>(); // per-instance rate limit
function limited(ip: string) { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 60_000); a.push(now); hits.set(ip, a); return a.length > 12; }
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "x";
  if (limited(ip)) return Response.json({ error: "rate_limited", message: "Easy there — try again in a minute." }, { status: 429 });
  let body: any; try { body = await req.json(); } catch { body = null; }
  const q = typeof body?.message === "string" ? body.message.trim() : "";
  if (!q || q.length > 500) return Response.json({ error: "bad_request", message: "Please ask a question under 500 characters." }, { status: 400 });
  const history = Array.isArray(body.history) ? body.history.filter((h: any) => typeof h?.text === "string").slice(-6) : [];
  const it = intent(q);
  try {
    const found = await retrieve(q);
    let text = await answer(q, history, found.hits);
    const m = text.match(/IDS:\s*(.*)\s*$/i);
    text = text.replace(/IDS:.*$/is, "").trim();
    // Cited ids are resolved to canonical master ids and kept only if enabled AND in this answer's context.
    const cited = (m?.[1] || "").split(",").map(s => resolveId(s.trim())).filter((x): x is string => !!x);
    const ids = pickCardIds(cited, found, enabledIds(), { includeResume: it === "resume" });
    return Response.json({ answer: text, project_ids: ids, sources: [...new Set(found.hits.map(h => h.chunk.record_id))], retrieval: found.mode, suggestions: FOLLOWUPS[it] || FOLLOWUPS.default, loading: LOADING[it] });
  } catch (e) {
    if (e instanceof NoKeyError) return Response.json({ error: "all_keys_busy", message: "I’m catching my breath — the AI is busy right now. Try a suggestion below or open the resume." }, { status: 503 });
    console.error(e);
    return Response.json({ error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
