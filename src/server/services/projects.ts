import type { Db } from "../db";
import { ServiceError, notFound } from "../errors";
import { requirePermission, type Actor } from "../permissions";
import { audit } from "../audit";
import { projectSchema, type ProjectInput } from "@/lib/validation";
import { wouldCreateCycle } from "@/lib/hierarchy";

/**
 * Hierarchy rules for the initial UI: main projects (no parent) and one level of subprojects.
 * The data model supports deeper nesting; cycles are always rejected.
 */
async function validateParent(db: Db, projectId: string | null, parentId: string | null) {
  if (!parentId) return;
  const all = await db.project.findMany({ select: { id: true, parentId: true, archived: true } });
  const parent = all.find((p) => p.id === parentId);
  if (!parent) throw new ServiceError("Parent project not found");
  if (projectId && wouldCreateCycle(all, projectId, parentId)) throw new ServiceError("This change would create a circular project hierarchy");
  if (parent.parentId) throw new ServiceError("Subprojects can only be created under a main project (one subproject level is supported)");
  if (parent.archived) throw new ServiceError("Cannot add a subproject to an archived project");
  if (projectId && all.some((p) => p.parentId === projectId))
    throw new ServiceError("A project that has its own subprojects cannot become a subproject");
}

async function ensureUniqueKey(db: Db, key: string, exceptId?: string) {
  const existing = await db.project.findMany({ select: { id: true, key: true } });
  if (existing.some((p) => p.key.toUpperCase() === key.toUpperCase() && p.id !== exceptId))
    throw new ServiceError(`A project with identifier "${key}" already exists`, "CONFLICT");
}

export async function createProject(db: Db, actor: Actor, input: ProjectInput) {
  requirePermission(actor, "project:write");
  const data = projectSchema.parse(input);
  await ensureUniqueKey(db, data.key);
  await validateParent(db, null, data.parentId);
  return db.$transaction(async (tx) => {
    const p = await tx.project.create({ data });
    await audit(tx, actor, "create", "Project", p.id, `${p.key} ${p.name}`);
    return p;
  });
}

export async function updateProject(db: Db, actor: Actor, id: string, input: ProjectInput) {
  requirePermission(actor, "project:write");
  const data = projectSchema.parse(input);
  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) throw notFound("Project");
  await ensureUniqueKey(db, data.key, id);
  if (data.parentId !== existing.parentId) await validateParent(db, id, data.parentId);
  return db.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id }, data });
    await audit(tx, actor, "update", "Project", id, `${p.key} ${p.name}`);
    return p;
  });
}

/** Archiving keeps all historical assessments. Archiving a main project also archives its subprojects. */
export async function archiveProject(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "project:write");
  const p = await db.project.findUnique({ where: { id }, include: { children: true } });
  if (!p) throw notFound("Project");
  if (p.archived) return p;
  const now = new Date();
  return db.$transaction(async (tx) => {
    await tx.project.updateMany({ where: { parentId: id, archived: false }, data: { archived: true, archivedAt: now } });
    const updated = await tx.project.update({ where: { id }, data: { archived: true, archivedAt: now } });
    await audit(tx, actor, "archive", "Project", id, p.name);
    return updated;
  });
}

/** Restores a project. Subprojects archived together with the parent are restored too. */
export async function restoreProject(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "project:write");
  const p = await db.project.findUnique({ where: { id }, include: { parent: true } });
  if (!p) throw notFound("Project");
  if (p.parent?.archived) throw new ServiceError("Restore the parent project first");
  return db.$transaction(async (tx) => {
    if (p.archivedAt)
      await tx.project.updateMany({ where: { parentId: id, archivedAt: p.archivedAt }, data: { archived: false, archivedAt: null } });
    const updated = await tx.project.update({ where: { id }, data: { archived: false, archivedAt: null } });
    await audit(tx, actor, "restore", "Project", id, p.name);
    return updated;
  });
}

/**
 * Hard delete is only allowed when it cannot damage history: no assessments, remediation actions,
 * evidence or subprojects. Otherwise the project must be archived.
 */
export async function deleteProject(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "project:delete");
  const p = await db.project.findUnique({
    where: { id },
    include: { _count: { select: { assessments: true, actions: true, evidence: true, children: true } } },
  });
  if (!p) throw notFound("Project");
  const c = p._count;
  if (c.assessments || c.actions || c.evidence || c.children)
    throw new ServiceError(
      `Cannot delete "${p.name}": it has ${c.assessments} assessment(s), ${c.actions} action(s), ${c.evidence} evidence item(s) and ${c.children} subproject(s). Archive it instead to preserve history.`,
      "CONFLICT",
    );
  await db.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } });
    await audit(tx, actor, "delete", "Project", id, p.name);
  });
}

/** Updates aggregation weights of sibling projects (subprojects of a parent, or main projects). */
export async function updateWeights(db: Db, actor: Actor, weights: { id: string; weight: number; rationale?: string }[]) {
  requirePermission(actor, "settings:admin");
  for (const w of weights) {
    if (!Number.isFinite(w.weight) || w.weight < 0 || w.weight > 100) throw new ServiceError(`Invalid weight ${w.weight}: weights must be between 0 and 100`);
  }
  if (weights.length && weights.every((w) => w.weight === 0)) throw new ServiceError("At least one weight must be greater than zero");
  await db.$transaction(async (tx) => {
    for (const w of weights)
      await tx.project.update({ where: { id: w.id }, data: { weight: w.weight, ...(w.rationale !== undefined ? { weightRationale: w.rationale.slice(0, 1000) } : {}) } });
    await audit(tx, actor, "update-weights", "Project", weights.map((w) => w.id).join(",").slice(0, 190), `${weights.length} weights`);
  });
}
