import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { collectGaps, computePortfolio } from "@/server/portfolio";
import { domainRanking } from "@/server/views";
import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { ScoreChip } from "@/components/score";
import { ScoreBars } from "@/components/charts";
import { SAMM_LABELS, ACTION_STATUS_LABELS, type SammFunction, type ActionStatus } from "@/lib/constants";
import { fmtDate, isOverdue } from "@/lib/utils";

export default async function DomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const domain = await db.securityDomain.findUnique({ where: { id } });
  if (!domain) notFound();
  const p = await computePortfolio(db);
  const fw = p.framework.find((d) => d.id === id);
  const r = domainRanking(p).find((d) => d.id === id);
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  const domScore = (pid: string) => {
    const e = p.effective.get(pid)!;
    return e.score === null ? null : e.domains.find((d) => d.id === id)?.score ?? null;
  };
  const units = p.scoringProjectIds.map((pid) => p.byId.get(pid)!);
  const gaps = collectGaps(p).filter((g) => g.domainId === id);
  const actions = await db.remediationAction.findMany({ where: { domainId: id, project: { archived: false } }, include: { project: { select: { name: true } } }, orderBy: { targetDate: "asc" } });
  const now = new Date();

  // Practice x scoring unit matrix and question level distributions (from the assessments driving scores)
  const practiceRows = (fw?.practices ?? []).map((pr) => ({
    pr,
    cells: units.map((u) => {
      const s = p.direct.get(u.id);
      if (!s || s.score === null) return null;
      return s.domains.find((d) => d.id === id)?.practices.find((x) => x.id === pr.id)?.score ?? null;
    }),
  }));
  const distribution = (fw?.practices ?? []).flatMap((pr) =>
    pr.questions.map((q) => {
      const counts: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, NA: 0, OTHER: 0, NONE: 0 };
      for (const u of units) {
        const s = p.direct.get(u.id);
        const qr = s?.domains.find((d) => d.id === id)?.practices.find((x) => x.id === pr.id)?.questions.find((x) => x.id === q.id);
        if (!s) continue;
        if (!qr) continue; // not applicable to this unit
        if (qr.level) counts[qr.level]++;
        else if (qr.status === "NOT_APPLICABLE") counts.NA++;
        else if (qr.status === "UNANSWERED") counts.NONE++;
        else counts.OTHER++;
      }
      return { q, pr, counts };
    }),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Security domains", href: "/domains" }, { label: domain.name }]}
        title={<span className="flex flex-wrap items-center gap-2">{domain.name}<Badge>{SAMM_LABELS[domain.sammFunction as SammFunction]}</Badge>{!domain.active && <Badge tone="warn">Inactive</Badge>}</span>}
        subtitle={domain.description}
        actions={<LinkButton href={`/reports/view?scope=domain&id=${id}`}>Domain report</LinkButton>}
      />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card title="Organization domain score">
          <div className="flex items-center gap-3"><ScoreChip score={r?.score ?? null} size="lg" /><span className="text-xs text-muted">{r?.contributors ?? 0} of {r?.of ?? 0} main projects scored this domain</span></div>
          <p className="mt-3 text-xs text-muted">Weight {domain.weight} · {fw?.practices.length ?? 0} practices · {gaps.length} critical gaps · {actions.filter((a) => !["CLOSED", "ACCEPTED_RISK"].includes(a.status)).length} open actions</p>
        </Card>
        <Card title="By product">
          <ScoreBars items={mains.map((m) => ({ id: m.id, label: m.name, score: domScore(m.id), href: `/projects/${m.id}#domain-${id}` }))} />
        </Card>
      </div>

      <Card title="Practice scores by scoring unit" subtitle="Subprojects, or projects assessed directly. Hatched = not assessed." bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Practice</th>{units.map((u) => <th key={u.id} className="th whitespace-nowrap text-[10px]"><Link href={`/projects/${u.id}`} className="hover:text-fg">{u.key}</Link></th>)}</tr></thead>
          <tbody>
            {practiceRows.map(({ pr, cells }) => (
              <tr key={pr.id}><td className="td text-sm">{pr.name}</td>{cells.map((c, i) => <td key={units[i].id} className="td"><ScoreChip score={c} size="sm" decimals={0} /></td>)}</tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Question answer distribution" subtitle="Number of scoring units at each maturity level in their current assessment" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Question</th>{["L1", "L2", "L3", "L4", "L5", "N/A", "Unable/Missing", "Unanswered"].map((h) => <th key={h} className="th text-right">{h}</th>)}</tr></thead>
          <tbody>
            {distribution.map(({ q, counts }) => (
              <tr key={q.id}>
                <td className="td"><Link className="link font-mono text-xs" href={`/framework/questions/${q.id}`}>{q.key}</Link> <span className="text-sm">{q.title}</span>{q.applicabilityTags.length > 0 && <Badge tone="accent" className="ml-1">{q.applicabilityTags.join(", ")}</Badge>}</td>
                {["1", "2", "3", "4", "5", "NA", "OTHER", "NONE"].map((k) => <td key={k} className="td text-right text-xs tabular-nums">{counts[k] || <span className="text-muted">·</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Critical gaps in this domain" bodyClassName="p-0">
          <Table>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.projectId + g.questionId}><td className="td"><Link className="link" href={`/assessments/${g.assessmentId}?q=${g.questionId}`}>{g.questionKey}</Link> <span className="text-xs text-muted">{g.title}</span></td><td className="td text-xs">{g.projectName}</td><td className="td"><Badge tone="danger">L{g.level}</Badge></td></tr>
              ))}
              {gaps.length === 0 && <tr><td className="td text-muted">No critical gaps.</td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card title="Remediation actions in this domain" bodyClassName="p-0">
          <Table>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}><td className="td"><Link className="link" href={`/actions/${a.id}`}>{a.title}</Link><div className="text-xs text-muted">{a.project.name}</div></td><td className="td text-xs">{ACTION_STATUS_LABELS[a.status as ActionStatus]}</td><td className={`td text-xs ${isOverdue(a.targetDate, a.status, now) ? "text-danger" : ""}`}>{fmtDate(a.targetDate)}</td></tr>
              ))}
              {actions.length === 0 && <tr><td className="td text-muted">No actions.</td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
