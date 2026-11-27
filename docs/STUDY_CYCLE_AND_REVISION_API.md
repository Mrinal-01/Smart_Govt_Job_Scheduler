# Study cycles, revision gates & schedule governance — API

Server-authoritative scheduled sessions, mandatory revision gates (same-day, next-day carryover),
weekly revision, audited emergency overrides and the schedule change policy.

Code: `server/src/modules/plan/*` (new), `server/src/modules/schedule/*` (extended),
`server/src/modules/settings/*` (extended). Client: `src/lib/plan.ts`.

## Conventions

| | |
|---|---|
| Base path | `/api` |
| Authentication | Every endpoint below requires `Authorization: Bearer <accessToken>` (`requireAuth`). Missing/invalid token → `401 UNAUTHORIZED` / `TOKEN_EXPIRED` / `TOKEN_INVALID`. |
| Ownership | Every query is scoped to the caller. Another student's id answers `404 NOT_FOUND` (existence is not leaked). |
| Ids | 24-hex Mongo ids. A malformed id → `400 VALIDATION_ERROR`. |
| Dates | `YYYY-MM-DD` **in the student's configured time zone** (`/api/settings` → `timezone`), never the server's. `:date` also accepts `today`. Times are `HH:mm` local. |
| Errors | `{ "error": { "code": "SNAKE_CASE", "message": "…", "details": { … } } }`. Validation → `400 VALIDATION_ERROR` with `details.issues[] = {path, message}`. |
| Trust | The client never supplies a status, an eligibility decision or a completion flag. The server derives them from stored records on every request. |
| Workspace | Endpoints that need the curriculum answer `409 WORKSPACE_REQUIRED` before onboarding. |

## Concepts

| Concept | Stored as | Notes |
|---|---|---|
| **Study session** | `studysessions` | One slot on one date, materialized from the `ScheduleVersion` that governs the date. The slot snapshot is frozen at creation, so later schedule versions never rewrite it. Types: `learning`, `revision`, `practice`, `mock_test`. |
| **Study cycle** | `cycleNumber` on slots/sessions | One round of the configured subjects. A subject can appear in several cycles per day; each appearance is its own session. Learning slots without an explicit number get their ordinal within the subject that day. |
| **Revision obligation** | `revisionobligations` | A required revision of *completed* learning. Types `same_day`, `next_day`, `weekly`, each with its own completion record. |
| **Revision attempt** | `revisionattempts` | Immutable completion record — exactly one per obligation (unique index). |
| **Gate override** | `gateoverrides` | Immutable audit record of an emergency bypass. |

### Session states

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

### Typical day

| | Day 1 (first day) | Every following study day |
|---|---|---|
| Cycle 1, each subject | no revision — nothing learnt yet | revision of **that subject's** previous-day topics, then learning |
| Cycle 2, each subject | revision of that subject's cycle-1 topics, then learning | same |
| After the day ends | fully completed topics become next-day revisions, one per subject | |
`learningCompleted`, `revisionStatus = completed` and topic mastery are **three separate things**;
the plan engine never marks a topic mastered.

### Gate rules (server-enforced on `POST /plan/sessions/:id/start`)

A `learning` session may start only when **all** hold:

1. It is today's session (student time zone) and `status = scheduled`.
2. **Previous-day carryover** — (only on study days, when `plan.nextDayRevisionEnabled`)
   * `plan.carryoverScope = per_subject` (default): the `next_day` obligation(s) of **the same subject** with `dueDate ≤ today` are completed. Each subject starts its day with its own revision and unlocks independently.
   * `plan.carryoverScope = all_subjects`: every open `next_day` obligation due today or earlier is completed (the whole carryover block before any learning).
3. **Same-day** — when its `revisionPolicy ≠ none`: every `same_day` obligation of the *same subject* sourced from an earlier session today is completed. Revising Mathematics never unlocks Reasoning.
4. **Prerequisites** — every `prerequisiteSlotIds` session of that day is completed.

…or an emergency override covers every currently blocking dependency. `revision`, `practice`
and `mock_test` sessions are only subject to rule 1 and 4.

### Obligation generation

| Type | Created when | Topics | Due | Dedupe key |
|---|---|---|---|---|
| `same_day` | a learning session **completes** with ≥1 `completed` topic **and** a later learning session of the same subject exists that day whose policy ≠ `none` | that session's completed topics (`all_previous_cycles`: all completed topics of the subject today) | same day | `same_day:<sourceSessionId>` |
| `next_day` | lazily on any plan read once the source day has ended in the student's zone (14-day look-back) | all completed topics of that subject that day, grouped per subject | next **study** day (skips rest weekdays and holidays) | `next_day:<sourceDate>:<subjectId>` |
| `weekly` | lazily on plan reads for the current week | all completed topics of that subject in the ISO week | configured weekly review day | `weekly:<weekStart>:<subjectId>` |

