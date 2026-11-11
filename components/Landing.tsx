"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectCardData } from "@/lib/project-display";
import { ProjectCardGrid, ProjectSheet, SheetShell } from "@/components/ProjectCards";
import { HIRING_ASKS, OPENING, SCIFI } from "@/lib/config";

type Msg = { role: "user" | "model"; text: string; error?: boolean; suggestions?: string[]; ids?: string[] };
type Frame =
  | { kind: "resume" }
  | { kind: "about" }
  | { kind: "recent"; shown: number };

const PAGE = 3;
const RESUME_HTML = "/resume.html";

const CHIP_COUNT = 6;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextChipBatch(used: string[]): { batch: string[]; used: string[] } {
  let remaining = HIRING_ASKS.filter((q) => !used.includes(q));
  let nextUsed = used;
  if (remaining.length < CHIP_COUNT) {
    remaining = [...HIRING_ASKS];
    nextUsed = [];
  }
  const batch = shuffle(remaining).slice(0, CHIP_COUNT);
  return { batch, used: [...nextUsed, ...batch] };
}

const ABOUT = {
  title: "About",
  body: [
    "Christopher Kenreigh is a Principal Product Designer and B2B SaaS architect focused on design systems, design-to-code pipelines, data-heavy dashboards, and AI-native (RAG) workflows.",
    "He currently works at Plexus Worldwide on design system governance, Figma-to-React pipelines, and enterprise content tools. Earlier work spans Freeport-McMoRan operational dashboards, OpenTech Alliance kiosk flows, and Siemens industrial design systems.",
    "Ask anything in the chat — resume, case studies, skills, or what he’s building now.",
  ],
};

const LOAD: Record<string, string> = {
  resume: "Assembling the resume just for you!",
  plexus: "Pulling up Christopher’s latest work at Plexus…",
  freeport: "Retrieving the operational dashboards…",
  who: "Let me introduce you…",
  skills: "Gathering the skills and systems…",
};
function guess(q: string) {
  const s = q.toLowerCase();
  if (/resume|cv/.test(s)) return LOAD.resume;
  if (/plexus|current/.test(s)) return LOAD.plexus;
  if (/freeport|dashboard/.test(s)) return LOAD.freeport;
  if (/who is|this guy/.test(s)) return LOAD.who;
  if (/skill|design system/.test(s)) return LOAD.skills;
  return "Searching the projects…";
}

