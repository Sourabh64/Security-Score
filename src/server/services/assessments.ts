import type { Db } from "../db";
import { ServiceError, forbidden, notFound } from "../errors";
import { can, requirePermission, type Actor } from "../permissions";
import { audit } from "../audit";
import {
  assessmentCreateSchema,
  assessmentMetaSchema,
  responseSchema,
  reviewSchema,
  type AssessmentCreateInput,
  type ResponseInputPayload,
} from "@/lib/validation";
import { EDITABLE_STATUSES, type AssessmentStatus } from "@/lib/constants";
import { applicableFrameworkFor, scoreAssessmentLive } from "../portfolio";
import { getScoringContext } from "../framework";

function assertEditable(status: string) {
  if (!EDITABLE_STATUSES.includes(status as AssessmentStatus))
    throw new ServiceError(
      "This assessment is completed and is an immutable snapshot. Create a reassessment to record changes.",
      "CONFLICT",
    );
}

export async function createAssessment(db: Db, actor: Actor, input: AssessmentCreateInput) {
  requirePermission(actor, "assessment:write");
  const data = assessmentCreateSchema.parse(input);
  const project = await db.project.findUnique({ where: { id: data.projectId }, include: { children: { where: { archived: false } } } });
  if (!project) throw notFound("Project");
  if (project.archived) throw new ServiceError("Cannot start an assessment for an archived project");
  if (data.reviewerId && data.assessorId && data.reviewerId === data.assessorId)
    throw new ServiceError("The reviewer must be a different person from the assessor (separation of duties)");
  // An assessment of a parent with active subprojects is an oversight assessment by definition.
  const type = project.children.length > 0 ? "OVERSIGHT" : data.type === "OVERSIGHT" ? "BASELINE" : data.type;

  const base = data.basedOnId
    ? await db.assessment.findUnique({ where: { id: data.basedOnId }, include: { responses: { include: { evidenceLinks: true } } } })
    : null;
  if (data.basedOnId && !base) throw notFound("Base assessment");
  if (base && base.projectId !== data.projectId) throw new ServiceError("A reassessment must be based on an assessment of the same project");

  const { framework } = await applicableFrameworkFor(db, data.projectId);
  const applicableIds = new Set(framework.flatMap((d) => d.practices.flatMap((p) => p.questions.map((q) => q.id))));
  const questions = await db.question.findMany({ where: { id: { in: [...applicableIds] } }, include: { versions: { select: { id: true, version: true } } } });
  const currentVersionId = new Map(questions.map((q) => [q.id, q.versions.find((v) => v.version === q.currentVersion)?.id]));
  const ctx = await getScoringContext(db);
  const fv = await db.frameworkVersion.findUnique({ where: { version: ctx.frameworkVersion } });

  return db.$transaction(async (tx) => {
    const a = await tx.assessment.create({
      data: {
        projectId: data.projectId,
        title: data.title,
        scope: data.scope,
        type,
        status: "DRAFT",
        assessorId: data.assessorId ?? actor.id,
        reviewerId: data.reviewerId,
        assessmentDate: data.assessmentDate,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        focusDomainIds: data.focusDomainIds.join(","),
        basedOnId: data.basedOnId,
        frameworkVersionId: fv?.id ?? null,
      },
    });
    let carried = 0;
    if (base && data.copyResponses) {
      for (const r of base.responses) {
        if (!applicableIds.has(r.questionId) || r.status === "UNANSWERED") continue;
        const versionId = currentVersionId.get(r.questionId);
        if (!versionId) continue;
        const created = await tx.assessmentResponse.create({
          data: {
            assessmentId: a.id,
            questionId: r.questionId,
            questionVersionId: versionId,
            status: r.status,
            level: r.level,
            naJustification: r.naJustification,
            comment: r.comment,
            remediationNotes: r.remediationNotes,
            evidenceNote: r.evidenceNote,
            carriedForward: true,
            confirmed: false,
            answeredBy: r.answeredBy,
          },
        });
        for (const l of r.evidenceLinks) await tx.evidenceLink.create({ data: { evidenceId: l.evidenceId, responseId: created.id } });
        carried++;
      }
    }
    await audit(tx, actor, "create", "Assessment", a.id, `${a.title}${carried ? ` (${carried} responses carried forward)` : ""}`);
    return a;
  });
}

