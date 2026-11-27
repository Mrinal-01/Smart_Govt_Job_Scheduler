# Architecture, database & security

How the system is built ([Architecture](#layers)), what is stored ([Database](#database-mongodb--mongoose)) and how it is protected ([Security](#security)).

```
┌──────────────────────────── Browser (React 18 + Vite) ────────────────────────────┐
│ AuthProvider ── access token in memory; refresh via HttpOnly cookie               │
│   └ WorkspaceGate ── loads /api/workspace, onboarding/migration, debounced sync   │
│        └ StudyProvider (existing store) ── legacy pages unchanged                 │
│        └ Pages: Dashboard · Schedule · Revision · Subjects · Tests · Analytics    │
└───────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ /api (same origin; Vite proxy in dev)
┌───────────────────────────── API (Express + TypeScript) ──────────────────────────┐
│ helmet · CORS allow-list · rate limits · $-key guard · Zod validation · pino       │
│ modules/                                                                            │
│   auth  workspace  settings  schedule  plan  sounds  documents  questions  exams ai │
│ jobs/queue.ts (Mongo-backed worker)   integrations/ (sms, storage, ai)             │
└──────────────┬──────────────────────────────┬──────────────────────┬───────────────┘
               │                              │                      │
          MongoDB (Mongoose)        Private file storage      OpenAI API (optional)  
                                    (STORAGE_DIR)
```

## Layers

| Layer | Where | Rule |
|---|---|---|
| Routes | `server/src/modules/*/*.routes.ts` | parse input with Zod, call a service, shape the response |
| Controllers | `auth.controller.ts` (others are thin enough to live in routes) | no business logic |
| Services | `*.service.ts` | all business rules and state transitions |
| Models | `server/src/models/*` | schema, indexes, unique/partial constraints |
| Integrations | `server/src/integrations/*` | replaceable adapters (AI provider, SMS driver, file storage; OCR in `modules/documents/extraction`) selected by environment variables |
| Jobs | `server/src/jobs/queue.ts` | durable PDF processing |
| Frontend services | `src/lib/http.ts`, `src/auth`, `src/workspace` | network, auth state, persistence |
| Frontend pages | `src/pages/*` | UI only — rules come from the API |

## Two-tier data model (migration strategy)

The pre-existing app keeps ~8k lines of working UI on one `StudyState` object. Rewriting all of
it at once was the largest risk, so:

1. **Legacy workspace** — the existing `StudyState` (curriculum, sessions, logs, legacy mock
   tests, mistakes, settings) is stored per user in `StudyWorkspace`. The client loads it after
   sign-in, mirrors edits to a per-user localStorage cache, and saves with `PUT /api/workspace`
   using a **revision number** (stale writes get `409 WORKSPACE_CONFLICT`; the UI asks to reload).
   Every original feature therefore works unchanged, now isolated per account.
2. **Normalized domains** — everything new is first-class collections with server-enforced rules:
   schedule versions, study sessions, revision obligations, documents, the shared question hub,
   mock tests, attempts, answers, exam mistakes, AI usage.

The curriculum (subjects → chapters → topics) lives in the workspace. Server engines reference
it by id and validate against it (`curriculum.service.ts`), so a client cannot attach work to
topics it does not have. The client flushes pending workspace edits before cycle/test actions.

## Study plan engine (`modules/plan`) — scheduled sessions & revision gates

Full contract: [API_DOCUMENTATION.md › Schedule & study plan](API_DOCUMENTATION.md).

* Sessions of the **published** schedule are materialized per date (`studysessions`, unique
  `userId+date+slotId`) from the version governing that date; the slot snapshot is frozen, so later
  versions never rewrite past or current-day sessions. Stored status is
  `scheduled|in_progress|completed|skipped|missed`; lock states are derived on every read.
* Completing learning with fully completed topics creates a **same-day** obligation that locks the
  next learning session of *that subject*. Each ended study day produces **next-day carryover**
  obligations (one per subject) that lock all learning of the next study day. **Weekly** obligations
  (per subject, due on the review day) never gate learning. Each type is completed separately.
* `POST /plan/sessions/:id/start` re-evaluates the gate on the server; the web client only starts its
  local timer after the server accepted the start, so a direct API call cannot bypass it.
* Emergency overrides are immutable `gateoverrides` records; bypassed obligations stay pending.
* Day boundaries use the student's `UserSettings.timezone` and study calendar (rest weekdays,
  holidays). `lib/clock.ts` is the single time source (replaceable when testing day boundaries).
* No transactions (standalone MongoDB): single-document conditional updates + unique-index
  idempotency; see *Consistency strategy* in the API doc.
* The legacy workspace session records are still updated as a mirror for the existing dashboard,
  reminders and spaced-revision views; they no longer decide anything.

## Schedule governance (`modules/schedule`)

* The Schedule page edits `state.scheduleDraft`; edits never touch sessions.
* Publishing creates an immutable `ScheduleVersion` (update hooks throw). Version 1 (baseline,
  auto-published from the existing timetable on first load) is free and effective today.
* Later publishes count against `SCHEDULE_MAX_CHANGES` per rolling `SCHEDULE_WINDOW_DAYS`, are
  effective **tomorrow at the earliest**, need a reason, and when the budget is spent require an
  emergency override with a ≥10-character reason (recorded + notification).
* Every preview/publish validates slot dependencies (chapter/topic ownership, prerequisites on the
  same day and earlier, cycle order per subject); errors block publishing
  (`422 INVALID_SCHEDULE_DEPENDENCIES`). Pending revision obligations always carry over.
* For a date, the governing version is the highest version whose `effectiveFrom ≤ date`. The client
  switches its active timetable when that version changes; past session records are untouched.

## PDF → shared question hub (`modules/documents`, `modules/questions`)

```
upload (multer, 20 MB, %PDF- magic, subject required, sha256 dedupe per student) → private storage
   → ProcessingJob (Mongo queue, retries with backoff, resumes after restart)
   → pdf.js text per page (eval disabled) → OCR provider for pages with < 25 chars
   → deterministic parser (numbering, (a)/(A)/A./(1) options, statement lists, answer-key
     section, inline “Ans:”, explanations, confidence + flags)
   → optional AI structuring of low-confidence items (grounding check; never sets answers)
   → insert into the hub — ONE collection shared by all students, unique global contentHash
     (a duplicate only fills a missing answer/subject) → stats + notification
   → questions without an answer key: background AI answering (answer.service.ts)
```
Hub statuses: `pending_answer` (no key yet) → `ready` (answer from the PDF key, the uploader, or AI
with confidence ≥ 0.75) / `needs_review` (unclear, AI unsure, or reported wrong) / `rejected`.
**Only `ready` questions go into tests.** Without an AI key, unanswered questions wait as
`pending_answer` and are answered by a 10-minute sweeper once the key is added.

## Exam engine (`modules/exams`)

* Selection is deterministic from a stored seed over **ready** hub questions, matched to the
  student's curriculum by normalized subject/chapter/topic names; insufficient buckets raise
  `422 INSUFFICIENT_QUESTIONS` with per-bucket availability (never a silently short test).
* Starting an attempt snapshots the questions (later hub edits don't change it), fixes
  `startedAt`/`deadlineAt` on the server, and hides answers until finished. One running attempt
  per test (partial unique index).
* Answers autosave via `PUT /answers` (accepted until deadline + 5 s grace). Expired attempts are
  finalized lazily on any read and by a 30 s sweeper.
* **Interruption policy:** the clock keeps running while disconnected. Reopening before the deadline
  resumes with saved answers (plus any unsynced answers kept in that tab's sessionStorage); after it,
  the attempt has been auto-submitted with what was saved.
* Submission is an atomic `in_progress → submitted` transition — repeated submits return the same
  result. Each scored question shows where its answer came from (`document_key` / `student` / `ai`).
* Wrong answers upsert `ExamMistake` (unique per question; repeats increment `occurrences`).

## AI (`modules/ai`, `integrations/ai.ts`)

OpenAI provider over plain HTTPS (Responses API, no SDK): strict JSON-schema output (schemas are
converted to strict mode automatically and re-validated with Zod), refusal and truncation handling,
timeouts. Default model `gpt-6.2-sol`. Student calls go through `runAI` (per-user switch, daily
limit, burst limit, usage log without content); background calls (answering hub questions) go
through `runSystemAI` with a separate server-wide daily cap.

**AI Help** (`chat.service.ts`, `POST /ai/ask`) answers only study questions — concepts, topic
explanations, question solving, the student's schedule/revision and exam strategy. The model must
classify each message with a strict schema; the server shows a fixed refusal for anything out of
scope (the model's text is never shown in that case), so prompt injection cannot widen the scope.

## Swappable infrastructure

| Concern | Now | Upgrade path |
|---|---|---|
| Job queue | `ProcessingJob` collection + in-process worker | implement `enqueueDocumentJob`/worker with BullMQ when Redis exists |
| File storage | `localStorage` driver in `integrations/storage.ts` | S3/GCS driver implementing `ObjectStorage`; signed URLs → provider presigned URLs |
| OCR | Tesseract CLI provider | any `OcrProvider` (cloud OCR) |
| Background notifications | foreground reminders (unchanged) | Web Push + service worker — **not implemented** |

---

# Database (MongoDB / Mongoose)

**21 collections in use:** accounts `users`, `refreshsessions`, `phoneotps`, `usersettings`, `notifications` ·
study data `studyworkspaces` · schedule `schedules`, `scheduleversions`, `studysessions` · revision
`revisionobligations`, `revisionattempts`, `gateoverrides` · sounds `customsounds` · question hub `questions`,
`uploadeddocuments`, `processingjobs` · tests `mocktests`, `mocktestattempts`, `mocktestanswers`, `exammistakes` ·
AI `aiusagelogs`. Look at them with MongoDB Compass (connection string = `MONGODB_URI`, database `studyos`).

Every user-owned collection has a required `userId` and every query filters by it.
Ownership failures return **404** (existence is not leaked). Timestamps (`createdAt`,
`updatedAt`) are on every collection. Source: `server/src/models/*`.

## Identity

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| `users` | name, phone (E.164, sign-in identifier), phoneVerifiedAt, email (optional, legacy accounts), passwordHash (legacy, Argon2id, `select:false`), emailVerified(+At), termsAcceptedAt, role (`student`/`admin`), status, tokenVersion, failedLoginCount, lockedUntil, lastLoginAt | **partial unique** phone where present; **partial unique** email where present (the old non-partial `email_1` index is dropped at startup by `db.ts`) |
| `phoneotps` | phone, purpose (`signup`/`login`), codeHash (HMAC-SHA256; null once invalidated), expiresAt, attempts, consumedAt, lastSentAt, windowStart, sendCount, purgeAt | **unique** (phone, purpose); **TTL** purgeAt |
| `refreshsessions` | userId, familyId, tokenHash (sha256), expiresAt, revokedAt, revokedReason, replacedByHash, userAgent, ip, lastUsedAt | **unique** tokenHash; (userId, revokedAt); familyId; **TTL** expiresAt |

## Workspace & settings

| Collection | Key fields | Indexes |
|---|---|---|
| `studyworkspaces` | userId, revision (optimistic concurrency), schemaVersion (3), origin (`import`/`demo`/`fresh`), data (the client `StudyState`), sizeBytes | **unique** userId |
| `usersettings` | userId, timezone, cycle {subjectIds[], defaultRevisionMinutes=10, revisionMinutesBySubject{}, revisionMinutesPerTopic=3, maxTopicsPerRevisionBlock=5, revisionMandatory=true, cyclesPerDay=2, sessionMinutes=60, breakMinutes=10}, plan {sameDayRevisionMinutes=15, nextDayRevisionEnabled=true, nextDayRevisionMinutes=15, carryoverScope=per_subject, weeklyRevisionMinutes=30, weeklyReviewWeekday=0, restWeekdays[], holidays[], requirePracticeInRevision=false}, ai {enabled}, exams {autoAddMistakes} | **unique** userId |
| `notifications` | userId, type, title, message, link, readAt | (userId, createdAt) |

`StudyWorkspace.data` contains the original entities (Subject, Chapter, Topic, ScheduleSlot,
SessionRecord, DailyLog, legacy Mistake/Question/MockTest/MockAttempt, AIMessage) plus
`scheduleDraft` and `scheduleGovernance`. The Subject/Chapter/Topic tree is referenced by id from
the normalized collections below.

## Schedule governance

| Collection | Key fields | Indexes |
|---|---|---|
| `schedules` | userId, currentVersion, latestVersionId | **unique** userId |
| `scheduleversions` (immutable) | userId, scheduleId, version, previousVersion, slots[] (server-normalized; duration derived), changes {added[], removed[], modified[{slotId, fields[]}], summary[]}, changedFields[], changeReason, publishedAt, effectiveFrom, countsTowardLimit, override, overrideReason | **unique** (scheduleId, version); (userId, publishedAt) |

Schedule slots additionally carry `sessionType` (learning/revision/practice/mock_test), `cycleNumber`,
`chapterId`, `topicIds[]`, `revisionMinutes`, `revisionPolicy` (previous_cycle/all_previous_cycles/none)
and `prerequisiteSlotIds[]`. Older versions without them are read with defaults (`normalizeSlot`).

## Study plan (scheduled sessions & revision obligations)

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| `studysessions` | userId, date, slotId, scheduleVersion, frozen slot snapshot (subject, chapter, plannedTopics[], sessionType, cycleNumber, times, plannedMinutes, targets, revisionMinutes, revisionPolicy, prerequisiteSlotIds), status (`scheduled`/`in_progress`/`completed`/`skipped`/`missed`), startedAt, completedAt, actualMinutes (server-measured), completion {topics[{…, completion: completed/partial}], questionsAttempted, questionsCorrect, confidence, notes}, skipReason, overrideId, rescheduledFrom | **unique** (userId, date, slotId); (userId, status, date); (userId, sessionType, status, date); update middleware excludes completed documents (immutable) |
| `revisionobligations` | userId, type (`same_day`/`next_day`/`weekly`), subject, topics[], sourceSessionIds[], sourceDate, sourceCycleNumber, sourceStartTime, targetSessionId, dueDate, weekStart, plannedMinutes, practiceRequired, status (`pending`/`in_progress`/`completed`), startedAt, completedAt, result {topicsRevised[], questionsAttempted/Correct/Wrong, confidence, notes, actualMinutes}, bypassedBy[] (override ids), **dedupeKey** | **unique** (userId, dedupeKey); (userId, type, status, dueDate); (userId, subjectId, type, dueDate) |
| `revisionattempts` (append-only) | userId, obligationId, type, subjectId, dueDate, completedDate, topicsRevised[], questions attempted/correct/wrong, confidence, notes, planned/actualMinutes, startedAt, completedAt | **unique** obligationId; (userId, completedDate) |
| `gateoverrides` (append-only) | userId, sessionId, sessionDate, subject, reason (≥10), originalState, lockReasons[], obligationIds[], prerequisiteSessionIds[], decision (`bypassed`) | (userId, createdAt); sessionId |

## Alert sounds

| Collection | Key fields | Indexes |
|---|---|---|
| `customsounds` | userId, name (≤60), format (`mp3`/`wav`/`ogg`/`m4a`/`webm`), mimeType, sizeBytes (≤2 MB), storageKey (private, never sent to clients) | (userId, createdAt); max 10 per user (route-enforced) |

Collections of removed features (`studycycles`, `cyclesubjectblocks`, `studylogs`, `revisiontasks`,
`revisionlogs`, `emailverificationtokens`, `passwordresettokens`) are backed up and dropped by
`npm --prefix server run db:upgrade -- --apply`.

## Documents & questions

| Collection | Key fields | Indexes |
|---|---|---|
| `uploadeddocuments` | userId, originalName, storageKey (never exposed), sizeBytes, sha256, pageCount, intent {mockType, subjectIds, subjectNames}, status, stage, progress, error, pages[{pageNumber, method, chars}], stats {questionsFound, inserted, duplicates, needsReview, pendingAnswer, answersFilled, …}, aiUsed, aiNote, processedAt | **unique** (userId, sha256); (userId, createdAt) |
| `processingjobs` | type (`process_document`/`answer_questions`), userId?, documentId?, questionIds[] (answer batches), recheck, status, attempts, maxAttempts, runAfter, lockedAt, lastError, note | (status, runAfter); documentId |
| `questions` — **central hub, shared by all students** | uploadedBy (provenance), origin (`pdf`/`manual`/`ai_generated`), documentId, alsoInDocuments[], source {documentId, pageNumber, questionNumber}, rawText (verbatim), questionText, questionType, options[{label,text}], correctAnswer[] or null, answerSource (`document_key`/`student`/`ai`), answerConfidence (AI), answerExplanation, answerModel, answeredAt, explanation (from the PDF), subjectName+subjectKey, chapterName+chapterKey, topicName+topicKey (normalized names — no per-student ids), difficulty, status (`pending_answer`/`ready`/`needs_review`/`rejected`), extractionConfidence, flags[], aiStructured, aiCheck {state, recheck, attempts, nextTryAt, note, lastRunAt}, reports[{userId, reason, at}], **contentHash** | **unique** contentHash (global); (status, subjectKey, chapterKey, topicKey); (uploadedBy, createdAt); (documentId, source.pageNumber); alsoInDocuments; (status, aiCheck.state, aiCheck.nextTryAt) |

Upgrade from per-student banks: `migrateQuestionHub()` (`server/src/modules/questions/hub.migration.ts`, idempotent) drops the old per-owner indexes, maps `userId`→`uploadedBy`, names→keys, old statuses (`verified`+answer → ready, other answered → needs_review, unanswered → pending_answer), merges duplicate content hashes (best answer wins; mock tests repointed) and builds the new indexes.

## Mock tests & attempts

| Collection | Key fields | Indexes |
|---|---|---|
| `mocktests` | userId, kind (`test`/`template`), name, type, config {subjectIds, chapterIds, topicIds, distribution[], questionCount, durationMinutes, marksPerQuestion, negativeMarks, selectionMethod, difficultyDistribution, avoidRecentDays, shuffleQuestions, shuffleOptions, instructions}, questionIds[], seed, templateId, sourceAttemptId, archivedAt | (userId, kind, createdAt) |
| `mocktestattempts` | userId, mockTestId, testName, testType, status, startedAt, deadlineAt, durationSeconds, submittedAt, submissionType, questions[] (snapshot incl. answer, answerVerified, answerSource, answerConfidence, answerExplanation; subject/chapter ids from the taker's curriculum), marking, lastSavedAt, result {...} | (userId, createdAt); (status, deadlineAt); **partial unique** (userId, mockTestId) where status=`in_progress` |
| `mocktestanswers` | attemptId, userId, questionId, selected[], markedForReview, visited, timeSpentSeconds | **unique** (attemptId, questionId) |
| `exammistakes` (Mistake Bank for PDF tests) | userId, questionId, lastAttemptId, snapshot of question/options/answer/explanation, taxonomy, category, status, occurrences, reviewCount, lastSeenAt, source | **unique** (userId, questionId); (userId, status) |
| `aiusagelogs` | userId (null = server background work such as answering hub questions), date, feature, provider, model, status, input/outputTokens, latencyMs, errorCode — **no prompt or response content** | (userId, date); (date, feature) |

## Migration of existing data

* Study plan: **no migration script is needed.** New slot fields and settings have defaults and older
  documents are normalized on read; new collections are created with their indexes at startup
  (`db.ts` → `Model.init()`). Sessions are materialized lazily starting on the first day a student opens
  the plan (earlier days are never back-filled as missed); after that, days the student did not open
  the app are caught up (at most 14 days back) so misses are recorded.

* Browser data (`localStorage['studyos.state.v3']`) → imported on first sign-in by choice, or via
  `npm --prefix server run migrate:import-local`. Nothing is deleted from the browser.
* Existing timetable → auto-published as schedule v1 (free baseline).
* Earlier topic history is kept as-is; the fix that stops counting first learning as a revision
  applies to new learning only.

---

# Security

## Authentication
* **Sign-up and login use a mobile number + one-time code (OTP)** — no passwords. Numbers are normalized to E.164 and restricted to `PHONE_ALLOWED_COUNTRY_CODES` (default India, 10 digits starting 6–9). One account per number (partial unique index; concurrent sign-ups collapse to one account).
* **OTP storage & lifetime:** 6 digits from `crypto.randomInt`; only `HMAC-SHA256(OTP_SECRET, phone:purpose:code)` is stored (`phoneotps`); compared in constant time; valid 5 minutes; single use (atomic consume); one active code per number and purpose; 5 wrong attempts invalidate the code. Documents are TTL-purged.
* **OTP abuse limits:** 60 s resend cooldown and at most 5 codes per number per rolling hour, plus 20 OTP requests/hour/IP and 10 register/login attempts per 15 min per IP. Codes are never logged in production; the console SMS driver refuses to send in production (503) so codes cannot leak to logs.
* **Enumeration trade-off (product decision):** `otp/request` tells the user whether a number is registered (sign-up answers `PHONE_IN_USE`, login answers `PHONE_NOT_REGISTERED`) so they are sent to the right screen. The per-number and per-IP limits bound how fast numbers can be probed.
* **Development codes:** with `NODE_ENV=development` and `SMS_DRIVER=console` only, the code is returned as `devOtp`, printed in the API log and listed at `GET /api/dev/sms`.
* **Legacy accounts:** accounts created with email/password keep their Argon2id hash; they log in by OTP after a phone is attached (`npm --prefix server run user:set-phone`). Email verification and password reset were removed.
* **Access token:** HS256 JWT, 15 minutes, issuer + audience checked, carries `tokenVersion`; held in memory only on the client (never `localStorage`).
* **Refresh token:** 384-bit opaque value in an `HttpOnly`, `Secure` (production), `SameSite=strict` cookie scoped to `/api/auth`. Stored hashed. Rotated on every use; presenting an already-rotated token revokes the whole session family (theft detection), with a 15-second race window for parallel tabs.
* **Revocation:** logout revokes the family; “sign out everywhere” and a (legacy) password change revoke all refresh sessions **and** bump `tokenVersion`, which invalidates outstanding access tokens immediately (checked on every request).
* **CSRF:** only `/auth/refresh` and `/auth/logout` use the cookie; they require the `X-StudyOS-CSRF: 1` header (forces a CORS preflight) and an `Origin` that is allow-listed or the same host the request was sent to. All other endpoints use bearer tokens.

## Authorization & data isolation
* Every collection has an owner `userId`; every query includes it; foreign ids return 404.
* Business rules (revision gating, change limits, deadlines, scoring, dedupe) run on the server and are backed by unique/partial indexes where concurrency matters.

## Input handling
* Zod validation on every route (unknown keys stripped, types coerced to primitives).
* Requests containing `$`-prefixed keys are rejected (NoSQL operator injection); `strictQuery` on.
* JSON body limit 1 MB (8 MB only for `/api/workspace`).

## Files
* PDFs are validated (extension/MIME, `%PDF-` magic bytes, parseable, page limit, size limit) and stored under `STORAGE_DIR` with 0600 permissions, outside any static directory, at server-generated paths (`<userId>/<documentId>.pdf`, regex-checked, traversal-checked).
* Delivery only through 5-minute HMAC-signed URLs bound to document id + owner; responses are `no-store`, `nosniff`, `frame-ancestors 'self'`.
* pdf.js runs with `isEvalSupported: false`, no font loading and no network (mitigates CVE-2024-4367). The optional native `canvas` dependency is replaced by an empty stub so no native code or install-time `tar` extraction is involved.

## AI
* Provider keys exist only in server environment variables.
* Per-user enable switch, daily request limit, per-minute burst limit, timeouts, max output tokens.
* `aiusagelogs` record feature, model, tokens, latency and status — **never prompts or outputs**. Logger redacts authorization headers, cookies, passwords and tokens.
* Prompts contain only the requesting user's data; the model is told not to invent history, never to set correct answers during PDF structuring, and AI-structured output is rejected unless its text is found in the PDF.

## HTTP hardening
Helmet (CSP allowing only self + Google Fonts, HSTS, frame-ancestors self, no-sniff), CORS allow-list with credentials, `x-powered-by` off, generic 500 messages.

## Secrets & configuration
`.env` files are git-ignored; `.env.example` files document every variable (see [SETUP.md › Configuration](SETUP.md)). In production the API refuses to start without 32+ character `JWT_ACCESS_SECRET`, `FILE_SIGNING_SECRET` and `OTP_SECRET`.

## Dependency audit (2026-11-26)
| Package | Status |
|---|---|
| API production deps | `npm audit --omit=dev`: 1 advisory — `pdfjs-dist` ≤4.1.392 (CVE-2024-4367, font-eval). **Mitigated** (eval disabled, text extraction only). Fixed versions require Node ≥20; upgrade when the runtime moves to Node 20+. |
| Web app | dev-only advisory in the esbuild dev server; `react-router` 6.x advisory fixed only in 7.x (planned migration) |

## Known gaps
* No passkeys; no phone-number change flow; no CAPTCHA (rate limits + per-number caps only). SMS OTP is vulnerable to SIM-swap like any SMS login.
* The development SMS inbox endpoint exists only when `NODE_ENV=development`.
* Workspace documents are stored as JSON blobs (structure-validated, not field-by-field).
* Background (closed-tab) reminders via Web Push are not implemented.