Partial, skipped and missed learning never produces revision content. A pending obligation absorbs
learning completed later on its source day; once started it is frozen. Obligations are never
discarded by schedule changes, missed days or overrides; overdue ones stay open (`state = overdue`).

### Consistency strategy

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

---

## Schedule

The editable **draft** is persisted with the workspace (`state.scheduleDraft`, synced by
`PUT /api/workspace`); draft edits never consume a change. Frontend: `src/pages/SchedulePage.tsx`,
`src/components/ScheduleGovernance.tsx`.

### Slot object (request and response)

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

### GET `/schedule` — retrieve schedule & change allowance
Response `200`: `{ policy: {maxChanges, windowDays}, usage: {used, remaining, limit, windowDays, nextAvailableAt, overridesInWindow}, today, currentVersion, latest, active, pending }` (versions include `slots`).

### POST `/schedule/preview` — preview changes (modified)
Body `{ slots: Slot[] }` (≤300). No write, never consumes a change.
Response `200`: `{ isBaseline, diff: {added[], removed[], modified[{slotId, fields[]}], summary[]}, validation: {errors[{slotId, message}], warnings[]}, carryOver: {pendingObligations, bySubject[{subjectName, count}]}, usage, policy }`.

### POST `/schedule/publish` — publish (modified)
Body `{ slots, changeReason (≤500), effectiveFrom?, override?, overrideReason? }`.
Rules: first publish is free and effective today; later publishes need a change, apply from
tomorrow at the earliest (≤60 days), and consume one change of the rolling window
(`SCHEDULE_MAX_CHANGES` per `SCHEDULE_WINDOW_DAYS`, default 3 per 7 days, enforced on the server).
Dependencies are revalidated on every publish. Today's materialized sessions and all completed
history are untouched; pending obligations carry over.
Response `201`: `{ version, usage }`.
Errors: `422 INVALID_SCHEDULE_DEPENDENCIES` (`details` = validation), `422 NO_CHANGES`, `422 INVALID_EFFECTIVE_DATE`, `422 UNKNOWN_SUBJECT`, `422 DUPLICATE_SLOT`, `429 SCHEDULE_CHANGE_LIMIT` (`details.nextAvailableAt`), `422 OVERRIDE_REASON_REQUIRED` (override reason < 10 chars), `409 SCHEDULE_PUBLISH_RACE`.

### GET `/schedule/versions`, GET `/schedule/versions/:version`, GET `/schedule/effective?date=`
Version history (immutable), one version with slots, version governing a date. Unchanged.

---

## Days & study cycles

### GET `/plan/days/:date` — day plan
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

### GET `/plan/days/:date/cycles` — cycle progress
Response `200`: `{ date, cycles[] }` (as above).

### POST `/plan/days/:date/cycles/:cycleNumber/complete` — complete / close a cycle
Body `{ reason?: string ≤500 }`. Today only. If every learning session of the cycle is finished it
just confirms; otherwise a reason (≥3 chars) is required and the remaining not-started sessions are
recorded `skipped` with `"Cycle N closed: <reason>"`. Never touches obligations.
Response `200`: `{ cycle, cycles }`. Errors: `409 SESSION_NOT_TODAY`, `409 SESSION_IN_PROGRESS`, `422 REASON_REQUIRED`, `404 NOT_FOUND`.

### POST `/plan/cycle-template` — generate cycle slots (no write)
Body `{ weekday 0–6, startTime HH:mm, cyclesPerDay? 1–8, subjectIds?[], sessionMinutes? 10–300, breakMinutes? 0–120, revisionMinutes? 1–180|null }`; omitted values come from `settings.cycle`.
Response `200`: `{ slots: Slot[], cyclesPerDay, subjects[{id, name}] }` — cycle 1 has policy `none`, later cycles `previous_cycle`. `startTime` is when the day begins: a revision-sized gap (`revisionMinutes`, default the larger of the same-day/next-day durations) is kept before **every** session, including the first, so the revision block fits in front of it.
Errors: `422 NO_SUBJECTS`, `422 TEMPLATE_TOO_LONG`. Frontend: `GenerateCyclesModal` (Schedule page) → draft.

