import { describe, expect, it } from "vitest";
import {
  aggregateScores, evaluateOrganization, evaluateProject, filterFramework, isApplicable, normalizeWeights, scoreAssessment, weightedAverage,
  WeightError, type FwDomain, type HierarchyNode, type ResponseInput,
} from "@/lib/scoring/engine";
import { formatScore, roundScore, impliedLevel, scoreKindLabel } from "@/lib/scoring/format";
import { wouldCreateCycle, effectiveCapabilities } from "@/lib/hierarchy";
import { csvCell } from "@/lib/csv";

const anchors = { 1: 10, 2: 30, 3: 50, 4: 75, 5: 100 };
const cfg = { anchors, minCoverage: 0 };

/** Two domains; D1 has two practices. Q5 is DLP-specific. */
function fw(): FwDomain[] {
  const q = (id: string, w = 1, tags: string[] = [], criticality = "HIGH") => ({ id, key: id, title: id, weight: w, criticality, mandatory: true, applicabilityTags: tags });
  return [
    { id: "D1", key: "D1", name: "Domain 1", sammFunction: "GOVERNANCE", weight: 1, practices: [
      { id: "P1", key: "P1", name: "P1", weight: 1, questions: [q("Q1"), q("Q2")] },
      { id: "P2", key: "P2", name: "P2", weight: 1, questions: [q("Q3")] },
    ] },
    { id: "D2", key: "D2", name: "Domain 2", sammFunction: "DESIGN", weight: 1, practices: [
      { id: "P3", key: "P3", name: "P3", weight: 1, questions: [q("Q4"), q("Q5", 1, ["dlp"])] },
    ] },
  ];
}
const ans = (level: number): ResponseInput => ({ status: "ANSWERED", level });

describe("scoring engine – assessment scores", () => {
  it("computes weighted averages bottom-up (question → practice → domain → project)", () => {
    const s = scoreAssessment(fw(), { Q1: ans(3), Q2: ans(5), Q3: ans(1), Q4: ans(4), Q5: ans(4) }, cfg);
    // P1 = (50+100)/2 = 75; P2 = 10; D1 = (75+10)/2 = 42.5; D2 = 75; project = (42.5+75)/2 = 58.75
    expect(s.domains[0].practices[0].score).toBe(75);
    expect(s.domains[0].score).toBe(42.5);
    expect(s.domains[1].score).toBe(75);
    expect(s.score).toBeCloseTo(58.75, 6);
    expect(s.state).toBe("COMPLETE");
  });

  it("(4) never scores an unanswered question as zero", () => {
    const s = scoreAssessment(fw(), { Q1: ans(3) }, cfg);
    expect(s.domains[0].practices[0].score).toBe(50); // Q2 unanswered must not pull P1 to 25
    expect(s.score).toBe(50);
    expect(s.unanswered).toBe(4);
    expect(s.state).toBe("PARTIAL");
    expect(s.coverage).toBeCloseTo(20, 6);
  });

  it("(5) excludes N/A from the denominator and counts it separately", () => {
    const all = { Q1: ans(4), Q2: { status: "NOT_APPLICABLE" as const, level: null }, Q3: ans(4), Q4: ans(4), Q5: ans(4) };
    const s = scoreAssessment(fw(), all, cfg);
    expect(s.na).toBe(1);
    expect(s.score).toBe(75);
    expect(s.coverage).toBe(100);
    expect(s.state).toBe("COMPLETE");
  });

  it("does not let 'unable to determine' or 'evidence missing' inflate or deflate scores", () => {
    const base = scoreAssessment(fw(), { Q1: ans(2) }, cfg);
    const withStatuses = scoreAssessment(fw(), { Q1: ans(2), Q2: { status: "UNABLE_TO_DETERMINE", level: null }, Q3: { status: "EVIDENCE_MISSING", level: null } }, cfg);
    expect(withStatuses.score).toBe(base.score);
    expect(withStatuses.unable).toBe(1);
    expect(withStatuses.evidenceMissing).toBe(1);
    expect(withStatuses.coverage).toBe(base.coverage);
    expect(withStatuses.completion).toBeGreaterThan(base.completion);
  });

  it("(6) reports Not assessed when no question has a score", () => {
    const s = scoreAssessment(fw(), {}, cfg);
    expect(s.score).toBeNull();
    expect(s.state).toBe("NOT_ASSESSED");
    expect(formatScore(s.score)).toBe("Not assessed");
    const onlyNa = scoreAssessment(fw(), { Q1: { status: "NOT_APPLICABLE", level: null } }, cfg);
    expect(onlyNa.score).toBeNull();
  });

  it("applies the minimum coverage threshold without hiding the raw value", () => {
    const s = scoreAssessment(fw(), { Q1: ans(5) }, { anchors, minCoverage: 50 });
    expect(s.score).toBeNull();
    expect(s.belowThreshold).toBe(true);
    expect(s.rawScore).toBe(100);
  });

  it("(10) recalculates when a draft answer changes", () => {
    const a = scoreAssessment(fw(), { Q1: ans(2), Q4: ans(2) }, cfg);
    const b = scoreAssessment(fw(), { Q1: ans(5), Q4: ans(2) }, cfg);
    expect(a.score).toBe(30);
    expect(b.score).toBe(65);
  });

  it("counts unconfirmed carried-forward answers", () => {
    const s = scoreAssessment(fw(), { Q1: { status: "ANSWERED", level: 3, carriedForward: true, confirmed: false } }, cfg);
    expect(s.unconfirmedCarriedForward).toBe(1);
  });
});

