/**
 * Seeds Product Security Maturity Hub with a realistic, fictional demo portfolio:
 *  - 20 security domains, 40+ practices and 107 questions (5 descriptive options each)
 *  - DLP, Web Proxy / SSE and CASB with subprojects, a directly-assessed ZTNA project and an archived project
 *  - assessment history (baseline, periodic, rejected+revision, drafts with carried-forward answers)
 *  - evidence, reviews and remediation actions
 * All people, links and artifacts are fictional demo data. Run with `npm run db:seed`.
 */
import { PrismaClient } from "@prisma/client";
import { seedFramework } from "./seed-data";
import { DEFAULT_ANCHORS, DEFAULT_LEVEL_LABELS, type Role } from "../src/lib/constants";
import { createAssessment, completeAssessment, reviewAssessment } from "../src/server/services/assessments";
import { updateQuestion } from "../src/server/services/admin";
import { computePortfolio, collectGaps } from "../src/server/portfolio";
import { applicableFrameworkFor } from "../src/server/portfolio";
import type { Actor } from "../src/server/permissions";

const db = new PrismaClient();

// ------------------------------------------------------------------ deterministic randomness
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rand(seed: string): number {
  let t = hash(seed) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const d = (s: string) => new Date(`${s}T10:00:00Z`);
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * 86400000);

// ------------------------------------------------------------------ maturity profiles
const FAMILY_BIAS: Record<string, Record<string, number>> = {
  DLP: { ENF: 0.4, DAT: 0.5, PRV: 0.3, SUP: -0.6, CLD: -0.3, RES: -0.5, API: -0.2 },
  SSE: { CLD: 0.5, LOG: 0.4, RES: 0.3, HRD: 0.3, PRV: -0.6, REQ: -0.4, GOV: -0.2 },
  CASB: { AUT: 0.4, API: 0.3, ENF: -0.5, VUL: -0.4, IR: -0.4, LOG: -0.3 },
  ZTNA: { IAM: 0.5, AUT: 0.4, ARC: 0.2, VER: -0.6, IR: -0.3 },
  LEG: { AST: -0.5, SUP: -0.5 },
};

const NA_JUSTIFICATIONS = [
  "Practice is provided by the shared platform team and assessed in the platform assessment; this component has no separate implementation.",
  "Component does not store or process the data type addressed by this question (stateless processing only).",
  "No customer-facing interface exists for this component; the control is implemented by the management console.",
];

interface ProfileOpts {
  family: string;
  base: number;
  period: number; // improvement steps applied
  answerRatio?: number; // for partial drafts
  completeAll?: boolean;
}

function levelFor(projectKey: string, domainKey: string, questionKey: string, o: ProfileOpts): number {
  const bias = FAMILY_BIAS[o.family]?.[domainKey] ?? 0;
  const noise = (rand(`${projectKey}|${questionKey}`) - 0.5) * 1.8;
  const improvement = o.period * 0.35 + (rand(`${projectKey}|${questionKey}|${o.period}`) - 0.5) * 0.4;
  return Math.max(1, Math.min(5, Math.round(o.base + bias + noise + improvement)));
}

async function writeResponses(assessmentId: string, projectId: string, projectKey: string, o: ProfileOpts, answeredBy: string) {
  const { framework } = await applicableFrameworkFor(db, projectId);
  const qs = await db.question.findMany({ include: { versions: { select: { id: true, version: true } } } });
  const versionOf = new Map(qs.map((q) => [q.id, q.versions.find((v) => v.version === q.currentVersion)!.id]));
  const rows: import("@prisma/client").Prisma.AssessmentResponseCreateManyInput[] = [];
  for (const dm of framework)
    for (const p of dm.practices)
      for (const q of p.questions) {
        const r = rand(`${projectKey}|${q.key}|status|${o.period}`);
        if (o.answerRatio !== undefined && rand(`${projectKey}|${q.key}|answered`) > o.answerRatio) continue;
        let status = "ANSWERED";
        if (r < 0.025 && q.criticality !== "CRITICAL") status = "NOT_APPLICABLE";
        else if (r < 0.045 && !o.completeAll) status = "UNABLE_TO_DETERMINE";
        else if (r < 0.06 && !o.completeAll) status = "EVIDENCE_MISSING";
        const level = status === "ANSWERED" ? levelFor(projectKey, dm.key, q.key, o) : null;
        rows.push({
          assessmentId,
          questionId: q.id,
          questionVersionId: versionOf.get(q.id)!,
          status,
          level,
          naJustification: status === "NOT_APPLICABLE" ? NA_JUSTIFICATIONS[hash(q.key) % NA_JUSTIFICATIONS.length] : "",
          comment:
            status === "UNABLE_TO_DETERMINE"
              ? "Component owner unavailable during the assessment window; follow-up interview scheduled."
              : status === "EVIDENCE_MISSING"
                ? "Team asserts the practice exists but could not produce artifacts during the assessment."
                : level !== null && level <= 2
                  ? `Gap confirmed in interview with the ${projectKey} technical owner. Practice is applied inconsistently.`
                  : level !== null && level >= 4
                    ? "Practice is mature; metrics reviewed during the assessment."
                    : "",
          evidenceNote: level !== null && level >= 3 ? `See ${projectKey} security wiki / ${q.key}` : "",
          remediationNotes: level !== null && level <= 2 ? "Candidate for remediation action; discuss in quarterly planning." : "",
          answeredBy,
        });
      }
  await db.assessmentResponse.createMany({ data: rows });
  return rows.length;
}

