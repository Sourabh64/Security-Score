import { db } from "@/server/db";
import { computePortfolio } from "@/server/portfolio";
import { heatColumns, heatRows } from "@/server/views";
import { Card, PageHeader } from "@/components/ui";
import { Heatmap } from "@/components/heatmap";

export default async function HeatmapPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const { level } = await searchParams;
  const p = await computePortfolio(db);
  return (
    <div>
      <PageHeader
        title="Security domain heatmap"
        subtitle="Projects or subprojects against the 20 security domains. Color is a single-hue maturity scale (light = Level 1, dark = Level 5) with the score printed in every cell. Hatched cells are not assessed and are never shown as a low score; dots mark domains with no applicable questions."
      />
      <Card>
        <Heatmap rows={heatRows(p)} columns={heatColumns(p)} levelLabels={p.ctx.levelLabels} defaultLevel={level === "sub" || level === "all" ? level : "main"} />
      </Card>
    </div>
  );
}
