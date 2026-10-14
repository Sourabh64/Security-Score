import "server-only";
import { db } from "./db";
import { getScoringContext, loadFrameworkTree } from "./framework";

/** Options for the remediation action form. */
export async function actionFormData() {
  const [projects, tree, ctx] = await Promise.all([
    db.project.findMany({ where: { archived: false }, include: { parent: true }, orderBy: { name: "asc" } }),
    loadFrameworkTree(db),
    getScoringContext(db),
  ]);
  return {
    projects: projects
      .map((p) => ({ id: p.id, label: `${p.parent ? `${p.parent.name} / ` : ""}${p.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    domains: tree.map((d) => ({ id: d.id, name: d.name })),
    questions: tree.flatMap((d) =>
      d.practices.flatMap((p) =>
        p.questions.map((q) => ({ id: q.id, key: q.key, title: q.current?.title ?? q.key, domainId: d.id, practiceId: p.id, remediation: q.current?.remediationGuidance ?? "" })),
      ),
    ),
    slaDays: ctx.slaDays,
  };
}
