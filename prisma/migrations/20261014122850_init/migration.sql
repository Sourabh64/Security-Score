-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "orgName" TEXT NOT NULL,
    "appTitle" TEXT NOT NULL,
    "scoreBasis" TEXT NOT NULL DEFAULT 'LATEST',
    "minCoverageForScore" REAL NOT NULL DEFAULT 10,
    "criticalGapMaxLevel" INTEGER NOT NULL DEFAULT 2,
    "includeArchivedInReports" BOOLEAN NOT NULL DEFAULT false,
    "orgSummaryDecimals" INTEGER NOT NULL DEFAULT 0,
    "remediationSlaDays" TEXT NOT NULL DEFAULT '{"CRITICAL":30,"HIGH":60,"MEDIUM":90,"LOW":180}',
    "frameworkVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MaturityLevel" (
    "level" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "anchor" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "businessPurpose" TEXT NOT NULL DEFAULT '',
    "productOwner" TEXT NOT NULL DEFAULT '',
    "securityOwner" TEXT NOT NULL DEFAULT '',
    "technicalOwner" TEXT NOT NULL DEFAULT '',
    "criticality" TEXT NOT NULL DEFAULT 'HIGH',
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'GA',
    "tags" TEXT NOT NULL DEFAULT '',
    "capabilities" TEXT NOT NULL DEFAULT '',
    "weight" REAL NOT NULL DEFAULT 1,
    "weightRationale" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sammFunction" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SecurityPractice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SecurityPractice_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "SecurityDomain" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Question_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "SecurityPractice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT '',
    "rationale" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',
    "evidenceExamples" TEXT NOT NULL DEFAULT '',
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "weight" REAL NOT NULL DEFAULT 1,
    "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "applicabilityTags" TEXT NOT NULL DEFAULT '',
    "remediationGuidance" TEXT NOT NULL DEFAULT '',
    "references" TEXT NOT NULL DEFAULT '',
    "changeNote" TEXT NOT NULL DEFAULT '',
    "frameworkVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionVersionId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL DEFAULT '',
    "examples" TEXT NOT NULL DEFAULT '',
    "gaps" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "AnswerOption_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FrameworkVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'BASELINE',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "focusDomainIds" TEXT NOT NULL DEFAULT '',
    "assessorId" TEXT,
    "reviewerId" TEXT,
    "assessmentDate" DATETIME NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "basedOnId" TEXT,
    "frameworkVersionId" TEXT,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assessment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assessment_basedOnId_fkey" FOREIGN KEY ("basedOnId") REFERENCES "Assessment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assessment_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "FrameworkVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNANSWERED',
    "level" INTEGER,
    "naJustification" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "remediationNotes" TEXT NOT NULL DEFAULT '',
    "evidenceNote" TEXT NOT NULL DEFAULT '',
    "carriedForward" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "answeredBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentResponse_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentResponse_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL,
    "comments" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssessmentReview_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assessmentDate" DATETIME NOT NULL,
    "overallScore" REAL,
    "state" TEXT NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "scoredCount" INTEGER NOT NULL,
    "naCount" INTEGER NOT NULL,
    "unableCount" INTEGER NOT NULL,
    "evidenceMissingCount" INTEGER NOT NULL,
    "unansweredCount" INTEGER NOT NULL,
    "completion" REAL NOT NULL,
    "coverage" REAL NOT NULL,
    "breakdown" TEXT NOT NULL,
    "frameworkVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreSnapshot_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "collectedAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "classification" TEXT NOT NULL DEFAULT 'INTERNAL',
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT NOT NULL DEFAULT '',
    "verificationNote" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "storedFileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evidenceId" TEXT NOT NULL,
    "responseId" TEXT,
    "actionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceLink_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "AssessmentResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceLink_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RemediationAction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemediationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "domainId" TEXT,
    "practiceId" TEXT,
    "questionId" TEXT,
    "assessmentId" TEXT,
    "responseId" TEXT,
    "gap" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "owner" TEXT NOT NULL DEFAULT '',
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "recommendation" TEXT NOT NULL DEFAULT '',
    "completionEvidence" TEXT NOT NULL DEFAULT '',
    "closureNote" TEXT NOT NULL DEFAULT '',
    "closedAt" DATETIME,
    "closedBy" TEXT NOT NULL DEFAULT '',
    "riskAcceptedBy" TEXT NOT NULL DEFAULT '',
    "riskAcceptedUntil" DATETIME,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RemediationAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RemediationAction_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "SecurityDomain" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RemediationAction_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "SecurityPractice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RemediationAction_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RemediationAction_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RemediationAction_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "AssessmentResponse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- CreateIndex
CREATE INDEX "Project_parentId_idx" ON "Project"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityDomain_key_key" ON "SecurityDomain"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityPractice_key_key" ON "SecurityPractice"("key");

-- CreateIndex
CREATE INDEX "SecurityPractice_domainId_idx" ON "SecurityPractice"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_key_key" ON "Question"("key");

-- CreateIndex
CREATE INDEX "Question_practiceId_idx" ON "Question"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerOption_questionVersionId_level_key" ON "AnswerOption"("questionVersionId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkVersion_version_key" ON "FrameworkVersion"("version");

-- CreateIndex
CREATE INDEX "Assessment_projectId_idx" ON "Assessment"("projectId");

-- CreateIndex
CREATE INDEX "AssessmentResponse_questionId_idx" ON "AssessmentResponse"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_assessmentId_questionId_key" ON "AssessmentResponse"("assessmentId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreSnapshot_assessmentId_key" ON "ScoreSnapshot"("assessmentId");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_projectId_idx" ON "ScoreSnapshot"("projectId");

-- CreateIndex
CREATE INDEX "Evidence_projectId_idx" ON "Evidence"("projectId");

-- CreateIndex
CREATE INDEX "EvidenceLink_evidenceId_idx" ON "EvidenceLink"("evidenceId");

-- CreateIndex
CREATE INDEX "EvidenceLink_responseId_idx" ON "EvidenceLink"("responseId");

-- CreateIndex
CREATE INDEX "EvidenceLink_actionId_idx" ON "EvidenceLink"("actionId");

-- CreateIndex
CREATE INDEX "RemediationAction_projectId_idx" ON "RemediationAction"("projectId");

-- CreateIndex
CREATE INDEX "RemediationAction_status_idx" ON "RemediationAction"("status");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
