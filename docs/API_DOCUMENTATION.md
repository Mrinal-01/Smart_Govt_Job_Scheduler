# API documentation

Base path `/api`. JSON in/out. Every endpoint listed here is implemented. Ids are 24-hex Mongo ids
(malformed → `400 VALIDATION_ERROR`).

> **Reading this in a browser:** there is no Swagger/OpenAPI page — this Markdown file is the API reference.
> Open it with VS Code's Markdown preview (`Ctrl+Shift+V`) or on GitHub after pushing. To try endpoints,
> log in to the app, then call them from the browser dev-tools console, e.g.
> `fetch('/api/health').then(r => r.json())`; `/api/health` and `/api/config` need no login.

**Auth:** `Authorization: Bearer <accessToken>` (15 min JWT) unless marked *public*.
The refresh token is the HttpOnly cookie `studyos_rt` (path `/api/auth`); cookie endpoints also
require the header `X-StudyOS-CSRF: 1`.

**Errors:** `{ "error": { "code": "SNAKE_CASE", "message": "...", "details": {...} } }`.
Validation errors use `VALIDATION_ERROR` with `details.issues[] = {path, message}`.
Resources owned by another user return `404 NOT_FOUND`.

## System
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | *public* — `{status, db}` |
| GET | `/config` | *public* — AI/OCR availability, upload limits, schedule policy |

## Auth (`/auth`)
| Method | Path | Body / notes |
|---|---|---|
| POST | `/otp/request` | `{phone, purpose: signup|login}` → `{phone (E.164), expiresIn: 300, resendIn: 60, devOtp?}` (`devOtp` only in development with `SMS_DRIVER=console`); 400 `VALIDATION_ERROR` (invalid number), 409 `PHONE_IN_USE` (signup, number registered — log in instead), 404 `PHONE_NOT_REGISTERED` (login, unknown number — sign up first), 403 `ACCOUNT_DISABLED`, 429 `OTP_COOLDOWN` (`details.retryAfter` s), 429 `OTP_SEND_LIMIT` (5 codes/number/hour), 503 `SMS_UNAVAILABLE` |
| POST | `/register` | `{name, phone, otp, acceptTerms: true}` → 201 `{accessToken, expiresIn, user}` + refresh cookie (signed in); 409 `PHONE_IN_USE`; 422 `OTP_INCORRECT` (`details.attemptsLeft`) / `OTP_ATTEMPTS_EXCEEDED` / `OTP_EXPIRED` / `OTP_INVALID` |
| POST | `/login` | `{phone, otp}` → `{accessToken, expiresIn, user}` + cookie; 404 `PHONE_NOT_REGISTERED`, 403 `ACCOUNT_DISABLED`, 422 OTP errors as above |
| POST | `/refresh` | cookie + CSRF header → new access token, rotated cookie; 401 `REFRESH_REUSED` (family revoked), 409 `REFRESH_RACE` (retry) |
| POST | `/logout` | cookie + CSRF header → 204, family revoked |
| POST | `/logout-all` | bearer → 204; all sessions revoked, all access tokens invalid |
| GET/PATCH | `/me` | current user / `{name}` |
| POST | `/change-password` | legacy email accounts that still have a password only; 422 `NO_PASSWORD` otherwise |
| GET | `/sessions` | active devices `[{id, userAgent, ip, createdAt, lastUsedAt, current}]` |
| DELETE | `/sessions/:id` | sign out one device |

Validation: `phone` accepts `9876543210`, `+91 98765-43210`, `919876543210`, `09876543210` and is stored as E.164 (`+919876543210`); only `PHONE_ALLOWED_COUNTRY_CODES` (default `91`) are allowed and Indian numbers must be 10 digits starting 6–9. `name` 2–80 chars, letters/spaces/`.'-`. `otp` exactly 6 digits.
`user` = `{id, name, phone, phoneVerified, email|null, emailVerified, hasPassword, role, createdAt}`.

Rate limits: register/login 10/15 min/IP, OTP requests 20/h/IP plus 5/h and a 60 s cooldown per number, refresh 600/15 min, API 600/5 min (×10 in development). Email verification and password-reset endpoints were removed with phone sign-in.

Development only: `GET /dev/sms` lists the codes the console SMS driver "sent".

## Workspace (`/workspace`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{revision, schemaVersion, origin, updatedAt, data}`; 404 `WORKSPACE_NOT_FOUND` before onboarding |
| POST | `/` | `{origin: import|demo|fresh, data}` → 201; 409 `WORKSPACE_EXISTS` |
| PUT | `/` | `{baseRevision, data}` → `{revision}`; 409 `WORKSPACE_CONFLICT` (`details.currentRevision`) |

