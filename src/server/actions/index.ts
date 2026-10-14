"use server";

import { cookies } from "next/headers";
import { db } from "../db";
import { USER_COOKIE } from "../auth";
import { run, type ActionResult } from "./run";
import * as projects from "../services/projects";
import * as assessments from "../services/assessments";
import * as actions from "../services/actions";
import * as evidence from "../services/evidence";
import * as admin from "../services/admin";
import type { AssessmentScore } from "@/lib/scoring/engine";
import type { ActionInput, AssessmentCreateInput, EvidenceInput, ProjectInput, QuestionInput, ResponseInputPayload } from "@/lib/validation";

// ------------------------------------------------------------------ session (local mode)
export async function switchUserAction(userId: string): Promise<ActionResult> {
  const user = await db.user.findFirst({ where: { id: String(userId), active: true } });
  if (!user) return { ok: false, error: "User not found" };
  const store = await cookies();
  store.set(USER_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return run(async () => undefined);
}

// ------------------------------------------------------------------ projects
export async function createProjectAction(input: ProjectInput) {
  return run(async (a) => (await projects.createProject(db, a, input)).id);
}
export async function updateProjectAction(id: string, input: ProjectInput) {
  return run(async (a) => (await projects.updateProject(db, a, id, input)).id);
}
export async function archiveProjectAction(id: string) {
  return run(async (a) => void (await projects.archiveProject(db, a, id)));
}
export async function restoreProjectAction(id: string) {
  return run(async (a) => void (await projects.restoreProject(db, a, id)));
}
export async function deleteProjectAction(id: string) {
  return run((a) => projects.deleteProject(db, a, id));
}
export async function updateWeightsAction(weights: { id: string; weight: number; rationale?: string }[]) {
  return run((a) => projects.updateWeights(db, a, weights));
}

// ------------------------------------------------------------------ assessments
export interface ScoreSummary {
  score: number | null;
  rawScore: number | null;
  state: string;
  belowThreshold: boolean;
  total: number;
  scored: number;
  na: number;
  unable: number;
  evidenceMissing: number;
  unanswered: number;
  completion: number;
  coverage: number;
  unconfirmedCarriedForward: number;
  domains: { id: string; score: number | null; coverage: number; completion: number; scored: number; total: number; practices: { id: string; score: number | null }[] }[];
}
function summarize(s: AssessmentScore): ScoreSummary {
  return {
    score: s.score, rawScore: s.rawScore, state: s.state, belowThreshold: s.belowThreshold, total: s.total, scored: s.scored, na: s.na,
    unable: s.unable, evidenceMissing: s.evidenceMissing, unanswered: s.unanswered, completion: s.completion, coverage: s.coverage,
    unconfirmedCarriedForward: s.unconfirmedCarriedForward,
    domains: s.domains.map((d) => ({ id: d.id, score: d.score, coverage: d.coverage, completion: d.completion, scored: d.scored, total: d.total, practices: d.practices.map((p) => ({ id: p.id, score: p.score })) })),
  };
}

export async function createAssessmentAction(input: AssessmentCreateInput) {
  return run(async (a) => (await assessments.createAssessment(db, a, input)).id);
}
export async function updateAssessmentMetaAction(id: string, input: unknown) {
  return run(async (a) => void (await assessments.updateAssessmentMeta(db, a, id, input)));
}
export async function deleteAssessmentAction(id: string) {
  return run((a) => assessments.deleteAssessment(db, a, id));
}
export async function saveResponseAction(assessmentId: string, questionId: string, payload: ResponseInputPayload) {
  return run(async (a) => {
    const r = await assessments.saveResponse(db, a, assessmentId, questionId, payload);
    return { summary: summarize(r.score), responseId: r.responseId };
  }, { revalidate: false });
}
export async function confirmResponsesAction(assessmentId: string, questionIds: string[]) {
  return run(async (a) => summarize(await assessments.confirmResponses(db, a, assessmentId, questionIds)), { revalidate: false });
}
export async function completeAssessmentAction(id: string) {
  return run(async (a) => void (await assessments.completeAssessment(db, a, id)));
}
export async function reviewAssessmentAction(id: string, input: unknown) {
  return run(async (a) => void (await assessments.reviewAssessment(db, a, id, input)));
}

// ------------------------------------------------------------------ remediation actions
export async function createRemediationAction(input: ActionInput) {
  return run(async (a) => (await actions.createAction(db, a, input)).id);
}
export async function updateRemediationAction(id: string, input: ActionInput) {
  return run(async (a) => void (await actions.updateAction(db, a, id, input)));
}
export async function closeRemediationAction(id: string, input: unknown) {
  return run(async (a) => void (await actions.closeAction(db, a, id, input)));
}
export async function acceptRiskRemediationAction(id: string, input: unknown) {
  return run(async (a) => void (await actions.acceptRisk(db, a, id, input)));
}
export async function reopenRemediationAction(id: string) {
  return run(async (a) => void (await actions.reopenAction(db, a, id)));
}
export async function deleteRemediationAction(id: string) {
  return run((a) => actions.deleteAction(db, a, id));
}

// ------------------------------------------------------------------ evidence
export async function createEvidenceAction(form: FormData) {
  return run(async (a) => {
    const file = form.get("file");
    const input: EvidenceInput = {
      projectId: String(form.get("projectId") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      reference: String(form.get("reference") ?? ""),
      type: String(form.get("type") ?? "OTHER") as EvidenceInput["type"],
      ownerName: String(form.get("ownerName") ?? ""),
      collectedAt: String(form.get("collectedAt") ?? "") || null,
      classification: String(form.get("classification") ?? "INTERNAL") as EvidenceInput["classification"],
    };
    let uploaded = null;
    if (file && typeof file === "object" && "arrayBuffer" in file && file.size > 0) {
      uploaded = { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
    }
    const e = await evidence.createEvidence(db, a, input, {
      file: uploaded,
      responseId: (form.get("responseId") as string) || null,
      actionId: (form.get("actionId") as string) || null,
    });
    return e.id;
  });
}
export async function updateEvidenceAction(id: string, input: EvidenceInput) {
  return run(async (a) => void (await evidence.updateEvidence(db, a, id, input)));
}
export async function verifyEvidenceAction(id: string, input: unknown) {
  return run(async (a) => void (await evidence.verifyEvidence(db, a, id, input)));
}
export async function linkEvidenceAction(evidenceId: string, target: { responseId?: string; actionId?: string }) {
  return run(async (a) => void (await evidence.linkEvidence(db, a, evidenceId, target)));
}
export async function unlinkEvidenceAction(linkId: string) {
  return run((a) => evidence.unlinkEvidence(db, a, linkId));
}
export async function deleteEvidenceAction(id: string) {
  return run((a) => evidence.deleteEvidence(db, a, id));
}

// ------------------------------------------------------------------ administration
export async function updateSettingsAction(input: unknown) {
  return run(async (a) => void (await admin.updateSettings(db, a, input)));
}
export async function updateLevelsAction(input: unknown) {
  return run((a) => admin.updateMaturityLevels(db, a, input));
}
export async function upsertUserAction(id: string | null, input: unknown) {
  return run(async (a) => void (await admin.upsertUser(db, a, id, input)));
}
export async function upsertDomainAction(id: string | null, input: unknown) {
  return run(async (a) => (await admin.upsertDomain(db, a, id, input)).id);
}
export async function setDomainActiveAction(id: string, active: boolean) {
  return run(async (a) => void (await admin.setDomainActive(db, a, id, active)));
}
export async function moveDomainAction(id: string, dir: "up" | "down") {
  return run((a) => admin.moveDomain(db, a, id, dir));
}
export async function upsertPracticeAction(id: string | null, input: unknown) {
  return run(async (a) => (await admin.upsertPractice(db, a, id, input)).id);
}
export async function setPracticeActiveAction(id: string, active: boolean) {
  return run(async (a) => void (await admin.setPracticeActive(db, a, id, active)));
}
export async function movePracticeAction(id: string, dir: "up" | "down") {
  return run((a) => admin.movePractice(db, a, id, dir));
}
export async function duplicatePracticeAction(id: string, newKey: string, newName: string, tags?: string) {
  return run(async (a) => (await admin.duplicatePractice(db, a, id, newKey, newName, tags)).id);
}
export async function createQuestionAction(input: QuestionInput) {
  return run(async (a) => (await admin.createQuestion(db, a, input)).id);
}
export async function updateQuestionAction(id: string, input: QuestionInput) {
  return run(async (a) => (await admin.updateQuestion(db, a, id, input)).id);
}
export async function setQuestionActiveAction(id: string, active: boolean) {
  return run(async (a) => void (await admin.setQuestionActive(db, a, id, active)));
}
export async function moveQuestionAction(id: string, dir: "up" | "down") {
  return run((a) => admin.moveQuestion(db, a, id, dir));
}
export async function duplicateQuestionAction(id: string, newKey: string, tags?: string) {
  return run(async (a) => (await admin.duplicateQuestion(db, a, id, newKey, tags !== undefined ? { applicabilityTags: tags } : {})).id);
}
export async function setFrameworkWeightAction(kind: "domain" | "practice", id: string, weight: number) {
  if (kind !== "domain" && kind !== "practice") return { ok: false, error: "Invalid kind" } as const;
  return run(async (a) => void (await admin.setFrameworkWeight(db, a, kind, id, weight)));
}
