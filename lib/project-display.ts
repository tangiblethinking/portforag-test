import display from "@/data/project-display.json";
import type { Project } from "@/lib/rag";

/** Display-only fields for a project card and its details sheet (see scripts/build-project-display.mjs). */
export type ProjectImage = { src: string; alt: string; width: number; height: number };
export type ProjectCardData = {
  id: string;
  title: string;
  company: string;
  date: string | null;
  summary: string | null;
  skills: string[];
  liveUrl: string | null;
  image: ProjectImage | null;
};

type DisplayEntry = Omit<ProjectCardData, "id" | "title"> & { companyKnown: boolean; evidenceRepo: string | null };
const entries = (display as { projects: Record<string, DisplayEntry> }).projects;
export const FALLBACK_COMPANY = (display as { fallback_company: string }).fallback_company;

export function toProjectCard(p: Project): ProjectCardData {
  const d = entries[p.id];
  return {
    id: p.id,
    title: p.title,
    company: d?.company || p.company || FALLBACK_COMPANY,
    date: d ? d.date : p.period_display || null,
    summary: d ? d.summary : null,
    skills: d?.skills?.length ? d.skills : p.skills || [],
    liveUrl: d ? d.liveUrl : p.live_url || p.figma_url || null,
    image: d?.image || null,
  };
}
