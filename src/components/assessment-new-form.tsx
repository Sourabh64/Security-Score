"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAssessmentAction } from "@/server/actions";
import { Button, Field } from "./ui";
import { useToast } from "./client";
import { ASSESSMENT_TYPE_LABELS } from "@/lib/constants";

interface Proj { id: string; name: string; key: string; parentName: string | null; hasChildren: boolean }
interface PrevAssessment { id: string; projectId: string; title: string; status: string; date: string }

export function NewAssessmentForm({ projects, users, previous, domains, defaults }: {
  projects: Proj[];
  users: { id: string; name: string; role: string }[];
  previous: PrevAssessment[];
  domains: { id: string; name: string }[];
  defaults: { projectId?: string; basedOnId?: string; currentUserId?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const initialBase = previous.find((p) => p.id === defaults.basedOnId);
  const [projectId, setProjectId] = useState(initialBase?.projectId ?? defaults.projectId ?? "");
  const project = projects.find((p) => p.id === projectId);
  const [type, setType] = useState<"BASELINE" | "PERIODIC" | "TARGETED">(initialBase ? "PERIODIC" : "BASELINE");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [assessorId, setAssessorId] = useState(defaults.currentUserId ?? "");
  const [reviewerId, setReviewerId] = useState("");
  const [date, setDate] = useState(today);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [basedOnId, setBasedOnId] = useState(defaults.basedOnId ?? "");
  const [copy, setCopy] = useState(Boolean(defaults.basedOnId));
  const [focus, setFocus] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const prevForProject = useMemo(() => previous.filter((p) => p.projectId === projectId), [previous, projectId]);
  const autoTitle = project ? `${project.key} ${project?.hasChildren ? "oversight" : type.toLowerCase()} assessment ${date.slice(0, 7)}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await createAssessmentAction({
      projectId, type: project?.hasChildren ? "OVERSIGHT" : type, title: title || autoTitle, scope, assessorId: assessorId || null, reviewerId: reviewerId || null,
      assessmentDate: date, periodStart: periodStart || null, periodEnd: periodEnd || null, basedOnId: basedOnId || null, copyResponses: Boolean(basedOnId) && copy, focusDomainIds: focus,
    });
    setPending(false);
    if (!res.ok) return toast("error", res.error);
    toast("ok", "Assessment created");
    router.push(`/assessments/${res.data}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Project or subproject *" htmlFor="project">
          <select id="project" className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBasedOnId(""); setCopy(false); }} required>
            <option value="">Select…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.parentName ? `${p.parentName} / ` : ""}{p.name}{p.hasChildren ? " (parent – oversight only)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Assessment type" htmlFor="type" hint={project?.hasChildren ? "This project has active subprojects: its score is aggregated from them. This assessment is recorded as a separate oversight assessment and does not affect the aggregated score." : undefined}>
          <select id="type" className="input" value={project?.hasChildren ? "OVERSIGHT" : type} disabled={project?.hasChildren} onChange={(e) => setType(e.target.value as typeof type)}>
            {project?.hasChildren ? <option value="OVERSIGHT">{ASSESSMENT_TYPE_LABELS.OVERSIGHT}</option> : (["BASELINE", "PERIODIC", "TARGETED"] as const).map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Title" htmlFor="title" hint={autoTitle && `Default: ${autoTitle}`}><input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} maxLength={200} /></Field>
      <Field label="Scope" htmlFor="scope" hint="What is in and out of scope, interview participants, environments, versions…"><textarea id="scope" className="input min-h-[70px]" value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Assessment owner (assessor)" htmlFor="assessor">
          <select id="assessor" className="input" value={assessorId} onChange={(e) => setAssessorId(e.target.value)}>
            <option value="">(me)</option>
            {users.filter((u) => u.role === "ASSESSOR" || u.role === "ADMIN").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Reviewer" htmlFor="reviewer" hint="Must differ from the assessor">
          <select id="reviewer" className="input" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.filter((u) => u.role === "REVIEWER" || u.role === "ADMIN").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Assessment date *" htmlFor="date"><input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Period from" htmlFor="ps"><input id="ps" type="date" className="input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
          <Field label="to" htmlFor="pe"><input id="pe" type="date" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
        </div>
      </div>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-sm font-medium">Reassessment</legend>
        {prevForProject.length === 0 ? <p className="text-sm text-muted">{projectId ? "No previous assessments for this project – this will be a fresh assessment." : "Select a project first."}</p> : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Based on previous assessment" htmlFor="base">
              <select id="base" className="input" value={basedOnId} onChange={(e) => { setBasedOnId(e.target.value); setCopy(Boolean(e.target.value)); }}>
                <option value="">— Start fresh —</option>
                {prevForProject.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.date}, {p.status.toLowerCase()})</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-2 pt-6 text-sm">
              <input type="checkbox" checked={copy} disabled={!basedOnId} onChange={(e) => setCopy(e.target.checked)} className="mt-1" />
              <span>Copy previous responses as starting values. They are marked <b>carried forward</b> and must be reconfirmed before the assessment can be completed.</span>
            </label>
          </div>
        )}
      </fieldset>

      {type === "TARGETED" && !project?.hasChildren && (
        <fieldset className="rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-medium">Focus domains</legend>
          <p className="mb-2 text-xs text-muted">Targeted reassessments still score the full applicable framework (unanswered items reduce coverage, never the score). Focus domains are highlighted for navigation and reporting.</p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {domains.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={focus.includes(d.id)} onChange={(e) => setFocus((f) => (e.target.checked ? [...f, d.id] : f.filter((x) => x !== d.id)))} />
                {d.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || !projectId}>{pending ? "Creating…" : "Create assessment"}</Button>
        <Button type="button" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
