"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProjectAction, updateProjectAction } from "@/server/actions";
import { Button, Field } from "./ui";
import { useToast } from "./client";
import { CRITICALITIES, LIFECYCLE_LABELS, LIFECYCLE_STATUSES } from "@/lib/constants";
import type { ProjectInput } from "@/lib/validation";

export function ProjectForm({ initial, id, parents, knownCapabilities }: {
  initial: Partial<ProjectInput>;
  id?: string;
  parents: { id: string; name: string }[];
  knownCapabilities: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<ProjectInput>({
    key: "", name: "", description: "", businessPurpose: "", productOwner: "", securityOwner: "", technicalOwner: "",
    criticality: "HIGH", lifecycleStatus: "GA", tags: "", capabilities: "", weight: 1, weightRationale: "", parentId: null, ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = (k: keyof ProjectInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: k === "weight" ? Number(e.target.value) : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const payload = { ...v, parentId: v.parentId || null };
    const res = id ? await updateProjectAction(id, payload) : await createProjectAction(payload);
    setPending(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast("error", res.error);
      return;
    }
    toast("ok", id ? "Project updated" : "Project created");
    router.push(`/projects/${res.data}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Name *" htmlFor="name" error={errors.name}><input id="name" className="input" value={v.name} onChange={set("name")} required maxLength={120} /></Field>
        <Field label="Unique identifier *" htmlFor="key" error={errors.key} hint="Letters, digits, - _ . (stored upper-case)"><input id="key" className="input font-mono" value={v.key} onChange={set("key")} required maxLength={32} /></Field>
        <Field label="Parent project" htmlFor="parentId" error={errors.parentId} hint="Leave empty for a main project">
          <select id="parentId" className="input" value={v.parentId ?? ""} onChange={set("parentId")}>
            <option value="">— None (main project) —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor="description" error={errors.description}><textarea id="description" className="input min-h-[70px]" value={v.description} onChange={set("description")} /></Field>
      <Field label="Business purpose" htmlFor="businessPurpose" error={errors.businessPurpose}><textarea id="businessPurpose" className="input min-h-[60px]" value={v.businessPurpose} onChange={set("businessPurpose")} /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Product owner" htmlFor="po"><input id="po" className="input" value={v.productOwner} onChange={set("productOwner")} /></Field>
        <Field label="Security owner" htmlFor="so"><input id="so" className="input" value={v.securityOwner} onChange={set("securityOwner")} /></Field>
        <Field label="Technical owner" htmlFor="to"><input id="to" className="input" value={v.technicalOwner} onChange={set("technicalOwner")} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Criticality" htmlFor="crit"><select id="crit" className="input" value={v.criticality} onChange={set("criticality")}>{CRITICALITIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Lifecycle status" htmlFor="life"><select id="life" className="input" value={v.lifecycleStatus} onChange={set("lifecycleStatus")}>{LIFECYCLE_STATUSES.map((c) => <option key={c} value={c}>{LIFECYCLE_LABELS[c]}</option>)}</select></Field>
        <Field label="Aggregation weight" htmlFor="weight" error={errors.weight} hint="Relative to siblings (0–100). Default 1 = equal."><input id="weight" type="number" step="0.1" min={0} max={100} className="input" value={v.weight} onChange={set("weight")} /></Field>
        <Field label="Weight rationale" htmlFor="wr"><input id="wr" className="input" value={v.weightRationale} onChange={set("weightRationale")} placeholder="Why this weight?" /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tags" htmlFor="tags" hint="Free labels, comma separated"><input id="tags" className="input" value={v.tags} onChange={set("tags")} /></Field>
        <Field label="Product profile / capabilities" htmlFor="caps" error={errors.capabilities}
          hint={<>Drives question applicability (inherited by subprojects). Known: {knownCapabilities.map((c) => <code key={c} className="mr-1 rounded bg-subtle px-1">{c}</code>)}</>}>
          <input id="caps" className="input font-mono" value={v.capabilities} onChange={set("capabilities")} placeholder="e.g. dlp, dlp-endpoint" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Create project"}</Button>
        <Button type="button" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
