import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import type { Db } from "../db";
import { ServiceError, forbidden, notFound } from "../errors";
import { can, requirePermission, type Actor } from "../permissions";
import { audit } from "../audit";
import { evidenceSchema, verifyEvidenceSchema, type EvidenceInput } from "@/lib/validation";
import { ALLOWED_UPLOAD_EXTENSIONS, EDITABLE_STATUSES, MAX_UPLOAD_BYTES, type AssessmentStatus } from "@/lib/constants";

export function uploadDir() {
  return path.resolve(process.cwd(), process.env.EVIDENCE_UPLOAD_DIR || "data/uploads");
}

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

/** Stores an attachment under a random name; the original name is kept only as metadata. */
async function storeFile(file: UploadedFile) {
  if (file.size > MAX_UPLOAD_BYTES) throw new ServiceError(`Attachment exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`);
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) throw new ServiceError(`File type ${ext || "(none)"} is not allowed`);
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 150);
  const stored = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(uploadDir(), { recursive: true });
  await fs.writeFile(path.join(uploadDir(), stored), file.bytes);
  return { fileName: safeName, storedFileName: stored, fileSize: file.size, mimeType: file.type.slice(0, 100) || "application/octet-stream" };
}

export async function createEvidence(
  db: Db,
  actor: Actor,
  input: EvidenceInput,
  opts: { file?: UploadedFile | null; responseId?: string | null; actionId?: string | null } = {},
) {
  requirePermission(actor, "evidence:write");
  const data = evidenceSchema.parse(input);
  if (!(await db.project.findUnique({ where: { id: data.projectId } }))) throw notFound("Project");
  if (opts.responseId) await assertResponseLinkable(db, opts.responseId, data.projectId);
  if (opts.actionId) await assertActionLinkable(db, opts.actionId, data.projectId);
  const fileMeta = opts.file && opts.file.size > 0 ? await storeFile(opts.file) : {};
  return db.$transaction(async (tx) => {
    const e = await tx.evidence.create({ data: { ...data, ...fileMeta, createdBy: actor.name } });
    if (opts.responseId || opts.actionId)
      await tx.evidenceLink.create({ data: { evidenceId: e.id, responseId: opts.responseId ?? null, actionId: opts.actionId ?? null } });
    await audit(tx, actor, "create", "Evidence", e.id, e.title);
    return e;
  });
}

export async function updateEvidence(db: Db, actor: Actor, id: string, input: EvidenceInput) {
  requirePermission(actor, "evidence:write");
  const data = evidenceSchema.parse(input);
  const e = await db.evidence.findUnique({ where: { id } });
  if (!e) throw notFound("Evidence");
  return db.$transaction(async (tx) => {
    // Changing the evidence content invalidates a previous verification.
    const changed = e.reference !== data.reference || e.title !== data.title || e.description !== data.description;
    const u = await tx.evidence.update({
      where: { id },
      data: { ...data, ...(changed && e.verificationStatus === "VERIFIED" ? { verificationStatus: "PENDING", verificationNote: "Re-verification required after edit" } : {}) },
    });
    await audit(tx, actor, "update", "Evidence", id, u.title);
    return u;
  });
}

export async function verifyEvidence(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "evidence:verify");
  const data = verifyEvidenceSchema.parse(input);
  const e = await db.evidence.findUnique({ where: { id } });
  if (!e) throw notFound("Evidence");
  if (data.status === "VERIFIED" && e.createdBy === actor.name && actor.role !== "ADMIN")
    throw forbidden("Evidence must be verified by someone other than the person who recorded it");
  return db.$transaction(async (tx) => {
    const u = await tx.evidence.update({
      where: { id },
      data: {
        verificationStatus: data.status,
        verificationNote: data.note,
        verifiedBy: data.status === "PENDING" ? "" : actor.name,
        lastVerifiedAt: data.status === "VERIFIED" ? new Date() : e.lastVerifiedAt,
      },
    });
    await audit(tx, actor, `evidence-${data.status.toLowerCase()}`, "Evidence", id, u.title);
    return u;
  });
}

async function assertResponseLinkable(db: Db, responseId: string, projectId?: string) {
  const r = await db.assessmentResponse.findUnique({ where: { id: responseId }, include: { assessment: true } });
  if (!r) throw notFound("Response");
  if (!EDITABLE_STATUSES.includes(r.assessment.status as AssessmentStatus))
    throw new ServiceError("Evidence links of completed assessments are part of the historical record and cannot be changed", "CONFLICT");
  if (projectId && r.assessment.projectId !== projectId) throw new ServiceError("Evidence belongs to a different project");
  return r;
}
async function assertActionLinkable(db: Db, actionId: string, projectId?: string) {
  const a = await db.remediationAction.findUnique({ where: { id: actionId } });
  if (!a) throw notFound("Remediation action");
  if (projectId && a.projectId !== projectId) throw new ServiceError("Evidence belongs to a different project");
  return a;
}

export async function linkEvidence(db: Db, actor: Actor, evidenceId: string, target: { responseId?: string; actionId?: string }) {
  requirePermission(actor, "evidence:write");
  const e = await db.evidence.findUnique({ where: { id: evidenceId } });
  if (!e) throw notFound("Evidence");
  if (target.responseId) await assertResponseLinkable(db, target.responseId, e.projectId);
  if (target.actionId) await assertActionLinkable(db, target.actionId, e.projectId);
  const dup = await db.evidenceLink.findFirst({ where: { evidenceId, responseId: target.responseId ?? null, actionId: target.actionId ?? null } });
  if (dup) return dup;
  return db.evidenceLink.create({ data: { evidenceId, responseId: target.responseId ?? null, actionId: target.actionId ?? null } });
}

export async function unlinkEvidence(db: Db, actor: Actor, linkId: string) {
  requirePermission(actor, "evidence:write");
  const l = await db.evidenceLink.findUnique({ where: { id: linkId } });
  if (!l) throw notFound("Evidence link");
  if (l.responseId) await assertResponseLinkable(db, l.responseId);
  await db.evidenceLink.delete({ where: { id: linkId } });
}

export async function deleteEvidence(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "evidence:write");
  const e = await db.evidence.findUnique({ where: { id }, include: { links: { include: { response: { include: { assessment: true } } } } } });
  if (!e) throw notFound("Evidence");
  if (e.createdBy !== actor.name && !can(actor, "settings:admin")) throw forbidden("Only the creator or an administrator can delete evidence");
  if (e.links.some((l) => l.response && !EDITABLE_STATUSES.includes(l.response.assessment.status as AssessmentStatus)))
    throw new ServiceError("Evidence referenced by a completed assessment is retained for the historical record", "CONFLICT");
  await db.$transaction(async (tx) => {
    await tx.evidence.delete({ where: { id } });
    await audit(tx, actor, "delete", "Evidence", id, e.title);
  });
  if (e.storedFileName) await fs.rm(path.join(uploadDir(), path.basename(e.storedFileName)), { force: true });
}
