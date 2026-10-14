# Product Security Maturity Hub

An internal platform for assessing, comparing and improving the security maturity of software products
(e.g. DLP, Web Proxy / SSE, CASB) using an **internal hybrid maturity model inspired by CMM and OWASP SAMM**.

> This is not the official OWASP SAMM model and does not produce a formal SAMM assessment or certification.
> It combines CMM-style maturity levels, SAMM-style practices grouped by business function
> (Governance, Design, Implementation, Verification, Operations), enterprise domains and
> product-specific enforcement-integrity questions.

## Quick start

Requirements: Node.js 20+ (tested on Node 22, npm 12) — no other services are needed.

```bash
npm run setup
```

```bash
npm run dev
```

Open http://localhost:3000. `setup` installs dependencies, generates the Prisma client, applies migrations
to `prisma/dev.db` and loads the demo data. A `.env` file is included (copy `.env.example` to `.env` if it is missing).

Production mode:

```bash
npm run build
```

```bash
npm start
```

### Database commands

| Command | Purpose |
|---|---|
| `npx prisma migrate deploy` | Create / upgrade the SQLite database from `prisma/migrations` |
| `npm run db:seed` | **Reset** application data and load the demo portfolio (deletes existing records) |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` (development) |
| `npm run db:reset` | Drop and recreate the dev database, then seed |

Data persists in `prisma/dev.db` across browser refreshes and restarts. Evidence attachments are stored in `data/uploads/`.

### Tests

```bash
npm test
```

38 automated tests (Vitest): 24 pure scoring-engine tests and 14 database-backed service tests. The service tests
build a separate `prisma/test.db` from the real migrations, so they never touch `dev.db`. Also available:
`npm run typecheck`, `npx tsx scripts/print-scores.ts` (prints current portfolio scores) and
`npx tsx scripts/smoke.ts` (requests every page of a running server).

## Technology

Next.js 15 (App Router, server components and server actions) · React 19 · TypeScript · Tailwind CSS ·
Prisma 6 with SQLite · Recharts · Zod · Vitest.

## What is included

- **Hierarchy**: organization → main projects → subprojects. Create, edit, archive, restore and (when safe) delete projects;
  capabilities (product profile) drive which questions apply and are inherited by subprojects.
- **Framework**: 20 domains, 42 practices and 107 questions (83 generic + 24 product-specific for DLP, Web Proxy/SSE and CASB).
  Every question has a description, objective, rationale, scope, guidance, evidence examples, remediation guidance, references and
  five descriptive, maturity-ordered answer options with observable criteria, examples and "missing for next level" text.
- **Assessments**: baseline, periodic, targeted and parent-oversight assessments; draft → in progress → completed → reviewed/rejected;
  autosave, live score, domain/practice navigation, filters (unanswered, mandatory, critical gaps, carried-forward, non-scored, focus domains),
  N/A with mandatory justification, "Unable to determine", "Evidence missing", comments, remediation notes and evidence references.
- **Reassessments**: copy previous responses as *carried forward*; each must be reconfirmed (or changed) before completion.
- **Immutability**: completing an assessment stores a `ScoreSnapshot`; responses lock and history never recalculates.
  Rejected assessments stay as records; a revision is created as a new assessment.
- **Review**: reviewer assignment, approve/reject/comment with timestamps, separation of duties (an assessor cannot approve their own assessment).
- **Dashboards**: organization, project, subproject and domain dashboards; product comparison; interactive heatmap; trends from snapshots;
  domain ranking; critical gaps; remediation priorities; coverage visualisation; score-details panels explaining every calculation.
- **Remediation tracker**: actions linked to project/domain/practice/question/response, priorities, owners, SLA-based target dates,
  overdue highlighting. Closing and accepting risk are explicit, recorded steps — answer changes never close an action.
- **Evidence**: URL/reference, type, owner, classification, dates, optional attachment; pending → verified/rejected by a reviewer;
  each answer shows whether it is asserted, supported (pending) or verified.
- **Reports & exports**: printable organization, project, subproject, domain and assessment reports (browser print → PDF);
  CSV exports of scores, snapshots, responses and actions, filterable by project.
- **Administration**: organization name/title, score basis, coverage threshold, critical-gap threshold, rounding, SLAs,
  maturity labels and anchors, project weights, users/roles, domain/practice/question management (add, edit, reorder,
  deactivate, duplicate for product variants), framework changelog and audit trail.

## Scoring model

| Level | Label | Anchor |
|---|---|---:|
| 1 | Initial / Ad hoc | 10 |
| 2 | Repeatable | 30 |
| 3 | Defined | 50 |
| 4 | Managed and Measured | 75 |
| 5 | Optimized / Continuously Improved | 100 |

1. Answered question = anchor of the selected level.
2. Practice = weighted average of its answered questions; domain = weighted average of scored practices;
   project = weighted average of scored domains. Weights (0–100, default 1) are normalized over items that have a score.
3. Unanswered, "Unable to determine" and "Evidence missing" contribute **no value** (never zero). N/A leaves the denominator and is counted separately.
4. **Scored coverage** = scored ÷ (applicable − N/A); **completion** = any response ÷ applicable. Below the minimum coverage
   (default 10 %) a project is "Not assessed" while the provisional value stays visible in details.
5. A project **without active subprojects** is scored from its own assessment. A project **with active subprojects** is the weighted
   average of subprojects that have a score; its own (oversight) assessment is shown separately and never mixed in.
   If no subproject has sufficient data, the parent is "Not assessed".
6. The organization score is the weighted average of active main projects with a score; unassessed projects are excluded and reported as a coverage gap.
   Archived projects never contribute.
7. Labels make the source explicit: *Directly assessed*, *Aggregated from subprojects*, *Partially assessed*, *Not assessed*.
8. Rounding: half away from zero; 1 decimal in detail views and exports; organization summaries use the configured decimals (default 0).

Current scores use the latest non-rejected assessment by default (drafts are live and flagged provisional); switch to
"completed only" in Administration. Trends are built only from completed snapshots.

Product-specific questions carry applicability tags (`dlp`, `dlp-endpoint`, `swg`, `tls-inspection`, `casb`); they only
apply to projects whose capabilities (own or inherited) include a matching tag, so DLP questions never count against CASB.

## Data model

`OrganizationSettings`, `MaturityLevel`, `User`, `Project` (self-referencing parent/child), `SecurityDomain`, `SecurityPractice`,
`Question` (stable identity) + `QuestionVersion` (immutable content) + `AnswerOption`, `FrameworkVersion` (changelog),
`Assessment`, `AssessmentResponse` (references the exact question version answered), `AssessmentReview`, `ScoreSnapshot`,
`Evidence` + `EvidenceLink`, `RemediationAction`, `AuditEvent`. See `prisma/schema.prisma`.

Retention rules: projects with history can only be archived (delete is allowed only without assessments, actions, evidence or subprojects);
completed assessments cannot be deleted or edited; evidence referenced by completed assessments is retained; question edits create new versions.

## Security & deployment mode

- **Local single-organization mode.** There is no password/SSO login. The acting user is selected in the sidebar ("Acting as") and stored in an
  httpOnly cookie. Every mutation is authorized **on the server** against that user's role (Administrator, Assessor, Reviewer, Read-only viewer),
  but anyone who can reach the app can switch users. Run it on a trusted machine or behind an authenticating reverse proxy, and replace
  `getCurrentUser()` in `src/server/auth.ts` with your identity provider before any multi-user deployment.
- Server-side Zod validation for every input; Prisma parameterized queries; React output escaping.
- Only `http(s)` links are rendered; `javascript:`/`data:`/`file:` references are rejected. CSV exports neutralize formula injection.
- Attachments: extension allow-list, 10 MB limit, random server-side names, always downloaded as `application/octet-stream` attachments.
- Security headers (CSP, frame-ancestors none, nosniff, referrer policy). Server actions use Next.js origin checks.
- Errors shown to users are generic; logs record error types only, never evidence content or request payloads.
- No secrets are embedded; `.env` only contains the local database path.

## Backup, export and PostgreSQL

- Back up `prisma/dev.db` and `data/uploads/` (stop the app first, or use `sqlite3 prisma/dev.db ".backup backup.db"`).
- CSV exports provide a portable copy of scores, snapshots, responses and actions.
- PostgreSQL: set `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL` at your server, delete `prisma/migrations`
  (it is SQLite-specific), then run `npx prisma migrate dev --name init` and `npm run db:seed`. Enumerations are stored as validated strings, so no
  schema changes are needed.

## Project layout

```
prisma/            schema, migrations, seed.ts, seed-data/ (question bank)
src/lib/           scoring engine (pure), formatting, validation, hierarchy helpers, CSV
src/server/        Prisma client, auth, permissions, portfolio computation, services, server actions, exports
src/components/    UI primitives, charts, heatmap, assessment workspace, admin forms
src/app/           pages (dashboard, projects, assessments, heatmap, compare, domains, actions, evidence, reports, framework, admin) and API routes
tests/             Vitest suites (scoring engine + DB-backed services)
```

## Known limitations

- Authentication is not implemented (see deployment mode above); role enforcement is real but identity is self-selected.
- PDF output relies on the browser's print-to-PDF using the dedicated print layouts; there is no server-side PDF generator.
- The UI exposes one subproject level; the data model and cycle checks support deeper nesting, but deeper levels are not exposed.
- Trends apply the *current* hierarchy and weights to historical snapshots (each snapshot's own score is immutable).
- `npm audit` reports advisories in build/dev tooling (PostCSS bundled with Next.js, Prisma CLI config dependency, Vitest); none are in code paths that
  process user input at runtime. Upgrade Next.js/Prisma/Vitest majors when convenient.
- Demo data (people, URLs, artifacts) is fictional.
