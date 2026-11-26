# StudyOS — Backend API Contract (Node.js + Express + MongoDB)

This document is the complete API surface a real backend must implement. The
prototype's frontend is already written against these shapes — its TypeScript
interfaces in `src/types/index.ts` map **1:1** to the MongoDB documents below,
and `src/services/api.ts` already contains the transport with matching method
signatures.

> **Switching the prototype to a live backend** — edit `src/services/api.ts`:
> ```ts
> const USE_REMOTE_API = true            // ← flip this
> ```
> and set `VITE_API_BASE_URL` in `.dev.vars` / build env. No screen changes
> are required.

---

## 1. Conventions

| Item | Value |
|---|---|
| Base path | `/api/v1` |
| Auth | httpOnly cookie session **or** `Authorization: Bearer <jwt>` |
| Content type | `application/json` |
| Timestamps | ISO 8601 UTC (`2026-11-25T19:30:00.000Z`) |
| Calendar dates | `YYYY-MM-DD` — **always interpreted in `Asia/Kolkata`** |
| Errors | `{ "message": string, "code": string, "details"?: object }` |

**Error codes:** `VALIDATION_FAILED` · `NOT_FOUND` · `CONFLICT` ·
`REVISION_REQUIRED` · `UNAUTHENTICATED` · `FORBIDDEN` · `RATE_LIMITED` ·
`LLM_UPSTREAM_ERROR`

**HTTP status:** 200 ok · 201 created · 204 no content · 400 validation ·
401 unauthenticated · 403 forbidden · 404 not found · 409 conflict ·
422 semantic rule violation · 429 rate limit · 500 server error.

### Amounts & units
* `durationMinutes` — integer minutes
* `elapsedSeconds` — integer seconds
* All percentages are integers 0–100
* `confidence` — integer 1–5; `0` only means "never studied"

---

## 2. MongoDB collections

