// Deterministic tests: canonical master coverage/provenance, retrieval (incl. disabled exclusion) and the approved
// card/sheet contract. No network, no keys. Run: npm test
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildChunks, chunksVersion, search, pickCardIds, detectIntent, cardSupport, mentionedIds } from "../lib/retrieval.ts";
import { validateMaster } from "./master-validate.mjs";

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL " + msg); } };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const M = JSON.parse(fs.readFileSync("data/master.json", "utf8"));
const R = new Map(M.records.map((r) => [r.id, r]));
const read0 = (f) => fs.readFileSync(f, "utf8");
const mapHtml = fs.readFileSync(M.sources.evidence_map.path, "utf8");
const ev = JSON.parse(mapHtml.match(/id="evidence-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, "</"));

// ---- 1. supplied resume, unchanged ----
const RESUME_SHA = "8595f33e80b8cd845f7c33421094d6acd1e0233992ebf99fe5dc0c88133f080c";
ok(sha(fs.readFileSync("public/resume.html")) === RESUME_SHA, "public/resume.html is the supplied file byte-for-byte");
ok(M.sources.resume.sha256 === RESUME_SHA, "master records the resume source hash");
ok(sha(mapHtml) === "9e81edfa157f9ce6bd1f237a1fbc6857f18432109eca9cd93a865eaadd7110ae" && M.sources.evidence_map.sha256 === sha(mapHtml), "evidence-map source in repo is the supplied master (hash)");
const res = R.get("resume");
ok(res && res.kind === "resume" && res.indexable === true, "resume record present + indexable");
const rt = res.resume.text;
ok(!/[<>{}]|font-family|var\(--/.test(rt), "resume index text has no markup or styling");
ok(!/480-206|@gmail/.test(rt), "resume index text omits phone/email");
for (const [c, d] of [["Plexus Worldwide", "05/2024 – Present"], ["Freeport-McMoRan", "08/2022 – 10/2023"], ["OpenTech Alliance", "05/2021 – 08/2022"], ["Siemens", "07/2020 – 05/2021"], ["Glynlyon Inc", "02/2014 – 04/2019"]])
  ok(rt.includes(`${c} (${d})`), `resume text keeps role ${c} ${d}`);
ok(/e-commerce platforms, complex B2B applications/.test(res.description) && /industrial software/.test(rt) && /educational platforms/.test(rt), "resume text keeps industry wording verbatim");
ok(res.skills.length === 23 && res.skills.includes("RAG Systems Architecture") && res.skills.includes("WCAG Compliance"), "resume skills parsed from the Skills section");
ok(res.employer.employer === null && res.title === "Resume", "resume record: no person name as company");
ok(!fs.existsSync("data/resume.md") && !fs.existsSync("data/index.json"), "old markdown resume and stale index removed");

// ---- 2. canonical master: coverage, fields, provenance ----
const repos = M.records.filter((r) => r.kind === "repository");
ok(repos.length === 86 && ev.rows.length === 86 && M.records.length === 87, "86 repository records + resume");
ok(new Set(M.records.map((r) => r.id)).size === M.records.length, "stable ids are unique");
ok(eq(repos.map((r) => r.id).sort(), ev.rows.map((r) => r.id).sort()), "ids are the evidence-map stable ids");
// Bug 1 (Nov 11, 2026): exactly these 26 records are switched off (no image source: login wall, functional error, or
// deleted/missing deployment); every other record, including the resume, stays enabled.
const DISABLED = ["fixitaibeta", "portfotest", "pcms", "psms-mbl", "sitetest", "appprotoneov001-rev", "appprotoneov002-pcric", "personabehaviorgravitas", "appprotoneov034pali", "prodportfo", "ape-x-apple-cl007v1-gemini", "ape-x-apple-cl007v1-gemini-002", "appprotoneov006pnu", "cmspayloadtest", "payloadptest", "payload-website-starter", "appprotoneov002-alt", "backsups", "canvas", "cmspayload", "jdapi", "revengany", "payloadcms", "ats-x", "uxrnd", "appprotoneov001"];
ok(DISABLED.length === 26 && DISABLED.every((id) => R.has(id)), "26 disabled ids exist in the master");
ok(eq(M.records.filter((r) => !r.indexable).map((r) => r.id).sort(), [...DISABLED].sort()), "exactly the 26 Bug 1 records are indexable:false");
ok(M.counts.indexable === 61 && M.records.filter((r) => r.indexable).length === 61, "counts.indexable is 61");
ok(eq(M.refresh.carried_over, [...DISABLED].sort()), "disabled ids recorded in refresh.carried_over");
ok(M.records.filter((r) => DISABLED.includes(r.id)).every((r) => eq(r.manual, {})), "disabled records: no other field changes (no manual corrections)");
for (const row of ev.rows) {
  const r = R.get(row.id);
  const f = [
    ["description=purpose", r.description === (row.purpose || null) && r.purpose === (row.purpose || null)],
    ["keywords", eq(r.keywords, row.kw || [])], ["functional_keywords", eq(r.functional_keywords, row.functional_keywords || [])],
    ["skills", eq(r.skills, row.skills || [])], ["skills_note", r.skills_note === (row.skills_note || "")],
    ["employer", eq(r.employer, row.employer)], ["experience", r.experience_evidence === (row.exp || "")],
    ["recommendation", r.recommendation === (row.rec || null)], ["why", r.why === (row.why || "")], ["note", r.note === (row.note || "")],
    ["confidence", r.confidence === (row.conf || null)], ["family", r.family === (row.fam || null)], ["sections", eq(r.resume_sections, row.sec || [])],
    ["contribution", r.contribution_note === (row.contribution_note || "")], ["evidence", eq(r.supporting_evidence, row.ev || [])],
    ["repo", r.repository.name === row.n && r.repository.private === !!row.priv && r.repository.fork === !!row.fork && r.repository.language === (row.lang || null)],
    ["links", eq(r.deployment.links.map((l) => [l.url, l.status, l.title]), row.links.map((l) => [`https://${l.u}`, l.s, l.t || null]))],
    ["vercel", eq(r.deployment.vercel_projects, row.projs || []) && r.deployment.router_path === (row.router || null) && r.deployment.status === (row.dstat || null)],
    ["live_url", r.deployment.live_url === ((row.links.find((l) => l.s === "live") || {}).u ? `https://${row.links.find((l) => l.s === "live").u}` : null)],
    ["provenance", r.sources[0].row_id === row.id && r.last_checked === ev.source.checked],
  ];
  for (const [k, c] of f) ok(c, `${row.id}: ${k} preserved`);
}
// images: actual files only, from the record's own repo
const thumbs = ev.thumbnails.entries;
let imgCount = 0;
for (const r of repos) for (const im of r.images) {
  imgCount++;
  const pub = fs.readFileSync("public" + im.src), src = fs.readFileSync(`data/source/evidence-map/src/images/${im.file}`);
  ok(sha(pub) === sha(src) && im.sha256 === sha(src) && pub.subarray(8, 12).toString() === "WEBP", `${r.id}: image ${im.file} is the captured file`);
  ok(thumbs[im.captured_url]?.repo === r.repository.name && thumbs[im.captured_url].status === "captured", `${r.id}: image belongs to this repo`);
}
const captured = Object.values(thumbs).filter((t) => t.status === "captured" && ev.rows.some((r) => r.n === t.repo));
// resume image: capture of the rendered public/resume.html, registered in src/images/manifest.json
const RESUME_IMG = "resume--portforag-test-resume--landing.webp";
const manifest = JSON.parse(read0("data/source/evidence-map/src/images/manifest.json")).images;
const resCap = manifest.find((c) => c.url === "https://portforag-test.vercel.app/resume.html");
{
  const im = res.image, pub = fs.readFileSync("public/evidence/" + RESUME_IMG), src = fs.readFileSync("data/source/evidence-map/src/images/" + RESUME_IMG);
  ok(resCap && resCap.file === "src/images/" + RESUME_IMG, "resume capture registered in the images manifest");
  ok(im && im.src === "/evidence/" + RESUME_IMG && im.file === RESUME_IMG && im.source_path === "src/images/" + RESUME_IMG && im.captured_url === "https://portforag-test.vercel.app/resume.html" && im.status === "captured", "resume record image resolves to the registered capture");
  ok(sha(pub) === sha(src) && im.sha256 === sha(src) && pub.subarray(8, 12).toString() === "WEBP" && im.width === 1000 && im.height === 558, "resume image file: webp 1000x558, public copy = source");
  ok(eq(res.images, [im]) && !res.flags.some((f) => /captured image/.test(f)) && res.title === "Resume", "resume: one image, missing-image flag cleared, title unchanged");
}
ok(imgCount === captured.length && fs.readdirSync("public/evidence").length === new Set(captured.map((t) => t.final.split("/").pop())).size + 1, `all ${captured.length} captured images of existing repos mapped + resume capture; no extra files`);
ok(R.get("virtuallabs").image.src === "/evidence/virtuallabs--virtual-labs-mu--landing.webp", "virtuallabs image mapping");
ok(R.get("virtuallabs").dates?.display === "2014 – 2016" && R.get("dls").dates === null, "dates only where evidence states them");
ok(repos.every((r) => Array.isArray(r.flags)) && repos.filter((r) => r.flags.some((f) => f.startsWith("conflict:"))).length >= 1, "missing/conflict flags reported");
// aliases + accounting
const runtime = JSON.parse(fs.readFileSync("projects.json", "utf8")).projects;
for (const p of runtime) {
  const mapped = M.aliases.runtime_ids[p.id];
  const acc = M.unaccounted.find((u) => u.runtime_id === p.id);
  ok((mapped && R.has(mapped)) || acc, `runtime id ${p.id} is aliased or explicitly accounted`);
  if (mapped && p.repo) ok(R.get(mapped).repository?.name.toLowerCase() === p.repo.split("/")[1].toLowerCase() || p.id === "resume", `${p.id} alias matches its repo`);
}
ok(M.unaccounted.filter((u) => u.source === "projects.json").length === 7 && M.unaccounted.every((u) => u.reason), "7 PlexusworldwideUX runtime projects accounted as non-search");
const rw = JSON.parse(fs.readFileSync("data/recent-work.json", "utf8")).items;
ok(rw.filter((it) => M.recent_work.some((x) => x.recent_id === it.id && x.record_id && R.has(x.record_id) && x.match === "exact URL")).length === 13, "13 Recent Work URLs map by exact evidence URL");
for (const it of rw) { const x = M.recent_work.find((y) => y.recent_id === it.id); if (x.record_id && x.match === "exact URL") ok(R.get(x.record_id).deployment.links.some((l) => l.url === it.url.replace(/\/$/, "")) || Object.entries(thumbs).some(([u, t]) => (u === it.url || (t.aliases || []).includes(it.url)) && t.repo === R.get(x.record_id).repository.name), `recent ${it.id}: exact alias verified`); }
// explicit named links (not same-site matching): jobs -> ats-x2-prod-main, laws -> html-test, each with its router capture
const EXPLICIT = { jobs: ["ats-x2-prod-main", "ats-x2-prod-main--uxapex-jobs--landing.webp", "https://www.uxapex.com/jobs/"], laws: ["html-test", "html-test--uxapex-laws--landing.webp", "https://www.uxapex.com/laws"] };
ok(eq(M.recent_work.filter((x) => x.match === "explicit link").map((x) => x.recent_id).sort(), Object.keys(EXPLICIT)) && M.recent_work.every((x) => x.record_id), "only jobs + laws use explicit links; every Recent Work item is mapped");
for (const [rid, [rec, file, url]] of Object.entries(EXPLICIT)) {
  const x = M.recent_work.find((y) => y.recent_id === rid), im = R.get(rec).images.find((i) => i.file === file);
  ok(x.record_id === rec && x.image === file && M.aliases.runtime_ids[`recent-${rid}`] === rec, `recent ${rid}: explicit link to ${rec}`);
  ok(im && im.captured_url === url && thumbs[url]?.repo === R.get(rec).repository.name && fs.existsSync("public" + im.src), `recent ${rid}: named image is ${rec}'s own capture of ${url}`);
}
ok(!M.unaccounted.some((u) => u.source === "recent-work.json"), "no Recent Work items left unaccounted");
ok(validateMaster(M).length === 0, "master passes structural validation");
ok(!/build-master|build:master/.test(JSON.parse(read0("package.json")).scripts.build), "npm run build never regenerates (overwrites) data/master.json");

// ---- refresh preserves toggles + verified corrections ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "master-"));
  for (const f of ["scripts/build-master.mjs", "scripts/master-core.mjs", "scripts/master-validate.mjs", "data/source", "public/resume.html", "projects.json", "data/recent-work.json"]) fs.cpSync(f, path.join(tmp, f), { recursive: true });
  const m2 = structuredClone(M);
  const v = m2.records.find((r) => r.id === "virtuallabs");
  v.indexable = false; v.manual = { description: "Verified correction text." };
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  // canonical sync: rebuilding from the committed sources reproduces the committed master byte-for-byte
  fs.writeFileSync(path.join(tmp, "data/master.json"), fs.readFileSync("data/master.json"));
  execFileSync("node", ["scripts/build-master.mjs"], { cwd: tmp, stdio: "pipe" });
  ok(fs.readFileSync(path.join(tmp, "data/master.json"), "utf8") === fs.readFileSync("data/master.json", "utf8"), "committed master is in sync with its sources (rebuild is byte-identical)");
  fs.writeFileSync(path.join(tmp, "data/master.json"), JSON.stringify(m2));
  execFileSync("node", ["scripts/build-master.mjs"], { cwd: tmp, stdio: "pipe" });
  const out = JSON.parse(fs.readFileSync(path.join(tmp, "data/master.json"), "utf8"));
  const v2 = out.records.find((r) => r.id === "virtuallabs");
  ok(v2.indexable === false && v2.description === "Verified correction text." && v2.manual.description === "Verified correction text." && out.refresh.carried_over.includes("virtuallabs"), "source refresh keeps toggle + manual correction");
  ok(v2.source_values.description === R.get("virtuallabs").description && validateMaster(out).length === 0, "source value kept beside the correction; result validates");
  // runtime: a switched-off record disappears from Recent Work and chat cards (no list-only fallback)
  const cards = JSON.parse(execFileSync("node", ["--no-warnings", "-e", `import(${JSON.stringify(path.resolve("lib/master.ts"))}).then(m => { const rw = JSON.parse(require("fs").readFileSync(${JSON.stringify(path.resolve("data/recent-work.json"))}, "utf8")).items; import(${JSON.stringify(path.resolve("lib/browse-cards.ts"))}).then(b => { const rc = m.recentCards(rw); console.log(JSON.stringify({ recent: rc.map(c => c.id), recentImg: Object.fromEntries(rc.map(c => [c.id, c.image?.src ?? null])), enabled: m.enabledCards().map(c => c.id), resume: m.resumeCard(), browse: b.getBrowseCards(m.resumeCard(), rc, "X") })); }); })`], { cwd: tmp, encoding: "utf8" }));
  ok(!cards.recent.includes("recent-vlabs") && cards.recent.length === rw.length - 1, "disabled record removed from Recent Work (no fallback card)");
  ok(cards.recentImg["recent-jobs"] === "/evidence/ats-x2-prod-main--uxapex-jobs--landing.webp" && cards.recentImg["recent-laws"] === "/evidence/html-test--uxapex-laws--landing.webp", "Recent Work jobs/laws cards show the named router captures");
  ok(!cards.enabled.includes("virtuallabs") && cards.enabled.length === 60, "disabled record removed from chat cards");
  ok(DISABLED.every((id) => !cards.enabled.includes(id)), "the 26 disabled records are not chat cards");
  ok(cards.resume.image?.src === "/evidence/" + RESUME_IMG && cards.enabled.includes("resume"), "resume card (Browse + chat) carries the resume image");
  const [b0, b1, b2] = cards.browse;
  ok(cards.browse.length === 3 && b0.id === "resume" && b0.image?.src === "/evidence/" + RESUME_IMG, "Browse: resume card shows the resume image");
  ok(b1.id === "recent" && b1.image?.src === "/evidence/interview--interview-eight-pi--landing.webp", "Browse: Recent Work hub unchanged (still the Interview image)");
  ok(b2.id === "about" && b2.image === null, "Browse: About unchanged (no image)");
  m2.records.find((r) => r.id === "virtuallabs").manual = { bogus: 1 };
  ok(validateMaster(m2).some((e) => /not an editable field/.test(e)), "validation rejects non-editable manual fields");
  ok(out.records.filter((r) => r.id !== "virtuallabs").every((r) => r.indexable === R.get(r.id).indexable), "refresh leaves other toggles as they were");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 4/5. retrieval ----
const chunks = buildChunks(M.records);
const employers = [...new Set(M.records.flatMap((r) => [r.employer?.status === "named" ? r.employer.employer : null, ...(r.resume?.roles || []).map((x) => x.company)]).filter(Boolean))];
const q = (s, recs = chunks) => search(recs, s, { employerNames: employers });
ok(chunks.filter((c) => R.get(c.record_id)?.employer?.status && !["named", "resume"].includes(R.get(c.record_id).employer.status)).every((c) => /do not attribute this project to any employer/.test(c.text)), "unconfirmed-employer chunks say not to attribute an employer");
ok(DISABLED.every((id) => !chunks.some((c) => c.record_id === id)) && !q("FixIt AI beta").hits.some((h) => DISABLED.includes(h.chunk.record_id)), "the 26 disabled records are excluded from retrieval");
ok(chunks.length === 60 + 3 + res.resume.roles.length && chunks.filter((c) => c.record_id !== "resume").every((c) => c.text.includes(R.get(c.record_id).description || "")), "one untruncated chunk per record + resume sections");
{
  const r = q("What industries has he designed for?");
  const ids = r.hits.map((h) => h.chunk.id), recs = new Set(r.hits.map((h) => h.chunk.record_id));
  ok(r.intent === "industries", "industries intent");
  ok(ids.includes("resume#summary") && res.resume.roles.every((_, i) => ids.includes(`resume#role-${i + 1}`)), "industries: resume summary + every role in context");
  ok([...recs].filter((x) => x !== "resume").length >= 4 && recs.has("virtuallabs") && recs.has("moderncheckout"), "industries: projects too (EdTech virtuallabs, e-commerce moderncheckout)");
  const ctx = r.hits.map((h) => h.chunk.text).join(" ");
  ok(/e-commerce/i.test(ctx) && /B2B/.test(ctx) && /industrial/i.test(ctx) && /EdTech/.test(ctx), "industries: context covers e-commerce, B2B, industrial, EdTech");
  const all = new Set(M.records.map((x) => x.id));
  const titles = new Map(M.records.map((x) => [x.id, x.title]));
  ok(pickCardIds([], r, all, { titles }).length === 0, "industries: no citations -> no score-based fallback cards");
  // QA answer text (parent native QA): names Live Metallurgy and Cart/Checkout; sitetest was shown as an unrelated card.
  const qaText = "He has designed for e-commerce (Cart and Checkout Refactor), industrial operations (the Live Metallurgy Dashboard) and EdTech (Odysseyware Virtual Science Labs).";
  const mentioned = mentionedIds(qaText, r, titles);
  const cards = pickCardIds(["resume", "appprotoneov006pnu"], r, all, { mentioned, titles });
  ok(cards.includes("virtuallabs") && (cards.includes("moderncheckout") || cards.includes("appprotocartonovo")) && !cards.includes("sitetest") && !cards.includes("appprotoneov006pnu"), "industries: cards = named Cart/Checkout + Virtual Labs; portfolio-site Live Metallurgy source and unrelated sitetest absent");
  ok(!(cards.includes("moderncheckout") && cards.includes("appprotocartonovo")), "duplicate Cart and Checkout titles collapse to one card");
  ok(cards.every((id) => id === "resume" || (R.get(id).employer.status !== "portfolio" && cardSupport(r, id).length > 0)), "industries: every card has its own substantive evidence");
  const cited = pickCardIds(["resume", "virtuallabs", "html-test", "appprotoneov006pnu"], r, all, { titles });
  ok(!cited.includes("appprotoneov006pnu") && cited.includes("virtuallabs") && cited.includes("resume"), "cited portfolio-site record rejected; supported citations kept");
  console.log("  industries cards:", cards.join(", "), "| cited kept:", cited.join(", "));
}
{
  const r = q("Which companies has he worked for?");
  const ctx = r.hits.map((h) => h.chunk.text).join(" ");
  ok(r.intent === "employers" && ["Plexus Worldwide", "Freeport-McMoRan", "OpenTech Alliance", "Siemens", "Glynlyon Inc"].every((c) => ctx.includes(c)), "employers: all resume employers in context");
  ok(r.hits.some((h) => R.get(h.chunk.record_id)?.employer?.status === "named"), "employers: named-employer project records in context");
  ok(r.hits.filter((h) => h.chunk.group === "portfolio").length <= 2, "employers: portfolio-site records capped");
}
{
  const r = q("What skills does he have?");
  ok(r.intent === "skills" && r.hits[0].chunk.id === "resume#skills" || r.hits.some((h) => h.chunk.id === "resume#skills"), "skills: resume skills in context");
  ok(r.hits.some((h) => h.chunk.record_id !== "resume"), "skills: project evidence in context");
}
{
  const r = q("Can he build simulations?");
  ok(r.intent === "capabilities" && r.records.slice(0, 5).some((x) => R.get(x.id)?.functional_keywords?.some((k) => k.term === "Simulation")), "capabilities: functional keyword Simulation records rank");
}
{
  const titles = new Map(M.records.map((x) => [x.id, x.title]));
  const all = new Set(M.records.map((x) => x.id));
  const r = q("What did he do at Glynlyon?");
  const text = "At Glynlyon Inc he was a Senior UX Designer (02/2014 – 04/2019); the Odysseyware Virtual Science Labs case study covers 2014 – 2016.";
  const cards = pickCardIds(["resume", "virtuallabs", "dls", "infoarchdesign"], r, all, { mentioned: mentionedIds(text, r, titles), titles });
  ok(cards.includes("virtuallabs") && !cards.includes("dls") && !cards.includes("infoarchdesign"), "Glynlyon: Virtual Labs card kept (named employer evidence); unrelated DLS / Incentives IA dropped");
  ok(R.get("virtuallabs").image.src.includes("virtuallabs--virtual-labs-mu"), "Glynlyon: Virtual Labs card uses its own capture");
}
for (const [s, want] of [["Tell me about the Freeport dashboards", "resume"], ["Odysseyware virtual science labs", "virtuallabs"], ["Japan expansion case study", "japan-case-study"], ["information architecture incentives", "infoarchdesign"], ["design language system", "dls"], ["Pull up the resume", "resume"]])
  ok(q(s).records.slice(0, 3).some((x) => x.id === want), `"${s}" -> ${want} in top 3`);
ok(pickCardIds([], q("zzqx flibbertigibbet"), new Set(M.records.map((x) => x.id))).length === 0, "no forced cards when nothing matches");
ok(detectIntent("Pull up the resume") === "resume", "resume intent");
// disabled exclusion (incl. stale paths)
{
  const disabled = M.records.map((r) => (r.id === "virtuallabs" ? { ...r, indexable: false } : r));
  ok(R.get("virtuallabs").recommendation === "Feature", "virtuallabs is a Feature record (label only)");
  const c2 = buildChunks(disabled);
  ok(!c2.some((c) => c.record_id === "virtuallabs"), "disabled record has no chunks");
  ok(!q("Odysseyware virtual science labs", c2).hits.some((h) => h.chunk.record_id === "virtuallabs"), "disabled record not retrieved (Feature does not override)");
  const enabled = new Set(disabled.filter((r) => r.indexable).map((r) => r.id));
  const live = q("Odysseyware virtual science labs");
  ok(!pickCardIds(["virtuallabs"], live, enabled).includes("virtuallabs"), "disabled id cited from a stale context is dropped from cards");
  ok(chunksVersion(c2) !== chunksVersion(chunks), "toggle changes chunk version, so stale vectors are ignored");
  const resOff = M.records.map((r) => (r.id === "resume" ? { ...r, indexable: false } : r));
  ok(!q("What industries has he designed for?", buildChunks(resOff)).hits.some((h) => h.chunk.record_id === "resume"), "disabled resume is not pinned");
}

// ---- 6/7. runtime wiring + approved card/sheet contract ----
const read = (f) => fs.readFileSync(f, "utf8");
const cards = read("components/ProjectCards.tsx"), landing = read("components/Landing.tsx"), page = read("app/page.tsx");
const browse = read("lib/browse-cards.ts"), master = read("lib/master.ts"), rag = read("lib/rag.ts"), route = read("app/api/chat/route.ts");
ok(/<iframe\s+src=\{RESUME_HTML\}[\s\S]*?sandbox="allow-popups allow-popups-to-escape-sandbox"[\s\S]*?flex-1/.test(landing) && /const RESUME_HTML = "\/resume\.html"/.test(landing), "resume sheet renders /resume.html in a sandboxed full-pane iframe");
ok(!/resumeMarkdown|mdLite|dangerouslySetInnerHTML/.test(landing + page), "old markdown resume path removed");
ok(/resume: \(\) => push\(\{ kind: "resume" \}\)/.test(landing) && /if \(p\.id === "resume"\) \{\s*push\(\{ kind: "resume" \}\)/.test(landing), "Browse and chat Resume use the same open action");
ok(/resumeCard\(\)/.test(page) && /enabledCards\(\)/.test(page) && /if \(resume\) cards\.push\(resume\)/.test(browse), "Browse resume card = master resume record = chat resume card");
ok(!/projects\.json|(?<!retrieval-)index\.json|resume\.md|project-display\.json/.test(page + master + rag + route + browse + landing), "runtime reads only the master (no stale 20-project data)");
ok(/filter\(\(r\) => r\.indexable\)/.test(master) && /buildChunks\(enabledRecords\(\)\)/.test(rag) && /pickCardIds\(cited, found, enabledIds\(\)/.test(route), "enabled-only retrieval and cards");
ok(/v\.version === version/.test(rag), "vectors only when version-matched");
ok(!/line-clamp|truncate|text-ellipsis|ellipsis|gradient|\.slice\(0, ?\d/.test(cards), "cards: no clamp/truncate/ellipsis/gradient");
{ const pc = cards.slice(cards.indexOf("export function ProjectCard("), cards.indexOf("function useEqualHeights")); ok((pc.match(/>\s*See More\s*</g) || []).length === 1 && /justify-end/.test(pc), "cards: See More, right-aligned"); }
ok(/<h3[\s\S]*?<\/h3>\s*\{!!card\.skills\.length && <SkillsChip/.test(cards), "cards: Skills chip beneath the title");
const sheet = cards.slice(cards.indexOf("export function ProjectSheet"));
ok(!/Open ↗|View live content|If the preview is blank|Sources|Screenshot|Live content/.test(sheet + landing), "no external/view-live buttons or helper sections");
ok(/<Row k="Skills"><ul/.test(sheet) && /sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/.test(sheet), "project sheet unchanged: skills list + iframe sandbox");
ok((cards.match(/<iframe/g) || []).length === 1 && (landing.match(/<iframe/g) || []).length === 1, "iframes: ProjectSheet + resume sheet only");
ok(/<ProjectCardGrid cards=\{browse\}/.test(landing) && /<ProjectCardGrid cards=\{recent\.slice\(0, top\.shown\)\} onOpen=\{setSheet\} \/>/.test(landing) && /Load more/.test(landing), "Browse + Recent Work keep approved grid + Load more");
ok(!/ExploreCard|NavCard|function Thumb|kind: "work"/.test(landing) && !fs.existsSync("components/Chat.tsx"), "no legacy card paths");

console.log(`test-master: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
