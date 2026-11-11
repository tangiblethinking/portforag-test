import Landing from "@/components/Landing";
import { getRecentWork } from "@/lib/recent-work";
import { enabledCards, getMaster, recentCards, resumeCard } from "@/lib/master";
import { getBrowseCards } from "@/lib/browse-cards";

export default function Page() {
  const recent = recentCards(getRecentWork());
  return <Landing recent={recent} projects={enabledCards()} browse={getBrowseCards(resumeCard(), recent, getMaster().fallback_company)} />;
}