## Settings (`/settings`)
GET → `{settings}`; PATCH `{timezone?, cycle?: {subjectIds, defaultRevisionMinutes, revisionMinutesBySubject, revisionMinutesPerTopic, maxTopicsPerRevisionBlock, revisionMandatory, cyclesPerDay, sessionMinutes, breakMinutes}, plan?: {sameDayRevisionMinutes, nextDayRevisionEnabled, nextDayRevisionMinutes, weeklyRevisionMinutes, weeklyReviewWeekday, restWeekdays, holidays, requirePracticeInRevision}, ai?: {enabled}, exams?: {autoAddMistakes}}`.

## Alert sounds (`/sounds`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{sounds[{id, name, format, sizeBytes, createdAt}], limit: 10, maxBytes}` |
| POST | `/` | multipart `file` (MP3/WAV/OGG/M4A/WebM, ≤2 MB, format checked from the file bytes) + `name` (1–60) → 201 `{sound}`; 409 `SOUND_LIMIT` (max 10), 415 `UNSUPPORTED_FILE`, 413 too large |
| GET | `/:id/file` | streams the owner's file (404 for anyone else) |
| DELETE | `/:id` | 204 |

## Schedule & study plan (`/schedule`, `/plan`) — sessions, revision gates, weekly review, analytics

Code: `server/src/modules/plan/*`, `server/src/modules/schedule/*`, `server/src/modules/settings/*`. Client: `src/lib/plan.ts`.
Dates are `YYYY-MM-DD` **in the student's time zone** (`/api/settings` → `timezone`), never the server's; `:date` also accepts `today`; times are `HH:mm` local.
The client never supplies a status, an eligibility decision or a completion flag — the server derives them on every request.
Endpoints that need the curriculum answer `409 WORKSPACE_REQUIRED` before onboarding.

### Concepts

| Concept | Stored as | Notes |
|---|---|---|
| **Study session** | `studysessions` | One slot on one date, materialized from the `ScheduleVersion` that governs the date. The slot snapshot is frozen at creation, so later schedule versions never rewrite it. Types: `learning`, `revision`, `practice`, `mock_test`. |
| **Study cycle** | `cycleNumber` on slots/sessions | One round of the configured subjects. A subject can appear in several cycles per day; each appearance is its own session. Learning slots without an explicit number get their ordinal within the subject that day. |
| **Revision obligation** | `revisionobligations` | A required revision of *completed* learning. Types `same_day`, `next_day`, `weekly`, each with its own completion record. |
| **Revision attempt** | `revisionattempts` | Immutable completion record — exactly one per obligation (unique index). |
| **Gate override** | `gateoverrides` | Immutable audit record of an emergency bypass. |

#### Session states

Stored `status`: `scheduled | in_progress | completed | skipped | missed`.
Derived `state` (computed on every read):

| state | meaning |
|---|---|
| `scheduled` | future date |
| `ready` | today, no open dependencies |
| `pending_revision` | locked by an open same-day / next-day obligation |
| `revision_in_progress` | locked; the blocking revision has been started |
| `revision_completed` | its revision requirement was met; can start |
| `locked` | locked only by an explicit prerequisite session |
| `exception_approved` | locked, but an emergency override covers every current lock |
| `in_progress` / `completed` / `skipped` / `missed` | stored status |
| `overdue` | today, unlocked, not started, end time passed |

`revisionStatus`: `not_required | pending | in_progress | completed | bypassed`.

`revisionsBefore[]` places each revision in the day's timeline, immediately before the session it unlocks:
the subject's previous-day revision before **its first learning session of the day** (per_subject; with
all_subjects the whole block sits before the day's first learning session), and the same-day revision before
later cycles. Each item: `{obligationId, type, subjectName, sourceDate, sourceCycleNumber, topics[], plannedMinutes, status, state, bypassed, windowStart, windowEnd}`;
the window ends at the session's start time.

#### Typical day

| | Day 1 (first day) | Every following study day |
|---|---|---|
| Cycle 1, each subject | no revision — nothing learnt yet | revision of **that subject's** previous-day topics, then learning |
| Cycle 2, each subject | revision of that subject's cycle-1 topics, then learning | same |
| After the day ends | fully completed topics become next-day revisions, one per subject | |
`learningCompleted`, `revisionStatus = completed` and topic mastery are **three separate things**;
the plan engine never marks a topic mastered.

#### Gate rules (server-enforced on `POST /plan/sessions/:id/start`)

A `learning` session may start only when **all** hold:

1. It is today's session (student time zone) and `status = scheduled`.
2. **Previous-day carryover** — (only on study days, when `plan.nextDayRevisionEnabled`)
   * `plan.carryoverScope = per_subject` (default): the `next_day` obligation(s) of **the same subject** with `dueDate ≤ today` are completed. Each subject starts its day with its own revision and unlocks independently.
   * `plan.carryoverScope = all_subjects`: every open `next_day` obligation due today or earlier is completed (the whole carryover block before any learning).
