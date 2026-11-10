"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ProjectCardData } from "@/lib/project-display";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* Only one Skills popover open at a time across cards. */
let closeOpenPopover: (() => void) | null = null;

function SkillsChip({ title, skills }: { title: string; skills: string[] }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const pinned = useRef(false);
  const latch = useRef(false); // set by Escape: no hover/focus re-open until the pointer or focus really leaves
  const suppress = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const hide = useCallback((restore = false) => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
    if (closeOpenPopover === hideRef.current) closeOpenPopover = null;
    if (restore && btn.current) {
      latch.current = true;
      suppress.current = true;
      btn.current.focus({ preventScroll: true });
      suppress.current = false;
    }
  }, []);
  const hideRef = useRef<() => void>(() => hide());
  hideRef.current = () => hide();
  const show = (pin: boolean) => {
    cancelClose();
    if (closeOpenPopover && closeOpenPopover !== hideRef.current) closeOpenPopover();
    closeOpenPopover = hideRef.current;
    if (pin) pinned.current = true;
    setOpen(true);
  };
  const laterClose = () => { cancelClose(); timer.current = setTimeout(() => { timer.current = null; if (!pinned.current) hide(); }, 180); };

  const place = useCallback(() => {
    const b = btn.current, p = pop.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const pw = p.offsetWidth || Math.min(384, vw - 16), ph = p.offsetHeight || 120;
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - pw - 8));
    const top = r.bottom + 6 + ph <= vh - 8 ? r.bottom + 6 : r.top - 6 - ph >= 8 ? r.top - 6 - ph : Math.max(8, vh - ph - 8);
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, []);

  useIsoLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); e.stopPropagation(); hide(true); } };
    const onClick = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !pop.current?.contains(t)) hide(); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [open, hide, place]);
  useEffect(() => () => { cancelClose(); if (closeOpenPopover === hideRef.current) closeOpenPopover = null; }, []);

  const hoverCapable = () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => { e.stopPropagation(); latch.current = false; if (open && pinned.current) hide(); else show(true); }}
        onMouseEnter={() => { if (latch.current) return; if (hoverCapable() && !pinned.current) show(false); }}
        onMouseLeave={(e) => {
          if (latch.current && !(e.relatedTarget instanceof Node && pop.current?.contains(e.relatedTarget))) latch.current = false;
          if (open && !pinned.current) laterClose();
        }}
        onFocus={(e) => {
          if (suppress.current || latch.current) return;
          let fv = false;
          try { fv = e.currentTarget.matches(":focus-visible"); } catch {}
          if (fv) show(false);
        }}
        onBlur={() => setTimeout(() => {
          const a = document.activeElement;
          if (latch.current && a !== btn.current) latch.current = false;
          if (!pinned.current && a !== btn.current && !(a && pop.current?.contains(a))) hide();
        }, 0)}
        className="relative inline-flex items-center gap-1 self-start rounded-full bg-[#f5f5f5] py-0.5 pl-2.5 pr-2 text-xs font-medium leading-5 text-[#404040] ring-1 ring-black/[.08] after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:bg-[#e5e5e5] aria-expanded:ring-[#155dfc]"
      >
        Skills
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={`h-3 w-3 opacity-75 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* position:fixed keeps the list out of card layout (no reflow, card height unchanged) */}
      <div
          ref={pop}
          id={id}
          role="region"
          aria-label={`Skills for ${title}`}
          hidden={!open}
          onMouseEnter={cancelClose}
          onMouseLeave={() => { if (!pinned.current) laterClose(); }}
          style={{ left: pos.left, top: pos.top }}
          className="fixed z-[60] max-h-[calc(100dvh-16px)] w-[min(24rem,calc(100vw-16px))] overflow-auto rounded-[14px] bg-white px-3.5 py-3 text-[13px] leading-snug text-neutral-900 shadow-xl ring-1 ring-black/10 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-white/10"
        >
          <ul className="flex flex-col gap-1.5">
            {skills.map((s) => <li key={s} className="font-medium">{s}</li>)}
          </ul>
        </div>
    </>
  );
}

export function ProjectCard({ card, onOpen }: { card: ProjectCardData; onOpen: () => void }) {
  return (
    <article
      aria-labelledby={`pc-${card.id}`}
      className="flex h-full flex-col rounded-[14px] bg-white ring-1 ring-black/5 transition hover:shadow-md dark:bg-neutral-900 dark:ring-white/10"
    >
      <div className="relative aspect-[1000/558] flex-none overflow-hidden rounded-t-[14px] bg-neutral-100 dark:bg-black">
        {card.image && (
          <img src={card.image.src} alt={card.image.alt} width={card.image.width} height={card.image.height} loading="lazy" decoding="async" className="block h-full w-full object-cover object-top" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 p-3">
          <span className="inline-flex items-center rounded-full bg-[rgba(23,23,23,.62)] px-2.5 py-0.5 text-xs font-medium leading-5 text-white ring-1 ring-white/20 backdrop-blur-md">{card.company}</span>
          {card.date && <span className="inline-flex items-center rounded-full bg-[rgba(23,23,23,.62)] px-2.5 py-0.5 text-xs font-medium leading-5 text-white ring-1 ring-white/20 backdrop-blur-md">{card.date}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5">
        <h3 id={`pc-${card.id}`} className="text-base font-semibold leading-snug">{card.title}</h3>
        {!!card.skills.length && <SkillsChip title={card.title} skills={card.skills} />}
        {card.summary && <p className="text-sm text-neutral-600 dark:text-neutral-300">{card.summary}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-end gap-3 pt-2">
          <button type="button" aria-haspopup="dialog" onClick={onOpen} className="min-h-11 rounded-full bg-[#155dfc] px-5 text-[15px] font-medium text-white">
            See More
          </button>
        </div>
      </div>
    </article>
  );
}

/** Grid of project cards that all share the tallest card's natural height (no fixed height, no inner scroll). */
export function ProjectCardGrid({ cards, onOpen }: { cards: ProjectCardData[]; onOpen: (c: ProjectCardData) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ids = cards.map((c) => c.id).join("|");
  useIsoLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(":scope > article"));
    let raf = 0;
    const equalize = () => {
      const list = items();
      list.forEach((a) => { a.style.minHeight = ""; a.style.height = "auto"; });
      const max = Math.max(0, ...list.map((a) => Math.ceil(a.getBoundingClientRect().height)));
      list.forEach((a) => { a.style.height = ""; if (max) a.style.minHeight = `${max}px`; });
    };
    const queue = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(equalize); };
    equalize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queue) : null;
    ro?.observe(el);
    items().forEach((a) => { const body = a.lastElementChild; if (body) ro?.observe(body); });
    window.addEventListener("resize", queue);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener("resize", queue); };
  }, [ids]);
  return (
    <div ref={host} className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => <ProjectCard key={c.id} card={c} onOpen={() => onOpen(c)} />)}
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div><div className="text-xs uppercase text-neutral-500">{k}</div><div>{children}</div></div>;
}

/** Project details sheet: title + close; live page fills the preview pane; company/date/description/skills on the right. */
export function ProjectSheet({ card, onClose }: { card: ProjectCardData | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!card} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        {card && (
          <Dialog.Content
            {...(card.summary ? {} : { "aria-describedby": undefined })}
            className="sheet fixed inset-x-0 bottom-0 top-[6dvh] z-50 flex flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-neutral-900 sm:top-[8dvh] sm:mx-auto sm:max-w-5xl"
          >
            <div className="bg-neutral-100 px-4 pb-3 pt-2 dark:bg-neutral-800">
              <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-current opacity-30" />
              <div className="flex items-center gap-3">
                <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold leading-snug">{card.title}</Dialog.Title>
                <Dialog.Close className="min-h-11 min-w-11 text-xl" aria-label="Close">✕</Dialog.Close>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto sm:flex-row sm:overflow-hidden">
              {card.liveUrl && (
                <div className="flex min-h-[45dvh] flex-1 flex-col bg-neutral-100 dark:bg-black">
                  <iframe
                    src={card.liveUrl}
                    title={`${card.title} live preview`}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    referrerPolicy="no-referrer"
                    className="min-h-[45dvh] w-full flex-1 border-0 bg-white"
                  />
                </div>
              )}
              <aside className={`flex w-full flex-col gap-3 p-4 text-sm ${card.liveUrl ? "sm:w-80 sm:overflow-auto" : "sm:overflow-auto"}`}>
                <Row k="Company">{card.company}</Row>
                {card.date && <Row k="Date">{card.date.replace(/^Timeline /, "")}</Row>}
                {card.summary && <Dialog.Description className="text-neutral-600 dark:text-neutral-300">{card.summary}</Dialog.Description>}
                {!!card.skills.length && (
                  <Row k="Skills"><ul className="list-disc pl-5">{card.skills.map((s) => <li key={s}>{s}</li>)}</ul></Row>
                )}
              </aside>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
