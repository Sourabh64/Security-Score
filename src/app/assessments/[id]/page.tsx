import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { applicableFrameworkFor, scoreForAssessment } from "@/server/portfolio";
import { getScoringContext, loadFrameworkTree } from "@/server/framework";
import { completionBlockers } from "@/server/services/assessments";
import { Badge, Card, KeyValue, LinkButton, PageHeader } from "@/components/ui";
import { AssessmentWorkspace } from "@/components/assessment/workspace";
import { ReviewPanel } from "@/components/assessment/review-panel";
import { AssessmentMetaForm } from "@/components/assessment/meta-form";
import { ActionButton } from "@/components/client";
import { completeAssessmentAction, deleteAssessmentAction } from "@/server/actions";
import { BreakdownTable, MethodNote } from "@/components/score-details";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_TYPE_LABELS, EDITABLE_STATUSES, type AssessmentStatus, type AssessmentType } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { parseList } from "@/lib/hierarchy";
import type { QItem, RState } from "@/components/assessment/types";
import { userOptions } from "@/server/queries";

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const { q: focusQuestion } = await searchParams;
  const a = await db.assessment.findUnique({
    where: { id },
    include: {
      project: { include: { parent: true, children: { where: { archived: false }, select: { id: true } } } },
      assessor: true,
      reviewer: true,
      basedOn: { select: { id: true, title: true } },
      frameworkVersion: true,
      reviews: { orderBy: { createdAt: "asc" } },
      snapshot: true,
      responses: {
        include: {
          questionVersion: { include: { options: { orderBy: { level: "asc" } } } },
          evidenceLinks: { include: { evidence: true } },
          actions: { select: { id: true, title: true, status: true } },
        },
      },
    },
  });
  if (!a) notFound();
  const user = await getCurrentUser();
  const editable = EDITABLE_STATUSES.includes(a.status as AssessmentStatus) && can(user, "assessment:write");
  const locked = !EDITABLE_STATUSES.includes(a.status as AssessmentStatus);
  const ctx = await getScoringContext(db);
  const tree = await loadFrameworkTree(db, { withOptions: true });
  const { framework } = await applicableFrameworkFor(db, a.projectId);
  const applicableIds = new Set(framework.flatMap((d) => d.practices.flatMap((p) => p.questions.map((q) => q.id))));
  const responseByQ = new Map(a.responses.map((r) => [r.questionId, r]));

  // For locked assessments, show the exact question versions that were answered (historical integrity).
  const questions: QItem[] = [];
  for (const d of tree)
    for (const p of d.practices)
      for (const q of p.questions) {
        const r = responseByQ.get(q.id);
        if (!applicableIds.has(q.id) && !r) continue;
        const v = (locked && r ? r.questionVersion : q.current) as (typeof a.responses)[number]["questionVersion"] | undefined;
        if (!v) continue;
        questions.push({
          id: q.id, key: q.key, version: v.version, currentVersion: q.currentVersion, domainId: d.id, domainName: d.name, domainKey: d.key, practiceId: p.id, practiceName: p.name,
          title: v.title, description: v.description, objective: v.objective, rationale: v.rationale, scope: v.scope, guidance: v.guidance, evidenceExamples: v.evidenceExamples,
          evidenceRequired: v.evidenceRequired, weight: v.weight, criticality: v.criticality, mandatory: v.mandatory, tags: parseList(v.applicabilityTags),
          remediationGuidance: v.remediationGuidance, references: v.references,
          options: (v.options ?? []).map((o) => ({ level: o.level, label: o.label, description: o.description, criteria: o.criteria, examples: o.examples, gaps: o.gaps })),
        });
      }
  const responses: Record<string, RState> = {};
  for (const r of a.responses)
    responses[r.questionId] = {
      responseId: r.id, status: r.status, level: r.level, naJustification: r.naJustification, comment: r.comment, remediationNotes: r.remediationNotes, evidenceNote: r.evidenceNote,
      carriedForward: r.carriedForward, confirmed: r.confirmed, answeredBy: r.answeredBy, updatedAt: r.updatedAt.toISOString(), versionAnswered: r.questionVersion.version,
      evidence: r.evidenceLinks.map((l) => ({ linkId: l.id, id: l.evidence.id, title: l.evidence.title, status: l.evidence.verificationStatus, reference: l.evidence.reference, type: l.evidence.type })),
      actions: r.actions,
    };

  const { score, basis } = await scoreForAssessment(db, id, ctx);
  const blockers = editable ? await completionBlockers(db, id) : [];
  const projectEvidence = await db.evidence.findMany({ where: { projectId: a.projectId }, select: { id: true, title: true, verificationStatus: true }, orderBy: { title: "asc" } });
  const users = await userOptions();
  const isOversight = a.type === "OVERSIGHT" || a.project.children.length > 0;
  const focusDomainIds = parseList(a.focusDomainIds);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Assessments", href: "/assessments" }, ...(a.project.parent ? [{ label: a.project.parent.name, href: `/projects/${a.project.parent.id}` }] : []), { label: a.project.name, href: `/projects/${a.project.id}` }, { label: a.title }]}
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={a.status === "REVIEWED" ? "ok" : a.status === "COMPLETED" ? "accent" : a.status === "REJECTED" ? "danger" : "warn"}>{ASSESSMENT_STATUS_LABELS[a.status as AssessmentStatus]}</Badge>
            <Badge>{ASSESSMENT_TYPE_LABELS[a.type as AssessmentType]}</Badge>
            {locked && <Badge tone="neutral">🔒 Immutable snapshot · framework v{a.snapshot?.frameworkVersion ?? a.frameworkVersion?.version}</Badge>}
            {!locked && <Badge tone="neutral">Live score · framework v{ctx.frameworkVersion}</Badge>}
            {isOversight && <Badge tone="warn">Oversight – excluded from aggregated parent score</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/assessments/${id}/report`}>Report</LinkButton>
            <LinkButton href={`/api/export/responses?assessment=${id}`}>Export CSV</LinkButton>
            {can(user, "assessment:write") && !a.project.archived && <LinkButton href={`/assessments/new?base=${id}`}>{locked ? "Create reassessment / revision" : "New reassessment from this"}</LinkButton>}
            {editable && (
              <ActionButton variant="primary" size="md" action={completeAssessmentAction.bind(null, id)} confirm="Complete this assessment? Its score will be captured as an immutable snapshot and responses will be locked. Later changes require a reassessment." success="Assessment completed">
                Complete assessment
              </ActionButton>
            )}
            {editable && <ActionButton variant="danger" size="md" action={deleteAssessmentAction.bind(null, id)} redirectTo={`/projects/${a.projectId}`} confirm="Delete this draft assessment and all its responses? This cannot be undone." success="Draft deleted">Delete draft</ActionButton>}
          </>
        }
      />

      <Card title="Assessment details" actions={editable && <AssessmentMetaForm id={id} users={users} initial={{ title: a.title, scope: a.scope, assessorId: a.assessorId, reviewerId: a.reviewerId, assessmentDate: fmtDate(a.assessmentDate), periodStart: a.periodStart ? fmtDate(a.periodStart) : "", periodEnd: a.periodEnd ? fmtDate(a.periodEnd) : "", focusDomainIds }} />}>
        <KeyValue
          cols={4}
          items={[
            { k: "Project", v: <Link className="link" href={`/projects/${a.project.id}`}>{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name}</Link> },
            { k: "Assessor", v: a.assessor?.name },
            { k: "Reviewer", v: a.reviewer?.name },
            { k: "Assessment date / period", v: `${fmtDate(a.assessmentDate)}${a.periodStart ? ` (${fmtDate(a.periodStart)} – ${fmtDate(a.periodEnd)})` : ""}` },
            { k: "Based on", v: a.basedOn ? <Link className="link" href={`/assessments/${a.basedOn.id}`}>{a.basedOn.title}</Link> : "–" },
            { k: "Submitted", v: a.submittedAt ? fmtDateTime(a.submittedAt) : "–" },
            { k: "Reviewed", v: a.reviewedAt ? fmtDateTime(a.reviewedAt) : "–" },
            { k: "Score basis", v: basis === "SNAPSHOT" ? "Immutable snapshot captured at completion" : "Live calculation from current responses" },
            { k: "Scope", v: a.scope },
          ]}
        />
        {blockers.length > 0 && (
          <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <b>Before this assessment can be completed:</b>
            <ul className="ml-4 list-disc">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </Card>

      {(a.status === "COMPLETED" || a.reviews.length > 0) && (
        <ReviewPanel
          id={id}
          status={a.status}
          canReview={can(user, "assessment:review") && a.assessorId !== user?.id}
          isAssessor={a.assessorId === user?.id}
          reviews={a.reviews.map((r) => ({ id: r.id, reviewerName: r.reviewerName, decision: r.decision, comments: r.comments, createdAt: fmtDateTime(r.createdAt) }))}
        />
      )}

      <AssessmentWorkspace
        assessmentId={id}
        projectId={a.projectId}
        editable={editable}
        locked={locked}
        questions={questions}
        initialResponses={responses}
        initialSummary={{
          score: score.score, rawScore: score.rawScore, state: score.state, belowThreshold: score.belowThreshold, total: score.total, scored: score.scored, na: score.na,
          unable: score.unable, evidenceMissing: score.evidenceMissing, unanswered: score.unanswered, completion: score.completion, coverage: score.coverage,
          unconfirmedCarriedForward: score.unconfirmedCarriedForward,
          domains: score.domains.map((d) => ({ id: d.id, score: d.score, coverage: d.coverage, completion: d.completion, scored: d.scored, total: d.total, practices: d.practices.map((p) => ({ id: p.id, score: p.score })) })),
        }}
        criticalGapMaxLevel={ctx.criticalGapMaxLevel}
        levelLabels={ctx.levelLabels}
        anchors={ctx.anchors}
        focusDomainIds={focusDomainIds}
        initialQuestionId={focusQuestion}
        projectEvidence={projectEvidence.map((e) => ({ id: e.id, title: e.title, status: e.verificationStatus }))}
        canAction={can(user, "action:write")}
      />

      <Card title="Score details" subtitle="Domain → practice → question breakdown with weights and normalized weights">
        <MethodNote anchors={ctx.anchors} minCoverage={ctx.minCoverage} />
        <div className="mt-4"><BreakdownTable score={score} assessmentId={id} /></div>
      </Card>
    </div>
  );
}
