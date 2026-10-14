import type { Db, Tx } from "../db";
import { ServiceError, notFound } from "../errors";
import { requirePermission, type Actor } from "../permissions";
import { audit } from "../audit";
import { bumpFrameworkVersion } from "../framework";
import {
  domainSchema,
  levelsSchema,
  practiceSchema,
  questionSchema,
  settingsSchema,
  userSchema,
  weightSchema,
  type QuestionInput,
} from "@/lib/validation";

// ---------------------------------------------------------------- settings
export async function updateSettings(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "settings:admin");
  const data = settingsSchema.parse(input);
  return db.$transaction(async (tx) => {
    const s = await tx.organizationSettings.update({
      where: { id: 1 },
      data: { ...data, remediationSlaDays: JSON.stringify(data.remediationSlaDays) },
    });
    await audit(tx, actor, "update", "OrganizationSettings", "1", "settings updated");
    return s;
  });
}

/** Maturity anchors only affect live (draft) scores; completed snapshots keep the anchors used at completion. */
export async function updateMaturityLevels(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "settings:admin");
  const levels = levelsSchema.parse(input);
  await db.$transaction(async (tx) => {
    for (const l of levels)
      await tx.maturityLevel.upsert({ where: { level: l.level }, update: l, create: l });
    await bumpFrameworkVersion(tx, actor, `Maturity level labels/anchors updated (${levels.map((l) => l.anchor).join("/")})`);
    await audit(tx, actor, "update", "MaturityLevel", "all", "anchors updated");
  });
}

// ---------------------------------------------------------------- users
export async function upsertUser(db: Db, actor: Actor, id: string | null, input: unknown) {
  requirePermission(actor, "users:admin");
  const data = userSchema.parse(input);
  const clash = await db.user.findFirst({ where: { email: data.email, ...(id ? { NOT: { id } } : {}) } });
  if (clash) throw new ServiceError("A user with this email already exists", "CONFLICT");
  if (id && id === actor.id && (data.role !== "ADMIN" || !data.active))
    throw new ServiceError("You cannot remove your own administrator access");
  return db.$transaction(async (tx) => {
    const u = id ? await tx.user.update({ where: { id }, data }) : await tx.user.create({ data });
    await audit(tx, actor, id ? "update" : "create", "User", u.id, `${u.name} (${u.role})`);
    return u;
  });
}

// ---------------------------------------------------------------- domains
async function uniqueKey(tx: Db | Tx, model: "securityDomain" | "securityPractice" | "question", key: string, exceptId?: string) {
  const where = { key, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
  const existing =
    model === "securityDomain"
      ? await tx.securityDomain.findFirst({ where })
      : model === "securityPractice"
        ? await tx.securityPractice.findFirst({ where })
        : await tx.question.findFirst({ where });
  if (existing) throw new ServiceError(`Identifier "${key}" is already in use`, "CONFLICT");
}

export async function upsertDomain(db: Db, actor: Actor, id: string | null, input: unknown) {
  requirePermission(actor, "framework:admin");
  const data = domainSchema.parse(input);
  await uniqueKey(db, "securityDomain", data.key, id ?? undefined);
  return db.$transaction(async (tx) => {
    const max = await tx.securityDomain.aggregate({ _max: { order: true } });
    const d = id
      ? await tx.securityDomain.update({ where: { id }, data })
      : await tx.securityDomain.create({ data: { ...data, order: (max._max.order ?? 0) + 1 } });
    await bumpFrameworkVersion(tx, actor, `${id ? "Updated" : "Added"} domain ${d.key} (weight ${d.weight})`);
    await audit(tx, actor, id ? "update" : "create", "SecurityDomain", d.id, d.name);
    return d;
  });
}

export async function setDomainActive(db: Db, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "framework:admin");
  return db.$transaction(async (tx) => {
    const d = await tx.securityDomain.update({ where: { id }, data: { active } });
    await bumpFrameworkVersion(tx, actor, `${active ? "Activated" : "Deactivated"} domain ${d.key}`);
    await audit(tx, actor, active ? "activate" : "deactivate", "SecurityDomain", id, d.name);
    return d;
  });
}

async function moveOrdered(
  tx: Tx,
  rows: { id: string; order: number }[],
  id: string,
  direction: "up" | "down",
  update: (id: string, order: number) => Promise<unknown>,
) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((r) => r.id === id);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= sorted.length) return;
  [sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]];
  for (let i = 0; i < sorted.length; i++) await update(sorted[i].id, i + 1);
}

export async function moveDomain(db: Db, actor: Actor, id: string, direction: "up" | "down") {
  requirePermission(actor, "framework:admin");
  await db.$transaction(async (tx) => {
    const rows = await tx.securityDomain.findMany({ select: { id: true, order: true } });
    await moveOrdered(tx, rows, id, direction, (rid, order) => tx.securityDomain.update({ where: { id: rid }, data: { order } }));
  });
}