3. **Same-day** — when its `revisionPolicy ≠ none`: every `same_day` obligation of the *same subject* sourced from an earlier session today is completed. Revising Mathematics never unlocks Reasoning.
4. **Prerequisites** — every `prerequisiteSlotIds` session of that day is completed.

…or an emergency override covers every currently blocking dependency. `revision`, `practice`
and `mock_test` sessions are only subject to rule 1 and 4.

#### Obligation generation

| Type | Created when | Topics | Due | Dedupe key |
|---|---|---|---|---|
| `same_day` | a learning session **completes** with ≥1 `completed` topic **and** a later learning session of the same subject exists that day whose policy ≠ `none` | that session's completed topics (`all_previous_cycles`: all completed topics of the subject today) | same day | `same_day:<sourceSessionId>` |
| `next_day` | lazily on any plan read once the source day has ended in the student's zone (14-day look-back) | all completed topics of that subject that day, grouped per subject | next **study** day (skips rest weekdays and holidays) | `next_day:<sourceDate>:<subjectId>` |
| `weekly` | lazily on plan reads for the current week | all completed topics of that subject in the ISO week | configured weekly review day | `weekly:<weekStart>:<subjectId>` |

Partial, skipped and missed learning never produces revision content. A pending obligation absorbs
learning completed later on its source day; once started it is frozen. Obligations are never
discarded by schedule changes, missed days or overrides; overdue ones stay open (`state = overdue`).

#### Consistency strategy

MongoDB runs standalone in the current deployment (no replica set), so multi-document transactions
are not used. Every transition is a **single-document conditional update** guarded by the expected
state, and every generator is **idempotent behind a unique index**:

| Operation | Guard |
|---|---|
| Materialize a day | unique `(userId, date, slotId)`; concurrent inserts collapse to one copy |
| Start / complete / skip session | `findOneAndUpdate({ _id, status: <expected> })`; losers re-read and return `alreadyStarted` / `alreadyCompleted` |
| Completed sessions are immutable | query middleware adds `status ≠ completed` to every update of `studysessions` |
| Generate obligation | unique `(userId, dedupeKey)`; duplicate insert → existing record |
| Complete revision | `findOneAndUpdate({ _id, status: 'in_progress' })`, then attempt insert behind unique `obligationId` (re-run on retry repairs a crash between the two writes) |
| Revision attempts, overrides, schedule versions | update hooks throw — append-only |
| Publish schedule | unique `(scheduleId, version)` |

Verified with parallel requests against a throw-away database.


### Schedule

The editable **draft** is persisted with the workspace (`state.scheduleDraft`, synced by
`PUT /api/workspace`); draft edits never consume a change. Frontend: `src/pages/SchedulePage.tsx`,
`src/components/ScheduleGovernance.tsx`.

#### Slot object (request and response)

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤80 | unique within the schedule |
| `weekday` | 0–6 | 0 = Sunday |
| `subjectId` | string | must exist in the curriculum |
| `sessionNumber` | 1–20 | display ordinal (default 1) |
| `label` | string ≤120 | |
| `startTime`, `endTime` | `HH:mm` | end after start; `durationMinutes` is always derived by the server |
| `sessionType` | `learning \| revision \| practice \| mock_test` | default `learning` |
| `cycleNumber` | 1–20 \| null | null = automatic; per subject per day cycles must increase with start time |
| `chapterId` | string \| null | must belong to the subject |
| `topicIds` | string[] ≤20 | must belong to the subject (and chapter, if set) |
| `revisionMinutes` | 1–180 \| null | null = per-subject setting → `plan.sameDayRevisionMinutes` |
| `revisionPolicy` | `previous_cycle \| all_previous_cycles \| none` | forced `none` for non-learning; omitted → derived from `requiresRevision` |
| `prerequisiteSlotIds` | string[] ≤10 | same weekday, start earlier, not itself |
| `requiresRevision`, `learningTarget` (≤300), `practiceTarget` (0–1000), `reminderEnabled`, `breakAfterMinutes` (0–240), `order` | | unchanged; `requiresRevision` is kept in sync with the policy |

Versions published before these fields existed are read with the defaults above (no migration needed).

#### GET `/schedule` — retrieve schedule & change allowance
Response `200`: `{ policy: {maxChanges, windowDays}, usage: {used, remaining, limit, windowDays, nextAvailableAt, overridesInWindow}, today, currentVersion, latest, active, pending }` (versions include `slots`).

#### POST `/schedule/preview` — preview changes
Body `{ slots: Slot[] }` (≤300). No write, never consumes a change.
Response `200`: `{ isBaseline, diff: {added[], removed[], modified[{slotId, fields[]}], summary[]}, validation: {errors[{slotId, message}], warnings[]}, carryOver: {pendingObligations, bySubject[{subjectName, count}]}, usage, policy }`.

