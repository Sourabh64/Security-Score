import { Fragment } from "react";
import Link from "next/link";
import { db } from "@/server/db";
import { computePortfolio, type ProjectRow } from "@/server/portfolio";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { CoverageText, ScoreChip, ScoreKindBadge } from "@/components/score";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { fmtDate } from "@/lib/utils";
import { CRITICALITIES, LIFECYCLE_LABELS, type Criticality } from "@/lib/constants";
import { formatPct } from "@/lib/scoring/format";

type SP = Promise<Record<string, string | undefined>>;

export default async function ProjectsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").toLowerCase().trim();
  const show = sp.show ?? "active";
  const crit = sp.crit ?? "";
  const sort = sp.sort ?? "name";
  const [p, user] = await Promise.all([computePortfolio(db), getCurrentUser()]);

  const matches = (x: ProjectRow) =>
    (!q || [x.name, x.key, x.tags, x.capabilities, x.productOwner, x.securityOwner].join(" ").toLowerCase().includes(q)) && (!crit || x.criticality === crit);
  const showRow = (x: ProjectRow) => (show === "all" ? true : show === "archived" ? x.archived : !x.archived);

  let mains = p.projects.filter((x) => !x.parentId && (showRow(x) || p.childrenOf(x.id).some(showRow)) && (matches(x) || p.childrenOf(x.id).some(matches)));
  const sortKey = (x: ProjectRow) => {
    const e = p.effective.get(x.id)!;
    if (sort === "score") return e.score ?? -1;
    if (sort === "coverage") return e.coverage;
    if (sort === "last") return p.lastAssessment.get(x.id)?.getTime() ?? 0;
    return 0;
  };
  mains = sort === "name" ? mains.sort((a, b) => a.name.localeCompare(b.name)) : mains.sort((a, b) => sortKey(b) - sortKey(a));

  const sortLink = (key: string, label: string) => {
    const params = new URLSearchParams({ ...(sp as Record<string, string>), sort: key });
    return <Link href={`/projects?${params}`} className={sort === key ? "text-accent" : "hover:text-fg"}>{label}{sort === key ? " ↓" : ""}</Link>;
  };

  const Row = ({ x, sub }: { x: ProjectRow; sub?: boolean }) => {
    const e = p.effective.get(x.id)!;
    const last = p.lastAssessment.get(x.id);
    const children = p.childrenOf(x.id);
    return (
      <tr className={x.archived ? "opacity-60" : sub ? "bg-subtle/40" : ""}>
        <td className="td">
          <div className={sub ? "pl-5" : ""}>
            <Link href={`/projects/${x.id}`} className={sub ? "link" : "link font-semibold"}>{sub ? "↳ " : ""}{x.name}</Link>
            <span className="ml-2 font-mono text-[11px] text-muted">{x.key}</span>
            {x.archived && <Badge className="ml-2">Archived</Badge>}
            {!sub && children.length > 0 && <div className="text-xs text-muted">{children.filter((c) => !c.archived).length} active subproject(s)</div>}
          </div>
        </td>
        <td className="td"><Badge tone={x.criticality === "CRITICAL" ? "danger" : x.criticality === "HIGH" ? "warn" : "neutral"}>{x.criticality}</Badge></td>
        <td className="td text-xs">{LIFECYCLE_LABELS[x.lifecycleStatus as keyof typeof LIFECYCLE_LABELS] ?? x.lifecycleStatus}</td>
        <td className="td"><ScoreChip score={e.score} /></td>
        <td className="td"><ScoreKindBadge source={e.source} state={e.state} />{e.aggregation && <div className="mt-1 text-[11px] text-muted">{e.aggregation.contributingCount}/{e.aggregation.childCount} subprojects contribute</div>}</td>
        <td className="td">{e.aggregation ? <span className="text-xs text-muted">{formatPct(e.aggregation.weightCoverage)} of weight</span> : <CoverageText coverage={e.coverage} completion={e.completion} />}</td>
        <td className="td whitespace-nowrap text-xs">{fmtDate(last)}</td>
        <td className="td text-xs text-muted">{x.securityOwner || "–"}</td>
      </tr>
    );
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Main projects (product domains) and their subprojects. A parent with active subprojects is scored by aggregating them; otherwise it is scored from its own assessment."
        actions={can(user, "project:write") && <LinkButton href="/projects/new" variant="primary">New project</LinkButton>}
      />
      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-3" method="get">
          <label className="text-xs"><span className="label">Search</span><input name="q" defaultValue={sp.q} className="input !py-1" placeholder="Name, key, tag, owner…" /></label>
          <label className="text-xs"><span className="label">Status</span>
            <select name="show" defaultValue={show} className="input !py-1"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select>
          </label>
          <label className="text-xs"><span className="label">Criticality</span>
            <select name="crit" defaultValue={crit} className="input !py-1"><option value="">Any</option>{CRITICALITIES.map((c: Criticality) => <option key={c}>{c}</option>)}</select>
          </label>
          <input type="hidden" name="sort" value={sort} />
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Apply</button>
        </form>
        {mains.length === 0 ? (
          <div className="p-6"><EmptyState title="No projects match">Adjust the filters or create a new project.</EmptyState></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="th">{sortLink("name", "Project")}</th><th className="th">Criticality</th><th className="th">Lifecycle</th>
                <th className="th">{sortLink("score", "Score")}</th><th className="th">Score source</th><th className="th">{sortLink("coverage", "Coverage")}</th>
                <th className="th">{sortLink("last", "Last assessment")}</th><th className="th">Security owner</th>
              </tr>
            </thead>
            <tbody>
              {mains.map((m) => (
                <Fragment key={m.id}>
                  <Row x={m} />
                  {p.childrenOf(m.id).filter((c) => showRow(c)).map((c) => <Row key={c.id} x={c} sub />)}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
