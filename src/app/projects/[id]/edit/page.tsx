import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { ProjectForm } from "@/components/project-form";
import { knownCapabilities, mainProjectOptions } from "@/server/queries";
import type { ProjectInput } from "@/lib/validation";

export default async function EditProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.project.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
  if (!p) notFound();
  // A project with subprojects stays a main project (one subproject level in the UI).
  const [parents, caps] = await Promise.all([p._count.children ? Promise.resolve([]) : mainProjectOptions(id), knownCapabilities()]);
  return (
    <div>
      <PageHeader title={`Edit ${p.name}`} breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: p.name, href: `/projects/${id}` }, { label: "Edit" }]} />
      <Card>
        <ProjectForm
          id={id}
          parents={parents}
          knownCapabilities={caps}
          initial={{
            key: p.key, name: p.name, description: p.description, businessPurpose: p.businessPurpose, productOwner: p.productOwner,
            securityOwner: p.securityOwner, technicalOwner: p.technicalOwner, criticality: p.criticality as ProjectInput["criticality"],
            lifecycleStatus: p.lifecycleStatus as ProjectInput["lifecycleStatus"], tags: p.tags, capabilities: p.capabilities,
            weight: p.weight, weightRationale: p.weightRationale, parentId: p.parentId,
          }}
        />
      </Card>
    </div>
  );
}
