# API documentation

Base path `/api`. JSON in/out. Every endpoint listed here is **implemented and covered by tests**
unless noted. (`docs/API_CONTRACT.md` is the earlier design spec and is superseded by this file.)

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
| GET | `/config` | *public* — Google client id, AI/OCR/mail availability, upload limits, schedule policy |
| GET | `/dev/mailbox` | *public, development only* — emails the console driver captured |

## Auth (`/auth`)
| Method | Path | Body / notes |
|---|---|---|
| POST | `/register` | `{name, email, password, confirmPassword, acceptTerms: true}` → 201 `{user, verificationRequired}`; 409 `EMAIL_IN_USE` |
| POST | `/verify-email` | `{token}`; 422 `VERIFY_TOKEN_INVALID` |
| POST | `/resend-verification` | `{email}` → 202 (same response whether or not the account exists) |
| POST | `/login` | `{email, password}` → `{accessToken, expiresIn, user}` + cookie; 401 `INVALID_CREDENTIALS`, 403 `EMAIL_NOT_VERIFIED`, 429 `ACCOUNT_LOCKED` |
| POST | `/refresh` | cookie + CSRF header → new access token, rotated cookie; 401 `REFRESH_REUSED` (family revoked), 409 `REFRESH_RACE` (retry) |
| POST | `/logout` | cookie + CSRF header → 204, family revoked |
| POST | `/logout-all` | bearer → 204; all sessions revoked, all access tokens invalid |
| GET/PATCH | `/me` | current user / `{name}` |
| POST | `/forgot-password` | `{email}` → 202 generic |
| POST | `/reset-password` | `{token, password, confirmPassword}`; signs out all devices |
| POST | `/change-password` | `{currentPassword, newPassword, confirmPassword}` → new access token; other sessions revoked |
| POST | `/google` | `{credential (Google ID token), acceptTerms?}` → session; 409 `TERMS_REQUIRED`, 409 `ACCOUNT_LINK_REQUIRED` (`details.linkTicket`), 422 `GOOGLE_EMAIL_MISSING` / `GOOGLE_EMAIL_UNVERIFIED`, 503 `GOOGLE_NOT_CONFIGURED` |
| POST | `/google/link` | `{linkTicket, password}` → session (explicit link confirmation) |
| GET | `/sessions` | active devices `[{id, userAgent, ip, authMethod, createdAt, lastUsedAt, current}]` |
| DELETE | `/sessions/:id` | sign out one device |

Rate limits: credential endpoints 10/15 min/IP, email endpoints 5/h/IP, refresh 60/15 min, API 600/5 min.

## Workspace (`/workspace`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{revision, schemaVersion, origin, updatedAt, data}`; 404 `WORKSPACE_NOT_FOUND` before onboarding |
| POST | `/` | `{origin: import|demo|fresh, data}` → 201; 409 `WORKSPACE_EXISTS` |
| PUT | `/` | `{baseRevision, data}` → `{revision}`; 409 `WORKSPACE_CONFLICT` (`details.currentRevision`) |

## Settings (`/settings`)
GET → `{settings}`; PATCH `{timezone?, cycle?: {subjectIds, defaultRevisionMinutes, revisionMinutesBySubject, revisionMinutesPerTopic, maxTopicsPerRevisionBlock, revisionMandatory}, ai?: {enabled}, exams?: {autoAddMistakes}}`.

## Schedule (`/schedule`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{policy, usage{used, remaining, limit, windowDays, nextAvailableAt, overridesInWindow}, today, latest, active, pending}` |
| GET | `/versions` | history (newest first) |
| GET | `/versions/:version` | one version with slots |
| GET | `/effective?date=YYYY-MM-DD` | version governing that date |
| POST | `/preview` | `{slots}` → `{isBaseline, diff, usage}` (no write) |
| POST | `/publish` | `{slots, changeReason, effectiveFrom?, override?, overrideReason?}` → 201 `{version, usage}`; 422 `NO_CHANGES` / `INVALID_EFFECTIVE_DATE` / `OVERRIDE_REASON_REQUIRED` / `UNKNOWN_SUBJECT`; 429 `SCHEDULE_CHANGE_LIMIT` (`details.nextAvailableAt`) |

## Study cycles (`/cycles`)
| Method | Path | Notes |
|---|---|---|
| GET | `/today` | cycles of today with blocks, tasks, logs, stats; `upcomingRevision`; `carryForward` |
| GET | `/history?days=14` | per-cycle summaries |
| GET | `/carry-forward` | `{pendingTasks, partialTopics, unfinishedBlocks}` |
| POST | `/start` | `{subjectIds?, force?}` → 201 `{cycle}`; 409 `CYCLE_ACTIVE` |
| GET | `/:id` | cycle detail |
| POST | `/:id/end` | `{reason?}` |
| POST | `/blocks/:blockId/start-revision` | 422 `NO_REVISION_DUE` |
| POST | `/blocks/:blockId/skip-revision` | `{reason}` (≥3 chars) |
| POST | `/blocks/:blockId/start-learning` | 409 `REVISION_REQUIRED` |
| POST | `/blocks/:blockId/complete-learning` | `{entries: [{topicId, completion: completed|partial, minutes?, confidence?, notes?}]}` |
| POST | `/blocks/:blockId/skip` | `{reason}` |
| POST | `/revision-tasks/:taskId/complete` | `{outcome: recalled|partial|forgot, questionsAttempted?, questionsCorrect?, secondsSpent?}`; 409 `REVISION_NOT_STARTED` / `TASK_RESOLVED` |
| POST | `/revision-tasks/:taskId/skip` | `{reason}` |

