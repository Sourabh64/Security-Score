import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { can, permissionsFor } from "@/server/permissions";
import { getScoringContext } from "@/server/framework";
import { Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { LevelsForm, SettingsForm, UsersTable, WeightsEditor } from "@/components/admin/settings-forms";
import { ROLES, ROLE_LABELS } from "@/lib/constants";
import { fmtDateTime } from "@/lib/utils";

export default async function AdminPage() {
  const user = await getCurrentUser();
  const isAdmin = can(user, "settings:admin");
  const [settings, levels, users, projects, audit, ctx] = await Promise.all([
    db.organizationSettings.findUniqueOrThrow({ where: { id: 1 } }),
    db.maturityLevel.findMany({ orderBy: { level: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.project.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    getScoringContext(db),
  ]);
  const mains = projects.filter((p) => !p.parentId);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration"
        subtitle={isAdmin ? "Organization display, scoring settings, maturity levels, weights, users and audit trail." : "Read-only view. Switch to an Administrator in the sidebar to make changes."}
        actions={<LinkButton href="/admin/framework" variant="primary">Manage framework (domains, practices, questions)</LinkButton>}
      />
      <Card title="Deployment mode" subtitle="Local single-organization mode">
        <p className="text-sm">
          This build has no password/SSO login. The acting user is chosen in the sidebar and every change is authorized <b>on the server</b> against that user&apos;s role, but anyone with
          access to the application can switch users. Use it on a trusted workstation or behind an authenticating reverse proxy, and replace <code>getCurrentUser()</code> in{" "}
          <code>src/server/auth.ts</code> with your identity provider before multi-user deployment.
        </p>
        <Table className="mt-3">
          <thead><tr><th className="th">Role</th><th className="th">Permissions (enforced server-side)</th></tr></thead>
          <tbody>{ROLES.map((r) => <tr key={r}><td className="td text-sm font-medium">{ROLE_LABELS[r]}</td><td className="td text-xs text-muted">{permissionsFor(r).join(", ") || "read-only (view & export)"}</td></tr>)}</tbody>
        </Table>
      </Card>
      <Card title="Organization & scoring settings">
        <SettingsForm
          disabled={!isAdmin}
          initial={{
            orgName: settings.orgName, appTitle: settings.appTitle, scoreBasis: settings.scoreBasis as "LATEST", minCoverageForScore: settings.minCoverageForScore,
            criticalGapMaxLevel: settings.criticalGapMaxLevel, includeArchivedInReports: settings.includeArchivedInReports, orgSummaryDecimals: settings.orgSummaryDecimals,
            remediationSlaDays: ctx.slaDays as { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number },
          }}
        />
      </Card>
      <Card title="Maturity levels & score anchors" subtitle="CMM-style levels mapped to the 1–100 presentation scale">
        <LevelsForm disabled={!isAdmin} initial={levels.map((l) => ({ level: l.level, label: l.label, description: l.description, anchor: l.anchor }))} />
      </Card>
      <Card title="Aggregation weights" subtitle="Default 1 = equal weighting. Weights are normalized over the components that have a score; unassessed components are excluded rather than treated as zero.">
        <div className="space-y-6">
          <WeightsEditor editable={isAdmin} title="Main projects → organization score" rows={mains.map((m) => ({ id: m.id, name: m.name, weight: m.weight, rationale: m.weightRationale }))} />
          {mains.filter((m) => projects.some((c) => c.parentId === m.id)).map((m) => (
            <WeightsEditor key={m.id} editable={isAdmin} title={`${m.name} subprojects → ${m.name} score`} rows={projects.filter((c) => c.parentId === m.id).map((c) => ({ id: c.id, name: c.name, weight: c.weight, rationale: c.weightRationale }))} />
          ))}
        </div>
      </Card>
      <Card title="Users & roles"><UsersTable editable={can(user, "users:admin")} users={users} /></Card>
      <Card title="Audit trail (latest 40)" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Summary</th></tr></thead>
          <tbody>{audit.map((a) => <tr key={a.id}><td className="td whitespace-nowrap text-xs">{fmtDateTime(a.createdAt)}</td><td className="td text-xs">{a.actorName}</td><td className="td text-xs">{a.action}</td><td className="td text-xs">{a.entityType}</td><td className="td text-xs text-muted">{a.summary}</td></tr>)}</tbody>
        </Table>
      </Card>
      <Card title="Backup & export guidance">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>The SQLite database lives at <code>prisma/dev.db</code>. Stop the app and copy the file (plus <code>data/uploads/</code>) for a consistent backup, or use <code>sqlite3 prisma/dev.db &quot;.backup backup.db&quot;</code> while running.</li>
          <li>CSV exports (Reports &amp; exports) provide a portable copy of scores, responses, snapshots and actions.</li>
          <li>For PostgreSQL deployments use <code>pg_dump</code> on a schedule.</li>
        </ul>
      </Card>
    </div>
  );
}