### Cycle configuration — `GET/PATCH /settings` (extended)
`cycle`: `subjectIds[]` (order), `cyclesPerDay` 1–8, `sessionMinutes` 10–300, `breakMinutes` 0–120, `revisionMinutesBySubject{subjectId: 0–180}`, existing runner fields.
`plan`: `sameDayRevisionMinutes` 1–180 (default 15), `nextDayRevisionEnabled` (true), `nextDayRevisionMinutes` 1–180 (15), `carryoverScope` `per_subject|all_subjects` (`per_subject`), `weeklyRevisionMinutes` 1–300 (30), `weeklyReviewWeekday` 0–6 (0 = Sunday), `restWeekdays[]` 0–6, `holidays[]` dates, `requirePracticeInRevision` (false).
`timezone`: IANA zone — defines the study-day boundary.
Response `{ settings }`. Frontend: `PlanPreferencesSection`, `RevisionPreferencesSection` (Settings › Revision preferences).

---

## Study sessions

### GET `/plan/sessions?from&to&status` — list
Defaults to today. `status ∈ scheduled|in_progress|completed|skipped|missed`. Response `{ sessions: SessionView[] }` (max 1000).

### GET `/plan/sessions/:id` — details
Response `{ session, dependencies: {revisions: Obligation[], prerequisites[{id, subjectName, label, startTime, status, satisfied}]}, generatedObligations: Obligation[], overrides: Override[] }`. Frontend: Schedule › View details.

### GET `/plan/sessions/:id/dependencies` — dependencies & lock reason
Response `{ sessionId, state, locked, lockReasons[], override, dependencies, generatedObligations, overrides }`. Frontend: Schedule › View dependencies / View revision requirements, `LockedSessionModal`.

### GET `/plan/sessions/:id/eligibility` — validate eligibility
Response `{ sessionId, eligible, state, locked, lockReasons[], override }`.

### POST `/plan/sessions/:id/start`
No body. Response `200 { session, alreadyStarted }` (repeat calls are idempotent).
Errors: `409 SESSION_LOCKED` (`details: {state, lockReasons}`), `409 SESSION_NOT_TODAY`, `409 SESSION_DAY_PASSED`, `409 INVALID_SESSION_STATE` (`details.status`), `409 SESSION_RACE`, `404`.
Frontend: `SessionWorkflowHost` (local timer starts only after this succeeds).

### POST `/plan/sessions/:id/complete`
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

### POST `/plan/sessions/:id/skip` — request skip
Body `{ reason: 3–1000 chars }`. Today, `scheduled|in_progress` only. Never resolves or bypasses a revision.
Response `200 { session, alreadySkipped }`. Errors: `409 INVALID_SESSION_STATE`, `409 SESSION_NOT_TODAY`/`SESSION_DAY_PASSED`.

### POST `/plan/sessions/:id/override` — emergency exception
Body `{ reason: 10–1000 chars }`. Only for a locked, `scheduled` session today. Records user, time,
session, bypassed obligation ids / prerequisite ids, original state and lock reasons; adds the
override id to each obligation's `bypassedBy`. The obligations stay **pending**; completing the
session never resolves them. Creates a notification.
Response `201 { session (state exception_approved), override, alreadyOverridden }`.
Errors: `409 SESSION_NOT_LOCKED`, `409 INVALID_SESSION_STATE`, `400 VALIDATION_ERROR` (reason too short). Frontend: `LockedSessionModal`, Schedule › Request exception.

### POST `/plan/sessions/:id/reschedule` — today-only time change
Body `{ startTime, endTime }`. Not-started session today; end after start and not already past; a
learning session cannot move before an earlier cycle (or after a later cycle) of its subject. The
published schedule is not changed and no change allowance is used; `rescheduledFrom` keeps the original.
Response `{ session }`. Errors: `422 INVALID_TIME_RANGE`, `422 CYCLE_ORDER`, `409 INVALID_SESSION_STATE`. Frontend: Schedule › Reschedule today only.

---

## Revision

`Obligation`: `id, type, subjectId, subjectName, topics[{topicId, topicName, chapterId, chapterName}], chapters[], sourceSessionIds[], sourceSessions[{id, date, label, cycleNumber, startTime, endTime}], sourceDate, sourceCycleNumber, targetSessionId, dueDate, weekStart, plannedMinutes, practiceRequired, status (pending|in_progress|completed), state (pending|in_progress|overdue|completed), overdue, bypassed, bypassCount, startedAt, completedAt, result{topicsRevised[], questionsAttempted, questionsCorrect, questionsWrong, confidence, notes, actualMinutes}|null`.

