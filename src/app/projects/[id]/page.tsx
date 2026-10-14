import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { collectGaps, computePortfolio, computeTrends, parseSnapshot, subtreeIds } from "@/server/portfolio";
import { heatColumns, heatRows } from "@/server/views";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, EmptyState, KeyValue, LinkButton, PageHeader, ProgressBar, Stat, Table } from "@/components/ui";
import { CoverageText, ScoreChip, ScoreKindBadge, impliedLevelLabel } from "@/components/score";
import { ScoreBars, TrendChart } from "@/components/charts";
import { Heatmap } from "@/components/heatmap";
import { AggregationTable, BreakdownTable, MethodNote } from "@/components/score-details";
import { ActionButton } from "@/components/client";
import { archiveProjectAction, deleteProjectAction, restoreProjectAction } from "@/server/actions";
import { formatPct, formatScore } from "@/lib/scoring/format";
import { fmtDate, isOverdue } from "@/lib/utils";
import { ACTION_STATUS_LABELS, ASSESSMENT_STATUS_LABELS, ASSESSMENT_TYPE_LABELS, LIFECYCLE_LABELS, type ActionStatus, type AssessmentStatus, type AssessmentType } from "@/lib/constants";
import { effectiveCapabilities, parseList } from "@/lib/hierarchy";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, include: { parent: true } });
  if (!project) notFound();
  const [p, user] = await Promise.all([computePortfolio(db), getCurrentUser()]);
  const trends = await computeTrends(db, p);
  const eff = p.effective.get(id)!;
  const direct = p.direct.get(id) ?? null;
  const basis = p.basis.get(id) ?? null;
  const oversight = p.oversight.get(id) ?? null;
  const children = p.childrenOf(id);
  const activeChildren = p.activeChildrenOf(id);
  const isAggregated = eff.source === "AGGREGATED";
  const subtree = subtreeIds(p, id);
  const now = new Date();

  const [assessments, actions, evidence, naResponses] = await Promise.all([
    db.assessment.findMany({
      where: { projectId: id },
      orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
      include: { snapshot: { select: { overallScore: true, coverage: true, completion: true, frameworkVersion: true } }, assessor: { select: { name: true } }, reviewer: { select: { name: true } } },
    }),
    db.remediationAction.findMany({ where: { projectId: { in: subtree } }, include: { project: { select: { name: true } } }, orderBy: [{ targetDate: "asc" }] }),
    db.evidence.groupBy({ by: ["verificationStatus"], where: { projectId: { in: subtree } }, _count: true }),
    basis && !isAggregated
      ? db.assessmentResponse.findMany({ where: { assessmentId: basis.assessmentId, status: { in: ["NOT_APPLICABLE", "UNABLE_TO_DETERMINE", "EVIDENCE_MISSING"] } }, include: { question: { select: { key: true } } } })
      : Promise.resolve([]),
  ]);
  const gaps = collectGaps(p, { projectIds: subtree });
  const openActions = actions.filter((a) => !["CLOSED", "ACCEPTED_RISK"].includes(a.status));
  const evCount = (s: string) => evidence.find((e) => e.verificationStatus === s)?._count ?? 0;

  // Historical comparison: latest two completed snapshots of this project's own assessments
  const completed = assessments.filter((a) => a.snapshot && ["COMPLETED", "REVIEWED"].includes(a.status));
  const [latestSnap, prevSnap] = await Promise.all(
    completed.slice(0, 2).map((a) => db.scoreSnapshot.findUnique({ where: { assessmentId: a.id } }).then((s) => (s ? parseSnapshot(s.breakdown) : null))),
  );

  const weakest = direct && !isAggregated && direct.score !== null
    ? direct.domains.flatMap((d) => d.practices.filter((pr) => pr.score !== null).map((pr) => ({ ...pr, domain: d.name }))).sort((a, b) => a.score! - b.score!).slice(0, 6)
    : [];
  const unanswered = direct && !isAggregated ? direct.domains.flatMap((d) => d.practices.flatMap((pr) => pr.questions.filter((q) => q.status === "UNANSWERED"))) : [];
  const caps = effectiveCapabilities(p.projects, id);
  const canWrite = can(user, "project:write");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, ...(project.parent ? [{ label: project.parent.name, href: `/projects/${project.parent.id}` }] : []), { label: project.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {project.name}
            <span className="font-mono text-sm font-normal text-muted">{project.key}</span>
            <Badge tone={project.criticality === "CRITICAL" ? "danger" : project.criticality === "HIGH" ? "warn" : "neutral"}>{project.criticality}</Badge>
            {project.parentId ? <Badge>Subproject</Badge> : <Badge tone="accent">Main project</Badge>}
            {project.archived && <Badge tone="warn">Archived {fmtDate(project.archivedAt)}</Badge>}
          </span>
        }
        subtitle={project.description}
        actions={
          <>
            {!project.archived && can(user, "assessment:write") && <LinkButton href={`/assessments/new?project=${id}`} variant="primary">{isAggregated ? "Start oversight assessment" : "Start assessment"}</LinkButton>}
            {!project.parentId && !project.archived && canWrite && <LinkButton href={`/projects/new?parent=${id}`}>Add subproject</LinkButton>}
            {canWrite && <LinkButton href={`/projects/${id}/edit`}>Edit</LinkButton>}
            <LinkButton href={`/reports/view?scope=project&id=${id}`}>Report</LinkButton>
            {canWrite && !project.archived && (
              <ActionButton size="md" action={archiveProjectAction.bind(null, id)} confirm={`Archive "${project.name}"${children.length ? " and its subprojects" : ""}? Historical assessments are retained; archived projects stop contributing to scores.`} success="Project archived">Archive</ActionButton>
            )}
            {canWrite && project.archived && <ActionButton size="md" action={restoreProjectAction.bind(null, id)} success="Project restored">Restore</ActionButton>}
            {can(user, "project:delete") && (
              <ActionButton size="md" variant="danger" action={deleteProjectAction.bind(null, id)} redirectTo="/projects" confirm={`Permanently delete "${project.name}"? Only allowed when it has no assessments, actions, evidence or subprojects.`} success="Project deleted">Delete</ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card title="Maturity score" subtitle={isAggregated ? "Aggregated from active subprojects" : "From this project's own assessment"}>
          <div className="flex items-center gap-4">
            <ScoreChip score={eff.score} size="lg" />
            <div className="space-y-1.5">
              <ScoreKindBadge source={eff.source} state={eff.state} />
              <div className="text-xs text-muted">{impliedLevelLabel(eff.score, p.ctx.levelLabels)}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            {isAggregated ? (
              <>
                <div className="flex justify-between"><span className="text-muted">Contributing subprojects</span><b>{eff.aggregation!.contributingCount} of {eff.aggregation!.childCount}</b></div>
                <div className="flex justify-between"><span className="text-muted">Aggregation coverage (by weight)</span><b>{formatPct(eff.aggregation!.weightCoverage)}</b></div>
                <ProgressBar value={eff.aggregation!.weightCoverage} label="Aggregation coverage" />
                <div className="flex justify-between"><span className="text-muted">Question coverage across subprojects</span><b>{formatPct(eff.coverage)}</b></div>
              </>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted">Scored coverage</span><b>{formatPct(eff.coverage)}</b></div>
                <ProgressBar value={eff.coverage} label="Scored coverage" />
                <div className="flex justify-between"><span className="text-muted">Completion (any response)</span><b>{formatPct(eff.completion)}</b></div>
                <div className="flex justify-between"><span className="text-muted">Scored / N/A / unable / evidence missing / unanswered</span><b className="tabular-nums">{eff.scored}/{eff.na}/{eff.unable}/{eff.evidenceMissing}/{eff.unanswered}</b></div>
                {direct?.belowThreshold && <p className="rounded bg-warn/10 px-2 py-1 text-warn">Provisional value {formatScore(direct.rawScore)} is below the {p.ctx.minCoverage}% minimum coverage, so the project is shown as Not assessed.</p>}
              </>
            )}
            {basis && !isAggregated && (
              <div className="border-t border-line pt-2">
                <span className="text-muted">Source: </span>
                <Link href={`/assessments/${basis.assessmentId}`} className="link">{basis.title}</Link>
                <span className="text-muted"> · {basis.basis === "SNAPSHOT" ? "immutable snapshot" : "live draft calculation"} · {ASSESSMENT_STATUS_LABELS[basis.status as AssessmentStatus]}</span>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Critical gaps" value={gaps.length} tone={gaps.length ? "danger" : "ok"} hint={`Level ≤ ${p.ctx.criticalGapMaxLevel}, HIGH/CRITICAL`} />
            <Stat label="Open actions" value={openActions.length} hint={`${openActions.filter((a) => isOverdue(a.targetDate, a.status, now)).length} overdue`} href={`/actions?project=${id}`} tone={openActions.some((a) => isOverdue(a.targetDate, a.status, now)) ? "danger" : undefined} />
            <Stat label="Evidence" value={evCount("VERIFIED") + evCount("PENDING") + evCount("REJECTED")} hint={`${evCount("VERIFIED")} verified · ${evCount("PENDING")} pending · ${evCount("REJECTED")} rejected`} href={`/evidence?project=${id}`} />
            <Stat label="Assessments" value={assessments.length} hint={`Last: ${fmtDate(p.lastAssessment.get(id))}`} />
          </div>
          <Card title="Project details">
            <KeyValue
              cols={3}
              items={[
                { k: "Product owner", v: project.productOwner },
                { k: "Security owner", v: project.securityOwner },
                { k: "Technical owner", v: project.technicalOwner },
                { k: "Lifecycle", v: LIFECYCLE_LABELS[project.lifecycleStatus as keyof typeof LIFECYCLE_LABELS] },
                { k: "Created", v: fmtDate(project.createdAt) },
                { k: "Aggregation weight", v: `${project.weight}${project.weightRationale ? ` – ${project.weightRationale}` : ""}` },
                { k: "Capabilities (incl. inherited)", v: caps.length ? caps.map((c) => <code key={c} className="mr-1 rounded bg-subtle px-1 text-xs">{c}</code>) : "generic (no product-specific questions)" },
                { k: "Tags", v: parseList(project.tags).map((t) => <Badge key={t} className="mr-1">{t}</Badge>) },
                { k: "Business purpose", v: project.businessPurpose },
              ]}
            />
          </Card>
        </div>
      </div>

      {oversight && (
        <Card title="Parent-level oversight score (separate)" subtitle="From this parent's own oversight assessment. It is NOT part of the aggregated score above and never double-counted.">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <ScoreChip score={oversight.score} />
            <CoverageText coverage={oversight.coverage} completion={oversight.completion} />
            {basis && <Link className="link" href={`/assessments/${basis.assessmentId}`}>{basis.title}</Link>}
          </div>
        </Card>
      )}

      {children.length > 0 && (
        <Card title="Subproject comparison" subtitle="Click a subproject for its dashboard. Archived subprojects are excluded from aggregation." actions={canWrite && !project.archived && <LinkButton size="sm" href={`/projects/new?parent=${id}`}>Add subproject</LinkButton>}>
          <div className="grid gap-6 xl:grid-cols-2">
            <ScoreBars items={activeChildren.map((c) => ({ id: c.id, label: c.name, score: p.effective.get(c.id)!.score, href: `/projects/${c.id}` }))} />
            <AggregationTable eff={eff} />
          </div>
          {children.some((c) => c.archived) && (
            <div className="mt-3 text-xs text-muted">Archived: {children.filter((c) => c.archived).map((c) => <Link key={c.id} href={`/projects/${c.id}`} className="mr-2 link">{c.name}</Link>)}</div>
          )}
        </Card>
      )}

      {isAggregated && (
        <Card title="Subproject × domain heatmap" subtitle="Hatched = not assessed; · = not applicable">
          <Heatmap rows={heatRows(p, { mainIds: [id] }).filter((r) => r.level === "sub")} columns={heatColumns(p)} levelLabels={p.ctx.levelLabels} defaultLevel="sub" compact />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Domain scores" subtitle={isAggregated ? "Weighted across contributing subprojects" : "Click a domain row below for practice details"}>
          {eff.score === null ? (
            <EmptyState title="Not assessed">No sufficient scored responses yet. Unassessed domains are never shown as zero.</EmptyState>
          ) : (
            <ScoreBars items={eff.domains.map((d) => ({ id: d.id, label: d.name, score: d.score, href: isAggregated ? `/domains/${d.id}` : `#domain-${d.id}` }))} />
          )}
        </Card>
        <Card title="Score trend" subtitle="Completed assessment snapshots">
          <TrendChart series={[{ key: "s", label: project.name, points: trends.byProject.get(id) ?? [] }]} />
          {latestSnap && prevSnap && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Latest vs previous completed assessment</h3>
              <Table>
                <thead><tr><th className="th">Domain</th><th className="th text-right">Previous</th><th className="th text-right">Latest</th><th className="th text-right">Change</th></tr></thead>
                <tbody>
                  {latestSnap.domains.map((d) => {
                    const prev = prevSnap.domains.find((x) => x.id === d.id)?.score ?? null;
                    const delta = d.score !== null && prev !== null ? d.score - prev : null;
                    return (
                      <tr key={d.id}>
                        <td className="td text-xs">{d.name}</td>
                        <td className="td text-right text-xs tabular-nums">{formatScore(prev)}</td>
                        <td className="td text-right text-xs tabular-nums">{formatScore(d.score)}</td>
                        <td className={`td text-right text-xs tabular-nums ${delta === null ? "" : delta >= 0 ? "text-ok" : "text-danger"}`}>{delta === null ? "–" : `${delta >= 0 ? "▲ +" : "▼ "}${delta.toFixed(1)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {!isAggregated && direct && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Score details" subtitle="Weights, normalized weights and contributions" className="xl:col-span-2" id="score-details">
            <MethodNote anchors={p.ctx.anchors} minCoverage={p.ctx.minCoverage} />
            <div className="mt-4"><BreakdownTable score={direct} assessmentId={basis?.assessmentId} /></div>
          </Card>
          <div className="space-y-4">
            <Card title="Weakest assessed practices">
              {weakest.length ? (
                <ul className="space-y-2 text-sm">{weakest.map((w) => <li key={w.id} className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate">{w.name}</span><span className="text-xs text-muted">{w.domain}</span></span><ScoreChip score={w.score} size="sm" /></li>)}</ul>
              ) : <p className="text-sm text-muted">No scored practices.</p>}
            </Card>
            <Card title="Unanswered & non-scored questions" subtitle={`${unanswered.length} unanswered · ${eff.na} N/A · ${eff.unable} unable · ${eff.evidenceMissing} evidence missing`}>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
                {naResponses.map((r) => (
                  <li key={r.id}><Badge tone={r.status === "NOT_APPLICABLE" ? "neutral" : "warn"}>{r.status.replace(/_/g, " ")}</Badge> <Link className="link" href={`/assessments/${r.assessmentId}?q=${r.questionId}`}>{r.question.key}</Link>{r.naJustification && <span className="text-muted"> – {r.naJustification}</span>}</li>
                ))}
                {unanswered.slice(0, 40).map((q) => <li key={q.id}><Badge>UNANSWERED</Badge> <Link className="link" href={basis ? `/assessments/${basis.assessmentId}?q=${q.id}` : `/framework/questions/${q.id}`}>{q.key}</Link> <span className="text-muted">{q.title}</span></li>)}
                {naResponses.length + unanswered.length === 0 && <li className="text-muted">None – every applicable question has a response.</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
      {isAggregated && (
        <Card title="How this score is calculated"><MethodNote anchors={p.ctx.anchors} minCoverage={p.ctx.minCoverage} /></Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Critical gaps" subtitle="From the assessments currently driving scores" bodyClassName="p-0">
          {gaps.length === 0 ? <div className="p-4 text-sm text-muted">No critical gaps.</div> : (
            <Table>
              <thead><tr><th className="th">Question</th>{isAggregated && <th className="th">Subproject</th>}<th className="th">Level</th><th className="th" /></tr></thead>
              <tbody>
                {gaps.slice(0, 15).map((g) => (
                  <tr key={`${g.projectId}${g.questionId}`}>
                    <td className="td"><Link className="link" href={`/assessments/${g.assessmentId}?q=${g.questionId}`}>{g.questionKey}</Link> <span className="text-xs text-muted">{g.title}</span></td>
                    {isAggregated && <td className="td text-xs">{g.projectName}</td>}
                    <td className="td"><Badge tone={g.criticality === "CRITICAL" ? "danger" : "warn"}>L{g.level} · {g.criticality}</Badge></td>
                    <td className="td">{can(user, "action:write") && <Link className="text-xs link whitespace-nowrap" href={`/actions/new?project=${g.projectId}&question=${g.questionId}&assessment=${g.assessmentId}`}>+ Action</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {gaps.length > 15 && <p className="px-4 py-2 text-xs text-muted">+{gaps.length - 15} more in the project report.</p>}
        </Card>
        <Card title="Open remediation actions" bodyClassName="p-0" actions={can(user, "action:write") && <LinkButton size="sm" href={`/actions/new?project=${id}`}>New action</LinkButton>}>
          {openActions.length === 0 ? <div className="p-4 text-sm text-muted">No open actions.</div> : (
            <Table>
              <thead><tr><th className="th">Action</th><th className="th">Priority</th><th className="th">Target</th><th className="th">Status</th></tr></thead>
              <tbody>
                {openActions.slice(0, 12).map((a) => {
                  const od = isOverdue(a.targetDate, a.status, now);
                  return (
                    <tr key={a.id}>
                      <td className="td"><Link className="link" href={`/actions/${a.id}`}>{a.title}</Link>{isAggregated && <div className="text-xs text-muted">{a.project.name}</div>}</td>
                      <td className="td"><Badge tone={a.priority === "CRITICAL" ? "danger" : a.priority === "HIGH" ? "warn" : "neutral"}>{a.priority}</Badge></td>
                      <td className={`td whitespace-nowrap text-xs ${od ? "font-semibold text-danger" : ""}`}>{fmtDate(a.targetDate)}{od && " ⚠"}</td>
                      <td className="td text-xs">{ACTION_STATUS_LABELS[a.status as ActionStatus]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Assessment history" bodyClassName="p-0" actions={!project.archived && can(user, "assessment:write") && <LinkButton size="sm" href={`/assessments/new?project=${id}`}>New assessment</LinkButton>}>
        {assessments.length === 0 ? <div className="p-4"><EmptyState title="No assessments yet">{isAggregated ? "This parent is scored from its subprojects. You may still record an optional oversight assessment." : "Start a baseline assessment to score this project."}</EmptyState></div> : (
          <Table>
            <thead><tr><th className="th">Assessment</th><th className="th">Type</th><th className="th">Date</th><th className="th">Status</th><th className="th">Assessor / reviewer</th><th className="th">Score</th><th className="th">Coverage</th><th className="th">Framework</th></tr></thead>
            <tbody>
              {assessments.map((a) => {
                const live = !a.snapshot ? (basis?.assessmentId === a.id ? direct : null) : null;
                return (
                  <tr key={a.id}>
                    <td className="td"><Link className="link" href={`/assessments/${a.id}`}>{a.title}</Link>{basis?.assessmentId === a.id && <Badge tone="accent" className="ml-2">current basis</Badge>}</td>
                    <td className="td text-xs">{ASSESSMENT_TYPE_LABELS[a.type as AssessmentType]}</td>
                    <td className="td whitespace-nowrap text-xs">{fmtDate(a.assessmentDate)}</td>
                    <td className="td text-xs">{ASSESSMENT_STATUS_LABELS[a.status as AssessmentStatus]}</td>
                    <td className="td text-xs">{a.assessor?.name ?? "–"} / {a.reviewer?.name ?? "–"}</td>
                    <td className="td"><ScoreChip score={a.snapshot ? a.snapshot.overallScore : live?.score ?? null} size="sm" />{!a.snapshot && <span className="ml-1 text-[10px] text-muted">{live ? "live" : ""}</span>}</td>
                    <td className="td text-xs text-muted">{a.snapshot ? formatPct(a.snapshot.coverage) : live ? formatPct(live.coverage) : "–"}</td>
                    <td className="td text-xs text-muted">{a.snapshot ? `v${a.snapshot.frameworkVersion}` : "current"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