#### POST `/schedule/publish` — publish
Body `{ slots, changeReason (≤500), effectiveFrom?, override?, overrideReason? }`.
Rules: first publish is free and effective today; later publishes need a change, apply from
tomorrow at the earliest (≤60 days), and consume one change of the rolling window
(`SCHEDULE_MAX_CHANGES` per `SCHEDULE_WINDOW_DAYS`, default 3 per 7 days, enforced on the server).
Dependencies are revalidated on every publish. Today's materialized sessions and all completed
history are untouched; pending obligations carry over.
Response `201`: `{ version, usage }`.
Errors: `422 INVALID_SCHEDULE_DEPENDENCIES` (`details` = validation), `422 NO_CHANGES`, `422 INVALID_EFFECTIVE_DATE`, `422 UNKNOWN_SUBJECT`, `422 DUPLICATE_SLOT`, `429 SCHEDULE_CHANGE_LIMIT` (`details.nextAvailableAt`), `422 OVERRIDE_REASON_REQUIRED` (override reason < 10 chars), `409 SCHEDULE_PUBLISH_RACE`.

#### GET `/schedule/versions`, GET `/schedule/versions/:version`, GET `/schedule/effective?date=`
Version history (immutable), one version with slots, version governing a date.


### Days & study cycles

#### GET `/plan/days/:date` — day plan
Materializes missing sessions up to today (first use starts today; afterwards a bounded 14-day catch-up), marks past unstarted sessions
`missed`, generates due obligations, then evaluates every session. Future dates are a read-only
projection (`projected: true`, `id: null`).
Response `200`:
```json
{
  "date": "2026-12-08", "today": "2026-12-08", "weekday": 2, "timezone": "Asia/Kolkata",
  "isStudyDay": true, "restReason": null, "projected": false, "scheduleVersion": 1,
  "sessions": [ SessionView ],
  "cycles": [ { "cycleNumber": 1, "total": 4, "completed": 1, "skipped": 0, "missed": 0, "inProgress": 0,
                "status": "in_progress", "subjects": [ { "sessionId": "…", "subjectName": "Mathematics", "status": "completed", "state": "completed" } ] } ],
  "carryover": Carryover | null,
  "summary": { "sessions": 8, "completed": 1, "skipped": 0, "missed": 0, "plannedMinutes": 480, "plannedLearningMinutes": 480, "actualLearningMinutes": 55 }
}
```
`SessionView`: `id, persisted, slotId, date, scheduleVersion, subjectId, subjectName, chapterId, chapterName, plannedTopics[], sessionType, cycleNumber, sessionNumber, label, startTime, endTime, plannedMinutes, learningTarget, practiceTarget, revisionMinutes, revisionPolicy, prerequisiteSlotIds, status, state, revisionStatus, locked, lockReasons[{kind: next_day|same_day|prerequisite, message, obligationId?, sessionId?}], override{id, reason, createdAt}|null, canStart, previousTopics[], learningCompleted, startedAt, completedAt, actualMinutes, completion{topics[{topicId, topicName, chapterId, chapterName, completion}], questionsAttempted, questionsCorrect, confidence, notes}|null, skipReason, rescheduledFrom`.
Errors: `400 VALIDATION_ERROR` (bad date). Frontend: `PlanTodayProvider`, `SchedulePage`, `SessionCard`, `CarryoverBanner`.

#### GET `/plan/days/:date/cycles` — cycle progress
Response `200`: `{ date, cycles[] }` (as above).

#### POST `/plan/days/:date/cycles/:cycleNumber/complete` — complete / close a cycle
Body `{ reason?: string ≤500 }`. Today only. If every learning session of the cycle is finished it
just confirms; otherwise a reason (≥3 chars) is required and the remaining not-started sessions are
recorded `skipped` with `"Cycle N closed: <reason>"`. Never touches obligations.
Response `200`: `{ cycle, cycles }`. Errors: `409 SESSION_NOT_TODAY`, `409 SESSION_IN_PROGRESS`, `422 REASON_REQUIRED`, `404 NOT_FOUND`.

#### POST `/plan/cycle-template` — generate cycle slots (no write)
Body `{ weekday 0–6, startTime HH:mm, cyclesPerDay? 1–8, subjectIds?[], sessionMinutes? 10–300, breakMinutes? 0–120, revisionMinutes? 1–180|null }`; omitted values come from `settings.cycle`.
Response `200`: `{ slots: Slot[], cyclesPerDay, subjects[{id, name}] }` — cycle 1 has policy `none`, later cycles `previous_cycle`. `startTime` is when the day begins: a revision-sized gap (`revisionMinutes`, default the larger of the same-day/next-day durations) is kept before **every** session, including the first, so the revision block fits in front of it.
Errors: `422 NO_SUBJECTS`, `422 TEMPLATE_TOO_LONG`. Frontend: `GenerateCyclesModal` (Schedule page) → draft.

