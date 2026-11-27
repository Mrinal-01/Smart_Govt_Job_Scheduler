# Database schema (MongoDB / Mongoose)

Every user-owned collection has a required `userId` and every query filters by it.
Ownership failures return **404** (existence is not leaked). Timestamps (`createdAt`,
`updatedAt`) are on every collection. Source: `server/src/models/*`.

## Identity

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| `users` | name, phone (E.164, sign-in identifier), phoneVerifiedAt, email (optional, legacy accounts), passwordHash (legacy, Argon2id, `select:false`), emailVerified(+At), termsAcceptedAt, role (`student`/`admin`), status, tokenVersion, failedLoginCount, lockedUntil, lastLoginAt | **partial unique** phone where present; **partial unique** email where present (the old non-partial `email_1` index is dropped at startup by `db.ts`) |
| `phoneotps` | phone, purpose (`signup`/`login`), codeHash (HMAC-SHA256; null once invalidated), expiresAt, attempts, consumedAt, lastSentAt, windowStart, sendCount, purgeAt | **unique** (phone, purpose); **TTL** purgeAt |
| `refreshsessions` | userId, familyId, tokenHash (sha256), expiresAt, revokedAt, revokedReason, replacedByHash, userAgent, ip, lastUsedAt | **unique** tokenHash; (userId, revokedAt); familyId; **TTL** expiresAt |
| `emailverificationtokens`, `passwordresettokens` | userId, tokenHash, expiresAt, usedAt — no longer written (email flows retired); kept so existing documents expire via TTL | **unique** tokenHash; **TTL** expiresAt |

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

Collections of the removed ad-hoc cycle runner (`studycycles`, `cyclesubjectblocks`, `studylogs`,
`revisiontasks`, `revisionlogs`) are no longer read or written; existing documents can be dropped.

## Documents & questions

| Collection | Key fields | Indexes |
|---|---|---|
| `uploadeddocuments` | userId, originalName, storageKey (never exposed), sizeBytes, sha256, pageCount, intent {mockType, subjectIds}, status, stage, progress, error, pages[{pageNumber, method, chars}], stats {...}, aiUsed, aiNote, processedAt | **unique** (userId, sha256); (userId, createdAt) |
| `processingjobs` | type, userId, documentId, status, attempts, maxAttempts, runAfter, lockedAt, lastError | (status, runAfter); documentId |
| `questions` | userId, origin (`pdf`/`manual`/`ai_generated`), documentId, source {documentId, pageNumber, questionNumber}, rawText (verbatim), questionText, questionType, options[{label,text}], correctAnswer[] or null, answerSource (`document_key`/`student`/`ai_generated`), explanation, taxonomy ids+names, difficulty, status (`extracted`/`needs_review`/`verified`/`rejected`), extractionConfidence, flags[], aiStructured (separate from the record), **contentHash**, verifiedAt | **unique** (userId, contentHash); (userId, status, subjectId, chapterId, topicId); (userId, documentId, source.pageNumber) |

## Mock tests & attempts

| Collection | Key fields | Indexes |
|---|---|---|
| `mocktests` | userId, kind (`test`/`template`), name, type, config {subjectIds, chapterIds, topicIds, distribution[], questionCount, durationMinutes, marksPerQuestion, negativeMarks, selectionMethod, difficultyDistribution, avoidRecentDays, shuffleQuestions, shuffleOptions, instructions}, questionIds[], seed, templateId, sourceAttemptId, archivedAt | (userId, kind, createdAt) |
| `mocktestattempts` | userId, mockTestId, testName, testType, status, startedAt, deadlineAt, durationSeconds, submittedAt, submissionType, questions[] (snapshot incl. answer + answerVerified), marking, lastSavedAt, result {...} | (userId, createdAt); (status, deadlineAt); **partial unique** (userId, mockTestId) where status=`in_progress` |
| `mocktestanswers` | attemptId, userId, questionId, selected[], markedForReview, visited, timeSpentSeconds | **unique** (attemptId, questionId) |
| `exammistakes` (Mistake Bank for PDF tests) | userId, questionId, lastAttemptId, snapshot of question/options/answer/explanation, taxonomy, category, status, occurrences, reviewCount, lastSeenAt, source | **unique** (userId, questionId); (userId, status) |
| `aiusagelogs` | userId, date, feature, provider, model, status, input/outputTokens, latencyMs, errorCode — **no prompt or response content** | (userId, date) |

## Mapping to the requested model list

User, RefreshSession, EmailVerificationToken, PasswordResetToken, Schedule,
ScheduleVersion, StudyCycle, CycleSubjectBlock, StudyLog, RevisionTask, RevisionLog,
UploadedDocument, QuestionBank (`questions`), MockTest (templates are `kind: template`),
MockTestAttempt, MockTestAnswer, MistakeBank (`exammistakes` + legacy mistakes in the workspace),
AIUsageLog, UserSettings and Notification exist as listed.
**Not separate collections:** `Subject`, `Chapter`, `Topic`, `DailySession`, `ScheduleTemplate`
live inside the workspace document (see ARCHITECTURE.md › Two-tier data model); mock-test
templates cover reusable test configurations.

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
