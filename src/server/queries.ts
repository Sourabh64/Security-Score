import "server-only";
import { db } from "./db";
import { parseList } from "@/lib/hierarchy";

/** Capability tags referenced by questions or projects (for form hints). */
export async function knownCapabilities(): Promise<string[]> {
  const [versions, projects] = await Promise.all([
    db.questionVersion.findMany({ select: { applicabilityTags: true } }),
    db.project.findMany({ select: { capabilities: true } }),
  ]);
  return [...new Set([...versions.flatMap((v) => parseList(v.applicabilityTags)), ...projects.flatMap((p) => parseList(p.capabilities))])].sort();
}

export async function mainProjectOptions(excludeId?: string) {
  return db.project.findMany({
    where: { parentId: null, archived: false, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function userOptions() {
  return db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
}
