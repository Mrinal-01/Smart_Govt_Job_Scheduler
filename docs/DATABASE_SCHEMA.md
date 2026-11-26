# Database schema (MongoDB / Mongoose)

Every user-owned collection has a required `userId` and every query filters by it.
Ownership failures return **404** (existence is not leaked). Timestamps (`createdAt`,
`updatedAt`) are on every collection. Source: `server/src/models/*`.

## Identity

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| `users` | name, email (normalized), passwordHash (Argon2id, `select:false`, null for Google-only), emailVerified(+At), termsAcceptedAt, role (`student`/`admin`), status, tokenVersion, failedLoginCount, lockedUntil, lastLoginAt | **unique** email |
| `authaccounts` | userId, provider (`google`), providerUserId (Google `sub`), email, emailVerified, linkedAt | **unique** (provider, providerUserId); **unique** (userId, provider) |
| `refreshsessions` | userId, familyId, tokenHash (sha256), expiresAt, revokedAt, revokedReason, replacedByHash, userAgent, ip, lastUsedAt, authMethod | **unique** tokenHash; (userId, revokedAt); familyId; **TTL** expiresAt |
| `emailverificationtokens`, `passwordresettokens` | userId, tokenHash, expiresAt, usedAt | **unique** tokenHash; **TTL** expiresAt |

## Workspace & settings

| Collection | Key fields | Indexes |
|---|---|---|
| `studyworkspaces` | userId, revision (optimistic concurrency), schemaVersion (3), origin (`import`/`demo`/`fresh`), data (the client `StudyState`), sizeBytes | **unique** userId |
| `usersettings` | userId, timezone, cycle {subjectIds[], defaultRevisionMinutes=10, revisionMinutesBySubject{}, revisionMinutesPerTopic=3, maxTopicsPerRevisionBlock=5, revisionMandatory=true}, ai {enabled}, exams {autoAddMistakes} | **unique** userId |
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

## Study cycles & revision

| Collection | Key fields | Indexes |
|---|---|---|
| `studycycles` | userId, date, cycleNumber, status (`active`/`completed`/`incomplete`), subjectIds[], startedAt, completedAt, endedReason | **unique** (userId, date, cycleNumber); **partial unique** userId where status=`active` |
| `cyclesubjectblocks` | userId, cycleId, date, subjectId(+Name), order, status, revision {required, plannedMinutes, startedAt, completedAt, actualSeconds, skippedReason}, learning {startedAt, completedAt, minutes}, skipReason | **unique** (cycleId, subjectId); (userId, date) |
| `studylogs` | userId, cycleId, blockId, cycleNumber, date, subject/chapter/topic ids+names, completion (`completed`/`partial`), minutes, confidence, notes | (userId, date); (userId, topicId, createdAt) |
| `revisiontasks` | userId, kind (`cycle`), date, taxonomy ids+names, sourceStudyLogId, sourceCycleId/Number, targetCycleId, targetBlockId, status (`pending`/`deferred`/`completed`/`skipped`), outcome, questionsAttempted/Correct, accuracy, actualSeconds, skipReason, **dedupeKey** | **unique** (userId, dedupeKey); (userId, status, date); targetBlockId |
| `revisionlogs` | userId, taskId, cycleId, topicId, subjectId, kind, date, event (`completed`/`skipped`), actualSeconds, outcome, accuracy, reason | **unique** taskId; (userId, date) |

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

User, AuthAccount, RefreshSession, EmailVerificationToken, PasswordResetToken, Schedule,
ScheduleVersion, StudyCycle, CycleSubjectBlock, StudyLog, RevisionTask, RevisionLog,
UploadedDocument, QuestionBank (`questions`), MockTest (templates are `kind: template`),
MockTestAttempt, MockTestAnswer, MistakeBank (`exammistakes` + legacy mistakes in the workspace),
AIUsageLog, UserSettings and Notification exist as listed.
**Not separate collections:** `Subject`, `Chapter`, `Topic`, `DailySession`, `ScheduleTemplate`
live inside the workspace document (see ARCHITECTURE.md › Two-tier data model); mock-test
templates cover reusable test configurations.

## Migration of existing data

* Browser data (`localStorage['studyos.state.v3']`) → imported on first sign-in by choice, or via
  `npm --prefix server run migrate:import-local`. Nothing is deleted from the browser.
* Existing timetable → auto-published as schedule v1 (free baseline).
* Earlier topic history is kept as-is; the fix that stops counting first learning as a revision
  applies to new learning only.