```js
// users
{ _id, email: {type:String, unique:true, index:true}, passwordHash, name,
  examTarget, examDate: Date|null, timezone: 'Asia/Kolkata',
  createdAt, updatedAt }

// settings  (one document per user)
{ _id, userId: {type:ObjectId, ref:'User', unique:true},
  theme: 'light'|'dark'|'system',
  dailyTargetMinutes, weeklyTargetMinutes,
  revisionIntervals: [1,3,7,15,30],
  reminder: { enabled, graceMinutes, repeatMinutes, sound,
              volume, browserNotifications, quietMode,
              notifySessionEnd, notifyRevisionDue, notifyDailySummary },
  autoSuggestMistakes, confirmBeforeSkip, compactSidebar }

// subjects
{ _id, userId, name, shortName, tone, icon, weeklyTargetMinutes, order }

// chapters
{ _id, userId, subjectId, name, order, weightage }

// topics  ← the revision engine's unit of work
{ _id, userId, subjectId, chapterId, name, order,
  difficulty: 'easy'|'medium'|'hard', estimatedMinutes,
  keyPoints: [String], formulas: [String],
  initialLearningDate: 'YYYY-MM-DD'|null,   // null = never learnt
  learningCompleted: Boolean,
  practiceCompleted: Boolean,
  pyqCompleted: Boolean,
  intervalIndex: Number,                    // position in revisionIntervals
  nextRevisionDue: 'YYYY-MM-DD'|null,
  questionsAttempted: Number,
  questionsCorrect: Number,
  confidence: Number,                       // 0-5
  mistakeCount: Number,
  mockAccuracy: Number|null,
  notes: String,
  revisions: [{ _id, date: 'YYYY-MM-DD',
                type: 'same-day'|'next-day'|'weekly'|'monthly'|'practice'|'manual',
                source: 'session'|'revision-center'|'sunday-review'|'mistake-practice',
                accuracy: Number|null, confidence: Number|null, notes: String }] }

// scheduleSlots  ← multiple rows per (userId, weekday, subject) is legal
{ _id, userId, weekday: 0..6,               // 0 = Sunday
  subjectId, sessionNumber, label,
  startTime: 'HH:mm', endTime: 'HH:mm', durationMinutes,
  requiresRevision: Boolean, learningTarget: String,
  practiceTarget: Number, reminderEnabled: Boolean,
  breakAfterMinutes: Number, order: Number }

// sessionRecords ← one per (slot, calendar date); the runtime state machine
{ _id, userId, slotId, date: 'YYYY-MM-DD', subjectId,
  status: 'upcoming'|'in-progress'|'revision-pending'|'awaiting-completion'
        | 'overdue'|'completed'|'skipped',
  startedAt: Date|null, accumulatedSeconds, runningSince: Date|null,
  revisionMarked: Boolean, revisionSkippedReason: String|null,
  revisionChecklist: [String],
  completion: { chapterId, topicId, topicName, learningCompleted,
                revisionCompleted, practiceCompleted,
                questionsAttempted, correctAnswers, incorrectAnswers,
                notes, confidence, durationMinutes,
                revisedTopicIds: [ObjectId], completedAt } | null,
  skipReason, snoozedUntil: Date|null, remindedAt: Date|null, graceUntil: Date|null }

// dailyLogs ← append-only analytics facts (history survives schedule edits)
{ _id, userId, date: {type:String, index:true},
  plannedMinutes, actualMinutes, sessionsPlanned, sessionsCompleted,
  topicsCovered, revisionsCompleted, mockTests: Number,
  accuracy: Number|null, subjectMinutes: { [subjectId]: Number } }

// mistakes
{ _id, userId, subjectId, chapterId, topicId,
  question, options: [String], userAnswerIndex: Number|null,
  correctAnswerIndex, explanation,
  category: 'conceptual'|'calculation'|'formula-forgotten'|'misread'
          | 'guessing'|'time-management',
  date: 'YYYY-MM-DD', status: 'unresolved'|'reviewed'|'resolved',
  source: 'mock-test'|'practice'|'manual',
  mockAttemptId?: ObjectId, reviewCount: Number, lastReviewedAt: Date|null }

// questions  ← `origin` prevents mislabelling AI output as official PYQs
{ _id, subjectId, chapterId, topicId, text, options: [String],
  correctIndex, explanation, difficulty,
  origin: 'demo-bank'|'ai-generated'|'unofficial-pyq' }

// mockTests
{ _id, userId, title, type: 'weekly'|'chapter'|'full-length',
  subjectId: ObjectId|'mixed', chapterId: ObjectId|null,
  questionIds: [ObjectId], durationMinutes, description, createdAt }

// mockAttempts
{ _id, userId, mockId, title, subjectId, startedAt, submittedAt,
  durationUsedSeconds, totalQuestions, correct, incorrect, unattempted,
  accuracy, marks, maxMarks,
  subjectBreakdown: [{ subjectId, correct, total }],
  topicBreakdown: [{ topicId, topicName, chapterName, correct, total, accuracy }],
  answers: { [questionId]: Number|null },
  markedForReview: [ObjectId] }

// aiMessages
{ _id, userId, role: 'user'|'assistant', mode, content,
  createdAt, demo: Boolean, suggestions: [String] }
```

### Required indexes
```js
db.topics.createIndex({ userId: 1, subjectId: 1, nextRevisionDue: 1 })
db.sessionRecords.createIndex({ userId: 1, date: 1 })
db.sessionRecords.createIndex({ userId: 1, slotId: 1, date: 1 }, { unique: true })
db.sessionRecords.createIndex({ userId: 1, status: 1 })
db.dailyLogs.createIndex({ userId: 1, date: 1 }, { unique: true })
db.mistakes.createIndex({ userId: 1, status: 1, topicId: 1 })
db.mockAttempts.createIndex({ userId: 1, submittedAt: -1 })
db.scheduleSlots.createIndex({ userId: 1, weekday: 1, order: 1 })
```

---

## 3. Endpoints

### 3.1 Auth
| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, name}` | `201 {user, token}` |
| POST | `/auth/login` | `{email, password}` | `{user, token}` |
| POST | `/auth/logout` | — | `204` |
| GET | `/auth/me` | — | `{user, settings}` |

### 3.2 Bootstrap (the one call the SPA needs on load)
| Method | Path | Returns |
|---|---|---|
| GET | `/state` | Full study state (see §4) |
| GET | `/state?date=YYYY-MM-DD` | Same, with that date's sessions materialised |
| PUT | `/state` | Full replace — prototype import/backup path |
| GET | `/export?format=json\|csv` | Download backup |

### 3.3 Subjects / chapters / topics
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/subjects` | — | includes computed `progress` per subject |
| POST | `/subjects` | `{name, shortName?}` | seeds `tone:'custom', icon:'book'` |
| PATCH | `/subjects/:id` | `{name?, shortName?, weeklyTargetMinutes?}` | |
| DELETE | `/subjects/:id` | — | cascades chapters, topics; **409** if scheduled |
| GET | `/subjects/:id/chapters` | — | with `status`, `progress`, `accuracy` |
| POST | `/subjects/:id/chapters` | `{name, weightage?}` | |
| PATCH | `/chapters/:id` | `{name?, weightage?}` | |
| DELETE | `/chapters/:id` | — | cascades topics |
| GET | `/chapters/:id/topics` | — | |
| POST | `/chapters/:id/topics` | `{name, difficulty?, estimatedMinutes?}` | |
| PATCH | `/topics/:id` | any topic field incl. `notes`, `keyPoints`, `formulas` | |
| DELETE | `/topics/:id` | — | |

