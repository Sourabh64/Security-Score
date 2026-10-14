import Link from "next/link";
import { db } from "@/server/db";
import { computePortfolio, computeTrends, collectGaps } from "@/server/portfolio";
import { domainRanking, heatColumns, heatRows, scoringUnitsByMain } from "@/server/views";
import { Badge, Card, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { ScoreChip, ScoreKindBadge } from "@/components/score";
import { CoverageBars, ScoreBars, TrendChart } from "@/components/charts";
import { Heatmap } from "@/components/heatmap";
import { formatPct, formatScore } from "@/lib/scoring/format";
import { fmtDate, isOverdue } from "@/lib/utils";
import { ACTION_STATUS_LABELS, ASSESSMENT_STATUS_LABELS, type ActionStatus, type AssessmentStatus } from "@/lib/constants";

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default async function Dashboard() {
  const p = await computePortfolio(db);
  const trends = await computeTrends(db, p);
  const gaps = collectGaps(p);
  const decimals = p.ctx.orgSummaryDecimals;
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  const subs = p.projects.filter((x) => x.parentId && !x.archived && !p.byId.get(x.parentId)!.archived);
  const units = scoringUnitsByMain(p);
  const totalUnits = units.reduce((a, u) => a + u.units.length, 0);
  const scoredUnits = units.reduce((a, u) => a + u.complete + u.partial, 0);
  const now = new Date();

  const [openActions, recent] = await Promise.all([
    db.remediationAction.findMany({
      where: { status: { notIn: ["CLOSED", "ACCEPTED_RISK"] }, project: { archived: false } },
      include: { project: { select: { name: true, parent: { select: { name: true } } } } },
    }),
    db.assessment.findMany({
      where: { status: { in: ["COMPLETED", "REVIEWED"] } },
      orderBy: [{ submittedAt: "desc" }],
      take: 6,
      include: { project: { select: { name: true, parent: { select: { name: true } } } }, snapshot: { select: { overallScore: true, coverage: true } } },
    }),
  ]);
  const overdue = openActions.filter((a) => isOverdue(a.targetDate, a.status, now));
  const priorityList = [...openActions]
    .sort((a, b) => Number(isOverdue(b.targetDate, b.status, now)) - Number(isOverdue(a.targetDate, a.status, now)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.targetDate?.getTime() ?? 9e15) - (b.targetDate?.getTime() ?? 9e15))
    .slice(0, 8);

  const ranking = domainRanking(p);
  const gapsByMain = mains.map((m) => ({ m, n: gaps.filter((g) => g.mainProjectId === m.id).length }));
  const org = p.org;
  const agg = org.aggregation!;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${p.ctx.orgName} – Product Security Maturity`}
        subtitle="Organization overview across active product domains. Scores use a 1–100 scale and are calculated only from assessed items; coverage is always shown alongside."
        actions={
          <>
            <LinkButton href="/assessments/new" variant="primary">Start assessment</LinkButton>
            <LinkButton href="/reports/view?scope=org">Organization report</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card title="Organization maturity score" subtitle="Weighted average of active main projects with a score">
          <div className="flex items-center gap-4">
            <ScoreChip score={org.score} decimals={decimals} size="lg" />
            <div className="space-y-1.5">
              <ScoreKindBadge source={org.source} state={org.state} />
              <p className="text-xs text-muted">
                <b className="text-fg">{agg.contributingCount} of {agg.childCount}</b> active main projects contribute ({formatPct(agg.weightCoverage)} of project weight).
              </p>
            </div>
          </div>
          {agg.contributingCount < agg.childCount && (
            <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              ⚠ {agg.childCount - agg.contributingCount} active project(s) are not assessed and are excluded from the average – the score does not represent the whole organization.
            </p>
          )}
          <div className="mt-4 space-y-1.5 text-xs">
            {agg.children.map((c) => (
              <div key={c.projectId} className="flex items-center justify-between gap-2">
                <Link href={`/projects/${c.projectId}`} className="truncate hover:underline">{c.name}</Link>
                <span className="flex items-center gap-2 text-muted">
                  <span title="Normalized weight in the organization score">{c.contributes ? formatPct(c.normalizedWeight * 100) : "excluded"}</span>
                  <ScoreChip score={c.score} size="sm" decimals={decimals} />
                </span>
              </div>
            ))}
          </div>
          <Link href="/reports/view?scope=org#method" className="mt-3 inline-block text-xs text-accent hover:underline">How is this calculated?</Link>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active main projects" value={mains.length} hint={`${subs.length} active subprojects`} href="/projects" />
          <Stat label="Assessment coverage" value={formatPct(totalUnits ? (scoredUnits / totalUnits) * 100 : 0)} hint={`${scoredUnits} of ${totalUnits} scoring units have a score`} href="/heatmap" />
          <Stat label="Fully assessed projects" value={mains.filter((m) => p.effective.get(m.id)!.state === "COMPLETE").length} hint={`${units.reduce((a, u) => a + u.complete, 0)} fully assessed units`} tone="ok" />
          <Stat label="Unassessed projects" value={mains.filter((m) => p.effective.get(m.id)!.state === "NOT_ASSESSED").length} hint={`${units.reduce((a, u) => a + u.unassessed, 0)} unassessed units`} tone={units.some((u) => u.unassessed) ? "warn" : undefined} href="/projects" />
          <Stat label="Critical maturity gaps" value={gaps.length} hint={`Level ≤ ${p.ctx.criticalGapMaxLevel} on HIGH/CRITICAL questions`} tone={gaps.length ? "danger" : "ok"} href="/reports/view?scope=org#gaps" />
          <Stat label="Open remediation actions" value={openActions.length} href="/actions" />
          <Stat label="Overdue actions" value={overdue.length} tone={overdue.length ? "danger" : "ok"} href="/actions?overdue=1" />
          <Stat label="Framework version" value={`v${p.ctx.frameworkVersion}`} hint={`${p.framework.length} active domains`} href="/framework" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Product comparison" subtitle="Current score per active main project · click a bar to drill down" actions={<LinkButton size="sm" href="/compare">Domain comparison</LinkButton>}>
          <ScoreBars items={mains.map((m) => {
            const e = p.effective.get(m.id)!;
            return { id: m.id, label: m.name, score: e.score, href: `/projects/${m.id}`, note: e.aggregation ? `${e.aggregation.contributingCount}/${e.aggregation.childCount} subprojects` : `${formatPct(e.coverage)} coverage` };
          })} />
        </Card>
        <Card title="Assessment coverage" subtitle="Scoring units per product (subprojects, or the project itself when it has none)">
          <CoverageBars rows={units.map((u) => ({ id: u.main.id, label: u.main.name, href: `/projects/${u.main.id}`, complete: u.complete, partial: u.partial, unassessed: u.unassessed }))} />
        </Card>
      </div>

      <Card title="Security domain heatmap" subtitle="Hover for details, click a cell to drill down. Hatched cells are not assessed – never shown as a low score." actions={<LinkButton size="sm" href="/heatmap">Full heatmap</LinkButton>}>
        <Heatmap rows={heatRows(p)} columns={heatColumns(p)} levelLabels={p.ctx.levelLabels} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Maturity trend" subtitle="From completed assessment snapshots" className="xl:col-span-2">
          <TrendChart
            series={[
              { key: "org", label: "Organization", points: trends.org },
              ...mains.map((m) => ({ key: m.id, label: m.name, points: trends.byProject.get(m.id) ?? [] })),
            ]}
          />
        </Card>
        <Card title="Domain ranking" subtitle="Weakest domains first (organization-weighted)" bodyClassName="p-0">
          <ol className="max-h-[300px] divide-y divide-line overflow-y-auto">
            {ranking.map((d, i) => (
              <li key={d.id}>
                <Link href={`/domains/${d.id}`} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm hover:bg-subtle">
                  <span className="min-w-0 truncate"><span className="mr-2 text-xs text-muted">{i + 1}.</span>{d.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{d.contributors}/{d.of}<ScoreChip score={d.score} size="sm" /></span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Critical gaps summary" subtitle={`Answers at Level ≤ ${p.ctx.criticalGapMaxLevel} on HIGH or CRITICAL questions in current assessments`} actions={<LinkButton size="sm" href="/reports/view?scope=org#gaps">All gaps</LinkButton>}>
          <div className="mb-3 flex flex-wrap gap-2">
            {gapsByMain.map(({ m, n }) => <Badge key={m.id} tone={n ? "danger" : "ok"}>{m.name}: {n}</Badge>)}
          </div>
          <Table>
            <thead><tr><th className="th">Question</th><th className="th">Project</th><th className="th">Level</th></tr></thead>
            <tbody>
              {gaps.slice(0, 8).map((g) => (
                <tr key={`${g.projectId}-${g.questionId}`}>
                  <td className="td"><Link className="link" href={`/assessments/${g.assessmentId}?q=${g.questionId}`}>{g.questionKey}</Link> <span className="text-muted">{g.title}</span> <Badge tone={g.criticality === "CRITICAL" ? "danger" : "warn"}>{g.criticality}</Badge></td>
                  <td className="td whitespace-nowrap">{g.projectName}</td>
                  <td className="td">L{g.level}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Remediation priorities" subtitle="Overdue first, then by priority and target date" actions={<LinkButton size="sm" href="/actions">Tracker</LinkButton>}>
          <Table>
            <thead><tr><th className="th">Action</th><th className="th">Priority</th><th className="th">Target</th><th className="th">Status</th></tr></thead>
            <tbody>
              {priorityList.map((a) => {
                const od = isOverdue(a.targetDate, a.status, now);
                return (
                  <tr key={a.id}>
                    <td className="td"><Link href={`/actions/${a.id}`} className="link">{a.title}</Link><div className="text-xs text-muted">{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name} · {a.owner || "unassigned"}</div></td>
                    <td className="td"><Badge tone={a.priority === "CRITICAL" ? "danger" : a.priority === "HIGH" ? "warn" : "neutral"}>{a.priority}</Badge></td>
                    <td className={od ? "td whitespace-nowrap font-medium text-danger" : "td whitespace-nowrap"}>{fmtDate(a.targetDate)}{od && " ⚠ overdue"}</td>
                    <td className="td whitespace-nowrap text-xs">{ACTION_STATUS_LABELS[a.status as ActionStatus]}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card title="Recently completed assessments" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Assessment</th><th className="th">Project</th><th className="th">Date</th><th className="th">Status</th><th className="th">Score</th><th className="th">Coverage</th></tr></thead>
          <tbody>
            {recent.map((a) => (
              <tr key={a.id}>
                <td className="td"><Link href={`/assessments/${a.id}`} className="link">{a.title}</Link></td>
                <td className="td">{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name}</td>
                <td className="td whitespace-nowrap">{fmtDate(a.assessmentDate)}</td>
                <td className="td text-xs">{ASSESSMENT_STATUS_LABELS[a.status as AssessmentStatus]}</td>
                <td className="td"><ScoreChip score={a.snapshot?.overallScore ?? null} size="sm" /></td>
                <td className="td text-xs text-muted">{formatPct(a.snapshot?.coverage)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="text-xs text-muted">Organization summary scores are rounded to {decimals} decimal place(s) (round half away from zero); detailed views use one decimal. {formatScore(org.score, 1)} is the unrounded-to-one-decimal organization score.</p>
    </div>
  );
}
