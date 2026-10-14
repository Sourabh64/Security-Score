"use client";

import Link from "next/link";
import { useState } from "react";
import {
  duplicatePracticeAction, duplicateQuestionAction, moveDomainAction, movePracticeAction, moveQuestionAction,
  setDomainActiveAction, setPracticeActiveAction, setQuestionActiveAction, upsertDomainAction, upsertPracticeAction,
} from "@/server/actions";
import { useRunAction } from "../client";
import { Badge, Button, buttonClass } from "../ui";
import { SAMM_FUNCTIONS, SAMM_LABELS, type SammFunction } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface FDomain {
  id: string; key: string; name: string; description: string; sammFunction: string; weight: number; active: boolean;
  practices: { id: string; key: string; name: string; description: string; weight: number; active: boolean; questions: { id: string; key: string; title: string; active: boolean; version: number; tags: string; criticality: string }[] }[];
}

function DomainEditor({ d, onDone }: { d?: FDomain; onDone: () => void }) {
  const [v, setV] = useState({ key: d?.key ?? "", name: d?.name ?? "", description: d?.description ?? "", sammFunction: d?.sammFunction ?? "GOVERNANCE", weight: d?.weight ?? 1 });
  const { exec, pending } = useRunAction();
  return (
    <form className="grid gap-2 rounded-md border border-line bg-subtle/40 p-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); exec(() => upsertDomainAction(d?.id ?? null, v), { success: d ? "Domain updated" : "Domain added", onSuccess: onDone }); }}>
      <input className="input font-mono" placeholder="KEY" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} required aria-label="Domain key" />
      <input className="input md:col-span-2" placeholder="Domain name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required aria-label="Domain name" />
      <select className="input" value={v.sammFunction} onChange={(e) => setV({ ...v, sammFunction: e.target.value })} aria-label="SAMM function">{SAMM_FUNCTIONS.map((f) => <option key={f} value={f}>{SAMM_LABELS[f]}</option>)}</select>
      <input className="input" type="number" step="0.1" min={0} max={100} value={v.weight} onChange={(e) => setV({ ...v, weight: Number(e.target.value) })} aria-label="Weight" />
      <div className="flex gap-1"><Button type="submit" variant="primary" size="sm" disabled={pending}>Save</Button><Button type="button" size="sm" onClick={onDone}>Cancel</Button></div>
      <textarea className="input md:col-span-6" placeholder="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} aria-label="Domain description" />
    </form>
  );
}

function PracticeEditor({ domainId, p, onDone }: { domainId: string; p?: FDomain["practices"][number]; onDone: () => void }) {
  const [v, setV] = useState({ key: p?.key ?? "", name: p?.name ?? "", description: p?.description ?? "", weight: p?.weight ?? 1, domainId });
  const { exec, pending } = useRunAction();
  return (
    <form className="grid gap-2 rounded-md border border-line bg-subtle/40 p-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); exec(() => upsertPracticeAction(p?.id ?? null, v), { success: p ? "Practice updated" : "Practice added", onSuccess: onDone }); }}>
      <input className="input font-mono" placeholder="KEY" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} required aria-label="Practice key" />
      <input className="input md:col-span-2" placeholder="Practice name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required aria-label="Practice name" />
      <input className="input" type="number" step="0.1" min={0} max={100} value={v.weight} onChange={(e) => setV({ ...v, weight: Number(e.target.value) })} aria-label="Practice weight" />
      <div className="flex gap-1"><Button type="submit" variant="primary" size="sm" disabled={pending}>Save</Button><Button type="button" size="sm" onClick={onDone}>Cancel</Button></div>
      <textarea className="input md:col-span-5" placeholder="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} aria-label="Practice description" />
    </form>
  );
}

