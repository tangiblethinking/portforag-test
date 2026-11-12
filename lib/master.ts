// Server-side access to the canonical master (data/master.json, built by scripts/build-master.mjs).
// Cards and retrieval are both derived from these records; `indexable: false` records stay stored but are excluded.
import fs from "node:fs";
import path from "node:path";
import type { MasterRecordLite } from "@/lib/retrieval";
import type { ProjectCardData } from "@/lib/project-display";
import type { RecentWorkItem } from "@/lib/recent-work";

export type MasterImage = { src: string; file: string; alt: string; width: number; height: number; captured_url: string };
export type MasterRecord = MasterRecordLite & {
  image: MasterImage | null;
  images: MasterImage[];
  employer: { status: string; employer: string | null; position: string | null } | null;
  flags: string[];
  manual: Record<string, unknown>;
};
export type Master = {
  fallback_company: string;
  sources: Record<string, { path: string; sha256: string }>;
  aliases: { runtime_ids: Record<string, string>; urls: Record<string, string> };
  /** image: optional file name of the record capture an explicit link names (one of that record's images). */
  recent_work: { recent_id: string; url: string; record_id: string | null; image?: string }[];
  records: MasterRecord[];
};

let M: Master | null = null;
export function getMaster(): Master {
  if (!M) M = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/master.json"), "utf8")) as Master;
  return M;
}
export const enabledRecords = () => getMaster().records.filter((r) => r.indexable);
export const enabledIds = () => new Set(enabledRecords().map((r) => r.id));

/** Canonical id for a record id or a legacy runtime id (old project ids / recent-*), or null if unknown. */
export function resolveId(id: string): string | null {
  const m = getMaster();
  if (m.records.some((r) => r.id === id)) return id;
  return m.aliases.runtime_ids[id] ?? null;
}

const toCardImage = (im: MasterImage | null | undefined) => (im ? { src: im.src, alt: im.alt, width: im.width, height: im.height } : null);

export function recordToCard(r: MasterRecord): ProjectCardData {
  const named = r.employer?.status === "named" ? r.employer.employer : null;
  return {
    id: r.id,
    title: r.title,
    company: named || getMaster().fallback_company,
    date: r.dates?.display ?? null,
    summary: r.description,
    skills: r.skills,
    liveUrl: displayUrl(r),
    image: toCardImage(r.image),
  };
}

/** Every enabled record as a card (chat results resolve ids against this). */
export const enabledCards = () => enabledRecords().map(recordToCard);

export function resumeCard(): ProjectCardData | null {
  const r = getMaster().records.find((x) => x.id === "resume");
  return r ? recordToCard(r) : null;
}

/**
 * Recent Work list (data/recent-work.json order). Title and destination URL stay the list's own; company, date,
 * description, skills and image come from the matched master record (exact URL match, or an explicit named link
 * that may also name which of the record's captures to show). A matched record that is switched off
 * (indexable false) is removed from the list. Items with no master match (reported in master.unaccounted)
 * keep only the list's own title, URL and blurb.
 */
export function recentCards(items: RecentWorkItem[]): ProjectCardData[] {
  const m = getMaster();
  const byId = new Map(m.records.map((r) => [r.id, r]));
  const link = new Map(m.recent_work.map((x) => [x.recent_id, x]));
  const out: ProjectCardData[] = [];
  for (const it of items) {
    const x = link.get(it.id);
    const rec = x?.record_id ? byId.get(x.record_id) : undefined;
    if (rec && !rec.indexable) continue;
    const base: Omit<ProjectCardData, "id" | "title" | "liveUrl"> = rec ? recordToCard(rec) : { company: m.fallback_company, date: null, summary: it.blurb, skills: [], image: null };
    if (rec && x?.image) {
      const named = rec.images.find((im) => im.file === x.image);
      if (named) base.image = toCardImage(named);
    }
    out.push({ ...base, id: `recent-${it.id}`, title: it.title, liveUrl: (rec && routes().byRecord.get(rec.id)) || displayForUrl(it.url) });
  }
  return out;
}

