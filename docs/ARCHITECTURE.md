# Architecture

```
┌──────────────────────────── Browser (React 18 + Vite) ────────────────────────────┐
│ AuthProvider ── access token in memory; refresh via HttpOnly cookie               │
│   └ WorkspaceGate ── loads /api/workspace, onboarding/migration, debounced sync   │
│        └ StudyProvider (existing store) ── legacy pages unchanged                 │
│        └ New pages: Study Cycles · PDF Test Builder · Exam · Results · Settings   │
└───────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ /api (same origin; Vite proxy in dev)
┌───────────────────────────── API (Express + TypeScript) ──────────────────────────┐
│ helmet · CORS allow-list · rate limits · $-key guard · Zod validation · pino       │
│ modules/                                                                            │
│   auth  workspace  settings  schedule  cycles  documents  questions  exams  ai     │
│ jobs/queue.ts (Mongo-backed worker)   integrations/ (mail, storage, ai)            │
└──────────────┬──────────────────────────────┬──────────────────────┬───────────────┘
               │                              │                      │
          MongoDB (Mongoose)        Private file storage      Anthropic API (optional)
                                    (STORAGE_DIR)
```

## Layers

| Layer | Where | Rule |
|---|---|---|
| Routes | `server/src/modules/*/*.routes.ts` | parse input with Zod, call a service, shape the response |
| Controllers | `auth.controller.ts` (others are thin enough to live in routes) | no business logic |
| Services | `*.service.ts` | all business rules and state transitions |
| Models | `server/src/models/*` | schema, indexes, unique/partial constraints |
| Integrations | `server/src/integrations/*` | replaceable adapters (AI provider, OCR provider, mail driver) selected by environment variables |
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
   cycles, revision tasks, schedule versions, documents, questions, mock tests, attempts,
   answers, exam mistakes, AI usage.

The curriculum (subjects → chapters → topics) lives in the workspace. Server engines reference
it by id and validate against it (`curriculum.service.ts`), so a client cannot attach work to
topics it does not have. The client flushes pending workspace edits before cycle/test actions.

## Study cycle engine (`modules/cycles`)

* A **day** has many **cycles**; a cycle has one **subject block** per cycle subject.
* Block states: `pending → revision → ready → learning → completed | skipped | incomplete`.
* Completing learning writes `StudyLog`s (`completed` or `partial`).
* Starting a cycle generates a `RevisionTask` (kind `cycle`) for each topic **fully completed
  today** that does not have one (`dedupeKey = cycle:<date>:<topicId>`, unique index), assigns up to
  `maxTopicsPerRevisionBlock` per subject to that subject's block, defers the rest.
* `start-learning` is refused (`409 REVISION_REQUIRED`) while assigned tasks are unresolved and
  revision is mandatory. A task resolves only by an explicit `complete` (with recall outcome /
  question counts) or `skip` (with reason). Opening or starting revision never completes it.
* Revision time is measured on the server (`completedAt − startedAt`).
* Ending a cycle, skipping a subject or optional-revision learning returns unresolved tasks to the
  **carry-forward** queue; partial topics and missed/incomplete subjects are listed there too.
* Only one active cycle per user (partial unique index). A cycle left active past midnight is
  closed as incomplete.
* **Spaced revision** (next-day / weekly / monthly) stays in the existing workspace engine.
  The cycle page calls `registerLearning` / `recordCycleRevision` so the Revision Center sees
  cycle work; a same-day cycle revision is recorded but does not advance spaced intervals.

## Schedule governance (`modules/schedule`)

* The Schedule page edits `state.scheduleDraft`; edits never touch sessions.
* Publishing creates an immutable `ScheduleVersion` (update hooks throw). Version 1 (baseline,
  auto-published from the existing timetable on first load) is free and effective today.
* Later publishes count against `SCHEDULE_MAX_CHANGES` per rolling `SCHEDULE_WINDOW_DAYS`, are
  effective **tomorrow at the earliest**, need a reason, and when the budget is spent require an
  emergency override with a ≥10-character reason (recorded + notification).
* For a date, the governing version is the highest version whose `effectiveFrom ≤ date`. The client
  switches its active timetable when that version changes; past session records are untouched.

## PDF → question bank pipeline (`modules/documents`)

```
upload (multer, 20 MB, %PDF- magic, sha256 dedupe, page count) → private storage
   → ProcessingJob (Mongo queue, retries with backoff, resumes after restart)
   → pdf.js text per page (eval disabled) → OCR provider for pages with < 25 chars
   → deterministic parser (numbering, (a)/(A)/A./(1) options, statement lists, answer-key
     section, inline “Ans:”, explanations, confidence + flags)
   → optional AI structuring of low-confidence items (grounding check; never answers)
   → insert with unique (userId, contentHash) → stats + notification
```
Statuses: `extracted` (confident) / `needs_review` (uncertain) → student `verified` / `rejected`.
Only verified questions are used in tests. Answers come only from the document (answer key /
inline) or from the student; AI-generated practice questions are labelled and stay
`needs_review` until verified.

## Exam engine (`modules/exams`)

* Selection is deterministic from a stored seed over the verified bank; insufficient buckets raise
  `422 INSUFFICIENT_QUESTIONS` with per-bucket availability (never a silently short test).
* Starting an attempt snapshots the questions (later bank edits don't change it), fixes
  `startedAt`/`deadlineAt` on the server, and hides answers until finished. One running attempt
  per test (partial unique index).
* Answers autosave via `PUT /answers` (accepted until deadline + 5 s grace). Expired attempts are
  finalized lazily on any read and by a 30 s sweeper.
* **Interruption policy:** the clock keeps running while disconnected. Reopening before the deadline
  resumes with saved answers (plus any unsynced answers kept in that tab's sessionStorage); after it,
  the attempt has been auto-submitted with what was saved.
* Submission is an atomic `in_progress → submitted` transition — repeated submits return the same
  result. Unknown/unverified answers are **unscored**, never wrong.
* Wrong verified answers upsert `ExamMistake` (unique per question; repeats increment `occurrences`).

## AI (`modules/ai`, `integrations/ai.ts`)

Provider interface with an Anthropic implementation using the official SDK (`claude-opus-5-5` by
default, structured JSON output, refusal handling, server-side fallback). Every call goes through
`runAI`: per-user switch, daily limit, burst limit, timeout, usage log without content. Prompts are
built from the authenticated user's own data and instruct the model not to invent history.

## Swappable infrastructure

| Concern | Now | Upgrade path |
|---|---|---|
| Job queue | `ProcessingJob` collection + in-process worker | implement `enqueueDocumentJob`/worker with BullMQ when Redis exists |
| File storage | `localStorage` driver in `integrations/storage.ts` | S3/GCS driver implementing `ObjectStorage`; signed URLs → provider presigned URLs |
| OCR | Tesseract CLI provider | any `OcrProvider` (cloud OCR) |
| Email | console / Resend | another `MailDriver` |
| Background notifications | foreground reminders (unchanged) | Web Push + service worker — **not implemented** |
