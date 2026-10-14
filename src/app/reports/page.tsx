import Link from "next/link";
import { db } from "@/server/db";
import { Card, LinkButton, PageHeader } from "@/components/ui";

export default async function ReportsPage() {
  const [projects, domains, assessments] = await Promise.all([
    db.project.findMany({ where: { archived: false }, include: { parent: true }, orderBy: { name: "asc" } }),
    db.securityDomain.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    db.assessment.findMany({ orderBy: { assessmentDate: "desc" }, take: 12, include: { project: true } }),
  ]);
  const mains = projects.filter((p) => !p.parentId);
  return (
    <div className="space-y-5">
      <PageHeader title="Reports & exports" subtitle="Printable reports (use your browser’s Print → Save as PDF) and CSV exports generated from live application data." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Organization report" subtitle="Scores, methodology, coverage, maturity distribution, gaps, evidence and remediation across active products.">
          <LinkButton href="/reports/view?scope=org" variant="primary">Open organization report</LinkButton>
        </Card>
        <Card title="CSV exports" subtitle="Scores in exports use the same rounding as the UI (1 decimal).">
          <ul className="space-y-2 text-sm">
            <li><a className="link" href="/api/export/scores">Current scores</a> – organization, projects, subprojects and domain scores</li>
            <li><a className="link" href="/api/export/snapshots">Historical snapshot scores</a> – one row per completed assessment</li>
            <li><a className="link" href="/api/export/responses">All assessment responses</a></li>
            <li><a className="link" href="/api/export/actions?status=any">All remediation actions</a> · <a className="link" href="/api/export/actions?status=open">open only</a></li>
            <li className="text-xs text-muted">Add <code>?project=&lt;id&gt;</code> to filter by project (includes its subprojects) and <code>&amp;archived=1</code> to include archived projects.</li>
          </ul>
        </Card>
        <Card title="Project & subproject reports" bodyClassName="p-0">
          <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
            {mains.flatMap((m) => [m, ...projects.filter((c) => c.parentId === m.id)]).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <Link className={p.parentId ? "link pl-4" : "link font-medium"} href={`/reports/view?scope=project&id=${p.id}`}>{p.name}</Link>
                <span className="flex gap-3 text-xs"><a className="link" href={`/api/export/scores?project=${p.id}`}>scores.csv</a><a className="link" href={`/api/export/responses?project=${p.id}`}>responses.csv</a><a className="link" href={`/api/export/actions?project=${p.id}&status=any`}>actions.csv</a></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Domain reports" bodyClassName="p-0">
          <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
            {domains.map((d) => <li key={d.id} className="px-4 py-1.5"><Link className="link" href={`/reports/view?scope=domain&id=${d.id}`}>{d.name}</Link></li>)}
          </ul>
        </Card>
        <Card title="Assessment reports" bodyClassName="p-0" className="lg:col-span-2">
          <ul className="divide-y divide-line text-sm">
            {assessments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <Link className="link" href={`/assessments/${a.id}/report`}>{a.title}</Link>
                <span className="text-xs text-muted">{a.project.name} · {a.status.toLowerCase()} · <a className="link" href={`/api/export/responses?assessment=${a.id}`}>CSV</a></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
