import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { NewAssessmentForm } from "@/components/assessment-new-form";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { userOptions } from "@/server/queries";
import { fmtDate } from "@/lib/utils";

export default async function NewAssessment({ searchParams }: { searchParams: Promise<{ project?: string; base?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!can(user, "assessment:write"))
    return <div><PageHeader title="Start assessment" /><Card><p className="text-sm text-muted">Your role ({user?.role}) cannot create assessments. Switch to an Assessor or Administrator in the sidebar.</p></Card></div>;
  const [projects, users, previous, domains] = await Promise.all([
    db.project.findMany({ where: { archived: false }, include: { parent: true, children: { where: { archived: false }, select: { id: true } } }, orderBy: [{ name: "asc" }] }),
    userOptions(),
    db.assessment.findMany({ orderBy: { assessmentDate: "desc" }, select: { id: true, projectId: true, title: true, status: true, assessmentDate: true } }),
    db.securityDomain.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);
  const ordered = projects
    .filter((p) => !p.parentId)
    .flatMap((m) => [m, ...projects.filter((c) => c.parentId === m.id)])
    .filter((p) => !p.parent?.archived);
  return (
    <div>
      <PageHeader title="Start assessment" subtitle="Select the scope and team. You can save progress at any time; nothing needs to be answered up front." breadcrumbs={[{ label: "Assessments", href: "/assessments" }, { label: "New" }]} />
      <Card>
        <NewAssessmentForm
          projects={ordered.map((p) => ({ id: p.id, name: p.name, key: p.key, parentName: p.parent?.name ?? null, hasChildren: p.children.length > 0 }))}
          users={users}
          previous={previous.map((a) => ({ id: a.id, projectId: a.projectId, title: a.title, status: a.status, date: fmtDate(a.assessmentDate) }))}
          domains={domains}
          defaults={{ projectId: sp.project, basedOnId: sp.base, currentUserId: user?.id }}
        />
      </Card>
    </div>
  );
}
