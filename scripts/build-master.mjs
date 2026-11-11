// Builds data/master.json: the ONE canonical master collection for retrieval and cards.
// Deterministic, no network, no API keys. Repository inputs only:
//   data/source/evidence-map/index.html        evidence map (86 structured repo records, JSON block id="evidence-data")
//   data/source/evidence-map/src/images/*.webp captured landing images referenced by the map
//   public/resume.html                          supplied resume, served unchanged; its text is extracted here
//   projects.json, data/recent-work.json        existing runtime ids / Recent Work URLs (alias map + accounting only)
// Source refresh: replace the inputs above and re-run. For every record already in data/master.json, the
// `indexable` toggle and every field in `manual` (verified corrections) are carried over and re-applied.
// Output images: public/evidence/<file>.webp (copies of the captured files actually referenced; no new captures).
import fs from "node:fs";
import crypto from "node:crypto";

const MAP = "data/source/evidence-map/index.html";
const IMG_DIR = "data/source/evidence-map/src/images";
const RESUME = "public/resume.html";
const OUT = "data/master.json";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// ---------- evidence map ----------
const mapHtml = fs.readFileSync(MAP, "utf8");
const block = mapHtml.match(/<script type="application\/json" id="evidence-data">([\s\S]*?)<\/script>/);
if (!block) throw new Error("evidence-data block not found in " + MAP);
const ev = JSON.parse(block[1].replace(/<\\\//g, "</"));
const thumbs = ev.thumbnails.entries;
const MAP_CHECKED = ev.source?.checked || null;

// ---------- resume (text only; styling and markup excluded) ----------
const resumeHtml = fs.readFileSync(RESUME, "utf8");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = (h) => decode(h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([.,;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
const body = resumeHtml.slice(resumeHtml.indexOf("<body"));
const first = (re, s = body) => { const m = s.match(re); return m ? text(m[1]) : null; };
const name = first(/<h1>([\s\S]*?)<\/h1>/);
const titleLine = first(/class="title-line">([\s\S]*?)<\/div>/);
const sections = [...body.matchAll(/<div class="section">([\s\S]*?)(?=<div class="section">|<\/div>\s*<\/body>)/g)].map((m) => m[1]);
const sec = (t) => sections.find((s) => new RegExp(`section-title">${t}<`).test(s)) || "";
const summaryText = first(/<p class="summary-text">([\s\S]*?)<\/p>/);
const roles = [...sec("Experience").matchAll(/<div class="job">([\s\S]*?)<\/ul>/g)].map(([, j]) => ({
  title: first(/class="job-title">([\s\S]*?)<\/span>/, j),
  company: first(/class="job-company"[^>]*>([\s\S]*?)<\/(?:a|span)>/, j),
  company_url: (j.match(/class="job-company" href="([^"]+)"/) || [])[1] || null,
  dates: first(/class="job-meta">([\s\S]*?)<\/div>/, j),
  bullets: [...j.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1])),
}));
const skillParas = [...sec("Skills").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
const resumeSkills = skillParas.flatMap((p) => p.replace(/\.$/, "").split(/,\s*(?:and\s+)?/)).map((s) => s.trim()).filter(Boolean);
const education = text(sec("Education").replace(/<h2[\s\S]*?<\/h2>/, ""));
const contactLinks = [...body.matchAll(/<a href="(https:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].filter((m) => !/job-company/.test(m[0])).map((m) => ({ url: m[1], label: text(m[2]) }));
if (!summaryText || roles.length < 1 || !resumeSkills.length) throw new Error("resume.html structure not recognised");

// ---------- previous master (preserve toggles + manual corrections) ----------
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const prevById = new Map((prev?.records || []).map((r) => [r.id, r]));

// ---------- helpers ----------
const DATE_RE = /((?:\d{2}\/)?(?:19|20)\d{2}\s*[–-]\s*(?:(?:\d{2}\/)?(?:19|20)\d{2}|Present))/;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const webpSize = (buf) => {
  const t = buf.toString("ascii", 12, 16);
  if (t === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (t === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (t === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  return null;
};
fs.mkdirSync("public/evidence", { recursive: true });
const usedImages = new Set();
function imageFor(entryUrl, th) {
  const file = th.final.split("/").pop();
  const src = `${IMG_DIR}/${file}`;
  if (!fs.existsSync(src)) throw new Error(`missing image ${src}`);
  const buf = fs.readFileSync(src);
  const dim = webpSize(buf) || { width: th.width, height: th.height };
  if (th.width && dim.width !== th.width) throw new Error(`size mismatch ${file}`);
  fs.copyFileSync(src, `public/evidence/${file}`);
  usedImages.add(file);
  return { src: `/evidence/${file}`, file, source_path: `src/images/${file}`, sha256: sha(buf), alt: th.alt, width: dim.width, height: dim.height, captured_url: entryUrl, status: th.status, captured: th.updated || null };
}

// ---------- repository records ----------
const records = [];
for (const r of ev.rows) {
  const links = r.links.map((l) => ({ url: `https://${l.u}`, status: l.s, title: l.t || null, vercel_project: l.p || null, ...(l.nt ? { note: l.nt } : {}), ...(l.sh ? { client_rendered: true } : {}) }));
  const live = links.find((l) => l.status === "live") || null;
  const caps = Object.entries(thumbs).filter(([, t]) => t.repo === r.n && t.status === "captured" && t.final).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const images = caps.map(([u, t]) => imageFor(u, t));
  const primary = (live && images.find((i) => i.captured_url === live.url || thumbs[i.captured_url]?.aliases?.includes(live.url))) || images[0] || null;
  const dateSrc = ["exp", "position_basis"].map((f) => [f, f === "exp" ? r.exp : r.employer?.position_basis]).find(([, v]) => v && DATE_RE.test(v));
  const flags = [];
  if (!r.purpose) flags.push("missing: purpose");
  if (!r.skills?.length) flags.push(`missing: skills${r.skills_note ? ` (${r.skills_note})` : ""}`);
  if (!live) flags.push("missing: live deployment URL");
  if (!primary) flags.push("missing: captured image");
  if (r.employer?.status !== "named") flags.push(`missing: named employer (status ${r.employer?.status || "none"})`);
  if (!dateSrc) flags.push("missing: dates");
  if (r.employer?.status === "named") {
    const roleAt = roles.filter((x) => norm(x.company).includes(norm(r.employer.employer).slice(0, 8)) || norm(r.employer.employer).includes(norm(x.company).slice(0, 8)));
    if (!roleAt.length) flags.push(`conflict-check: employer "${r.employer.employer}" is not a role in the supplied resume`);
    else if (r.employer.position && !roleAt.some((x) => norm(x.title) === norm(r.employer.position))) flags.push(`conflict: evidence position "${r.employer.position}" differs from supplied resume title "${roleAt.map((x) => x.title).join(" / ")}" at ${roleAt[0].company}`);
  }
  records.push({
    id: r.id,
    kind: "repository",
    indexable: true,
    recommendation: r.rec || null,
    title: live?.title || r.n,
    title_source: live?.title ? "evidence-map links[].t (live page title)" : "evidence-map n (repository name)",
    description: r.purpose || null,
    purpose: r.purpose || null,
    functional_keywords: r.functional_keywords || [],
    functional_keywords_note: r.functional_keywords_note || "",
    keywords: r.kw || [],
    skills: r.skills || [],
    skills_note: r.skills_note || "",
    contribution_note: r.contribution_note || "",
    employer: r.employer || null,
    experience_evidence: r.exp || "",
    dates: dateSrc ? { display: dateSrc[1].match(DATE_RE)[1].replace(/\s*[–-]\s*/, " – "), source_field: dateSrc[0] === "exp" ? "exp" : "employer.position_basis" } : null,
    resume_sections: r.sec || [],
    summary_use: r.sum || "",
    family: r.fam || null,
    why: r.why || "",
    confidence: r.conf || null,
    note: r.note || "",
    repository: { owner: "tangiblethinking", name: r.n, url: `https://github.com/tangiblethinking/${r.n}`, private: !!r.priv, fork: !!r.fork, language: r.lang || null, default_branch: r.br || null },
    deployment: { status: r.dstat || null, live_url: live?.url || null, links, vercel_projects: r.projs || [], router_path: r.router || null, old_homepage: r.hist || null },
    supporting_evidence: r.ev || [],
    image: primary,
    images,
    sources: [{ type: "evidence-map", path: MAP, row_id: r.id, map_generated: ev.generated, map_checked: MAP_CHECKED }],
    last_checked: MAP_CHECKED,
    flags,
    manual: {},
  });
}

// ---------- resume record ----------
const resumeText = [
  [name, titleLine].filter(Boolean).join(" — "),
  `Summary: ${summaryText}`,
  ...roles.map((x) => `${x.title}, ${x.company} (${x.dates}). ${x.bullets.join(" ")}`),
  `Skills: ${skillParas.join(" ")}`,
  `Education: ${education}`,
].join("\n");
records.push({
  id: "resume",
  kind: "resume",
  indexable: true,
  recommendation: null,
  title: "Resume",
  title_source: "fixed record title",
  description: summaryText,
  purpose: summaryText,
  functional_keywords: [],
  functional_keywords_note: "",
  keywords: [],
  skills: resumeSkills,
  skills_note: "",
  contribution_note: "",
  employer: { status: "resume", employer: null, position: titleLine, position_basis: "Supplied resume header title line", evidence: "", sources: ["Supplied resume (public/resume.html)"], refs: [] },
  experience_evidence: "",
  dates: null,
  resume_sections: ["Summary", "Experience", "Skills", "Education"],
  summary_use: "",
  family: "Resume",
  why: "",
  confidence: null,
  note: "",
  repository: null,
  deployment: { status: null, live_url: null, links: [], vercel_projects: [], router_path: null, old_homepage: null },
  supporting_evidence: [RESUME],
  image: null,
  images: [],
  resume: { name, title_line: titleLine, summary: summaryText, roles, skills_paragraphs: skillParas, education, links: contactLinks, html: "/resume.html", text: resumeText },
  sources: [{ type: "resume-html", path: RESUME, sha256: sha(resumeHtml) }],
  last_checked: null,
  flags: ["missing: captured image (no resume image source exists)", "missing: dates (resume spans several roles)"],
  manual: {},
});

// ---------- preserve toggles + verified corrections ----------
const carried = [];
for (const rec of records) {
  const old = prevById.get(rec.id);
  if (!old) continue;
  if (typeof old.indexable === "boolean") rec.indexable = old.indexable;
  for (const [k, v] of Object.entries(old.manual || {})) { rec[k] = v; rec.manual[k] = v; }
  if (old.indexable === false || Object.keys(old.manual || {}).length) carried.push(rec.id);
}
const removed = [...prevById.keys()].filter((id) => !records.some((r) => r.id === id));

// ---------- aliases + accounting for existing runtime data ----------
const byName = new Map(records.filter((r) => r.repository).map((r) => [r.repository.name.toLowerCase(), r.id]));
const byUrl = new Map();
for (const r of records) for (const l of r.deployment.links) byUrl.set(l.url.replace(/\/$/, ""), r.id);
for (const [u, t] of Object.entries(thumbs)) { const id = byName.get(String(t.repo || "").toLowerCase()); if (id) { byUrl.set(u.replace(/\/$/, ""), byUrl.get(u.replace(/\/$/, "")) || id); for (const a of t.aliases || []) if (!byUrl.has(a.replace(/\/$/, ""))) byUrl.set(a.replace(/\/$/, ""), id); } }
const aliases = { runtime_ids: {}, urls: Object.fromEntries([...byUrl].sort()) };
const unaccounted = [];
const runtime = JSON.parse(fs.readFileSync("projects.json", "utf8"));
for (const p of runtime.projects || runtime) {
  if (p.id === "resume") { aliases.runtime_ids.resume = "resume"; continue; }
  const [owner, repo] = String(p.repo || "").split("/");
  const id = owner === "tangiblethinking" ? byName.get(repo.toLowerCase()) : null;
  if (id) aliases.runtime_ids[p.id] = id;
  else unaccounted.push({ source: "projects.json", runtime_id: p.id, repo: p.repo || null, reason: owner && owner !== "tangiblethinking" ? `repository owner ${owner} is outside the evidence map (tangiblethinking only); not in the master, so not searchable and not shown as a card` : "no evidence-map record; not searchable and not shown as a card" });
}
// Recent Work URL -> record: exact link/capture URL; else same origin (one record only); else a Vercel branch URL
// <project>-git-<branch>-<scope>.vercel.app whose <project> is a record's Vercel project.
const byOrigin = new Map();
for (const [u, id] of byUrl) { const o = new URL(u).origin; byOrigin.set(o, byOrigin.has(o) && byOrigin.get(o) !== id ? null : id); }
const byProject = new Map();
for (const r of records) for (const l of r.deployment.links) if (l.vercel_project) byProject.set(l.vercel_project, r.id);
function matchRecent(url) {
  const u = url.replace(/\/$/, "");
  if (byUrl.has(u)) return [byUrl.get(u), "exact URL"];
  const o = new URL(u);
  if (byOrigin.get(o.origin)) return [byOrigin.get(o.origin), "same origin as a record link"];
  const g = o.hostname.match(/^(.+?)-git-[a-z0-9-]+\.vercel\.app$/);
  if (g && byProject.has(g[1])) return [byProject.get(g[1]), `Vercel branch URL of project ${g[1]}`];
  return [null, null];
}
const recent = JSON.parse(fs.readFileSync("data/recent-work.json", "utf8")).items.map((it) => {
  const [id, basis] = matchRecent(it.url);
  if (id) aliases.runtime_ids[`recent-${it.id}`] = id;
  else unaccounted.push({ source: "data/recent-work.json", runtime_id: `recent-${it.id}`, url: it.url, reason: "Recent Work URL not in the evidence map; listed from data/recent-work.json only, not searchable" });
  return { recent_id: it.id, url: it.url, record_id: id, match: basis };
});

records.sort((a, b) => (a.kind === "resume" ? -1 : b.kind === "resume" ? 1 : a.id.localeCompare(b.id)));
const doc = {
  format: "portfolio-master",
  format_version: "1.0.0",
  note: "Canonical master collection. Retrieval chunks and card data are derived from this file at runtime (lib/master.ts). Edit `indexable` and `manual` (verified corrections); other fields are regenerated from sources by `npm run build:master`.",
  fallback_company: "consultant/Gig",
  sources: {
    evidence_map: { path: MAP, sha256: sha(mapHtml), format_version: ev.format_version, generated: ev.generated, checked: MAP_CHECKED, rows: ev.rows.length, images_dir: IMG_DIR },
    resume: { path: RESUME, sha256: sha(resumeHtml) },
  },
  counts: { records: records.length, repository: records.filter((r) => r.kind === "repository").length, resume: 1, images: usedImages.size, indexable: records.filter((r) => r.indexable).length },
  refresh: { carried_over: carried, removed_since_last_build: removed },
  aliases,
  recent_work: recent,
  unaccounted,
  records,
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
for (const f of fs.readdirSync("public/evidence")) if (!usedImages.has(f)) fs.unlinkSync(`public/evidence/${f}`);
console.log(`master: ${records.length} records (${doc.counts.repository} repos + resume), ${usedImages.size} images, ${unaccounted.length} unaccounted runtime items, carried ${carried.length}`);
console.log(`flags: ${records.filter((r) => r.flags.some((f) => f.startsWith("conflict:"))).length} conflict, ${records.filter((r) => r.flags.length).length} with any flag`);
