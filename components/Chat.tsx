"use client";
/**
 * @deprecated Not rendered by the app (app/page.tsx renders components/Landing.tsx). Its project Card/Sheet are
 * superseded by components/ProjectCards.tsx (ProjectCardGrid, ProjectSheet). Kept only until it is removed.
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Project } from "@/lib/rag";
import { brandSkin } from "@/lib/brand";
type Msg = { role: "user" | "model"; text: string; ids?: string[]; suggestions?: string[]; error?: boolean };
type Conv = { id: string; title: string; at: number; msgs: Msg[] };
const LOAD: Record<string, string> = { resume: "Assembling the resume just for you!", plexus: "Pulling up Christopher’s latest work at Plexus…", freeport: "Retrieving the operational dashboards…", who: "Let me introduce you…", skills: "Gathering the skills and systems…" };
const guess = (q: string) => { const s = q.toLowerCase(); return /resume|cv/.test(s) ? LOAD.resume : /plexus|current/.test(s) ? LOAD.plexus : /freeport|dashboard/.test(s) ? LOAD.freeport : /who is|this guy/.test(s) ? LOAD.who : /skill|design system/.test(s) ? LOAD.skills : "Searching the projects…"; };

export default function Chat({ projects, opening, scifi }: { projects: Project[]; opening: string[]; scifi: string[] }) {
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const [convs, setConvs] = useState<Conv[]>([]);
  const [cur, setCur] = useState<Conv>({ id: String(Date.now()), title: "", at: Date.now(), msgs: [] });
  const [input, setInput] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [line, setLine] = useState("");
  const [open, setOpen] = useState<Project | null>(null); const [hist, setHist] = useState(false); const [dark, setDark] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); try { setConvs(JSON.parse(localStorage.convs || "[]")); } catch {} }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [cur.msgs.length, busy]);
  useEffect(() => { if (!busy) return; setLine(scifi[Math.floor(Math.random() * scifi.length)]); const t = setInterval(() => setLine(scifi[Math.floor(Math.random() * scifi.length)]), 2500); return () => clearInterval(t); }, [busy, scifi]);
  const save = (c: Conv) => { setCur(c); setConvs(prev => { const n = [c, ...prev.filter(x => x.id !== c.id)].slice(0, 30); localStorage.convs = JSON.stringify(n); return n; }); };
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle("dark", d); localStorage.theme = d ? "dark" : "light"; };
  async function ask(q: string) {
    q = q.trim(); if (!q || busy) return; setInput("");
    const c: Conv = { ...cur, title: cur.title || q.slice(0, 60), msgs: [...cur.msgs, { role: "user", text: q }] }; setCur(c); setBusy(guess(q));
    let m: Msg;
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, conversationId: c.id, history: cur.msgs.slice(-6).map(({ role, text }) => ({ role, text })) }) });
      const j = await r.json();
      m = r.ok ? { role: "model", text: j.answer, ids: j.project_ids, suggestions: j.suggestions } : { role: "model", text: j.message || "Something went wrong.", error: true, suggestions: opening.slice(0, 3), ids: j.error === "all_keys_busy" ? ["resume"] : [] };
    } catch { m = { role: "model", text: "Network hiccup. Please try again.", error: true, suggestions: opening.slice(0, 3) }; }
    setBusy(null); save({ ...c, msgs: [...c.msgs, m] });
  }
  const last = cur.msgs[cur.msgs.length - 1];
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-black/10 bg-[#f5f5f7]/80 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70">
        <button onClick={() => setHist(true)} className="min-h-11 rounded-full px-3 text-sm font-medium text-blue-600 dark:text-blue-400">History</button>
        <div className="text-center"><div className="text-[15px] font-semibold">Christopher Kenreigh</div><div className="text-xs text-neutral-500">Product Design, Product Management, Product Strategy</div></div>
        <button onClick={toggle} aria-label="Toggle dark mode" className="min-h-11 min-w-11 rounded-full text-lg">{dark ? "☀︎" : "☾"}</button>
      </header>
      <main className="flex-1 space-y-5 px-4 py-6">
        {!cur.msgs.length && (<section className="pt-10"><h1 className="text-4xl font-bold tracking-tight">Hi there.</h1><p className="mt-2 text-lg text-neutral-500">Ask about Christopher’s projects, resume, skills, or just say hi.</p><Chips items={opening} onPick={ask} /></section>)}
        {cur.msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">{m.text}</div></div>
        ) : (
          <div key={i} className="space-y-3">
            <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-3 ${m.error ? "bg-amber-50 dark:bg-amber-950/40" : "bg-white dark:bg-neutral-900"}`}>{m.text}</div>
            {!!m.ids?.length && <div className="grid gap-3 sm:grid-cols-2">{m.ids.map(id => byId[id] && <Card key={id} p={byId[id]} dark={dark} onOpen={() => setOpen(byId[id])} />)}</div>}
            {m === last && m.suggestions && <Chips items={m.suggestions} onPick={ask} />}
          </div>))}
        {busy && <div role="status" aria-live="polite" className="text-sm text-neutral-500"><div className="font-medium">{busy}</div><div className="italic">{line}</div></div>}
        <div ref={end} />
      </main>
      <form onSubmit={e => { e.preventDefault(); ask(input); }} className="sticky bottom-0 border-t border-black/10 bg-[#f5f5f7]/80 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/70">
        <div className="flex gap-2"><input value={input} onChange={e => setInput(e.target.value)} maxLength={500} disabled={!!busy} placeholder={busy ? "Thinking…" : "Ask anything…"} aria-label="Message" className="min-h-11 flex-1 rounded-full bg-white px-4 outline-none ring-1 ring-black/10 focus:ring-blue-500 dark:bg-neutral-900 dark:ring-white/10" />
          <button disabled={!!busy || !input.trim()} className="min-h-11 rounded-full bg-blue-600 px-5 font-medium text-white disabled:opacity-40">Send</button></div>
        <p className="mt-2 text-center text-[11px] text-neutral-500">Chat history stays on your device. Questions are sent to Google Gemini to produce answers.</p>
      </form>
      <Sheet p={open} dark={dark} onClose={() => setOpen(null)} />
      <Dialog.Root open={hist} onOpenChange={setHist}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-20 bg-black/30" />
        <Dialog.Content className="sheet fixed inset-x-0 bottom-0 z-30 max-h-[80dvh] overflow-auto rounded-t-2xl bg-white p-4 dark:bg-neutral-900 sm:mx-auto sm:max-w-lg">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" /><Dialog.Title className="mb-2 text-xl font-semibold">History</Dialog.Title>
          <div className="mb-3 flex gap-2"><button className="min-h-11 rounded-full bg-blue-600 px-4 text-sm text-white" onClick={() => { setCur({ id: String(Date.now()), title: "", at: Date.now(), msgs: [] }); setHist(false); }}>Start fresh</button>
            <button className="min-h-11 rounded-full px-4 text-sm text-red-600" onClick={() => { setConvs([]); localStorage.convs = "[]"; }}>Clear all</button></div>
          {!convs.length && <p className="text-sm text-neutral-500">No saved conversations.</p>}
          <ul className="divide-y divide-black/10 dark:divide-white/10">{convs.map(c => <li key={c.id} className="flex items-center gap-2 py-2"><button className="min-h-11 flex-1 text-left" onClick={() => { setCur(c); setHist(false); }}><div className="truncate text-sm font-medium">{c.title}</div><div className="text-xs text-neutral-500">{new Date(c.at).toLocaleString()}</div></button>
            <button aria-label="Delete" className="min-h-11 min-w-11 text-neutral-400" onClick={() => { const n = convs.filter(x => x.id !== c.id); setConvs(n); localStorage.convs = JSON.stringify(n); }}>✕</button></li>)}</ul>
        </Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>);
}
function Chips({ items, onPick }: { items: string[]; onPick: (s: string) => void }) {
  return <div className="mt-4 flex flex-wrap gap-2">{items.map(s => <button key={s} onClick={() => onPick(s)} className="min-h-11 rounded-full bg-white px-4 text-sm ring-1 ring-black/10 hover:bg-neutral-50 dark:bg-neutral-900 dark:ring-white/10">{s}</button>)}</div>;
}
function Tile({ p, dark, size = 44 }: { p: Project; dark: boolean; size?: number }) {
  const b = brandSkin(p.brand, dark);
  const label = String(b?.name || p.company || p.title).split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  return <div aria-hidden style={{ width: size, height: size, background: b?.bg, color: b?.fg, borderRadius: (b?.radius ?? 12) - 2 }} className={`flex shrink-0 items-center justify-center text-sm font-semibold ${b ? "" : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"}`}>{b?.logo ? <img src={b.logo} alt="" className="h-2/3 w-2/3 object-contain" /> : label}</div>;
}
function Card({ p, dark, onOpen }: { p: Project; dark: boolean; onOpen: () => void }) {
  const b = brandSkin(p.brand, dark);
  return (<button onClick={onOpen} style={{ borderRadius: b?.radius ?? 14 }} className="overflow-hidden bg-white text-left ring-1 ring-black/5 transition hover:shadow-md dark:bg-neutral-900 dark:ring-white/10">
    <div style={{ background: b?.bg, color: b?.fg }} className={`flex items-center gap-3 px-4 py-3 ${b ? "" : "bg-neutral-100 dark:bg-neutral-800"}`}><Tile p={p} dark={dark} size={36} /><div className="min-w-0"><div className="truncate font-semibold">{p.title}</div><div className="truncate text-xs opacity-80">{[p.company, p.period_display].filter(Boolean).join(" · ") || p.type}</div></div></div>
    <div className="px-4 py-3"><p className="line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">{p.summary}</p>
      {!!p.skills?.length && <div className="mt-2 flex flex-wrap gap-1">{p.skills.slice(0, 3).map(s => <span key={s} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{s}</span>)}</div>}</div></button>);
}
function Sheet({ p, dark, onClose }: { p: Project | null; dark: boolean; onClose: () => void }) {
  const [big, setBig] = useState(false); const b = brandSkin(p?.brand, dark);
  const url = p?.id === "resume" ? null : p?.live_url || p?.figma_url || null;
  return (<Dialog.Root open={!!p} onOpenChange={o => !o && onClose()}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-20 bg-black/40" />
    {p && <Dialog.Content className={`sheet fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-neutral-900 ${big ? "top-0 rounded-none" : "top-[6dvh] sm:top-[8dvh] sm:mx-auto sm:max-w-5xl"}`}>
      <div style={{ background: b?.bg, color: b?.fg }} className={`px-4 pb-3 pt-2 ${b ? "" : "bg-neutral-100 dark:bg-neutral-800"}`}>
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-current opacity-30" />
        <div className="flex items-center gap-3"><Tile p={p} dark={dark} /><div className="min-w-0 flex-1"><Dialog.Title className="truncate text-lg font-semibold">{p.title}</Dialog.Title><Dialog.Description className="truncate text-sm opacity-80">{[p.company, p.role].filter(Boolean).join(" — ") || p.type}</Dialog.Description></div>
          <button onClick={() => setBig(!big)} className="hidden min-h-11 px-2 text-sm sm:block">{big ? "Shrink" : "Expand"}</button>
          {url && <a href={url} target="_blank" rel="noreferrer" className="min-h-11 px-2 pt-3 text-sm">Open ↗</a>}
          {url && <button onClick={() => navigator.clipboard.writeText(url)} className="min-h-11 px-2 text-sm">Copy link</button>}
          <Dialog.Close className="min-h-11 min-w-11 text-xl" aria-label="Close">✕</Dialog.Close></div></div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="min-h-[45dvh] flex-1 bg-neutral-100 dark:bg-black">{url ? <iframe src={url} title={`${p.title} live preview`} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" className="h-full w-full" /> :
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-500">{p.id === "resume" ? p.summary : "No live preview for this project."}</div>}</div>
        <aside className="w-full space-y-3 overflow-auto p-4 text-sm sm:w-80">
          {p.period_display && <Row k="Dates" v={p.period_display} />}{p.role && <Row k="Role" v={p.role} />}
          {p.summary && <p className="text-neutral-600 dark:text-neutral-300">{p.summary}</p>}
          {!!p.skills?.length && <div><div className="text-xs uppercase text-neutral-500">Skills</div><div className="mt-1 flex flex-wrap gap-1">{p.skills.map(s => <span key={s} className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">{s}</span>)}</div></div>}
          {!!p.promotions_or_milestones?.length && <div><div className="text-xs uppercase text-neutral-500">Milestones</div><ul className="ml-4 list-disc">{p.promotions_or_milestones.map(s => <li key={s}>{s}</li>)}</ul></div>}
          {!!p.source_urls?.length && <div><div className="text-xs uppercase text-neutral-500">Sources</div>{p.source_urls.map(s => <a key={s} href={s} target="_blank" rel="noreferrer" className="block truncate text-blue-600">{s}</a>)}</div>}
          {url && <p className="text-xs text-neutral-500">If the preview is blank, the site blocks embedding — use Open ↗.</p>}
        </aside></div>
    </Dialog.Content>}</Dialog.Portal></Dialog.Root>);
}
function Row({ k, v }: { k: string; v: string }) { return <div><div className="text-xs uppercase text-neutral-500">{k}</div><div>{v}</div></div>; }
