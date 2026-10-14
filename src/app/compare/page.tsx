import Link from "next/link";
import { db } from "@/server/db";
import { computePortfolio } from "@/server/portfolio";
import { Card, PageHeader, Table } from "@/components/ui";
import { ScoreChip, ScoreKindBadge } from "@/components/score";
import { GroupedBars } from "@/components/charts";
import { formatPct } from "@/lib/scoring/format";
import { SAMM_FUNCTIONS, SAMM_LABELS } from "@/lib/constants";
import { weightedAverage } from "@/lib/scoring/engine";

const MAX_SERIES = 4;

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const sp = await searchParams;
  const p = await computePortfolio(db);
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  const requested = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).filter((id) => mains.some((m) => m.id === id));
  // Series colors follow the entity's fixed position in the project list, not its rank or selection order.
  const selected = (requested.length ? mains.filter((m) => requested.includes(m.id)) : mains).slice(0, MAX_SERIES);
  const keys = selected.map((m) => m.id);
  const labels = Object.fromEntries(selected.map((m) => [m.id, m.name]));
  const domScore = (pid: string, did: string) => {
    const e = p.effective.get(pid)!;
    return e.score === null ? null : e.domains.find((d) => d.id === did)?.score ?? null;
  };
  const rows = p.framework.map((d) => ({ label: d.name, href: `/domains/${d.id}`, id: d.id, values: Object.fromEntries(keys.map((k) => [k, domScore(k, d.id)])) }));
  const sammRows = SAMM_FUNCTIONS.map((f) => ({
    f,
    values: Object.fromEntries(keys.map((k) => [k, weightedAverage(p.framework.filter((d) => d.sammFunction === f).map((d) => ({ value: domScore(k, d.id), weight: d.weight })))])),
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Compare products" subtitle="Side-by-side maturity of main projects by domain. Up to four products at once so colors remain distinguishable; a full data table follows the chart." />
      <Card>
        <form method="get" className="flex flex-wrap items-center gap-4">
          {mains.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ids" value={m.id} defaultChecked={keys.includes(m.id)} />
              {m.name}
            </label>
          ))}
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Compare</button>
          {mains.length > MAX_SERIES && <span className="text-xs text-muted">Max {MAX_SERIES} products per comparison.</span>}
        </form>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {selected.map((m) => {
          const e = p.effective.get(m.id)!;
          return (
            <Card key={m.id}>
              <Link href={`/projects/${m.id}`} className="font-semibold hover:underline">{m.name}</Link>
              <div className="mt-2 flex items-center gap-3"><ScoreChip score={e.score} size="lg" /><ScoreKindBadge source={e.source} state={e.state} /></div>
              <p className="mt-2 text-xs text-muted">
                {e.aggregation ? `${e.aggregation.contributingCount}/${e.aggregation.childCount} subprojects contribute · ${formatPct(e.aggregation.weightCoverage)} of weight` : `${formatPct(e.coverage)} scored coverage`}
              </p>
            </Card>
          );
        })}
      </div>

      <Card title="Domain comparison" subtitle="Click a bar group to open the domain dashboard. Missing bars mean not assessed (never zero).">
        <GroupedBars rows={rows} seriesKeys={keys} seriesLabels={labels} colorIndex={Object.fromEntries(mains.map((m, i) => [m.id, i]))} />
      </Card>

      <Card title="SAMM-inspired function summary" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Function</th>{selected.map((m) => <th key={m.id} className="th">{m.name}</th>)}</tr></thead>
          <tbody>
            {sammRows.map((r) => (
              <tr key={r.f}><td className="td font-medium">{SAMM_LABELS[r.f]}</td>{keys.map((k) => <td key={k} className="td"><ScoreChip score={r.values[k]} size="sm" /></td>)}</tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Data table" bodyClassName="p-0">
        <Table>
          <thead><tr><th className="th">Domain</th>{selected.map((m) => <th key={m.id} className="th">{m.name}</th>)}<th className="th">Spread</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const vals = keys.map((k) => r.values[k]).filter((v): v is number => v !== null);
              return (
                <tr key={r.id}>
                  <td className="td"><Link className="link" href={r.href}>{r.label}</Link></td>
                  {keys.map((k) => <td key={k} className="td"><ScoreChip score={r.values[k]} size="sm" /></td>)}
                  <td className="td text-xs text-muted tabular-nums">{vals.length > 1 ? (Math.max(...vals) - Math.min(...vals)).toFixed(1) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
