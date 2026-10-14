import type { Db } from "../db";
import { ServiceError, notFound } from "../errors";
import { requirePermission, type Actor } from "../permissions";
import { audit } from "../audit";
import { acceptRiskSchema, actionSchema, closeActionSchema, type ActionInput } from "@/lib/validation";
import { ACTION_TERMINAL_STATUSES, type ActionStatus } from "@/lib/constants";

async function resolveLinks(db: Db, data: ReturnType<typeof actionSchema.parse>) {
  const project = await db.project.findUnique({ where: { id: data.projectId } });
  if (!project) throw notFound("Project");
  // Derive practice/domain from question when not given, and validate consistency.
  if (data.questionId) {
    const q = await db.question.findUnique({ where: { id: data.questionId }, include: { practice: true } });
    if (!q) throw notFound("Question");
    data.practiceId = q.practiceId;
    data.domainId = q.practice.domainId;
  } else if (data.practiceId) {
    const p = await db.securityPractice.findUnique({ where: { id: data.practiceId } });
    if (!p) throw notFound("Practice");
    data.domainId = p.domainId;
  } else if (data.domainId) {
    if (!(await db.securityDomain.findUnique({ where: { id: data.domainId } }))) throw notFound("Domain");
  }
  if (data.responseId) {
    const r = await db.assessmentResponse.findUnique({ where: { id: data.responseId }, include: { assessment: true } });
    if (!r) throw notFound("Response");
    if (r.assessment.projectId !== data.projectId) throw new ServiceError("The linked response belongs to a different project");
    data.assessmentId = r.assessmentId;
    if (!data.questionId) data.questionId = r.questionId;
  }
  return data;
}

export async function createAction(db: Db, actor: Actor, input: ActionInput) {
  requirePermission(actor, "action:write");
  const data = await resolveLinks(db, actionSchema.parse(input));
  return db.$transaction(async (tx) => {
    const a = await tx.remediationAction.create({ data: { ...data, createdBy: actor.name } });
    await audit(tx, actor, "create", "RemediationAction", a.id, a.title);
    return a;
  });
}

/**
 * Normal edits can only move between working statuses (Open, In progress, Blocked, Pending verification).
 * Closing or accepting risk requires the dedicated explicit actions below. Changing an assessment answer
 * never changes an action's status.
 */
export async function updateAction(db: Db, actor: Actor, id: string, input: ActionInput) {
  requirePermission(actor, "action:write");
  const existing = await db.remediationAction.findUnique({ where: { id } });
  if (!existing) throw notFound("Remediation action");
  if (ACTION_TERMINAL_STATUSES.includes((input as { status?: string }).status as ActionStatus))
    throw new ServiceError("Use the explicit Close or Accept Risk action to finalize a remediation action");
  if (ACTION_TERMINAL_STATUSES.includes(existing.status as ActionStatus))
    throw new ServiceError("This action is finalized. Reopen it before editing.", "CONFLICT");
  const data = await resolveLinks(db, actionSchema.parse(input));
  return db.$transaction(async (tx) => {
    const a = await tx.remediationAction.update({ where: { id }, data });
    await audit(tx, actor, "update", "RemediationAction", id, `${a.title} -> ${a.status}`);
    return a;
  });
}

export async function closeAction(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "action:close");
  const data = closeActionSchema.parse(input);
  const existing = await db.remediationAction.findUnique({ where: { id } });
  if (!existing) throw notFound("Remediation action");
  if (ACTION_TERMINAL_STATUSES.includes(existing.status as ActionStatus)) throw new ServiceError("Action is already finalized", "CONFLICT");
  return db.$transaction(async (tx) => {
    const a = await tx.remediationAction.update({
      where: { id },
      data: { status: "CLOSED", closureNote: data.closureNote, completionEvidence: data.completionEvidence, closedAt: new Date(), closedBy: actor.name },
    });
    await audit(tx, actor, "close", "RemediationAction", id, a.title);
    return a;
  });
}

export async function acceptRisk(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "action:acceptRisk");
  const data = acceptRiskSchema.parse(input);
  const existing = await db.remediationAction.findUnique({ where: { id } });
  if (!existing) throw notFound("Remediation action");
  if (ACTION_TERMINAL_STATUSES.includes(existing.status as ActionStatus)) throw new ServiceError("Action is already finalized", "CONFLICT");
  if (data.riskAcceptedUntil.getTime() <= Date.now()) throw new ServiceError("Risk acceptance must have a future expiry date (time-bound)");
  return db.$transaction(async (tx) => {
    const a = await tx.remediationAction.update({
      where: { id },
      data: {
        status: "ACCEPTED_RISK",
        closureNote: data.closureNote,
        riskAcceptedUntil: data.riskAcceptedUntil,
        riskAcceptedBy: actor.name,
        closedAt: new Date(),
        closedBy: actor.name,
      },
    });
    await audit(tx, actor, "accept-risk", "RemediationAction", id, a.title);
    return a;
  });
}

export async function reopenAction(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "action:close");
  const existing = await db.remediationAction.findUnique({ where: { id } });
  if (!existing) throw notFound("Remediation action");
  if (!ACTION_TERMINAL_STATUSES.includes(existing.status as ActionStatus)) return existing;
  return db.$transaction(async (tx) => {
    const a = await tx.remediationAction.update({ where: { id }, data: { status: "OPEN", closedAt: null, closedBy: "" } });
    await audit(tx, actor, "reopen", "RemediationAction", id, a.title);
    return a;
  });
}

export async function deleteAction(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "settings:admin");
  const existing = await db.remediationAction.findUnique({ where: { id } });
  if (!existing) throw notFound("Remediation action");
  await db.$transaction(async (tx) => {
    await tx.remediationAction.delete({ where: { id } });
    await audit(tx, actor, "delete", "RemediationAction", id, existing.title);
  });
}
