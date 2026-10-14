/**
 * Product Security Maturity Hub - scoring engine.
 *
 * Pure functions with no database access so they can be unit tested and reused by the
 * seed script, the API layer and the exporters. The rules implemented here:
 *
 *  1. An answered question scores the anchor of its selected maturity level (default 10/30/50/75/100).
 *  2. Practice score = weighted average of its ANSWERED questions (question weights, normalised).
 *  3. Domain score   = weighted average of its practices that have a score (practice weights, normalised).
 *  4. Project score  = weighted average of its domains that have a score (domain weights, normalised).
 *  5. Unanswered, "Unable to determine" and "Evidence missing" questions never contribute a value
 *     (they are NOT treated as zero); they reduce coverage instead.
 *  6. N/A questions are removed from the denominator of coverage and reported separately.
 *  7. A score is only "sufficient" when scored coverage >= minCoverage; otherwise "Not assessed".
 *  8. Parent projects with active subprojects are scored ONLY from the subprojects (no double counting);
 *     any parent-level oversight assessment is reported separately.
 *  9. Organization score = weighted average of main projects that have a sufficient score; unassessed
 *     projects are excluded from the average and reported as a coverage gap.
 */

import type { ResponseStatus } from "../constants";

export interface FwQuestion {
  id: string;
  key: string;
  title: string;
  weight: number;
  criticality: string;
  mandatory: boolean;
  applicabilityTags: string[];
}
export interface FwPractice {
  id: string;
  key: string;
  name: string;
  weight: number;
  questions: FwQuestion[];
}
export interface FwDomain {
  id: string;
  key: string;
  name: string;
  sammFunction: string;
  weight: number;
  practices: FwPractice[];
}

export interface ResponseInput {
  status: ResponseStatus;
  level: number | null;
  carriedForward?: boolean;
  confirmed?: boolean;
}

export interface ScoreConfig {
  /** maturity level -> score on the 1..100 scale */
  anchors: Record<number, number>;
  /** minimum scored coverage percentage (0..100) required for a score to be reported */
  minCoverage: number;
}

export interface Tally {
  total: number;
  scored: number;
  na: number;
  unable: number;
  evidenceMissing: number;
  unanswered: number;
  /** questions with any recorded status (answered, N/A, unable, evidence missing) / total, percent */
  completion: number;
  /** scored questions / (total - N/A), percent */
  coverage: number;
}

export interface QuestionResult {
  id: string;
  key: string;
  title: string;
  status: ResponseStatus;
  level: number | null;
  score: number | null;
  weight: number;
  normalizedWeight: number;
  criticality: string;
}

export interface PracticeResult extends Tally {
  id: string;
  key: string;
  name: string;
  weight: number;
  normalizedWeight: number;
  score: number | null;
  questions: QuestionResult[];
}

export interface DomainResult extends Tally {
  id: string;
  key: string;
  name: string;
  sammFunction: string;
  weight: number;
  normalizedWeight: number;
  score: number | null;
  practices: PracticeResult[];
}

export type ScoreState = "COMPLETE" | "PARTIAL" | "NOT_ASSESSED";

export interface AssessmentScore extends Tally {
  /** null when not assessed or below the coverage threshold */
  score: number | null;
  /** score from assessed items even if below threshold (for transparency only) */
  rawScore: number | null;
  belowThreshold: boolean;
  state: ScoreState;
  unconfirmedCarriedForward: number;
  domains: DomainResult[];
}

const EPS = 1e-9;

export class WeightError extends Error {}

/** Validates a weight value. Weights must be finite numbers between 0 and 100. */
export function assertValidWeight(w: number, label = "weight"): void {
  if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100) {
    throw new WeightError(`Invalid ${label}: ${w}. Weights must be numbers between 0 and 100.`);
  }
}

/**
 * Normalises weights so they sum to 1. Returns zeros if the total weight is zero
 * (callers treat that as "no contribution" and avoid division by zero).
 */
export function normalizeWeights(weights: number[]): number[] {
  weights.forEach((w) => assertValidWeight(w));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= EPS) return weights.map(() => 0);
  return weights.map((w) => w / total);
}