describe("weights", () => {
  it("(9) normalizes configured weights", () => {
    expect(normalizeWeights([1, 1, 2])).toEqual([0.25, 0.25, 0.5]);
    expect(normalizeWeights([0, 0])).toEqual([0, 0]);
    expect(weightedAverage([{ value: 100, weight: 3 }, { value: 0, weight: 1 }])).toBe(75);
    expect(weightedAverage([{ value: 80, weight: 2 }, { value: null, weight: 5 }])).toBe(80);
    expect(weightedAverage([{ value: 80, weight: 0 }])).toBeNull(); // no division by zero
  });

  it("applies question weights inside a practice", () => {
    const f = fw();
    f[0].practices[0].questions[0].weight = 3; // Q1 x3
    const s = scoreAssessment(f, { Q1: ans(5), Q2: ans(1) }, cfg);
    expect(s.domains[0].practices[0].score).toBeCloseTo((100 * 3 + 10) / 4, 6);
    expect(s.domains[0].practices[0].questions[0].normalizedWeight).toBeCloseTo(0.75, 6);
  });

  it("(16) rejects invalid weights", () => {
    expect(() => normalizeWeights([-1, 2])).toThrow(WeightError);
    expect(() => normalizeWeights([Number.NaN])).toThrow(WeightError);
    expect(() => normalizeWeights([101])).toThrow(WeightError);
    const f = fw();
    f[1].weight = -2;
    expect(() => scoreAssessment(f, { Q4: ans(3) }, cfg)).toThrow(WeightError);
  });
});

