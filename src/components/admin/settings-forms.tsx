"use client";

import { useState } from "react";
import { updateLevelsAction, updateSettingsAction, updateWeightsAction, upsertUserAction } from "@/server/actions";
import { useRunAction } from "../client";
import { Button, Field } from "../ui";
import { ROLES, ROLE_LABELS } from "@/lib/constants";

export interface SettingsValue {
  orgName: string;
  appTitle: string;
  scoreBasis: "LATEST" | "COMPLETED_ONLY";
  minCoverageForScore: number;
  criticalGapMaxLevel: number;
  includeArchivedInReports: boolean;
  orgSummaryDecimals: number;
  remediationSlaDays: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", number>;
}

export function SettingsForm({ initial, disabled }: { initial: SettingsValue; disabled: boolean }) {
  const [v, setV] = useState(initial);
  const { exec, pending } = useRunAction();
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); exec(() => updateSettingsAction(v), { success: "Settings saved" }); }}>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Organization name" htmlFor="s-org"><input id="s-org" className="input" value={v.orgName} onChange={(e) => setV({ ...v, orgName: e.target.value })} /></Field>
          <Field label="Application title" htmlFor="s-title"><input id="s-title" className="input" value={v.appTitle} onChange={(e) => setV({ ...v, appTitle: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Current score basis" htmlFor="s-basis" hint="Which assessment drives each project's current score">
            <select id="s-basis" className="input" value={v.scoreBasis} onChange={(e) => setV({ ...v, scoreBasis: e.target.value as SettingsValue["scoreBasis"] })}>
              <option value="LATEST">Latest assessment (drafts live, marked provisional)</option>
              <option value="COMPLETED_ONLY">Latest completed/reviewed only</option>
            </select>
          </Field>
          <Field label="Minimum scored coverage (%)" htmlFor="s-min" hint="Below this, a project is shown as Not assessed"><input id="s-min" type="number" min={0} max={100} className="input" value={v.minCoverageForScore} onChange={(e) => setV({ ...v, minCoverageForScore: Number(e.target.value) })} /></Field>
          <Field label="Critical gap threshold" htmlFor="s-gap" hint="Answers at or below this level on HIGH/CRITICAL questions">
            <select id="s-gap" className="input" value={v.criticalGapMaxLevel} onChange={(e) => setV({ ...v, criticalGapMaxLevel: Number(e.target.value) })}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>Level {l} or below</option>)}</select>
          </Field>
          <Field label="Organization summary decimals" htmlFor="s-dec"><select id="s-dec" className="input" value={v.orgSummaryDecimals} onChange={(e) => setV({ ...v, orgSummaryDecimals: Number(e.target.value) })}><option value={0}>0 (e.g. 54)</option><option value={1}>1 (e.g. 54.3)</option></select></Field>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={v.includeArchivedInReports} onChange={(e) => setV({ ...v, includeArchivedInReports: e.target.checked })} /> List archived projects in reports (never scored)</label>
        </div>
        <div>
          <span className="label">Remediation SLA (days) – default target dates by priority</span>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((k) => (
              <Field key={k} label={k} htmlFor={`sla-${k}`}><input id={`sla-${k}`} type="number" min={1} className="input" value={v.remediationSlaDays[k]} onChange={(e) => setV({ ...v, remediationSlaDays: { ...v.remediationSlaDays, [k]: Number(e.target.value) } })} /></Field>
            ))}
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={pending}>Save settings</Button>
      </fieldset>
    </form>
  );
}

export function LevelsForm({ initial, disabled }: { initial: { level: number; label: string; description: string; anchor: number }[]; disabled: boolean }) {
  const [rows, setRows] = useState(initial);
  const { exec, pending } = useRunAction();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); exec(() => updateLevelsAction(rows), { success: "Maturity levels saved", confirm: "Change maturity labels/anchors? Draft scores recalculate immediately; completed assessment snapshots keep their original scores." }); }}>
      <fieldset disabled={disabled} className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.level} className="grid items-start gap-2 md:grid-cols-[60px_1fr_90px_2fr]">
            <span className="pt-2 text-sm font-semibold">L{r.level}</span>
            <input className="input" aria-label={`Level ${r.level} label`} value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" type="number" min={1} max={100} aria-label={`Level ${r.level} anchor`} value={r.anchor} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, anchor: Number(e.target.value) } : x)))} />
            <input className="input" aria-label={`Level ${r.level} description`} value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          </div>
        ))}
        <p className="text-xs text-muted">Anchors must be strictly increasing within 1–100 (default 10/30/50/75/100).</p>
        <Button type="submit" variant="primary" disabled={pending}>Save levels</Button>
      </fieldset>
    </form>
  );
}

export function UsersTable({ users, editable }: { users: { id: string; name: string; email: string; role: string; title: string; active: boolean }[]; editable: boolean }) {
  const { exec, pending } = useRunAction();
  const [draft, setDraft] = useState({ name: "", email: "", role: "ASSESSOR", title: "", active: true });
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Title</th><th className="th">Role</th><th className="th">Active</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="td">{u.name}</td><td className="td text-xs">{u.email}</td><td className="td text-xs">{u.title}</td>
              <td className="td">
                <select className="input !py-1 text-xs" defaultValue={u.role} disabled={!editable || pending} onChange={(e) => exec(() => upsertUserAction(u.id, { ...u, role: e.target.value }), { success: "Role updated" })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </td>
              <td className="td"><input type="checkbox" defaultChecked={u.active} disabled={!editable || pending} onChange={(e) => exec(() => upsertUserAction(u.id, { ...u, active: e.target.checked }), { success: "User updated" })} aria-label={`${u.name} active`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <form className="grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); exec(() => upsertUserAction(null, draft), { success: "User added", onSuccess: () => setDraft({ name: "", email: "", role: "ASSESSOR", title: "", active: true }) }); }}>
          <input className="input" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          <input className="input" placeholder="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
          <input className="input" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
          <Button type="submit" variant="primary" disabled={pending}>Add user</Button>
        </form>
      )}
    </div>
  );
}

export function WeightsEditor({ title, rows, editable }: { title: string; rows: { id: string; name: string; weight: number; rationale: string }[]; editable: boolean }) {
  const [v, setV] = useState(rows);
  const { exec, pending } = useRunAction();
  const total = v.reduce((a, r) => a + (Number.isFinite(r.weight) ? r.weight : 0), 0);
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); exec(() => updateWeightsAction(v.map((r) => ({ id: r.id, weight: r.weight, rationale: r.rationale }))), { success: `${title} weights saved` }); }}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {v.map((r, i) => (
        <div key={r.id} className="grid items-center gap-2 md:grid-cols-[1fr_90px_70px_2fr]">
          <span className="text-sm">{r.name}</span>
          <input className="input !py-1" type="number" min={0} max={100} step={0.1} value={r.weight} disabled={!editable} aria-label={`${r.name} weight`} onChange={(e) => setV(v.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} />
          <span className="text-xs text-muted tabular-nums" title="Normalized share when every sibling is assessed">{total > 0 ? ((r.weight / total) * 100).toFixed(1) : "0"}%</span>
          <input className="input !py-1 text-xs" placeholder="Rationale (business criticality…)" value={r.rationale} disabled={!editable} onChange={(e) => setV(v.map((x, j) => (j === i ? { ...x, rationale: e.target.value } : x)))} />
        </div>
      ))}
      {editable && <Button type="submit" size="sm" disabled={pending}>Save weights</Button>}
    </form>
  );
}
