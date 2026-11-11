/** Display fields for an approved project card and its details sheet. Type-only module (safe for client components). */
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
