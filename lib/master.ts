// Server-side access to the canonical master (data/master.json, built by scripts/build-master.mjs).
// Cards and retrieval are both derived from these records; `indexable: false` records stay stored but are excluded.
import fs from "node:fs";
import path from "node:path";
import type { MasterRecordLite } from "@/lib/retrieval";
import type { ProjectCardData } from "@/lib/project-display";
import type { RecentWorkItem } from "@/lib/recent-work";

export type MasterImage = { src: string; alt: string; width: number; height: number; captured_url: string };
export type MasterRecord = MasterRecordLite & {
  image: MasterImage | null;
  employer: { status: string; employer: string | null; position: string | null } | null;
  flags: string[];
  manual: Record<string, unknown>;
};
export type Master = {
  fallback_company: string;
  sources: Record<string, { path: string; sha256: string }>;
  aliases: { runtime_ids: Record<string, string>; urls: Record<string, string> };
  recent_work: { recent_id: string; url: string; record_id: string | null }[];
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

export function recordToCard(r: MasterRecord): ProjectCardData {
  const named = r.employer?.status === "named" ? r.employer.employer : null;
  return {
    id: r.id,
    title: r.title,
    company: named || getMaster().fallback_company,
    date: r.dates?.display ?? null,
    summary: r.description,
    skills: r.skills,
    liveUrl: r.deployment.live_url,
    image: r.image ? { src: r.image.src, alt: r.image.alt, width: r.image.width, height: r.image.height } : null,
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
 * description, skills and image come from the matched master record. Items with no enabled match keep only the
 * list's own title, URL and blurb.
 */
export function recentCards(items: RecentWorkItem[]): ProjectCardData[] {
  const m = getMaster();
  const byId = new Map(m.records.filter((r) => r.indexable).map((r) => [r.id, r]));
  const link = new Map(m.recent_work.map((x) => [x.recent_id, x.record_id]));
  return items.map((it) => {
    const rec = byId.get(link.get(it.id) ?? "");
    const base = rec ? recordToCard(rec) : { company: m.fallback_company, date: null, summary: it.blurb, skills: [], image: null };
    return { ...base, id: `recent-${it.id}`, title: it.title, liveUrl: it.url };
  });
}