export default function Landing({
  recent,
  projects,
  browse,
}: {
  recent: ProjectCardData[];
  projects: ProjectCardData[];
  browse: ProjectCardData[];
}) {
  const [dark, setDark] = useState(false);
  const [stack, setStack] = useState<Frame[]>([]);
  const [chatMode, setChatMode] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [homeChips, setHomeChips] = useState<string[]>(() => OPENING.slice(0, CHIP_COUNT));
  const [usedChips, setUsedChips] = useState<string[]>(() => OPENING.slice(0, CHIP_COUNT));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [sheet, setSheet] = useState<ProjectCardData | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const top = stack[stack.length - 1] || null;
  const byId = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    const { batch, used } = nextChipBatch([]);
    setHomeChips(batch);
    setUsedChips(used);
  }, []);

  function refreshHomeChips() {
    const { batch, used } = nextChipBatch(usedChips);
    setHomeChips(batch);
    setUsedChips(used);
  }

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, busy, chatMode]);
  useEffect(() => {
    if (!busy) return;
    setLine(SCIFI[Math.floor(Math.random() * SCIFI.length)]);
    const t = setInterval(() => setLine(SCIFI[Math.floor(Math.random() * SCIFI.length)]), 2500);
    return () => clearInterval(t);
  }, [busy]);

  const toggle = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.theme = d ? "dark" : "light";
  };
  const push = (f: Frame) => setStack((s) => [...s, f]);
  const pop = () => setStack((s) => s.slice(0, -1));

  function openProject(p: ProjectCardData) {
    if (p.id === "resume") {
      push({ kind: "resume" });
      return;
    }
    setSheet(p);
  }

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    setChatMode(true);
    setInput("");
    const next = [...msgs, { role: "user" as const, text: q }];
    setMsgs(next);
    setBusy(guess(q));
    let m: Msg;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: q,
          conversationId: "landing",
          history: next.slice(-6).map(({ role, text }) => ({ role, text })),
        }),
      });
      const j = await r.json();
      m = r.ok
        ? { role: "model", text: j.answer, ids: j.project_ids, suggestions: j.suggestions }
        : {
            role: "model",
            text: j.message || "Something went wrong.",
            error: true,
            suggestions: OPENING.slice(0, 3),
            ids: j.error === "all_keys_busy" ? ["resume"] : [],
          };
    } catch {
      m = { role: "model", text: "Network hiccup. Please try again.", error: true, suggestions: OPENING.slice(0, 3) };
    }
    setBusy(null);
    setMsgs((prev) => [...prev, m]);
  }

  const browseActions: Record<string, () => void> = {
    resume: () => push({ kind: "resume" }),
    recent: () => push({ kind: "recent", shown: PAGE }),
    about: () => push({ kind: "about" }),
  };

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask(input);
      }}
      className={chatMode ? "sticky bottom-0 -mx-4 border-t border-black/10 bg-[#f5f5f7]/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 sm:-mx-6 sm:px-6" : "mt-4"}
    >
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          disabled={!!busy}
          placeholder={busy ? "Thinking…" : "Ask anything..."}
          aria-label="Message"
          className="min-h-11 flex-1 rounded-full bg-white px-4 outline-none ring-1 ring-black/10 focus:ring-blue-500 dark:bg-neutral-900 dark:ring-white/10"
        />
        <button disabled={!!busy || !input.trim()} className="min-h-11 rounded-full bg-blue-500 px-5 font-medium text-white disabled:opacity-40">
          Send
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-500">Chat history stays on your device. Questions are sent to Google Gemini to produce answers.</p>
    </form>
  );

  const thread = (
    <div className="mt-5 space-y-4">
      {msgs.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">{m.text}</div>
          </div>
        ) : (
          <div key={i} className="space-y-3">
            <div className={`max-w-[95%] whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-3 ${m.error ? "bg-amber-50 dark:bg-amber-950/40" : "bg-white dark:bg-neutral-900"}`}>
              {m.text}
            </div>
            {!!m.ids?.length && (
              <ProjectCardGrid
                cards={m.ids
                  .map((id) => byId[id])
                  .filter(Boolean)
                  .slice(0, 3)}
                onOpen={openProject}
              />
            )}
            {m === msgs[msgs.length - 1] && m.suggestions && (
              <div className="flex flex-wrap gap-2">
                {m.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="min-h-11 rounded-full bg-white px-4 text-sm ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/10">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
      {busy && (
        <div role="status" aria-live="polite" className="text-sm text-neutral-500">
          <div className="font-medium">{busy}</div>
          <div className="italic">{line}</div>
        </div>
      )}
      <div ref={end} />
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-10 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-black/10 bg-[#f5f5f7]/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 sm:-mx-6 sm:px-6">
        <Link href="/contact" className="min-h-11 content-center text-sm font-medium text-blue-600 dark:text-blue-400">
          Contact
        </Link>
        <div className="text-center">
          <div className="text-[15px] font-semibold">Christopher Kenreigh</div>
          <div className="text-xs text-neutral-500">Product Design, Product Management, Product Strategy</div>
        </div>
        <button onClick={toggle} aria-label="Toggle dark mode" className="min-h-11 min-w-11 rounded-full text-lg">
          {dark ? "☀︎" : "☾"}
        </button>
      </header>

      {chatMode ? (
        <>
          <div className="sticky top-[57px] z-20 -mx-4 border-b border-black/10 bg-[#f5f5f7]/90 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={() => setChatMode(false)}
              className="self-start min-h-11 text-sm font-medium text-blue-600 dark:text-blue-400"
            >
              ‹ Back to view mode
            </button>
          </div>
          <section className="pt-4 sm:pt-6">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Ask anything you’d like</h1>
            <p className="mt-3 max-w-2xl text-lg text-neutral-500">Learn anything about me. Well, almost.</p>
          </section>
          <div className="flex min-h-0 flex-1 flex-col">{thread}</div>
          {composer}
        </>
      ) : (
        <>
          <section className="pt-10 sm:pt-14">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Designs for easy mode!</h1>
            <p className="mt-3 max-w-2xl text-lg text-neutral-500">Learn anything about me. Well, almost.</p>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold text-blue-600 dark:text-blue-400">Browse and Explore</h2>
            <div className="mt-4">
              <ProjectCardGrid cards={browse} onOpen={(c) => browseActions[c.id]?.()} />
            </div>
          </section>

          <section className="mt-14 border-t border-black/10 pt-8 dark:border-white/10">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-blue-600 dark:text-blue-400">Ask anything you’d like</h2>
              <button
                type="button"
                onClick={refreshHomeChips}
                aria-label="Refresh suggested topics"
                title="New topics"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-neutral-500 ring-1 ring-black/10 transition hover:bg-white hover:text-neutral-800 dark:ring-white/10 dark:hover:bg-neutral-900"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {homeChips.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="min-h-11 rounded-full bg-white px-4 text-sm ring-1 ring-black/10 hover:bg-neutral-50 dark:bg-neutral-900 dark:ring-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
            {composer}
          </section>
        </>
      )}

      <SheetShell
        open={!!top}
        title={top?.kind === "resume" ? "Resume" : top?.kind === "about" ? "About" : top?.kind === "recent" ? "Recent Work" : ""}
        onClose={pop}
      >
        {top?.kind === "resume" ? (
          // Supplied resume, served unchanged from public/resume.html; isolated so its styles stay its own.
          <iframe
            src={RESUME_HTML}
            title="Resume"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {top?.kind === "about" && (
            <div className="mx-auto max-w-2xl space-y-4 p-6">
              <h2 className="text-2xl font-semibold">{ABOUT.title}</h2>
              {ABOUT.body.map((p) => (
                <p key={p} className="leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {p}
                </p>
              ))}
            </div>
          )}
          {top?.kind === "recent" && (
            <div className="p-4 sm:p-6">
              <p className="mb-4 text-sm text-neutral-500">
                Live deployments from AppProtoNeoRouter. Showing {Math.min(top.shown, recent.length)} of {recent.length}.
              </p>
              <ProjectCardGrid cards={recent.slice(0, top.shown)} onOpen={setSheet} />
              {top.shown < recent.length && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      setStack((s) => {
                        const copy = [...s];
                        const i = copy.length - 1;
                        const cur = copy[i];
                        if (cur?.kind === "recent") copy[i] = { kind: "recent", shown: cur.shown + PAGE };
                        return copy;
                      })
                    }
                    className="min-h-11 rounded-full bg-blue-600 px-5 text-sm font-medium text-white"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </SheetShell>

      <ProjectSheet card={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
