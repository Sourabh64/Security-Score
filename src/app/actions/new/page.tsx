import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { actionFormData } from "@/server/action-form-data";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { DEFAULT_LEVEL_LABELS } from "@/lib/constants";

export default async function NewAction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!can(user, "action:write")) return <div><PageHeader title="New remediation action" /><Card><p className="text-sm text-muted">Your role cannot create actions.</p></Card></div>;
  const data = await actionFormData();
  const response = sp.response
    ? await db.assessmentResponse.findUnique({ where: { id: sp.response }, include: { questionVersion: true, question: { include: { practice: true } } } })
    : null;
  const q = !response && sp.question ? data.questions.find((x) => x.id === sp.question) : null;
  const level = response?.level;
  const initial = {
    projectId: sp.project ?? "",
    questionId: response?.questionId ?? sp.question ?? "",
    domainId: response?.question.practice.domainId ?? q?.domainId ?? "",
    assessmentId: response?.assessmentId ?? sp.assessment ?? "",
    responseId: response?.id ?? "",
    title: response ? `Improve ${response.question.key}: ${response.questionVersion.title}`.slice(0, 200) : q ? `Improve ${q.key}: ${q.title}`.slice(0, 200) : "",
    gap: response && level ? `Assessed at Level ${level} (${DEFAULT_LEVEL_LABELS[level]}) – ${response.questionVersion.criticality} question.${response.remediationNotes ? ` Assessor notes: ${response.remediationNotes}` : ""}` : "",
    recommendation: response?.questionVersion.remediationGuidance ?? q?.remediation ?? "",
    priority: (response?.questionVersion.criticality === "CRITICAL" ? "HIGH" : "MEDIUM") as "HIGH" | "MEDIUM",
  };
  return (
    <div>
      <PageHeader title="New remediation action" subtitle={response ? "Created from an assessment answer – linked to the project, domain, practice, question and response." : undefined} breadcrumbs={[{ label: "Remediation", href: "/actions" }, { label: "New" }]} />
      <Card><ActionForm initial={initial} {...data} /></Card>
    </div>
  );
}