**Chapter status derivation** (server-side, matches `chapterStatus()`):
* no topic with `initialLearningDate` → `not-started`
* some but not all learnt → `learning`
* all learnt, no revisions → `learning-completed`
* all learnt + ≥1 revision → `revision-in-progress`
* all topics mastered → `mastered`

`mastered` **requires** every topic: learnt + ≥2 revisions + mastery ≥78.
A single completed session must never set it.

### 3.4 Schedule
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/schedule` | `?weekday=1` | all 7 days if omitted |
| POST | `/schedule` | ScheduleSlot minus `_id` | auto-computes `sessionNumber` per (weekday, subject) |
| PATCH | `/schedule/:id` | partial slot | recompute `durationMinutes` if times change |
| DELETE | `/schedule/:id` | — | keeps historical sessionRecords |
| POST | `/schedule/reorder` | `{weekday, orderedIds: []}` | |
| POST | `/schedule/copy` | `{from: 1, to: [2,3,4]}` | replaces targets |
| GET | `/schedule/validate` | `?weekday=1` | `{ overlaps: [{from,to}] }` |

> **Overlap rule:** reject with `422 VALIDATION_FAILED` if a new/edited slot's
> time range intersects another slot on the same weekday — unless
> `?allowOverlap=true`.

### 3.5 Sessions — the core workflow
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/sessions` | `?date` / `?from&to` / `?status` | resolved session views |
| POST | `/sessions/:key/start` | — | `200 {record, revisionRequired, revisionPack}` |
| POST | `/sessions/:key/pause` | — | updated record |
| POST | `/sessions/:key/resume` | — | updated record |
| POST | `/sessions/:key/revision` | `{items: [ids], skippedReason?}` | updated record |
| POST | `/sessions/:key/complete` | `SessionCompletion` | `{record, topicUpdates}` ← **201** |
| POST | `/sessions/:key/skip` | `{reason}` | updated record |
| POST | `/sessions/:key/snooze` | `{minutes}` | updated record |
| POST | `/sessions/:key/reopen` | — | clears completion |

`:key` = `"<slotId>::<YYYY-MM-DD>"` — URL-encode it.

**`POST /start` semantic gate.** If the slot has `requiresRevision: true` and
`revisionMarked` is false, respond:

```json
200 {
  "record": { "status": "revision-pending", ... },
  "revisionRequired": true,
  "revisionPack": {
    "subjectName": "Mathematics",
    "previous":  [{ "id": "topic:<id>", "kind": "topic", "title": "Profit & Loss — CP/SP", "meta": "Learnt 1 day ago", "badge": "3 revisions", "topicId": "..." }],
    "due":       [{ "id": "topic:<id>", "kind": "topic", "title": "...", "badge": "2d overdue", "topicId": "..." }],
    "mistakes":  [{ "id": "mistake:<id>", "kind": "mistake", "title": "<question>", "meta": "Profit & Loss · conceptual", "mistakeId": "..." }],
    "formulas":  [{ "topicName": "Profit & Loss", "values": ["Profit% = (SP-CP)/CP × 100"] }],
    "checklist": [ /* previous + due + mistakes, de-duplicated */ ],
    "totalTopics": 4
  }
}
```

Client then calls `POST /:key/revision` with the ticked ids.
`skippedReason` records the explicit skip — **never block the schedule**.

**`POST /complete` side-effects (must be one Mongo transaction):**
1. Write `sessionRecords[].completion` and set `status: 'completed'`.
2. If `completion.learningCompleted` and topic has no `initialLearningDate` →
   set `initialLearningDate = record.date` and push a **`same-day`** revision.
   *(First learning is registered here, never counted as a revision twice.)*