#### Cycle configuration — `GET/PATCH /settings`
`cycle`: `subjectIds[]` (order), `cyclesPerDay` 1–8, `sessionMinutes` 10–300, `breakMinutes` 0–120, `revisionMinutesBySubject{subjectId: 0–180}`, existing runner fields.
`plan`: `sameDayRevisionMinutes` 1–180 (default 15), `nextDayRevisionEnabled` (true), `nextDayRevisionMinutes` 1–180 (15), `carryoverScope` `per_subject|all_subjects` (`per_subject`), `weeklyRevisionMinutes` 1–300 (30), `weeklyReviewWeekday` 0–6 (0 = Sunday), `restWeekdays[]` 0–6, `holidays[]` dates, `requirePracticeInRevision` (false).
`timezone`: IANA zone — defines the study-day boundary.
Response `{ settings }`. Frontend: `PlanPreferencesSection`, `RevisionPreferencesSection` (Settings › Revision preferences).


### Study sessions

#### GET `/plan/sessions?from&to&status` — list
Defaults to today. `status ∈ scheduled|in_progress|completed|skipped|missed`. Response `{ sessions: SessionView[] }` (max 1000).

#### GET `/plan/sessions/:id` — details
Response `{ session, dependencies: {revisions: Obligation[], prerequisites[{id, subjectName, label, startTime, status, satisfied}]}, generatedObligations: Obligation[], overrides: Override[] }`. Frontend: Schedule › View details.

#### GET `/plan/sessions/:id/dependencies` — dependencies & lock reason
Response `{ sessionId, state, locked, lockReasons[], override, dependencies, generatedObligations, overrides }`. Frontend: Schedule › View dependencies / View revision requirements, `LockedSessionModal`.

#### GET `/plan/sessions/:id/eligibility` — validate eligibility
Response `{ sessionId, eligible, state, locked, lockReasons[], override }`.

#### POST `/plan/sessions/:id/start`
No body. Response `200 { session, alreadyStarted }` (repeat calls are idempotent).
Errors: `409 SESSION_LOCKED` (`details: {state, lockReasons}`), `409 SESSION_NOT_TODAY`, `409 SESSION_DAY_PASSED`, `409 INVALID_SESSION_STATE` (`details.status`), `409 SESSION_RACE`, `404`.
Frontend: `SessionWorkflowHost` (local timer starts only after this succeeds).

#### POST `/plan/sessions/:id/complete`
Body:
```json
{ "topics": [ { "topicId": "ns-basics", "completion": "completed" }, { "topicId": "ns-hcf", "completion": "partial" } ],
  "questionsAttempted": 10, "questionsCorrect": 7, "confidence": 4, "notes": "…", "actualMinutes": 55 }
```
Rules: session must be `in_progress` (started through the gate); learning sessions need ≥1 topic;
topics must belong to the session's subject, no duplicates (≤20); `questionsCorrect ≤ questionsAttempted`;
`confidence` 1–5; `actualMinutes` is capped by the server-measured elapsed time. Generates the same-day obligation.
Response `200 { session, generated: Obligation | null, alreadyCompleted }`.
Errors: `409 SESSION_NOT_STARTED`, `422 TOPICS_REQUIRED`, `422 UNKNOWN_TOPIC`, `422 TOPIC_SUBJECT_MISMATCH`, `422 DUPLICATE_TOPIC`, `422 INVALID_COUNTS`. Frontend: `CompletionModal`.

#### POST `/plan/sessions/:id/skip` — request skip
Body `{ reason: 3–1000 chars }`. Today, `scheduled|in_progress` only. Never resolves or bypasses a revision.
Response `200 { session, alreadySkipped }`. Errors: `409 INVALID_SESSION_STATE`, `409 SESSION_NOT_TODAY`/`SESSION_DAY_PASSED`.

#### POST `/plan/sessions/:id/override` — emergency exception
Body `{ reason: 10–1000 chars }`. Only for a locked, `scheduled` session today. Records user, time,
session, bypassed obligation ids / prerequisite ids, original state and lock reasons; adds the
override id to each obligation's `bypassedBy`. The obligations stay **pending**; completing the
session never resolves them. Creates a notification.
Response `201 { session (state exception_approved), override, alreadyOverridden }`.
Errors: `409 SESSION_NOT_LOCKED`, `409 INVALID_SESSION_STATE`, `400 VALIDATION_ERROR` (reason too short). Frontend: `LockedSessionModal`, Schedule › Request exception.