/** Weighted average over items with a non-null value. Returns null if nothing contributes. */
export function weightedAverage(items: { value: number | null; weight: number }[]): number | null {
  const present = items.filter((i) => i.value !== null && i.value !== undefined && Number.isFinite(i.value));
  if (present.length === 0) return null;
  const norm = normalizeWeights(present.map((p) => p.weight));
  if (norm.every((n) => n === 0)) return null;
  return present.reduce((acc, p, idx) => acc + (p.value as number) * norm[idx], 0);
}

function pct(n: number, d: number): number {
  return d <= 0 ? 0 : (n / d) * 100;
}

function emptyTally(): Omit<Tally, "completion" | "coverage"> {
  return { total: 0, scored: 0, na: 0, unable: 0, evidenceMissing: 0, unanswered: 0 };
}

function finishTally(t: Omit<Tally, "completion" | "coverage">): Tally {
  const responded = t.total - t.unanswered;
  return { ...t, completion: pct(responded, t.total), coverage: pct(t.scored, t.total - t.na) };
}

function addTally(a: Omit<Tally, "completion" | "coverage">, b: Tally) {
  a.total += b.total;
  a.scored += b.scored;
  a.na += b.na;
  a.unable += b.unable;
  a.evidenceMissing += b.evidenceMissing;
  a.unanswered += b.unanswered;
}

export function anchorFor(level: number, anchors: Record<number, number>): number {
  const a = anchors[level];
  if (a === undefined || !Number.isFinite(a)) throw new Error(`No anchor score configured for maturity level ${level}`);
  return a;
}

/**
 * Applicability: a question applies when it has no applicability tags, or when at least one of its
 * tags is present in the project's effective capability set (own + inherited from parent).
 */
export function isApplicable(questionTags: string[], capabilities: string[]): boolean {
  if (!questionTags.length) return true;
  const caps = new Set(capabilities.map((c) => c.trim().toLowerCase()).filter(Boolean));
  return questionTags.some((t) => caps.has(t.trim().toLowerCase()));
}

/** Returns the subset of the framework applicable to a project, dropping empty practices/domains. */
export function filterFramework(domains: FwDomain[], capabilities: string[]): FwDomain[] {
  return domains
    .map((d) => ({
      ...d,
      practices: d.practices
        .map((p) => ({ ...p, questions: p.questions.filter((q) => isApplicable(q.applicabilityTags, capabilities)) }))
        .filter((p) => p.questions.length > 0),
    }))
    .filter((d) => d.practices.length > 0);
}

/** Calculates the score of a single assessment against an (already applicability-filtered) framework. */
export function scoreAssessment(
  framework: FwDomain[],
  responses: Record<string, ResponseInput | undefined>,
  config: ScoreConfig,
): AssessmentScore {
  const overall = emptyTally();
  let unconfirmed = 0;

  const domains: DomainResult[] = framework.map((d) => {
    const dt = emptyTally();
    const practices: PracticeResult[] = d.practices.map((p) => {
      const pt = emptyTally();
      const qResults: QuestionResult[] = p.questions.map((q) => {
        assertValidWeight(q.weight, `weight of question ${q.key}`);
        const r = responses[q.id];
        const status: ResponseStatus = r?.status ?? "UNANSWERED";
        pt.total++;
        let score: number | null = null;
        let level: number | null = null;
        switch (status) {
          case "ANSWERED":
            if (r?.level == null) {
              // Defensive: an "answered" row without a level is treated as unanswered, never as zero.
              pt.unanswered++;
              break;
            }
            level = r.level;
            score = anchorFor(r.level, config.anchors);
            pt.scored++;
            if (r.carriedForward && !r.confirmed) unconfirmed++;
            break;
          case "NOT_APPLICABLE":
            pt.na++;
            break;
          case "UNABLE_TO_DETERMINE":
            pt.unable++;
            break;
          case "EVIDENCE_MISSING":
            pt.evidenceMissing++;
            break;
          default:
            pt.unanswered++;
        }
        return {
          id: q.id,
          key: q.key,
          title: q.title,
          status: level === null && status === "ANSWERED" ? "UNANSWERED" : status,
          level,
          score,
          weight: q.weight,
          normalizedWeight: 0,
          criticality: q.criticality,
        };
      });
      const scoredQs = qResults.filter((q) => q.score !== null);
      const qNorm = normalizeWeights(scoredQs.map((q) => q.weight));
      scoredQs.forEach((q, i) => (q.normalizedWeight = qNorm[i]));
      assertValidWeight(p.weight, `weight of practice ${p.key}`);
      const pTally = finishTally(pt);
      addTally(dt, pTally);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        weight: p.weight,
        normalizedWeight: 0,
        score: weightedAverage(scoredQs.map((q) => ({ value: q.score, weight: q.weight }))),
        questions: qResults,
        ...pTally,
      };
    });
    const scoredPs = practices.filter((p) => p.score !== null);
    const pNorm = normalizeWeights(scoredPs.map((p) => p.weight));
    scoredPs.forEach((p, i) => (p.normalizedWeight = pNorm[i]));
    assertValidWeight(d.weight, `weight of domain ${d.key}`);
    const dTally = finishTally(dt);
    addTally(overall, dTally);
    return {
      id: d.id,
      key: d.key,
      name: d.name,
      sammFunction: d.sammFunction,
      weight: d.weight,
      normalizedWeight: 0,
      score: weightedAverage(scoredPs.map((p) => ({ value: p.score, weight: p.weight }))),
      practices,
      ...dTally,
    };
  });

  const scoredDs = domains.filter((d) => d.score !== null);
  const dNorm = normalizeWeights(scoredDs.map((d) => d.weight));
  scoredDs.forEach((d, i) => (d.normalizedWeight = dNorm[i]));

  const tally = finishTally(overall);
  const rawScore = weightedAverage(scoredDs.map((d) => ({ value: d.score, weight: d.weight })));
  const belowThreshold = rawScore !== null && tally.coverage + EPS < config.minCoverage;
  const score = rawScore === null || belowThreshold ? null : rawScore;
  const state: ScoreState =
    score === null
      ? "NOT_ASSESSED"
      : tally.scored === tally.total - tally.na && tally.total - tally.na > 0
        ? "COMPLETE"
        : "PARTIAL";
  return { ...tally, score, rawScore, belowThreshold, state, unconfirmedCarriedForward: unconfirmed, domains };
}

