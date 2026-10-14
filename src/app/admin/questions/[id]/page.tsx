import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { getScoringContext } from "@/server/framework";
import { Card, PageHeader } from "@/components/ui";
import { QuestionEditor } from "@/components/admin/question-editor";
import type { QuestionInput } from "@/lib/validation";

async function practiceOptions() {
  const ps = await db.securityPractice.findMany({ include: { domain: true }, orderBy: [{ domain: { order: "asc" } }, { order: "asc" }] });
  return ps.map((p) => ({ id: p.id, label: `${p.domain.name} / ${p.name}` }));
}

export default async function EditQuestion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ practice?: string }> }) {
  const { id } = await params;
  const { practice } = await searchParams;
  const user = await getCurrentUser();
  if (!can(user, "framework:admin")) return <div><PageHeader title="Question editor" /><Card><p className="text-sm text-muted">Only Administrators can edit the framework.</p></Card></div>;
  const [practices, ctx] = await Promise.all([practiceOptions(), getScoringContext(db)]);
  let initial: QuestionInput;
  if (id === "new") {
    initial = {
      key: "", practiceId: practice ?? "", title: "", description: "", objective: "", rationale: "", scope: "", guidance: "", evidenceExamples: "", evidenceRequired: false,
      weight: 1, criticality: "MEDIUM", mandatory: true, applicabilityTags: "", remediationGuidance: "", references: "", changeNote: "Initial version",
      options: [1, 2, 3, 4, 5].map((level) => ({ level, label: `${ctx.levelLabels[level]}: `, description: "", criteria: "", examples: "", gaps: "" })),
    };
  } else {
    const q = await db.question.findUnique({ where: { id }, include: { versions: { include: { options: { orderBy: { level: "asc" } } } } } });
    if (!q) notFound();
    const cur = q.versions.find((x) => x.version === q.currentVersion)!;
    initial = {
      key: q.key, practiceId: q.practiceId, title: cur.title, description: cur.description, objective: cur.objective, rationale: cur.rationale, scope: cur.scope, guidance: cur.guidance,
      evidenceExamples: cur.evidenceExamples, evidenceRequired: cur.evidenceRequired, weight: cur.weight, criticality: cur.criticality as QuestionInput["criticality"], mandatory: cur.mandatory,
      applicabilityTags: cur.applicabilityTags, remediationGuidance: cur.remediationGuidance, references: cur.references, changeNote: "",
      options: cur.options.map((o) => ({ level: o.level, label: o.label, description: o.description, criteria: o.criteria, examples: o.examples, gaps: o.gaps })),
    };
  }
  return (
    <div>
      <PageHeader
        title={id === "new" ? "New question" : `Edit ${initial.key}`}
        subtitle={id === "new" ? undefined : "Saving publishes a new immutable version. Completed assessments keep referencing the version they were answered against; drafts flag answers given to an older version."}
        breadcrumbs={[{ label: "Administration", href: "/admin" }, { label: "Framework", href: "/admin/framework" }, { label: id === "new" ? "New question" : initial.key }]}
      />
      <Card><QuestionEditor id={id === "new" ? undefined : id} initial={initial} practices={practices} levelLabels={ctx.levelLabels} /></Card>
    </div>
  );
}