#### POST `/plan/sessions/:id/reschedule` — today-only time change
Body `{ startTime, endTime }`. Not-started session today; end after start and not already past; a
learning session cannot move before an earlier cycle (or after a later cycle) of its subject. The
published schedule is not changed and no change allowance is used; `rescheduledFrom` keeps the original.
Response `{ session }`. Errors: `422 INVALID_TIME_RANGE`, `422 CYCLE_ORDER`, `409 INVALID_SESSION_STATE`. Frontend: Schedule › Reschedule today only.


### Revision

`Obligation`: `id, type, subjectId, subjectName, topics[{topicId, topicName, chapterId, chapterName}], chapters[], sourceSessionIds[], sourceSessions[{id, date, label, cycleNumber, startTime, endTime}], sourceDate, sourceCycleNumber, targetSessionId, dueDate, weekStart, plannedMinutes, practiceRequired, status (pending|in_progress|completed), state (pending|in_progress|overdue|completed), overdue, bypassed, bypassCount, startedAt, completedAt, result{topicsRevised[], questionsAttempted, questionsCorrect, questionsWrong, confidence, notes, actualMinutes}|null`.

#### GET `/plan/revisions?type&state&subjectId&from&to&limit`
`type ∈ same_day|next_day|weekly`; `state ∈ open|pending|in_progress|overdue|completed`; dates filter `dueDate`; `limit` 1–500 (200).
Response `{ today, obligations[], summary: {same_day:{open, completed}, next_day:{…}, weekly:{…}, overdue} }`. Frontend: Revision Center.

#### GET `/plan/revisions/overdue`
Same shape, open obligations with `dueDate < today`.

#### GET `/plan/revisions/carryover?date=`
Daily Carryover Revision block. Response `{ date, enabled, scope, required, complete, obligations[], totalMinutes, remainingMinutes }`. Frontend: `CarryoverBanner` (Dashboard, Sessions, Schedule).

#### GET `/plan/revisions/history?days=30`
Response `{ attempts: [ RevisionAttempt + { id, obligation } ] }` (days 1–365).

#### GET `/plan/revisions/:id`
Response `{ obligation, attempt | null }`.

#### GET `/plan/revisions/:id/preparation` — Revision Preparation Panel
Response `{ obligation, topics[{…topic, keyPoints[], formulas[], notes}], sessionNotes[{sessionId, date, label, cycleNumber, notes}], checklist[{id, kind: topic|formula, label, topicId}], practiceQuestions[{id, topicId, text, options[], difficulty}] (verified bank questions, no answers), mistakes[{id, source: mock_test|mistake_bank, topicId, question, explanation, category, occurrences}], timer{plannedMinutes, startedAt, elapsedSeconds} }`. Frontend: `RevisionWorkspace`.

#### POST `/plan/revisions/:id/start`
`pending → in_progress` (sets the server start time). Idempotent while in progress.
Errors: `409 REVISION_NOT_DUE` (`details.dueDate`; e.g. weekly before the review day), `409 REVISION_ALREADY_COMPLETED`.

#### POST `/plan/revisions/:id/complete`
Body:
```json
{ "topicsRevised": ["ns-basics", "ns-hcf"], "questionsAttempted": 5, "questionsCorrect": 4, "questionsWrong": 1,
  "confidence": 4, "notes": "optional", "actualMinutes": 15 }
```
Rules: must be started; `topicsRevised` must contain **every** obligation topic and nothing else;
`confidence` 1–5 required; `questionsWrong` defaults to attempted − correct; correct + wrong ≤ attempted;
when `practiceRequired`, `questionsAttempted ≥ 1`; `actualMinutes` ≤ server-measured elapsed.
The only way an obligation becomes completed. Completing one type never completes another.
Response `200 { obligation, attempt, alreadyCompleted }` — a repeated or concurrent request returns the
original result and never creates a second attempt.
Errors: `409 REVISION_NOT_STARTED`, `422 REVISION_INCOMPLETE` (`details.missing[]`), `422 UNKNOWN_REVISION_TOPIC`, `422 INVALID_COUNTS`, `422 PRACTICE_REQUIRED`, `409 REVISION_RACE`.


### Weekly review

#### GET `/plan/weekly?weekStart=` — weekly topics, obligations & summary
`weekStart` any date (normalized to its Monday); default current week.
Response `{ weekStart, weekEnd, dueDate, today, obligations[], progress{total, completed, inProgress, pending, topicsTotal, topicsRevised}, topics[{subjectId, subjectName, chapters[{chapterId, chapterName, topics[{topicId, topicName, dates[]}]}]}], mistakes{unresolvedMockMistakes[], unresolvedBankCount, weekBankMistakes[]}, weakTopics[], lowConfidenceTopicIds[], mockTests{count, averageAccuracy, tests[]}, summary{learningSessionsPlanned, learningSessionsCompleted, skipped, missed, learningMinutes, revisionMinutes, revisionsCompleted{same_day, next_day, weekly}, revisionAccuracy} }`. Frontend: Sunday Review.

