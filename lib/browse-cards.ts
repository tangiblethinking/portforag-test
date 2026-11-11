import type { ProjectCardData } from "@/lib/project-display";

/**
 * Browse and Explore cards (Resume, Recent Work, About) in the approved project-card format.
 * - Resume: the master resume record (data/master.json id "resume", from the supplied public/resume.html) — the same
 *   record chat results use.
 * - Recent Work: existing Browse text; skills are the union of the matched Recent Work records' skills; image is the
 *   first Recent Work item's captured landing image (interview-eight-pi.vercel.app).
 * - About: existing Browse text; skills are the focus areas named in the About text. No sourced image exists.
 */
const TEXT = {
  recent: "Live deployments from the AppProto router — case studies, prototypes, and experiments.",
  about: "Who Christopher is, how he works, and what to ask next.",
};
const ABOUT_SKILLS = ["Design systems", "Design-to-code pipelines", "Data-heavy dashboards", "AI-native (RAG) workflows"];

export function getBrowseCards(resume: ProjectCardData | null, recent: ProjectCardData[], fallbackCompany: string): ProjectCardData[] {
  const base = { company: fallbackCompany, date: null, liveUrl: null };
  const cards: ProjectCardData[] = [];
  if (resume) cards.push(resume);
  cards.push({ ...base, id: "recent", title: "Recent Work", summary: TEXT.recent, skills: [...new Set(recent.flatMap((r) => r.skills))], image: recent.find((r) => r.image)?.image ?? null });
  cards.push({ ...base, id: "about", title: "About", summary: TEXT.about, skills: ABOUT_SKILLS, image: null });
  return cards;
}
