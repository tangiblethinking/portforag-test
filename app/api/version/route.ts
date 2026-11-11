import { indexInfo } from "@/lib/rag";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Build/version info only (commit SHA, master + index hashes, counts) — used by the evidence editor's status view. */
export function GET() {
  const i = indexInfo();
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    master_sha256: i.masterSha,
    index: { master_sha256: i.artifactMasterSha, chunks_version: i.version, built_at_build: i.fromArtifact, chunks: i.chunks, enabled: i.enabled, records: i.records },
  }, { headers: { "cache-control": "no-store" } });
}
