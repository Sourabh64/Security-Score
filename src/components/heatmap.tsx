"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LEVEL_COLORS, formatPct, formatScore, impliedLevel } from "@/lib/scoring/format";
import { SAMM_FUNCTIONS, SAMM_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface HeatColumn {
  id: string;
  key: string;
  name: string;
  samm: string;
}
export interface HeatRow {
  id: string;
  label: string;
  level: "main" | "sub";
  mainId: string;
  mainLabel: string;
  overall: number | null;
  kind: string;
  cells: Record<string, { score: number | null; coverage: number; applicable: boolean } | undefined>;
}

export function Heatmap({ rows, columns, levelLabels, defaultLevel = "main", compact = false }: {
  rows: HeatRow[];
  columns: HeatColumn[];
  levelLabels: Record<number, string>;
  defaultLevel?: "main" | "sub" | "all";
  compact?: boolean;
}) {
  const router = useRouter();
  const [level, setLevel] = useState<"main" | "sub" | "all">(defaultLevel);
  const [main, setMain] = useState("ALL");
  const [samm, setSamm] = useState("ALL");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hover, setHover] = useState<{ row: HeatRow; col: HeatColumn; x: number; y: number } | null>(null);

  const mains = useMemo(() => [...new Map(rows.map((r) => [r.mainId, r.mainLabel])).entries()], [rows]);
  const cols = columns.filter((c) => samm === "ALL" || c.samm === samm);
  const visible = rows.filter(
    (r) =>
      (level === "all" || r.level === level) &&
      (main === "ALL" || r.mainId === main) &&
      (!hideEmpty || r.overall !== null),
  );

  return (
    <div className="relative">
      {!compact && (
        <div className="no-print mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="label">Rows</span>
            <select className="input !py-1" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
              <option value="main">Main projects</option>
              <option value="sub">Subprojects &amp; directly assessed</option>
              <option value="all">All levels</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="label">Product</span>
            <select className="input !py-1" value={main} onChange={(e) => setMain(e.target.value)}>
              <option value="ALL">All products</option>
              {mains.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="label">SAMM-inspired function</span>
            <select className="input !py-1" value={samm} onChange={(e) => setSamm(e.target.value)}>
              <option value="ALL">All functions</option>
              {SAMM_FUNCTIONS.map((f) => <option key={f} value={f}>{SAMM_LABELS[f]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
            Hide unassessed rows
          </label>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[190px] bg-surface px-2 text-left text-xs font-semibold text-muted">Project</th>
              <th className="px-1 text-xs font-semibold text-muted">Overall</th>
              {cols.map((c) => (
                <th key={c.id} className="h-36 w-10 align-bottom">
                  <Link href={`/domains/${c.id}`} title={c.name} className="mx-auto block w-6 whitespace-nowrap text-left text-[11px] font-medium text-muted hover:text-accent" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                    {c.key} · {c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <th className="sticky left-0 z-10 bg-surface px-2 py-1 text-left text-sm font-normal">
                  <Link href={`/projects/${r.id}`} className={cn("hover:text-accent hover:underline", r.level === "main" ? "font-semibold" : "pl-3")}>
                    {r.label}
                  </Link>
                  {r.level === "sub" && <div className="pl-3 text-[11px] text-muted">{r.mainLabel}</div>}
                </th>
                <Cell score={r.overall} onClick={() => router.push(`/projects/${r.id}`)} label={`${r.label} overall: ${formatScore(r.overall)} (${r.kind})`} bold />
                {cols.map((c) => {
                  const cell = r.cells[c.id];
                  if (!cell || !cell.applicable)
                    return <td key={c.id} className="h-8 w-10 rounded text-center text-[10px] text-muted/60" title={`${c.name}: not applicable to ${r.label}`}>·</td>;
                  return (
                    <Cell
                      key={c.id}
                      score={cell.score}
                      label={`${r.label} – ${c.name}: ${formatScore(cell.score)}`}
                      onClick={() => router.push(`/projects/${r.id}#domain-${c.id}`)}
                      onHover={(e) => setHover({ row: r, col: c, x: e.clientX, y: e.clientY })}
                      onLeave={() => setHover(null)}
                    />
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="py-6 text-center text-sm text-muted">No rows match the filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Legend levelLabels={levelLabels} />

      {hover && (
        <div className="pointer-events-none fixed z-50 w-64 rounded-md border border-line bg-surface p-3 text-xs shadow-lg" style={{ left: Math.min(hover.x + 14, window.innerWidth - 270), top: hover.y + 14 }}>
          <div className="font-semibold">{hover.row.label}</div>
          <div className="text-muted">{hover.col.key} · {hover.col.name}</div>
          {(() => {
            const cell = hover.row.cells[hover.col.id];
            if (!cell || cell.score === null) return <div className="mt-2">Not assessed – no scored answers in this domain. Shown with a hatched pattern, never as zero.</div>;
            const lvl = impliedLevel(cell.score);
            return (
              <div className="mt-2 space-y-0.5">
                <div>Score <b>{formatScore(cell.score)}</b> (Level {lvl} – {levelLabels[lvl]})</div>
                <div>Scored coverage {formatPct(cell.coverage)}</div>
                <div className="text-muted">Click for project drill-down</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Cell({ score, onClick, onHover, onLeave, label, bold }: {
  score: number | null; onClick: () => void; onHover?: (e: React.MouseEvent) => void; onLeave?: () => void; label: string; bold?: boolean;
}) {
  const c = score === null ? null : LEVEL_COLORS[impliedLevel(score)];
  return (
    <td className="p-0">
      <button
        type="button"
        onClick={onClick}
        onMouseMove={onHover}
        onMouseLeave={onLeave}
        onFocus={(e) => onHover?.({ clientX: e.currentTarget.getBoundingClientRect().right, clientY: e.currentTarget.getBoundingClientRect().bottom } as React.MouseEvent)}
        onBlur={onLeave}
        aria-label={label}
        title={onHover ? undefined : label}
        className={cn("flex h-8 w-10 items-center justify-center rounded text-[11px] tabular-nums transition hover:ring-2 hover:ring-accent", !c && "cell-unassessed text-muted", bold && "w-12 font-semibold")}
        style={c ? { background: c.bg, color: c.fg } : undefined}
      >
        {score === null ? "–" : formatScore(score, 0)}
      </button>
    </td>
  );
}

export function Legend({ levelLabels }: { levelLabels: Record<number, string> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
      {[1, 2, 3, 4, 5].map((l) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded" style={{ background: LEVEL_COLORS[l].bg }} />
          L{l} {levelLabels[l]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="cell-unassessed inline-block h-3.5 w-5 rounded border border-line" />
        Not assessed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-5 text-center">·</span> Not applicable
      </span>
    </div>
  );
}
