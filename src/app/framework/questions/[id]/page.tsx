import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, KeyValue, LinkButton, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { parseList } from "@/lib/hierarchy";

export default async function QuestionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  const q = await db.question.findUnique({
    where: { id },
    include: { practice: { include: { domain: true } }, versions: { orderBy: { version: "desc" }, include: { options: { orderBy: { level: "asc" } }, _count: { select: { responses: true } } } } },
  });
  if (!q) notFound();
  const user = await getCurrentUser();
  const shown = q.versions.find((x) => String(x.version) === v) ?? q.versions.find((x) => x.version === q.currentVersion)!;
  const tags = parseList(shown.applicabilityTags);
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Framework", href: "/framework" }, { label: q.practice.domain.name, href: `/domains/${q.practice.domain.id}` }, { label: q.key }]}
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-muted">{q.key}</span>{shown.title}</span>}
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Badge>v{shown.version}{shown.version === q.currentVersion ? " (current)" : " (historical)"}</Badge>
            <Badge tone={shown.criticality === "CRITICAL" ? "danger" : shown.criticality === "HIGH" ? "warn" : "neutral"}>{shown.criticality}</Badge>
            <Badge>{shown.mandatory ? "Mandatory" : "Recommended"}</Badge>
            <Badge>weight {shown.weight}</Badge>
            {shown.evidenceRequired && <Badge tone="info">Evidence required</Badge>}
            {tags.length ? tags.map((t) => <Badge key={t} tone="accent">applies to: {t}</Badge>) : <Badge>applies to all products</Badge>}
            {!q.active && <Badge tone="warn">inactive</Badge>}
          </span>
        }
        actions={can(user, "framework:admin") && <LinkButton href={`/admin/questions/${id}`} variant="primary">Edit (creates new version)</LinkButton>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card title="Question">
            <p className="text-sm leading-relaxed">{shown.description}</p>
            <div className="mt-4">
              <KeyValue cols={2} items={[
                { k: "What the assessor is determining", v: shown.objective },
                { k: "Why it matters", v: shown.rationale },
                { k: "Scope & applicability", v: shown.scope },
                { k: "Assessment guidance", v: shown.guidance },
                { k: "Recommended evidence", v: shown.evidenceExamples },
                { k: "Remediation guidance", v: shown.remediationGuidance },
                { k: "References / framework mappings", v: shown.references },
                { k: "Domain / practice", v: `${q.practice.domain.name} / ${q.practice.name}` },
              ]} />
            </div>
          </Card>
          <Card title="Answer options (maturity-ordered)">
            <div className="space-y-2">
              {shown.options.map((o) => (
                <div key={o.id} className="rounded-md border border-line p-3">
                  <div className="flex items-center gap-2"><span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: `var(--lvl-${o.level})`, color: `var(--lvl-fg-${o.level})` }}>L{o.level}</span><span className="text-sm font-semibold">{o.label}</span></div>
                  <p className="mt-1 text-sm">{o.description}</p>
                  <p className="mt-1 text-xs"><b className="text-muted">Observable criteria:</b> {o.criteria}</p>
                  <p className="text-xs"><b className="text-muted">Example:</b> {o.examples}</p>
                  {o.gaps && <p className="text-xs text-muted">{o.gaps}</p>}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card title="Version history">
          <ul className="space-y-2 text-xs">
            {q.versions.map((x) => (
              <li key={x.id} className={x.id === shown.id ? "font-semibold" : ""}>
                <Link href={`/framework/questions/${id}?v=${x.version}`} className="link">v{x.version}</Link> · framework v{x.frameworkVersion} · {fmtDateTime(x.createdAt)} · {x.createdBy}
                <div className="font-normal text-muted">{x.changeNote || "–"} · {x._count.responses} response(s) reference this version</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