#### GET `/plan/weekly/progress?weekStart=`
Response `{ weekStart, weekEnd, dueDate, progress, summary }`.

#### Complete weekly revision
`POST /plan/revisions/:id/start` then `POST /plan/revisions/:id/complete` on a `weekly` obligation (one per subject). Weekly obligations never gate learning.


### Overrides & analytics

#### GET `/plan/overrides?days=30`
Response `{ overrides: [{ id, sessionId, sessionDate, subjectId, subjectName, reason, originalState, lockReasons[], obligationIds[], prerequisiteSessionIds[], decision: 'bypassed', createdAt }] }`.

#### GET `/plan/analytics?days=30` (1–180)
Response `{ range, time{plannedLearningMinutes, actualLearningMinutes, plannedRevisionMinutes, actualRevisionMinutes, practiceMinutes, mockTestMinutes, scheduledRevisionSessionMinutes}, revisions{same_day|next_day|weekly: {total, completed, open, overdue, bypassed, completionRate}}, overdueRevisions, sessions{planned, completed, skipped, missed, completionRate}, overrides{gate, schedule, recent[]}, subjects[…, completionRate, revisionCompletionRate], chapters[{chapterId, chapterName, subjectName, topicsTotal, topicsLearned, topicsRevised}], performance{learningQuestions, learningAccuracy, revisionQuestions, revisionAccuracy, averageRevisionConfidence}, daily[{date, learningMinutes, revisionMinutes}] }`.
Revision time is never counted as learning time; a bypassed obligation counts as open, never completed. Frontend: Analytics › Learning vs revision.

---

