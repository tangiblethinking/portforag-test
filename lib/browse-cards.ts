import type { ProjectCardData } from "@/lib/project-display";

/**
 * Browse and Explore cards (Resume, Recent Work, About) in the approved project-card format.
 * - Resume: the master resume record (data/master.json id "resume", from the supplied public/resume.html) — the same
 *   record chat results use.
 * - Recent Work: existing Browse text; skills are the union of the matched Recent Work records' skills. Image: the
 *   supplied hub photo (public/browse/recent-work--portrait.webp, 1000x558; source 1280x720 scaled, 5 px bottom trim).
 * - About: existing Browse text; skills are the focus areas named in the About text. Image: the supplied portrait
 *   (public/browse/about--portrait.webp, 1000x558 on white, whole head in frame).
 */
const TEXT = {
  recent: "Live deployments from the AppProto router — case studies, prototypes, and experiments.",
  about: "Principal-level digital product leader and B2B SaaS architect with over 11 years of professional experience engineering complex software, data-heavy analytics platforms, and AI-native workflows. He operates at the intersection of design systems governance, enterprise architecture, and cross-functional engineering execution.",
};
const ABOUT_IMAGE = { src: "/browse/about--portrait.webp", alt: "Portrait of Christopher Kenreigh", width: 1000, height: 558 };
const RECENT_IMAGE = { src: "/browse/recent-work--portrait.webp", alt: "Christopher Kenreigh at a desk with holographic mobile UI screens and a user-flow diagram", width: 1000, height: 558 };
const ABOUT_SKILLS = ["Design systems", "Design-to-code pipelines", "Data-heavy dashboards", "AI-native (RAG) workflows"];

export function getBrowseCards(resume: ProjectCardData | null, recent: ProjectCardData[], fallbackCompany: string): ProjectCardData[] {
  const base = { company: fallbackCompany, date: null, liveUrl: null };
  const cards: ProjectCardData[] = [];
  if (resume) cards.push(resume);
  cards.push({ ...base, id: "recent", title: "Recent Work", summary: TEXT.recent, skills: [...new Set(recent.flatMap((r) => r.skills))], image: RECENT_IMAGE });
  cards.push({ ...base, id: "about", title: "About", summary: TEXT.about, skills: ABOUT_SKILLS, image: ABOUT_IMAGE });
  return cards;
}