### GET `/plan/revisions?type&state&subjectId&from&to&limit`
`type ∈ same_day|next_day|weekly`; `state ∈ open|pending|in_progress|overdue|completed`; dates filter `dueDate`; `limit` 1–500 (200).
Response `{ today, obligations[], summary: {same_day:{open, completed}, next_day:{…}, weekly:{…}, overdue} }`. Frontend: Revision Center.

### GET `/plan/revisions/overdue`
Same shape, open obligations with `dueDate < today`.

### GET `/plan/revisions/carryover?date=`
Daily Carryover Revision block. Response `{ date, enabled, scope, required, complete, obligations[], totalMinutes, remainingMinutes }`. Frontend: `CarryoverBanner` (Dashboard, Sessions, Schedule).

### GET `/plan/revisions/history?days=30`
Response `{ attempts: [ RevisionAttempt + { id, obligation } ] }` (days 1–365).

### GET `/plan/revisions/:id`
Response `{ obligation, attempt | null }`.

### GET `/plan/revisions/:id/preparation` — Revision Preparation Panel
Response `{ obligation, topics[{…topic, keyPoints[], formulas[], notes}], sessionNotes[{sessionId, date, label, cycleNumber, notes}], checklist[{id, kind: topic|formula, label, topicId}], practiceQuestions[{id, topicId, text, options[], difficulty}] (verified bank questions, no answers), mistakes[{id, source: mock_test|mistake_bank, topicId, question, explanation, category, occurrences}], timer{plannedMinutes, startedAt, elapsedSeconds} }`. Frontend: `RevisionWorkspace`.

### POST `/plan/revisions/:id/start`
`pending → in_progress` (sets the server start time). Idempotent while in progress.
Errors: `409 REVISION_NOT_DUE` (`details.dueDate`; e.g. weekly before the review day), `409 REVISION_ALREADY_COMPLETED`.

### POST `/plan/revisions/:id/complete`
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

---

## Weekly review

### GET `/plan/weekly?weekStart=` — weekly topics, obligations & summary
`weekStart` any date (normalized to its Monday); default current week.
Response `{ weekStart, weekEnd, dueDate, today, obligations[], progress{total, completed, inProgress, pending, topicsTotal, topicsRevised}, topics[{subjectId, subjectName, chapters[{chapterId, chapterName, topics[{topicId, topicName, dates[]}]}]}], mistakes{unresolvedMockMistakes[], unresolvedBankCount, weekBankMistakes[]}, weakTopics[], lowConfidenceTopicIds[], mockTests{count, averageAccuracy, tests[]}, summary{learningSessionsPlanned, learningSessionsCompleted, skipped, missed, learningMinutes, revisionMinutes, revisionsCompleted{same_day, next_day, weekly}, revisionAccuracy} }`. Frontend: Sunday Review.

### GET `/plan/weekly/progress?weekStart=`
Response `{ weekStart, weekEnd, dueDate, progress, summary }`.

### Complete weekly revision
`POST /plan/revisions/:id/start` then `POST /plan/revisions/:id/complete` on a `weekly` obligation (one per subject). Weekly obligations never gate learning.

---

## Overrides & analytics

### GET `/plan/overrides?days=30`
Response `{ overrides: [{ id, sessionId, sessionDate, subjectId, subjectName, reason, originalState, lockReasons[], obligationIds[], prerequisiteSessionIds[], decision: 'bypassed', createdAt }] }`.

### GET `/plan/analytics?days=30` (1–180)
Response `{ range, time{plannedLearningMinutes, actualLearningMinutes, plannedRevisionMinutes, actualRevisionMinutes, practiceMinutes, mockTestMinutes, scheduledRevisionSessionMinutes}, revisions{same_day|next_day|weekly: {total, completed, open, overdue, bypassed, completionRate}}, overdueRevisions, sessions{planned, completed, skipped, missed, completionRate}, overrides{gate, schedule, recent[]}, subjects[…, completionRate, revisionCompletionRate], chapters[{chapterId, chapterName, subjectName, topicsTotal, topicsLearned, topicsRevised}], performance{learningQuestions, learningAccuracy, revisionQuestions, revisionAccuracy, averageRevisionConfidence}, daily[{date, learningMinutes, revisionMinutes}] }`.
Revision time is never counted as learning time; a bypassed obligation counts as open, never completed. Frontend: Analytics › Learning vs revision.

---

## Removed: the ad-hoc `/api/cycles` runner

The old Study Cycles page and its `/api/cycles` API were removed; cycles now live in the schedule
(this document). Its collections are no longer used.
