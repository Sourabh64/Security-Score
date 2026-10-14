"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createQuestionAction, updateQuestionAction } from "@/server/actions";
import { useToast } from "../client";
import { Button, Field } from "../ui";
import { CRITICALITIES } from "@/lib/constants";
import type { QuestionInput } from "@/lib/validation";

export function QuestionEditor({ id, initial, practices, levelLabels }: {
  id?: string;
  initial: QuestionInput;
  practices: { id: string; label: string }[];
  levelLabels: Record<number, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<QuestionInput>(initial);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof QuestionInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : k === "weight" ? Number(e.target.value) : e.target.value }));
  const setOpt = (i: number, k: string, value: string) => setV((s) => ({ ...s, options: s.options.map((o, j) => (j === i ? { ...o, [k]: value } : o)) }));
  const text = (k: keyof QuestionInput, label: string, rows = 3, hint?: string) => (
    <Field label={label} htmlFor={`qe-${k}`} error={errors[k as string]} hint={hint}>
      <textarea id={`qe-${k}`} className="input" rows={rows} value={(v[k] as string) ?? ""} onChange={set(k)} />
    </Field>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = id ? await updateQuestionAction(id, v) : await createQuestionAction(v);
    setPending(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      return toast("error", res.error);
    }
    toast("ok", id ? "New question version published" : "Question created");
    router.push(`/framework/questions/${id ?? res.data}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Key *" htmlFor="qe-key" error={errors.key}><input id="qe-key" className="input font-mono" value={v.key} onChange={set("key")} required /></Field>
        <Field label="Practice *" htmlFor="qe-practice" error={errors.practiceId}><select id="qe-practice" className="input" value={v.practiceId} onChange={set("practiceId")} required><option value="">Select…</option>{practices.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label="Criticality" htmlFor="qe-crit"><select id="qe-crit" className="input" value={v.criticality} onChange={set("criticality")}>{CRITICALITIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Weight (0–100)" htmlFor="qe-weight" error={errors.weight}><input id="qe-weight" type="number" step="0.1" min={0} max={100} className="input" value={v.weight} onChange={set("weight")} /></Field>
      </div>
      <Field label="Question title *" htmlFor="qe-title" error={errors.title}><input id="qe-title" className="input" value={v.title} onChange={set("title")} required /></Field>
      {text("description", "Detailed description * (what the assessor should look for)", 4)}
      <div className="grid gap-4 md:grid-cols-2">
        {text("objective", "What the assessor is trying to determine")}
        {text("rationale", "Why the control or practice matters")}
        {text("scope", "Scope and applicability")}
        {text("guidance", "Assessment guidance")}
        {text("evidenceExamples", "Recommended evidence examples")}
        {text("remediationGuidance", "Remediation guidance")}
        {text("references", "References / framework mappings", 2)}
        <div className="space-y-3">
          <Field label="Applicability tags" htmlFor="qe-tags" error={errors.applicabilityTags} hint="Comma separated capability tags (e.g. dlp, casb). Empty = applies to all products. A project matches if it (or its parent) has any listed capability.">
            <input id="qe-tags" className="input font-mono" value={v.applicabilityTags} onChange={set("applicabilityTags")} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.mandatory} onChange={set("mandatory")} /> Mandatory (otherwise recommended)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.evidenceRequired} onChange={set("evidenceRequired")} /> Evidence required</label>
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Five maturity-ordered answer options</legend>
        {errors.options && <p className="text-xs text-danger">{errors.options}</p>}
        {v.options.map((o, i) => (
          <div key={o.level} className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-center gap-2"><span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: `var(--lvl-${o.level})`, color: `var(--lvl-fg-${o.level})` }}>L{o.level}</span><span className="text-xs text-muted">{levelLabels[o.level]}</span></div>
            <div className="grid gap-2 md:grid-cols-2">
              <input className="input md:col-span-2" placeholder="Short maturity label" value={o.label} onChange={(e) => setOpt(i, "label", e.target.value)} required aria-label={`Level ${o.level} label`} />
              <textarea className="input md:col-span-2" rows={2} placeholder="Detailed description of the expected state" value={o.description} onChange={(e) => setOpt(i, "description", e.target.value)} required aria-label={`Level ${o.level} description`} />
              <textarea className="input" rows={2} placeholder="Observable criteria / evidence" value={o.criteria} onChange={(e) => setOpt(i, "criteria", e.target.value)} aria-label={`Level ${o.level} criteria`} />
              <textarea className="input" rows={2} placeholder="Practical examples" value={o.examples} onChange={(e) => setOpt(i, "examples", e.target.value)} aria-label={`Level ${o.level} examples`} />
              <textarea className="input md:col-span-2" rows={1} placeholder="What is missing compared with the next level (optional)" value={o.gaps} onChange={(e) => setOpt(i, "gaps", e.target.value)} aria-label={`Level ${o.level} gaps`} />
            </div>
          </div>
        ))}
      </fieldset>
      {id && <Field label="Change note (recorded in version history)" htmlFor="qe-note"><input id="qe-note" className="input" value={v.changeNote} onChange={set("changeNote")} /></Field>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : id ? "Publish new version" : "Create question"}</Button>
        <Button type="button" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
