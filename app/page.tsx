import { readFileSync } from "node:fs";
import { join } from "node:path";
import Landing from "@/components/Landing";
import { getRecentWork } from "@/lib/recent-work";
import type { Project } from "@/lib/rag";
import { recentToCard, toProjectCard } from "@/lib/project-display";
import { getBrowseCards } from "@/lib/browse-cards";

export default function Page() {
  const resumeMarkdown = readFileSync(join(process.cwd(), "data/resume.md"), "utf8");
  const recentWork = getRecentWork();
  const raw = JSON.parse(readFileSync(join(process.cwd(), "projects.json"), "utf8"));
  const projects = (raw.projects || raw) as Project[];
  const cards = projects.map(toProjectCard);
  return <Landing resumeMarkdown={resumeMarkdown} recent={recentWork.map(recentToCard)} projects={cards} browse={getBrowseCards(resumeMarkdown, recentWork, cards)} />;
}
