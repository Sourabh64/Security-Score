/** Prints current portfolio scores to the console (diagnostic helper). Usage: npx tsx scripts/print-scores.ts */
import { PrismaClient } from "@prisma/client";
import { computePortfolio, collectGaps } from "../src/server/portfolio";
import { formatScore, scoreKindLabel } from "../src/lib/scoring/format";

const db = new PrismaClient();
(async () => {
  const p = await computePortfolio(db);
  const line = (id: string, indent = "") => {
    const pr = p.byId.get(id)!;
    const e = p.effective.get(id)!;
    const agg = e.aggregation ? ` [${e.aggregation.contributingCount}/${e.aggregation.childCount} subprojects contribute]` : "";
    console.log(`${indent}${pr.key.padEnd(10)} ${formatScore(e.score).padStart(12)}  ${scoreKindLabel(e)}  cov=${e.coverage.toFixed(0)}%${agg}${pr.archived ? " (archived)" : ""}`);
    const o = p.oversight.get(id);
    if (o) console.log(`${indent}  oversight score (separate): ${formatScore(o.score)}`);
  };
  for (const m of p.projects.filter((x) => !x.parentId)) {
    line(m.id);
    for (const c of p.childrenOf(m.id)) line(c.id, "   ");
  }
  console.log(`ORG ${formatScore(p.org.score)} ${scoreKindLabel(p.org)} contributing ${p.org.aggregation?.contributingCount}/${p.org.aggregation?.childCount}`);
  console.log(`critical gaps: ${collectGaps(p).length}`);
  await db.$disconnect();
})();
