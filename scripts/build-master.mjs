// Builds data/master.json: the ONE canonical master collection for retrieval and cards (core: scripts/master-core.mjs).
// Deterministic, no network, no API keys. Repository inputs only:
//   data/source/evidence-map/index.html        evidence map (86 structured repo records, JSON block id="evidence-data")
//   data/source/evidence-map/src/images/*.webp captured landing images referenced by the map
//   public/resume.html                          supplied resume, served unchanged; its text is extracted here
//   projects.json, data/recent-work.json        existing runtime ids / Recent Work URLs (exact alias map + accounting)
// Source refresh: replace the inputs above and re-run. For every record already in data/master.json, `indexable`
// and every `manual` correction are carried over and re-applied. `next build` never runs this script, so editor
// saves to data/master.json are never overwritten by a deployment.
import fs from "node:fs";
import { buildMaster, MAP, IMG_DIR, RESUME, OUT, sha } from "./master-core.mjs";

const webpSize = (buf) => {
  const t = buf.toString("ascii", 12, 16);
  if (t === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (t === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (t === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  return null;
};
const imageInfo = (file) => {
  const p = `${IMG_DIR}/${file}`;
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  const dim = webpSize(buf);
  return dim ? { sha256: sha(buf), ...dim } : null;
};
const runtime = JSON.parse(fs.readFileSync("projects.json", "utf8"));
const { doc, usedImages } = buildMaster({
  mapHtml: fs.readFileSync(MAP, "utf8"),
  resumeHtml: fs.readFileSync(RESUME, "utf8"),
  runtimeProjects: runtime.projects || runtime,
  recentItems: JSON.parse(fs.readFileSync("data/recent-work.json", "utf8")).items,
  prev: fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null,
  imageInfo,
});
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
fs.mkdirSync("public/evidence", { recursive: true });
for (const f of usedImages) fs.copyFileSync(`${IMG_DIR}/${f}`, `public/evidence/${f}`);
for (const f of fs.readdirSync("public/evidence")) if (!usedImages.includes(f)) fs.unlinkSync(`public/evidence/${f}`);
console.log(`master: ${doc.records.length} records, ${usedImages.length} images, ${doc.unaccounted.length} unaccounted runtime items, carried ${doc.refresh.carried_over.length}`);
