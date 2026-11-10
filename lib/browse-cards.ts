import type { RecentWorkItem } from "@/lib/recent-work";
import { FALLBACK_COMPANY, type ProjectCardData } from "@/lib/project-display";

/**
 * Browse and Explore cards (Resume, Recent Work, About) in the approved project-card format.
 * Sources (nothing invented):
 * - Descriptions: the existing Browse and Explore card text.
 * - Company: no single employer applies to these navigation items, so the approved unknown fallback is used; no date.
 * - Resume skills: the "## Skills" line of data/resume.md.
 * - About skills: the focus areas named in the About text (components/Landing.tsx ABOUT.body[0]).
 * - Recent Work skills: union of the skills of featured deployments (data/recent-work.json) that match a project by live URL.
 * - Recent Work image: evidence-map capture of the first featured deployment, interview-eight-pi.vercel.app
 *   (portfolio-evidence-map html-package src/images/interview--interview-eight-pi--landing.webp, captured 2026-11-09).
 * - Resume and About: no sourced image exists yet, so the image area stays neutral.
 */
const TEXT = {
  resume: "Experience, skills, and the arc from design systems to AI-native product work.",
  recent: "Live deployments from the AppProto router — case studies, prototypes, and experiments.",
  about: "Who Christopher is, how he works, and what to ask next.",
};
const ABOUT_SKILLS = ["Design systems", "Design-to-code pipelines", "Data-heavy dashboards", "AI-native (RAG) workflows"];
const RECENT_IMAGE = {
  src: "/browse/recent-work.webp",
  alt: "Top of the Radix Recruiter Interview Cheat Sheet landing page (interview-eight-pi.vercel.app), Vercel project interview",
  width: 1000,
  height: 558,
};

export function resumeSkills(resumeMarkdown: string): string[] {
  const m = resumeMarkdown.match(/^## Skills\s*\n([^\n]+)/m);
  return m ? m[1].replace(/\.\s*$/, "").split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

export function getBrowseCards(resumeMarkdown: string, recentWork: RecentWorkItem[], projects: ProjectCardData[]): ProjectCardData[] {
  const byUrl = new Map(projects.filter((p) => p.liveUrl).map((p) => [p.liveUrl as string, p]));
  const recentSkills = [...new Set(recentWork.flatMap((r) => byUrl.get(r.url)?.skills ?? []))];
  const base = { company: FALLBACK_COMPANY, date: null, liveUrl: null };
  return [
    { ...base, id: "resume", title: "Resume", summary: TEXT.resume, skills: resumeSkills(resumeMarkdown), image: null },
    { ...base, id: "recent", title: "Recent Work", summary: TEXT.recent, skills: recentSkills, image: RECENT_IMAGE },
    { ...base, id: "about", title: "About", summary: TEXT.about, skills: ABOUT_SKILLS, image: null },
  ];
}
