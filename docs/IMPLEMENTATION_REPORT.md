# Implementation Report

Date: 2026-11-26 · Node 18.20.8 · MongoDB 8.0 (local)

## Verification results (run on this machine)

| Check | Command | Result |
|---|---|---|
| Web typecheck | `tsc --noEmit -p .` | ✅ 0 errors |
| API typecheck | `npm --prefix server run typecheck` | ✅ 0 errors |
| Web tests | `npm test` | ✅ 33 passed (7 files) |
| API tests | `npm --prefix server test` | ✅ 55 passed (10 files) |
| Web production build | `npm run build` | ✅ (Node 18 — was failing before this work) |
| API production build | `npm --prefix server run build` | ✅ |
| End-to-end smoke (real dev servers, Vite proxy, background worker) | `npm --prefix server run e2e:smoke` | ✅ register → verify → login/refresh → workspace → schedule v1 → cycle-2 revision → PDF processed → exam scored → signed PDF → logout |
| Production boot | `NODE_ENV=production node server/dist/index.js` | ✅ refuses weak secrets; serves SPA + API with CSP/HSTS |
| Regression: every original page renders on demo data with no console errors | `src/test/routes.test.tsx` | ✅ 15 routes |

No real Google, Anthropic, Resend or Tesseract credentials/binaries were available, so those
integrations were verified with injected fakes (as the brief requires for automated tests) but
**not against the live services**.

## Feature status

| Feature | Status | Files changed | Tests |
|---|---|---|---|
| Authentication | Completed | `server/src/modules/auth/*`, `middleware/auth.ts`, `middleware/security.ts`, `integrations/mail.ts`, `models/auth.ts`, `src/auth/AuthContext.tsx`, `src/lib/http.ts`, `src/pages/auth/*`, `src/App.tsx` | `server/tests/auth.test.ts` (16), `src/test/auth.test.tsx` (4) |
| Google Login | Completed — live use needs `GOOGLE_CLIENT_ID` (verified with a mocked verifier only) | `integrations/google.ts`, `auth.service.ts` (`googleSignIn`, `linkGoogle`), `src/pages/auth/AuthShared.tsx` (`GoogleButton`), `LoginPage.tsx` (`GoogleFlow`) | `auth.test.ts` › Google (4) |
| Study Cycle Engine | Completed | `server/src/modules/cycles/*`, `models/study.ts`, `src/pages/CyclesPage.tsx`, `src/store/StudyStore.tsx` (`registerLearning`) | `server/tests/cycles.test.ts` (4), `src/test/cycles.test.tsx` (2), `src/test/store.test.tsx` |
| Cycle-based Revision | Completed | `cycle.service.ts` (task generation/dedupe/gating/carry-forward), `settings.service.ts`, `src/pages/settings/AccountSections.tsx` (revision preferences), `StudyStore.tsx` (`recordCycleRevision`) | `cycles.test.ts` (Workflow B, dedupe, partial topics, skips, settings) |
| Schedule Governance | Completed | `server/src/modules/schedule/*`, `models/schedule.ts`, `src/components/ScheduleGovernance.tsx`, `src/pages/SchedulePage.tsx`, `StudyStore.tsx` (draft/governance) | `server/tests/schedule.test.ts` (4), `src/test/builder.test.tsx` (2), `store.test.tsx` (2) |
| PDF Upload | Completed (local private storage driver) | `server/src/modules/documents/document.routes.ts`, `integrations/storage.ts`, `jobs/queue.ts`, `src/pages/tests/CreateTestPage.tsx` | `documents.test.ts` (6), `src/test/upload.test.tsx` |
| AI Question Extraction | Partially Completed | `extraction/pdfText.ts`, `ocr.ts`, `questionParser.ts`, `aiStructurer.ts`, `pipeline.ts`, `integrations/ai.ts` | `parser.test.ts` (7), `documents.test.ts`, `ai.test.ts` (grounding) |
| Question Bank | Completed | `server/src/modules/questions/*`, `models/questions.ts`, `src/pages/tests/QuestionBankPage.tsx`, `DocumentReviewPage.tsx`, `shared.tsx` | `documents.test.ts`, `isolation.test.ts`, `builder.test.tsx` (review) |
| Mock Test Builder | Completed | `exams/selection.service.ts`, `mockTest.service.ts`, `mockTest.routes.ts`, `models/exams.ts`, `CreateTestPage.tsx`, `TestsHomePage.tsx` | `exams.test.ts` (Workflow E, insufficient bank, difficulty, templates), `scoring.test.ts` (apportion), `builder.test.tsx` |
| Examination Engine | Completed | `exams/attempt.service.ts`, `attempt.routes.ts`, `src/pages/tests/LiveTestPage.tsx` | `exams.test.ts` (Workflow F, deadline, concurrency), `src/test/exam.test.tsx` (3) |
| Result Analysis | Completed | `exams/scoring.ts`, `attempt.service.ts` (`performanceSummary`, retake, mistakes), `mistake.routes.ts`, `AttemptResultPage.tsx`, `ExamMistakesPanel.tsx`, `MistakeBankPage.tsx` | `scoring.test.ts` (3), `exams.test.ts` (Workflow G), `exam.test.tsx` (result) |
| AI Study Assistant | Completed — live use needs `AI_PROVIDER`/key (verified with a mocked provider only) | `server/src/modules/ai/*`, `integrations/ai.ts`, `src/pages/AssistantPage.tsx`, `AttemptResultPage.tsx`, `QuestionBankPage.tsx` | `server/tests/ai.test.ts` (5) |

