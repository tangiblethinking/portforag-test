"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ProjectCardData } from "@/lib/project-display";
import { PortfolioSheet, ProjectCardGrid, ProjectSheet, SheetShell } from "@/components/ProjectCards";
import { HIRING_ASKS, OPENING, SCIFI, makeDeck, type Chip } from "@/lib/config";
import { trackVisualViewport } from "@/lib/visual-viewport";

type Msg = { role: "user" | "model"; text: string; error?: boolean; suggestions?: Chip[]; ids?: string[] };
/** Chips from the API are { label, message } (a "Yes" chip sends a message naming the offered record); plain strings are both. */
const toChips = (list: unknown): Chip[] =>
  (Array.isArray(list) ? list : []).flatMap((c) => (typeof c === "string" ? [{ label: c, message: c }] : c && typeof c.label === "string" && typeof c.message === "string" ? [{ label: c.label, message: c.message }] : []));
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
  portfolio,
}: {
  recent: ProjectCardData[];
  projects: ProjectCardData[];
  browse: ProjectCardData[];
  /** Traditional portfolio (uxapex.com/portfolio): header "Portfolio" item and the chat's failure card. */
  portfolio: ProjectCardData | null;
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
  // the traditional portfolio has its own sheet (title, close, site only — no details column)
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  // titles offered in this conversation ("Would you like to know about …?"); sent back so used offers never return
  const [offered, setOffered] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null); // chat-mode scroll region (the thread)
  const lastAnswer = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLFormElement>(null); // the composer: one element in both modes (fixed bar on mobile)
  const quotes = useRef(makeDeck(SCIFI));
  const top = stack[stack.length - 1] || null;
  const byId = useMemo(() => Object.fromEntries([...projects, ...(portfolio ? [portfolio] : [])].map((p) => [p.id, p])), [projects, portfolio]);
  const failIds = portfolio ? [portfolio.id] : [];

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    const { batch, used } = nextChipBatch([]);
    setHomeChips(batch);
    setUsedChips(used);
  }, []);

  // the menu sheet is mobile-only: close it if the viewport grows to the desktop header
  useEffect(() => {
    if (!menu) return;
    const mq = window.matchMedia("(min-width: 640px)");
    const close = () => { if (mq.matches) setMenu(false); };
    close();
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, [menu]);

  // Mobile composer from first load: keep the visual-viewport insets current (iOS keyboard/toolbars) and publish the
  // bar's height so the landing page and the chat shell can leave room for it.
  useEffect(() => {
    const root = document.documentElement;
    const stop = trackVisualViewport(root);
    const el = bar.current;
    const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => root.style.setProperty("--composer-h", `${el.offsetHeight}px`)) : null;
    if (el && ro) ro.observe(el);
    return () => {
      stop();
      ro?.disconnect();
      root.style.removeProperty("--composer-h");
    };
  }, []);
  // chat mode: lock the page so only the thread scrolls (the landing page stays free to scroll)
  useEffect(() => {
    if (!chatMode) return;
    const html = document.documentElement, body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
    };
  }, [chatMode]);

  function refreshHomeChips() {
    const { batch, used } = nextChipBatch(usedChips);
    setHomeChips(batch);
    setUsedChips(used);
  }

  // The thread's visible height, so on mobile the latest answer block fills it and its chips start below the fold.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--thread-h", `${el.clientHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatMode]);
  // Scroll only the thread: while waiting, to the status line; after an answer, to the top of that answer (never to
  // the chips, which sit below it).
  useEffect(() => {
    const el = box.current;
    if (!chatMode || !el) return;
    const target = busy || msgs[msgs.length - 1]?.role !== "model" ? end.current : lastAnswer.current;
    if (!target) return;
    const y = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
    el.scrollTo({ top: target === end.current ? el.scrollHeight : Math.max(0, y), behavior: "smooth" });
  }, [msgs.length, busy, chatMode]);
  useEffect(() => {
    if (!busy) return;
    setLine(quotes.current()); // shuffled without replacement: no line repeats until all have been shown
    const t = setInterval(() => setLine(quotes.current()), 2500);
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
    if (portfolio && p.id === portfolio.id) {
      setPortfolioOpen(true);
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
          offered,
        }),
      });
      const j = await r.json();
      if (r.ok && typeof j.offer?.title === "string") setOffered((o) => (o.includes(j.offer.title) ? o : [...o, j.offer.title]));
      // failures (busy keys, timeouts, server errors) show the traditional portfolio card (plus the resume when busy)
      m = r.ok
        ? { role: "model", text: j.answer, ids: j.project_ids, suggestions: toChips(j.suggestions) }
        : {
            role: "model",
            text: j.message || "Something went wrong.",
            error: true,
            suggestions: toChips(OPENING.slice(0, 3)),
            ids: j.error === "all_keys_busy" ? [...failIds, "resume"] : j.error === "bad_request" ? [] : failIds,
          };
    } catch {
      m = { role: "model", text: "The chat couldn’t connect just now. Here’s the full portfolio.", error: true, ids: failIds, suggestions: toChips(OPENING.slice(0, 3)) };
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
      ref={bar}
      onSubmit={(e) => {
        e.preventDefault();
        ask(input);
      }}
      // mobile: .composer-bar is position:fixed at the bottom of the visible viewport in both modes (globals.css);
      // desktop: in-flow — under the chips in the Ask section on landing, the bottom flex-none row of the chat column
      className={`composer-bar flex-none border-t border-black/10 bg-[#f5f5f7]/90 px-4 pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 ${
        chatMode ? "sm:-mx-6 sm:px-6 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:sm:bg-transparent"
      }`}
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
    </form>
  );

  const thread = (
    <div className="mt-5 space-y-4 pb-4">
      {msgs.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">{m.text}</div>
          </div>
        ) : (
          <div key={i} className="space-y-4">
            {/* the latest answer (and its cards) fills the thread on mobile, so its chips start below the fold */}
            <div ref={m === msgs[msgs.length - 1] ? lastAnswer : undefined} className={`space-y-3 ${m === msgs[msgs.length - 1] && m.suggestions?.length ? "min-h-[calc(var(--thread-h,100dvh)-24px)] sm:min-h-0" : ""}`}>
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
            </div>
            {m === msgs[msgs.length - 1] && m.suggestions && (
              <div className="flex flex-wrap gap-2">
                {m.suggestions.map((s) => (
                  <button key={s.message} type="button" onClick={() => ask(s.message)} title={s.label !== s.message ? s.message : undefined} aria-label={s.message} className="min-h-11 rounded-full bg-white px-4 text-sm ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/10">
                    {s.label}
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
    // chat mode: a column filling the visible viewport (mobile: .chat-shell, fixed to the visual viewport; desktop: h-dvh) —
    // header on top, the thread is the only scrolling region, composer at the bottom. Landing: the page scrolls and
    // .landing-pad leaves room above the mobile composer bar.
    <div className={`mx-auto flex max-w-5xl flex-col px-4 sm:px-6 ${chatMode ? "chat-shell h-dvh overflow-hidden" : "landing-pad min-h-dvh pb-10"}`}>
      <header className="sticky top-0 z-20 -mx-4 flex flex-none items-center justify-between gap-3 border-b border-black/10 bg-[#f5f5f7]/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 sm:-mx-6 sm:px-6">
        <div className="flex flex-1 basis-0 items-center gap-4">
          {portfolio && (
            <button type="button" aria-haspopup="dialog" onClick={() => setPortfolioOpen(true)} className="min-h-11 text-sm font-medium text-blue-600 dark:text-blue-400">
              Portfolio
            </button>
          )}
          <Link href="/contact" className="hidden min-h-11 content-center text-sm font-medium text-blue-600 dark:text-blue-400 sm:block">
            Contact
          </Link>
        </div>
        <div className="text-center">
          <div className="text-[15px] font-semibold">Christopher Kenreigh</div>
          <div className="text-xs text-neutral-500">Product Design, Product Management, Product Strategy</div>
        </div>
        <div className="flex flex-1 basis-0 justify-end">
          <button onClick={toggle} aria-label="Toggle dark mode" className="hidden min-h-11 min-w-11 rounded-full text-lg sm:block">
            {dark ? "☀︎" : "☾"}
          </button>
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menu} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full sm:hidden">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* mobile menu: side sheet with Contact and the light/dark control */}
      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 sm:hidden" />
          <Dialog.Content aria-describedby={undefined} className="drawer fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#f5f5f7]/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl ring-1 ring-black/10 backdrop-blur-xl dark:bg-neutral-900/95 dark:ring-white/10 sm:hidden">
            <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
              <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold leading-snug">Menu</Dialog.Title>
              <Dialog.Close className="min-h-11 min-w-11 text-xl" aria-label="Close">✕</Dialog.Close>
            </div>
            <nav className="flex flex-col p-2">
              <Link href="/contact" onClick={() => setMenu(false)} className="flex min-h-11 items-center rounded-xl px-3 text-[15px] font-medium text-blue-600 hover:bg-white dark:text-blue-400 dark:hover:bg-neutral-800">
                Contact
              </Link>
              <button type="button" onClick={toggle} aria-pressed={dark} className="flex min-h-11 items-center justify-between rounded-xl px-3 text-left text-[15px] font-medium hover:bg-white dark:hover:bg-neutral-800">
                <span>{dark ? "Dark mode" : "Light mode"}</span>
                <span aria-hidden className="text-lg">{dark ? "☾" : "☀︎"}</span>
              </button>
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {chatMode ? (
        <>
          <div className="sticky top-[57px] z-20 -mx-4 flex-none border-b border-black/10 bg-[#f5f5f7]/90 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-black/70 sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={() => setChatMode(false)}
              className="self-start min-h-11 text-sm font-medium text-blue-600 dark:text-blue-400"
            >
              ‹ Back to view mode
            </button>
          </div>
          <div ref={box} className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:-mx-6 sm:px-6">
            <section className="pt-4 sm:pt-6">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Ask anything you’d like</h1>
              <p className="mt-3 max-w-2xl text-lg text-neutral-500">Learn anything about me. Well, almost.</p>
            </section>
            {thread}
          </div>
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
          </section>
        </>
      )}
      {/* the same composer element in both modes (no remount on entering chat), outside the mode switch */}
      {composer}

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
      <PortfolioSheet card={portfolioOpen ? portfolio : null} onClose={() => setPortfolioOpen(false)} />
    </div>
  );
}
