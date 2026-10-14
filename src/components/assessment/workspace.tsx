"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmResponsesAction, createEvidenceAction, linkEvidenceAction, saveResponseAction, unlinkEvidenceAction, type ScoreSummary } from "@/server/actions";
import { useToast } from "../client";
import { ScoreChip } from "../score";
import { Badge, ProgressBar, buttonClass } from "../ui";
import { cn } from "@/lib/utils";
import { formatPct, formatScore, scoreKindLabel } from "@/lib/scoring/format";
import { EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS, VERIFICATION_LABELS, type VerificationStatus } from "@/lib/constants";
import type { QItem, RState } from "./types";

type Filter = "all" | "unanswered" | "gaps" | "unconfirmed" | "nonscored" | "mandatory" | "focus";
type SaveState = "saving" | "saved" | "error";

const EMPTY: RState = { status: "UNANSWERED", level: null, naJustification: "", comment: "", remediationNotes: "", evidenceNote: "", carriedForward: false, confirmed: true, answeredBy: "", evidence: [], actions: [] };

export function AssessmentWorkspace(props: {
  assessmentId: string;
  projectId: string;
  editable: boolean;
  locked: boolean;
  questions: QItem[];
  initialResponses: Record<string, RState>;
  initialSummary: ScoreSummary;
  criticalGapMaxLevel: number;
  levelLabels: Record<number, string>;
  anchors: Record<number, number>;
  focusDomainIds: string[];
  initialQuestionId?: string;
  projectEvidence: { id: string; title: string; status: string }[];
  canAction: boolean;
}) {
  const { questions, editable, assessmentId } = props;
  const toast = useToast();
  const [responses, setResponses] = useState<Record<string, RState>>(props.initialResponses);
  // Debounced saves must merge into the latest state, not the state captured when the timer started.
  const responsesRef = useRef(responses);
  responsesRef.current = responses;
  const [summary, setSummary] = useState<ScoreSummary>(props.initialSummary);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const initialDomain = questions.find((q) => q.id === props.initialQuestionId)?.domainId ?? questions[0]?.domainId ?? "ALL";
  const [domainId, setDomainId] = useState<string>(initialDomain);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Server refreshes (e.g. after linking evidence) bring new evidence/actions; merge them without discarding local edits.
  useEffect(() => {
    setResponses((prev) => {
      const next = { ...prev };
      for (const [qid, r] of Object.entries(props.initialResponses)) next[qid] = { ...(prev[qid] ?? r), responseId: r.responseId, evidence: r.evidence, actions: r.actions };
      return next;
    });
  }, [props.initialResponses]);

  useEffect(() => {
    if (props.initialQuestionId) setTimeout(() => document.getElementById(`q-${props.initialQuestionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [props.initialQuestionId]);

  const domains = useMemo(() => {
    const m = new Map<string, { id: string; name: string; key: string; practices: Map<string, string> }>();
    for (const q of questions) {
      if (!m.has(q.domainId)) m.set(q.domainId, { id: q.domainId, name: q.domainName, key: q.domainKey, practices: new Map() });
      m.get(q.domainId)!.practices.set(q.practiceId, q.practiceName);
    }
    return [...m.values()];
  }, [questions]);

  const isGap = useCallback(
    (q: QItem, r?: RState) => r?.status === "ANSWERED" && r.level !== null && r.level <= props.criticalGapMaxLevel && (q.criticality === "HIGH" || q.criticality === "CRITICAL"),
    [props.criticalGapMaxLevel],
  );

  const visible = questions.filter((q) => {
    const r = responses[q.id];
    const status = r?.status ?? "UNANSWERED";
    if (domainId !== "ALL" && q.domainId !== domainId) return false;
    if (search && !`${q.key} ${q.title} ${q.description}`.toLowerCase().includes(search.toLowerCase())) return false;
    switch (filter) {
      case "unanswered": return status === "UNANSWERED";
      case "gaps": return isGap(q, r);
      case "unconfirmed": return Boolean(r?.carriedForward && !r.confirmed);
      case "nonscored": return ["NOT_APPLICABLE", "UNABLE_TO_DETERMINE", "EVIDENCE_MISSING"].includes(status);
      case "mandatory": return q.mandatory && status === "UNANSWERED";
      case "focus": return props.focusDomainIds.includes(q.domainId);
      default: return true;
    }
  });

  const save = useCallback(
    async (q: QItem, patch: Partial<RState>) => {
      const current = { ...EMPTY, ...responsesRef.current[q.id], ...patch };
      setResponses((s) => ({ ...s, [q.id]: { ...EMPTY, ...s[q.id], ...patch } }));
      setSaveStates((s) => ({ ...s, [q.id]: "saving" }));
      const res = await saveResponseAction(assessmentId, q.id, {
        status: current.status as "ANSWERED",
        level: current.status === "ANSWERED" ? current.level : null,
        naJustification: current.naJustification,
        comment: current.comment,
        remediationNotes: current.remediationNotes,
        evidenceNote: current.evidenceNote,
      });
      if (!res.ok) {
        setSaveStates((s) => ({ ...s, [q.id]: "error" }));
        toast("error", `${q.key}: ${res.error}`);
        return false;
      }
      setSummary(res.data!.summary);
      setResponses((s) => ({ ...s, [q.id]: { ...EMPTY, ...s[q.id], responseId: res.data!.responseId, confirmed: true, versionAnswered: q.currentVersion } }));
      setSaveStates((s) => ({ ...s, [q.id]: "saved" }));
      setLastSaved(new Date().toLocaleTimeString());
      return true;
    },
    [assessmentId, toast],
  );

  const confirm = useCallback(
    async (ids: string[]) => {
      const res = await confirmResponsesAction(assessmentId, ids);
      if (!res.ok) return toast("error", res.error);
      setSummary(res.data!);
      setResponses((s) => {
        const n = { ...s };
        for (const id of ids) if (n[id]) n[id] = { ...n[id], confirmed: true };
        return n;
      });
      toast("ok", `${ids.length} response(s) reconfirmed`);
    },
    [assessmentId, toast],
  );

  const domainSummary = new Map(summary.domains.map((d) => [d.id, d]));
  const counts = {
    unanswered: questions.filter((q) => (responses[q.id]?.status ?? "UNANSWERED") === "UNANSWERED").length,
    gaps: questions.filter((q) => isGap(q, responses[q.id])).length,
    unconfirmed: questions.filter((q) => responses[q.id]?.carriedForward && !responses[q.id]?.confirmed).length,
    nonscored: summary.na + summary.unable + summary.evidenceMissing,
    mandatory: questions.filter((q) => q.mandatory && (responses[q.id]?.status ?? "UNANSWERED") === "UNANSWERED").length,
  };
  const unconfirmedVisible = visible.filter((q) => responses[q.id]?.carriedForward && !responses[q.id]?.confirmed).map((q) => q.id);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Navigation */}
      <aside className="no-print lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <div className="card p-2">
          <button onClick={() => setDomainId("ALL")} className={cn("mb-1 w-full rounded px-2 py-1.5 text-left text-sm", domainId === "ALL" ? "bg-accent/10 font-medium text-accent" : "hover:bg-subtle")}>
            All domains <span className="text-xs text-muted">({questions.length})</span>
          </button>
          {domains.map((d) => {
            const ds = domainSummary.get(d.id);
            const answered = questions.filter((q) => q.domainId === d.id && (responses[q.id]?.status ?? "UNANSWERED") !== "UNANSWERED").length;
            const total = questions.filter((q) => q.domainId === d.id).length;
            return (
              <div key={d.id}>
                <button onClick={() => setDomainId(d.id)} className={cn("w-full rounded px-2 py-1.5 text-left", domainId === d.id ? "bg-accent/10" : "hover:bg-subtle")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("min-w-0 truncate text-sm", domainId === d.id && "font-medium text-accent")} title={d.name}>
                      {props.focusDomainIds.includes(d.id) && <span title="Focus domain">★ </span>}
                      {d.name}
                    </span>
                    <ScoreChip score={summary.score === null ? null : ds?.score ?? null} size="sm" />
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <ProgressBar value={total ? (answered / total) * 100 : 0} label={`${d.name} completion`} />
                    <span className="shrink-0 text-[10px] text-muted">{answered}/{total}</span>
                  </div>
                </button>
                {domainId === d.id && (
                  <ul className="mb-1 ml-3 border-l border-line pl-2">
                    {[...d.practices.entries()].map(([pid, pname]) => (
                      <li key={pid}><a href={`#practice-${pid}`} className="block truncate py-0.5 text-xs text-muted hover:text-fg">{pname}</a></li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        {/* Live score bar */}
        <div className="card sticky top-0 z-20 p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <ScoreChip score={summary.score} />
              <div className="text-xs">
                <div className="font-medium">{props.locked ? "Snapshot score" : "Live score"}</div>
                <div className="text-muted">{scoreKindLabel({ source: "DIRECT", state: summary.state as "COMPLETE" })}</div>
              </div>
            </div>
            <div className="min-w-[160px] flex-1">
              <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Scored coverage</span><span className="font-medium">{formatPct(summary.coverage)}</span></div>
              <ProgressBar value={summary.coverage} label="Scored coverage" />
            </div>
            <div className="min-w-[160px] flex-1">
              <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Completion</span><span className="font-medium">{formatPct(summary.completion)}</span></div>
              <ProgressBar value={summary.completion} tone="ok" label="Completion" />
            </div>
            <div className="text-xs text-muted">
              {summary.scored} scored · {summary.na} N/A · {summary.unable} unable · {summary.evidenceMissing} evidence missing · {summary.unanswered} unanswered
              {summary.unconfirmedCarriedForward > 0 && <span className="ml-1 font-medium text-warn">· {summary.unconfirmedCarriedForward} to reconfirm</span>}
            </div>
            {editable && <div className="text-xs text-muted" aria-live="polite">{lastSaved ? `Autosaved ${lastSaved}` : "Changes save automatically"}</div>}
          </div>
          {summary.belowThreshold && <p className="mt-2 text-xs text-warn">Provisional value {formatScore(summary.rawScore)} – below the minimum coverage threshold, so it is reported as Not assessed.</p>}
          <div className="no-print mt-3 flex flex-wrap items-center gap-1.5">
            {([
              ["all", `All`],
              ["unanswered", `Unanswered (${counts.unanswered})`],
              ["mandatory", `Mandatory open (${counts.mandatory})`],
              ["gaps", `Critical gaps (${counts.gaps})`],
              ["unconfirmed", `Carried forward (${counts.unconfirmed})`],
              ["nonscored", `N/A & non-scored (${counts.nonscored})`],
              ...(props.focusDomainIds.length ? [["focus", "Focus domains"]] : []),
            ] as [Filter, string][]).map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", filter === f ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-fg")}>
                {label}
              </button>
            ))}
            <input className="input ml-auto !w-56 !py-1 text-xs" placeholder="Search questions…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search questions" />
          </div>
        </div>

        {editable && unconfirmedVisible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            <span>{unconfirmedVisible.length} carried-forward response(s) in this view need explicit reconfirmation.</span>
            <button className={buttonClass("secondary", "sm")} onClick={() => window.confirm(`Reconfirm ${unconfirmedVisible.length} carried-forward responses as still accurate without changes?`) && confirm(unconfirmedVisible)}>
              Reconfirm all shown
            </button>
          </div>
        )}

        {visible.length === 0 && <div className="card p-8 text-center text-sm text-muted">No questions match this filter{domainId !== "ALL" ? " in this domain – try “All domains”" : ""}.</div>}

        {visible.map((q, i) => {
          const showPractice = i === 0 || visible[i - 1].practiceId !== q.practiceId;
          const ds = domainSummary.get(q.domainId);
          const ps = ds?.practices.find((p) => p.id === q.practiceId);
          return (
            <div key={q.id}>
              {showPractice && (
                <div id={`practice-${q.practiceId}`} className="mb-2 mt-4 flex scroll-mt-40 items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted">{q.domainName} <span className="font-normal">/</span> {q.practiceName}</h3>
                  <span className="flex items-center gap-2 text-xs text-muted">Practice score <ScoreChip score={summary.score === null ? null : ps?.score ?? null} size="sm" /></span>
                </div>
              )}
              <QuestionCard
                q={q}
                r={responses[q.id]}
                editable={editable}
                locked={props.locked}
                saveState={saveStates[q.id]}
                onSave={(patch) => save(q, patch)}
                onConfirm={() => confirm([q.id])}
                isGap={isGap(q, responses[q.id])}
                anchors={props.anchors}
                assessmentId={assessmentId}
                projectId={props.projectId}
                projectEvidence={props.projectEvidence}
                canAction={props.canAction}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function evidenceState(r?: RState): { label: string; tone: "neutral" | "warn" | "ok" | "danger" | "accent" } {
  if (!r || r.status === "UNANSWERED") return { label: "No answer", tone: "neutral" };
  if (r.evidence.some((e) => e.status === "VERIFIED")) return { label: "Evidence verified by reviewer", tone: "ok" };
  if (r.evidence.some((e) => e.status === "PENDING")) return { label: "Supported by evidence – pending verification", tone: "accent" };
  if (r.evidence.some((e) => e.status === "REJECTED")) return { label: "Evidence rejected", tone: "danger" };
  if (r.evidenceNote) return { label: "Asserted with reference (no evidence record)", tone: "warn" };
  return { label: "Asserted by assessor (no evidence)", tone: "warn" };
}

function QuestionCard({ q, r, editable, locked, saveState, onSave, onConfirm, isGap, anchors, assessmentId, projectId, projectEvidence, canAction }: {
  q: QItem;
  r?: RState;
  editable: boolean;
  locked: boolean;
  saveState?: SaveState;
  onSave: (patch: Partial<RState>) => Promise<boolean>;
  onConfirm: () => void;
  isGap: boolean;
  anchors: Record<number, number>;
  assessmentId: string;
  projectId: string;
  projectEvidence: { id: string; title: string; status: string }[];
  canAction: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const status = r?.status ?? "UNANSWERED";
  const [texts, setTexts] = useState({ comment: r?.comment ?? "", evidenceNote: r?.evidenceNote ?? "", remediationNotes: r?.remediationNotes ?? "", naJustification: r?.naJustification ?? "" });
  const [showNa, setShowNa] = useState(status === "NOT_APPLICABLE");
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = (k: keyof typeof texts) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const value = e.target.value;
    setTexts((t) => ({ ...t, [k]: value }));
    if (k === "naJustification") return;
    if (timer.current) clearTimeout(timer.current);
    // Debounced autosave of notes (only once the question has a response)
    if (status !== "UNANSWERED" || value) timer.current = setTimeout(() => onSave({ [k]: value }), 900);
  };
  const ev = evidenceState(r);
  // Status changes carry any note text typed but not yet autosaved.
  const withTexts = (p: Partial<RState>): Partial<RState> => {
    if (timer.current) clearTimeout(timer.current);
    return { ...p, comment: texts.comment, evidenceNote: texts.evidenceNote, remediationNotes: texts.remediationNotes };
  };
  const outdated = editable && r && r.status !== "UNANSWERED" && (r.versionAnswered ?? q.currentVersion) < q.currentVersion;

  return (
    <article id={`q-${q.id}`} className={cn("card scroll-mt-44 overflow-hidden", isGap && "border-danger/40", r?.carriedForward && !r.confirmed && "border-warn/50")}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono font-semibold text-muted">{q.key}</span>
            <Badge tone={q.criticality === "CRITICAL" ? "danger" : q.criticality === "HIGH" ? "warn" : "neutral"}>{q.criticality}</Badge>
            <Badge>{q.mandatory ? "Mandatory" : "Recommended"}</Badge>
            <Badge title="Question weight within its practice">w {q.weight}</Badge>
            {q.evidenceRequired && <Badge tone="info">Evidence required</Badge>}
            {q.tags.map((t) => <Badge key={t} tone="accent" title="Product-specific applicability tag">{t}</Badge>)}
            {locked && <Badge>v{q.version}</Badge>}
            {isGap && <Badge tone="danger">Critical gap</Badge>}
          </div>
          <h4 className="mt-1 text-[15px] font-semibold leading-snug">{q.title}</h4>
        </div>
        <div className="text-right text-xs text-muted">
          {saveState === "saving" && <span>Saving…</span>}
          {saveState === "saved" && <span className="text-ok">✓ Saved</span>}
          {saveState === "error" && <span className="text-danger">Not saved</span>}
          {r?.answeredBy && status !== "UNANSWERED" && <div>by {r.answeredBy}</div>}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3">
        <p className="text-sm leading-relaxed">{q.description}</p>

        {r?.carriedForward && !r.confirmed && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
            <span>↻ Carried forward from the previous assessment. Reconfirm it or select a different answer.</span>
            {editable && <button className={buttonClass("secondary", "sm")} onClick={onConfirm}>Reconfirm unchanged</button>}
          </div>
        )}
        {r?.carriedForward && r.confirmed && <p className="text-xs text-muted">↻ Carried forward and reconfirmed.</p>}
        {outdated && <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-info">This question was revised (answered against v{r!.versionAnswered}, current v{q.currentVersion}). Review the updated text and re-save your answer.</p>}

        <details className="rounded-md bg-subtle/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted">Assessment guidance, rationale and evidence examples</summary>
          <dl className="mt-2 grid gap-3 text-sm md:grid-cols-2">
            {[
              ["What the assessor is determining", q.objective],
              ["Why it matters", q.rationale],
              ["Scope & applicability", q.scope],
              ["How to assess", q.guidance],
              ["Recommended evidence", q.evidenceExamples],
              ["Remediation guidance", q.remediationGuidance],
              ["References / mappings", q.references],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold text-muted">{k}</dt><dd className="mt-0.5 whitespace-pre-line">{v}</dd></div>
            ))}
          </dl>
        </details>

        <fieldset disabled={!editable} className="space-y-2">
          <legend className="sr-only">Maturity level for {q.key}</legend>
          {q.options.map((o) => {
            const selected = status === "ANSWERED" && r?.level === o.level;
            return (
              <label key={o.level} className={cn("block cursor-pointer rounded-md border p-3 transition", selected ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-accent/50", !editable && !selected && "cursor-default opacity-70")}>
                <div className="flex items-start gap-3">
                  <input type="radio" name={`lvl-${q.id}`} className="mt-1" checked={selected} onChange={() => onSave(withTexts({ status: "ANSWERED", level: o.level }))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: `var(--lvl-${o.level})`, color: `var(--lvl-fg-${o.level})` }}>L{o.level} · {anchors[o.level]}</span>
                      <span className="text-sm font-semibold">{o.label}</span>
                    </div>
                    <p className="mt-1 text-sm">{o.description}</p>
                    {o.criteria && <p className="mt-1 text-xs"><span className="font-semibold text-muted">Observable criteria: </span>{o.criteria}</p>}
                    {o.examples && <p className="mt-0.5 text-xs"><span className="font-semibold text-muted">Example: </span>{o.examples}</p>}
                    {o.gaps && (selected || !editable) && <p className="mt-0.5 text-xs text-muted"><span className="font-semibold">Missing for the next level: </span>{o.gaps.replace(/^Not yet in place compared with Level \d: /, "")}</p>}
                  </div>
                </div>
              </label>
            );
          })}
        </fieldset>

        {editable && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Other status:</span>
            <button className={cn(buttonClass(status === "NOT_APPLICABLE" ? "primary" : "secondary", "sm"))} onClick={() => setShowNa((s) => !s)}>Not applicable…</button>
            <button className={buttonClass(status === "UNABLE_TO_DETERMINE" ? "primary" : "secondary", "sm")} onClick={() => onSave(withTexts({ status: "UNABLE_TO_DETERMINE", level: null }))} title="Recorded but never scored">Unable to determine</button>
            <button className={buttonClass(status === "EVIDENCE_MISSING" ? "primary" : "secondary", "sm")} onClick={() => onSave(withTexts({ status: "EVIDENCE_MISSING", level: null }))} title="Recorded but never scored">Evidence missing</button>
            {status !== "UNANSWERED" && <button className={buttonClass("ghost", "sm")} onClick={() => onSave({ status: "UNANSWERED", level: null })}>Clear answer</button>}
          </div>
        )}
        {!editable && status !== "ANSWERED" && <p className="text-xs"><Badge>{status.replace(/_/g, " ")}</Badge></p>}
        {(showNa || status === "NOT_APPLICABLE") && (
          <div className="rounded-md border border-line p-3">
            <label className="label" htmlFor={`na-${q.id}`}>Not applicable justification (required, min. 10 characters)</label>
            <textarea id={`na-${q.id}`} className="input min-h-[60px]" value={texts.naJustification} onChange={changed("naJustification")} disabled={!editable} />
            {editable && (
              <button className={cn(buttonClass("primary", "sm"), "mt-2")} disabled={texts.naJustification.trim().length < 10} onClick={() => onSave(withTexts({ status: "NOT_APPLICABLE", level: null, naJustification: texts.naJustification }))}>
                Save as Not applicable
              </button>
            )}
            <p className="mt-1 text-xs text-muted">N/A questions are excluded from the score denominator and reported separately.</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="label" htmlFor={`ev-${q.id}`}>Evidence reference / artifact</label>
            <input id={`ev-${q.id}`} className="input" value={texts.evidenceNote} onChange={changed("evidenceNote")} disabled={!editable} placeholder="URL, ticket, document name…" />
          </div>
          <div>
            <label className="label" htmlFor={`c-${q.id}`}>Assessor comments</label>
            <textarea id={`c-${q.id}`} className="input min-h-[38px]" rows={1} value={texts.comment} onChange={changed("comment")} disabled={!editable} />
          </div>
          <div>
            <label className="label" htmlFor={`rn-${q.id}`}>Remediation notes</label>
            <textarea id={`rn-${q.id}`} className="input min-h-[38px]" rows={1} value={texts.remediationNotes} onChange={changed("remediationNotes")} disabled={!editable} />
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 space-y-1.5 text-xs">
            <Badge tone={ev.tone}>{ev.label}</Badge>
            {r?.evidence.map((e) => (
              <div key={e.linkId} className="flex flex-wrap items-center gap-2">
                <Link href={`/evidence/${e.id}`} className="link">{e.title}</Link>
                <Badge tone={e.status === "VERIFIED" ? "ok" : e.status === "REJECTED" ? "danger" : "neutral"}>{VERIFICATION_LABELS[e.status as VerificationStatus]}</Badge>
                {editable && (
                  <button className="text-muted hover:text-danger" title="Unlink evidence" onClick={async () => {
                    const res = await unlinkEvidenceAction(e.linkId);
                    if (!res.ok) toast("error", res.error); else router.refresh();
                  }}>✕</button>
                )}
              </div>
            ))}
            {r?.actions.map((a) => <div key={a.id}>⚑ <Link href={`/actions/${a.id}`} className="link">{a.title}</Link> <span className="text-muted">({a.status.replace(/_/g, " ").toLowerCase()})</span></div>)}
          </div>
          <div className="no-print flex flex-wrap gap-1.5">
            {editable && r?.responseId && (
              <>
                <select className="input !w-48 !py-1 text-xs" defaultValue="" aria-label="Link existing evidence" onChange={async (e) => {
                  const id = e.target.value;
                  e.target.value = "";
                  if (!id) return;
                  const res = await linkEvidenceAction(id, { responseId: r.responseId });
                  if (!res.ok) toast("error", res.error); else { toast("ok", "Evidence linked"); router.refresh(); }
                }}>
                  <option value="">Link existing evidence…</option>
                  {projectEvidence.filter((pe) => !r.evidence.some((x) => x.id === pe.id)).map((pe) => <option key={pe.id} value={pe.id}>{pe.title} ({pe.status.toLowerCase()})</option>)}
                </select>
                <button className={buttonClass("secondary", "sm")} onClick={() => setShowEvidenceForm((s) => !s)}>+ New evidence</button>
              </>
            )}
            {canAction && r?.responseId && status === "ANSWERED" && (
              <Link className={buttonClass(isGap ? "primary" : "secondary", "sm")} href={`/actions/new?project=${projectId}&question=${q.id}&assessment=${assessmentId}&response=${r.responseId}`}>
                + Remediation action
              </Link>
            )}
          </div>
        </div>
        {editable && !r?.responseId && <p className="text-xs text-muted">Record a response to attach evidence or create remediation actions.</p>}
        {showEvidenceForm && r?.responseId && (
          <form
            className="grid gap-2 rounded-md border border-line p-3 md:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("projectId", projectId);
              fd.set("responseId", r.responseId!);
              const res = await createEvidenceAction(fd);
              if (!res.ok) return toast("error", res.error);
              toast("ok", "Evidence recorded (pending verification)");
              setShowEvidenceForm(false);
              router.refresh();
            }}
          >
            <input name="title" required className="input md:col-span-2" placeholder="Evidence title" maxLength={200} />
            <select name="type" className="input" defaultValue="OTHER">{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}</select>
            <select name="classification" className="input" defaultValue="INTERNAL"><option>PUBLIC</option><option>INTERNAL</option><option>CONFIDENTIAL</option><option>RESTRICTED</option></select>
            <input name="reference" className="input md:col-span-2" placeholder="https://… or internal reference (e.g. JIRA: SEC-123)" />
            <input name="ownerName" className="input" placeholder="Owner" />
            <input name="collectedAt" type="date" className="input" />
            <input name="file" type="file" className="text-xs md:col-span-3" />
            <button className={buttonClass("primary", "sm")} type="submit">Save evidence</button>
          </form>
        )}
      </div>
    </article>
  );
}