describe("hierarchy aggregation", () => {
  const nodes: HierarchyNode[] = [
    { id: "P", name: "Parent", weight: 1, archived: false, parentId: null },
    { id: "A", name: "A", weight: 1, archived: false, parentId: "P" },
    { id: "B", name: "B", weight: 1, archived: false, parentId: "P" },
    { id: "C", name: "C", weight: 1, archived: false, parentId: "P" },
    { id: "SOLO", name: "Solo", weight: 1, archived: false, parentId: null },
  ];
  const full = (level: number) => scoreAssessment(fw(), { Q1: ans(level), Q2: ans(level), Q3: ans(level), Q4: ans(level), Q5: ans(level) }, cfg);

  it("(1) a project without subprojects is scored from its own answers", () => {
    const r = evaluateProject(nodes[4], nodes, new Map([["SOLO", full(3)]]));
    expect(r.effective.source).toBe("DIRECT");
    expect(r.effective.score).toBe(50);
    expect(scoreKindLabel(r.effective)).toBe("Directly assessed");
  });

  it("(2) a parent with subprojects aggregates eligible subproject scores", () => {
    const direct = new Map([["A", full(3)], ["B", full(5)], ["C", null]]);
    const r = evaluateProject(nodes[0], nodes, direct);
    expect(r.effective.source).toBe("AGGREGATED");
    expect(r.effective.score).toBe(75); // (50 + 100) / 2 – C excluded, not zero
  });

  it("(3) parent-level oversight answers never affect the aggregated score", () => {
    const withOversight = evaluateProject(nodes[0], nodes, new Map([["A", full(3)], ["B", full(5)], ["P", full(1)]]));
    const without = evaluateProject(nodes[0], nodes, new Map([["A", full(3)], ["B", full(5)]]));
    expect(withOversight.effective.score).toBe(without.effective.score);
    expect(withOversight.oversight?.score).toBe(10);
  });

  it("(7) a parent whose subprojects are all unassessed is Not assessed (not zero)", () => {
    const r = evaluateProject(nodes[0], nodes, new Map([["P", full(4)]]));
    expect(r.effective.score).toBeNull();
    expect(r.effective.state).toBe("NOT_ASSESSED");
    expect(r.effective.aggregation?.unassessedCount).toBe(3);
  });

  it("(8) partially assessed subprojects produce visible coverage indicators", () => {
    const partial = scoreAssessment(fw(), { Q1: ans(3) }, cfg);
    const r = evaluateProject(nodes[0], nodes, new Map([["A", full(3)], ["B", partial]]));
    const agg = r.effective.aggregation!;
    expect(r.effective.state).toBe("PARTIAL");
    expect(agg.assessedCount).toBe(1);
    expect(agg.partialCount).toBe(1);
    expect(agg.unassessedCount).toBe(1);
    expect(agg.contributingCount).toBe(2);
    expect(agg.weightCoverage).toBeCloseTo(200 / 3, 6);
  });

  it("respects subproject weights and excludes archived subprojects", () => {
    const n = nodes.map((x) => (x.id === "A" ? { ...x, weight: 3 } : x.id === "C" ? { ...x, archived: true } : x));
    const r = evaluateProject(n[0], n, new Map([["A", full(5)], ["B", full(1)], ["C", full(1)]]));
    expect(r.effective.score).toBeCloseTo((100 * 3 + 10) / 4, 6);
    expect(r.effective.aggregation!.childCount).toBe(2);
  });

  it("aggregates domain scores only from children that scored the domain", () => {
    const onlyD1 = scoreAssessment(fw(), { Q1: ans(5), Q2: ans(5), Q3: ans(5) }, cfg);
    const agg = aggregateScores([
      { projectId: "A", name: "A", weight: 1, score: { ...evaluateProject(nodes[1], nodes, new Map([["A", onlyD1]])).effective } },
      { projectId: "B", name: "B", weight: 1, score: evaluateProject(nodes[2], nodes, new Map([["B", full(1)]])).effective },
    ]);
    expect(agg.domains.find((d) => d.id === "D1")!.score).toBeCloseTo(55, 6);
    expect(agg.domains.find((d) => d.id === "D2")!.score).toBe(10);
  });

  it("(13)(14) organization score excludes archived and unassessed projects but reports coverage", () => {
    const orgNodes: HierarchyNode[] = [
      { id: "X", name: "X", weight: 1, archived: false, parentId: null },
      { id: "Y", name: "Y", weight: 1, archived: false, parentId: null },
      { id: "Z", name: "Z", weight: 1, archived: true, parentId: null },
    ];
    const { org } = evaluateOrganization(orgNodes, new Map([["X", full(4)], ["Z", full(1)]]));
    expect(org.score).toBe(75);
    expect(org.aggregation!.childCount).toBe(2); // archived Z not counted at all
    expect(org.aggregation!.contributingCount).toBe(1);
    expect(org.aggregation!.unassessedCount).toBe(1);
    expect(org.aggregation!.weightCoverage).toBe(50);
    expect(org.state).toBe("PARTIAL");
  });
});

describe("applicability, hierarchy validation and formatting", () => {
  it("(15) applies product-specific questions only to eligible products", () => {
    expect(isApplicable(["dlp"], ["casb"])).toBe(false);
    expect(isApplicable(["dlp"], ["DLP"])).toBe(true);
    expect(isApplicable([], ["anything"])).toBe(true);
    const casb = filterFramework(fw(), ["casb"]);
    expect(casb[1].practices[0].questions.map((q) => q.id)).toEqual(["Q4"]);
    // A CASB assessment answering everything is complete without the DLP question
    const s = scoreAssessment(casb, { Q1: ans(3), Q2: ans(3), Q3: ans(3), Q4: ans(3) }, cfg);
    expect(s.total).toBe(4);
    expect(s.state).toBe("COMPLETE");
  });

  it("inherits capabilities from the parent", () => {
    const nodes = [{ id: "P", parentId: null, capabilities: "dlp" }, { id: "C", parentId: "P", capabilities: "dlp-endpoint" }];
    expect(effectiveCapabilities(nodes, "C").sort()).toEqual(["dlp", "dlp-endpoint"]);
  });

  it("(16) detects circular hierarchies", () => {
    const nodes = [{ id: "A", parentId: null }, { id: "B", parentId: "A" }, { id: "C", parentId: "B" }];
    expect(wouldCreateCycle(nodes, "A", "C")).toBe(true);
    expect(wouldCreateCycle(nodes, "A", "A")).toBe(true);
    expect(wouldCreateCycle(nodes, "C", "A")).toBe(false);
  });

  it("uses one consistent rounding rule", () => {
    expect(roundScore(54.25, 1)).toBe(54.3);
    expect(roundScore(54.5, 0)).toBe(55);
    expect(formatScore(58.75)).toBe("58.8");
    expect(impliedLevel(19.9)).toBe(1);
    expect(impliedLevel(20)).toBe(2);
    expect(impliedLevel(87.5)).toBe(5);
  });

  it("neutralizes CSV formula injection", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("a,b")).toBe("\"a,b\"");
  });
});
