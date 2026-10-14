import Link from "next/link";
import type { AssessmentScore, EffectiveScore } from "@/lib/scoring/engine";
import { formatPct, formatScore } from "@/lib/scoring/format";
import { ScoreChip } from "./score";
import { Badge } from "./ui";

export function MethodNote({ anchors, minCoverage }: { anchors: Record<number, number>; minCoverage: number }) {
  return (
    <div className="space-y-2 text-xs text-muted">
      <p>
        <b className="text-fg">Question score</b> = anchor of the selected level (L1 {anchors[1]}, L2 {anchors[2]}, L3 {anchors[3]}, L4 {anchors[4]}, L5 {anchors[5]}).
        Unanswered, &quot;Unable to determine&quot; and &quot;Evidence missing&quot; questions contribute no value (never zero); N/A questions leave the denominator.
      </p>
      <p>
        <b className="text-fg">Practice</b> = weighted average of answered questions · <b className="text-fg">Domain</b> = weighted average of scored practices ·{" "}
        <b className="text-fg">Project</b> = weighted average of scored domains. Weights are normalized over the items that have a score.
      </p>
      <p>
        A score is reported only when scored coverage ≥ {minCoverage}% (otherwise &quot;Not assessed&quot;). Parents with active subprojects are the weighted average of
        subproject scores only; parent-level oversight answers are reported separately and never mixed in.
      </p>
    </div>
  );
}

/** Domain → practice breakdown with weights, normalized weights, scores and coverage. */
export function BreakdownTable({ score, assessmentId }: { score: AssessmentScore; assessmentId?: string }) {
  return (
    <div className="space-y-2">
      {score.domains.map((d) => (
        <details key={d.id} id={`domain-${d.id}`} className="group rounded-md border border-line target:ring-2 target:ring-accent">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 hover:bg-subtle">
            <span className="min-w-0">
              <span className="mr-1 text-muted group-open:rotate-90">▸</span>
              <span className="font-medium">{d.name}</span>
              <span className="ml-2 text-xs text-muted">weight {d.weight} → {formatPct(d.normalizedWeight * 100, 1)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
              <span>{d.scored}/{d.total - d.na} scored{d.na ? ` · ${d.na} N/A` : ""}</span>
              <ScoreChip score={score.score === null ? null : d.score} size="sm" />
            </span>
          </summary>
          <table className="w-full border-t border-line text-xs">
            <thead>
              <tr className="text-muted">
                <th className="px-3 py-1 text-left font-medium">Practice</th>
                <th className="px-3 py-1 text-right font-medium">Weight</th>
                <th className="px-3 py-1 text-right font-medium">Normalized</th>
                <th className="px-3 py-1 text-right font-medium">Scored</th>
                <th className="px-3 py-1 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {d.practices.map((p) => (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="px-3 py-1.5">
                    {p.name}
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {p.questions.map((q) => (
                        <Link
                          key={q.id}
                          href={assessmentId ? `/assessments/${assessmentId}?q=${q.id}` : `/framework/questions/${q.id}`}
                          title={`${q.title} – ${q.status === "ANSWERED" ? `L${q.level} (${q.score})` : q.status.replace(/_/g, " ").toLowerCase()} · weight ${q.weight}`}
                          className="rounded border border-line px-1 font-mono text-[10px] text-muted hover:border-accent hover:text-accent"
                        >
                          {q.key}:{q.level ?? (q.status === "NOT_APPLICABLE" ? "NA" : q.status === "UNANSWERED" ? "–" : "?")}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.weight}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.score === null ? "–" : formatPct(p.normalizedWeight * 100, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.scored}/{p.total - p.na}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatScore(p.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

export function AggregationTable({ eff, decimals = 1 }: { eff: EffectiveScore; decimals?: number }) {
  const a = eff.aggregation;
  if (!a) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="ok">{a.assessedCount} fully assessed</Badge>
        <Badge tone="warn">{a.partialCount} partially assessed</Badge>
        <Badge>{a.unassessedCount} not assessed</Badge>
        <Badge tone="accent">{a.contributingCount} of {a.childCount} contribute · {formatPct(a.weightCoverage)} of weight</Badge>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 text-left font-medium">Component</th>
            <th className="py-1 text-right font-medium">Weight</th>
            <th className="py-1 text-right font-medium">Normalized</th>
            <th className="py-1 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {a.children.map((c) => (
            <tr key={c.projectId} className="border-t border-line/60">
              <td className="py-1.5"><Link href={`/projects/${c.projectId}`} className="link">{c.name}</Link>{!c.contributes && <span className="ml-2 text-xs text-muted">excluded – not assessed</span>}</td>
              <td className="py-1.5 text-right tabular-nums">{c.weight}</td>
              <td className="py-1.5 text-right tabular-nums">{c.contributes ? formatPct(c.normalizedWeight * 100, 1) : "–"}</td>
              <td className="py-1.5 text-right"><ScoreChip score={c.score} size="sm" decimals={decimals} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Score = Σ(weightᵢ × scoreᵢ) ÷ Σ(weightᵢ) over contributing components = <b className="text-fg">{formatScore(eff.score, decimals)}</b>. Unassessed components are excluded, not counted as zero.
      </p>
    </div>
  );
}
