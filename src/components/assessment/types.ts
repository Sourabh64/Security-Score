export interface QOption {
  level: number;
  label: string;
  description: string;
  criteria: string;
  examples: string;
  gaps: string;
}

export interface QItem {
  id: string;
  key: string;
  version: number;
  currentVersion: number;
  domainId: string;
  domainName: string;
  domainKey: string;
  practiceId: string;
  practiceName: string;
  title: string;
  description: string;
  objective: string;
  rationale: string;
  scope: string;
  guidance: string;
  evidenceExamples: string;
  evidenceRequired: boolean;
  weight: number;
  criticality: string;
  mandatory: boolean;
  tags: string[];
  remediationGuidance: string;
  references: string;
  options: QOption[];
}

export interface EvidenceRef {
  linkId: string;
  id: string;
  title: string;
  status: string;
  reference: string;
  type: string;
}

export interface RState {
  responseId?: string;
  status: string;
  level: number | null;
  naJustification: string;
  comment: string;
  remediationNotes: string;
  evidenceNote: string;
  carriedForward: boolean;
  confirmed: boolean;
  answeredBy: string;
  updatedAt?: string;
  versionAnswered?: number;
  evidence: EvidenceRef[];
  actions: { id: string; title: string; status: string }[];
}