## Documents & files
| Method | Path | Notes |
|---|---|---|
| POST | `/documents` | multipart: `file` (PDF), `subjectIds` (**required**, comma-separated ids from the uploader's curriculum), `mockType?` → 201 queued, or 200 `{duplicate: true}` (same file by the same student); 422 `SUBJECT_REQUIRED` / `UNKNOWN_SUBJECT` / `PDF_ENCRYPTED` / `PDF_INVALID` / `PDF_TOO_MANY_PAGES`; 413/415 |
| GET | `/documents` | the student's own uploads |
| GET | `/documents/:id` | document (`stats.inserted, duplicates, pendingAnswer, answersFilled, needsReview…`) + `questionCounts` by hub status (includes questions this PDF shared with earlier uploads) |
| POST | `/documents/:id/reprocess` | 202 |
| POST | `/documents/:id/file-url` | `{url, expiresAt}` — HMAC-signed, 5 minutes (owner only) |
| DELETE | `/documents/:id` | deletes the file and its questions that are **not ready and not used in any test**; ready questions stay in the hub |
| GET | `/files/:id?exp&sig` | streams the PDF if the signature is valid and unexpired; 403 otherwise |

Processing: text → OCR fallback → rule-based parser → optional AI structuring → insert into the **shared question hub** (global dedupe by content hash; a duplicate's missing answer/subject is filled from this upload) → background AI answering of questions without an answer key.

## Questions (`/questions`) — central question hub
All students share one hub. A question is used in tests only when `status = ready` (trusted answer).

| status | meaning |
|---|---|
| `pending_answer` | no answer key — queued for background AI answering (stays here until `AI_PROVIDER=openai` + key are set; then answered automatically) |
| `ready` | answer from the PDF key (`document_key`), its uploader (`student`) or AI with confidence ≥ 0.75 (`ai`) |
| `needs_review` | unclear extraction, missing subject, AI unsure/unanswerable/invalid, or reported wrong |
| `rejected` | excluded by its uploader |

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `scope=hub|mine`, `status`, `subjectId` (mapped by name) or `subjectKey`, `difficulty`, `origin`, `documentId`, `q`, `page`, `limit`. Answers (`correctAnswer`, `answerExplanation`) are only returned for your own uploads |
| GET | `/stats` | hub counts by status and subject, your uploads, `ai.configured` |
| GET | `/hub-summary` | ready / pending / review counts for each subject of your curriculum (test builder) |
| POST | `/` | add a question (`subjectId` required for ready; `correctAnswer` optional → otherwise AI solves it); 409 `DUPLICATE_QUESTION` |
| GET | `/:id` | one question |
| PATCH | `/:id` | **uploader only** (403 otherwise): text, type, options, `correctAnswer` (becomes `student` answer → ready), explanation, taxonomy, difficulty. Clearing the answer or changing content re-queues AI answering |
| POST | `/:id/confirm` | uploader: make a reviewed question usable (ready, or pending AI when it has no answer); 422 `CANNOT_CONFIRM` with `details.problems[]` |
| POST | `/:id/reject` | uploader only |
| POST | `/:id/report` | `{reason}` — only students who answered it in a finished test (403 otherwise). Ready → `needs_review` immediately and an AI re-check at `xhigh` effort; back to ready only if the re-check agrees. Idempotent per student |
| DELETE | `/:id` | uploader only; retired (rejected) instead of deleted when other students' tests use it → `{retired}` |
| POST | `/bulk` | `{ids[], action: confirm|reject|delete|assign, assign?}` → per-id results (uploader's own questions) |

AI answering (server-side, `modules/questions/answer.service.ts`): batches of 5, `AI_ANSWER_MODEL` (default `gpt-6.2-sol`) at `AI_ANSWER_EFFORT` (default `high`), strict JSON output. An answer is accepted only if the model marks it answerable, every label is a real option label, the count matches the type (single/true-false = 1), numeric answers are numbers, and confidence ≥ 0.75; otherwise `needs_review`. AI errors retry with backoff and never mark a question ready. A sweeper (every 10 min while AI is configured) queues anything still pending. AI-generated practice questions are solved independently and become ready only if both answers agree.

## Mock tests (`/mock-tests`)
| Method | Path | Notes |
|---|---|---|
| GET | `/?kind=test|template` | tests include attempt counts, last result, running attempt |
| POST | `/preview` | `{type, config}` → `{ok, total, buckets[{label, requested, available, detail?}]}` — availability of **ready hub questions** |
| POST | `/` | `{name, type: full_mixed|sectional|subject_full|chapter|topic, config, saveAsTemplate?}` → 201; 422 `INSUFFICIENT_QUESTIONS` (never a short test) |
| POST | `/templates` | save a template |
| POST | `/templates/:id/generate` | new test from template |
| GET/DELETE | `/:id` | delete archives (409 `ATTEMPT_RUNNING`) |

Selection draws from the shared hub: the student's subject/chapter/topic ids are matched to hub questions by normalized name ("Maths" = "Mathematics"); only `ready` questions; avoid-recent works per student.

`config`: `subjectIds, chapterIds, topicIds, distribution[{subjectId,count}], questionCount, durationMinutes, marksPerQuestion, negativeMarks, selectionMethod (random|difficulty|topic), difficultyDistribution{easy,medium,hard} (sum 100), avoidRecentDays, shuffleQuestions, shuffleOptions, instructions`.

## Attempts (`/attempts`)
| Method | Path | Notes |
|---|---|---|
| GET | `/?mockTestId=` | history |
| GET | `/performance` | aggregated subject/chapter accuracy, weak chapters, trend |
| POST | `/` | `{mockTestId}` → 201 new or 200 `{resumed: true}`; questions that stopped being ready since the test was built (e.g. reported) are left out (`missingQuestions`) |
| GET | `/:id` | running: no answers/explanations, `serverNow`, `deadlineAt`, `remainingSeconds`, saved answers; finished: full review + `result`, and per question `answerSource` (`document_key|student|ai`), `answerConfidence`, `answerExplanation` |
| PUT | `/:id/answers` | `{answers: [{questionId, selected[], markedForReview?, visited?}]}`; 409 `ATTEMPT_CLOSED` |
| POST | `/:id/submit` | idempotent |
| POST | `/:id/retake` | `{mode: incorrect|unanswered|all}` → practice test |
| POST | `/:id/mistakes` | `{questionId}` → add to Mistake Bank |

## Mistakes (`/mistakes`) — PDF mock test mistakes
GET (`status?`, `subjectId?`), PATCH `/:id` `{status?, category?}`, POST `/:id/review`, DELETE `/:id`.

## AI (`/ai`)
| Method | Path | Notes |
|---|---|---|
| GET | `/status` | configured, provider (`openai`), model, per-user switch, usage today |
| POST | `/ask` | AI Help. `{message (1–2000), history?[{role, content}] ≤12}` → `{allowed, category, content}`. Out-of-scope messages return `allowed:false` with a fixed refusal text. |
| POST | `/explain-answer` | `{attemptId, questionId}` (finished attempts only) |
| POST | `/explain-topic` | `{topicId, focus?}` |
| POST | `/practice-questions` | `{topicId, count 1–10, difficulty}` → saved as `ai_generated`, `needs_review` |

Errors: 503 `AI_NOT_CONFIGURED`, 403 `AI_DISABLED_BY_USER`, 429 `AI_DAILY_LIMIT` / `RATE_LIMITED`, 422 `AI_REFUSED`, 502/504 provider errors.

## Notifications (`/notifications`)
GET (latest 50 + unread count), POST `/:id/read`, POST `/read-all`.
