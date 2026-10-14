import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { actionsCsv, responsesCsv, scoresCsv, snapshotsCsv } from "@/server/export";

const KINDS = { scores: scoresCsv, responses: responsesCsv, actions: actionsCsv, snapshots: snapshotsCsv } as const;

/** CSV exports. All roles (including read-only viewers) may export; data reflects the current database. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { kind } = await params;
  const fn = KINDS[kind as keyof typeof KINDS];
  if (!fn) return new Response("Unknown export", { status: 404 });
  const url = new URL(req.url);
  const id = (k: string) => {
    const v = url.searchParams.get(k);
    return v && /^[a-z0-9]{10,40}$/i.test(v) ? v : undefined;
  };
  const csv = await fn(db, {
    projectId: id("project"),
    assessmentId: id("assessment"),
    includeArchived: url.searchParams.get("archived") === "1",
    status: url.searchParams.get("status") ?? undefined,
  } as never);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="psmh-${kind}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