// ---- display URLs from the uxapex.com router (data/appproto-vercel.json = AppProtoNeoRouter vercel.json snapshot) ----
// A deployment served by a concrete router rewrite (e.g. /ecomm -> director-case-study-ux-bgoals.vercel.app) is built
// for that subpath (its assets live under /ecomm/…), so it is shown at https://uxapex.com{path}: apex host, no www, no
// trailing slash. Only concrete rewrites count — the "/" and "/:path*" catch-all (this chat app) and wildcard or
// router-local destinations (/job -> /job.html) are ignored. Unrouted records keep their recorded live_url.
export const ROUTER_ORIGIN = "https://uxapex.com";
type Rewrite = { source: string; destination: string };
const normUrl = (u: string) => u.trim().replace(/^http:\/\//i, "https://").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const isRouterRoot = (u: string | null | undefined) => !!u && /^https:\/\/(www\.)?uxapex\.com$/.test(normUrl(u));
let RT: { byDest: Map<string, string>; byRecord: Map<string, string> } | null = null;
/** Concrete router rewrites: normalized destination -> display URL, and record id -> display URL. Records match a
 * rewrite by any of their recorded URLs (live_url, deployment links, URL aliases) equal to its destination, or by an
 * existing alias for the router path itself (www.uxapex.com/laws -> html-test). */
export function routes() {
  if (RT) return RT;
  const m = getMaster();
  const file = path.join(process.cwd(), "data/appproto-vercel.json");
  const rewrites: Rewrite[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).rewrites || [] : [];
  const urlsOf = new Map<string, string[]>();
  const add = (u: string | null | undefined, id: string) => { if (u) urlsOf.set(normUrl(u), [...(urlsOf.get(normUrl(u)) || []), id]); };
  for (const r of m.records) { add(r.deployment.live_url, r.id); for (const l of r.deployment.links) add(l.url, r.id); }
  for (const [u, id] of Object.entries(m.aliases.urls)) add(u, id);
  const routerRecord = new Set(m.records.filter((r) => isRouterRoot(r.deployment.live_url) || r.deployment.links.some((l) => isRouterRoot(l.url))).map((r) => r.id));
  const byDest = new Map<string, string>(), byRecord = new Map<string, string>();
  for (const rw of rewrites) {
    const src = (rw.source || "").replace(/\/+$/, "");
    if (!src || /[:*()]/.test(src) || !/^https?:\/\//i.test(rw.destination || "") || /[:*]/.test(rw.destination.replace(/^https?:\/\//i, ""))) continue;
    const display = ROUTER_ORIGIN + src, dest = normUrl(rw.destination);
    if (isRouterRoot(dest) || byDest.has(dest)) continue;
    byDest.set(dest, display);
    const ids = new Set([...(urlsOf.get(dest) || []), ...(urlsOf.get(normUrl(display)) || []), ...(urlsOf.get(normUrl(`https://www.uxapex.com${src}`)) || [])]);
    for (const id of ids) if (!routerRecord.has(id) && !byRecord.has(id)) byRecord.set(id, display);
  }
  return (RT = { byDest, byRecord });
}
/** The URL a record is shown and cited at: its uxapex.com router path when routed, else its recorded live_url. */
export function displayUrl(r: MasterRecord): string | null {
  return routes().byRecord.get(r.id) || r.deployment.live_url || null;
}
/** Display form of one recorded URL: the router path when it is a routed destination (or an alias of a routed record),
 * else the URL unchanged. Never invents a URL. */
export function displayForUrl(u: string): string {
  const n = normUrl(u), rt = routes();
  if (rt.byDest.has(n)) return rt.byDest.get(n)!;
  const id = getMaster().aliases.urls[u] ?? Object.entries(getMaster().aliases.urls).find(([k]) => normUrl(k) === n)?.[1];
  return (id && rt.byRecord.get(id)) || u;
}
/** Rewrites routed deployment URLs inside model context text to their display URL (stored master text is unchanged). */
export function displayText(text: string): string {
  return text.replace(/https?:\/\/[^\s;,()<>"']+/g, (raw) => { const u = raw.replace(/[.:]+$/, ""); return displayForUrl(u) + raw.slice(u.length); });
}
/** Public address of a record (understand labels): its display URL; null if no URL is recorded. */
export function publicUrl(r: MasterRecord): string | null {
  return displayUrl(r);
}
/** Short distinguishing label for the understanding step's catalog, built only from the record's own fields:
 * category (family), public address, and the start of its description. */
export function recordLabel(r: MasterRecord): string {
  if (r.kind === "resume") return "his resume: roles, experience, skills and education";
  const url = publicUrl(r)?.replace(/^https?:\/\/(www\.)?/, "");
  const d = (r.description || "").replace(/\s+/g, " ").trim();
  const desc = d.length > 110 ? `${d.slice(0, 110).replace(/\s+\S*$/, "")}…` : d;
  return [r.family, url ? `live at ${url}` : null, desc || null].filter(Boolean).join("; ");
}

/** Where the traditional portfolio is served (the uxapex.com /portfolio route); the record's own live_url is unchanged. */
export const PORTFOLIO_URL = "https://uxapex.com/portfolio";
export const PORTFOLIO_CARD_ID = "traditional-portfolio";
/** The master record behind the traditional-portfolio card. */
export const PORTFOLIO_RECORD_ID = "portfoprod";
/**
 * The traditional-portfolio card for the header "Portfolio" item, the chat's failure fallback, and any chat answer
 * whose cards include the `portfoprod` record (displayCardIds): title, summary, company, date, skills and capture
 * from that record; only the display URL is the uxapex.com route. It opens the dedicated PortfolioSheet.
 */
export function portfolioCard(): ProjectCardData | null {
  const r = getMaster().records.find((x) => x.id === PORTFOLIO_RECORD_ID);
  return r ? { ...recordToCard(r), id: PORTFOLIO_CARD_ID, liveUrl: PORTFOLIO_URL } : null;
}

/** Chat card ids -> display ids: a record that has a dedicated display card (the traditional portfolio) is shown as
 * that card; every other id is unchanged. Display mapping only — selection happens in pickCardIds. */
export function displayCardIds(ids: string[]): string[] {
  return ids.map((id) => (id === PORTFOLIO_RECORD_ID && portfolioCard() ? PORTFOLIO_CARD_ID : id));
}
