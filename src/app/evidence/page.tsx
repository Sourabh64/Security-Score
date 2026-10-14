import Link from "next/link";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS, VERIFICATION_LABELS, VERIFICATION_STATUSES, type EvidenceType, type VerificationStatus } from "@/lib/constants";
import { fmtDate, safeHttpUrl } from "@/lib/utils";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const projects = await db.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } });
  const projectIds = sp.project ? [sp.project, ...projects.filter((p) => p.parentId === sp.project).map((p) => p.id)] : undefined;
  const rows = await db.evidence.findMany({
    where: {
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      ...(sp.status ? { verificationStatus: sp.status } : {}),
      ...(sp.type ? { type: sp.type } : {}),
      ...(sp.q ? { title: { contains: sp.q } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    include: { project: { select: { name: true, parent: { select: { name: true } } } }, _count: { select: { links: true } } },
    take: 200,
  });
  const counts = await db.evidence.groupBy({ by: ["verificationStatus"], _count: true });
  const c = (s: string) => counts.find((x) => x.verificationStatus === s)?._count ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Evidence"
        subtitle="Artifacts supporting assessment answers and remediation closure. Distinguishes answers that are only asserted, supported by evidence pending verification, and verified by a reviewer."
        actions={can(user, "evidence:write") && <LinkButton href="/evidence/new" variant="primary">Record evidence</LinkButton>}
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Verified" value={c("VERIFIED")} tone="ok" href="/evidence?status=VERIFIED" />
        <Stat label="Pending verification" value={c("PENDING")} tone="warn" href="/evidence?status=PENDING" />
        <Stat label="Rejected" value={c("REJECTED")} tone="danger" href="/evidence?status=REJECTED" />
      </div>
      <Card bodyClassName="p-0">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <label className="text-xs"><span className="label">Search</span><input name="q" defaultValue={sp.q} className="input !py-1" /></label>
          <label className="text-xs"><span className="label">Project</span><select name="project" defaultValue={sp.project ?? ""} className="input !py-1"><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.parent ? `${p.parent.name} / ` : ""}{p.name}</option>)}</select></label>
          <label className="text-xs"><span className="label">Verification</span><select name="status" defaultValue={sp.status ?? ""} className="input !py-1"><option value="">Any</option>{VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{VERIFICATION_LABELS[s]}</option>)}</select></label>
          <label className="text-xs"><span className="label">Type</span><select name="type" defaultValue={sp.type ?? ""} className="input !py-1"><option value="">Any</option>{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}</select></label>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Apply</button>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No evidence found" /></div> : (
          <Table>
            <thead><tr><th className="th">Evidence</th><th className="th">Project</th><th className="th">Type</th><th className="th">Classification</th><th className="th">Collected / verified</th><th className="th">Status</th><th className="th">Links</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const url = safeHttpUrl(e.reference);
                return (
                  <tr key={e.id}>
                    <td className="td"><Link className="link" href={`/evidence/${e.id}`}>{e.title}</Link><div className="max-w-xs truncate text-xs text-muted">{url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">{e.reference}</a> : e.reference}{e.fileName && ` · 📎 ${e.fileName}`}</div></td>
                    <td className="td text-xs">{e.project.parent ? `${e.project.parent.name} / ` : ""}{e.project.name}</td>
                    <td className="td text-xs">{EVIDENCE_TYPE_LABELS[e.type as EvidenceType]}</td>
                    <td className="td text-xs">{e.classification}</td>
                    <td className="td whitespace-nowrap text-xs">{fmtDate(e.collectedAt)} / {fmtDate(e.lastVerifiedAt)}</td>
                    <td className="td"><Badge tone={e.verificationStatus === "VERIFIED" ? "ok" : e.verificationStatus === "REJECTED" ? "danger" : "warn"}>{VERIFICATION_LABELS[e.verificationStatus as VerificationStatus]}</Badge></td>
                    <td className="td text-xs tabular-nums">{e._count.links}</td>
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
