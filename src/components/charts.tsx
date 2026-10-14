"use client";

import { useRouter } from "next/navigation";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useIsDark } from "./client";
import { LEVEL_HEX, SERIES_HEX, formatScore, impliedLevel } from "@/lib/scoring/format";

const tooltipStyle = {
  contentStyle: {
    background: "rgb(var(--surface))",
    border: "1px solid rgb(var(--line))",
    borderRadius: 6,
    fontSize: 12,
    color: "rgb(var(--fg))",
  },
  labelStyle: { color: "rgb(var(--fg))", fontWeight: 600 },
  itemStyle: { color: "rgb(var(--fg))" },
};
const axisTick = { fill: "currentColor", fontSize: 11 };

export interface BarItem {
  id: string;
  label: string;
  score: number | null;
  href?: string;
  note?: string;
}

/** Horizontal bars, one per entity. Unassessed entities keep their row and are labelled, never drawn as zero. */
export function ScoreBars({ items, height }: { items: BarItem[]; height?: number }) {
  const router = useRouter();
  const dark = useIsDark();
  const ramp = dark ? LEVEL_HEX.dark : LEVEL_HEX.light;
  const data = items.map((i) => ({ ...i, value: i.score ?? 0, display: i.score === null ? "Not assessed" : formatScore(i.score) }));
  const h = height ?? Math.max(120, data.length * 34 + 30);
  return (
    <div className="text-muted" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis type="category" dataKey="label" width={170} tick={axisTick} stroke="currentColor" strokeOpacity={0.3} interval={0} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
            formatter={(_v: number, _n: string, p: { payload?: { display: string; note?: string } }) => [p.payload?.display + (p.payload?.note ? ` · ${p.payload.note}` : ""), "Score"]}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            onClick={(d: { href?: string }) => d?.href && router.push(d.href)}
            className="cursor-pointer"
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.id} fill={d.score === null ? "transparent" : ramp[impliedLevel(d.score) - 1]} />
            ))}
            <LabelList dataKey="display" position="right" fill="currentColor" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TrendSeries {
  key: string;
  label: string;
  points: { date: string; score: number | null }[];
}

/** Score over time (snapshots only). Series colors follow the entity order passed in, never rank. */
export function TrendChart({ series, height = 260 }: { series: TrendSeries[]; height?: number }) {
  const dark = useIsDark();
  const colors = dark ? SERIES_HEX.dark : SERIES_HEX.light;
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const data = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const s of series) {
      const p = s.points.find((x) => x.date === date);
      row[s.key] = p?.score ?? null;
    }
    return row;
  });
  if (!dates.length) return <p className="py-8 text-center text-sm text-muted">No completed assessments yet – trends are built from completed assessment snapshots.</p>;
  return (
    <div className="text-muted" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="date" tick={axisTick} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick} stroke="currentColor" strokeOpacity={0.3} width={36} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} formatter={(v: unknown) => (typeof v === "number" ? formatScore(v) : "Not assessed")} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "rgb(var(--fg))" }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))" as string, fill: colors[i % colors.length] }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface GroupedRow {
  label: string;
  href?: string;
  values: Record<string, number | null>;
}

/** Domain comparison: grouped bars per domain, one fixed color per product (max 4, validated order). */
export function GroupedBars({ rows, seriesKeys, seriesLabels, colorIndex, height }: { rows: GroupedRow[]; seriesKeys: string[]; seriesLabels: Record<string, string>; colorIndex?: Record<string, number>; height?: number }) {
  const router = useRouter();
  const dark = useIsDark();
  const colors = dark ? SERIES_HEX.dark : SERIES_HEX.light;
  const data = rows.map((r) => ({ label: r.label, href: r.href, ...Object.fromEntries(seriesKeys.map((k) => [k, r.values[k] ?? null])) }));
  const h = height ?? Math.max(240, rows.length * (seriesKeys.length * 9 + 14) + 60);
  return (
    <div className="text-muted" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barGap={2} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis type="category" dataKey="label" width={210} tick={axisTick} interval={0} stroke="currentColor" strokeOpacity={0.3} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} formatter={(v: unknown) => (typeof v === "number" ? formatScore(v) : "Not assessed")} />
          <Legend wrapperStyle={{ fontSize: 12, color: "rgb(var(--fg))" }} />
          {seriesKeys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              name={seriesLabels[k]}
              fill={colors[(colorIndex?.[k] ?? i) % colors.length]}
              radius={[0, 4, 4, 0]}
              maxBarSize={8}
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(d: { href?: string }) => d?.href && router.push(d.href)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CoverageRow {
  id: string;
  label: string;
  href?: string;
  complete: number;
  partial: number;
  unassessed: number;
}

/** Assessment coverage: stacked counts of fully / partially / not assessed scoring units per product. */
export function CoverageBars({ rows }: { rows: CoverageRow[] }) {
  const router = useRouter();
  const dark = useIsDark();
  const ramp = dark ? LEVEL_HEX.dark : LEVEL_HEX.light;
  const h = Math.max(140, rows.length * 34 + 60);
  return (
    <div className="text-muted" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis type="number" allowDecimals={false} tick={axisTick} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis type="category" dataKey="label" width={150} tick={axisTick} interval={0} stroke="currentColor" strokeOpacity={0.3} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: "rgb(var(--fg))" }} />
          <Bar dataKey="complete" name="Fully assessed" stackId="a" fill={ramp[4]} stroke="rgb(var(--surface))" strokeWidth={2} maxBarSize={18} isAnimationActive={false} onClick={(d: { href?: string }) => d?.href && router.push(d.href)} className="cursor-pointer" />
          <Bar dataKey="partial" name="Partially assessed" stackId="a" fill={ramp[1]} stroke="rgb(var(--surface))" strokeWidth={2} maxBarSize={18} isAnimationActive={false} onClick={(d: { href?: string }) => d?.href && router.push(d.href)} className="cursor-pointer" />
          <Bar dataKey="unassessed" name="Not assessed" stackId="a" fill={dark ? "#4b5563" : "#cbd0d8"} stroke="rgb(var(--surface))" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} onClick={(d: { href?: string }) => d?.href && router.push(d.href)} className="cursor-pointer" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