## Documents & files
| Method | Path | Notes |
|---|---|---|
| POST | `/documents` | multipart: `file` (PDF), `mockType?`, `subjectIds?` (comma-separated) → 201 queued, or 200 `{duplicate: true}`; 413/415/422 (`PDF_ENCRYPTED`, `PDF_INVALID`, `PDF_TOO_MANY_PAGES`) |
| GET | `/documents` | list |
| GET | `/documents/:id` | document + `questionCounts` by status |
| POST | `/documents/:id/reprocess` | 202 |
| POST | `/documents/:id/file-url` | `{url, expiresAt}` — HMAC-signed, 5 minutes |
| DELETE | `/documents/:id` | deletes file + unverified questions; verified questions stay |
| GET | `/files/:id?exp&sig` | streams the PDF if the signature is valid and unexpired; 403 otherwise |

## Questions (`/questions`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | filters `status, subjectId, chapterId, topicId, difficulty, origin, documentId, hasAnswer, q, page, limit` |
| GET | `/stats` | counts by status + verified breakdown |
| POST | `/` | manual question |
| GET/PATCH/DELETE | `/:id` | edit text, type, options, `correctAnswer`, explanation, taxonomy, difficulty; 409 `DUPLICATE_QUESTION`; 422 `INVALID_ANSWER` |
| POST | `/:id/verify` | 422 `CANNOT_VERIFY` with `details.problems[]` |
| POST | `/:id/reject` | |
| POST | `/bulk` | `{ids[], action: verify|reject|delete|assign, assign?}` → per-id results |

## Mock tests (`/mock-tests`)
| Method | Path | Notes |
|---|---|---|
| GET | `/?kind=test|template` | tests include attempt counts, last result, running attempt |
| POST | `/preview` | `{type, config}` → `{ok, total, buckets[{label, requested, available, detail?}]}` |
| POST | `/` | `{name, type: full_mixed|sectional|subject_full|chapter|topic, config, saveAsTemplate?}` → 201; 422 `INSUFFICIENT_QUESTIONS` |
| POST | `/templates` | save a template |
| POST | `/templates/:id/generate` | new test from template |
| GET/DELETE | `/:id` | delete archives (409 `ATTEMPT_RUNNING`) |

`config`: `subjectIds, chapterIds, topicIds, distribution[{subjectId,count}], questionCount, durationMinutes, marksPerQuestion, negativeMarks, selectionMethod (random|difficulty|topic), difficultyDistribution{easy,medium,hard} (sum 100), avoidRecentDays, shuffleQuestions, shuffleOptions, instructions`.

## Attempts (`/attempts`)
| Method | Path | Notes |
|---|---|---|
| GET | `/?mockTestId=` | history |
| GET | `/performance` | aggregated subject/chapter accuracy, weak chapters, trend |
| POST | `/` | `{mockTestId}` → 201 new or 200 `{resumed: true}` |
| GET | `/:id` | running: no answers/explanations, `serverNow`, `deadlineAt`, `remainingSeconds`, saved answers; finished: full review + `result` |
| PUT | `/:id/answers` | `{answers: [{questionId, selected[], markedForReview?, visited?}]}`; 409 `ATTEMPT_CLOSED` |
| POST | `/:id/submit` | idempotent |
| POST | `/:id/retake` | `{mode: incorrect|unanswered|all}` → practice test |
| POST | `/:id/mistakes` | `{questionId}` → add to Mistake Bank |

## Mistakes (`/mistakes`) — PDF mock test mistakes
GET (`status?`, `subjectId?`), PATCH `/:id` `{status?, category?}`, POST `/:id/review`, DELETE `/:id`.

## AI (`/ai`)
| Method | Path | Notes |
|---|---|---|
| GET | `/status` | configured, model, per-user switch, usage today |
| POST | `/analyze` | `{mode: weak_subjects|weak_chapters|revision_priorities|weekly_summary|plan_suggestions|chat, message?, history?}` |
| POST | `/explain-answer` | `{attemptId, questionId}` (finished attempts only) |
| POST | `/explain-topic` | `{topicId, focus?}` |
| POST | `/practice-questions` | `{topicId, count 1–10, difficulty}` → saved as `ai_generated`, `needs_review` |

Errors: 503 `AI_NOT_CONFIGURED`, 403 `AI_DISABLED_BY_USER`, 429 `AI_DAILY_LIMIT` / `RATE_LIMITED`, 422 `AI_REFUSED`, 502/504 provider errors.

## Notifications (`/notifications`)
GET (latest 50 + unread count), POST `/:id/read`, POST `/read-all`.
