import type { Db } from "./db";
import { computePortfolio, parseSnapshot, scoreForAssessment, subtreeIds, type Portfolio } from "./portfolio";
import { toCsv } from "@/lib/csv";
import { formatScore, roundScore, scoreKindLabel } from "@/lib/scoring/format";
import { isOverdue } from "@/lib/utils";

/** Score value exactly as shown in detailed views (1 decimal, same rounding rule); empty when not assessed. */
export const exportScore = (v: number | null | undefined) => (v === null || v === undefined ? null : formatScore(v, 1));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : roundScore(v, 1));

export interface ExportFilter {
  projectId?: string;
  assessmentId?: string;
  includeArchived?: boolean;
}

function projectScope(p: Portfolio, f: ExportFilter) {
  const ids = f.projectId ? subtreeIds(p, f.projectId) : p.projects.map((x) => x.id);
  return ids.filter((id) => f.includeArchived || f.projectId === id || !p.byId.get(id)!.archived);
}

export async function scoresCsv(db: Db, f: ExportFilter = {}) {
  const p = await computePortfolio(db);
  const rows: unknown[][] = [];
  if (!f.projectId) {
    const o = p.org;
    rows.push(["ORGANIZATION", "", p.ctx.orgName, "", "", "", exportScore(o.score), o.score === null ? null : formatScore(o.score, p.ctx.orgSummaryDecimals), scoreKindLabel(o), pct(o.coverage), pct(o.completion), `${o.aggregation?.contributingCount}/${o.aggregation?.childCount}`, pct(o.aggregation?.weightCoverage), "", "", ""]);
  }
  for (const id of projectScope(p, f)) {
    const x = p.byId.get(id)!;
    const e = p.effective.get(id)!;
    const b = p.basis.get(id);
    const parent = x.parentId ? p.byId.get(x.parentId)!.name : "";
    rows.push([
      "PROJECT", x.key, x.name, parent, x.archived, x.weight, exportScore(e.score), "", scoreKindLabel(e), pct(e.coverage), pct(e.completion),
      e.aggregation ? `${e.aggregation.contributingCount}/${e.aggregation.childCount}` : "", pct(e.aggregation?.weightCoverage), b?.title ?? "", b?.status ?? "", b ? b.assessmentDate.toISOString().slice(0, 10) : "",
    ]);
    for (const d of e.domains)
      rows.push(["DOMAIN", x.key, `${x.name} – ${d.name}`, parent, x.archived, "", exportScore(e.score === null ? null : d.score), "", "", pct(d.coverage), "", d.contributors !== undefined ? String(d.contributors) : "", "", "", "", ""]);
  }
  return toCsv(
    ["scope", "project_key", "name", "parent", "archived", "weight", "score_1dp", "org_summary_score", "score_source", "scored_coverage_pct", "completion_pct", "contributing_children", "aggregation_weight_coverage_pct", "basis_assessment", "basis_status", "basis_date"],
    rows,
  );
}

export async function responsesCsv(db: Db, f: ExportFilter = {}) {
  const p = await computePortfolio(db);
  const assessments = await db.assessment.findMany({
    where: f.assessmentId ? { id: f.assessmentId } : { projectId: { in: projectScope(p, f) } },
    orderBy: [{ assessmentDate: "desc" }],
    include: {
      project: true,
      responses: { include: { questionVersion: true, question: { include: { practice: { include: { domain: true } } } }, evidenceLinks: { include: { evidence: true } } } },
    },
  });
  const rows: unknown[][] = [];
  for (const a of assessments) {
    const { score } = await scoreForAssessment(db, a.id, p.ctx);
    const qScore = new Map(score.domains.flatMap((d) => d.practices.flatMap((pr) => pr.questions.map((q) => [q.id, q.score] as const))));
    for (const r of a.responses.sort((x, y) => x.question.key.localeCompare(y.question.key)))
      rows.push([
        a.project.key, a.project.name, a.id, a.title, a.type, a.status, a.assessmentDate.toISOString().slice(0, 10), exportScore(score.score),
        r.question.practice.domain.name, r.question.practice.name, r.question.key, r.questionVersion.version, r.questionVersion.title, r.questionVersion.criticality,
        r.status, r.level, qScore.get(r.questionId) ?? null, r.naJustification, r.comment, r.remediationNotes, r.evidenceNote,
        r.evidenceLinks.map((l) => `${l.evidence.title} [${l.evidence.verificationStatus}]`).join("; "), r.carriedForward, r.confirmed, r.answeredBy, r.updatedAt,
      ]);
  }
  return toCsv(
    ["project_key", "project", "assessment_id", "assessment", "type", "status", "assessment_date", "assessment_score_1dp", "domain", "practice", "question_key", "question_version", "question", "criticality", "response_status", "level", "question_score", "na_justification", "comment", "remediation_notes", "evidence_reference", "linked_evidence", "carried_forward", "confirmed", "answered_by", "updated_at"],
    rows,
  );
}

export async function actionsCsv(db: Db, f: ExportFilter & { status?: string } = {}) {
  const p = await computePortfolio(db);
  const statusWhere = f.status === "open" ? { notIn: ["CLOSED", "ACCEPTED_RISK"] } : f.status && f.status !== "any" ? { equals: f.status } : undefined;
  const actions = await db.remediationAction.findMany({
    where: { projectId: { in: projectScope(p, f) }, ...(statusWhere ? { status: statusWhere } : {}) },
    include: { project: true, domain: true, practice: true, question: true },
    orderBy: [{ targetDate: "asc" }],
  });
  const now = new Date();
  return toCsv(
    ["id", "title", "project_key", "project", "domain", "practice", "question_key", "priority", "status", "owner", "target_date", "overdue", "gap", "recommendation", "completion_evidence", "closure_note", "closed_by", "closed_at", "risk_accepted_until", "created_at", "updated_at"],
    actions.map((a) => [
      a.id, a.title, a.project.key, a.project.name, a.domain?.name, a.practice?.name, a.question?.key, a.priority, a.status, a.owner, a.targetDate?.toISOString().slice(0, 10),
      isOverdue(a.targetDate, a.status, now), a.gap, a.recommendation, a.completionEvidence, a.closureNote, a.closedBy, a.closedAt, a.riskAcceptedUntil?.toISOString().slice(0, 10), a.createdAt, a.updatedAt,
    ]),
  );
}

/** Historical snapshot scores (one row per completed assessment) for trend analysis. */
export async function snapshotsCsv(db: Db, f: ExportFilter = {}) {
  const p = await computePortfolio(db);
  const snaps = await db.scoreSnapshot.findMany({ where: { projectId: { in: projectScope(p, f) } }, include: { assessment: true, project: true }, orderBy: { assessmentDate: "asc" } });
  return toCsv(
    ["project_key", "project", "assessment", "status", "assessment_date", "framework_version", "score_1dp", "state", "scored_coverage_pct", "completion_pct", "scored", "na", "unable", "evidence_missing", "unanswered"],
    snaps.map((s) => {
      const b = parseSnapshot(s.breakdown);
      return [s.project.key, s.project.name, s.assessment.title, s.assessment.status, s.assessmentDate.toISOString().slice(0, 10), s.frameworkVersion, exportScore(b.score), s.state, pct(s.coverage), pct(s.completion), s.scoredCount, s.naCount, s.unableCount, s.evidenceMissingCount, s.unansweredCount];
    }),
  );
}
