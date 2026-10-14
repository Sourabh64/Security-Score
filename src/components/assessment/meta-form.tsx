"use client";

import { useState } from "react";
import { updateAssessmentMetaAction } from "@/server/actions";
import { useRunAction } from "../client";
import { Button, Field } from "../ui";

interface Meta {
  title: string;
  scope: string;
  assessorId: string | null;
  reviewerId: string | null;
  assessmentDate: string;
  periodStart: string;
  periodEnd: string;
  focusDomainIds: string[];
}

export function AssessmentMetaForm({ id, users, initial }: { id: string; users: { id: string; name: string; role: string }[]; initial: Meta }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const { exec, pending } = useRunAction();
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Edit details</Button>;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Edit assessment details">
      <form
        className="card w-full max-w-2xl space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          exec(() => updateAssessmentMetaAction(id, { ...v, periodStart: v.periodStart || null, periodEnd: v.periodEnd || null }), { success: "Details saved", onSuccess: () => setOpen(false) });
        }}
      >
        <h2 className="text-base font-semibold">Edit assessment details</h2>
        <Field label="Title" htmlFor="m-title"><input id="m-title" className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></Field>
        <Field label="Scope" htmlFor="m-scope"><textarea id="m-scope" className="input min-h-[70px]" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assessor" htmlFor="m-a"><select id="m-a" className="input" value={v.assessorId ?? ""} onChange={(e) => setV({ ...v, assessorId: e.target.value || null })}><option value="">–</option>{users.filter((u) => ["ADMIN", "ASSESSOR"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Reviewer" htmlFor="m-r"><select id="m-r" className="input" value={v.reviewerId ?? ""} onChange={(e) => setV({ ...v, reviewerId: e.target.value || null })}><option value="">Unassigned</option>{users.filter((u) => ["ADMIN", "REVIEWER"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Assessment date" htmlFor="m-d"><input id="m-d" type="date" className="input" value={v.assessmentDate} onChange={(e) => setV({ ...v, assessmentDate: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period from" htmlFor="m-ps"><input id="m-ps" type="date" className="input" value={v.periodStart} onChange={(e) => setV({ ...v, periodStart: e.target.value })} /></Field>
            <Field label="to" htmlFor="m-pe"><input id="m-pe" type="date" className="input" value={v.periodEnd} onChange={(e) => setV({ ...v, periodEnd: e.target.value })} /></Field>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>Save</Button>
          <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
