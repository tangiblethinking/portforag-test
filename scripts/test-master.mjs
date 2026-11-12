// Deterministic tests: canonical master coverage/provenance, retrieval (incl. disabled exclusion) and the approved
// card/sheet contract. No network, no keys. Run: npm test
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildChunks, chunksVersion, search, pickCardIds, detectIntent, cardSupport, mentionedIds, restatementGroups, restates, aboutPerson } from "../lib/retrieval.ts";
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
  const cards = JSON.parse(execFileSync("node", ["--no-warnings", "-e", `import(${JSON.stringify(path.resolve("lib/master.ts"))}).then(m => { const rw = JSON.parse(require("fs").readFileSync(${JSON.stringify(path.resolve("data/recent-work.json"))}, "utf8")).items; import(${JSON.stringify(path.resolve("lib/browse-cards.ts"))}).then(b => { const rc = m.recentCards(rw); console.log(JSON.stringify({ recent: rc.map(c => c.id), recentImg: Object.fromEntries(rc.map(c => [c.id, c.image?.src ?? null])), recentSkills: [...new Set(rc.flatMap(c => c.skills))], enabled: m.enabledCards().map(c => c.id), resume: m.resumeCard(), browse: b.getBrowseCards(m.resumeCard(), rc, "X") })); }); })`], { cwd: tmp, encoding: "utf8" }));
  ok(!cards.recent.includes("recent-vlabs") && cards.recent.length === rw.length - 1, "disabled record removed from Recent Work (no fallback card)");
  ok(cards.recentImg["recent-jobs"] === "/evidence/ats-x2-prod-main--uxapex-jobs--landing.webp" && cards.recentImg["recent-laws"] === "/evidence/html-test--uxapex-laws--landing.webp", "Recent Work jobs/laws cards show the named router captures");
  ok(!cards.enabled.includes("virtuallabs") && cards.enabled.length === 60, "disabled record removed from chat cards");
  ok(DISABLED.every((id) => !cards.enabled.includes(id)), "the 26 disabled records are not chat cards");
  ok(cards.resume.image?.src === "/evidence/" + RESUME_IMG && cards.enabled.includes("resume"), "resume card (Browse + chat) carries the resume image");
  const [b0, b1, b2] = cards.browse;
  ok(cards.browse.length === 3 && b0.id === "resume" && b0.image?.src === "/evidence/" + RESUME_IMG, "Browse: resume card shows the resume image");
  ok(b1.id === "recent" && eq(b1.image, { src: "/browse/recent-work--portrait.webp", alt: "Christopher Kenreigh at a desk with holographic mobile UI screens and a user-flow diagram", width: 1000, height: 558 }), "Browse: Recent Work hub shows the supplied hub photo");
  ok(b1.title === "Recent Work" && b1.summary === "Live deployments from the AppProto router — case studies, prototypes, and experiments." && b1.skills.length > 0 && eq(b1.skills, cards.recentSkills), "Browse: Recent Work hub title, summary and skills unchanged");
  ok(cards.recentImg["recent-interview"] === "/evidence/interview--interview-eight-pi--landing.webp", "Recent Work Interview item keeps its own image");
  { const f = fs.readFileSync("public/browse/recent-work--portrait.webp"); ok(f.subarray(8, 12).toString() === "WEBP", "Recent Work hub photo is a webp in public/browse"); }
  ok(b2.id === "about" && b2.title === "About" && b2.summary === "Who Christopher is, how he works, and what to ask next." && eq(b2.skills, ["Design systems", "Design-to-code pipelines", "Data-heavy dashboards", "AI-native (RAG) workflows"]), "Browse: About title, summary and skills unchanged");
  ok(eq(b2.image, { src: "/browse/about--portrait.webp", alt: "Portrait of Christopher Kenreigh", width: 1000, height: 558 }), "Browse: About shows the supplied portrait");
  { const f = fs.readFileSync("public/browse/about--portrait.webp"); ok(f.subarray(8, 12).toString() === "WEBP" && f.readUInt32LE(0) > 0, "About portrait file is a webp in public/browse"); }
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
  ok(cards.every((id) => id === "resume" || cardSupport(r, id).length > 0), "industries: every card has its own substantive evidence");
  const cited = pickCardIds(["resume", "virtuallabs", "html-test", "appprotoneov006pnu"], r, all, { titles });
  ok(!cited.includes("appprotoneov006pnu") && cited.includes("virtuallabs") && cited.includes("resume"), "cited disabled record rejected; supported citations kept");
  console.log("  industries cards:", cards.join(", "), "| cited kept:", cited.join(", "));
}
{
  const r = q("Which companies has he worked for?");
  const ctx = r.hits.map((h) => h.chunk.text).join(" ");
  ok(r.intent === "employers" && ["Plexus Worldwide", "Freeport-McMoRan", "OpenTech Alliance", "Siemens", "Glynlyon Inc"].every((c) => ctx.includes(c)), "employers: all resume employers in context");
  ok(r.hits.some((h) => R.get(h.chunk.record_id)?.employer?.status === "named"), "employers: named-employer project records in context");
  ok(!r.hits.some((h) => h.chunk.record_id !== "resume" && h.chunk.same === "resume"), "employers: resume in context, so its restatements (records titled with his name and their copies) add no context");
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
// ---- card diversity: topic phrases count as a record's own support (Nov 11, 2026) ----
{
  const titles = new Map(M.records.map((x) => [x.id, x.title]));
  const en = new Set(M.records.filter((x) => x.indexable).map((x) => x.id));
  const DS = ["dls", "minicms", "minicms2", "revopoc", "pvoc", "japan-case-study"];
  const titleOf = (ids) => new Set(ids.map((id) => titles.get(id)));
  for (const s of ["Show me the design system work", "Which projects used design systems?"]) {
    const r = q(s);
    ok(r.terms.includes("design system") && DS.every((id) => r.hits.some((h) => h.chunk.record_id === id) && cardSupport(r, id).includes("design system")), `"${s}": design-system records in context, supported by the phrase`);
    // the model cites/names the design-system work (as in live answers); every one becomes a card (titles merge)
    const cards = pickCardIds(["resume", ...DS], r, en, { titles, max: 8 });
    ok(["Tangible DLS", "Compositional Canvas", "Pulse Kit", titles.get("japan-case-study")].every((t) => titleOf(cards).has(t)), `"${s}": design-system project cards shown`);
    ok(cards.some((id) => id !== "resume"), `"${s}": not resume-only`);
    const named = pickCardIds([], r, en, { titles, mentioned: mentionedIds("Key work: Compositional Canvas, Tangible DLS and Pulse Kit.", r, titles) });
    ok(named.length >= 3 && !named.includes("resume"), `"${s}": named titles alone yield cards (never zero)`);
    // a cited in-context record without the phrase in its own evidence is not carded
    const weak = r.hits.map((h) => h.chunk.record_id).find((id) => id !== "resume" && !DS.includes(id) && !cardSupport(r, id).length);
    ok(weak && !pickCardIds([weak], r, en, { titles }).includes(weak), `"${s}": weakly related cited record (${weak}) not carded`);
  }
  // single generic words stay blocked on their own
  for (const s of ["Show me the design work", "Tell me about his system work", "Show product UX experience"]) {
    const r = q(s);
    ok(r.terms.length === 0 && pickCardIds(r.hits.map((h) => h.chunk.record_id).filter((id) => id !== "resume"), r, en, { titles }).length === 0, `"${s}": generic words alone qualify no card`);
  }
  // phrases match the record's own evidence only (variants: DesignOps / design operations)
  const ops = q("How does he approach design ops and governance?");
  ok(["designopscasestudy", "opodesignonovo"].every((id) => cardSupport(ops, id).includes("design ops")), "design ops phrase matches DesignOps / design operations evidence");
  // unindexed records stay out even when they are design-system tools; Feature does not override indexable
  const r = q("Show me the design system work");
  ok(!pickCardIds(["canvas", "pcms", "psms-mbl", "dls"], r, en, { titles }).some((id) => DISABLED.includes(id)), "disabled design-system records never carded");
  const dlsOff = M.records.map((x) => (x.id === "dls" ? { ...x, indexable: false } : x));
  const rOff = q("Show me the design system work", buildChunks(dlsOff));
  ok(R.get("dls").recommendation === "Feature" && !rOff.hits.some((h) => h.chunk.record_id === "dls") && !pickCardIds(["dls"], rOff, new Set(dlsOff.filter((x) => x.indexable).map((x) => x.id)), { titles }).includes("dls"), "Feature dls switched off: not retrieved, not carded");
  // fair resume-only control: Freeport exists only in the resume and portfolio-site records
  const fr = q("Tell me about the Freeport dashboards");
  ok(eq(pickCardIds(fr.hits.map((h) => h.chunk.record_id), fr, en, { titles }), ["resume"]), "Freeport dashboards: resume-only (restatements of the resume collapse into it)");
  // the two screenshot questions (original wording) can produce project cards when project evidence exists
  const lead = q("Can he lead a design system across teams?");
  ok(pickCardIds(["resume", "revopoc"], lead, en, { titles }).includes("revopoc"), "original 'lead a design system' question: Pulse Kit card possible");
  ok(eq(pickCardIds(["resume", "revopoc"], lead, en, { titles }), ["revopoc", "resume"]), "supported project cards come before the resume");
  ok(pickCardIds(["virtuallabs"], q("Pull up the resume"), en, { titles, includeResume: true })[0] === "resume", "resume questions keep the resume first");
  const eng = q("Has he collaborated closely with engineering and PM?");
  ok(pickCardIds(["resume", "pvoc"], eng, en, { titles }).includes("pvoc"), "original 'engineering and PM' question: Pulse Kit card possible");
}
// ---- understanding step + guided offers (lib/understand.ts; model call mocked) ----
{
  const U = await import("../lib/understand.ts");
  const MS = await import("../lib/master.ts");
  const recsOf = (records) => U.orderOfferRecs(records.filter((r) => r.indexable).map((r) => ({ id: r.id, title: r.title, label: MS.recordLabel(r), recommendation: r.recommendation })));
  const groups = restatementGroups(M.records), same = (a, b) => restates(groups, a, b);
  const recs = recsOf(M.records);
  const en = new Set(M.records.filter((x) => x.indexable).map((x) => x.id));
  const titles = new Map(M.records.map((x) => [x.id, x.title]));
  let calls = 0;
  const model = (obj) => async () => { calls++; return JSON.stringify(obj); };
  const boom = async () => { calls++; throw new Error("gemini 500"); };
  // identity questions: resume context, never an empty search; no model call needed
  for (const s of ["who is he?", "Who is he", "what does he do?", "tell me about him", "who is this?", "Who is Christopher Kenreigh?"]) {
    calls = 0;
    const u = await U.understand(s, [], recs, boom);
    const r = q(u.query);
    ok(u.intent === "identity" && u.query === U.IDENTITY_QUERY && calls === 0, `"${s}": understood as identity`);
    ok(r.hits.length > 0 && r.hits.some((h) => h.chunk.id === "resume#summary") && r.hits.some((h) => h.chunk.id === "resume#role-1"), `"${s}": resume summary + current role in context (not zero hits)`);
    ok(pickCardIds(["resume"], r, en, { includeResume: true, titles })[0] === "resume", `"${s}": resume card`);
  }
  ok(q("who is he?").hits.length === 0, "raw 'who is he?' alone would retrieve nothing (why the understanding step exists)");
  // model interpretation: structured only; invalid ids / disabled records dropped; raw words kept in the search
  calls = 0;
  const ds = await U.understand("Show me the design system work", [], recs, model({ intent: "work", query: "design system projects", topics: ["dls", "canvas", "made-up-id", "Pulse Kit"] }));
  ok(calls === 1 && ds.source === "model" && ds.intent === "work" && ds.query.startsWith("Show me the design system work") && eq(ds.topics, ["dls", recs.find((x) => x.title === "Pulse Kit").id]), "model result validated: unknown/disabled topic ids dropped, titles mapped to ids, raw words kept");
  const dsr = q(ds.query);
  const dsCards = pickCardIds(["resume", "minicms", "dls", "revopoc", "japan-case-study"], dsr, en, { titles, max: 3 });
  ok(eq(dsCards.map((id) => titles.get(id)), ["Compositional Canvas", "Tangible DLS", "Pulse Kit"]), "design-system question via understanding: design-system project cards (max 3, projects first)");
  for (const bad of [boom, async () => "not json", async () => JSON.stringify({ intent: "invent", query: "x" })]) {
    const f = await U.understand("Show me the design system work", [], recs, bad);
    ok(f.source === "fallback" && f.query === "Show me the design system work", "model failure / invalid output -> raw question fallback");
  }
  ok((await U.understand("Show me the design system work", [], recs)).query === "Show me the design system work", "no model available -> raw question");
  // follow-ups use recent turns
  const hist = [{ role: "user", text: "Show me the design system work" }, { role: "model", text: "He built Tangible DLS and Pulse Kit." }];
  const more = await U.understand("tell me more", hist, recs, boom);
  ok(more.intent === "followup" && /design system/i.test(more.query) && q(more.query).terms.includes("design system"), "'tell me more' (fallback) searches the previous topic");
  const more2 = await U.understand("tell me more", hist, recs, model({ intent: "followup", query: "Tangible DLS design language system", topics: ["dls"] }));
  ok(more2.intent === "followup" && q(more2.query).records.slice(0, 3).some((x) => x.id === "dls"), "'tell me more' (model) resolves to the previous project");
  // guided offer: related, indexable, supported, not shown, title not shown
  const cands = [...new Set(dsr.hits.map((h) => h.chunk.record_id))].filter((id) => id !== "resume").map((id) => ({ id, supported: cardSupport(dsr, id).length > 0 }));
  const dsPreferred = pickCardIds(["resume", "minicms", "dls", "revopoc", "japan-case-study"], dsr, en, { titles, max: 20 }).filter((id) => !dsCards.includes(id));
  const offer = U.pickOffer({ preferred: dsPreferred, candidates: cands, related: [], cards: dsCards, recs, exclude: [] });
  ok(offer && en.has(offer.id) && !dsCards.includes(offer.id) && !dsCards.map((id) => titles.get(id)).includes(offer.title) && offer.title === titles.get(offer.id), `design-system offer is a real, unshown, indexable record (${offer && offer.title})`);
  ok(offer.id === "japan-case-study", "design-system offer: the cited design-system record that did not fit in 3 cards (International Expansion: Japan)");
  ok(U.pickOffer({ candidates: cands, related: [], cards: dsCards, recs, exclude: [] })?.id === "ape-x-apple", "without citations the offer falls back to a supported in-context record (Apple HIG design-system adoption)");
  ok(U.pickOffer({ candidates: [{ id: "designstyletest", supported: true }], related: [], cards: [], recs, exclude: [] })?.id === "japan-case-study", "same-title builds: the offer and its Yes resolve to one canonical record");
  ok(U.pickOffer({ candidates: [{ id: "canvas", supported: true }, { id: "appprotoneov000", supported: true }, { id: "made-up", supported: true }, { id: "resume", supported: true }], related: [], cards: [], recs, exclude: [], restates: same }) === null, "never offers disabled, unknown or resume records, or a restatement of the resume");
  ok(U.pickOffer({ candidates: cands, related: [], cards: dsCards, recs, exclude: [offer.title] })?.id !== offer.id, "an offered title is not offered again");
  ok(U.pickOffer({ candidates: [{ id: "prod-test", supported: false }], related: [], cards: [], recs, exclude: [] }) === null, "unsupported in-context records are not offered");
  // yes chip / typed yes / decline
  const line = U.offerLine(offer.title), yesMsg = U.yesMessage(offer.title);
  ok(line === `Would you like to know about ${offer.title}?` && yesMsg === `Yes, show me ${offer.title}.`, "offer line + named Yes message use the exact title");
  const afterOffer = [...hist, { role: "model", text: `Here is the work.\n\n${line}` }];
  calls = 0;
  const chip = await U.understand(yesMsg, [], recs, boom);
  ok(chip.intent === "accept_offer" && chip.record_id === offer.id && calls === 0, "Yes chip message resolves to the offered record (no history needed, no model call)");
  for (const y of ["yes", "Yeah", "sure!", "ok please", "Yes please"]) {
    const t = await U.understand(y, afterOffer, recs, boom);
    ok(t.intent === "accept_offer" && t.record_id === offer.id, `typed "${y}" resolves to the last offer`);
  }
  const card = pickCardIds([chip.record_id], { hits: chunks.filter((c) => c.record_id === chip.record_id).map((c) => ({ chunk: c, score: 1 })), records: [], terms: [] }, en, { titles });
  ok(chunks.some((c) => c.record_id === chip.record_id) && en.has(chip.record_id), "accepted record has its own indexed evidence (direct path)");
  ok(card.length === 0, "direct path does not depend on query-term support (route cards the accepted record directly)");
  const no = await U.understand("no thanks", afterOffer, recs, boom);
  ok(no.intent === "decline", "decline drops the offer");
  const other = await U.understand("What AI work has he shipped?", afterOffer, recs, model({ intent: "work", query: "AI products shipped", topics: [] }));
  ok(other.intent === "work" && other.record_id === null && U.offeredTitles(afterOffer).includes(offer.title), "a new question drops the offer; its title stays excluded from later offers");
  ok((await U.understand("yes", hist, recs, boom)).intent !== "accept_offer", "bare yes with no offer is not resolved to a record");
  ok((await U.understand("Yes, show me Made Up Project.", [], recs, boom)).intent !== "accept_offer", "Yes for a title not in the index is not accepted");
  // Feature does not override indexable; disabled records never resolved or offered
  const dlsOff = recsOf(M.records.map((x) => (x.id === "dls" ? { ...x, indexable: false } : x)));
  ok((await U.understand("Yes, show me Tangible DLS.", [], dlsOff, boom)).intent !== "accept_offer" && !U.pickOffer({ candidates: [{ id: "dls", supported: true }], related: ["dls"], cards: [], recs: dlsOff, exclude: [] }), "switched-off Feature record (dls): not accepted, not offered");
  ok(DISABLED.every((id) => !recs.some((x) => x.id === id)), "none of the 26 disabled records can be offered");
  // fair resume-only control
  const fr = await U.understand("Tell me about the Freeport dashboards", [], recs, model({ intent: "work", query: "Freeport-McMoRan operational dashboards", topics: [] }));
  const frr = q(fr.query);
  ok(eq(pickCardIds(frr.hits.map((h) => h.chunk.record_id), frr, en, { titles }), ["resume"]), "Freeport via understanding: still resume-only");
  ok(U.pickOffer({ candidates: [...new Set(frr.hits.map((h) => h.chunk.record_id))].filter((id) => id !== "resume").map((id) => ({ id, supported: cardSupport(frr, id).length > 0 })), related: [], cards: ["resume"], recs, exclude: [], restates: same }) === null, "Freeport: no unrelated offer");
  // wiring
  const rt = read0("app/api/chat/route.ts"), land = read0("components/Landing.tsx");
  ok(rt.indexOf("await understand(") > 0 && rt.indexOf("await understand(") < rt.indexOf("await retrieve(") && /retrieve\(u\.query\)/.test(rt), "route: understanding runs before retrieval, on the rewritten query");
  ok(/sameEmp/.test(rt) && /emps\.has\(r\.employer\.employer\)/.test(rt), "route: related offers prefer the same named employer, then the same family");
  ok(/recordHits\(id\)/.test(rt) && /ids = enabledIds\(\)\.has\(id\) \? \[id\] : \[\]/.test(rt), "route: accepted offer takes the direct path to that record's card");
  ok(/label: "Yes", message: yesMessage\(offer\.title\)/.test(rt) && /offerLine\(offer\.title\)/.test(rt), "route: Yes chip sends a named message; answer asks the offer question");
  ok(/onClick=\{\(\) => ask\(s\.message\)\}/.test(land) && /\{s\.label\}/.test(land) && /offered,/.test(land), "UI: chip shows label, sends message; offered titles sent back");
}
// ---- staged prompts: every pool / follow-up prompt can surface a project card, except fair resume-only ones ----
{
  const cfg = await import("../lib/config.ts");
  const RESUME_ONLY = ["Who is Christopher Kenreigh?", "Tell me about the Freeport dashboards", "Current role details", "Pull up the resume"];
  const prompts = [...new Set([...cfg.OPENING, ...cfg.HIRING_ASKS, ...Object.values(cfg.FOLLOWUPS).flat()])];
  const en = new Set(M.records.filter((x) => x.indexable).map((x) => x.id));
  const cardable = (s) => { const r = q(s); return [...new Set(r.hits.map((h) => h.chunk.record_id))].filter((id) => id !== "resume" && en.has(id) && cardSupport(r, id).length); };
  const none = prompts.filter((s) => !RESUME_ONLY.includes(s) && !cardable(s).length);
  ok(none.length === 0, `every staged prompt has supported project evidence (none: ${none.join(" | ")})`);
  ok(!prompts.some((s) => ["Can he lead a design system across teams?", "Has he collaborated closely with engineering and PM?", "Who is this guy?", "Show current work"].includes(s)), "resume-only staged prompts reworded");
  ok(cfg.HIRING_ASKS.length === 30 && new Set(cfg.HIRING_ASKS).size === 30, "pool keeps 30 distinct prompts");
  for (const [s, id] of [["How has he built and documented design systems like Pulse Kit and Tangible DLS?", "dls"], ["Which projects show his cross-functional collaboration with engineers and SMEs?", "virtuallabs"], ["How did he assess design team maturity in the Design Ops Case Study?", "designopscasestudy"], ["What did the Japan expansion case study at Plexus involve?", "japan-case-study"]])
    ok(cardable(s).includes(id), `reworded "${s}" supports ${id}`);
}
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

// ---- key rotation: timeouts try the next key; per-call time budget ----
{
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  process.env.GEMINI_KEYS = "k1,k2,k3";
  const K = await import("../lib/keys.ts");
  const okRes = () => new Response(JSON.stringify({ v: 1 }), { status: 200 });
  const timeout = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  const parse = async (r) => (await r.json()).v;
  let seen = [];
  ok(await K.withKey((k, sig) => { seen.push(k); ok(sig instanceof AbortSignal, "withKey passes each attempt its own timeout signal"); return k === "k1" ? timeout() : Promise.resolve(okRes()); }, parse, { timeoutMs: 1000 }) === 1 && eq(seen, ["k1", "k2"]), "timeout on the primary key -> backup key tried");
  seen = [];
  ok(await K.withKey((k) => { seen.push(k); return k === "k3" ? Promise.resolve(okRes()) : Promise.reject(new DOMException("aborted", "AbortError")); }, parse) === 1 && eq(seen, ["k1", "k2", "k3"]), "AbortError is retried like a timeout, through every key");
  seen = [];
  ok(await K.withKey((k) => { seen.push(k); return k === "k1" ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(okRes()); }, parse) === 1 && eq(seen, ["k1", "k2"]), "network failure -> next key");
  seen = [];
  ok(await K.withKey((k) => { seen.push(k); return Promise.resolve(k === "k1" ? new Response("err", { status: 500 }) : okRes()); }, parse) === 1 && eq(seen, ["k1", "k2"]), "5xx still tries the next key");
  let err = null; seen = [];
  try { await K.withKey((k) => { seen.push(k); return timeout(); }, parse); } catch (e) { err = e; }
  ok(err instanceof K.KeyTimeoutError && !(err instanceof K.NoKeyError) && seen.length === 3, "every key timing out -> KeyTimeoutError after 3 attempts (not all_keys_busy)");
  err = null; seen = [];
  try { await K.withKey((k) => { seen.push(k); return Promise.resolve(okRes()); }, parse, { deadline: Date.now() + 500 }); } catch (e) { err = e; }
  ok(err instanceof K.KeyTimeoutError && seen.length === 0, "no call is started when the request's time budget is used up");
  let ms = null;
  const real = AbortSignal.timeout;
  AbortSignal.timeout = (t) => { ms = t; return real.call(AbortSignal, t); };
  await K.withKey(() => Promise.resolve(okRes()), parse, { timeoutMs: 20000, deadline: Date.now() + 5000 });
  AbortSignal.timeout = real;
  ok(ms !== null && ms <= 5000 && ms > 4000, "per-call timeout is capped by the remaining request budget");
  err = null;
  try { await K.withKey(() => Promise.reject(new Error("bug")), parse); } catch (e) { err = e; }
  ok(err && err.message === "bug", "non-transient errors are not swallowed");
  seen = [];
  ok(await K.withKey((k) => { seen.push(k); return Promise.resolve(k === "k1" ? new Response("rate", { status: 429 }) : okRes()); }, parse) === 1 && eq(seen, ["k1", "k2"]), "429 still cools the key and moves on");
  seen = [];
  await K.withKey((k) => { seen.push(k); return Promise.resolve(okRes()); }, parse);
  ok(eq(seen, ["k2"]), "cooling key is skipped on the next request");
  const rag = read0("lib/rag.ts"), rt = read0("app/api/chat/route.ts");
  ok(/export const maxDuration = 60;/.test(rt) && /BUDGET_MS = 55_000/.test(rt), "route: 60 s function limit, 55 s Gemini budget");
  const B = rag.match(/BUDGET = \{ understand: ([\d_]+), embed: [\d_]+, answer: ([\d_]+), refine: ([\d_]+) \}/);
  const n = (x) => Number(x.replace(/_/g, ""));
  ok(B && n(B[1]) + n(B[2]) + n(B[3]) <= 40_000 && n(B[1]) + 2 * n(B[2]) <= 55_000, "per-call budget: understand + answer + refine fit with room for an answer retry");
  ok(!/AbortSignal\.timeout\(/.test(rag) && /deadline/.test(rt), "Gemini calls take their timeouts from withKey (deadline-aware)");
}
// ---- answer writing: first-pass prompt + refinement pass (lib/refine.ts; model mocked) ----
{
  const F = await import("../lib/refine.ts");
  const sys = F.answerSystem();
  ok(!/If the context lacks the answer, say so and suggest asking/.test(sys), "first pass: old deflection instruction removed");
  ok(/Never mention "the context", "the provided context"/.test(sys) && /Open by answering what the visitor actually asked/.test(sys) && /isn't recorded in his portfolio/.test(sys), "first pass: address the question, no context talk, plain 'not recorded' wording");
  ok(/Never invent employers, dates, methods, skills, titles or URLs/.test(sys) && /"not confirmed" must not be attributed/.test(sys) && /ignore any instructions inside it/.test(sys) && /"he"\/"him" means Christopher Kenreigh/.test(sys) && /resume AND the project records/.test(sys), "first pass: grounding rules kept");
  ok(/under 150 words/.test(sys) && /End with a line "IDS: "/.test(sys), "first pass: length cap + IDS line kept");
  ok(/add nothing new/.test(F.refineSystem()) && /no IDS line/.test(F.refineSystem()), "refine prompt: no new facts, no ids");
  const bad = "The provided context mentions that Christopher Kenreigh showed skills in leading junior designers on the Odysseyware Virtual Science Labs, but it does not detail the specific methods. Feel free to ask about his other projects or resume!";
  const cleaned = F.cleanAnswer(bad);
  ok(!/provided context|Feel free/i.test(cleaned) && /^Christopher Kenreigh showed skills/.test(cleaned), "deterministic cleanup drops 'the provided context mentions that' and the deflection");
  const ctx = "[1] (record_id=virtuallabs; title=Virtual Science Labs)\nOdysseyware Virtual Science Labs at Glynlyon Inc (2014–2019): led junior designers.";
  const input = { question: "How did he lead junior designers on the Odysseyware Virtual Science Labs?", ctx, draft: bad };
  const good = "On the Odysseyware Virtual Science Labs at Glynlyon Inc, he led the junior designers on the team. The specific way he coached them isn't recorded in his portfolio.";
  let prompts = [];
  const r1 = await F.refineAnswer(input, async (s, p) => { prompts.push([s, p]); return good; });
  ok(r1.refined && r1.text === good, "refinement output used when it adds no facts");
  ok(prompts.length === 1 && prompts[0][1].includes(ctx) && prompts[0][1].includes(input.question) && prompts[0][1].includes(bad), "refinement sees the same question, evidence and draft");
  for (const [out, why] of [["He led designers at Google on Virtual Science Labs, mentoring them weekly.", "new employer"], ["He led junior designers on Virtual Science Labs for 12 years.", "new number"], ["See https://example.com for how he led the junior designers on that project.", "new URL"], ["", "empty"], ["The provided context says he led junior designers on that lab.", "context talk"], [good + "\nIDS: virtuallabs", "IDS line"]]) {
    const r = await F.refineAnswer(input, async () => out);
    ok(!r.refined && r.text === cleaned, `refinement rejected (${why}) -> cleaned draft`);
  }
  for (const boom of [async () => { throw new DOMException("t", "TimeoutError"); }, async () => { throw new Error("gemini 500"); }]) {
    const r = await F.refineAnswer(input, boom);
    ok(!r.refined && r.text === cleaned, "refinement failure/timeout -> draft (never throws)");
  }
  ok((await F.refineAnswer(input)).text === cleaned, "no model available -> draft");
  // route wiring: refine after the first pass, before the offer line; ids from the first pass only
  const rt = read0("app/api/chat/route.ts");
  const iAns = rt.indexOf("await answer(q,"), iRef = rt.indexOf("await refine(q, found.hits, draft"), iOffer = rt.indexOf("offerLine(offer.title)");
  ok(iAns > 0 && iRef > iAns && iOffer > iRef, "route: refinement runs after the answer and before the offer line is appended");
  ok(/text = `\$\{text\}\\n\\n\$\{offerLine\(offer\.title\)\}`/.test(rt), "route: offer line still appended after refinement, unchanged");
  ok(/await refine\(ask, own, draft/.test(rt) && rt.indexOf("await refine(ask") < iOffer, "route: accepted-offer direct path is refined too");
  ok(/const m = raw\.match\(\/IDS:/.test(rt) && /mentionedIds\(draft, found, titles\)/.test(rt) && (rt.match(/await retrieve\(/g) || []).length === 1, "route: card ids from the first pass; no second retrieval");
}
// ---- traditional portfolio card (header Portfolio + chat failure) ----
{
  const pc = JSON.parse(execFileSync("node", ["--no-warnings", "-e", `import(${JSON.stringify(path.resolve("lib/master.ts"))}).then(m => console.log(JSON.stringify(m.portfolioCard())))`], { encoding: "utf8" }));
  const pr = R.get("portfoprod");
  ok(pc && pc.liveUrl === "https://uxapex.com/portfolio" && pr.deployment.live_url === "https://portfoprod.vercel.app", "portfolio card opens uxapex.com/portfolio; master live_url unchanged");
  ok(pc.title === pr.title && pc.summary === pr.description && eq(pc.skills, pr.skills) && pc.image.src === pr.image.src && fs.existsSync("public" + pc.image.src), "portfolio card: title/summary/skills/capture from the portfoprod record");
  ok(pc.id !== "portfoprod" && !R.has(pc.id), "portfolio card has its own display id (never returned by retrieval)");
  const en = new Set(M.records.filter((x) => x.indexable).map((x) => x.id));
  const titles = new Map(M.records.map((x) => [x.id, x.title]));
  // ---- general answer + card pipeline (Nov 12, 2026): no record class banned, restatement rule, asked-for records ----
  const U = await import("../lib/understand.ts");
  const MS = await import("../lib/master.ts");
  const SITES = M.records.filter((r) => r.indexable && r.employer?.status === "portfolio").map((r) => r.id);
  const recs = U.orderOfferRecs(M.records.filter((r) => r.indexable).map((r) => ({ id: r.id, title: r.title, label: MS.recordLabel(r), recommendation: r.recommendation })));
  const groups = restatementGroups(M.records), same = (a, b) => restates(groups, a, b);
  // understand: catalog = every indexable record, each with a distinguishing label from its own fields
  ok(SITES.length === 10 && recs.length === en.size && SITES.every((id) => recs.some((x) => x.id === id)), "understand catalog includes every indexable record (portfolio-site records no longer omitted as a class)");
  const prompt = U.understandPrompt("Open his portfolio website", [], recs);
  ok(recs.every((x) => x.label && prompt.includes(`${x.id} | ${x.title} | ${x.label}`)), "understand catalog: id | title | label for every record");
  const ck = recs.filter((x) => x.title === "Christopher Kenreigh");
  ok(ck.length === 4 && new Set(ck.map((x) => x.label)).size === 4, "records sharing a title get distinct labels");
  ok(recs.find((x) => x.id === "portfoprod").label.includes("live at uxapex.com/portfolio") && recs.find((x) => x.id === "portfocorrect").label.includes("live at portfocorrect.vercel.app") && /^his resume/.test(recs.find((x) => x.id === "resume").label), "labels say which is the live uxapex.com/portfolio site, which a copy, which the resume");
  ok(recs.every((x) => { const r = R.get(x.id); return x.id === "resume" || [r.family, MS.publicUrl(r)?.replace(/^https?:\/\/(www\.)?/, ""), (r.description || "").slice(0, 40)].filter(Boolean).every((p) => x.label.includes(p)); }), "labels use only the record's own family, recorded URL and description (no invented facts)");
  ok(/open = the visitor wants to see, open, visit or pull up a specific site, page, project or document/.test(prompt) && U.ASKS_FOR_RECORD.includes("open") && U.ASKS_FOR_RECORD.includes("project"), "general show/open intent in the understanding step");
  // general show/open intent names a referenced record — two different fixtures (same code path)
  const routeLike = async (msg, modelOut, cited) => {
    const u = await U.understand(msg, [], recs, async () => JSON.stringify(modelOut));
    const base = q(u.query), have = new Set(base.hits.map((h) => h.chunk.record_id));
    const extra = u.topics.filter((id) => id !== "resume" && !have.has(id)).flatMap((id) => chunks.filter((c) => c.record_id === id).map((chunk) => ({ chunk, score: 0 })));
    const found = { ...base, hits: [...base.hits, ...extra] };
    const asked = U.ASKS_FOR_RECORD.includes(u.intent) ? u.topics : [];
    return { u, found, ids: pickCardIds(cited, found, en, { titles, asked, mentioned: mentionedIds("Christopher Kenreigh", found, titles), max: 3 }) };
  };
  const tp = await routeLike("Open his portfolio website", { intent: "open", query: "Christopher Kenreigh traditional portfolio website", topics: ["portfoprod"] }, ["resume", "portfoprod"]);
  ok(tp.u.intent === "open" && eq(tp.u.topics, ["portfoprod"]) && tp.found.hits.some((h) => h.chunk.record_id === "portfoprod"), "open intent: the named record is added to the context");
  ok(tp.ids[0] === "portfoprod" && !tp.ids.includes("resume") && !tp.ids.some((id) => id !== "portfoprod" && same(id, "portfoprod")), "open the traditional portfolio site: that record is the card; the resume and other copies collapse into it");
  const disp = MS.displayCardIds(tp.ids), pcard = MS.portfolioCard();
  ok(disp[0] === "traditional-portfolio" && pcard.id === disp[0] && pcard.liveUrl === "https://uxapex.com/portfolio", "a selected portfoprod maps to the special traditional-portfolio card (https://uxapex.com/portfolio, PortfolioSheet)");
  ok(eq(MS.displayCardIds(["virtuallabs", "resume", "dls"]), ["virtuallabs", "resume", "dls"]), "display mapping leaves every other card id unchanged (ProjectSheet)");
  const ow = q("Open his portfolio website");
  ok(ow.terms.length === 0 && !pickCardIds(ow.hits.map((h) => h.chunk.record_id), ow, en, { titles }).some((id) => id !== "resume"), "request/navigation words (open, website …) alone support no card (e.g. not the job board for 'open roles')");
  const vl = await routeLike("Pull up the Odysseyware labs site", { intent: "open", query: "Odysseyware Virtual Science Labs site", topics: ["virtuallabs"] }, []);
  ok(vl.u.intent === "open" && vl.ids[0] === "virtuallabs" && eq(MS.displayCardIds(vl.ids), vl.ids), "open intent is general: a second fixture (Virtual Labs) is selected the same way, as a regular card");
  const ap = await routeLike("Show me the chat portfolio app itself", { intent: "open", query: "chat-based portfolio app", topics: ["portforag-test"] }, ["resume"]);
  ok(ap.ids[0] === "portforag-test", "open intent: another record titled with his name (this chat app) can be asked for");
  // enabled-only: an asked-for disabled record is never a card
  const offSet = new Set([...en].filter((id) => id !== "portfoprod"));
  ok(!pickCardIds([], tp.found, offSet, { titles, asked: ["portfoprod"] }).includes("portfoprod"), "asked-for record switched off (indexable false): not carded");
  // retrieve: no class drop/downweight by employer status
  const resOffChunks = buildChunks(M.records.map((r) => (r.id === "resume" ? { ...r, indexable: false } : r)));
  const relabel = resOffChunks.map((c) => (c.group === "portfolio" ? { ...c, group: "named" } : c));
  const sq = "Christopher Kenreigh portfolio site uxapex Director of UX & Product Design";
  const a1 = search(resOffChunks, sq, {}), a2 = search(relabel, sq, {});
  ok(a1.hits.some((h) => SITES.includes(h.chunk.record_id)) && eq(a1.hits.map((h) => `${h.chunk.id}:${h.score}`), a2.hits.map((h) => `${h.chunk.id}:${h.score}`)), "retrieval: employer status (portfolio) does not change any score or hit");
  for (const f of ["lib/retrieval.ts", "lib/understand.ts", "app/api/chat/route.ts", "lib/rag.ts"]) {
    const src = fs.readFileSync(f, "utf8");
    ok(!/(group|status)\s*[!=]==?\s*"portfolio"|PORTFOLIO_(WEIGHT|CAP)/.test(src), `${f}: no class ban by employer status / group "portfolio"`);
    ok(!src.split("\n").some((l) => /portfolio/i.test(l) && /\/[^/\n]*portfolio[^/\n]*\/[a-z]*\.(test|exec)\(|match\(\/[^/\n]*portfolio|RegExp\([^)]*portfolio|includes\(["'`][^"'`]*portfolio/i.test(l)), `${f}: no prompt-language branch on the word "portfolio"`);
  }
  // restatement rule (general): groups by shared title, near-copy description, or being about the person
  ok(SITES.every((id) => same(id, "resume")) && aboutPerson("Christopher Kenreigh — Director of UX & Product Design | USA · Remote-Ready", "Christopher Kenreigh") && !aboutPerson("International Expansion: Japan — Christopher Kenreigh", "Christopher Kenreigh"), "restatement: records titled with his name (and near-copies) restate the resume; a case study that merely mentions him does not");
  ok(same("minicms", "minicms2") && same("pvoc", "revopoc") && same("appprotoneov000", "appprotoneov001ai") && !same("interview", "testrecruiter") && !same("dls", "minicms") && !same("japan-case-study", "resume"), "restatement: same title / near-copy description collapse; distinct records stay distinct");
  ok(chunks.every((c) => c.same === (groups.get(c.record_id) ?? c.record_id)), "chunks carry their restatement group");
  const allHits = { hits: chunks.map((chunk) => ({ chunk, score: 1 })), records: [], terms: ["design system"] };
  ok(eq(pickCardIds(["minicms", "minicms2", "dls", "revopoc", "pvoc"], allHits, en, { titles }), ["minicms", "dls", "revopoc"]), "cards: restatements of an already-selected record collapse to the first");
  ok(pickCardIds(["minicms", "dls", "revopoc", "japan-case-study", "ape-x-apple"], allHits, en, { titles, max: 3 }).length === 3, "cards: cap 3");
  // bio / "who is he": a pile of Christopher Kenreigh site cards collapses into the resume
  const idq = q(U.IDENTITY_QUERY);
  ok(!idq.hits.some((h) => SITES.includes(h.chunk.record_id)), "who is he: retrieval context is the resume, not its restatements");
  const bio = { ...idq, hits: [...idq.hits, ...chunks.filter((c) => SITES.includes(c.record_id) || c.record_id === "portforag-test").map((chunk) => ({ chunk, score: 0 }))] };
  const bioCards = pickCardIds(["resume", "portfoprod", "portfocorrect", "appprotoneov002", "testportfo", "appprotoneov000"], bio, en, { titles, includeResume: true, mentioned: mentionedIds("Christopher Kenreigh is a Lead UX Designer.", bio, titles), max: 3 });
  ok(eq(bioCards, ["resume"]), "who is he (model cites several Christopher Kenreigh sites): the Resume card only, no near-identical site cards");
  // offers: no class ban; skip shown / offered / restatements
  const rel = restatementGroups(M.records.map((r) => (r.id === "virtuallabs" ? { ...r, employer: { ...r.employer, status: "portfolio" } } : r)));
  ok(U.pickOffer({ candidates: [{ id: "virtuallabs", supported: true }], related: [], cards: [], recs, exclude: [], restates: (a, b) => restates(rel, a, b) })?.id === "virtuallabs", "offers: a record is not excluded for its employer status (virtuallabs relabelled portfolio is still offered)");
  ok(U.pickOffer({ candidates: [{ id: "appprotoneov001ai", supported: true }, { id: "portfocorrect", supported: true }], related: [], cards: ["appprotoneov000"], recs, exclude: [], restates: same }) === null, "offers: a restatement of a shown card (or of the resume) is not offered");
  ok(U.pickOffer({ candidates: [{ id: "minicms2", supported: true }, { id: "virtuallabs", supported: true }], related: [], cards: ["minicms"], recs, exclude: [], restates: same })?.id === "virtuallabs" && U.pickOffer({ candidates: [{ id: "virtuallabs", supported: true }], related: [], cards: [], recs, exclude: [titles.get("virtuallabs")], restates: same }) === null, "offers: already shown / already offered still skipped");
  const rt2 = fs.readFileSync("app/api/chat/route.ts", "utf8");
  ok(/project_ids: displayCardIds\(ids\)/.test(rt2) && /restates: sameRecord/.test(rt2) && /asked = ASKS_FOR_RECORD\.includes\(u\.intent\) \? u\.topics : \[\]/.test(rt2) && /enabledRecords\(\)\.map\(\(r\) => \(\{ id: r\.id, title: r\.title, label: recordLabel\(r\)/.test(rt2), "route wiring: full labelled catalog, asked-for records, restatement rule for offers, portfoprod shown as the special card");
  const land = read0("components/Landing.tsx");
  ok(/onClick=\{\(\) => setPortfolioOpen\(true\)\}[\s\S]*?Portfolio/.test(land) && /<PortfolioSheet card=\{portfolioOpen \? portfolio : null\}/.test(land) && /<ProjectSheet card=\{sheet\}/.test(land), "header Portfolio opens the dedicated PortfolioSheet; other cards keep ProjectSheet");
  ok(/if \(portfolio && p\.id === portfolio\.id\) \{\s*setPortfolioOpen\(true\);/.test(land), "chat failure card (portfolio) opens the dedicated PortfolioSheet");
  { const cardsSrc = fs.readFileSync("components/ProjectCards.tsx", "utf8"); const ps = cardsSrc.slice(cardsSrc.indexOf("export function PortfolioSheet")); ok(ps.length > 30 && (ps.match(/<iframe/g) || []).length === 1 && !/<aside|<Row|Company|Skills|Dialog\.Description|description=/.test(ps), "PortfolioSheet: title + close + iframe only (no details column)"); }
  ok(!/Network hiccup/.test(land) && /catch \{\s*m = \{[^}]*ids: failIds/.test(land) && /all_keys_busy" \? \[\.\.\.failIds, "resume"\]/.test(land), "failures show the portfolio card (plus resume when busy)");
}
// ---- landing UI: nav, chat column, footer, quotes ----
{
  const land = read0("components/Landing.tsx");
  ok(!/Google Gemini|Questions are sent to/.test(land), "visitor-facing Gemini footer removed");
  ok(/href="\/contact" className="hidden[^"]*sm:block"/.test(land) && /aria-label="Toggle dark mode" className="hidden[^"]*sm:block"/.test(land) && /aria-label="Open menu"[^>]*sm:hidden/.test(land), "desktop: Contact + theme in header; mobile: hamburger only");
  ok(/className="drawer fixed inset-y-0 right-0[^"]*sm:hidden"/.test(land) && /<Link href="\/contact" onClick=\{\(\) => setMenu\(false\)\}/.test(land) && /onClick=\{toggle\} aria-pressed/.test(land), "mobile side sheet: Contact (closes it) + light/dark control");
  // mobile composer: one fixed bar at the bottom of the visible viewport from first load; desktop stays in-flow
  const css = read0("app/globals.css");
  const mob = css.slice(css.indexOf("@media (max-width: 639.98px)"));
  ok(/@media \(max-width: 639\.98px\)/.test(css) && /\.composer-bar \{ position: fixed; left: 0; right: 0; bottom: var\(--vv-bottom, 0px\); z-index: 30;[^}]*padding-bottom: max\(0\.75rem, env\(safe-area-inset-bottom\)\)/.test(mob), "mobile: composer is position:fixed at the visual-viewport bottom, z 30 (above header z-20, below sheets z-50), safe-area padded");
  ok(/html\[data-kb="open"\] \.composer-bar \{ padding-bottom: 0\.5rem; \}/.test(mob), "keyboard open: tight bottom padding, no safe-area double pad");
  ok(/\.landing-pad \{ padding-bottom: calc\(var\(--composer-h/.test(mob) && /"landing-pad min-h-dvh pb-10"/.test(land), "landing (mobile): bottom padding = composer height so the last chips scroll above the bar");
  ok(/\.chat-shell \{ position: fixed;[^}]*top: var\(--vv-top, 0px\); height: var\(--vv-height, 100dvh\); padding-bottom: var\(--composer-h/.test(mob) && /"chat-shell h-dvh overflow-hidden"/.test(land), "chat (mobile): shell fills the visual viewport and leaves room for the bar; desktop: h-dvh column");
  const comp0 = land.slice(land.indexOf("const composer"), land.indexOf("const thread"));
  ok(/ref=\{bar\}/.test(comp0) && /composer-bar flex-none/.test(comp0) && /sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0/.test(comp0) && /sm:-mx-6 sm:px-6 sm:pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/.test(comp0) && !/(^|\s)(fixed|sticky)(\s|")/.test(comp0), "composer: fixed only via the mobile .composer-bar rule; desktop landing in-flow under the chips, desktop chat a flex-none bottom row");
  ok((land.match(/\{composer\}/g) || []).length === 1 && land.indexOf("{composer}") > land.lastIndexOf("{homeChips.map") && land.indexOf("{composer}") < land.indexOf("<SheetShell"), "the same composer element renders in both modes (outside the mode switch): bar from first load, no remount");
  ok(/ref=\{box\} className="[^"]*min-h-0 flex-1 overflow-y-auto overscroll-contain/.test(land) && !/sticky bottom-0/.test(land), "chat: the thread is the only scrolling region");
  ok(/trackVisualViewport\(root\)/.test(land) && /new ResizeObserver\(\(\) => root\.style\.setProperty\("--composer-h"/.test(land) && /root\.style\.removeProperty\("--composer-h"\)/.test(land), "Landing tracks the visual viewport + composer height from mount and cleans up");
  {
    const lock = land.slice(land.indexOf("// chat mode: lock the page"), land.indexOf("function refreshHomeChips"));
    ok(/if \(!chatMode\) return;/.test(lock) && /html\.style\.overflow = "hidden"/.test(lock) && /body\.style\.overflow = "hidden"/.test(lock) && /html\.style\.overflow = prev\[0\]/.test(lock) && /body\.style\.overflow = prev\[1\]/.test(lock) && /\[chatMode\]\);/.test(lock), "html/body overflow locked only in chat mode, restored on leaving/unmount");
  }
  ok(/interactiveWidget: "resizes-content"/.test(read0("app/layout.tsx")), "layout keeps interactive-widget: resizes-content (Chrome/Android)");
  {
    const V = await import("../lib/visual-viewport.ts");
    const e = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    ok(e(V.viewportInsets(844), { top: 0, height: 844, bottom: 0, keyboard: false }) && e(V.viewportInsets(844, null), V.viewportInsets(844)), "insets: no visualViewport -> full window, bar at bottom 0");
    ok(e(V.viewportInsets(844, { height: 844, offsetTop: 0 }), { top: 0, height: 844, bottom: 0, keyboard: false }), "insets: keyboard closed -> bottom 0, safe-area padding kept");
    ok(e(V.viewportInsets(844, { height: 508, offsetTop: 0 }), { top: 0, height: 508, bottom: 336, keyboard: true }), "insets: iOS keyboard (visual viewport shrinks) -> bar lifted by innerHeight - vv.height - offsetTop");
    ok(e(V.viewportInsets(844, { height: 508, offsetTop: 120 }), { top: 120, height: 508, bottom: 216, keyboard: true }), "insets: iOS pans the visual viewport -> offsetTop subtracted, shell top follows");
    ok(V.viewportInsets(844, { height: 820, offsetTop: 0 }).keyboard === false && V.viewportInsets(844, { height: 900, offsetTop: 0 }).bottom === 0, "insets: toolbar jitter below the threshold is not a keyboard; never negative");
    // wiring against a fake window/visualViewport
    const ls = {}, wl = {}, props = {}, root = { style: { setProperty: (k, v) => (props[k] = v), removeProperty: (k) => delete props[k] }, dataset: {} };
    const vv = { height: 844, offsetTop: 0, addEventListener: (t, f) => (ls[t] = f), removeEventListener: (t) => delete ls[t] };
    const g = globalThis, saved = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
    g.window = { innerHeight: 844, visualViewport: vv, addEventListener: (t, f) => (wl[t] = f), removeEventListener: (t) => delete wl[t] };
    g.requestAnimationFrame = (f) => (f(), 0);
    g.cancelAnimationFrame = () => {};
    const stop = V.trackVisualViewport(root);
    ok(props["--vv-bottom"] === "0px" && props["--vv-height"] === "844px" && root.dataset.kb === "closed" && ls.resize && ls.scroll && wl.resize, "wiring: listens to visualViewport resize + scroll and window resize; first-load values set");
    vv.height = 500; vv.offsetTop = 40; ls.resize();
    ok(props["--vv-bottom"] === "304px" && props["--vv-top"] === "40px" && props["--vv-height"] === "500px" && root.dataset.kb === "open", "wiring: keyboard open -> bar bottom/shell follow the visual viewport, data-kb=open");
    vv.height = 844; vv.offsetTop = 0; ls.scroll();
    ok(props["--vv-bottom"] === "0px" && root.dataset.kb === "closed", "wiring: keyboard closed again -> back to the bottom, safe-area padding");
    stop();
    ok(!Object.keys(props).length && !("kb" in root.dataset) && !ls.resize && !ls.scroll && !wl.resize, "wiring: cleanup removes listeners, vars and data-kb");
    Object.assign(g, { window: saved.window, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
  }
  const comp = land.slice(land.indexOf("const composer"), land.indexOf("const thread"));
  ok(!/suggestions|<p /.test(comp), "composer is only the input and Send");
  ok(/min-h-\[calc\(var\(--thread-h/.test(land) && /lastAnswer\.current/.test(land) && !/scrollIntoView/.test(land), "chips live in the thread below the latest answer; scrolling targets the answer, not the chips");
  const cfg = await import("../lib/config.ts");
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const draw = cfg.makeDeck(cfg.SCIFI, rnd);
  const first = Array.from({ length: cfg.SCIFI.length }, draw);
  ok(new Set(first).size === cfg.SCIFI.length, "loading quotes: every line shown once before any repeat");
  const seq = [...first, ...Array.from({ length: 200 }, draw)];
  ok(seq.every((x, i) => i === 0 || x !== seq[i - 1]), "loading quotes: never the same line twice in a row (incl. reshuffles)");
  ok(/quotes\.current\(\)/.test(land) && !/SCIFI\[Math\.floor/.test(land) && /2500\)/.test(land), "Landing uses the shuffled deck at 2500 ms");
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
const sheet = cards.slice(cards.indexOf("export function ProjectSheet"), cards.indexOf("export function PortfolioSheet"));
ok(!/Open ↗|View live content|If the preview is blank|Sources|Screenshot|Live content/.test(sheet + landing), "no external/view-live buttons or helper sections");
ok(/<Row k="Skills"><ul/.test(sheet) && /sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/.test(sheet), "project sheet unchanged: skills list + iframe sandbox");
ok((cards.match(/<iframe/g) || []).length === 2 && (landing.match(/<iframe/g) || []).length === 1, "iframes: ProjectSheet + PortfolioSheet + resume sheet only");
ok(/<ProjectCardGrid cards=\{browse\}/.test(landing) && /<ProjectCardGrid cards=\{recent\.slice\(0, top\.shown\)\} onOpen=\{setSheet\} \/>/.test(landing) && /Load more/.test(landing), "Browse + Recent Work keep approved grid + Load more");
ok(!/ExploreCard|NavCard|function Thumb|kind: "work"/.test(landing) && !fs.existsSync("components/Chat.tsx"), "no legacy card paths");

// ---- display URLs: routed deployments are shown/cited at https://uxapex.com{path} (router snapshot) ----
{
  const MS = await import("../lib/master.ts");
  const live = JSON.parse(read("data/appproto-vercel.json")).rewrites;
  ok(live.some((x) => x.source === "/:path*" && x.destination === "https://portforag-test.vercel.app/:path*") && live.some((x) => x.source === "/" && x.destination === "https://portforag-test.vercel.app"), "router snapshot matches live AppProtoNeoRouter (catch-all -> portforag-test)");
  const EXPECT = { interview: "/interview", portfoprod: "/portfolio", "ats-x2-prod-main": "/jobs", moderncheckout: "/cart", oma: "/oma", infoarchdesign: "/ia", virtuallabs: "/vlabs", "html-test": "/laws", "ape-x-apple-cl007v1-gemini-001": "/ape", appprotoneov001ai: "/portfolioa32", designopscasestudy: "/designops", "directorcasestudy-ux-bgoals": "/ecomm", companyuxtransform: "/uxtrans", teststudynew: "/discovery", persongratadata: "/persona", opodesignonovo: "/collaboration" };
  for (const [id, p] of Object.entries(EXPECT)) {
    const r = R.get(id), c = MS.recordToCard(r);
    ok(c.liveUrl === `https://uxapex.com${p}` && MS.publicUrl(r) === c.liveUrl && r.deployment.live_url && /\.vercel\.app/.test(r.deployment.live_url), `routed ${id}: card iframe + public URL = https://uxapex.com${p} (no www, no trailing slash); master live_url unchanged`);
  }
  const routed = [...MS.routes().byRecord.keys()].sort();
  ok(eq(routed, Object.keys(EXPECT).sort()), "exactly the concrete router rewrites are remapped (no catch-all, no /job, no invented paths)");
  ok([...MS.routes().byRecord.values()].every((u) => /^https:\/\/uxapex\.com\/[a-z0-9]+$/.test(u)), "display URLs: apex uxapex.com, single path, no www/trailing slash");
  ok(R.get("html-test").deployment.live_url === "https://uxlegal.vercel.app" && R.get("designopscasestudy").deployment.live_url === "https://design-ops-case-study-alt.vercel.app", "laws/designops matched although live_url differs from the router destination");
  for (const id of ["japan-case-study", "minicms", "dls", "pvoc", "appprotoneov002", "portfocorrect"]) { const r = R.get(id); ok(MS.recordToCard(r).liveUrl === r.deployment.live_url && /\.vercel\.app$/.test(r.deployment.live_url), `unrouted ${id}: keeps recorded live_url`); }
  for (const id of ["appprotoneorouter", "portforag-test"]) { const r = R.get(id); ok(MS.recordToCard(r).liveUrl === r.deployment.live_url && MS.recordToCard(r).liveUrl !== "https://uxapex.com/" && MS.recordToCard(r).liveUrl !== "https://uxapex.com", `catch-all / chat record ${id} not remapped to the router root`); }
  ok(MS.portfolioCard().liveUrl === "https://uxapex.com/portfolio" && eq(MS.displayCardIds(["directorcasestudy-ux-bgoals"]), ["directorcasestudy-ux-bgoals"]), "portfolio card still uxapex.com/portfolio (PortfolioSheet); routed ecomm stays a regular card (ProjectSheet with details)");
  const rc = MS.recentCards(JSON.parse(read("data/recent-work.json")).items);
  ok(rc.length > 0 && rc.every((c) => /^https:\/\/uxapex\.com\/[a-z0-9]+$/.test(c.liveUrl)) && rc.find((c) => c.id === "recent-ecomm").liveUrl === "https://uxapex.com/ecomm" && rc.find((c) => c.id === "recent-laws").liveUrl === "https://uxapex.com/laws", "Recent Work cards iframe the uxapex.com router path");
  const ctx = MS.displayText(chunks.find((c) => c.record_id === "directorcasestudy-ux-bgoals").text);
  ok(ctx.includes("https://uxapex.com/ecomm") && !/director-case-study-ux-bgoals\.vercel\.app/.test(ctx) && MS.displayText("see https://japan-case-study.vercel.app.") === "see https://japan-case-study.vercel.app.", "model context cites the router path for routed records; unrouted URLs unchanged");
  ok(chunks.find((c) => c.record_id === "directorcasestudy-ux-bgoals").text.includes("director-case-study-ux-bgoals.vercel.app"), "stored chunk text (master facts) not rewritten");
  ok(/displayText\(h\.chunk\.text\)/.test(read("lib/rag.ts")) && /liveUrl: displayUrl\(r\)/.test(read("lib/master.ts")), "display URL wired into cards and answer context");
  ok(!/portfolio/i.test(read("lib/master.ts").slice(read("lib/master.ts").indexOf("// ---- display URLs"), read("lib/master.ts").indexOf("/** Short distinguishing label"))), "display-URL rule has no portfolio branch");
}

console.log(`test-master: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
