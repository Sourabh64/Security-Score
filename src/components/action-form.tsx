"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createRemediationAction, updateRemediationAction } from "@/server/actions";
import { Button, Field } from "./ui";
import { useToast } from "./client";
import { ACTION_STATUS_LABELS, ACTION_WORKING_STATUSES, PRIORITIES } from "@/lib/constants";
import type { ActionInput } from "@/lib/validation";

interface QOpt { id: string; key: string; title: string; domainId: string; practiceId: string; remediation: string }

export function ActionForm({ id, initial, projects, domains, questions, slaDays }: {
  id?: string;
  initial: Partial<ActionInput> & { targetDate?: string | null };
  projects: { id: string; label: string }[];
  domains: { id: string; name: string }[];
  questions: QOpt[];
  slaDays: Record<string, number>;
}) {
  const router = useRouter();
  const toast = useToast();
  const defaultTarget = (prio: string) => new Date(Date.now() + (slaDays[prio] ?? 90) * 86400000).toISOString().slice(0, 10);
  const [v, setV] = useState({
    title: "", description: "", projectId: "", domainId: "", practiceId: "", questionId: "", assessmentId: "", responseId: "", gap: "",
    priority: "MEDIUM", owner: "", status: "OPEN", recommendation: "", completionEvidence: "",
    ...Object.fromEntries(Object.entries(initial).map(([k, val]) => [k, val ?? ""])),
    targetDate: initial.targetDate ?? defaultTarget(initial.priority ?? "MEDIUM"),
  } as Record<string, string>);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qs = useMemo(() => questions.filter((q) => !v.domainId || q.domainId === v.domainId), [questions, v.domainId]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setV((s) => {
      const n = { ...s, [k]: value };
      if (k === "questionId") {
        const q = questions.find((x) => x.id === value);
        if (q) {
          n.domainId = q.domainId;
          if (!s.recommendation) n.recommendation = q.remediation;
          if (!s.title) n.title = `Improve ${q.key}: ${q.title}`.slice(0, 200);
        }
      }
      if (k === "priority" && !id) n.targetDate = defaultTarget(value);
      return n;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const payload = { ...v, targetDate: v.targetDate || null, practiceId: v.practiceId || null } as unknown as ActionInput;
    const res = id ? await updateRemediationAction(id, payload) : await createRemediationAction(payload);
    setPending(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      return toast("error", res.error);
    }
    toast("ok", id ? "Action updated" : "Action created");
    router.push(`/actions/${id ?? res.data}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title *" htmlFor="title" error={errors.title}><input id="title" className="input" value={v.title} onChange={set("title")} required maxLength={200} /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Project / subproject *" htmlFor="project"><select id="project" className="input" value={v.projectId} onChange={set("projectId")} required disabled={Boolean(v.responseId)}><option value="">Select…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label="Domain" htmlFor="domain"><select id="domain" className="input" value={v.domainId} onChange={set("domainId")}><option value="">–</option>{domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Question" htmlFor="question" hint="Practice and domain are derived from the question"><select id="question" className="input" value={v.questionId} onChange={set("questionId")}><option value="">–</option>{qs.map((q) => <option key={q.id} value={q.id}>{q.key} – {q.title.slice(0, 70)}</option>)}</select></Field>
      </div>
      <Field label="Gap / risk description" htmlFor="gap"><textarea id="gap" className="input min-h-[60px]" value={v.gap} onChange={set("gap")} /></Field>
      <Field label="Description" htmlFor="desc"><textarea id="desc" className="input min-h-[60px]" value={v.description} onChange={set("description")} /></Field>
      <Field label="Recommended remediation" htmlFor="rec"><textarea id="rec" className="input min-h-[60px]" value={v.recommendation} onChange={set("recommendation")} /></Field>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Priority" htmlFor="prio"><select id="prio" className="input" value={v.priority} onChange={set("priority")}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Owner" htmlFor="owner"><input id="owner" className="input" value={v.owner} onChange={set("owner")} /></Field>
        <Field label="Target date" htmlFor="target" hint={!id ? `Default from ${v.priority} SLA (${slaDays[v.priority]} days)` : undefined}><input id="target" type="date" className="input" value={v.targetDate} onChange={set("targetDate")} /></Field>
        <Field label="Status" htmlFor="status" hint="Close / accept risk via the explicit actions on the detail page"><select id="status" className="input" value={v.status} onChange={set("status")}>{ACTION_WORKING_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}</select></Field>
      </div>
      <Field label="Evidence of completion (notes)" htmlFor="ce"><textarea id="ce" className="input min-h-[50px]" value={v.completionEvidence} onChange={set("completionEvidence")} /></Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Create action"}</Button>
        <Button type="button" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
