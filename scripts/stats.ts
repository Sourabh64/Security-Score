/** Prints framework statistics (domains, practices, questions, options). Usage: npx tsx scripts/stats.ts */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  const [d, p, q, generic, opts, versions] = await Promise.all([
    db.securityDomain.count(), db.securityPractice.count(), db.question.count(),
    db.questionVersion.count({ where: { version: 1, applicabilityTags: "" } }), db.answerOption.count(), db.questionVersion.count(),
  ]);
  console.log({ domains: d, practices: p, questions: q, genericQuestions: generic, productSpecific: q - generic, questionVersions: versions, answerOptions: opts });
  await db.$disconnect();
})();
