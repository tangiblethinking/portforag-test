// Runs before `next build` (npm run build). Validates data/master.json and writes the derived retrieval index
// data/retrieval-index.json (enabled-record chunks + versions). Never modifies data/master.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { buildChunks, chunksVersion } from "../lib/retrieval.ts";
import { validateMaster } from "./master-validate.mjs";

const raw = fs.readFileSync("data/master.json");
const master = JSON.parse(raw.toString("utf8"));
const errors = validateMaster(master);
if (errors.length) { console.error("data/master.json invalid:\n" + errors.join("\n")); process.exit(1); }
const chunks = buildChunks(master.records);
const out = {
  master_sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  chunks_version: chunksVersion(chunks),
  records: master.records.length,
  enabled: master.records.filter((r) => r.indexable).length,
  chunks,
};
fs.writeFileSync("data/retrieval-index.json", JSON.stringify(out));
console.log(`retrieval index: ${chunks.length} chunks from ${out.enabled}/${out.records} enabled records, master ${out.master_sha256.slice(0, 12)}`);
