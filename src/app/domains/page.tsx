import Link from "next/link";
import { db } from "@/server/db";
import { computePortfolio } from "@/server/portfolio";
import { domainRanking } from "@/server/views";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { ScoreChip } from "@/components/score";
import { SAMM_LABELS, type SammFunction } from "@/lib/constants";

export default async function DomainsPage() {
  const p = await computePortfolio(db);
  const ranking = new Map(domainRanking(p).map((d) => [d.id, d]));
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  return (
    <div>
      <PageHeader title="Security domains" subtitle="The 20 domains of the internal hybrid maturity model, grouped by SAMM-inspired business function. Organization scores weight main projects; unassessed projects are excluded." />
      <Card bodyClassName="p-0">
        <Table>
          <thead>
            <tr>
              <th className="th">#</th><th className="th">Domain</th><th className="th">Function</th><th className="th">Practices / questions</th><th className="th">Weight</th>
              <th className="th">Organization</th>{mains.map((m) => <th key={m.id} className="th">{m.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.framework.map((d, i) => {
              const r = ranking.get(d.id)!;
              return (
                <tr key={d.id}>
                  <td className="td text-xs text-muted">{i + 1}</td>
                  <td className="td"><Link className="link font-medium" href={`/domains/${d.id}`}>{d.name}</Link><div className="font-mono text-[11px] text-muted">{d.key}</div></td>
                  <td className="td"><Badge>{SAMM_LABELS[d.sammFunction as SammFunction]}</Badge></td>
                  <td className="td text-xs">{d.practices.length} / {d.practices.reduce((a, pr) => a + pr.questions.length, 0)}</td>
                  <td className="td text-xs tabular-nums">{d.weight}</td>
                  <td className="td"><ScoreChip score={r.score} size="sm" /><span className="ml-1 text-[11px] text-muted">{r.contributors}/{r.of}</span></td>
                  {mains.map((m) => {
                    const e = p.effective.get(m.id)!;
                    const s = e.score === null ? null : e.domains.find((x) => x.id === d.id)?.score ?? null;
                    return <td key={m.id} className="td"><ScoreChip score={s} size="sm" /></td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