3. Else if `completion.revisionCompleted` → push a revision typed by
   `classifyRevision()`: `same-day` (same day) · `next-day` (1 day) ·
   `weekly` (≤9 days) · `monthly` (>9 days).
4. Advance `intervalIndex += 1`; `nextRevisionDue = date + intervals[min(idx, last)]`.
5. Accumulate `questionsAttempted` / `questionsCorrect`; update `confidence`,
   `practiceCompleted`, `notes`.
6. Recompute the chapter's derived `status` (rule in §3.3).
7. Upsert `dailyLogs` for that date: `actualMinutes`, `sessionsCompleted`,
   `topicsCovered`, `revisionsCompleted`, `subjectMinutes`, `accuracy`.
8. Emit `session.completed` (see §6).

> **Idempotency:** key on `(userId, slotId, date)`. A retried completion must
> not double-count revisions. Accept `Idempotency-Key` header.

### 3.6 Revision center
| Method | Path | Body / Query | Notes |
|---|---|---|---|
| GET | `/revisions/due` | `?subjectId&from&to` | flat list with `daysOverdue`, `kind` |
| GET | `/revisions/upcoming` | `?days=14` | future `nextRevisionDue` |
| GET | `/revisions/history` | `?topicId&from&to&page` | paginated revision entries |
| POST | `/revisions` | `{topicId, type?, accuracy?, confidence?, notes?, source?}` | logs a manual/Sunday revision |
| GET | `/revisions/categories` | `?from&to` | counts for same-day / next-day / weekly / monthly |

> **Count only revisions.** `initialLearningDate` alone is *learning*, not
> revision. Analytics must read `topics.revisions[]`, never `initialLearningDate`.

### 3.7 Mistakes
| Method | Path | Body / Query |
|---|---|---|
| GET | `/mistakes` | `?status&subjectId&category&topicId&search&page` |
| POST | `/mistakes` | Mistake minus `_id/date/status/reviewCount` |
| PATCH | `/mistakes/:id` | `{category?, status?}` |
| POST | `/mistakes/:id/review` | — (increments `reviewCount`; auto-`resolved` at 3) |
| DELETE | `/mistakes/:id` | — |
| GET | `/mistakes/suggestions` | `?subjectId` — feeds the revision panel |

### 3.8 Mock tests
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/mock-tests` | — | with `attemptCount`, `bestAccuracy` |
| GET | `/mock-tests/:id` | — | **strips `correctIndex`/`explanation`** |
| POST | `/mock-tests` | `{title, type, subjectId, chapterId?, questionIds, durationMinutes}` | |
| POST | `/mock-attempts` | attempt payload incl. `answers` | server re-grades, returns 201 |
| GET | `/mock-attempts` | `?from&to&mockId&page` | history |
| GET | `/mock-attempts/:id` | — | full review incl. explanations |

**`POST /mock-attempts` must re-grade server-side.** Never trust client
`correct`/`accuracy`. Wrong answers auto-create `mistakes` with
`category: 'conceptual'` unless the client sends one; increment
`topics.mistakeCount`; upsert `dailyLogs.mockTests`.

### 3.9 Analytics
| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/analytics/summary` | `?from&to` | totals: minutes, sessions, revisions, tests, avgAccuracy, streak, consistency |
| GET | `/analytics/daily` | `?from&to` | `[{date, plannedHours, actualHours, sessionsCompleted, topicsCovered}]` |
| GET | `/analytics/weekly` | `?weeks=12` | subject time, revision %, mock scores, missed sessions |
| GET | `/analytics/monthly` | `?months=12` | chapter completion, revision frequency, accuracy trend, consistency |
| GET | `/analytics/yearly` | — | total hours, chapters, revisions, tests, subject mastery |
| GET | `/analytics/heatmap` | `?days=365` | `[{date, level:0-4, minutes, plannedMinutes}]` |
| GET | `/analytics/subjects` | `?from&to` | `[{subjectId, minutes, mastery, accuracy, revisions}]` |
| GET | `/analytics/weak-topics` | `?limit=10` | lowest-mastery topics |

**Consistency formula** (matches the prototype):
```
dayHit      = actualMinutes >= max(45, plannedMinutes * 0.4)
consistency = round(hits / daysInRange * 100)
```
Never derive consistency from login events — only completed sessions vs the
configured target.

