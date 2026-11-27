# API documentation

Base path `/api`. JSON in/out. Every endpoint listed here is implemented.

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
| GET | `/config` | *public* — AI/OCR/mail availability, upload limits, schedule policy |
| GET | `/dev/mailbox` | *public, development only* — emails the console driver captured |

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

Development only: `GET /dev/sms` lists the codes the console SMS driver "sent" (alongside `GET /dev/mailbox`).

## Workspace (`/workspace`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{revision, schemaVersion, origin, updatedAt, data}`; 404 `WORKSPACE_NOT_FOUND` before onboarding |
| POST | `/` | `{origin: import|demo|fresh, data}` → 201; 409 `WORKSPACE_EXISTS` |
| PUT | `/` | `{baseRevision, data}` → `{revision}`; 409 `WORKSPACE_CONFLICT` (`details.currentRevision`) |

## Settings (`/settings`)
GET → `{settings}`; PATCH `{timezone?, cycle?: {subjectIds, defaultRevisionMinutes, revisionMinutesBySubject, revisionMinutesPerTopic, maxTopicsPerRevisionBlock, revisionMandatory, cyclesPerDay, sessionMinutes, breakMinutes}, plan?: {sameDayRevisionMinutes, nextDayRevisionEnabled, nextDayRevisionMinutes, weeklyRevisionMinutes, weeklyReviewWeekday, restWeekdays, holidays, requirePracticeInRevision}, ai?: {enabled}, exams?: {autoAddMistakes}}`.

## Schedule (`/schedule`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{policy, usage{used, remaining, limit, windowDays, nextAvailableAt, overridesInWindow}, today, latest, active, pending}` |
| GET | `/versions` | history (newest first) |
| GET | `/versions/:version` | one version with slots |
| GET | `/effective?date=YYYY-MM-DD` | version governing that date |
| POST | `/preview` | `{slots}` → `{isBaseline, diff, validation{errors, warnings}, carryOver, usage}` (no write) |
| POST | `/publish` | `{slots, changeReason, effectiveFrom?, override?, overrideReason?}` → 201 `{version, usage}`; 422 `INVALID_SCHEDULE_DEPENDENCIES` / `NO_CHANGES` / `INVALID_EFFECTIVE_DATE` / `OVERRIDE_REASON_REQUIRED` / `UNKNOWN_SUBJECT`; 429 `SCHEDULE_CHANGE_LIMIT` (`details.nextAvailableAt`) |

## Alert sounds (`/sounds`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{sounds[{id, name, format, sizeBytes, createdAt}], limit: 10, maxBytes}` |
| POST | `/` | multipart `file` (MP3/WAV/OGG/M4A/WebM, ≤2 MB, format checked from the file bytes) + `name` (1–60) → 201 `{sound}`; 409 `SOUND_LIMIT` (max 10), 415 `UNSUPPORTED_FILE`, 413 too large |
| GET | `/:id/file` | streams the owner's file (404 for anyone else) |
| DELETE | `/:id` | 204 |

## Study plan (`/plan`) — scheduled sessions, revision gates, weekly review, analytics
Full contract with request/response bodies and error codes: [STUDY_CYCLE_AND_REVISION_API.md](STUDY_CYCLE_AND_REVISION_API.md).

| Method | Path | Notes |
|---|---|---|
| GET | `/days/:date` (`today`) | sessions with derived state/locks, cycles, carryover, summary |
| GET | `/days/:date/cycles` | cycle progress |
| POST | `/days/:date/cycles/:n/complete` | `{reason?}`; 422 `REASON_REQUIRED` |
| POST | `/cycle-template` | generate cycle slots for a weekday (no write) |
| GET | `/sessions`, `/sessions/:id`, `/sessions/:id/dependencies`, `/sessions/:id/eligibility` | |
| POST | `/sessions/:id/start` | 409 `SESSION_LOCKED` (`details.lockReasons`) |
| POST | `/sessions/:id/complete` | `{topics[{topicId, completion}], questionsAttempted?, questionsCorrect?, confidence?, notes?, actualMinutes?}`; 409 `SESSION_NOT_STARTED`; idempotent |
| POST | `/sessions/:id/skip` | `{reason}` — never bypasses revision |
| POST | `/sessions/:id/override` | `{reason ≥10}` → 201; revision stays pending |
| POST | `/sessions/:id/reschedule` | `{startTime, endTime}` today only |
| GET | `/revisions`, `/revisions/overdue`, `/revisions/carryover`, `/revisions/history`, `/revisions/:id`, `/revisions/:id/preparation` | |
| POST | `/revisions/:id/start`, `/revisions/:id/complete` | 422 `REVISION_INCOMPLETE`; idempotent |
| GET | `/weekly`, `/weekly/progress`, `/overrides`, `/analytics` | |

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
| POST | `/explain-answer` | `{attemptId, questionId}` (finished attempts only) |
| POST | `/explain-topic` | `{topicId, focus?}` |
| POST | `/practice-questions` | `{topicId, count 1–10, difficulty}` → saved as `ai_generated`, `needs_review` |

Errors: 503 `AI_NOT_CONFIGURED`, 403 `AI_DISABLED_BY_USER`, 429 `AI_DAILY_LIMIT` / `RATE_LIMITED`, 422 `AI_REFUSED`, 502/504 provider errors.

## Notifications (`/notifications`)
GET (latest 50 + unread count), POST `/:id/read`, POST `/read-all`.
