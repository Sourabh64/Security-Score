import type { ScoreSource, ScoreState } from "@/lib/scoring/engine";
import { formatPct, formatScore, impliedLevel, scoreColor, scoreKind, scoreKindLabel } from "@/lib/scoring/format";
import { cn } from "@/lib/utils";
import { Badge } from "./ui";

/** Compact score chip: number + implied level, colored by maturity band. Unassessed has its own texture. */
export function ScoreChip({ score, decimals = 1, className, size = "md" }: { score: number | null | undefined; decimals?: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const c = scoreColor(score ?? null);
  const sz = size === "lg" ? "px-3 py-1.5 text-2xl min-w-[5rem]" : size === "sm" ? "px-1.5 py-0.5 text-xs min-w-[2.75rem]" : "px-2 py-0.5 text-sm min-w-[3.5rem]";
  if (!c)
    return (
      <span className={cn("cell-unassessed inline-flex items-center justify-center rounded font-medium text-muted", sz, size === "lg" && "text-base", className)} title="Not assessed – no sufficient scored responses">
        {size === "lg" ? "Not assessed" : "N/A"}
      </span>
    );
  return (
    <span className={cn("inline-flex items-center justify-center rounded font-semibold tabular-nums", sz, className)} style={{ background: c.bg, color: c.fg }} title={`Score ${formatScore(score, 1)} – implied ${c.name}`}>
      {formatScore(score, decimals)}
    </span>
  );
}

/** Badge that makes the source of a score explicit. */
export function ScoreKindBadge({ source, state }: { source: ScoreSource; state: ScoreState }) {
  const kind = scoreKind({ source, state });
  const tone = kind === "NOT_ASSESSED" ? "neutral" : kind === "PARTIAL" ? "warn" : kind === "AGGREGATED" ? "accent" : "ok";
  const icon = kind === "NOT_ASSESSED" ? "○" : kind === "PARTIAL" ? "◐" : kind === "AGGREGATED" ? "Σ" : "●";
  return (
    <Badge tone={tone} title={explainKind(source, state)}>
      <span aria-hidden>{icon}</span>
      {scoreKindLabel({ source, state })}
    </Badge>
  );
}

function explainKind(source: ScoreSource, state: ScoreState) {
  if (state === "NOT_ASSESSED") return "No sufficient scored responses. Unassessed items are never treated as zero.";
  if (source === "AGGREGATED")
    return state === "COMPLETE"
      ? "Weighted average of all active subprojects, each fully assessed. Parent-level answers are excluded."
      : "Weighted average of the subprojects that have a score; some subprojects are unassessed or only partially assessed.";
  return state === "COMPLETE" ? "Calculated from this project's own fully answered assessment." : "Calculated from answered questions only; some applicable questions are unanswered, so the score is provisional.";
}

export function LevelPill({ level, label }: { level: number | null; label?: string }) {
  if (level === null) return <span className="cell-unassessed rounded px-1.5 py-0.5 text-xs text-muted">–</span>;
  const c = scoreColor([0, 10, 30, 50, 75, 100][level]);
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: c!.bg, color: c!.fg }} title={label}>
      L{level}
    </span>
  );
}

export function CoverageText({ coverage, completion, className }: { coverage: number; completion?: number; className?: string }) {
  return (
    <span className={cn("text-xs text-muted", className)} title="Scored coverage = scored questions ÷ applicable (non-N/A) questions. Completion = questions with any response ÷ all applicable questions.">
      {formatPct(coverage)} scored{completion !== undefined && <> · {formatPct(completion)} complete</>}
    </span>
  );
}

export function impliedLevelLabel(score: number | null, labels: Record<number, string>) {
  if (score === null) return "Not assessed";
  const l = impliedLevel(score);
  return `Level ${l} – ${labels[l]}`;
}
