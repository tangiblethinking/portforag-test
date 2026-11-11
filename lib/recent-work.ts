import catalog from "@/data/recent-work.json";

export type RecentWorkItem = {
  id: string;
  path: string;
  url: string;
  title: string;
  blurb: string;
  /** Explicit named link to a master record (and which of its captures to show); used by scripts/master-core.mjs. */
  link?: { record_id: string; image?: string; basis?: string };
};

export function getRecentWork(): RecentWorkItem[] {
  return catalog.items as RecentWorkItem[];
}
