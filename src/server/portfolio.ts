import type { Db, Tx } from "./db";
import {
  evaluateOrganization,
  evaluateProject,
  filterFramework,
  scoreAssessment,
  type AssessmentScore,
  type EffectiveScore,
  type FwDomain,
  type HierarchyNode,
  type ResponseInput,
} from "@/lib/scoring/engine";
import { effectiveCapabilities } from "@/lib/hierarchy";
import { getScoringContext, loadFrameworkTree, toEngineFramework, type ScoringContext } from "./framework";
import type { ResponseStatus } from "@/lib/constants";
import { notFound } from "./errors";

export const SNAPSHOT_STATUSES = ["COMPLETED", "REVIEWED"];

export function parseSnapshot(breakdown: string): AssessmentScore {
  return JSON.parse(breakdown) as AssessmentScore;
}

export function responsesToMap(
  rows: { questionId: string; status: string; level: number | null; carriedForward: boolean; confirmed: boolean }[],
): Record<string, ResponseInput> {
  const map: Record<string, ResponseInput> = {};
  for (const r of rows)
    map[r.questionId] = { status: r.status as ResponseStatus, level: r.level, carriedForward: r.carriedForward, confirmed: r.confirmed };
  return map;
}

/** Applicable framework for a project (applicability rules applied using inherited capabilities). */
export async function applicableFrameworkFor(db: Db | Tx, projectId: string, fw?: FwDomain[]) {
  const projects = await db.project.findMany({ select: { id: true, parentId: true, capabilities: true } });
  if (!projects.some((p) => p.id === projectId)) throw notFound("Project");
  const framework = fw ?? toEngineFramework(await loadFrameworkTree(db));
  const caps = effectiveCapabilities(projects, projectId);
  return { framework: filterFramework(framework, caps), capabilities: caps };
}

/** Live score of a (typically draft) assessment from its current responses and the current framework. */
export async function scoreAssessmentLive(db: Db | Tx, assessmentId: string, ctx?: ScoringContext) {
  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: { responses: { select: { questionId: true, status: true, level: true, carriedForward: true, confirmed: true } } },
  });
  if (!assessment) throw notFound("Assessment");
  const context = ctx ?? (await getScoringContext(db));
  const { framework } = await applicableFrameworkFor(db, assessment.projectId);
  const score = scoreAssessment(framework, responsesToMap(assessment.responses), {
    anchors: context.anchors,
    minCoverage: context.minCoverage,
  });
  return { assessment, score, framework };
}

/** Score of an assessment: immutable snapshot when completed/reviewed/rejected, live otherwise. */
export async function scoreForAssessment(db: Db | Tx, assessmentId: string, ctx?: ScoringContext) {
  const snap = await db.scoreSnapshot.findUnique({ where: { assessmentId } });
  if (snap) return { score: parseSnapshot(snap.breakdown), basis: "SNAPSHOT" as const, snapshot: snap };
  const live = await scoreAssessmentLive(db, assessmentId, ctx);
  return { score: live.score, basis: "LIVE" as const, snapshot: null };
}

export interface BasisInfo {
  assessmentId: string;
  title: string;
  status: string;
  type: string;
  assessmentDate: Date;
  basis: "LIVE" | "SNAPSHOT";
}

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  archived: boolean;
  weight: number;
  criticality: string;
  lifecycleStatus: string;
  capabilities: string;
  tags: string;
  productOwner: string;
  securityOwner: string;
  technicalOwner: string;
  description: string;
  weightRationale: string;
  createdAt: Date;
}

export interface Portfolio {
  ctx: ScoringContext;
  framework: FwDomain[];
  projects: ProjectRow[];
  byId: Map<string, ProjectRow>;
  childrenOf: (id: string) => ProjectRow[];
  activeChildrenOf: (id: string) => ProjectRow[];
  direct: Map<string, AssessmentScore | null>;
  basis: Map<string, BasisInfo | null>;
  effective: Map<string, EffectiveScore>;
  oversight: Map<string, AssessmentScore | null>;
  org: EffectiveScore;
  lastAssessment: Map<string, Date | null>;
  /** projects whose own direct score feeds the hierarchy (active, no active children, active ancestry) */
  scoringProjectIds: string[];
}

/**
 * Computes current scores for every project and the organization in one pass.
 * Drafts are scored live from responses; completed assessments come from their immutable snapshot.
 */