### Why “AI Question Extraction” is only partially completed
* Implemented and tested: text-layer extraction, scanned-page detection, OCR fallback through the
  replaceable provider (tested with a fake provider), question/number/option/answer-key detection,
  statement lists, page-level image detection, duplicate detection, confidence flags, AI
  structuring with grounding checks, separate storage of raw text and AI output.
* Not done / not verified:
  * The Tesseract CLI provider has not been run here (binaries not installed).
  * The real Anthropic model has not been called (no key); prompt quality is unmeasured.
  * Diagrams are detected per page (flag “page has images”), not cropped or attached to questions.
  * Two-column paper layouts and questions split across columns are not reconstructed.

## Other requested items

| Item | Status | Notes |
|---|---|---|
| Codebase audit | Completed | `docs/CODEBASE_AUDIT.md` |
| Node 18 build fix | Completed | Vite 5.4 / plugin-react 4.3; unused Hono removed |
| Workspace persistence + localStorage migration | Completed | onboarding import, CLI import script, conflict-safe sync |
| Data isolation (Workflow H) | Completed | `server/tests/isolation.test.ts` |
| Settings (account, security & sessions, policy, revision prefs, AI) | Completed | `src/pages/settings/AccountSections.tsx` |
| Normalized Subject / Chapter / Topic / DailySession collections | Not Started | curriculum and sessions stay in the workspace document by design (see ARCHITECTURE.md); new engines reference them by id |
| Redis + BullMQ | Not used | Redis is not installed; a durable Mongo-backed queue is used instead (swap path documented) |
| Object storage (S3/GCS) | Not Started | `ObjectStorage` interface ready; local private driver implemented |
| Web Push background notifications | Not Started | reminders remain foreground-only (unchanged, documented) |
| Admin UI for policy limits | Not Started | limits are system settings via env (`SCHEDULE_MAX_CHANGES`, `SCHEDULE_WINDOW_DAYS`); `admin:promote` script exists |
| Email change, 2FA | Not Started | |

## Behaviour changes to existing features (intentional)

1. **Schedule edits are drafts.** Editing no longer changes today's sessions; changes apply after
   publishing, from tomorrow (the first publish is free and immediate).
2. **First learning is no longer recorded as a revision** (a pre-existing bug contradicting the README).
3. **Reset demo data / import backup** no longer bypass schedule governance: the published timetable
   stays active and the imported one becomes a draft. They never delete the old browser key.
4. **Profile email** is the account email (read-only in Settings).
5. The assistant offers a **Live AI** engine when configured; the rule-based engine is unchanged.

## How to try each acceptance workflow

| Workflow | Where |
|---|---|
| A — Authentication | `/register` → dev mailbox link → `/login`; Google after `GOOGLE_CLIENT_ID` is set |
| B — Study cycles | `/cycles` → Start cycle 1 → learn each subject → Start cycle 2 |
| C — Schedule governance | `/schedule` → edit → *Review & publish* (×3) → 4th shows the limit + emergency override; *History* |
| D — PDF to question bank | `/tests/new` → type → upload → *Review & verify questions* |
| E — Configurable mock tests | `/tests/new` → configure (mixed / subject / sectional / chapter / topic) |
| F — Examination | start a test → answer, mark for review, refresh, submit |
| G — Performance | result page, `/tests` › Performance, `/mistakes` › PDF mock tests |
| H — Isolation | covered by `server/tests/isolation.test.ts` |
