import { z } from "zod";
import {
  ASSESSMENT_TYPES,
  CLASSIFICATIONS,
  CRITICALITIES,
  EVIDENCE_TYPES,
  LIFECYCLE_STATUSES,
  PRIORITIES,
  RESPONSE_STATUSES,
  ROLES,
  SAMM_FUNCTIONS,
  SCORE_BASIS,
  ACTION_WORKING_STATUSES,
} from "./constants";

const text = (max: number) => z.string().trim().max(max, `Must be at most ${max} characters`);
const req = (max: number, label: string) => z.string().trim().min(1, `${label} is required`).max(max);
const optDate = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });
const reqDate = optDate.refine((d) => d !== null, "Date is required").transform((d) => d as Date);

export const weightSchema = z.coerce
  .number({ invalid_type_error: "Weight must be a number" })
  .refine((n) => Number.isFinite(n), "Weight must be a finite number")
  .refine((n) => n >= 0 && n <= 100, "Weight must be between 0 and 100");

/** Comma separated list of lowercase identifiers. */
const tagList = text(500).transform((s) =>
  [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))].join(","),
);
const capabilityList = text(500)
  .transform((s) => [...new Set(s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].join(","))
  .refine((s) => s.split(",").every((t) => t === "" || /^[a-z0-9][a-z0-9-]{0,40}$/.test(t)), {
    message: "Capabilities must be lowercase identifiers (letters, digits, hyphens) separated by commas",
  });

export const keySchema = z
  .string()
  .trim()
  .min(2, "Identifier must be at least 2 characters")
  .max(32)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z0-9][A-Z0-9_.-]*$/.test(s), "Identifier may contain only letters, digits, '-', '_' and '.'");

export const projectSchema = z.object({
  key: keySchema,
  name: req(120, "Name"),
  description: text(4000).default(""),
  businessPurpose: text(4000).default(""),
  productOwner: text(120).default(""),
  securityOwner: text(120).default(""),
  technicalOwner: text(120).default(""),
  criticality: z.enum(CRITICALITIES),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES),
  tags: tagList.default(""),
  capabilities: capabilityList.default(""),
  weight: weightSchema.default(1),
  weightRationale: text(1000).default(""),
  parentId: z.string().trim().min(1).nullable().optional().transform((v) => v || null),
});
export type ProjectInput = z.input<typeof projectSchema>;

export const assessmentCreateSchema = z.object({
  projectId: req(64, "Project"),
  title: req(200, "Title"),
  scope: text(4000).default(""),
  type: z.enum(ASSESSMENT_TYPES),
  assessorId: z.string().trim().nullable().optional().transform((v) => v || null),
  reviewerId: z.string().trim().nullable().optional().transform((v) => v || null),
  assessmentDate: reqDate,
  periodStart: optDate.optional().transform((v) => v ?? null),
  periodEnd: optDate.optional().transform((v) => v ?? null),
  focusDomainIds: z.array(z.string()).max(50).default([]),
  basedOnId: z.string().trim().nullable().optional().transform((v) => v || null),
  copyResponses: z.boolean().default(false),
});
export type AssessmentCreateInput = z.input<typeof assessmentCreateSchema>;

export const assessmentMetaSchema = assessmentCreateSchema
  .pick({ title: true, scope: true, assessorId: true, reviewerId: true, assessmentDate: true, periodStart: true, periodEnd: true, focusDomainIds: true });

export const responseSchema = z
  .object({
    status: z.enum(RESPONSE_STATUSES),
    level: z.number().int().min(1).max(5).nullable().optional().transform((v) => v ?? null),
    naJustification: text(2000).default(""),
    comment: text(4000).default(""),
    remediationNotes: text(4000).default(""),
    evidenceNote: text(1000).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.status === "ANSWERED" && v.level === null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["level"], message: "Select a maturity level" });
    if (v.status !== "ANSWERED" && v.level !== null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["level"], message: "A maturity level can only be set for answered questions" });
    if (v.status === "NOT_APPLICABLE" && v.naJustification.trim().length < 10)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["naJustification"], message: "Not Applicable requires a justification (at least 10 characters)" });
  });
export type ResponseInputPayload = z.input<typeof responseSchema>;

export const reviewSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED", "COMMENT"]), comments: text(4000).default("") })
  .refine((v) => v.decision === "APPROVED" || v.comments.trim().length >= 5, {
    message: "Comments are required when rejecting or commenting",
    path: ["comments"],
  });

export const actionSchema = z.object({
  title: req(200, "Title"),
  description: text(4000).default(""),
  projectId: req(64, "Project"),
  domainId: z.string().nullable().optional().transform((v) => v || null),
  practiceId: z.string().nullable().optional().transform((v) => v || null),
  questionId: z.string().nullable().optional().transform((v) => v || null),
  assessmentId: z.string().nullable().optional().transform((v) => v || null),
  responseId: z.string().nullable().optional().transform((v) => v || null),
  gap: text(4000).default(""),
  priority: z.enum(PRIORITIES),
  owner: text(120).default(""),
  targetDate: optDate.optional().transform((v) => v ?? null),
  status: z.enum(ACTION_WORKING_STATUSES as [string, ...string[]]).default("OPEN"),
  recommendation: text(4000).default(""),
  completionEvidence: text(4000).default(""),
});
export type ActionInput = z.input<typeof actionSchema>;