// ---------------------------------------------------------------------------------------------
// Effective project scores and aggregation
// ---------------------------------------------------------------------------------------------

export type ScoreSource = "DIRECT" | "AGGREGATED";

export interface DomainScoreSummary {
  id: string;
  key: string;
  name: string;
  sammFunction: string;
  score: number | null;
  coverage: number;
  /** number of contributing children (aggregations only) */
  contributors?: number;
}

export interface ChildContribution {
  projectId: string;
  name: string;
  weight: number;
  normalizedWeight: number;
  score: number | null;
  state: ScoreState;
  contributes: boolean;
  coverage: number;
}

export interface AggregationInfo {
  childCount: number;
  assessedCount: number; // COMPLETE
  partialCount: number; // PARTIAL
  unassessedCount: number; // NOT_ASSESSED
  contributingCount: number;
  /** share of total child weight that contributes to the score, percent */
  weightCoverage: number;
  children: ChildContribution[];
}

export interface EffectiveScore extends Tally {
  source: ScoreSource;
  state: ScoreState;
  score: number | null;
  domains: DomainScoreSummary[];
  aggregation?: AggregationInfo;
}

export function directEffective(a: AssessmentScore | null): EffectiveScore {
  if (!a) {
    return {
      source: "DIRECT",
      state: "NOT_ASSESSED",
      score: null,
      domains: [],
      ...finishTally(emptyTally()),
    };
  }
  return {
    source: "DIRECT",
    state: a.state,
    score: a.score,
    total: a.total,
    scored: a.scored,
    na: a.na,
    unable: a.unable,
    evidenceMissing: a.evidenceMissing,
    unanswered: a.unanswered,
    completion: a.completion,
    coverage: a.coverage,
    domains: a.domains.map((d) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      sammFunction: d.sammFunction,
      score: a.score === null ? null : d.score,
      coverage: d.coverage,
    })),
  };
}

export interface AggregateChildInput {
  projectId: string;
  name: string;
  weight: number;
  score: EffectiveScore;
}

/**
 * Aggregates child scores (subprojects into a parent, or main projects into the organization).
 * Only children with a sufficient score contribute. Unassessed children are never treated as zero.
 */
