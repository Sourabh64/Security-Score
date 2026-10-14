import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createQuestionRecord, updateMaturityLevels, updateQuestion, upsertDomain } from "@/server/services/admin";
import { archiveProject, createProject, deleteProject, updateProject, updateWeights } from "@/server/services/projects";
import { completeAssessment, confirmResponses, createAssessment, reviewAssessment, saveResponse } from "@/server/services/assessments";
import { acceptRisk, closeAction, createAction, updateAction } from "@/server/services/actions";
import { createEvidence, verifyEvidence } from "@/server/services/evidence";
import { computePortfolio, scoreForAssessment } from "@/server/portfolio";
import { scoresCsv } from "@/server/export";
import { formatScore } from "@/lib/scoring/format";
import { ServiceError } from "@/server/errors";
import type { Actor } from "@/server/permissions";
import type { QuestionInput } from "@/lib/validation";

const db = new PrismaClient();
let admin: Actor, assessor: Actor, reviewer: Actor, viewer: Actor;
const Q: Record<string, string> = {};

function question(key: string, practiceId: string, tags = "", criticality: QuestionInput["criticality"] = "HIGH"): QuestionInput {
  return {
    key, practiceId, title: `Question ${key}`, description: `Describes what to look for in ${key}.`, criticality, applicabilityTags: tags, weight: 1, mandatory: true,
    options: [1, 2, 3, 4, 5].map((level) => ({ level, label: `L${level} label`, description: `Level ${level} state for ${key}`, criteria: "c", examples: "e", gaps: "" })),
  };
}

