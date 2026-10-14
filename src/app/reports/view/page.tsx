import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { collectGaps, computePortfolio, computeTrends, subtreeIds } from "@/server/portfolio";
import { domainRanking } from "@/server/views";
import { Badge, Card, Table } from "@/components/ui";
import { ScoreChip, ScoreKindBadge } from "@/components/score";
import { AggregationTable, MethodNote } from "@/components/score-details";
import { PrintButton } from "@/components/client";
import { formatPct, formatScore, scoreKindLabel } from "@/lib/scoring/format";
import { fmtDate, isOverdue } from "@/lib/utils";
import { ACTION_STATUS_LABELS, VERIFICATION_LABELS, type ActionStatus, type VerificationStatus } from "@/lib/constants";

export default async function ReportView({ searchParams }: { searchParams: Promise<{ scope?: string; id?: string }> }) {
  const { scope = "org", id } = await searchParams;
  const p = await computePortfolio(db);
  const trends = await computeTrends(db, p);
  const now = new Date();

  let title = `${p.ctx.orgName} – Organization maturity report`;
  let projectIds = p.projects.filter((x) => p.ctx.includeArchivedInReports || !x.archived).map((x) => x.id);
  let domainFilter: string | null = null;
  let rootId: string | null = null;
  if (scope === "project") {
    if (!id || !p.byId.has(id)) notFound();
    rootId = id;
    projectIds = subtreeIds(p, id);
    title = `${p.byId.get(id)!.name} – ${p.byId.get(id)!.parentId ? "Subproject" : "Project"} maturity report`;
  } else if (scope === "domain") {
    const d = p.framework.find((x) => x.id === id);
    if (!d) notFound();
    domainFilter = d.id;
    title = `${d.name} – Domain maturity report`;
  }
  const scoring = p.scoringProjectIds.filter((x) => projectIds.includes(x));
  const gaps = collectGaps(p, { projectIds }).filter((g) => !domainFilter || g.domainId === domainFilter);
  const [actions, evidence] = await Promise.all([
    db.remediationAction.findMany({
      where: { projectId: { in: projectIds }, ...(domainFilter ? { domainId: domainFilter } : {}) },
      include: { project: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { targetDate: "asc" }],
    }),
    db.evidence.groupBy({ by: ["verificationStatus"], where: { projectId: { in: projectIds } }, _count: true }),
  ]);

  // Maturity distribution of answers in assessments currently driving scores
  const dist: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, NA: 0, UNABLE: 0, EVIDENCE: 0, UNANSWERED: 0 };
  const practiceList: { name: string; domain: string; project: string; score: number }[] = [];
  for (const pid of scoring) {
    const s = p.direct.get(pid);
    if (!s || s.score === null) continue;
    for (const d of s.domains) {
      if (domainFilter && d.id !== domainFilter) continue;
      for (const pr of d.practices) {
        if (pr.score !== null) practiceList.push({ name: pr.name, domain: d.name, project: p.byId.get(pid)!.name, score: pr.score });
        for (const q of pr.questions) {
          if (q.level) dist[q.level]++;
          else if (q.status === "NOT_APPLICABLE") dist.NA++;
          else if (q.status === "UNABLE_TO_DETERMINE") dist.UNABLE++;
          else if (q.status === "EVIDENCE_MISSING") dist.EVIDENCE++;
          else dist.UNANSWERED++;
        }
      }
    }
  }
  const distTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  const weakestPractices = practiceList.sort((a, b) => a.score - b.score).slice(0, 10);
  const ranking = domainRanking(p);
  const headline = rootId ? p.effective.get(rootId)! : p.org;
  const trendRows = rootId ? trends.byProject.get(rootId) ?? [] : trends.org;
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="no-print flex justify-between">
        <Link href="/reports" className="text-sm text-muted hover:underline">← Reports</Link>
        <div className="flex gap-2">
          <a className="rounded-md border border-line px-3 py-2 text-sm hover:bg-subtle" href={`/api/export/scores${rootId ? `?project=${rootId}` : ""}`}>Scores CSV</a>
          <a className="rounded-md border border-line px-3 py-2 text-sm hover:bg-subtle" href={`/api/export/actions?status=any${rootId ? `&project=${rootId}` : ""}`}>Actions CSV</a>
          <PrintButton />
        </div>
      </div>
      <header className="border-b border-line pb-4">
        <p className="text-xs uppercase tracking-wide text-muted">{p.ctx.appTitle} · Generated {fmtDate(now)} · Framework v{p.ctx.frameworkVersion}</p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-xs text-muted">Internal hybrid maturity model inspired by CMM and OWASP SAMM. This is not a formal OWASP SAMM assessment or certification.</p>
      </header>

      <Card title="Summary">
        {domainFilter ? (
          <div className="flex flex-wrap items-center gap-4">
            <ScoreChip score={ranking.find((r) => r.id === domainFilter)?.score ?? null} size="lg" />
            <span className="text-sm text-muted">Organization domain score from {ranking.find((r) => r.id === domainFilter)?.contributors} of {mains.length} main projects.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <ScoreChip score={headline.score} size="lg" decimals={rootId ? 1 : p.ctx.orgSummaryDecimals} />
            <ScoreKindBadge source={headline.source} state={headline.state} />
            <span className="text-sm text-muted">
              {headline.aggregation ? `${headline.aggregation.contributingCount} of ${headline.aggregation.childCount} components contribute (${formatPct(headline.aggregation.weightCoverage)} of weight).` : `${formatPct(headline.coverage)} scored coverage · ${formatPct(headline.completion)} completion.`}
            </span>
          </div>
        )}
        {!domainFilter && headline.aggregation && <div className="mt-4"><AggregationTable eff={headline} decimals={rootId ? 1 : p.ctx.orgSummaryDecimals} /></div>}
      </Card>

      <Card title="Scoring methodology" id="method">
        <MethodNote anchors={p.ctx.anchors} minCoverage={p.ctx.minCoverage} />
        <Table className="mt-3">
          <thead><tr><th className="th">Level</th><th className="th">Label</th><th className="th">Anchor</th></tr></thead>
          <tbody>{[1, 2, 3, 4, 5].map((l) => <tr key={l}><td className="td">L{l}</td><td className="td">{p.ctx.levelLabels[l]}</td><td className="td tabular-nums">{p.ctx.anchors[l]}</td></tr>)}</tbody>
        </Table>
        <p className="mt-2 text-xs text-muted">Score basis: {p.ctx.scoreBasis === "LATEST" ? "latest non-rejected assessment (drafts are live and provisional)" : "latest completed/reviewed assessment only"}. Organization summaries rounded to {p.ctx.orgSummaryDecimals} decimal(s), half away from zero.</p>
      </Card>

      <Card title="Scores by component" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Component</th><th className="th">Score</th><th className="th">Source</th><th className="th">Coverage</th><th className="th">Completion</th>{domainFilter && <th className="th">Domain score</th>}</tr></thead>
          <tbody>
            {projectIds.map((pid) => {
              const x = p.byId.get(pid)!;
              const e = p.effective.get(pid)!;
              return (
                <tr key={pid}>
                  <td className="td">{x.parentId && !rootId ? `${p.byId.get(x.parentId)!.name} / ` : ""}{x.name}{x.archived && <Badge className="ml-1">archived</Badge>}</td>
                  <td className="td"><ScoreChip score={e.score} size="sm" /></td>
                  <td className="td text-xs">{scoreKindLabel(e)}</td>
                  <td className="td text-xs">{e.aggregation ? `${e.aggregation.contributingCount}/${e.aggregation.childCount} components` : formatPct(e.coverage)}</td>
                  <td className="td text-xs">{formatPct(e.completion)}</td>
                  {domainFilter && <td className="td"><ScoreChip score={e.score === null ? null : e.domains.find((d) => d.id === domainFilter)?.score ?? null} size="sm" /></td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Maturity distribution" subtitle="Answers in assessments currently driving scores">
          <Table>
            <tbody>
              {[["1", "Level 1"], ["2", "Level 2"], ["3", "Level 3"], ["4", "Level 4"], ["5", "Level 5"], ["NA", "Not applicable"], ["UNABLE", "Unable to determine"], ["EVIDENCE", "Evidence missing"], ["UNANSWERED", "Unanswered"]].map(([k, l]) => (
                <tr key={k}><td className="td text-sm">{l}</td><td className="td text-right tabular-nums">{dist[k]}</td><td className="td w-1/2"><div className="h-2 rounded bg-accent/70" style={{ width: `${distTotal ? (dist[k] / distTotal) * 100 : 0}%` }} /></td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={domainFilter ? "Weakest practices" : "Weakest domains & practices"}>
          {!domainFilter && !rootId && (
            <ol className="mb-3 space-y-1 text-sm">{ranking.slice(0, 5).map((d) => <li key={d.id} className="flex justify-between"><span>{d.name}</span><ScoreChip score={d.score} size="sm" /></li>)}</ol>
          )}
          {rootId && (
            <ol className="mb-3 space-y-1 text-sm">{[...p.effective.get(rootId)!.domains].filter((d) => d.score !== null).sort((a, b) => a.score! - b.score!).slice(0, 5).map((d) => <li key={d.id} className="flex justify-between"><span>{d.name}</span><ScoreChip score={d.score} size="sm" /></li>)}</ol>
          )}
          <ul className="space-y-1 text-xs">{weakestPractices.map((w, i) => <li key={i} className="flex justify-between gap-2"><span>{w.name} <span className="text-muted">({w.project})</span></span><span className="tabular-nums">{formatScore(w.score)}</span></li>)}</ul>
        </Card>
      </div>

      <Card title={`Critical gaps (${gaps.length})`} id="gaps" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Question</th><th className="th">Component</th><th className="th">Domain</th><th className="th">Level</th><th className="th">Criticality</th></tr></thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.projectId + g.questionId}>
                <td className="td text-sm"><Link className="link" href={`/assessments/${g.assessmentId}?q=${g.questionId}`}>{g.questionKey}</Link> {g.title}</td>
                <td className="td text-xs">{g.projectName}</td><td className="td text-xs">{g.domainName}</td><td className="td text-xs">L{g.level}</td><td className="td text-xs">{g.criticality}</td>
              </tr>
            ))}
            {gaps.length === 0 && <tr><td className="td text-muted">No critical gaps.</td></tr>}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Evidence status">
          <ul className="space-y-1 text-sm">
            {(["VERIFIED", "PENDING", "REJECTED"] as VerificationStatus[]).map((s) => <li key={s} className="flex justify-between"><span>{VERIFICATION_LABELS[s]}</span><b>{evidence.find((e) => e.verificationStatus === s)?._count ?? 0}</b></li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">Answers without linked evidence are reported as asserted by the assessor.</p>
        </Card>
        <Card title="Comparison with previous assessments" subtitle="Completed snapshots over time">
          <Table>
            <tbody>{trendRows.map((t) => <tr key={t.date}><td className="td text-xs">{t.date}</td><td className="td text-right tabular-nums">{formatScore(t.score)}</td><td className="td text-right text-xs text-muted">{formatPct(t.coverage)} coverage</td></tr>)}</tbody>
          </Table>
          {trendRows.length === 0 && <p className="text-sm text-muted">No completed assessments yet.</p>}
        </Card>
      </div>

      <Card title={`Remediation actions (${actions.length})`} bodyClassName="p-0" className="print-break">
        <Table>
          <thead><tr><th className="th">Action</th><th className="th">Component</th><th className="th">Priority</th><th className="th">Owner</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td className="td text-sm"><Link className="link" href={`/actions/${a.id}`}>{a.title}</Link></td>
                <td className="td text-xs">{a.project.name}</td><td className="td text-xs">{a.priority}</td><td className="td text-xs">{a.owner || "–"}</td>
                <td className={`td whitespace-nowrap text-xs ${isOverdue(a.targetDate, a.status, now) ? "font-semibold text-danger" : ""}`}>{fmtDate(a.targetDate)}{isOverdue(a.targetDate, a.status, now) && " (overdue)"}</td>
                <td className="td text-xs">{ACTION_STATUS_LABELS[a.status as ActionStatus]}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
