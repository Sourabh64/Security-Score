import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { EvidenceForm } from "@/components/evidence-forms";

export default async function NewEvidence({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const projects = await db.project.findMany({ where: { archived: false }, include: { parent: true }, orderBy: { name: "asc" } });
  return (
    <div>
      <PageHeader title="Record evidence" breadcrumbs={[{ label: "Evidence", href: "/evidence" }, { label: "New" }]} />
      <Card>
        <EvidenceForm projects={projects.map((p) => ({ id: p.id, label: `${p.parent ? `${p.parent.name} / ` : ""}${p.name}` }))} initial={{ projectId: project }} />
      </Card>
    </div>
  );
}
