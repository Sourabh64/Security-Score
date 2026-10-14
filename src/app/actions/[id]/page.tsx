import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, KeyValue, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { ActionLifecycle, EvidenceLinker } from "@/components/action-lifecycle";
import { ActionButton } from "@/components/client";
import { deleteRemediationAction } from "@/server/actions";
import { actionFormData } from "@/server/action-form-data";
import { ACTION_STATUS_LABELS, ACTION_TERMINAL_STATUSES, type ActionStatus } from "@/lib/constants";
import { fmtDate, fmtDateTime, isOverdue } from "@/lib/utils";

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await db.remediationAction.findUnique({
    where: { id },
    include: {
      project: { include: { parent: true } },
      domain: true,
      practice: true,
      question: true,
      assessment: { select: { id: true, title: true } },
      response: { select: { level: true, status: true } },
      evidenceLinks: { include: { evidence: true } },
    },
  });
  if (!a) notFound();
  const user = await getCurrentUser();
  const terminal = ACTION_TERMINAL_STATUSES.includes(a.status as ActionStatus);
  const editable = can(user, "action:write") && !terminal;
  const [data, projectEvidence, audit] = await Promise.all([
    editable ? actionFormData() : Promise.resolve(null),
    db.evidence.findMany({ where: { projectId: a.projectId }, select: { id: true, title: true } }),
    db.auditEvent.findMany({ where: { entityType: "RemediationAction", entityId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const od = isOverdue(a.targetDate, a.status);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Remediation", href: "/actions" }, { label: a.title }]}
        title={a.title}
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Badge tone={a.status === "CLOSED" ? "ok" : a.status === "BLOCKED" ? "danger" : "neutral"}>{ACTION_STATUS_LABELS[a.status as ActionStatus]}</Badge>
            <Badge tone={a.priority === "CRITICAL" ? "danger" : a.priority === "HIGH" ? "warn" : "neutral"}>{a.priority}</Badge>
            {od && <Badge tone="danger">⚠ Overdue since {fmtDate(a.targetDate)}</Badge>}
          </span>
        }
        actions={can(user, "settings:admin") && <ActionButton size="md" variant="danger" action={deleteRemediationAction.bind(null, id)} redirectTo="/actions" confirm="Delete this action permanently? Prefer closing or accepting risk to keep history." success="Action deleted">Delete</ActionButton>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Details">
            <KeyValue
              cols={3}
              items={[
                { k: "Project", v: <Link className="link" href={`/projects/${a.projectId}`}>{a.project.parent ? `${a.project.parent.name} / ` : ""}{a.project.name}</Link> },
                { k: "Domain / practice", v: [a.domain?.name, a.practice?.name].filter(Boolean).join(" / ") },
                { k: "Question", v: a.question ? <Link className="link" href={`/framework/questions/${a.question.id}`}>{a.question.key}</Link> : null },
                { k: "Source assessment", v: a.assessment ? <Link className="link" href={`/assessments/${a.assessment.id}${a.questionId ? `?q=${a.questionId}` : ""}`}>{a.assessment.title}</Link> : null },
                { k: "Answer at creation", v: a.response?.level ? `Level ${a.response.level}` : a.response?.status },
                { k: "Owner", v: a.owner },
                { k: "Target date", v: fmtDate(a.targetDate) },
                { k: "Created", v: `${fmtDateTime(a.createdAt)} by ${a.createdBy || "–"}` },
                { k: "Updated", v: fmtDateTime(a.updatedAt) },
                { k: "Gap / risk", v: a.gap },
                { k: "Recommended remediation", v: a.recommendation },
                { k: "Description", v: a.description },
              ]}
            />
            {terminal && (
              <div className="mt-4 rounded-md border border-line bg-subtle/50 p-3 text-sm">
                <b>{a.status === "CLOSED" ? "Closed" : "Risk accepted"}</b> by {a.closedBy || a.riskAcceptedBy} on {fmtDate(a.closedAt)}
                {a.riskAcceptedUntil && <> · expires {fmtDate(a.riskAcceptedUntil)}</>}
                <p className="mt-1 whitespace-pre-line">{a.closureNote}</p>
                {a.completionEvidence && <p className="mt-1 text-muted">Evidence: {a.completionEvidence}</p>}
              </div>
            )}
          </Card>
          {editable && data && (
            <Card title="Edit action">
              <ActionForm
                id={id}
                {...data}
                initial={{
                  title: a.title, description: a.description, projectId: a.projectId, domainId: a.domainId, practiceId: a.practiceId, questionId: a.questionId,
                  assessmentId: a.assessmentId, responseId: a.responseId, gap: a.gap, priority: a.priority as "HIGH", owner: a.owner,
                  targetDate: a.targetDate ? fmtDate(a.targetDate) : null, status: a.status, recommendation: a.recommendation, completionEvidence: a.completionEvidence,
                }}
              />
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Lifecycle" subtitle="Changing an assessment answer never closes an action.">
            <ActionLifecycle id={id} status={a.status} canClose={can(user, "action:close")} canAccept={can(user, "action:acceptRisk")} />
          </Card>
          <Card title="Evidence">
            <EvidenceLinker
              projectId={a.projectId}
              actionId={id}
              editable={can(user, "evidence:write")}
              available={projectEvidence}
              linked={a.evidenceLinks.map((l) => ({ linkId: l.id, id: l.evidence.id, title: `${l.evidence.title} (${l.evidence.verificationStatus.toLowerCase()})` }))}
            />
          </Card>
          <Card title="History">
            <ul className="space-y-1 text-xs">
              {audit.map((e) => <li key={e.id}><span className="text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName} · {e.action}</li>)}
              {audit.length === 0 && <li className="text-muted">No recorded changes (seeded record).</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
