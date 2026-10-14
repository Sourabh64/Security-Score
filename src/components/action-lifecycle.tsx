"use client";

import { useState } from "react";
import { acceptRiskRemediationAction, closeRemediationAction, createEvidenceAction, linkEvidenceAction, reopenRemediationAction, unlinkEvidenceAction } from "@/server/actions";
import { useRunAction } from "./client";
import { Button, Field } from "./ui";
import { EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS } from "@/lib/constants";

export function ActionLifecycle({ id, status, canClose, canAccept }: { id: string; status: string; canClose: boolean; canAccept: boolean }) {
  const [mode, setMode] = useState<"none" | "close" | "accept">("none");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [until, setUntil] = useState("");
  const { exec, pending } = useRunAction();
  const terminal = status === "CLOSED" || status === "ACCEPTED_RISK";
  if (terminal)
    return canClose ? (
      <Button onClick={() => exec(() => reopenRemediationAction(id), { confirm: "Reopen this action?", success: "Action reopened" })} disabled={pending}>Reopen action</Button>
    ) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canClose && <Button variant={mode === "close" ? "primary" : "secondary"} onClick={() => setMode(mode === "close" ? "none" : "close")}>Close as remediated…</Button>}
        {canAccept && <Button variant={mode === "accept" ? "primary" : "secondary"} onClick={() => setMode(mode === "accept" ? "none" : "accept")}>Accept risk…</Button>}
      </div>
      {mode === "close" && (
        <form className="space-y-2 rounded-md border border-line p-3" onSubmit={(e) => { e.preventDefault(); exec(() => closeRemediationAction(id, { closureNote: note, completionEvidence: evidence }), { success: "Action closed" }); }}>
          <p className="text-xs text-muted">Closing is an explicit verification step. Describe how completion was verified and reference the evidence.</p>
          <Field label="Verification / closure note (min. 10 chars)" htmlFor="cn"><textarea id="cn" className="input" value={note} onChange={(e) => setNote(e.target.value)} required /></Field>
          <Field label="Evidence of completion" htmlFor="ce"><textarea id="ce" className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" disabled={pending || note.trim().length < 10 || !evidence.trim()}>Confirm closure</Button>
        </form>
      )}
      {mode === "accept" && (
        <form className="space-y-2 rounded-md border border-line p-3" onSubmit={(e) => { e.preventDefault(); exec(() => acceptRiskRemediationAction(id, { closureNote: note, riskAcceptedUntil: until }), { success: "Risk accepted" }); }}>
          <p className="text-xs text-muted">Risk acceptance is time-bound and recorded with your name. Document compensating controls.</p>
          <Field label="Justification & compensating controls" htmlFor="rj"><textarea id="rj" className="input" value={note} onChange={(e) => setNote(e.target.value)} required /></Field>
          <Field label="Acceptance expires" htmlFor="ru"><input id="ru" type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" disabled={pending || note.trim().length < 10 || !until}>Accept risk</Button>
        </form>
      )}
    </div>
  );
}

export function EvidenceLinker({ projectId, actionId, available, linked, editable }: {
  projectId: string;
  actionId: string;
  available: { id: string; title: string }[];
  linked: { linkId: string; id: string; title: string }[];
  editable: boolean;
}) {
  const { exec, pending } = useRunAction();
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="space-y-2">
      {linked.length === 0 && <p className="text-sm text-muted">No evidence linked.</p>}
      {linked.map((l) => (
        <div key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
          <a className="link" href={`/evidence/${l.id}`}>{l.title}</a>
          {editable && <button className="text-xs text-muted hover:text-danger" onClick={() => exec(() => unlinkEvidenceAction(l.linkId), { success: "Unlinked" })}>Unlink</button>}
        </div>
      ))}
      {editable && (
        <div className="flex flex-wrap gap-2 pt-2">
          <select className="input !w-64 !py-1 text-xs" defaultValue="" disabled={pending} aria-label="Link existing evidence" onChange={(e) => {
            const id = e.target.value;
            e.target.value = "";
            if (id) exec(() => linkEvidenceAction(id, { actionId }), { success: "Evidence linked" });
          }}>
            <option value="">Link existing evidence…</option>
            {available.filter((a) => !linked.some((l) => l.id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <Button size="sm" onClick={() => setShowNew((s) => !s)}>+ New evidence</Button>
        </div>
      )}
      {showNew && (
        <form className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("projectId", projectId);
          fd.set("actionId", actionId);
          exec(() => createEvidenceAction(fd), { success: "Evidence recorded", onSuccess: () => setShowNew(false) });
        }}>
          <input name="title" required className="input sm:col-span-2" placeholder="Title" />
          <select name="type" className="input" defaultValue="OTHER">{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}</select>
          <input name="reference" className="input" placeholder="https://… or internal reference" />
          <input name="file" type="file" className="text-xs" />
          <Button type="submit" variant="primary" size="sm">Save</Button>
        </form>
      )}
    </div>
  );
}
