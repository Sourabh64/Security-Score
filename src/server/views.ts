import "server-only";
import type { Portfolio } from "./portfolio";
import { filterFramework, weightedAverage } from "@/lib/scoring/engine";
import { effectiveCapabilities } from "@/lib/hierarchy";
import { scoreKindLabel } from "@/lib/scoring/format";
import type { HeatColumn, HeatRow } from "@/components/heatmap";

export function applicableDomainIds(p: Portfolio, projectId: string): Set<string> {
  const children = p.activeChildrenOf(projectId);
  if (children.length) {
    const s = new Set<string>();
    for (const c of children) applicableDomainIds(p, c.id).forEach((x) => s.add(x));
    return s;
  }
  const caps = effectiveCapabilities(p.projects, projectId);
  return new Set(filterFramework(p.framework, caps).map((d) => d.id));
}

export function heatColumns(p: Portfolio): HeatColumn[] {
  return p.framework.map((d) => ({ id: d.id, key: d.key, name: d.name, samm: d.sammFunction }));
}

/** Rows for active main projects and their active subprojects (or directly assessed mains). */
export function heatRows(p: Portfolio, opts: { mainIds?: string[] } = {}): HeatRow[] {
  const rows: HeatRow[] = [];
  const mains = p.projects.filter((x) => !x.parentId && !x.archived && (!opts.mainIds || opts.mainIds.includes(x.id)));
  const build = (id: string, level: "main" | "sub", mainId: string, mainLabel: string): HeatRow => {
    const e = p.effective.get(id)!;
    const applicable = applicableDomainIds(p, id);
    const byDomain = new Map(e.domains.map((d) => [d.id, d]));
    const cells: HeatRow["cells"] = {};
    for (const d of p.framework) {
      const ds = byDomain.get(d.id);
      cells[d.id] = { score: e.score === null ? null : ds?.score ?? null, coverage: ds?.coverage ?? 0, applicable: applicable.has(d.id) };
    }
    return { id, label: p.byId.get(id)!.name, level, mainId, mainLabel, overall: e.score, kind: scoreKindLabel(e), cells };
  };
  for (const m of mains) {
    rows.push(build(m.id, "main", m.id, m.name));
    const children = p.activeChildrenOf(m.id);
    if (children.length) for (const c of children) rows.push(build(c.id, "sub", m.id, m.name));
    else rows.push({ ...build(m.id, "sub", m.id, m.name), id: m.id });
  }
  // A directly assessed main project appears in both levels; de-duplicate for the "all" view.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.id}|${r.level}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Organization-level domain ranking (weighted across main projects that scored each domain). */
export function domainRanking(p: Portfolio) {
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  return p.framework
    .map((d) => {
      const items = mains.map((m) => {
        const e = p.effective.get(m.id)!;
        const ds = e.score === null ? undefined : e.domains.find((x) => x.id === d.id);
        return { value: ds?.score ?? null, weight: m.weight };
      });
      return {
        id: d.id,
        key: d.key,
        name: d.name,
        samm: d.sammFunction,
        score: weightedAverage(items),
        contributors: items.filter((i) => i.value !== null).length,
        of: mains.length,
      };
    })
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
}

/** Leaf "scoring units": subprojects of active mains, or the main itself when it has no subprojects. */
export function scoringUnitsByMain(p: Portfolio) {
  const mains = p.projects.filter((x) => !x.parentId && !x.archived);
  return mains.map((m) => {
    const children = p.activeChildrenOf(m.id);
    const units = children.length ? children : [m];
    const states = units.map((u) => p.effective.get(u.id)!.state);
    return {
      main: m,
      units,
      complete: states.filter((s) => s === "COMPLETE").length,
      partial: states.filter((s) => s === "PARTIAL").length,
      unassessed: states.filter((s) => s === "NOT_ASSESSED").length,
    };
  });
}