export function aggregateScores(children: AggregateChildInput[]): EffectiveScore {
  children.forEach((c) => assertValidWeight(c.weight, `weight of ${c.name}`));
  const contributing = children.filter((c) => c.score.score !== null);
  const norm = normalizeWeights(contributing.map((c) => c.weight));
  const normById = new Map(contributing.map((c, i) => [c.projectId, norm[i]]));
  const totalWeight = children.reduce((a, c) => a + c.weight, 0);
  const contributingWeight = contributing.reduce((a, c) => a + c.weight, 0);

  const score = weightedAverage(contributing.map((c) => ({ value: c.score.score, weight: c.weight })));

  // Domain-level aggregation: each domain is averaged across contributing children that scored it.
  const domainMap = new Map<string, { meta: DomainScoreSummary; items: { value: number | null; weight: number }[]; cov: number[] }>();
  for (const c of contributing) {
    for (const d of c.score.domains) {
      if (!domainMap.has(d.id)) domainMap.set(d.id, { meta: { ...d }, items: [], cov: [] });
      const entry = domainMap.get(d.id)!;
      entry.items.push({ value: d.score, weight: c.weight });
      entry.cov.push(d.coverage);
    }
  }
  const domains: DomainScoreSummary[] = [...domainMap.values()].map(({ meta, items, cov }) => ({
    id: meta.id,
    key: meta.key,
    name: meta.name,
    sammFunction: meta.sammFunction,
    score: weightedAverage(items),
    coverage: cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : 0,
    contributors: items.filter((i) => i.value !== null).length,
  }));

  const t = emptyTally();
  children.forEach((c) => addTally(t, c.score));
  const tally = finishTally(t);

  const assessedCount = children.filter((c) => c.score.state === "COMPLETE").length;
  const partialCount = children.filter((c) => c.score.state === "PARTIAL").length;
  const unassessedCount = children.filter((c) => c.score.state === "NOT_ASSESSED").length;

  const state: ScoreState =
    score === null ? "NOT_ASSESSED" : assessedCount === children.length ? "COMPLETE" : "PARTIAL";

  return {
    source: "AGGREGATED",
    state,
    score,
    domains,
    ...tally,
    aggregation: {
      childCount: children.length,
      assessedCount,
      partialCount,
      unassessedCount,
      contributingCount: contributing.length,
      weightCoverage: pct(contributingWeight, totalWeight),
      children: children.map((c) => ({
        projectId: c.projectId,
        name: c.name,
        weight: c.weight,
        normalizedWeight: normById.get(c.projectId) ?? 0,
        score: c.score.score,
        state: c.score.state,
        contributes: c.score.score !== null,
        coverage: c.score.coverage,
      })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Hierarchy evaluation
// ---------------------------------------------------------------------------------------------

export interface HierarchyNode {
  id: string;
  name: string;
  weight: number;
  archived: boolean;
  parentId: string | null;
}

/**
 * Computes the effective score of a project given its own direct score and its children.
 *  - Case A (no active subprojects): direct score from its own assessment.
 *  - Case B (one or more active subprojects): aggregated from subprojects only. The parent's own
 *    assessment is returned separately as `oversight` and never affects the aggregated score.
 */
export function evaluateProject(
  project: HierarchyNode,
  nodes: HierarchyNode[],
  directScores: Map<string, AssessmentScore | null>,
): { effective: EffectiveScore; oversight: AssessmentScore | null; activeChildren: HierarchyNode[] } {
  const activeChildren = nodes.filter((n) => n.parentId === project.id && !n.archived);
  const own = directScores.get(project.id) ?? null;
  if (activeChildren.length === 0) {
    return { effective: directEffective(own), oversight: null, activeChildren };
  }
  const childInputs: AggregateChildInput[] = activeChildren.map((c) => ({
    projectId: c.id,
    name: c.name,
    weight: c.weight,
    score: evaluateProject(c, nodes, directScores).effective,
  }));
  return { effective: aggregateScores(childInputs), oversight: own, activeChildren };
}

/** Organization score from active main projects. Archived projects never contribute. */
export function evaluateOrganization(nodes: HierarchyNode[], directScores: Map<string, AssessmentScore | null>) {
  const mains = nodes.filter((n) => n.parentId === null && !n.archived);
  const perProject = new Map<string, EffectiveScore>();
  const inputs: AggregateChildInput[] = mains.map((m) => {
    const eff = evaluateProject(m, nodes, directScores).effective;
    perProject.set(m.id, eff);
    return { projectId: m.id, name: m.name, weight: m.weight, score: eff };
  });
  return { org: aggregateScores(inputs), perProject };
}
