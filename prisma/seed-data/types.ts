/** Compact authoring format for the seeded question bank. */

/** [short label, description of the expected state, observable criteria / evidence, practical examples] */
export type Level = [string, string, string, string];

export interface SeedQuestion {
  key: string;
  /** title */
  t: string;
  /** detailed description: what the assessor should look for */
  d: string;
  /** objective: what the assessor is trying to determine */
  o: string;
  /** rationale: why the practice matters */
  r: string;
  /** assessment guidance */
  g: string;
  /** recommended evidence examples */
  e: string;
  /** remediation guidance */
  rem: string;
  /** references / framework mappings */
  ref: string;
  c: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  w?: number;
  mandatory?: boolean;
  evidenceRequired?: boolean;
  /** applicability capability tags (comma separated); empty = all products */
  tags?: string;
  scope?: string;
  L: [Level, Level, Level, Level, Level];
}

export interface SeedPractice {
  key: string;
  name: string;
  description: string;
  questions: SeedQuestion[];
}

export interface SeedDomain {
  key: string;
  name: string;
  description: string;
  samm: "GOVERNANCE" | "DESIGN" | "IMPLEMENTATION" | "VERIFICATION" | "OPERATIONS";
  practices: SeedPractice[];
}
