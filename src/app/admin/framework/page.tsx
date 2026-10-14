import { db } from "@/server/db";
import { loadFrameworkTree } from "@/server/framework";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Card, PageHeader } from "@/components/ui";
import { FrameworkManager } from "@/components/admin/framework-manager";

export default async function FrameworkAdmin() {
  const [tree, user] = await Promise.all([loadFrameworkTree(db, { includeInactive: true }), getCurrentUser()]);
  const editable = can(user, "framework:admin");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Manage framework"
        breadcrumbs={[{ label: "Administration", href: "/admin" }, { label: "Framework" }]}
        subtitle="Add, edit, reorder, duplicate and deactivate domains, practices and questions. Every change increments the framework version. Editing a question creates a new immutable version – completed assessments keep the version they answered."
      />
      {!editable && <Card><p className="text-sm text-muted">Read-only: only Administrators can change the framework.</p></Card>}
      <FrameworkManager
        editable={editable}
        domains={tree.map((d) => ({
          id: d.id, key: d.key, name: d.name, description: d.description, sammFunction: d.sammFunction, weight: d.weight, active: d.active,
          practices: d.practices.map((p) => ({
            id: p.id, key: p.key, name: p.name, description: p.description, weight: p.weight, active: p.active,
            questions: p.questions.map((q) => ({ id: q.id, key: q.key, title: q.current?.title ?? q.key, active: q.active, version: q.currentVersion, tags: q.current?.applicabilityTags ?? "", criticality: q.current?.criticality ?? "" })),
          })),
        }))}
      />
    </div>
  );
}