// ---------------------------------------------------------------- practices
export async function upsertPractice(db: Db, actor: Actor, id: string | null, input: unknown) {
  requirePermission(actor, "framework:admin");
  const data = practiceSchema.parse(input);
  await uniqueKey(db, "securityPractice", data.key, id ?? undefined);
  if (!(await db.securityDomain.findUnique({ where: { id: data.domainId } }))) throw notFound("Domain");
  return db.$transaction(async (tx) => {
    const max = await tx.securityPractice.aggregate({ where: { domainId: data.domainId }, _max: { order: true } });
    const p = id
      ? await tx.securityPractice.update({ where: { id }, data })
      : await tx.securityPractice.create({ data: { ...data, order: (max._max.order ?? 0) + 1 } });
    await bumpFrameworkVersion(tx, actor, `${id ? "Updated" : "Added"} practice ${p.key} (weight ${p.weight})`);
    await audit(tx, actor, id ? "update" : "create", "SecurityPractice", p.id, p.name);
    return p;
  });
}

export async function setPracticeActive(db: Db, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "framework:admin");
  return db.$transaction(async (tx) => {
    const p = await tx.securityPractice.update({ where: { id }, data: { active } });
    await bumpFrameworkVersion(tx, actor, `${active ? "Activated" : "Deactivated"} practice ${p.key}`);
    await audit(tx, actor, active ? "activate" : "deactivate", "SecurityPractice", id, p.name);
    return p;
  });
}

export async function movePractice(db: Db, actor: Actor, id: string, direction: "up" | "down") {
  requirePermission(actor, "framework:admin");
  await db.$transaction(async (tx) => {
    const p = await tx.securityPractice.findUnique({ where: { id } });
    if (!p) throw notFound("Practice");
    const rows = await tx.securityPractice.findMany({ where: { domainId: p.domainId }, select: { id: true, order: true } });
    await moveOrdered(tx, rows, id, direction, (rid, order) => tx.securityPractice.update({ where: { id: rid }, data: { order } }));
  });
}

/** Duplicates a practice (and its current question versions) to create a product-specific variant. */
export async function duplicatePractice(db: Db, actor: Actor, id: string, newKey: string, newName: string, applicabilityTags?: string) {
  requirePermission(actor, "framework:admin");
  const src = await db.securityPractice.findUnique({
    where: { id },
    include: { questions: { include: { versions: { include: { options: true } } } } },
  });
  if (!src) throw notFound("Practice");
  const key = practiceSchema.shape.key.parse(newKey);
  await uniqueKey(db, "securityPractice", key);
  return db.$transaction(async (tx) => {
    const p = await tx.securityPractice.create({
      data: { key, name: newName || `${src.name} (copy)`, description: src.description, domainId: src.domainId, weight: src.weight, order: src.order + 1, active: true },
    });
    const fv = await bumpFrameworkVersion(tx, actor, `Duplicated practice ${src.key} as ${key}`);
    let i = 0;
    for (const q of src.questions) {
      const cur = q.versions.find((v) => v.version === q.currentVersion);
      if (!cur) continue;
      const qKey = `${q.key}-${key}`.slice(0, 32);
      await createQuestionRecord(tx, actor, {
        ...stripVersion(cur),
        key: qKey,
        practiceId: p.id,
        applicabilityTags: applicabilityTags ?? cur.applicabilityTags,
        changeNote: `Duplicated from ${q.key}`,
        options: cur.options.map((o) => ({ level: o.level, label: o.label, description: o.description, criteria: o.criteria, examples: o.examples, gaps: o.gaps })),
      }, fv, ++i);
    }
    await audit(tx, actor, "duplicate", "SecurityPractice", p.id, `${src.key} -> ${key}`);
    return p;
  });
}

// ---------------------------------------------------------------- questions
type VersionRow = {
  title: string; description: string; objective: string; rationale: string; scope: string; guidance: string;
  evidenceExamples: string; evidenceRequired: boolean; weight: number; criticality: string; mandatory: boolean;
  applicabilityTags: string; remediationGuidance: string; references: string;
};
function stripVersion(v: VersionRow): Omit<QuestionInput, "key" | "practiceId" | "options"> {
  return {
    title: v.title, description: v.description, objective: v.objective, rationale: v.rationale, scope: v.scope,
    guidance: v.guidance, evidenceExamples: v.evidenceExamples, evidenceRequired: v.evidenceRequired, weight: v.weight,
    criticality: v.criticality as QuestionInput["criticality"], mandatory: v.mandatory, applicabilityTags: v.applicabilityTags,
    remediationGuidance: v.remediationGuidance, references: v.references,
  };
}