export async function updateAssessmentMeta(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "assessment:write");
  const data = assessmentMetaSchema.parse(input);
  const a = await db.assessment.findUnique({ where: { id } });
  if (!a) throw notFound("Assessment");
  assertEditable(a.status);
  if (data.reviewerId && data.reviewerId === (data.assessorId ?? a.assessorId))
    throw new ServiceError("The reviewer must be a different person from the assessor (separation of duties)");
  return db.$transaction(async (tx) => {
    const u = await tx.assessment.update({ where: { id }, data: { ...data, focusDomainIds: data.focusDomainIds.join(",") } });
    await audit(tx, actor, "update", "Assessment", id, u.title);
    return u;
  });
}

export async function deleteAssessment(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "assessment:write");
  const a = await db.assessment.findUnique({ where: { id } });
  if (!a) throw notFound("Assessment");
  if (!EDITABLE_STATUSES.includes(a.status as AssessmentStatus))
    throw new ServiceError("Completed assessments are retained as historical records and cannot be deleted", "CONFLICT");
  await db.$transaction(async (tx) => {
    await tx.assessment.delete({ where: { id } });
    await audit(tx, actor, "delete", "Assessment", id, a.title);
  });
}

/** Saves (autosaves) one response and returns the recalculated live score. */
export async function saveResponse(db: Db, actor: Actor, assessmentId: string, questionId: string, input: ResponseInputPayload) {
  requirePermission(actor, "assessment:write");
  const data = responseSchema.parse(input);
  const a = await db.assessment.findUnique({ where: { id: assessmentId } });
  if (!a) throw notFound("Assessment");
  assertEditable(a.status);
  const { framework } = await applicableFrameworkFor(db, a.projectId);
  const applicable = framework.some((d) => d.practices.some((p) => p.questions.some((q) => q.id === questionId)));
  if (!applicable) throw new ServiceError("This question is not active or not applicable to this project");
  const q = await db.question.findUnique({ where: { id: questionId }, include: { versions: { select: { id: true, version: true } } } });
  const versionId = q?.versions.find((v) => v.version === q.currentVersion)?.id;
  if (!q || !versionId) throw notFound("Question");

  const responseId = await db.$transaction(async (tx) => {
    const existing = await tx.assessmentResponse.findUnique({ where: { assessmentId_questionId: { assessmentId, questionId } } });
    const payload = {
      status: data.status,
      level: data.level,
      naJustification: data.status === "NOT_APPLICABLE" ? data.naJustification : "",
      comment: data.comment,
      remediationNotes: data.remediationNotes,
      evidenceNote: data.evidenceNote,
      questionVersionId: versionId,
      answeredBy: actor.name,
      // Saving a response is an explicit assessor action, which reconfirms carried-forward values.
      confirmed: true,
    };
    const row = existing
      ? await tx.assessmentResponse.update({ where: { id: existing.id }, data: payload })
      : await tx.assessmentResponse.create({ data: { assessmentId, questionId, ...payload } });
    if (a.status === "DRAFT") await tx.assessment.update({ where: { id: assessmentId }, data: { status: "IN_PROGRESS" } });
    else await tx.assessment.update({ where: { id: assessmentId }, data: { updatedAt: new Date() } });
    return row.id;
  });
  return { score: (await scoreAssessmentLive(db, assessmentId)).score, responseId };
}

/** Explicitly reconfirms carried-forward responses without changing them. */
export async function confirmResponses(db: Db, actor: Actor, assessmentId: string, questionIds: string[]) {
  requirePermission(actor, "assessment:write");
  const a = await db.assessment.findUnique({ where: { id: assessmentId } });
  if (!a) throw notFound("Assessment");
  assertEditable(a.status);
  await db.$transaction(async (tx) => {
    const r = await tx.assessmentResponse.updateMany({
      where: { assessmentId, questionId: { in: questionIds }, carriedForward: true },
      data: { confirmed: true, answeredBy: actor.name },
    });
    if (a.status === "DRAFT") await tx.assessment.update({ where: { id: assessmentId }, data: { status: "IN_PROGRESS" } });
    await audit(tx, actor, "confirm-responses", "Assessment", assessmentId, `${r.count} carried-forward responses reconfirmed`);
  });
  return (await scoreAssessmentLive(db, assessmentId)).score;
}

