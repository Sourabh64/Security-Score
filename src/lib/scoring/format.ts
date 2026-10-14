import type { EffectiveScore, ScoreState, ScoreSource } from "./engine";

/**
 * Consistent rounding rule used everywhere (UI, reports, CSV): round half away from zero.
 * Detailed views use 1 decimal; organization summaries use the configured decimals (default 0).
 */
export function roundScore(value: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * f + 1e-9)) / f;
}

export function formatScore(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not assessed";
  return roundScore(value, decimals).toFixed(decimals);
}

export function formatPct(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${roundScore(value, decimals).toFixed(decimals)}%`;
}

/** Score band boundaries are the midpoints between level anchors (10/30/50/75/100). */
export function bandBoundaries(anchors: Record<number, number>): number[] {
  const a = [1, 2, 3, 4, 5].map((l) => anchors[l]);
  return [0, 1, 2, 3].map((i) => (a[i] + a[i + 1]) / 2);
}

/** Implied maturity level (1..5) for a score, using anchor midpoints. */
export function impliedLevel(score: number, anchors: Record<number, number> = { 1: 10, 2: 30, 3: 50, 4: 75, 5: 100 }): number {
  const b = bandBoundaries(anchors);
  let level = 1;
  for (const boundary of b) if (score >= boundary) level++;
  return level;
}

/**
 * Maturity is an ordinal magnitude, so it uses ONE hue (blue) stepped light -> dark, validated with the
 * dataviz palette validator (--ordinal) for both themes. Colors are CSS variables (see globals.css) so
 * the dark theme gets its own validated steps. Scores are always printed alongside the color.
 */
export const LEVEL_COLORS: Record<number, { bg: string; fg: string; name: string }> = {
  1: { bg: "var(--lvl-1)", fg: "var(--lvl-fg-1)", name: "Level 1" },
  2: { bg: "var(--lvl-2)", fg: "var(--lvl-fg-2)", name: "Level 2" },
  3: { bg: "var(--lvl-3)", fg: "var(--lvl-fg-3)", name: "Level 3" },
  4: { bg: "var(--lvl-4)", fg: "var(--lvl-fg-4)", name: "Level 4" },
  5: { bg: "var(--lvl-5)", fg: "var(--lvl-fg-5)", name: "Level 5" },
};
/** Hex steps for SVG charts (attributes cannot use CSS variables). */
export const LEVEL_HEX = {
  light: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"],
  dark: ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"],
};
/** Categorical series order (validated): blue, orange, aqua, yellow. Assigned by entity, never by rank. */
export const SERIES_HEX = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export function scoreColor(score: number | null | undefined, anchors?: Record<number, number>) {
  if (score === null || score === undefined) return null;
  return LEVEL_COLORS[impliedLevel(score, anchors)];
}

export type ScoreKind = "DIRECT" | "AGGREGATED" | "PARTIAL" | "NOT_ASSESSED";

/** Classifies a score for the UI: directly assessed, aggregated, partially assessed, not assessed. */
export function scoreKind(e: { source: ScoreSource; state: ScoreState }): ScoreKind {
  if (e.state === "NOT_ASSESSED") return "NOT_ASSESSED";
  if (e.state === "PARTIAL") return "PARTIAL";
  return e.source === "AGGREGATED" ? "AGGREGATED" : "DIRECT";
}

export function scoreKindLabel(e: EffectiveScore | { source: ScoreSource; state: ScoreState }): string {
  if (e.state === "NOT_ASSESSED") return "Not assessed";
  if (e.source === "AGGREGATED") return e.state === "COMPLETE" ? "Aggregated from subprojects" : "Aggregated · partial coverage";
  return e.state === "COMPLETE" ? "Directly assessed" : "Partially assessed (provisional)";
}
