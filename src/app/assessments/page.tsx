import Link from "next/link";
import { db } from "@/server/db";
import { computePortfolio } from "@/server/portfolio";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { ScoreChip } from "@/components/score";
import { ASSESSMENT_STATUSES, ASSESSMENT_STATUS_LABELS, ASSESSMENT_TYPE_LABELS, type AssessmentStatus, type AssessmentType } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";
import { formatPct } from "@/lib/scoring/format";
import { scoreAssessment, filterFramework } from "@/lib/scoring/engine";
import { responsesToMap } from "@/server/portfolio";
import { effectiveCapabilities } from "@/lib/hierarchy";

const PAGE = 25;

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [user, p] = await Promise.all([getCurrentUser(), computePortfolio(db)]);
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { project: { name: { contains: q } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.assessment.count({ where }),
    db.assessment.findMany({
      where,
      orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        project: { select: { id: true, name: true, parent: { select: { name: true } } } },
        assessor: { select: { name: true } },
        reviewer: { select: { name: true } },
        snapshot: { select: { overallScore: true, coverage: true, completion: true } },
        responses: { select: { questionId: true, status: true, level: true, carriedForward: true, confirmed: true } },
      },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(sp as Record<string, string>), ...extra }).toString();

  return (
    <div>
      <PageHeader
        title="Assessments"
        subtitle="Draft and in-progress assessments are scored live; completed assessments are immutable snapshots."
        actions={can(user, "assessment:write") && <LinkButton href="/assessments/new" variant="primary">Start assessment</LinkButton>}
      />
      <Card bodyClassName="p-0">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <label className="text-xs"><span className="label">Search</span><input name="q" defaultValue={q} className="input !py-1" placeholder="Title or project" /></label>
          <label className="text-xs"><span className="label">Status</span>
            <select name="status" defaultValue={status} className="input !py-1"><option value="">Any</option>{ASSESSMENT_STATUSES.map((s) => <option key={s} value={s}>{ASSESSMENT_STATUS_LABELS[s]}</option>)}</select>
          </label>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Apply</button>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No assessments found" /></div> : (
          <Table>
            <thead><tr><th className="th">Assessment</th><th className="th">Project</th><th className="th">Type</th><th className="th">Date</th><th className="th">Status</th><th className="th">Assessor / Reviewer</th><th className="th">Score</th><th className="th">Coverage</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                let score = a.snapshot?.overallScore ?? null;
                let coverage = a.snapshot?.coverage ?? null;
                if (!a.snapshot) {
                  const live = scoreAssessment(filterFramework(p.framework, effectiveCapabilities(p.projects, a.projectId)), responsesToMap(a.responses), { anchors: p.ctx.anchors, minCoverage: p.ctx.minCoverage });
                  score = live.score;
                  coverage = live.coverage;
                }
                return (
                  <tr key={a.id}>
                    <td className="td"><Link className="link" href={`/assessments/${a.id}`}>{a.title}</Link></td>
                    <td className="td text-sm"><Link href={`/projects/${a.project.id}`} className="hover:underline">{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name}</Link></td>
                    <td className="td text-xs">{ASSESSMENT_TYPE_LABELS[a.type as AssessmentType]}</td>
                    <td className="td whitespace-nowrap text-xs">{fmtDate(a.assessmentDate)}</td>
                    <td className="td"><Badge tone={a.status === "REVIEWED" ? "ok" : a.status === "COMPLETED" ? "accent" : a.status === "REJECTED" ? "danger" : "warn"}>{ASSESSMENT_STATUS_LABELS[a.status as AssessmentStatus]}</Badge></td>
                    <td className="td text-xs">{a.assessor?.name ?? "–"} / {a.reviewer?.name ?? "–"}</td>
                    <td className="td"><ScoreChip score={score} size="sm" />{!a.snapshot && <span className="ml-1 text-[10px] text-muted">live</span>}</td>
                    <td className="td text-xs text-muted">{formatPct(coverage)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
          <span>{total} assessment(s) · page {page} of {pages}</span>
          <span className="flex gap-3">
            {page > 1 && <Link className="link" href={`/assessments?${qs({ page: String(page - 1) })}`}>← Previous</Link>}
            {page < pages && <Link className="link" href={`/assessments?${qs({ page: String(page + 1) })}`}>Next →</Link>}
          </span>
        </div>
      </Card>
    </div>
  );
}