/** Creates the Question identity plus version 1 (used by admin UI, duplication and the seed). */
export async function createQuestionRecord(tx: Tx, actor: Actor | null, input: QuestionInput, frameworkVersion: number, order?: number) {
  const data = questionSchema.parse(input);
  const { options, key, practiceId, ...version } = data;
  const max = order ?? ((await tx.question.aggregate({ where: { practiceId }, _max: { order: true } }))._max.order ?? 0) + 1;
  const q = await tx.question.create({ data: { key, practiceId, order: max, currentVersion: 1 } });
  await tx.questionVersion.create({
    data: {
      ...version,
      questionId: q.id,
      version: 1,
      frameworkVersion,
      createdBy: actor?.name ?? "seed",
      options: { create: options },
    },
  });
  return q;
}

export async function createQuestion(db: Db, actor: Actor, input: QuestionInput) {
  requirePermission(actor, "framework:admin");
  const data = questionSchema.parse(input);
  await uniqueKey(db, "question", data.key);
  if (!(await db.securityPractice.findUnique({ where: { id: data.practiceId } }))) throw notFound("Practice");
  return db.$transaction(async (tx) => {
    const fv = await bumpFrameworkVersion(tx, actor, `Added question ${data.key}`);
    const q = await createQuestionRecord(tx, actor, data, fv);
    await audit(tx, actor, "create", "Question", q.id, data.key);
    return q;
  });
}

/**
 * Editing a question NEVER mutates an existing version. A new immutable QuestionVersion is created and
 * becomes current. Completed assessments keep referencing the version they were answered against.
 */
export async function updateQuestion(db: Db, actor: Actor, id: string, input: QuestionInput) {
  requirePermission(actor, "framework:admin");
  const data = questionSchema.parse(input);
  const q = await db.question.findUnique({ where: { id } });
  if (!q) throw notFound("Question");
  await uniqueKey(db, "question", data.key, id);
  if (!(await db.securityPractice.findUnique({ where: { id: data.practiceId } }))) throw notFound("Practice");
  const { options, key, practiceId, ...version } = data;
  return db.$transaction(async (tx) => {
    const latest = await tx.questionVersion.aggregate({ where: { questionId: id }, _max: { version: true } });
    const next = (latest._max.version ?? 0) + 1;
    const fv = await bumpFrameworkVersion(tx, actor, `Question ${key} revised to v${next}${data.changeNote ? `: ${data.changeNote}` : ""}`);
    await tx.questionVersion.create({
      data: { ...version, questionId: id, version: next, frameworkVersion: fv, createdBy: actor.name, options: { create: options } },
    });
    const updated = await tx.question.update({ where: { id }, data: { key, practiceId, currentVersion: next } });
    await audit(tx, actor, "revise", "Question", id, `${key} v${next}`);
    return updated;
  });
}

export async function setQuestionActive(db: Db, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "framework:admin");
  return db.$transaction(async (tx) => {
    const q = await tx.question.update({ where: { id }, data: { active } });
    await bumpFrameworkVersion(tx, actor, `${active ? "Activated" : "Deactivated"} question ${q.key}`);
    await audit(tx, actor, active ? "activate" : "deactivate", "Question", id, q.key);
    return q;
  });
}

export async function moveQuestion(db: Db, actor: Actor, id: string, direction: "up" | "down") {
  requirePermission(actor, "framework:admin");
  await db.$transaction(async (tx) => {
    const q = await tx.question.findUnique({ where: { id } });
    if (!q) throw notFound("Question");
    const rows = await tx.question.findMany({ where: { practiceId: q.practiceId }, select: { id: true, order: true } });
    await moveOrdered(tx, rows, id, direction, (rid, order) => tx.question.update({ where: { id: rid }, data: { order } }));
  });
}

export async function duplicateQuestion(db: Db, actor: Actor, id: string, newKey: string, overrides: { applicabilityTags?: string; practiceId?: string } = {}) {
  requirePermission(actor, "framework:admin");
  const q = await db.question.findUnique({ where: { id }, include: { versions: { include: { options: true } } } });
  if (!q) throw notFound("Question");
  const cur = q.versions.find((v) => v.version === q.currentVersion)!;
  return createQuestion(db, actor, {
    ...stripVersion(cur),
    key: newKey,
    practiceId: overrides.practiceId ?? q.practiceId,
    applicabilityTags: overrides.applicabilityTags ?? cur.applicabilityTags,
    title: `${cur.title} (variant)`,
    changeNote: `Duplicated from ${q.key}`,
    options: cur.options.map((o) => ({ level: o.level, label: o.label, description: o.description, criteria: o.criteria, examples: o.examples, gaps: o.gaps })),
  });
}

/** Updates only the weight of a domain/practice (convenience for the weights screen). */
export async function setFrameworkWeight(db: Db, actor: Actor, kind: "domain" | "practice", id: string, weight: unknown) {
  requirePermission(actor, "framework:admin");
  const w = weightSchema.parse(weight);
  return db.$transaction(async (tx) => {
    const row = kind === "domain"
      ? await tx.securityDomain.update({ where: { id }, data: { weight: w } })
      : await tx.securityPractice.update({ where: { id }, data: { weight: w } });
    await bumpFrameworkVersion(tx, actor, `Weight of ${kind} ${row.key} set to ${w}`);
    return row;
  });
}