async function main() {
  console.log("Resetting database…");
  await db.$transaction([
    db.auditEvent.deleteMany(),
    db.evidenceLink.deleteMany(),
    db.evidence.deleteMany(),
    db.remediationAction.deleteMany(),
    db.scoreSnapshot.deleteMany(),
    db.assessmentReview.deleteMany(),
    db.assessmentResponse.deleteMany(),
    db.assessment.deleteMany(),
    db.answerOption.deleteMany(),
    db.questionVersion.deleteMany(),
    db.question.deleteMany(),
    db.securityPractice.deleteMany(),
    db.securityDomain.deleteMany(),
    db.frameworkVersion.deleteMany(),
    db.project.updateMany({ data: { parentId: null } }),
    db.project.deleteMany(),
    db.user.deleteMany(),
    db.maturityLevel.deleteMany(),
    db.organizationSettings.deleteMany(),
  ]);

  await db.organizationSettings.create({
    data: { id: 1, orgName: "Northwind Security Inc.", appTitle: "Product Security Maturity Hub", frameworkVersion: 1 },
  });
  const levelDescriptions: Record<number, string> = {
    1: "Practice is absent or performed ad hoc and reactively; results depend on individuals.",
    2: "Practice is performed repeatably for some areas but is not standardized or consistently applied.",
    3: "Practice is documented, standardized, owned and applied consistently across the scope.",
    4: "Practice is measured, monitored and managed with metrics, enforcement and escalation.",
    5: "Practice is continuously improved using measured effectiveness, incidents and threat intelligence.",
  };
  for (const level of [1, 2, 3, 4, 5])
    await db.maturityLevel.create({ data: { level, label: DEFAULT_LEVEL_LABELS[level], anchor: DEFAULT_ANCHORS[level], description: levelDescriptions[level] } });
  await db.frameworkVersion.create({
    data: { version: 1, label: "v1", changeSummary: "Initial hybrid CMM + OWASP SAMM inspired framework (seed)", createdBy: "seed" },
  });

  const users: Record<string, { id: string; name: string; role: Role }> = {};
  for (const u of [
    { key: "admin", name: "Alex Rivera", email: "alex.rivera@example.com", role: "ADMIN", title: "Head of Product Security" },
    { key: "priya", name: "Priya Nair", email: "priya.nair@example.com", role: "ASSESSOR", title: "Senior Product Security Engineer" },
    { key: "marcus", name: "Marcus Chen", email: "marcus.chen@example.com", role: "ASSESSOR", title: "Product Security Engineer" },
    { key: "elena", name: "Elena Petrova", email: "elena.petrova@example.com", role: "REVIEWER", title: "Security Assurance Lead" },
    { key: "sam", name: "Sam Okafor", email: "sam.okafor@example.com", role: "VIEWER", title: "VP Engineering" },
  ] as const) {
    const created = await db.user.create({ data: { name: u.name, email: u.email, role: u.role, title: u.title } });
    users[u.key] = { id: created.id, name: created.name, role: u.role };
  }
  const admin: Actor = users.admin;
  const priya: Actor = users.priya;
  const marcus: Actor = users.marcus;
  const elena: Actor = users.elena;

  console.log("Seeding framework…");
  const questionIds = await seedFramework(db, 1);
  console.log(`  ${questionIds.size} questions`);

  console.log("Seeding projects…");
  const mk = (data: Parameters<typeof db.project.create>[0]["data"]) => db.project.create({ data });
  const dlp = await mk({
    key: "DLP", name: "DLP", criticality: "CRITICAL", lifecycleStatus: "GA", capabilities: "dlp", tags: "data-protection,flagship",
    description: "Enterprise Data Loss Prevention suite covering endpoint, network and cloud channels.",
    businessPurpose: "Prevents exfiltration of regulated and confidential data for enterprise customers; largest revenue line.",
    productOwner: "Jordan Blake", securityOwner: "Priya Nair", technicalOwner: "Wei Zhang",
  });
  const sse = await mk({
    key: "SSE", name: "Web Proxy / SSE", criticality: "CRITICAL", lifecycleStatus: "GA", capabilities: "swg", tags: "network,sse",
    description: "Cloud-delivered secure web gateway and Security Service Edge platform with global points of presence.",
    businessPurpose: "Inspects and controls customer web traffic, enforcing acceptable use, threat protection and data policies.",
    productOwner: "Maya Fischer", securityOwner: "Marcus Chen", technicalOwner: "Diego Alvarez",
  });
  const casb = await mk({
    key: "CASB", name: "CASB", criticality: "HIGH", lifecycleStatus: "GA", capabilities: "casb", tags: "saas,cloud",
    description: "Cloud Access Security Broker providing API-based and inline control of sanctioned SaaS applications.",
    businessPurpose: "Gives customers visibility and control over SaaS usage, sharing and configuration risk.",
    productOwner: "Hannah Lee", securityOwner: "Priya Nair", technicalOwner: "Tomasz Nowak",
  });
  const ztna = await mk({
    key: "ZTNA", name: "Zero Trust Network Access", criticality: "HIGH", lifecycleStatus: "DEVELOPMENT", capabilities: "ztna", tags: "network,new",
    description: "Private application access replacing VPN; currently in early-access with selected customers.",
    businessPurpose: "Provides identity-aware access to private applications without network-level exposure.",
    productOwner: "Grace Kim", securityOwner: "Marcus Chen", technicalOwner: "Omar Haddad",
  });
  const legacy = await mk({
    key: "LEG-EMAIL", name: "Legacy Email Gateway", criticality: "MEDIUM", lifecycleStatus: "SUNSET", capabilities: "", tags: "legacy",
    description: "On-premises email security gateway, end of sale. Archived from active reporting.",
    businessPurpose: "Remaining customers are being migrated to the cloud platform.",
    productOwner: "N/A", securityOwner: "Marcus Chen", technicalOwner: "Legacy support team",
    archived: true, archivedAt: d("2026-03-01"),
  });

  const sub = (parentId: string, data: { key: string; name: string; capabilities?: string; weight?: number; weightRationale?: string; criticality?: string; description: string; technicalOwner: string }) =>
    mk({ parentId, lifecycleStatus: "GA", criticality: data.criticality ?? "HIGH", productOwner: "", securityOwner: "", capabilities: data.capabilities ?? "", weight: data.weight ?? 1, weightRationale: data.weightRationale ?? "", key: data.key, name: data.name, description: data.description, technicalOwner: data.technicalOwner });

  const dlpEp = await sub(dlp.id, { key: "DLP-EP", name: "Endpoint DLP", capabilities: "dlp-endpoint", weight: 2, criticality: "CRITICAL", weightRationale: "Largest deployed footprint; kernel-level agent on customer endpoints.", description: "Windows/macOS agent enforcing DLP on endpoint channels (USB, print, clipboard, browser uploads).", technicalOwner: "Wei Zhang" });
  const dlpNet = await sub(dlp.id, { key: "DLP-NET", name: "Network DLP", description: "Network appliances and ICAP integrations inspecting email and web traffic.", technicalOwner: "Sofia Rossi" });
  const dlpCld = await sub(dlp.id, { key: "DLP-CLD", name: "Cloud DLP", description: "Cloud scanning service for data at rest in SaaS and IaaS storage.", technicalOwner: "Arjun Mehta" });
  const dlpMc = await sub(dlp.id, { key: "DLP-MC", name: "Management Console", description: "Multi-tenant console for policy authoring, incidents and reporting.", technicalOwner: "Lena Hoffmann" });
  const dlpPe = await sub(dlp.id, { key: "DLP-PE", name: "Policy Engine", criticality: "CRITICAL", description: "Detection engine and policy compiler shared by all DLP enforcement points.", technicalOwner: "Wei Zhang" });

  const sseGw = await sub(sse.id, { key: "SSE-GW", name: "Web Gateway", capabilities: "tls-inspection", criticality: "CRITICAL", description: "Global proxy fleet performing inspection and enforcement.", technicalOwner: "Diego Alvarez" });
  const sseTls = await sub(sse.id, { key: "SSE-TLS", name: "TLS Inspection", capabilities: "tls-inspection", criticality: "CRITICAL", description: "TLS interception service and inspection CA management.", technicalOwner: "Nadia Petrov" });
  const ssePe = await sub(sse.id, { key: "SSE-PE", name: "Policy Engine", description: "URL categorization and policy evaluation service.", technicalOwner: "Kenji Watanabe" });
  const sseTs = await sub(sse.id, { key: "SSE-TS", name: "Traffic Steering", description: "Endpoint client, PAC and tunnel-based steering of traffic to PoPs.", technicalOwner: "Laura Gomez" });
  await sub(sse.id, { key: "SSE-MC", name: "Management Console", description: "Administration portal for SSE tenants. Not yet assessed.", technicalOwner: "Lena Hoffmann" });

  const casbApi = await sub(casb.id, { key: "CASB-API", name: "API-Based CASB", description: "Out-of-band scanning and remediation via SaaS provider APIs.", technicalOwner: "Tomasz Nowak" });
  const casbInl = await sub(casb.id, { key: "CASB-INL", name: "Inline CASB", description: "Reverse/forward proxy controls for sanctioned SaaS sessions.", technicalOwner: "Ines Duarte" });
  const casbCon = await sub(casb.id, { key: "CASB-CON", name: "SaaS Connectors", criticality: "CRITICAL", description: "Connector framework and OAuth token management for 40+ SaaS apps.", technicalOwner: "Tomasz Nowak" });
  await sub(casb.id, { key: "CASB-ITM", name: "Identity and Tenant Management", description: "Tenant provisioning, SSO integration and user directory sync. Not yet assessed.", technicalOwner: "Ruth Abebe" });
  const casbPe = await sub(casb.id, { key: "CASB-PE", name: "Policy Engine", description: "Policy evaluation for API and inline CASB modes.", technicalOwner: "Kenji Watanabe" });

  console.log("Seeding assessment history…");
  type Plan = { project: { id: string; key: string }; family: string; base: number; assessor: Actor };
  const runCompleted = async (p: Plan, date: string, type: "BASELINE" | "PERIODIC", period: number, opts: { review?: "APPROVED" | "REJECTED" | "NONE"; basedOnId?: string; title?: string } = {}) => {
    const a = await createAssessment(db, p.assessor, {
      projectId: p.project.id,
      title: opts.title ?? `${p.project.key} ${type === "BASELINE" ? "baseline" : "periodic reassessment"} ${date.slice(0, 7)}`,
      type,
      scope: `Full applicable framework for ${p.project.key}. Interviews with technical owner and security champion; artifact review.`,
      assessorId: p.assessor.id,
      reviewerId: elena.id,
      assessmentDate: d(date),
      periodStart: addDays(d(date), -30),
      periodEnd: d(date),
      basedOnId: opts.basedOnId ?? null,
      copyResponses: false,
    });
    await writeResponses(a.id, p.project.id, p.project.key, { family: p.family, base: p.base, period, completeAll: true }, p.assessor.name);
    await db.assessment.update({ where: { id: a.id }, data: { status: "IN_PROGRESS" } });
    await completeAssessment(db, p.assessor, a.id);
    await db.assessment.update({ where: { id: a.id }, data: { submittedAt: addDays(d(date), 5) } });
    const review = opts.review ?? "APPROVED";
    if (review !== "NONE") {
      await reviewAssessment(db, elena, a.id, {
        decision: review,
        comments:
          review === "APPROVED"
            ? "Reviewed sampled evidence for critical questions; answers consistent with artifacts."
            : "Several Level 3+ answers on traffic steering lack supporting evidence. Please revise with artifacts.",
      });
      await db.assessment.update({ where: { id: a.id }, data: { reviewedAt: addDays(d(date), 12) } });
      await db.assessmentReview.updateMany({ where: { assessmentId: a.id }, data: { createdAt: addDays(d(date), 12) } });
    }
    return a;
  };

  const plans: Record<string, Plan> = {
    dlpEp: { project: dlpEp, family: "DLP", base: 2.9, assessor: priya },
    dlpNet: { project: dlpNet, family: "DLP", base: 2.6, assessor: priya },
    dlpCld: { project: dlpCld, family: "DLP", base: 2.3, assessor: priya },
    dlpMc: { project: dlpMc, family: "DLP", base: 3.1, assessor: marcus },
    dlpPe: { project: dlpPe, family: "DLP", base: 3.2, assessor: priya },
    sseGw: { project: sseGw, family: "SSE", base: 3.3, assessor: marcus },
    sseTls: { project: sseTls, family: "SSE", base: 3.0, assessor: marcus },
    ssePe: { project: ssePe, family: "SSE", base: 3.2, assessor: marcus },
    sseTs: { project: sseTs, family: "SSE", base: 2.7, assessor: marcus },
    casbApi: { project: casbApi, family: "CASB", base: 2.8, assessor: priya },
    casbInl: { project: casbInl, family: "CASB", base: 2.4, assessor: priya },
    casbCon: { project: casbCon, family: "CASB", base: 2.5, assessor: marcus },
    casbPe: { project: casbPe, family: "CASB", base: 2.6, assessor: priya },
    ztna: { project: ztna, family: "ZTNA", base: 2.7, assessor: marcus },
    legacy: { project: legacy, family: "LEG", base: 1.8, assessor: marcus },
  };

  // Legacy project (archived later in its lifecycle; assessment kept for history)
  await db.project.update({ where: { id: legacy.id }, data: { archived: false } });
  await runCompleted(plans.legacy, "2025-06-20", "BASELINE", 0);
  await db.project.update({ where: { id: legacy.id }, data: { archived: true, archivedAt: d("2026-03-01") } });

  // Baselines (Oct 2025)
  for (const k of ["dlpEp", "dlpNet", "dlpMc", "sseGw", "sseTls", "ssePe", "casbApi", "casbCon"]) await runCompleted(plans[k], "2025-10-15", "BASELINE", 0);
  // Traffic steering: baseline rejected, then a revision approved
  const tsRejected = await runCompleted(plans.sseTs, "2025-10-20", "BASELINE", 0, { review: "REJECTED" });
  await runCompleted(plans.sseTs, "2025-11-18", "BASELINE", 0, { basedOnId: tsRejected.id, title: "SSE-TS baseline 2025-11 (revision after review)" });
  // ZTNA baseline
  await runCompleted(plans.ztna, "2026-02-10", "BASELINE", 1);

  // Periodic reassessments (Apr 2026)
  const periodic: Record<string, string> = {};
  for (const k of ["dlpEp", "dlpNet", "dlpMc", "sseGw", "ssePe", "sseTs", "casbApi", "casbCon"]) {
    const a = await runCompleted(plans[k], "2026-04-15", "PERIODIC", 1);
    periodic[k] = a.id;
  }
  // TLS inspection periodic completed but still awaiting review
  periodic.sseTls = (await runCompleted(plans.sseTls, "2026-04-22", "PERIODIC", 1, { review: "NONE" })).id;
  // Policy engines first assessed in April
  await runCompleted(plans.dlpPe, "2026-04-18", "BASELINE", 1);
  periodic.casbInl = (await runCompleted(plans.casbInl, "2026-04-25", "BASELINE", 0)).id;

  // DLP parent-level oversight assessment (kept separate from the aggregated score)
  const oversight = await createAssessment(db, admin, {
    projectId: dlp.id,
    title: "DLP product-line oversight review 2026-05",
    type: "OVERSIGHT",
    scope: "Leadership-level review of the DLP product line as a whole. Does NOT contribute to the aggregated DLP score.",
    assessorId: admin.id,
    reviewerId: elena.id,
    assessmentDate: d("2026-05-20"),
    copyResponses: false,
  });
  await writeResponses(oversight.id, dlp.id, "DLP-OVERSIGHT", { family: "DLP", base: 1.9, period: 0, completeAll: true }, admin.name);
  await completeAssessment(db, admin, oversight.id);
  await reviewAssessment(db, elena, oversight.id, { decision: "APPROVED", comments: "Oversight view accepted; deliberately conservative." });

  console.log("Revising a question to demonstrate framework versioning…");
  const gov04 = await db.question.findUniqueOrThrow({ where: { key: "GOV-04" }, include: { versions: { include: { options: true } } } });
  const v1 = gov04.versions[0];
  await updateQuestion(db, admin, gov04.id, {
    key: "GOV-04",
    practiceId: gov04.practiceId,
    title: "Are product security policies and standards defined, communicated, maintained and exception-controlled?",
    description: v1.description + " Also verify that exceptions to standards are time-bound and visible in the exception register.",
    objective: v1.objective,
    rationale: v1.rationale,
    scope: v1.scope,
    guidance: v1.guidance,
    evidenceExamples: v1.evidenceExamples,
    evidenceRequired: v1.evidenceRequired,
    weight: v1.weight,
    criticality: v1.criticality as "MEDIUM",
    mandatory: v1.mandatory,
    applicabilityTags: v1.applicabilityTags,
    remediationGuidance: v1.remediationGuidance,
    references: v1.references,
    changeNote: "Clarified expectation that standard exceptions are time-bound (framework v2).",
    options: v1.options.map((o) => ({ level: o.level, label: o.label, description: o.description, criteria: o.criteria, examples: o.examples, gaps: o.gaps })),
  });

  console.log("Seeding current (draft) assessments…");
  // Endpoint DLP: reassessment carried forward from April, partially reconfirmed/changed
  const epDraft = await createAssessment(db, priya, {
    projectId: dlpEp.id,
    title: "DLP-EP periodic reassessment 2026-10",
    type: "PERIODIC",
    scope: "Semi-annual reassessment. Focus on enforcement integrity and supply chain after the agent update channel redesign.",
    assessorId: priya.id,
    reviewerId: elena.id,
    assessmentDate: d("2026-10-05"),
    basedOnId: periodic.dlpEp,
    copyResponses: true,
    focusDomainIds: (await db.securityDomain.findMany({ where: { key: { in: ["ENF", "SUP"] } } })).map((x) => x.id),
  });
  const epResponses = await db.assessmentResponse.findMany({ where: { assessmentId: epDraft.id }, include: { question: { include: { practice: { include: { domain: true } } } } } });
  for (const r of epResponses) {
    if (rand(`ep-confirm|${r.questionId}`) > 0.45) continue;
    const lvl = r.level === null ? null : levelFor("DLP-EP", r.question.practice.domain.key, r.question.key, { family: "DLP", base: 2.9, period: 2 });
    await db.assessmentResponse.update({ where: { id: r.id }, data: { confirmed: true, level: lvl, answeredBy: priya.name } });
  }
  await db.assessment.update({ where: { id: epDraft.id }, data: { status: "IN_PROGRESS" } });

  // Cloud DLP: first assessment in progress, ~35% answered
  const cldDraft = await createAssessment(db, priya, {
    projectId: dlpCld.id, title: "DLP-CLD baseline 2026-09", type: "BASELINE", scope: "First assessment of the Cloud DLP scanning service.",
    assessorId: priya.id, reviewerId: elena.id, assessmentDate: d("2026-09-22"), copyResponses: false,
  });
  await writeResponses(cldDraft.id, dlpCld.id, "DLP-CLD", { family: "DLP", base: 2.3, period: 0, answerRatio: 0.35 }, priya.name);
  await db.assessment.update({ where: { id: cldDraft.id }, data: { status: "IN_PROGRESS" } });

  // Inline CASB: reassessment in progress, fresh answers ~55%
  const inlDraft = await createAssessment(db, priya, {
    projectId: casbInl.id, title: "CASB-INL periodic reassessment 2026-10", type: "PERIODIC", scope: "Reassessment after inline proxy re-architecture.",
    assessorId: priya.id, reviewerId: elena.id, assessmentDate: d("2026-10-08"), basedOnId: periodic.casbInl, copyResponses: false,
  });
  await writeResponses(inlDraft.id, casbInl.id, "CASB-INL", { family: "CASB", base: 2.4, period: 1, answerRatio: 0.55 }, priya.name);
  await db.assessment.update({ where: { id: inlDraft.id }, data: { status: "IN_PROGRESS" } });

  // CASB Policy Engine: only a small draft (below coverage threshold -> Not assessed / insufficient)
  const pePDraft = await createAssessment(db, marcus, {
    projectId: casbPe.id, title: "CASB-PE baseline 2026-10", type: "BASELINE", scope: "Initial assessment; interviews scheduled.",
    assessorId: marcus.id, reviewerId: elena.id, assessmentDate: d("2026-10-12"), copyResponses: false,
  });
  await writeResponses(pePDraft.id, casbPe.id, "CASB-PE", { family: "CASB", base: 2.6, period: 0, answerRatio: 0.06 }, marcus.name);

  console.log("Seeding evidence…");
  const evidenceSpecs: { project: { id: string }; title: string; type: string; ref: string; status: "PENDING" | "VERIFIED" | "REJECTED"; q?: string; classification?: string; owner: string; collected: string }[] = [
    { project: dlpEp, title: "Endpoint agent threat model v4", type: "THREAT_MODEL", ref: "https://wiki.example.com/dlp/endpoint/threat-model-v4", status: "VERIFIED", q: "ARC-01", owner: "Wei Zhang", collected: "2026-03-30" },
    { project: dlpEp, title: "Agent tamper-resistance test report 2026-Q1", type: "PENTEST_REPORT", ref: "https://wiki.example.com/dlp/endpoint/tamper-tests-2026q1", status: "VERIFIED", q: "DLP-07", classification: "CONFIDENTIAL", owner: "Wei Zhang", collected: "2026-03-12" },
    { project: dlpEp, title: "Agent update signing pipeline description", type: "SECURITY_DESIGN", ref: "JIRA: DLPSEC-412", status: "PENDING", q: "SUP-04", owner: "Wei Zhang", collected: "2026-09-28" },
    { project: dlpNet, title: "Network DLP evasion corpus results", type: "CICD_OUTPUT", ref: "https://ci.example.com/dlp-net/evasion-suite/latest", status: "VERIFIED", q: "DLP-02", owner: "Sofia Rossi", collected: "2026-04-02" },
    { project: dlpMc, title: "Console authorization role-matrix test suite", type: "CICD_OUTPUT", ref: "https://ci.example.com/dlp-console/authz-matrix", status: "VERIFIED", q: "AUT-01", owner: "Lena Hoffmann", collected: "2026-04-05" },
    { project: dlpMc, title: "External pen test – DLP console 2026", type: "PENTEST_REPORT", ref: "Vendor report PT-2026-014 (restricted share)", status: "VERIFIED", q: "AST-04", classification: "RESTRICTED", owner: "Priya Nair", collected: "2026-02-20" },
    { project: dlpPe, title: "Policy bundle signing design", type: "SECURITY_DESIGN", ref: "https://wiki.example.com/dlp/policy-engine/bundle-signing", status: "PENDING", q: "DLP-06", owner: "Wei Zhang", collected: "2026-04-10" },
    { project: sseGw, title: "Gateway fleet CIS compliance scan", type: "COMPLIANCE", ref: "https://grc.example.com/controls/sse-gw/cis", status: "VERIFIED", q: "HRD-01", owner: "Diego Alvarez", collected: "2026-04-01" },
    { project: sseGw, title: "PoP failover chaos test results", type: "CICD_OUTPUT", ref: "https://ci.example.com/sse/chaos/pop-failover", status: "VERIFIED", q: "SWG-08", owner: "Diego Alvarez", collected: "2026-04-08" },
    { project: sseTls, title: "TLS conformance suite (CI nightly)", type: "CICD_OUTPUT", ref: "https://ci.example.com/sse-tls/conformance", status: "PENDING", q: "SWG-01", owner: "Nadia Petrov", collected: "2026-04-18" },
    { project: sseTls, title: "Inspection CA key HSM configuration", type: "POLICY_CONFIGURATION", ref: "Vault path: kms/sse-tls/ca (restricted)", status: "PENDING", q: "DAT-05", classification: "RESTRICTED", owner: "Nadia Petrov", collected: "2026-04-18" },
    { project: sseTs, title: "Steering bypass detection report", type: "SAST_DAST_REPORT", ref: "https://wiki.example.com/sse/steering/bypass-detection", status: "REJECTED", q: "SWG-02", owner: "Laura Gomez", collected: "2025-10-10" },
    { project: casbCon, title: "Connector token storage design (per-tenant keys)", type: "SECURITY_DESIGN", ref: "https://wiki.example.com/casb/connectors/token-storage", status: "VERIFIED", q: "CASB-01", classification: "CONFIDENTIAL", owner: "Tomasz Nowak", collected: "2026-04-11" },
    { project: casbCon, title: "OAuth scope inventory per connector", type: "POLICY_CONFIGURATION", ref: "https://wiki.example.com/casb/connectors/scopes", status: "PENDING", q: "CASB-02", owner: "Tomasz Nowak", collected: "2026-04-11" },
    { project: casbApi, title: "Sync reconciliation job runbook", type: "SECURITY_DESIGN", ref: "JIRA: CASB-2291", status: "PENDING", q: "CASB-04", owner: "Tomasz Nowak", collected: "2026-04-14" },
    { project: ztna, title: "ZTNA architecture and trust boundaries", type: "ARCHITECTURE_DIAGRAM", ref: "https://wiki.example.com/ztna/architecture", status: "VERIFIED", q: "ARC-03", owner: "Omar Haddad", collected: "2026-02-01" },
    { project: ztna, title: "IR tabletop – connector credential leak", type: "INCIDENT_EXERCISE", ref: "https://wiki.example.com/ir/tabletops/2026-01", status: "VERIFIED", q: "IR-03", owner: "Marcus Chen", collected: "2026-01-28" },
  ];
  const evidenceIds: string[] = [];
  for (const e of evidenceSpecs) {
    const ev = await db.evidence.create({
      data: {
        projectId: e.project.id, title: e.title, type: e.type, reference: e.ref, ownerName: e.owner,
        description: `Artifact supporting ${e.q ?? "the assessment"}. Demo data – fictional link.`,
        classification: e.classification ?? "INTERNAL", collectedAt: d(e.collected),
        verificationStatus: e.status, verifiedBy: e.status === "PENDING" ? "" : elena.name,
        lastVerifiedAt: e.status === "VERIFIED" ? addDays(d(e.collected), 7) : null,
        verificationNote: e.status === "REJECTED" ? "Report predates the steering redesign; does not cover tunnel mode." : e.status === "VERIFIED" ? "Reviewed artifact contents; matches the asserted level." : "",
        createdBy: priya.name,
      },
    });
    evidenceIds.push(ev.id);
    if (e.q) {
      const q = await db.question.findUnique({ where: { key: e.q } });
      const responses = await db.assessmentResponse.findMany({ where: { questionId: q!.id, assessment: { projectId: e.project.id } } });
      for (const r of responses) await db.evidenceLink.create({ data: { evidenceId: ev.id, responseId: r.id } });
    }
  }

  console.log("Seeding remediation actions from current gaps…");
  const portfolio = await computePortfolio(db);
  const gaps = collectGaps(portfolio);
  const now = new Date("2026-10-14T00:00:00Z");
  const owners = ["Wei Zhang", "Sofia Rossi", "Lena Hoffmann", "Diego Alvarez", "Nadia Petrov", "Laura Gomez", "Tomasz Nowak", "Ines Duarte", "Omar Haddad"];
  const statuses = ["OPEN", "IN_PROGRESS", "IN_PROGRESS", "BLOCKED", "PENDING_VERIFICATION", "OPEN", "CLOSED", "IN_PROGRESS"];
  const picked = new Map<string, number>();
  let i = 0;
  for (const g of gaps) {
    const count = picked.get(g.projectId) ?? 0;
    if (count >= 3) continue;
    picked.set(g.projectId, count + 1);
    const response = await db.assessmentResponse.findFirst({ where: { assessmentId: g.assessmentId, questionId: g.questionId } });
    const qv = await db.questionVersion.findFirst({ where: { questionId: g.questionId }, orderBy: { version: "desc" } });
    const priority = g.criticality === "CRITICAL" ? (g.level === 1 ? "CRITICAL" : "HIGH") : g.level === 1 ? "HIGH" : "MEDIUM";
    const status = statuses[i % statuses.length];
    const sla = priority === "CRITICAL" ? 30 : priority === "HIGH" ? 60 : 90;
    const target = addDays(now, [-20, 15, 40, 75, -6, 60, 30, 100][i % 8]); // ~25% overdue
    const created = addDays(target, -sla);
    await db.remediationAction.create({
      data: {
        title: `Raise ${g.questionKey} maturity for ${g.projectName}`,
        description: `Address the maturity gap identified for "${g.title}".`,
        projectId: g.projectId,
        domainId: g.domainId,
        practiceId: g.practiceId,
        questionId: g.questionId,
        assessmentId: g.assessmentId,
        responseId: response?.id ?? null,
        gap: `Assessed at Level ${g.level} (${DEFAULT_LEVEL_LABELS[g.level]}) on a ${g.criticality} question in ${g.domainName}.`,
        priority,
        owner: owners[i % owners.length],
        targetDate: target,
        status,
        recommendation: qv?.remediationGuidance ?? "",
        completionEvidence: status === "CLOSED" ? "Implementation merged and verified in staging; see linked evidence." : "",
        closureNote: status === "CLOSED" ? "Verified by product security during follow-up review." : "",
        closedAt: status === "CLOSED" ? addDays(target, -5) : null,
        closedBy: status === "CLOSED" ? elena.name : "",
        createdBy: g.mainProjectName === "CASB" ? priya.name : marcus.name,
        createdAt: created,
      },
    });
    i++;
  }
  // An accepted risk and a manual governance action
  await db.remediationAction.create({
    data: {
      title: "Legacy TLS 1.0 support for on-prem ICAP integrations",
      description: "Some customers' ICAP servers only support TLS 1.0. Risk accepted until migration tooling ships.",
      projectId: dlpNet.id, priority: "MEDIUM", owner: "Sofia Rossi", status: "ACCEPTED_RISK",
      gap: "Weak protocol supported for backward compatibility.", recommendation: "Ship migration tooling and remove TLS 1.0 support.",
      closureNote: "Compensating control: ICAP traffic restricted to customer LAN; monitoring alerts on TLS 1.0 sessions.",
      riskAcceptedBy: elena.name, riskAcceptedUntil: d("2027-01-31"), closedAt: d("2026-08-01"), closedBy: elena.name,
      targetDate: d("2026-12-31"), createdBy: priya.name, createdAt: d("2026-07-20"),
    },
  });
  await db.remediationAction.create({
    data: {
      title: "Publish organization-wide product security strategy",
      description: "Consolidate product-line strategies into an approved organization strategy with measurable objectives.",
      projectId: sse.id, priority: "HIGH", owner: "Alex Rivera", status: "IN_PROGRESS",
      gap: "Strategy objectives differ between product lines; no single approval.", recommendation: "Draft, review with product VPs, approve by CISO.",
      targetDate: d("2026-09-30"), createdBy: admin.name, createdAt: d("2026-06-01"),
    },
  });
  // Link some evidence to an action
  const firstAction = await db.remediationAction.findFirst({ where: { status: "PENDING_VERIFICATION" } });
  if (firstAction) await db.evidenceLink.create({ data: { evidenceId: evidenceIds[2], actionId: firstAction.id } });

  const counts = {
    projects: await db.project.count(),
    questions: await db.question.count(),
    assessments: await db.assessment.count(),
    responses: await db.assessmentResponse.count(),
    actions: await db.remediationAction.count(),
    evidence: await db.evidence.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
