// Enumerations stored as strings in the database. Validated in src/lib/validation.ts.

export const ROLES = ["ADMIN", "ASSESSOR", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  ASSESSOR: "Assessor",
  REVIEWER: "Reviewer",
  VIEWER: "Read-only viewer",
};

export const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const LIFECYCLE_STATUSES = ["PLANNING", "DEVELOPMENT", "GA", "MAINTENANCE", "SUNSET"] as const;
export const LIFECYCLE_LABELS: Record<(typeof LIFECYCLE_STATUSES)[number], string> = {
  PLANNING: "Planning",
  DEVELOPMENT: "In development",
  GA: "Generally available",
  MAINTENANCE: "Maintenance",
  SUNSET: "Sunset",
};

export const SAMM_FUNCTIONS = ["GOVERNANCE", "DESIGN", "IMPLEMENTATION", "VERIFICATION", "OPERATIONS"] as const;
export type SammFunction = (typeof SAMM_FUNCTIONS)[number];
export const SAMM_LABELS: Record<SammFunction, string> = {
  GOVERNANCE: "Governance",
  DESIGN: "Design",
  IMPLEMENTATION: "Implementation",
  VERIFICATION: "Verification",
  OPERATIONS: "Operations",
};

export const ASSESSMENT_TYPES = ["BASELINE", "PERIODIC", "TARGETED", "OVERSIGHT"] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  BASELINE: "Baseline",
  PERIODIC: "Periodic reassessment",
  TARGETED: "Targeted reassessment",
  OVERSIGHT: "Parent oversight",
};

export const ASSESSMENT_STATUSES = ["DRAFT", "IN_PROGRESS", "COMPLETED", "REVIEWED", "REJECTED"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];
export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed – awaiting review",
  REVIEWED: "Reviewed & approved",
  REJECTED: "Rejected by reviewer",
};
/** Assessments in these states are immutable snapshots. */
export const LOCKED_STATUSES: AssessmentStatus[] = ["COMPLETED", "REVIEWED", "REJECTED"];
export const EDITABLE_STATUSES: AssessmentStatus[] = ["DRAFT", "IN_PROGRESS"];

export const RESPONSE_STATUSES = [
  "UNANSWERED",
  "ANSWERED",
  "NOT_APPLICABLE",
  "UNABLE_TO_DETERMINE",
  "EVIDENCE_MISSING",
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
export const RESPONSE_STATUS_LABELS: Record<ResponseStatus, string> = {
  UNANSWERED: "Unanswered",
  ANSWERED: "Answered",
  NOT_APPLICABLE: "Not applicable",
  UNABLE_TO_DETERMINE: "Unable to determine",
  EVIDENCE_MISSING: "Evidence missing",
};

export const ACTION_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "PENDING_VERIFICATION",
  "CLOSED",
  "ACCEPTED_RISK",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  PENDING_VERIFICATION: "Pending verification",
  CLOSED: "Closed",
  ACCEPTED_RISK: "Accepted risk",
};
/** Statuses that may be set through a normal edit. Terminal statuses need dedicated, explicit actions. */
export const ACTION_WORKING_STATUSES: ActionStatus[] = ["OPEN", "IN_PROGRESS", "BLOCKED", "PENDING_VERIFICATION"];
export const ACTION_TERMINAL_STATUSES: ActionStatus[] = ["CLOSED", "ACCEPTED_RISK"];

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EVIDENCE_TYPES = [
  "SECURITY_DESIGN",
  "THREAT_MODEL",
  "CICD_OUTPUT",
  "SAST_DAST_REPORT",
  "PENTEST_REPORT",
  "VULN_TRACKING",
  "ARCHITECTURE_DIAGRAM",
  "POLICY_CONFIGURATION",
  "INCIDENT_EXERCISE",
  "COMPLIANCE",
  "OTHER",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  SECURITY_DESIGN: "Security design document",
  THREAT_MODEL: "Threat model",
  CICD_OUTPUT: "CI/CD pipeline output",
  SAST_DAST_REPORT: "SAST/DAST report",
  PENTEST_REPORT: "Penetration test report",
  VULN_TRACKING: "Vulnerability tracking record",
  ARCHITECTURE_DIAGRAM: "Architecture diagram",
  POLICY_CONFIGURATION: "Policy configuration",
  INCIDENT_EXERCISE: "Incident exercise record",
  COMPLIANCE: "Compliance evidence",
  OTHER: "Other",
};

export const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export const VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  PENDING: "Pending verification",
  VERIFIED: "Verified by reviewer",
  REJECTED: "Rejected",
};

export const SCORE_BASIS = ["LATEST", "COMPLETED_ONLY"] as const;
export type ScoreBasis = (typeof SCORE_BASIS)[number];

export const DEFAULT_ANCHORS: Record<number, number> = { 1: 10, 2: 30, 3: 50, 4: 75, 5: 100 };
export const DEFAULT_LEVEL_LABELS: Record<number, string> = {
  1: "Initial / Ad hoc",
  2: "Repeatable",
  3: "Defined",
  4: "Managed and Measured",
  5: "Optimized / Continuously Improved",
};

export const ALLOWED_UPLOAD_EXTENSIONS = [
  ".pdf", ".png", ".jpg", ".jpeg", ".txt", ".md", ".csv", ".json", ".xlsx", ".docx", ".pptx", ".zip", ".log", ".html",
];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
