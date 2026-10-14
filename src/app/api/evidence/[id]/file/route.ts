import path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { uploadDir } from "@/server/services/evidence";

/** Downloads an evidence attachment. Always served as an opaque attachment (never rendered inline). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const e = await db.evidence.findUnique({ where: { id }, select: { storedFileName: true, fileName: true } });
  if (!e?.storedFileName) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(uploadDir(), path.basename(e.storedFileName)));
    const safeName = (e.fileName ?? "evidence").replace(/[^A-Za-z0-9._ -]/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Attachment missing", { status: 404 });
  }
}