### 3.10 Reminders & server-side scheduling
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/reminders/settings` | — | |
| PATCH | `/reminders/settings` | partial | |
| POST | `/reminders/check` | — | runs the state machine now (idempotent) |
| POST | `/push/subscribe` | `{subscription}` | store Web Push subscription |
| DELETE | `/push/subscribe` | `{endpoint}` | |
| POST | `/notifications/test` | — | sends a test push |

**The state machine** (implement identically to `src/services/reminder.ts`):

```
for each slot today where reminderEnabled:
  key = `${slotId}::${date}`; rec = sessionRecords[key]
  skip if status ∈ {completed, skipped}
  skip if snoozedUntil > now
  skip if now < slot.endTime

  if minutesOverdue < graceMinutes:
      if status != 'awaiting-completion' -> set status='awaiting-completion',
                                              graceUntil = endTime + grace
  else:
      if !remindedAt || (now - remindedAt) >= repeatMinutes:
          -> status='overdue'; remindedAt=now; push/notify
```

**Scheduler:** node-cron every minute (or Cloudflare Cron / BullMQ) calls
`/reminders/check` for every user, then:
1. writes the transitions,
2. sends a Web Push to each subscription,
3. **stops all notifications immediately** once `status` becomes `completed`
   or `skipped` (delete any queued repeat job for that key).

> This is the piece the browser **cannot** do. The prototype explicitly tells
> the user: foreground-only reminders stop when the tab closes or the device
> sleeps. Background delivery requires this scheduler + a service worker +
> Web Push.

### 3.11 AI assistant (OpenAI proxied — key never leaves the server)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/ai/chat` | `{mode, message, context?}` | `{content, suggestions?}` |
| POST | `/ai/quiz` | `{subjectId, topicId, difficulty, count}` | `{questions: Question[]}` |
| GET | `/ai/weak-topics` | — | `{topics: [...]}` |
| GET | `/ai/smart-revision` | — | `{plan: [...]}` |
| GET | `/ai/weekly-report` | — | `{report: string}` |
| GET | `/ai/messages` | — | chat history |
| DELETE | `/ai/messages` | — | clear chat |

**Server requirements:**
1. `OPENAI_API_KEY` in server env only — never `VITE_*`, never a response body.
2. Build the user context **server-side** from their real `topics`,
   `revisions`, `mistakes`, `dailyLogs` — do not trust client-supplied context.
