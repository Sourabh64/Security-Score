import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { parseSnapshot, scoreForAssessment } from "@/server/portfolio";
import { getScoringContext } from "@/server/framework";
import { Badge, Card, KeyValue, Table } from "@/components/ui";
import { ScoreChip } from "@/components/score";
import { BreakdownTable, MethodNote } from "@/components/score-details";
import { PrintButton } from "@/components/client";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_TYPE_LABELS, VERIFICATION_LABELS, type AssessmentStatus, type AssessmentType, type VerificationStatus } from "@/lib/constants";
import { formatPct, formatScore } from "@/lib/scoring/format";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export default async function AssessmentReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await db.assessment.findUnique({
    where: { id },
    include: {
      project: { include: { parent: true } },
      assessor: true,
      reviewer: true,
      reviews: { orderBy: { createdAt: "asc" } },
      basedOn: { include: { snapshot: true } },
      responses: { include: { questionVersion: true, question: true, evidenceLinks: { include: { evidence: true } } } },
      actions: true,
    },
  });
  if (!a) notFound();
  const ctx = await getScoringContext(db);
  const { score, basis, snapshot } = await scoreForAssessment(db, id, ctx);
  const prev = a.basedOn?.snapshot ? parseSnapshot(a.basedOn.snapshot.breakdown) : null;
  const byQ = new Map(a.responses.map((r) => [r.questionId, r]));
  const gaps = score.domains.flatMap((d) => d.practices.flatMap((p) => p.questions.filter((q) => q.level !== null && q.level <= ctx.criticalGapMaxLevel && (q.criticality === "HIGH" || q.criticality === "CRITICAL")).map((q) => ({ ...q, domain: d.name }))));
  const evidenceStates = { verified: 0, pending: 0, asserted: 0 };
  for (const r of a.responses.filter((x) => x.status === "ANSWERED")) {
    if (r.evidenceLinks.some((l) => l.evidence.verificationStatus === "VERIFIED")) evidenceStates.verified++;
    else if (r.evidenceLinks.some((l) => l.evidence.verificationStatus === "PENDING")) evidenceStates.pending++;
    else evidenceStates.asserted++;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="no-print flex justify-between">
        <Link href={`/assessments/${id}`} className="text-sm text-muted hover:underline">← Back to assessment</Link>
        <div className="flex gap-2"><a className="rounded-md border border-line px-3 py-2 text-sm hover:bg-subtle" href={`/api/export/responses?assessment=${id}`}>Responses CSV</a><PrintButton /></div>
      </div>
      <header className="border-b border-line pb-4">
        <p className="text-xs uppercase tracking-wide text-muted">{ctx.orgName} · Assessment report · Generated {fmtDate(new Date())}</p>
        <h1 className="mt-1 text-2xl font-semibold">{a.title}</h1>
        <p className="mt-1 text-xs text-muted">Internal hybrid maturity model inspired by CMM and OWASP SAMM. Not a formal OWASP SAMM assessment.</p>
      </header>
      <Card title="Overview">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <ScoreChip score={score.score} size="lg" />
          <div className="text-sm">
            <div>{basis === "SNAPSHOT" ? `Immutable snapshot (framework v${snapshot?.frameworkVersion})` : "Live (draft) score – provisional"}</div>
            <div className="text-muted">{formatPct(score.coverage)} scored coverage · {formatPct(score.completion)} completion · {score.scored} scored, {score.na} N/A, {score.unable} unable, {score.evidenceMissing} evidence missing, {score.unanswered} unanswered</div>
          </div>
        </div>
        <KeyValue cols={3} items={[
          { k: "Project", v: `${a.project.parent ? `${a.project.parent.name} / ` : ""}${a.project.name}` },
          { k: "Type / status", v: `${ASSESSMENT_TYPE_LABELS[a.type as AssessmentType]} · ${ASSESSMENT_STATUS_LABELS[a.status as AssessmentStatus]}` },
          { k: "Date / period", v: `${fmtDate(a.assessmentDate)}${a.periodStart ? ` (${fmtDate(a.periodStart)} – ${fmtDate(a.periodEnd)})` : ""}` },
          { k: "Assessor", v: a.assessor?.name },
          { k: "Reviewer", v: a.reviewer?.name },
          { k: "Submitted / reviewed", v: `${fmtDateTime(a.submittedAt)} / ${fmtDateTime(a.reviewedAt)}` },
          { k: "Scope", v: a.scope },
        ]} />
        {a.type === "OVERSIGHT" && <p className="mt-3 text-xs text-warn">Oversight assessment of a parent project – reported separately and excluded from the aggregated parent score.</p>}
      </Card>
      <Card title="Methodology"><MethodNote anchors={ctx.anchors} minCoverage={ctx.minCoverage} /></Card>
      <Card title="Domain scores" subtitle={prev ? `Compared with ${a.basedOn!.title}` : undefined} bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Domain</th><th className="th text-right">Coverage</th><th className="th text-right">Score</th>{prev && <th className="th text-right">Previous</th>}{prev && <th className="th text-right">Change</th>}</tr></thead>
          <tbody>
            {score.domains.map((d) => {
              const pv = prev?.domains.find((x) => x.id === d.id)?.score ?? null;
              const delta = d.score !== null && pv !== null ? d.score - pv : null;
              return (
                <tr key={d.id}>
                  <td className="td text-sm">{d.name}</td><td className="td text-right text-xs">{formatPct(d.coverage)}</td><td className="td text-right"><ScoreChip score={score.score === null ? null : d.score} size="sm" /></td>
                  {prev && <td className="td text-right text-xs tabular-nums">{formatScore(pv)}</td>}
                  {prev && <td className={`td text-right text-xs tabular-nums ${delta === null ? "" : delta >= 0 ? "text-ok" : "text-danger"}`}>{delta === null ? "–" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Critical gaps (${gaps.length})`}>
          <ul className="space-y-1 text-sm">{gaps.map((g) => <li key={g.id}><b className="font-mono text-xs">{g.key}</b> L{g.level} · {g.title} <span className="text-xs text-muted">({g.domain})</span></li>)}</ul>
          {gaps.length === 0 && <p className="text-sm text-muted">None.</p>}
        </Card>
        <Card title="Evidence status of answered questions">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between"><span>{VERIFICATION_LABELS.VERIFIED}</span><b>{evidenceStates.verified}</b></li>
            <li className="flex justify-between"><span>Supported – pending verification</span><b>{evidenceStates.pending}</b></li>
            <li className="flex justify-between"><span>Asserted by assessor only</span><b>{evidenceStates.asserted}</b></li>
          </ul>
        </Card>
      </div>
      <Card title="Review history">
        {a.reviews.length === 0 ? <p className="text-sm text-muted">No reviews recorded.</p> : (
          <ul className="space-y-2 text-sm">{a.reviews.map((r) => <li key={r.id}><Badge tone={r.decision === "APPROVED" ? "ok" : r.decision === "REJECTED" ? "danger" : "neutral"}>{r.decision}</Badge> {r.reviewerName} · {fmtDateTime(r.createdAt)} – {r.comments}</li>)}</ul>
        )}
      </Card>
      <Card title="Detailed breakdown" className="print-break"><BreakdownTable score={score} assessmentId={id} /></Card>
      <Card title="Responses" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Question</th><th className="th">Answer</th><th className="th">Notes & evidence</th></tr></thead>
          <tbody>
            {score.domains.flatMap((d) => d.practices.flatMap((p) => p.questions)).map((q) => {
              const r = byQ.get(q.id);
              return (
                <tr key={q.id}>
                  <td className="td text-xs"><b className="font-mono">{q.key}</b> {r?.questionVersion.title ?? q.title}{r && <span className="text-muted"> (v{r.questionVersion.version})</span>}</td>
                  <td className="td whitespace-nowrap text-xs">{q.level ? `L${q.level} (${q.score})` : q.status.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="td text-xs">{[r?.naJustification && `N/A: ${r.naJustification}`, r?.comment, r?.evidenceNote && `Ref: ${r.evidenceNote}`, r?.evidenceLinks.map((l) => `${l.evidence.title} [${VERIFICATION_LABELS[l.evidence.verificationStatus as VerificationStatus]}]`).join("; ")].filter(Boolean).join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