export function FrameworkManager({ domains, editable }: { domains: FDomain[]; editable: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { exec, pending } = useRunAction();
  const small = buttonClass("ghost", "sm");
  return (
    <div className="space-y-3">
      {editable && (editing === "new-domain" ? <DomainEditor onDone={() => setEditing(null)} /> : <Button size="sm" onClick={() => setEditing("new-domain")}>+ Add domain</Button>)}
      {domains.map((d, di) => (
        <div key={d.id} className={cn("card", !d.active && "opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <button className="min-w-0 text-left" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
              <span className="mr-2 text-muted">{open === d.id ? "▾" : "▸"}</span>
              <span className="font-mono text-xs text-muted">{d.key}</span> <span className="font-semibold">{d.name}</span>
              <span className="ml-2 text-xs text-muted">{SAMM_LABELS[d.sammFunction as SammFunction]} · weight {d.weight} · {d.practices.length} practices</span>
              {!d.active && <Badge tone="warn" className="ml-2">inactive</Badge>}
            </button>
            {editable && (
              <span className="flex flex-wrap gap-1">
                <button className={small} disabled={pending || di === 0} onClick={() => exec(() => moveDomainAction(d.id, "up"))} aria-label="Move domain up">↑</button>
                <button className={small} disabled={pending || di === domains.length - 1} onClick={() => exec(() => moveDomainAction(d.id, "down"))} aria-label="Move domain down">↓</button>
                <button className={small} onClick={() => setEditing(`d-${d.id}`)}>Edit</button>
                <button className={small} disabled={pending} onClick={() => exec(() => setDomainActiveAction(d.id, !d.active), { confirm: d.active ? `Deactivate domain ${d.name}? It will no longer appear in new assessments or draft scores; completed snapshots are unaffected.` : undefined, success: d.active ? "Domain deactivated" : "Domain activated" })}>{d.active ? "Deactivate" : "Activate"}</button>
              </span>
            )}
          </div>
          {editing === `d-${d.id}` && <div className="px-4 pb-3"><DomainEditor d={d} onDone={() => setEditing(null)} /></div>}
          {open === d.id && (
            <div className="space-y-3 border-t border-line px-4 py-3">
              {d.practices.map((p, pi) => (
                <div key={p.id} className={cn("rounded-md border border-line", !p.active && "opacity-60")}>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-subtle/50 px-3 py-2">
                    <span className="text-sm"><span className="font-mono text-xs text-muted">{p.key}</span> <b>{p.name}</b> <span className="text-xs text-muted">· weight {p.weight}</span>{!p.active && <Badge tone="warn" className="ml-2">inactive</Badge>}</span>
                    {editable && (
                      <span className="flex flex-wrap gap-1">
                        <button className={small} disabled={pending || pi === 0} onClick={() => exec(() => movePracticeAction(p.id, "up"))} aria-label="Move practice up">↑</button>
                        <button className={small} disabled={pending || pi === d.practices.length - 1} onClick={() => exec(() => movePracticeAction(p.id, "down"))} aria-label="Move practice down">↓</button>
                        <button className={small} onClick={() => setEditing(`p-${p.id}`)}>Edit</button>
                        <button className={small} onClick={() => {
                          const key = window.prompt("Key for the duplicated practice (e.g. ENF-ZTNA):");
                          if (!key) return;
                          const name = window.prompt("Name of the new practice:", `${p.name} (variant)`) ?? "";
                          const tags = window.prompt("Applicability tags for the copied questions (comma separated, empty = all products). Leave unchanged to keep the originals.", p.questions[0]?.tags ?? "");
                          exec(() => duplicatePracticeAction(p.id, key, name, tags ?? undefined), { success: "Practice duplicated" });
                        }}>Duplicate</button>
                        <button className={small} disabled={pending} onClick={() => exec(() => setPracticeActiveAction(p.id, !p.active), { success: "Practice updated" })}>{p.active ? "Deactivate" : "Activate"}</button>
                        <Link className={small} href={`/admin/questions/new?practice=${p.id}`}>+ Question</Link>
                      </span>
                    )}
                  </div>
                  {editing === `p-${p.id}` && <div className="p-3"><PracticeEditor domainId={d.id} p={p} onDone={() => setEditing(null)} /></div>}
                  <ul className="divide-y divide-line">
                    {p.questions.map((q, qi) => (
                      <li key={q.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm", !q.active && "opacity-60")}>
                        <Link href={`/framework/questions/${q.id}`} className="min-w-0 hover:underline"><span className="font-mono text-xs text-muted">{q.key}</span> {q.title}</Link>
                        <span className="flex flex-wrap items-center gap-1">
                          {q.tags && <Badge tone="accent">{q.tags}</Badge>}
                          <Badge>v{q.version}</Badge>
                          {editable && (
                            <>
                              <button className={small} disabled={pending || qi === 0} onClick={() => exec(() => moveQuestionAction(q.id, "up"))} aria-label="Move question up">↑</button>
                              <button className={small} disabled={pending || qi === p.questions.length - 1} onClick={() => exec(() => moveQuestionAction(q.id, "down"))} aria-label="Move question down">↓</button>
                              <Link className={small} href={`/admin/questions/${q.id}`}>Edit</Link>
                              <button className={small} onClick={() => {
                                const key = window.prompt("Key for the product-specific variant (e.g. DLP-09):");
                                if (!key) return;
                                const tags = window.prompt("Applicability tags for the variant (comma separated, empty = all products):", q.tags);
                                exec(() => duplicateQuestionAction(q.id, key, tags ?? undefined), { success: "Question duplicated" });
                              }}>Duplicate</button>
                              <button className={small} disabled={pending} onClick={() => exec(() => setQuestionActiveAction(q.id, !q.active), { success: "Question updated" })}>{q.active ? "Deactivate" : "Activate"}</button>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                    {p.questions.length === 0 && <li className="px-3 py-2 text-xs text-muted">No questions yet.</li>}
                  </ul>
                </div>
              ))}
              {editable && (editing === `np-${d.id}` ? <PracticeEditor domainId={d.id} onDone={() => setEditing(null)} /> : <Button size="sm" onClick={() => setEditing(`np-${d.id}`)}>+ Add practice</Button>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