export const closeActionSchema = z.object({
  closureNote: req(4000, "Closure note").refine((s) => s.length >= 10, "Closure note must be at least 10 characters"),
  completionEvidence: req(4000, "Completion evidence"),
});
export const acceptRiskSchema = z.object({
  closureNote: req(4000, "Risk acceptance justification").refine((s) => s.length >= 10, "Justification must be at least 10 characters"),
  riskAcceptedUntil: reqDate,
});

export const referenceSchema = text(1000).refine(
  (s) => {
    // Anything shaped like a URI ("scheme:something") must be http(s). This rejects javascript:, data:,
    // file:, vbscript: etc. Plain references such as "JIRA: SEC-123" (colon followed by a space) are allowed.
    const m = /^([a-z][a-z0-9+.-]*):(\S)/i.exec(s);
    return !m || /^https?$/i.test(m[1]);
  },
  { message: "Only http(s) URLs or plain internal references (e.g. 'JIRA SEC-123') are allowed" },
);

export const evidenceSchema = z.object({
  projectId: req(64, "Project"),
  title: req(200, "Title"),
  description: text(4000).default(""),
  reference: referenceSchema.default(""),
  type: z.enum(EVIDENCE_TYPES),
  ownerName: text(120).default(""),
  collectedAt: optDate.optional().transform((v) => v ?? null),
  classification: z.enum(CLASSIFICATIONS).default("INTERNAL"),
});
export type EvidenceInput = z.input<typeof evidenceSchema>;

export const verifyEvidenceSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED", "PENDING"]),
  note: text(2000).default(""),
});

export const domainSchema = z.object({
  key: keySchema,
  name: req(160, "Name"),
  description: text(4000).default(""),
  sammFunction: z.enum(SAMM_FUNCTIONS),
  weight: weightSchema.default(1),
});
export const practiceSchema = z.object({
  key: keySchema,
  domainId: req(64, "Domain"),
  name: req(160, "Name"),
  description: text(4000).default(""),
  weight: weightSchema.default(1),
});

export const optionSchema = z.object({
  level: z.number().int().min(1).max(5),
  label: req(120, "Option label"),
  description: req(4000, "Option description"),
  criteria: text(4000).default(""),
  examples: text(4000).default(""),
  gaps: text(4000).default(""),
});

export const questionSchema = z.object({
  key: keySchema,
  practiceId: req(64, "Practice"),
  title: req(300, "Title"),
  description: req(6000, "Description"),
  objective: text(4000).default(""),
  rationale: text(4000).default(""),
  scope: text(4000).default(""),
  guidance: text(6000).default(""),
  evidenceExamples: text(4000).default(""),
  evidenceRequired: z.boolean().default(false),
  weight: weightSchema.default(1),
  criticality: z.enum(CRITICALITIES),
  mandatory: z.boolean().default(true),
  applicabilityTags: capabilityList.default(""),
  remediationGuidance: text(6000).default(""),
  references: text(4000).default(""),
  changeNote: text(1000).default(""),
  options: z
    .array(optionSchema)
    .length(5, "Exactly five maturity-ordered answer options are required")
    .refine((opts) => [1, 2, 3, 4, 5].every((l) => opts.some((o) => o.level === l)), "Options must cover levels 1 to 5"),
});
export type QuestionInput = z.input<typeof questionSchema>;

export const settingsSchema = z.object({
  orgName: req(120, "Organization name"),
  appTitle: req(120, "Application title"),
  scoreBasis: z.enum(SCORE_BASIS),
  minCoverageForScore: z.coerce.number().min(0).max(100),
  criticalGapMaxLevel: z.coerce.number().int().min(1).max(4),
  includeArchivedInReports: z.boolean(),
  orgSummaryDecimals: z.coerce.number().int().min(0).max(1),
  remediationSlaDays: z.object({
    CRITICAL: z.coerce.number().int().min(1).max(730),
    HIGH: z.coerce.number().int().min(1).max(730),
    MEDIUM: z.coerce.number().int().min(1).max(730),
    LOW: z.coerce.number().int().min(1).max(730),
  }),
});

export const levelsSchema = z
  .array(
    z.object({
      level: z.number().int().min(1).max(5),
      label: req(80, "Label"),
      description: text(1000).default(""),
      anchor: z.coerce.number().min(1).max(100),
    }),
  )
  .length(5)
  .refine((ls) => {
    const sorted = [...ls].sort((a, b) => a.level - b.level);
    return sorted.every((l, i) => l.level === i + 1 && (i === 0 || l.anchor > sorted[i - 1].anchor));
  }, "Anchor scores must be strictly increasing from Level 1 to Level 5 and within 1–100");

export const userSchema = z.object({
  name: req(120, "Name"),
  email: z.string().trim().toLowerCase().email("Invalid email").max(200),
  role: z.enum(ROLES),
  title: text(120).default(""),
  active: z.boolean().default(true),
});
