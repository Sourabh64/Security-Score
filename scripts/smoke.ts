/** Fetches every page type from a running server and reports status codes. Usage: npx tsx scripts/smoke.ts [baseUrl] */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const base = process.argv[2] ?? "http://localhost:3000";
(async () => {
  const [proj, sub, a, done, act, ev, dom, q] = await Promise.all([
    db.project.findFirst({ where: { key: "DLP" } }), db.project.findFirst({ where: { key: "DLP-EP" } }),
    db.assessment.findFirst({ where: { status: "IN_PROGRESS" } }), db.assessment.findFirst({ where: { status: "REVIEWED" } }),
    db.remediationAction.findFirst(), db.evidence.findFirst(), db.securityDomain.findFirst(), db.question.findFirst({ where: { key: "GOV-04" } }),
  ]);
  const paths = [
    "/", "/projects", "/projects?show=all&sort=score", "/projects/new", `/projects/${proj!.id}`, `/projects/${sub!.id}`, `/projects/${proj!.id}/edit`,
    "/assessments", "/assessments/new", `/assessments/${a!.id}`, `/assessments/${done!.id}`, `/assessments/${done!.id}/report`,
    "/heatmap", "/compare", "/domains", `/domains/${dom!.id}`, "/actions", "/actions?overdue=1", "/actions/new", `/actions/${act!.id}`,
    "/evidence", "/evidence/new", `/evidence/${ev!.id}`, "/reports", "/reports/view?scope=org", `/reports/view?scope=project&id=${proj!.id}`, `/reports/view?scope=domain&id=${dom!.id}`,
    "/framework", `/framework/questions/${q!.id}`, `/framework/questions/${q!.id}?v=1`, "/admin", "/admin/framework", "/admin/questions/new", `/admin/questions/${q!.id}`,
    "/api/export/scores", "/api/export/responses", "/api/export/actions?status=any", "/api/export/snapshots", "/projects/doesnotexist",
  ];
  let failures = 0;
  for (const path of paths) {
    const t = Date.now();
    const r = await fetch(base + path);
    const body = await r.text();
    const bad = r.status >= 500 || (r.status !== 200 && !path.includes("doesnotexist")) || body.includes("Something went wrong");
    if (bad) failures++;
    console.log(`${bad ? "FAIL" : " ok "} ${r.status} ${String(Date.now() - t).padStart(5)}ms ${path}`);
  }
  console.log(failures ? `${failures} failures` : "all pages OK");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
})();
