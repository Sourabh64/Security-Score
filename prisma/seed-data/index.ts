import type { PrismaClient } from "@prisma/client";
import type { SeedDomain, SeedQuestion } from "./types";
import { domainsA } from "./domains-a";
import { domainsB } from "./domains-b";
import { domainsC } from "./domains-c";
import { domainsD } from "./domains-d";
import { domainsE } from "./domains-e";
import { createQuestionRecord } from "../../src/server/services/admin";
import { DEFAULT_LEVEL_LABELS } from "../../src/lib/constants";

const ORDER = ["GOV", "REQ", "ARC", "SDL", "AST", "VUL", "IAM", "AUT", "DAT", "CLD", "API", "LOG", "IR", "RES", "SUP", "PRV", "REL", "HRD", "ENF", "VER"];

export const allDomains: SeedDomain[] = [...domainsA, ...domainsB, ...domainsC, ...domainsD, ...domainsE].sort(
  (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key),
);

function scopeText(q: SeedQuestion): string {
  if (q.scope) return q.scope;
  if (q.tags)
    return `Applies only to projects or subprojects whose product profile includes the capability: ${q.tags
      .split(",")
      .map((t) => `"${t.trim()}"`)
      .join(" or ")}. Not counted for other products.`;
  return "Applies to every product and subproject. Assess the component in scope of this assessment; for parent-level oversight assessments, assess the product line as a whole.";
}

/** Converts the compact authoring format into the question input used by the admin service. */
export function toQuestionInput(q: SeedQuestion, practiceId: string) {
  return {
    key: q.key,
    practiceId,
    title: q.t,
    description: q.d,
    objective: q.o,
    rationale: q.r,
    scope: scopeText(q),
    guidance: q.g,
    evidenceExamples: q.e,
    evidenceRequired: q.evidenceRequired ?? false,
    weight: q.w ?? 1,
    criticality: q.c,
    mandatory: q.mandatory ?? true,
    applicabilityTags: q.tags ?? "",
    remediationGuidance: q.rem,
    references: q.ref,
    changeNote: "Initial version",
    options: q.L.map((l, i) => ({
      level: i + 1,
      label: `${DEFAULT_LEVEL_LABELS[i + 1]}: ${l[0]}`,
      description: l[1],
      criteria: l[2],
      examples: l[3],
      gaps: i < 4 ? `Not yet in place compared with Level ${i + 2}: ${q.L[i + 1][2]}` : "",
    })),
  };
}

/** Inserts the full seeded framework (20 domains, practices and questions). */
export async function seedFramework(db: PrismaClient, frameworkVersion = 1) {
  const questionIds = new Map<string, string>();
  let dOrder = 0;
  for (const d of allDomains) {
    const domain = await db.securityDomain.create({
      data: { key: d.key, name: d.name, description: d.description, sammFunction: d.samm, order: ++dOrder, weight: 1 },
    });
    let pOrder = 0;
    for (const p of d.practices) {
      const practice = await db.securityPractice.create({
        data: { key: p.key, name: p.name, description: p.description, domainId: domain.id, order: ++pOrder, weight: 1 },
      });
      let qOrder = 0;
      for (const q of p.questions) {
        const created = await db.$transaction((tx) => createQuestionRecord(tx, null, toQuestionInput(q, practice.id), frameworkVersion, ++qOrder));
        questionIds.set(q.key, created.id);
      }
    }
  }
  return questionIds;
}