3. Rate-limit per user (e.g. 30 req/hour) and cap `max_tokens`.
4. Persist every message with `demo: false` (the prototype's are `demo: true`).
5. Generated questions **must** carry `origin: 'ai-generated'`.
6. Never present generated MCQs as official previous-year questions.

---

## 4. `GET /state` response shape

Identical to the prototype's root state so a single serializer serves both:

```json
{
  "profile":   { "_id": "...", "name": "...", "email": "...", "targetExam": "RRB Group D 2026", "examDate": "2027-01-28", "joinedAt": "..." },
  "settings":  { "theme": "light", "timezone": "Asia/Kolkata", "examTarget": "...",
                 "dailyTargetMinutes": 450, "weeklyTargetMinutes": 2700,
                 "revisionIntervals": [1,3,7,15,30],
                 "reminder": { "enabled": true, "graceMinutes": 10, "repeatMinutes": 5,
                               "sound": "chime", "volume": 0.55,
                               "browserNotifications": false, "quietMode": false },
                 "autoSuggestMistakes": true, "confirmBeforeSkip": true, "compactSidebar": false },
  "subjects":  [ /* Subject[] */ ],
  "chapters":  [ /* Chapter[] with nested topics[] and revisions[] */ ],
  "schedule":  [ /* ScheduleSlot[] — multiple per weekday+subject allowed */ ],
  "sessions":  { "<slotId>::<date>": { /* SessionRecord */ } },
  "logs":      [ /* DailyLog[] — 365 days */ ],
  "mistakes":  [ /* Mistake[] */ ],
  "questions": [ /* Question[] */ ],
  "mockTests": [ /* MockTest[] */ ],
  "attempts":  [ /* MockAttempt[] */ ],
  "aiMessages":[ /* AIMessage[] */ ],
  "seededAt":  "2026-11-25T18:30:00.000Z"
}
```

---

## 5. Validation rules (enforce server-side)

| Rule | Error |
|---|---|
| `endTime > startTime` for a slot | 400 |
| No overlapping slots on the same weekday | 422 |
| `subjectId`, `chapterId`, `topicId` must belong to the same user | 403 |
| `correctAnswers <= questionsAttempted` | 400 |
| `0 < durationMinutes <= 600` | 400 |
| `confidence` in 1–5 on completion | 400 |
| Mock attempt: `answers[qid]` in range or `null` | 400 |
| Deleting a subject referenced by a live slot | 409 |
| Topic revision on a never-learnt topic | 422 |

---

## 6. Domain events (for a future queue / webhooks)

```
session.started · session.completed · session.skipped · session.overdue
revision.logged · revision.skipped
test.submitted · mistake.created · mistake.resolved
chapter.mastered
```

`chapter.mastered` fires **only** when every topic clears learnt + ≥2
revisions + mastery ≥78 — never on session completion alone.

---

## 7. Minimal `reminderService.js` sketch

```js
// src/services/reminderService.js
const cron = require('node-cron')
const Session = require('../models/SessionRecord')
const Slot = require('../models/ScheduleSlot')
const Settings = require('../models/Settings')
const { sendPush } = require('./pushService')

const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const ist = () => new Date(Date.now() + 330 * 60000)      // Asia/Kolkata
const dateKey = () => ist().toISOString().slice(0, 10)
const minutesNow = () => ist().getUTCHours() * 60 + ist().getUTCMinutes()

cron.schedule('* * * * *', async () => {
  const date = dateKey()
  const docs = await Settings.find({}).lean()

  for (const s of docs) {
    if (!s.reminder?.enabled || s.reminder?.quietMode) continue
    const slots = await Slot.find({ userId: s.userId, weekday: ist().getUTCDay() })
    for (const slot of slots) {
      if (!slot.reminderEnabled) continue
      const key = `${slot._id}::${date}`
      const rec = await Session.findOne({ userId: s.userId, slotId: slot._id, date })
      if (!rec || ['completed', 'skipped'].includes(rec.status)) continue
      if (rec.snoozedUntil && rec.snoozedUntil > new Date()) continue

      const overdue = minutesNow() - min(slot.endTime)
      if (overdue < 0) continue

      if (overdue < s.reminder.graceMinutes) {
        if (rec.status !== 'awaiting-completion') {
          rec.status = 'awaiting-completion'
          rec.graceUntil = new Date(Date.now() + (s.reminder.graceMinutes - overdue) * 60000)
          await rec.save()
        }
        continue
      }

      const dueForRepeat = !rec.remindedAt ||
        Date.now() - new Date(rec.remindedAt).getTime() >= s.reminder.repeatMinutes * 60000
      if (!dueForRepeat) continue

      rec.status = 'overdue'; rec.remindedAt = new Date()
      await rec.save()

      await sendPush(s.userId, {
        title: 'StudyOS — session overdue',
        body: `${slot.label} ended ${overdue} min ago. Update or skip it.`,
        tag: key,
        url: '/sessions'
      })
    }
  }
})
```

The **client** stops its looping Web Audio immediately on `completed` /
`skipped` because the DB status changed — this is what makes the reminder
stop instantly rather than continuing to nag.

---

## 8. Suggested backend layout

```
server/
├─ src/
│  ├─ index.js                 # express app + helmet + rate-limit + session
│  ├─ config/db.js             # mongoose connect
│  ├─ models/                  # one file per collection (§2)
│  ├─ routes/
│  │  ├─ auth.js  state.js  subjects.js  schedule.js
│  │  ├─ sessions.js  revisions.js  mistakes.js
│  │  ├─ mockTests.js  analytics.js  reminders.js  ai.js  export.js
│  ├─ services/
│  │  ├─ revisionService.js    # classifyRevision / applyRevision / dueQueue
│  │  ├─ sessionService.js     # start / complete transaction
│  │  ├─ masteryService.js     # chapter status + mastery scoring
│  │  ├─ analyticsService.js   # daily/weekly/monthly/yearly aggregations
│  │  ├─ reminderService.js    # cron state machine (§7)
│  │  └─ pushService.js        # web-push
│  ├─ middleware/  auth.js  validate.js  errorHandler.js
│  └─ jobs/  reminderCron.js  dailyRollover.js
└─ .env  ← OPENAI_API_KEY, MONGODB_URI, JWT_SECRET, VAPID_*
```

**Never** expose `OPENAI_API_KEY`, `MONGODB_URI`, `JWT_SECRET` or VAPID
private keys to the frontend bundle.