export async function computePortfolio(db: Db | Tx): Promise<Portfolio> {
  const ctx = await getScoringContext(db);
  const tree = await loadFrameworkTree(db);
  const framework = toEngineFramework(tree);
  const projects = (await db.project.findMany({ orderBy: [{ name: "asc" }] })) as ProjectRow[];
  const byId = new Map(projects.map((p) => [p.id, p]));

  const allowed = ctx.scoreBasis === "COMPLETED_ONLY" ? SNAPSHOT_STATUSES : ["DRAFT", "IN_PROGRESS", ...SNAPSHOT_STATUSES];
  const assessments = await db.assessment.findMany({
    where: { status: { in: allowed } },
    orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, projectId: true, status: true, title: true, type: true, assessmentDate: true, snapshot: { select: { breakdown: true } } },
  });
  const lastAssessmentRows = await db.assessment.groupBy({ by: ["projectId"], _max: { assessmentDate: true } });
  const lastAssessment = new Map<string, Date | null>(lastAssessmentRows.map((r) => [r.projectId, r._max.assessmentDate]));

  const basisAssessment = new Map<string, (typeof assessments)[number]>();
  for (const a of assessments) if (!basisAssessment.has(a.projectId)) basisAssessment.set(a.projectId, a);

  const liveIds = [...basisAssessment.values()].filter((a) => !a.snapshot).map((a) => a.id);
  const liveResponses = liveIds.length
    ? await db.assessmentResponse.findMany({
        where: { assessmentId: { in: liveIds } },
        select: { assessmentId: true, questionId: true, status: true, level: true, carriedForward: true, confirmed: true },
      })
    : [];
  const responsesByAssessment = new Map<string, typeof liveResponses>();
  for (const r of liveResponses) {
    if (!responsesByAssessment.has(r.assessmentId)) responsesByAssessment.set(r.assessmentId, []);
    responsesByAssessment.get(r.assessmentId)!.push(r);
  }

  const direct = new Map<string, AssessmentScore | null>();
  const basis = new Map<string, BasisInfo | null>();
  for (const p of projects) {
    const a = basisAssessment.get(p.id);
    if (!a) {
      direct.set(p.id, null);
      basis.set(p.id, null);
      continue;
    }
    if (a.snapshot) {
      direct.set(p.id, parseSnapshot(a.snapshot.breakdown));
    } else {
      const caps = effectiveCapabilities(projects, p.id);
      direct.set(
        p.id,
        scoreAssessment(filterFramework(framework, caps), responsesToMap(responsesByAssessment.get(a.id) ?? []), {
          anchors: ctx.anchors,
          minCoverage: ctx.minCoverage,
        }),
      );
    }
    basis.set(p.id, {
      assessmentId: a.id,
      title: a.title,
      status: a.status,
      type: a.type,
      assessmentDate: a.assessmentDate,
      basis: a.snapshot ? "SNAPSHOT" : "LIVE",
    });
  }

  const nodes: HierarchyNode[] = projects.map((p) => ({ id: p.id, name: p.name, weight: p.weight, archived: p.archived, parentId: p.parentId }));
  const { org } = evaluateOrganization(nodes, direct);
  const effective = new Map<string, EffectiveScore>();
  const oversight = new Map<string, AssessmentScore | null>();
  for (const p of projects) {
    const r = evaluateProject(nodes.find((n) => n.id === p.id)!, nodes, direct);
    effective.set(p.id, r.effective);
    oversight.set(p.id, r.oversight);
  }

  const childrenOf = (id: string) => projects.filter((p) => p.parentId === id);
  const activeChildrenOf = (id: string) => projects.filter((p) => p.parentId === id && !p.archived);
  const isActiveChain = (p: ProjectRow): boolean => !p.archived && (!p.parentId || isActiveChain(byId.get(p.parentId)!));
  const scoringProjectIds = projects.filter((p) => isActiveChain(p) && activeChildrenOf(p.id).length === 0).map((p) => p.id);

  return { ctx, framework, projects, byId, childrenOf, activeChildrenOf, direct, basis, effective, oversight, org, lastAssessment, scoringProjectIds };
}

export interface Gap {
  projectId: string;
  projectName: string;
  mainProjectId: string;
  mainProjectName: string;
  assessmentId: string;
  domainId: string;
  domainName: string;
  practiceId: string;
  practiceName: string;
  questionId: string;
  questionKey: string;
  title: string;
  level: number;
  score: number;
  criticality: string;
}

/**
 * Critical gaps: scored answers at or below the configured maturity level on HIGH/CRITICAL questions,
 * taken from the assessments that currently drive scores (oversight answers are excluded).
 */
