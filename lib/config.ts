export const OPENING = [
  "What’s Christopher working on at Plexus right now?",
  "Show me the design system work",
  "Pull up the resume",
  "Who is Christopher Kenreigh?",
  "Tell me about the Freeport dashboards",
  "What AI and RAG experience does he have?",
];

/** Hiring-focused asks for the home Ask strip (refresh cycles without repeats). */
export const HIRING_ASKS = [
  "What’s Christopher working on at Plexus right now?",
  "Show me the design system work",
  "Pull up the resume",
  "Who is Christopher Kenreigh?",
  "Tell me about the Freeport dashboards",
  "What AI and RAG experience does he have?",
  "How did he lead junior designers on the Odysseyware Virtual Science Labs?",
  "Has he shipped design-to-code pipelines?",
  "What’s his strongest B2B SaaS impact?",
  "How does he approach design ops and governance?",
  "How has he built and documented design systems like Pulse Kit and Tangible DLS?",
  "What tools and stack does he use day to day?",
  "Has he worked with executive stakeholders?",
  "What’s an example of measurable product outcomes?",
  "What did his Plexus UX Strategy Case Study show about product strategy?",
  "How did he assess design team maturity in the Design Ops Case Study?",
  "What’s his experience with data-heavy dashboards?",
  "What did the Japan expansion case study at Plexus involve?",
  "Which projects show his cross-functional collaboration with engineers and SMEs?",
  "What industries has he designed for?",
  "Is he open to new opportunities right now?",
  "How does he use information architecture to reduce cognitive load?",
  "Can he own discovery through delivery end to end?",
  "Which case studies cover e-commerce checkout and SaaS operations?",
  "What AI product work has he actually shipped?",
  "How does he communicate design decisions to leadership?",
  "What’s his experience with Figma and design tokens?",
  "Has he driven cross-functional roadmap priorities?",
  "What’s a tough product problem he solved recently?",
  "Where is he based and what work setup does he prefer?",
];

/** A suggested-message chip: visible label, and the message it sends (e.g. label "Yes", message "Yes, show me Pulse Kit."). */
export type Chip = { label: string; message: string };

export const FOLLOWUPS: Record<string, string[]> = {
  resume: ["Which projects used design systems?", "Current role details"],
  plexus: ["What skills did that involve?", "Show the design-to-code pipeline"],
  who: ["Show his current Plexus work", "Pull up the resume"],
  default: ["Show me the design system work", "What AI and RAG experience does he have?"],
};
export const LOADING: Record<string, string> = {
  resume: "Assembling the resume just for you!",
  plexus: "Pulling up Christopher’s latest work at Plexus…",
  freeport: "Retrieving the operational dashboards…",
  who: "Let me introduce you…",
  skills: "Gathering the skills and systems…",
  default: "Searching the projects…",
};
export const SCIFI = [
  "Don’t panic.",
  "By Grabthar’s hammer…",
  "May the Force be with this query.",
  "These aren’t the droids you’re looking for… wait, yes they are.",
  "Ludicrous speed, go!",
  "Make it so.",
  "Multipass!",
  "Enhance… 224 to 176.",
  "There is no spoon.",
  "Space… the final frontier of this portfolio…",
];
export function intent(q: string) {
  const s = q.toLowerCase();
  if (/resume|cv/.test(s)) return "resume";
  if (/plexus|current|now/.test(s)) return "plexus";
  if (/freeport|dashboard/.test(s)) return "freeport";
  if (/who is|who's|about him|this guy/.test(s)) return "who";
  if (/skill|design system/.test(s)) return "skills";
  return "default";
}
