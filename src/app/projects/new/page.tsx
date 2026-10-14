import { Card, PageHeader } from "@/components/ui";
import { ProjectForm } from "@/components/project-form";
import { knownCapabilities, mainProjectOptions } from "@/server/queries";

export default async function NewProject({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
  const { parent } = await searchParams;
  const [parents, caps] = await Promise.all([mainProjectOptions(), knownCapabilities()]);
  return (
    <div>
      <PageHeader title={parent ? "New subproject" : "New project"} breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "New" }]} />
      <Card>
        <ProjectForm initial={{ parentId: parent ?? null }} parents={parents} knownCapabilities={caps} />
      </Card>
    </div>
  );
}
