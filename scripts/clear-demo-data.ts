/**
 * Removes the demo portfolio so you can start with your own data.
 *
 * Deletes: projects/subprojects, assessments, responses, reviews, score snapshots, evidence (and uploaded
 *          files), remediation actions, the audit trail and the demo users.
 * Keeps:   the assessment framework (domains, practices, questions, versions), maturity levels and settings.
 * Creates: a single Administrator account so the app stays usable.
 *
 * Usage: npm run db:clear -- --yes
 */
import { PrismaClient } from "@prisma/client";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEMO_ORG_NAME = "Northwind Security Inc.";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log("This permanently deletes all projects, assessments, evidence, actions, audit events and users.");
    console.log("The question framework, maturity levels and settings are kept.");
    console.log("\nRe-run with --yes to proceed:  npm run db:clear -- --yes");
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    const before = {
      projects: await db.project.count(),
      assessments: await db.assessment.count(),
      evidence: await db.evidence.count(),
      actions: await db.remediationAction.count(),
      users: await db.user.count(),
    };
    await db.$transaction([
      db.auditEvent.deleteMany(),
      db.evidenceLink.deleteMany(),
      db.evidence.deleteMany(),
      db.remediationAction.deleteMany(),
      db.scoreSnapshot.deleteMany(),
      db.assessmentReview.deleteMany(),
      db.assessmentResponse.deleteMany(),
      db.assessment.deleteMany(),
      db.project.updateMany({ data: { parentId: null } }),
      db.project.deleteMany(),
      db.user.deleteMany(),
      db.user.create({ data: { name: "Administrator", email: "admin@example.com", role: "ADMIN", title: "Change me in Administration" } }),
    ]);
    // Replace the fictional demo organization name; keep any name you set yourself.
    await db.organizationSettings.updateMany({ where: { orgName: DEMO_ORG_NAME }, data: { orgName: "Your Organization" } });

    const uploads = path.resolve(process.cwd(), process.env.EVIDENCE_UPLOAD_DIR || "data/uploads");
    rmSync(uploads, { recursive: true, force: true });
    mkdirSync(uploads, { recursive: true });
    writeFileSync(path.join(uploads, ".gitkeep"), "");

    console.log("Removed:", before);
    console.log("Kept:", {
      domains: await db.securityDomain.count(),
      questions: await db.question.count(),
      maturityLevels: await db.maturityLevel.count(),
    });
    console.log('Created user "Administrator" (admin@example.com). Rename it and add your team under Administration → Users & roles.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