async function reset() {
  await db.$transaction([
    db.auditEvent.deleteMany(), db.evidenceLink.deleteMany(), db.evidence.deleteMany(), db.remediationAction.deleteMany(), db.scoreSnapshot.deleteMany(),
    db.assessmentReview.deleteMany(), db.assessmentResponse.deleteMany(), db.assessment.deleteMany(), db.answerOption.deleteMany(), db.questionVersion.deleteMany(),
    db.question.deleteMany(), db.securityPractice.deleteMany(), db.securityDomain.deleteMany(), db.frameworkVersion.deleteMany(),
    db.project.updateMany({ data: { parentId: null } }), db.project.deleteMany(), db.user.deleteMany(), db.maturityLevel.deleteMany(), db.organizationSettings.deleteMany(),
  ]);
  await db.organizationSettings.create({ data: { id: 1, orgName: "Test Org", appTitle: "Test", minCoverageForScore: 0 } });
  for (const [level, anchor] of [[1, 10], [2, 30], [3, 50], [4, 75], [5, 100]]) await db.maturityLevel.create({ data: { level, anchor, label: `Level ${level}`, description: "" } });
  await db.frameworkVersion.create({ data: { version: 1, label: "v1" } });
  const mk = async (name: string, role: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@t.test`, role } });
    return { id: u.id, name, role } as Actor;
  };
  admin = await mk("admin", "ADMIN");
  assessor = await mk("assessor", "ASSESSOR");
  reviewer = await mk("reviewer", "REVIEWER");
  viewer = await mk("viewer", "VIEWER");
  const d1 = await db.securityDomain.create({ data: { key: "D1", name: "Domain 1", sammFunction: "GOVERNANCE", order: 1 } });
  const d2 = await db.securityDomain.create({ data: { key: "D2", name: "Domain 2", sammFunction: "DESIGN", order: 2 } });
  const p1 = await db.securityPractice.create({ data: { key: "P1", name: "Practice 1", domainId: d1.id, order: 1 } });
  const p2 = await db.securityPractice.create({ data: { key: "P2", name: "Practice 2", domainId: d2.id, order: 1 } });
  for (const [key, pid, tags] of [["G1", p1.id, ""], ["G2", p1.id, ""], ["G3", p2.id, ""], ["DLPQ", p2.id, "dlp"], ["CASBQ", p2.id, "casb"]] as const) {
    const q = await db.$transaction((tx) => createQuestionRecord(tx, null, question(key, pid, tags), 1));
    Q[key] = q.id;
  }
}

const answerAll = async (assessmentId: string, levels: Record<string, number | "NA">, actor = assessor) => {
  for (const [k, l] of Object.entries(levels))
    await saveResponse(db, actor, assessmentId, Q[k], l === "NA" ? { status: "NOT_APPLICABLE", naJustification: "Not relevant for this component at all" } : { status: "ANSWERED", level: l });
};
const newAssessment = (projectId: string, extra: Record<string, unknown> = {}) =>
  createAssessment(db, assessor, { projectId, title: "A", type: "BASELINE", assessmentDate: "2026-01-01", reviewerId: reviewer.id, ...extra });

beforeEach(reset);
afterAll(() => db.$disconnect());

describe("project hierarchy scoring (DB)", () => {
  it("(1)(2)(3)(7) direct vs aggregated scores and oversight separation", async () => {
    const solo = await createProject(db, admin, { key: "SOLO", name: "Solo", criticality: "HIGH", lifecycleStatus: "GA" });
    const parent = await createProject(db, admin, { key: "PAR", name: "Parent", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await createProject(db, admin, { key: "SUB-A", name: "Sub A", criticality: "HIGH", lifecycleStatus: "GA", parentId: parent.id });
    const b = await createProject(db, admin, { key: "SUB-B", name: "Sub B", criticality: "HIGH", lifecycleStatus: "GA", parentId: parent.id });

    let p = await computePortfolio(db);
    expect(p.effective.get(parent.id)!.score).toBeNull(); // (7) only unassessed subprojects
    expect(p.effective.get(parent.id)!.source).toBe("AGGREGATED");

    const sa = await newAssessment(solo.id);
    await answerAll(sa.id, { G1: 3, G2: 3, G3: 3 });
    const aa = await newAssessment(a.id);
    await answerAll(aa.id, { G1: 5, G2: 5, G3: 5 });
    const ov = await createAssessment(db, admin, { projectId: parent.id, title: "Oversight", type: "BASELINE", assessmentDate: "2026-01-01" });
    expect(ov.type).toBe("OVERSIGHT");
    await answerAll(ov.id, { G1: 1, G2: 1, G3: 1 }, admin);

    p = await computePortfolio(db);
    expect(p.effective.get(solo.id)!.source).toBe("DIRECT");
    expect(p.effective.get(solo.id)!.score).toBe(50);
    const par = p.effective.get(parent.id)!;
    expect(par.score).toBe(100); // only Sub A contributes; oversight (10) ignored; Sub B not zero
    expect(par.aggregation!.contributingCount).toBe(1);
    expect(par.aggregation!.childCount).toBe(2);
    expect(p.oversight.get(parent.id)!.score).toBe(10);
    expect(p.effective.get(b.id)!.state).toBe("NOT_ASSESSED");
  });

  it("(13)(14) archived projects are excluded from the organization score", async () => {
    const x = await createProject(db, admin, { key: "XX", name: "X", criticality: "HIGH", lifecycleStatus: "GA" });
    const y = await createProject(db, admin, { key: "YY", name: "Y", criticality: "HIGH", lifecycleStatus: "GA" });
    await createProject(db, admin, { key: "ZZ", name: "Z unassessed", criticality: "HIGH", lifecycleStatus: "GA" });
    const ax = await newAssessment(x.id);
    await answerAll(ax.id, { G1: 4, G2: 4, G3: 4 });
    const ay = await newAssessment(y.id);
    await answerAll(ay.id, { G1: 1, G2: 1, G3: 1 });
    let p = await computePortfolio(db);
    expect(p.org.score).toBeCloseTo((75 + 10) / 2, 6);
    expect(p.org.aggregation!.unassessedCount).toBe(1);
    await archiveProject(db, admin, y.id);
    p = await computePortfolio(db);
    expect(p.org.score).toBe(75);
    expect(p.org.aggregation!.childCount).toBe(2);
    expect(await db.assessment.count({ where: { projectId: y.id } })).toBe(1); // history retained
  });

  it("(15) product-specific questions apply only to eligible products (capabilities inherited)", async () => {
    const dlp = await createProject(db, admin, { key: "DLP", name: "DLP", criticality: "HIGH", lifecycleStatus: "GA", capabilities: "dlp" });
    const ep = await createProject(db, admin, { key: "DLP-EP", name: "Endpoint", criticality: "HIGH", lifecycleStatus: "GA", parentId: dlp.id });
    const casb = await createProject(db, admin, { key: "CASB", name: "CASB", criticality: "HIGH", lifecycleStatus: "GA", capabilities: "casb" });
    const a = await newAssessment(ep.id);
    await answerAll(a.id, { G1: 3, G2: 3, G3: 3, DLPQ: 3 });
    await expect(saveResponse(db, assessor, a.id, Q.CASBQ, { status: "ANSWERED", level: 1 })).rejects.toThrow(/not applicable/);
    const c = await newAssessment(casb.id);
    await answerAll(c.id, { G1: 3, G2: 3, G3: 3, CASBQ: 3 });
    const p = await computePortfolio(db);
    expect(p.direct.get(ep.id)!.total).toBe(4);
    expect(p.direct.get(ep.id)!.state).toBe("COMPLETE"); // the CASB question does not count against DLP
    expect(p.direct.get(casb.id)!.state).toBe("COMPLETE");
  });

  it("(16) rejects duplicate identifiers, circular/deep hierarchies and invalid weights", async () => {
    const a = await createProject(db, admin, { key: "AAA", name: "A", criticality: "HIGH", lifecycleStatus: "GA" });
    await expect(createProject(db, admin, { key: "aaa", name: "dup", criticality: "HIGH", lifecycleStatus: "GA" })).rejects.toThrow(/already exists/);
    const b = await createProject(db, admin, { key: "BBB", name: "B", criticality: "HIGH", lifecycleStatus: "GA", parentId: a.id });
    await expect(updateProject(db, admin, a.id, { key: "AAA", name: "A", criticality: "HIGH", lifecycleStatus: "GA", parentId: b.id })).rejects.toThrow(ServiceError);
    await expect(updateProject(db, admin, a.id, { key: "AAA", name: "A", criticality: "HIGH", lifecycleStatus: "GA", parentId: a.id })).rejects.toThrow(/circular/);
    await expect(createProject(db, admin, { key: "CCC", name: "C", criticality: "HIGH", lifecycleStatus: "GA", weight: -1 })).rejects.toThrow();
    await expect(updateWeights(db, admin, [{ id: a.id, weight: 500 }])).rejects.toThrow(/between 0 and 100/);
    await expect(upsertDomain(db, admin, null, { key: "D1", name: "dup", sammFunction: "DESIGN" })).rejects.toThrow(/already in use/);
  });

  it("only allows deleting a project without history; otherwise archive", async () => {
    const a = await createProject(db, admin, { key: "DEL", name: "Del", criticality: "LOW", lifecycleStatus: "GA" });
    await newAssessment(a.id);
    await expect(deleteProject(db, admin, a.id)).rejects.toThrow(/Archive it instead/);
    const b = await createProject(db, admin, { key: "DEL2", name: "Del2", criticality: "LOW", lifecycleStatus: "GA" });
    await deleteProject(db, admin, b.id);
    expect(await db.project.findUnique({ where: { id: b.id } })).toBeNull();
  });
});

describe("assessment workflow (DB)", () => {
  it("(10)(11) draft answers recalculate live; completed assessments keep their snapshot score", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    const first = await saveResponse(db, assessor, a.id, Q.G1, { status: "ANSWERED", level: 2 });
    expect(first.score.score).toBe(30);
    const second = await saveResponse(db, assessor, a.id, Q.G1, { status: "ANSWERED", level: 4 });
    expect(second.score.score).toBe(75);
    await answerAll(a.id, { G2: 4, G3: 4 });
    await completeAssessment(db, assessor, a.id);
    const before = (await scoreForAssessment(db, a.id)).score.score;
    // Changing anchors or editing answers afterwards must not rewrite history
    await updateMaturityLevels(db, admin, [1, 2, 3, 4, 5].map((level) => ({ level, label: `L${level}`, description: "", anchor: [5, 20, 40, 60, 80][level - 1] })));
    await expect(saveResponse(db, assessor, a.id, Q.G1, { status: "ANSWERED", level: 1 })).rejects.toThrow(/immutable/);
    const after = await scoreForAssessment(db, a.id);
    expect(after.basis).toBe("SNAPSHOT");
    expect(after.score.score).toBe(before);
  });

  it("(12) a question version change does not rewrite previous assessments", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    await answerAll(a.id, { G1: 3, G2: 3, G3: 3 });
    await completeAssessment(db, assessor, a.id);
    const g1 = await db.question.findUniqueOrThrow({ where: { id: Q.G1 } });
    await updateQuestion(db, admin, Q.G1, { ...question("G1", g1.practiceId), title: "Reworded G1", weight: 5, changeNote: "reword" });
    const q = await db.question.findUniqueOrThrow({ where: { id: Q.G1 }, include: { versions: true } });
    expect(q.currentVersion).toBe(2);
    expect(q.versions).toHaveLength(2);
    const r = await db.assessmentResponse.findFirstOrThrow({ where: { assessmentId: a.id, questionId: Q.G1 }, include: { questionVersion: true } });
    expect(r.questionVersion.version).toBe(1);
    expect(r.questionVersion.title).toBe("Question G1");
    expect((await scoreForAssessment(db, a.id)).score.score).toBe(50);
    const fv = await db.assessment.findUniqueOrThrow({ where: { id: a.id }, include: { frameworkVersion: true } });
    expect(fv.frameworkVersion?.version).toBe(1);
  });

  it("(5) requires a justification for N/A and reports it separately", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    await expect(saveResponse(db, assessor, a.id, Q.G1, { status: "NOT_APPLICABLE", naJustification: "" })).rejects.toThrow();
    await answerAll(a.id, { G1: "NA", G2: 5, G3: 5 });
    const s = (await scoreForAssessment(db, a.id)).score;
    expect(s.na).toBe(1);
    expect(s.score).toBe(100);
    expect(s.coverage).toBe(100);
  });

  it("carries responses forward and requires reconfirmation before completion", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    await answerAll(a.id, { G1: 3, G2: 3, G3: 3 });
    await completeAssessment(db, assessor, a.id);
    const re = await newAssessment(pr.id, { type: "PERIODIC", basedOnId: a.id, copyResponses: true });
    const copied = await db.assessmentResponse.findMany({ where: { assessmentId: re.id } });
    expect(copied).toHaveLength(3);
    expect(copied.every((c) => c.carriedForward && !c.confirmed)).toBe(true);
    await expect(completeAssessment(db, assessor, re.id)).rejects.toThrow(/reconfirmed/);
    await confirmResponses(db, assessor, re.id, [Q.G1, Q.G2]);
    await saveResponse(db, assessor, re.id, Q.G3, { status: "ANSWERED", level: 4 });
    await completeAssessment(db, assessor, re.id);
    expect((await scoreForAssessment(db, re.id)).score.score).toBeCloseTo((50 + 75) / 2, 6);
    expect((await scoreForAssessment(db, a.id)).score.score).toBe(50); // original untouched
  });

  it("enforces review separation of duties and role permissions on the server", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    await expect(createProject(db, viewer, { key: "VV", name: "V", criticality: "HIGH", lifecycleStatus: "GA" })).rejects.toThrow(/permission/);
    await expect(newAssessment(pr.id, { reviewerId: assessor.id, assessorId: assessor.id })).rejects.toThrow(/different person/);
    const a = await newAssessment(pr.id);
    await expect(saveResponse(db, viewer, a.id, Q.G1, { status: "ANSWERED", level: 3 })).rejects.toThrow(/permission/);
    await answerAll(a.id, { G1: 3, G2: 3, G3: 3 });
    await expect(completeAssessment(db, reviewer, a.id)).rejects.toThrow(/permission/);
    await completeAssessment(db, assessor, a.id);
    await expect(reviewAssessment(db, assessor, a.id, { decision: "APPROVED" })).rejects.toThrow(/permission/);
    const adminAssessed = await createAssessment(db, admin, { projectId: pr.id, title: "B", type: "PERIODIC", assessmentDate: "2026-02-01" });
    await answerAll(adminAssessed.id, { G1: 3, G2: 3, G3: 3 }, admin);
    await completeAssessment(db, admin, adminAssessed.id);
    await expect(reviewAssessment(db, admin, adminAssessed.id, { decision: "APPROVED" })).rejects.toThrow(/Separation of duties/);
    await reviewAssessment(db, reviewer, a.id, { decision: "APPROVED", comments: "ok" });
    expect((await db.assessment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("REVIEWED");
  });

  it("COMPLETED_ONLY basis ignores drafts", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    await answerAll(a.id, { G1: 2, G2: 2, G3: 2 });
    await completeAssessment(db, assessor, a.id);
    const d = await newAssessment(pr.id, { assessmentDate: "2026-06-01" });
    await answerAll(d.id, { G1: 5 });
    expect((await computePortfolio(db)).effective.get(pr.id)!.score).toBe(100);
    await db.organizationSettings.update({ where: { id: 1 }, data: { scoreBasis: "COMPLETED_ONLY" } });
    expect((await computePortfolio(db)).effective.get(pr.id)!.score).toBe(30);
  });
});

describe("remediation & evidence (DB)", () => {
  it("(17) an action cannot be closed without the explicit close action", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await newAssessment(pr.id);
    const r = await saveResponse(db, assessor, a.id, Q.G1, { status: "ANSWERED", level: 1 });
    const act = await createAction(db, assessor, { title: "Fix G1", projectId: pr.id, responseId: r.responseId, priority: "HIGH" });
    expect(act.questionId).toBe(Q.G1);
    expect(act.assessmentId).toBe(a.id);
    await expect(updateAction(db, assessor, act.id, { title: "Fix G1", projectId: pr.id, priority: "HIGH", status: "CLOSED" as never })).rejects.toThrow(/explicit/);
    // Improving the answer does not close the action
    await saveResponse(db, assessor, a.id, Q.G1, { status: "ANSWERED", level: 5 });
    expect((await db.remediationAction.findUniqueOrThrow({ where: { id: act.id } })).status).toBe("OPEN");
    await expect(closeAction(db, assessor, act.id, { closureNote: "short", completionEvidence: "" })).rejects.toThrow();
    await closeAction(db, assessor, act.id, { closureNote: "Verified in staging by security.", completionEvidence: "PR #42 merged" });
    const closed = await db.remediationAction.findUniqueOrThrow({ where: { id: act.id } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedBy).toBe("assessor");
    // Assessors cannot accept risk; reviewers can, and only time-bound
    const act2 = await createAction(db, assessor, { title: "Risk", projectId: pr.id, priority: "LOW" });
    await expect(acceptRisk(db, assessor, act2.id, { closureNote: "Compensating control in place", riskAcceptedUntil: "2099-01-01" })).rejects.toThrow(/permission/);
    await expect(acceptRisk(db, reviewer, act2.id, { closureNote: "Compensating control in place", riskAcceptedUntil: "2001-01-01" })).rejects.toThrow(/future/);
    await acceptRisk(db, reviewer, act2.id, { closureNote: "Compensating control in place", riskAcceptedUntil: "2099-01-01" });
  });

  it("validates evidence references and requires independent verification", async () => {
    const pr = await createProject(db, admin, { key: "PRJ", name: "P", criticality: "HIGH", lifecycleStatus: "GA" });
    await expect(createEvidence(db, assessor, { projectId: pr.id, title: "x", type: "OTHER", reference: "javascript:alert(1)" })).rejects.toThrow(/http/);
    const e = await createEvidence(db, assessor, { projectId: pr.id, title: "TM", type: "THREAT_MODEL", reference: "JIRA: SEC-1" });
    expect(e.verificationStatus).toBe("PENDING");
    await expect(verifyEvidence(db, assessor, e.id, { status: "VERIFIED" })).rejects.toThrow(/permission/);
    await verifyEvidence(db, reviewer, e.id, { status: "VERIFIED", note: "checked" });
    expect((await db.evidence.findUniqueOrThrow({ where: { id: e.id } })).verificationStatus).toBe("VERIFIED");
  });
});

describe("exports (DB)", () => {
  it("(18) exported scores match the values displayed in the application", async () => {
    const parent = await createProject(db, admin, { key: "PAR", name: "Parent", criticality: "HIGH", lifecycleStatus: "GA" });
    const a = await createProject(db, admin, { key: "SA", name: "Sub A", criticality: "HIGH", lifecycleStatus: "GA", parentId: parent.id });
    const b = await createProject(db, admin, { key: "SB", name: "Sub B", criticality: "HIGH", lifecycleStatus: "GA", parentId: parent.id, weight: 2 });
    const aa = await newAssessment(a.id);
    await answerAll(aa.id, { G1: 2, G2: 3, G3: 5 });
    const ab = await newAssessment(b.id);
    await answerAll(ab.id, { G1: 4, G2: 1 });
    const p = await computePortfolio(db);
    const csv = await scoresCsv(db);
    const rows = csv.trim().split("\r\n").map((l) => l.split(","));
    const header = rows[0];
    const col = header.indexOf("score_1dp");
    for (const id of [parent.id, a.id, b.id]) {
      const proj = p.byId.get(id)!;
      const row = rows.find((r) => r[0] === "PROJECT" && r[1] === proj.key)!;
      expect(row[col]).toBe(formatScore(p.effective.get(id)!.score));
    }
    const orgRow = rows.find((r) => r[0] === "ORGANIZATION")!;
    expect(orgRow[col]).toBe(formatScore(p.org.score));
  });
});