/** Validates completion prerequisites without changing anything. */
export async function completionBlockers(db: Db, assessmentId: string): Promise<string[]> {
  const { score, framework, assessment } = await scoreAssessmentLive(db, assessmentId);
  const blockers: string[] = [];
  if (score.unconfirmedCarriedForward > 0)
    blockers.push(`${score.unconfirmedCarriedForward} carried-forward response(s) must be reconfirmed by the assessor`);
  const responded = new Map(
    (await db.assessmentResponse.findMany({ where: { assessmentId: assessment.id }, select: { questionId: true, status: true } })).map((r) => [r.questionId, r.status]),
  );
  const mandatoryOpen = framework.flatMap((d) => d.practices.flatMap((p) => p.questions)).filter((q) => q.mandatory && (responded.get(q.id) ?? "UNANSWERED") === "UNANSWERED");
  if (mandatoryOpen.length) blockers.push(`${mandatoryOpen.length} mandatory question(s) have no response (answer, N/A, unable to determine or evidence missing)`);
  if (score.scored === 0) blockers.push("At least one question must be answered with a maturity level");
  return blockers;
}

/**
 * Completes an assessment: captures an immutable ScoreSnapshot and locks responses.
 * Historical scores are always read from this snapshot afterwards.
 */
export async function completeAssessment(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "assessment:write");
  const a = await db.assessment.findUnique({ where: { id } });
  if (!a) throw notFound("Assessment");
  assertEditable(a.status);
  const blockers = await completionBlockers(db, id);
  if (blockers.length) throw new ServiceError(`Cannot complete assessment: ${blockers.join("; ")}`);
  const ctx = await getScoringContext(db);
  const { score } = await scoreAssessmentLive(db, id, ctx);
  const fv = await db.frameworkVersion.findUnique({ where: { version: ctx.frameworkVersion } });
  return db.$transaction(async (tx) => {
    await tx.scoreSnapshot.create({
      data: {
        assessmentId: id,
        projectId: a.projectId,
        assessmentDate: a.assessmentDate,
        overallScore: score.score,
        state: score.state,
        totalQuestions: score.total,
        scoredCount: score.scored,
        naCount: score.na,
        unableCount: score.unable,
        evidenceMissingCount: score.evidenceMissing,
        unansweredCount: score.unanswered,
        completion: score.completion,
        coverage: score.coverage,
        breakdown: JSON.stringify(score),
        frameworkVersion: ctx.frameworkVersion,
      },
    });
    const u = await tx.assessment.update({
      where: { id },
      data: { status: "COMPLETED", submittedAt: new Date(), frameworkVersionId: fv?.id ?? a.frameworkVersionId },
    });
    await audit(tx, actor, "complete", "Assessment", id, `${a.title} – score ${score.score === null ? "n/a" : score.score.toFixed(1)}`);
    return u;
  });
}

/** Reviewer decision. Approval -> REVIEWED; rejection -> REJECTED (snapshot retained; create a revision to fix). */
export async function reviewAssessment(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "assessment:review");
  const data = reviewSchema.parse(input);
  const a = await db.assessment.findUnique({ where: { id } });
  if (!a) throw notFound("Assessment");
  if (data.decision !== "COMMENT" && a.status !== "COMPLETED")
    throw new ServiceError("Only completed assessments awaiting review can be approved or rejected", "CONFLICT");
  if (a.assessorId === actor.id && data.decision !== "COMMENT")
    throw forbidden("Separation of duties: you cannot approve or reject an assessment you performed");
  return db.$transaction(async (tx) => {
    await tx.assessmentReview.create({ data: { assessmentId: id, reviewerId: actor.id, reviewerName: actor.name, decision: data.decision, comments: data.comments } });
    let updated = a;
    if (data.decision === "APPROVED")
      updated = await tx.assessment.update({ where: { id }, data: { status: "REVIEWED", reviewedAt: new Date(), reviewerId: actor.id } });
    if (data.decision === "REJECTED")
      updated = await tx.assessment.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), reviewerId: actor.id } });
    await audit(tx, actor, `review-${data.decision.toLowerCase()}`, "Assessment", id, a.title);
    return updated;
  });
}

export function canEditAssessment(actor: Actor | null, status: string) {
  return can(actor, "assessment:write") && EDITABLE_STATUSES.includes(status as AssessmentStatus);
}