export function collectGaps(p: Portfolio, opts: { projectIds?: string[]; includeAllCriticalities?: boolean } = {}): Gap[] {
  const ids = opts.projectIds ? p.scoringProjectIds.filter((id) => opts.projectIds!.includes(id)) : p.scoringProjectIds;
  const gaps: Gap[] = [];
  for (const id of ids) {
    const s = p.direct.get(id);
    const b = p.basis.get(id);
    if (!s || !b) continue;
    const proj = p.byId.get(id)!;
    const main = proj.parentId ? p.byId.get(proj.parentId)! : proj;
    for (const d of s.domains)
      for (const pr of d.practices)
        for (const q of pr.questions) {
          if (q.level === null || q.score === null) continue;
          if (q.level > p.ctx.criticalGapMaxLevel) continue;
          if (!opts.includeAllCriticalities && q.criticality !== "HIGH" && q.criticality !== "CRITICAL") continue;
          gaps.push({
            projectId: id,
            projectName: proj.name,
            mainProjectId: main.id,
            mainProjectName: main.name,
            assessmentId: b.assessmentId,
            domainId: d.id,
            domainName: d.name,
            practiceId: pr.id,
            practiceName: pr.name,
            questionId: q.id,
            questionKey: q.key,
            title: q.title,
            level: q.level,
            score: q.score,
            criticality: q.criticality,
          });
        }
  }
  const critRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return gaps.sort((a, b) => critRank[a.criticality] - critRank[b.criticality] || a.level - b.level || a.projectName.localeCompare(b.projectName));
}

/** Projects within a main project's subtree (itself and descendants). */
export function subtreeIds(p: Portfolio, rootId: string): string[] {
  const out = [rootId];
  for (const c of p.childrenOf(rootId)) out.push(...subtreeIds(p, c.id));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Trends from immutable snapshots
// ---------------------------------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  score: number | null;
  coverage: number;
}

/**
 * Historical trend computed exclusively from completed assessment snapshots.
 * For each date, every project uses its latest snapshot on or before that date and the
 * current hierarchy rules are applied (parents aggregate subprojects, org aggregates mains).
 */
export async function computeTrends(db: Db | Tx, p: Portfolio) {
  const snaps = await db.scoreSnapshot.findMany({
    where: { assessment: { status: { in: SNAPSHOT_STATUSES } } },
    orderBy: { assessmentDate: "asc" },
    select: { projectId: true, assessmentDate: true, breakdown: true },
  });
  const parsed = snaps.map((s) => ({ projectId: s.projectId, date: s.assessmentDate.toISOString().slice(0, 10), score: parseSnapshot(s.breakdown) }));
  const dates = [...new Set(parsed.map((s) => s.date))].sort();
  const nodes: HierarchyNode[] = p.projects.map((x) => ({ id: x.id, name: x.name, weight: x.weight, archived: x.archived, parentId: x.parentId }));

  const orgSeries: TrendPoint[] = [];
  const projectSeries = new Map<string, TrendPoint[]>();
  const relevantDates = new Map<string, Set<string>>();
  for (const s of parsed) {
    let cur: ProjectRow | undefined = p.byId.get(s.projectId);
    while (cur) {
      if (!relevantDates.has(cur.id)) relevantDates.set(cur.id, new Set());
      relevantDates.get(cur.id)!.add(s.date);
      cur = cur.parentId ? p.byId.get(cur.parentId) : undefined;
    }
  }

  for (const date of dates) {
    const asOf = new Map<string, AssessmentScore | null>();
    for (const s of parsed) if (s.date <= date) asOf.set(s.projectId, s.score); // ascending order -> latest wins
    const { org } = evaluateOrganization(nodes, asOf);
    orgSeries.push({ date, score: org.score, coverage: org.aggregation?.weightCoverage ?? 0 });
    for (const proj of p.projects) {
      if (!relevantDates.get(proj.id)?.has(date)) continue;
      const eff = evaluateProject(nodes.find((n) => n.id === proj.id)!, nodes, asOf).effective;
      if (!projectSeries.has(proj.id)) projectSeries.set(proj.id, []);
      projectSeries.get(proj.id)!.push({ date, score: eff.score, coverage: eff.source === "AGGREGATED" ? eff.aggregation?.weightCoverage ?? 0 : eff.coverage });
    }
  }
  return { org: orgSeries, byProject: projectSeries };
}
