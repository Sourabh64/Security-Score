import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, KeyValue, PageHeader } from "@/components/ui";
import { EvidenceForm, VerifyEvidence } from "@/components/evidence-forms";
import { ActionButton } from "@/components/client";
import { deleteEvidenceAction } from "@/server/actions";
import { EVIDENCE_TYPE_LABELS, VERIFICATION_LABELS, type EvidenceType, type VerificationStatus } from "@/lib/constants";
import { fmtDate, fmtDateTime, safeHttpUrl } from "@/lib/utils";

export default async function EvidenceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await db.evidence.findUnique({
    where: { id },
    include: {
      project: { include: { parent: true } },
      links: {
        include: {
          response: { include: { assessment: { select: { id: true, title: true, status: true } }, question: { select: { id: true, key: true } } } },
          action: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!e) notFound();
  const user = await getCurrentUser();
  const url = safeHttpUrl(e.reference);
  const projects = can(user, "evidence:write")
    ? (await db.project.findMany({ include: { parent: true }, orderBy: { name: "asc" } })).map((p) => ({ id: p.id, label: `${p.parent ? `${p.parent.name} / ` : ""}${p.name}` }))
    : [];
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Evidence", href: "/evidence" }, { label: e.title }]}
        title={e.title}
        subtitle={<Badge tone={e.verificationStatus === "VERIFIED" ? "ok" : e.verificationStatus === "REJECTED" ? "danger" : "warn"}>{VERIFICATION_LABELS[e.verificationStatus as VerificationStatus]}</Badge>}
        actions={can(user, "evidence:write") && <ActionButton size="md" variant="danger" action={deleteEvidenceAction.bind(null, id)} redirectTo="/evidence" confirm="Delete this evidence record (and its attachment)? Evidence referenced by completed assessments is retained." success="Evidence deleted">Delete</ActionButton>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title="Details">
            <KeyValue
              cols={3}
              items={[
                { k: "Project", v: <Link className="link" href={`/projects/${e.projectId}`}>{e.project.parent ? `${e.project.parent.name} / ` : ""}{e.project.name}</Link> },
                { k: "Type", v: EVIDENCE_TYPE_LABELS[e.type as EvidenceType] },
                { k: "Classification", v: e.classification },
                { k: "Reference", v: url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">{e.reference}</a> : e.reference },
                { k: "Attachment", v: e.fileName ? <a className="link" href={`/api/evidence/${e.id}/file`}>📎 {e.fileName} ({Math.ceil((e.fileSize ?? 0) / 1024)} KB)</a> : null },
                { k: "Owner", v: e.ownerName },
                { k: "Collected", v: fmtDate(e.collectedAt) },
                { k: "Last verified", v: fmtDate(e.lastVerifiedAt) },
                { k: "Recorded by", v: `${e.createdBy} · ${fmtDateTime(e.createdAt)}` },
                { k: "Description", v: e.description },
                { k: "Verification", v: e.verifiedBy ? `${e.verifiedBy}: ${e.verificationNote}` : e.verificationNote },
              ]}
            />
          </Card>
          {can(user, "evidence:write") && (
            <Card title="Edit evidence" subtitle="Editing the title, description or reference of verified evidence resets it to pending verification.">
              <EvidenceForm id={id} projects={projects} initial={{ projectId: e.projectId, title: e.title, description: e.description, reference: e.reference, type: e.type as EvidenceType, ownerName: e.ownerName, collectedAt: e.collectedAt ? fmtDate(e.collectedAt) : "", classification: e.classification as "INTERNAL" }} />
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {can(user, "evidence:verify") && <Card title="Reviewer verification"><VerifyEvidence id={id} status={e.verificationStatus} /></Card>}
          <Card title="Linked to">
            <ul className="space-y-1.5 text-sm">
              {e.links.map((l) => (
                <li key={l.id}>
                  {l.response && <>Answer <Link className="link" href={`/assessments/${l.response.assessment.id}?q=${l.response.question.id}`}>{l.response.question.key}</Link> in <span className="text-muted">{l.response.assessment.title}</span></>}
                  {l.action && <>Action <Link className="link" href={`/actions/${l.action.id}`}>{l.action.title}</Link></>}
                </li>
              ))}
              {e.links.length === 0 && <li className="text-muted">Not linked.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
