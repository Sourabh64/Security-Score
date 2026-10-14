import type { Db, Tx } from "./db";
import type { FwDomain } from "@/lib/scoring/engine";
import { parseList } from "@/lib/hierarchy";
import { DEFAULT_ANCHORS, DEFAULT_LEVEL_LABELS, type ScoreBasis } from "@/lib/constants";
import type { Actor } from "./permissions";

export interface ScoringContext {
  anchors: Record<number, number>;
  levelLabels: Record<number, string>;
  minCoverage: number;
  scoreBasis: ScoreBasis;
  criticalGapMaxLevel: number;
  orgSummaryDecimals: number;
  includeArchivedInReports: boolean;
  frameworkVersion: number;
  orgName: string;
  appTitle: string;
  slaDays: Record<string, number>;
}

export async function getScoringContext(db: Db | Tx): Promise<ScoringContext> {
  const [settings, levels] = await Promise.all([db.organizationSettings.findUnique({ where: { id: 1 } }), db.maturityLevel.findMany()]);
  const anchors: Record<number, number> = { ...DEFAULT_ANCHORS };
  const levelLabels: Record<number, string> = { ...DEFAULT_LEVEL_LABELS };
  for (const l of levels) {
    anchors[l.level] = l.anchor;
    levelLabels[l.level] = l.label;
  }
  let slaDays: Record<string, number> = { CRITICAL: 30, HIGH: 60, MEDIUM: 90, LOW: 180 };
  try {
    if (settings?.remediationSlaDays) slaDays = { ...slaDays, ...JSON.parse(settings.remediationSlaDays) };
  } catch {
    /* keep defaults */
  }
  return {
    anchors,
    levelLabels,
    minCoverage: settings?.minCoverageForScore ?? 10,
    scoreBasis: (settings?.scoreBasis as ScoreBasis) ?? "LATEST",
    criticalGapMaxLevel: settings?.criticalGapMaxLevel ?? 2,
    orgSummaryDecimals: settings?.orgSummaryDecimals ?? 0,
    includeArchivedInReports: settings?.includeArchivedInReports ?? false,
    frameworkVersion: settings?.frameworkVersion ?? 1,
    orgName: settings?.orgName ?? "Your Organization",
    appTitle: settings?.appTitle ?? "Product Security Maturity Hub",
    slaDays,
  };
}

/** Loads the full framework tree with each question's CURRENT version. */
export async function loadFrameworkTree(db: Db | Tx, opts: { includeInactive?: boolean; withOptions?: boolean } = {}) {
  const activeFilter = opts.includeInactive ? {} : { active: true };
  const domains = await db.securityDomain.findMany({
    where: activeFilter,
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      practices: {
        where: activeFilter,
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: {
          questions: {
            where: activeFilter,
            orderBy: [{ order: "asc" }, { key: "asc" }],
            include: { versions: { include: { options: opts.withOptions ? { orderBy: { level: "asc" } } : false } } },
          },
        },
      },
    },
  });
  return domains.map((d) => ({
    ...d,
    practices: d.practices.map((p) => ({
      ...p,
      questions: p.questions.map((q) => {
        const current = q.versions.find((v) => v.version === q.currentVersion) ?? q.versions[q.versions.length - 1];
        return { ...q, current, versions: undefined };
      }),
    })),
  }));
}
export type FrameworkTree = Awaited<ReturnType<typeof loadFrameworkTree>>;

/** Converts the framework tree into the pure engine structure. */
export function toEngineFramework(tree: FrameworkTree): FwDomain[] {
  return tree.map((d) => ({
    id: d.id,
    key: d.key,
    name: d.name,
    sammFunction: d.sammFunction,
    weight: d.weight,
    practices: d.practices.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      weight: p.weight,
      questions: p.questions
        .filter((q) => q.current)
        .map((q) => ({
          id: q.id,
          key: q.key,
          title: q.current!.title,
          weight: q.current!.weight,
          criticality: q.current!.criticality,
          mandatory: q.current!.mandatory,
          applicabilityTags: parseList(q.current!.applicabilityTags).map((t) => t.toLowerCase()),
        })),
    })),
  }));
}

/** Records a framework change and increments the framework version. */
export async function bumpFrameworkVersion(tx: Tx, actor: Actor | null, summary: string): Promise<number> {
  const settings = await tx.organizationSettings.findUnique({ where: { id: 1 } });
  const next = (settings?.frameworkVersion ?? 1) + 1;
  await tx.organizationSettings.update({ where: { id: 1 }, data: { frameworkVersion: next } });
  await tx.frameworkVersion.create({
    data: { version: next, label: `v${next}`, changeSummary: summary.slice(0, 500), createdBy: actor?.name ?? "system" },
  });
  return next;
}
