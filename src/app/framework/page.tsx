import Link from "next/link";
import { db } from "@/server/db";
import { loadFrameworkTree } from "@/server/framework";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { SAMM_FUNCTIONS, SAMM_LABELS, type SammFunction } from "@/lib/constants";
import { parseList } from "@/lib/hierarchy";

export default async function FrameworkPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; samm?: string }> }) {
  const sp = await searchParams;
  const [tree, user, settings, versions] = await Promise.all([
    loadFrameworkTree(db, { includeInactive: true }),
    getCurrentUser(),
    db.organizationSettings.findUnique({ where: { id: 1 } }),
    db.frameworkVersion.findMany({ orderBy: { version: "desc" }, take: 8 }),
  ]);
  const q = (sp.q ?? "").toLowerCase();
  const tags = [...new Set(tree.flatMap((d) => d.practices.flatMap((p) => p.questions.flatMap((x) => parseList(x.current?.applicabilityTags)))))].sort();
  const match = (x: (typeof tree)[number]["practices"][number]["questions"][number]) =>
    (!q || `${x.key} ${x.current?.title} ${x.current?.description}`.toLowerCase().includes(q)) &&
    (!sp.tag || (sp.tag === "generic" ? !x.current?.applicabilityTags : parseList(x.current?.applicabilityTags).includes(sp.tag)));
  const total = tree.reduce((a, d) => a + d.practices.reduce((b, p) => b + p.questions.length, 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assessment framework"
        subtitle={<>Internal hybrid maturity model inspired by CMM (five maturity levels) and OWASP SAMM (practice-based, grouped into Governance, Design, Implementation, Verification and Operations), extended with enterprise and product-specific domains. It is <b>not</b> the official OWASP SAMM model. Current version v{settings?.frameworkVersion} · {tree.length} domains · {total} questions.</>}
        actions={can(user, "framework:admin") && <LinkButton href="/admin/framework" variant="primary">Manage framework</LinkButton>}
      />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-xs"><span className="label">Search questions</span><input name="q" defaultValue={sp.q} className="input !py-1" /></label>
          <label className="text-xs"><span className="label">Applicability</span>
            <select name="tag" defaultValue={sp.tag ?? ""} className="input !py-1"><option value="">All</option><option value="generic">Generic (all products)</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          <label className="text-xs"><span className="label">Function</span>
            <select name="samm" defaultValue={sp.samm ?? ""} className="input !py-1"><option value="">All</option>{SAMM_FUNCTIONS.map((f) => <option key={f} value={f}>{SAMM_LABELS[f]}</option>)}</select>
          </label>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Filter</button>
        </form>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {tree.filter((d) => !sp.samm || d.sammFunction === sp.samm).map((d) => {
            const practices = d.practices.map((p) => ({ ...p, questions: p.questions.filter(match) })).filter((p) => p.questions.length);
            if (!practices.length) return null;
            return (
              <details key={d.id} className="card" open={Boolean(q || sp.tag)}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="font-semibold">{d.order}. {d.name} {!d.active && <Badge tone="warn">inactive</Badge>}</span>
                  <span className="flex gap-2"><Badge>{SAMM_LABELS[d.sammFunction as SammFunction]}</Badge><Badge>weight {d.weight}</Badge><Link href={`/domains/${d.id}`} className="text-xs link">dashboard</Link></span>
                </summary>
                <div className="space-y-3 border-t border-line px-4 py-3">
                  <p className="text-sm text-muted">{d.description}</p>
                  {practices.map((p) => (
                    <div key={p.id}>
                      <h3 className="text-sm font-semibold">{p.name} <span className="font-normal text-xs text-muted">· weight {p.weight}{!p.active && " · inactive"}</span></h3>
                      <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                        {p.questions.map((x) => (
                          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <Link href={`/framework/questions/${x.id}`} className="hover:underline"><span className="mr-2 font-mono text-xs text-muted">{x.key}</span>{x.current?.title}</Link>
                            <span className="flex flex-wrap gap-1">
                              {parseList(x.current?.applicabilityTags).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
                              <Badge tone={x.current?.criticality === "CRITICAL" ? "danger" : x.current?.criticality === "HIGH" ? "warn" : "neutral"}>{x.current?.criticality}</Badge>
                              {!x.active && <Badge tone="warn">inactive</Badge>}
                              <Badge>v{x.currentVersion}</Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
        <Card title="Framework changelog">
          <ul className="space-y-2 text-xs">
            {versions.map((v) => <li key={v.id}><b>v{v.version}</b> <span className="text-muted">{v.createdAt.toISOString().slice(0, 10)} · {v.createdBy}</span><div>{v.changeSummary}</div></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">Completed assessments keep the question versions and scores captured at completion; framework changes only affect drafts and new assessments.</p>
        </Card>
      </div>
    </div>
  );
}
