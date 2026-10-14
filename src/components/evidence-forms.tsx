"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEvidenceAction, updateEvidenceAction, verifyEvidenceAction } from "@/server/actions";
import { useRunAction, useToast } from "./client";
import { Button, Field } from "./ui";
import { CLASSIFICATIONS, EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS } from "@/lib/constants";
import type { EvidenceInput } from "@/lib/validation";

export function EvidenceForm({ id, projects, initial }: { id?: string; projects: { id: string; label: string }[]; initial?: Partial<EvidenceInput> & { collectedAt?: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const fd = new FormData(e.currentTarget);
        const res = id
          ? await updateEvidenceAction(id, Object.fromEntries([...fd.entries()].filter(([k]) => k !== "file")) as unknown as EvidenceInput)
          : await createEvidenceAction(fd);
        setPending(false);
        if (!res.ok) return toast("error", res.error);
        toast("ok", id ? "Evidence updated" : "Evidence recorded – pending verification");
        router.push(`/evidence/${id ?? res.data}`);
        router.refresh();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title *" htmlFor="e-title"><input id="e-title" name="title" className="input" defaultValue={initial?.title} required maxLength={200} /></Field>
        <Field label="Project *" htmlFor="e-project"><select id="e-project" name="projectId" className="input" defaultValue={initial?.projectId} required><option value="">Select…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      </div>
      <Field label="Description" htmlFor="e-desc"><textarea id="e-desc" name="description" className="input min-h-[70px]" defaultValue={initial?.description} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="URL or internal artifact reference" htmlFor="e-ref" hint="http(s) URLs become links; other schemes are rejected. Plain references like “JIRA: SEC-123” are fine."><input id="e-ref" name="reference" className="input" defaultValue={initial?.reference} /></Field>
        <Field label="Evidence type" htmlFor="e-type"><select id="e-type" name="type" className="input" defaultValue={initial?.type ?? "OTHER"}>{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}</select></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Owner" htmlFor="e-owner"><input id="e-owner" name="ownerName" className="input" defaultValue={initial?.ownerName} /></Field>
        <Field label="Date collected" htmlFor="e-coll"><input id="e-coll" type="date" name="collectedAt" className="input" defaultValue={initial?.collectedAt} /></Field>
        <Field label="Classification" htmlFor="e-class"><select id="e-class" name="classification" className="input" defaultValue={initial?.classification ?? "INTERNAL"}>{CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      {!id && <Field label="Attachment (optional, max 10 MB)" htmlFor="e-file" hint="Stored on the server under a random name; downloaded as an attachment."><input id="e-file" type="file" name="file" className="text-sm" /></Field>}
      <p className="text-xs text-muted">Recording evidence does not by itself prove that a control is implemented – a reviewer must verify it.</p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Record evidence"}</Button>
        <Button type="button" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

export function VerifyEvidence({ id, status }: { id: string; status: string }) {
  const [note, setNote] = useState("");
  const { exec, pending } = useRunAction();
  return (
    <div className="space-y-2">
      <textarea className="input min-h-[60px]" placeholder="Verification note (what was checked)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Verification note" />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => exec(() => verifyEvidenceAction(id, { status: "VERIFIED", note }), { success: "Evidence verified" })}>Mark verified</Button>
        <Button variant="danger" size="sm" disabled={pending || note.trim().length < 3} onClick={() => exec(() => verifyEvidenceAction(id, { status: "REJECTED", note }), { success: "Evidence rejected" })}>Reject</Button>
        {status !== "PENDING" && <Button size="sm" disabled={pending} onClick={() => exec(() => verifyEvidenceAction(id, { status: "PENDING", note }), { success: "Reset to pending" })}>Reset to pending</Button>}
      </div>
    </div>
  );
}
