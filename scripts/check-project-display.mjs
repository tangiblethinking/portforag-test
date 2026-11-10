// Deterministic checks for the project card data contract and the approved card/sheet rules. No network, no keys.
// Run: npm run check:projects   (optional: EVIDENCE_MAP=/path/to/html-package/index.html to compare descriptions)
import fs from "node:fs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const doc = JSON.parse(fs.readFileSync("data/project-display.json", "utf8"));
const { projects } = JSON.parse(fs.readFileSync("projects.json", "utf8"));
const idx = JSON.parse(fs.readFileSync("data/index.json", "utf8"));
const idxById = new Map(idx.projects.map((p) => [p.id, p]));
const D = doc.projects;
const allowed = projects.filter((p) => p.allowed);
ok(doc.fallback_company === "consultant/Gig", "fallback company label");
ok(allowed.every((p) => D[p.id]) && Object.keys(D).length === allowed.length, "one display entry per runtime project");
const trunc = /…|\.\.\./;
let ev = null;
if (process.env.EVIDENCE_MAP && fs.existsSync(process.env.EVIDENCE_MAP)) {
  const m = fs.readFileSync(process.env.EVIDENCE_MAP, "utf8").match(/id="evidence-data">([\s\S]*?)<\/script>/);
  ev = new Map(JSON.parse(m[1].replace(/<\\\//g, "</")).rows.map((r) => [r.n, r]));
}
for (const p of allowed) {
  const d = D[p.id], ip = idxById.get(p.id) || {};
  ok(typeof d.company === "string" && d.company.length > 0, `${p.id}: company present`);
  ok(d.companyKnown || d.company === "consultant/Gig", `${p.id}: unknown company uses consultant/Gig`);
  ok(d.date === null || (typeof d.date === "string" && !/unavailable|unknown/i.test(d.date)), `${p.id}: date omitted when missing`);
  ok(d.summary === null || (typeof d.summary === "string" && !trunc.test(d.summary) && /[.!?)”"]$/.test(d.summary)), `${p.id}: full description, no ellipsis`);
  ok(d.summary === null || d.evidenceRepo !== null, `${p.id}: description only from the evidence map`);
  ok(d.summary === null || d.summary !== (ip.summary || "").slice(0, 220) || (ip.summary || "").length < 220, `${p.id}: not the 220-char index cut`);
  if (ev && d.evidenceRepo) ok(ev.get(d.evidenceRepo)?.purpose === d.summary, `${p.id}: description equals evidence purpose`);
  ok(Array.isArray(d.skills) && d.skills.every((s) => typeof s === "string" && s && !trunc.test(s)), `${p.id}: skills are full names`);
  ok(d.liveUrl === null || (/^https:\/\//.test(d.liveUrl) && d.liveUrl === (ip.live_url || p.live_url || ip.figma_url || p.figma_url)), `${p.id}: live URL is the existing runtime URL`);
  if (d.image) {
    const f = "public" + d.image.src;
    const buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
    ok(buf && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP", `${p.id}: image is a WebP in public/`);
    ok(d.image.width === 1000 && d.image.height === 558 && d.image.alt, `${p.id}: image size + alt`);
  }
}
ok(D["virtual-labs"].company === "Glynlyon Inc" && D["virtual-labs"].date === "Timeline 2014 – 2016", "virtual-labs: named company + stated timeline");
ok(D["dls"].company === "consultant/Gig" && D["dls"].date === null, "dls: unconfirmed company falls back, no date");

// Component contract (static source checks)
const cards = fs.readFileSync("components/ProjectCards.tsx", "utf8");
const landing = fs.readFileSync("components/Landing.tsx", "utf8");
ok(!/line-clamp|truncate|text-ellipsis|ellipsis|gradient|\.slice\(0, ?\d/.test(cards), "cards: no clamp/truncate/ellipsis/gradient/slicing");
ok((cards.match(/>\s*See More\s*</g) || []).length === 1 && /justify-end/.test(cards), "cards: See More, right-aligned");
ok(/<h3[\s\S]*?<\/h3>\s*\{!!card\.skills\.length && <SkillsChip/.test(cards), "cards: Skills chip directly beneath the title");
ok(/aria-expanded=\{open\}/.test(cards) && /aria-controls=\{id\}/.test(cards) && /"keydown", onKey, true/.test(cards), "cards: Skills popover a11y + Escape");
ok(!/overflow-(auto|scroll|y-auto)/.test(cards.slice(cards.indexOf("export function ProjectCard("), cards.indexOf("export function ProjectCardGrid"))), "cards: no inner scroll in card");
ok(/aspect-\[1000\/558\][^"]*overflow-hidden rounded-t-\[14px\]/.test(cards), "cards: image wrapper crops, uniform aspect");
const sheet = cards.slice(cards.indexOf("export function ProjectSheet"));
ok(!/Open ↗|View live content|If the preview is blank|Sources|Screenshot|Live content/.test(sheet), "sheet: no external/view-live buttons or helper sections");
ok(!/SkillsChip/.test(sheet) && /<Row k="Skills"><ul/.test(sheet), "sheet: Skills names list, no chip");
ok(/<Dialog\.Title[^>]*>\{card\.title\}<\/Dialog\.Title>\s*<Dialog\.Close/.test(sheet), "sheet: header is title + close only");
ok(/sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/.test(sheet) && /src=\{card\.liveUrl\}/.test(sheet), "sheet: iframe loads live URL immediately, sandbox unchanged");
ok(sheet.indexOf('k="Company"') < sheet.indexOf('k="Date"') && sheet.indexOf('k="Date"') < sheet.indexOf("Dialog.Description") && sheet.indexOf("Dialog.Description") < sheet.indexOf('k="Skills"'), "sheet: company, date, description, skills order");
ok(/<ProjectCardGrid/.test(landing) && /<ProjectSheet/.test(landing), "Landing uses the approved components");
ok((landing.match(/<ExploreCard /g) || []).length === 1, "ExploreCard kept only for Browse and Explore");
console.log(`check-project-display: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
