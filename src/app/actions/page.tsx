import Link from "next/link";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { ACTION_STATUSES, ACTION_STATUS_LABELS, PRIORITIES, type ActionStatus } from "@/lib/constants";
import { fmtDate, isOverdue } from "@/lib/utils";

const PAGE = 30;
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const projects = await db.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } });
  const projectIds = sp.project ? [sp.project, ...projects.filter((x) => x.parentId === sp.project).map((x) => x.id)] : undefined;
  const statusFilter = sp.status === "open" || !sp.status ? { notIn: ["CLOSED", "ACCEPTED_RISK"] } : sp.status === "any" ? undefined : { equals: sp.status };
  const all = await db.remediationAction.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(sp.priority ? { priority: sp.priority } : {}),
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      ...(sp.owner ? { owner: { contains: sp.owner } } : {}),
      ...(sp.q ? { title: { contains: sp.q } } : {}),
    },
    include: { project: { select: { name: true, parent: { select: { name: true } } } }, domain: { select: { name: true } }, question: { select: { key: true } } },
  });
  const now = new Date();
  let rows = sp.overdue ? all.filter((a) => isOverdue(a.targetDate, a.status, now)) : all;
  const sort = sp.sort ?? "priority";
  rows = rows.sort((a, b) =>
    sort === "target" ? (a.targetDate?.getTime() ?? 9e15) - (b.targetDate?.getTime() ?? 9e15)
    : sort === "updated" ? b.updatedAt.getTime() - a.updatedAt.getTime()
    : Number(isOverdue(b.targetDate, b.status, now)) - Number(isOverdue(a.targetDate, a.status, now)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.targetDate?.getTime() ?? 9e15) - (b.targetDate?.getTime() ?? 9e15),
  );
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const counts = await db.remediationAction.groupBy({ by: ["status"], where: { project: { archived: false } }, _count: true });
  const openAll = await db.remediationAction.findMany({ where: { status: { notIn: ["CLOSED", "ACCEPTED_RISK"] }, project: { archived: false } }, select: { targetDate: true, status: true, priority: true } });
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ project: sp.project, status: sp.status }).filter(([, v]) => v)) as Record<string, string>).toString();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Remediation actions"
        subtitle="Improvement work linked to maturity gaps. Changing an assessment answer never closes an action – closure and risk acceptance are explicit, recorded steps."
        actions={
          <>
            <LinkButton href={`/api/export/actions?${exportQs}`}>Export CSV</LinkButton>
            {can(user, "action:write") && <LinkButton href="/actions/new" variant="primary">New action</LinkButton>}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Open" value={openAll.length} href="/actions?status=open" />
        <Stat label="Overdue" value={openAll.filter((a) => isOverdue(a.targetDate, a.status, now)).length} tone="danger" href="/actions?overdue=1" />
        <Stat label="Critical / high open" value={openAll.filter((a) => a.priority === "CRITICAL" || a.priority === "HIGH").length} tone="warn" href="/actions?priority=CRITICAL" />
        <Stat label="Pending verification" value={counts.find((c) => c.status === "PENDING_VERIFICATION")?._count ?? 0} href="/actions?status=PENDING_VERIFICATION" />
        <Stat label="Closed / accepted" value={(counts.find((c) => c.status === "CLOSED")?._count ?? 0) + (counts.find((c) => c.status === "ACCEPTED_RISK")?._count ?? 0)} href="/actions?status=any" />
      </div>
      <Card bodyClassName="p-0">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <label className="text-xs"><span className="label">Search</span><input name="q" defaultValue={sp.q} className="input !py-1" /></label>
          <label className="text-xs"><span className="label">Status</span>
            <select name="status" defaultValue={sp.status ?? "open"} className="input !py-1">
              <option value="open">All open</option><option value="any">Any</option>
              {ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="text-xs"><span className="label">Priority</span><select name="priority" defaultValue={sp.priority ?? ""} className="input !py-1"><option value="">Any</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="text-xs"><span className="label">Project</span>
            <select name="project" defaultValue={sp.project ?? ""} className="input !py-1"><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.parent ? `${p.parent.name} / ` : ""}{p.name}</option>)}</select>
          </label>
          <label className="text-xs"><span className="label">Owner</span><input name="owner" defaultValue={sp.owner} className="input !py-1" /></label>
          <label className="text-xs"><span className="label">Sort</span><select name="sort" defaultValue={sort} className="input !py-1"><option value="priority">Overdue & priority</option><option value="target">Target date</option><option value="updated">Recently updated</option></select></label>
          <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="overdue" value="1" defaultChecked={Boolean(sp.overdue)} /> Overdue only</label>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Apply</button>
        </form>
        {pageRows.length === 0 ? <div className="p-6"><EmptyState title="No actions match these filters" /></div> : (
          <Table>
            <thead><tr><th className="th">Action</th><th className="th">Project</th><th className="th">Linked to</th><th className="th">Priority</th><th className="th">Owner</th><th className="th">Target</th><th className="th">Status</th></tr></thead>
            <tbody>
              {pageRows.map((a) => {
                const od = isOverdue(a.targetDate, a.status, now);
                return (
                  <tr key={a.id} className={od ? "bg-danger/5" : ""}>
                    <td className="td"><Link className="link" href={`/actions/${a.id}`}>{a.title}</Link></td>
                    <td className="td text-xs">{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name}</td>
                    <td className="td text-xs text-muted">{a.question?.key ?? ""} {a.domain?.name ?? "–"}</td>
                    <td className="td"><Badge tone={a.priority === "CRITICAL" ? "danger" : a.priority === "HIGH" ? "warn" : "neutral"}>{a.priority}</Badge></td>
                    <td className="td text-xs">{a.owner || <span className="text-warn">Unassigned</span>}</td>
                    <td className={`td whitespace-nowrap text-xs ${od ? "font-semibold text-danger" : ""}`}>{fmtDate(a.targetDate)}{od && " ⚠ overdue"}</td>
                    <td className="td"><Badge tone={a.status === "CLOSED" ? "ok" : a.status === "BLOCKED" ? "danger" : a.status === "ACCEPTED_RISK" ? "warn" : "neutral"}>{ACTION_STATUS_LABELS[a.status as ActionStatus]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
          <span>{rows.length} action(s) · page {page} of {pages}</span>
          <span className="flex gap-3">
            {page > 1 && <Link className="link" href={`/actions?${qs({ page: String(page - 1) })}`}>← Previous</Link>}
            {page < pages && <Link className="link" href={`/actions?${qs({ page: String(page + 1) })}`}>Next →</Link>}
          </span>
        </div>
      </Card>
    </div>
  );
}
