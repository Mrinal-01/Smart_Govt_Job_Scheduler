# StudyOS — Codebase Audit

Audit date: 2026-11-26 · Branch: `feature/auth-reviosion` · Commit audited: `37eaee9` (single "Initial commit")

Everything in this document was verified by reading the source and running the toolchain on this machine. Earlier review notes were treated as hints, not as facts.

---

## 1. Environment & toolchain (verified)

| Item | Finding |
|---|---|
| Default Node.js | **v18.20.8** (nvm also has 20.20, 22.17, 22.23) |
| npm | 10.8.2 |
| `npx tsc --noEmit` | ✅ passes (0 errors) |
| `npx vite build` | ❌ **fails on Node 18**: `SyntaxError: 'node:util' does not provide an export named 'styleText'` |
| Root cause | `vite@8.3.5` + `@vitejs/plugin-react@6.3.0` require Node `^20.19 \|\| >=22.12`. The app **cannot be built or started** with the installed default Node. |
| MongoDB | `mongod` installed and listening on `127.0.0.1:27017` |
| Redis | not installed / not running |
| OCR | `tesseract` not installed; `pdftotext`/poppler present |
| Docker | present (not required) |

**Blocking defect #1:** the project as committed does not run on the machine's default Node. Fix: pin Vite 5.4 / plugin-react 4.3 (support Node 18, 20, 22) and declare `engines`.

## 2. Existing architecture

* **Frontend only.** React 18.3 + TypeScript 5.7 + Vite + React Router 6 + Recharts 2 + Lucide. Plain CSS with design tokens (`src/styles/*`). No Tailwind.
* **No backend.** `hono`, `@hono/vite-build`, `@hono/vite-dev-server` and `wrangler` are in `package.json` but **no source file imports Hono**; `wrangler` is used only to serve the static `dist/` (Cloudflare Pages). There is no server code.
* **State:** one React context (`src/store/StudyStore.tsx`, ~980 lines) holding the whole `StudyState` (profile, settings, subjects, chapters→topics, schedule slots, session records, daily logs, mistakes, questions, mock tests, attempts, AI messages). Mutations are `useCallback` functions over `setState`.
* **Persistence:** `src/lib/storage.ts` → `localStorage['studyos.state.v3']`, debounced 120 ms. Version bump migration keeps only `settings` + `profile`; everything else is reseeded.
* **Seed:** `src/data/seed.ts` deterministically generates 365 days of demo history keyed by today's date. A first-time visitor always gets demo data.
* **API abstraction:** `src/services/api.ts` defines `remoteTransport` (`/api/v1/state`, `/api/v1/mock-attempts`) and `aiApi`, behind `USE_REMOTE_API = false`. **None of these endpoints exist**; the remote transport is never called.
* **Docs:** `docs/API_CONTRACT.md` is a design spec for ~70 endpoints. **None are implemented.**

## 3. Existing features (must keep working)

| Area | Implementation | Notes |
|---|---|---|
| Dashboard | `DashboardPage.tsx` | summary cards, timeline, active timer |
| Schedule builder | `SchedulePage.tsx` + store slot mutations | multiple sessions/subject/day, copy day, reorder, overlap warnings. Edits apply **immediately** and regenerate today's sessions. |
| Sessions | `SessionsPage.tsx`, `components/sessions.tsx` | start/pause/resume/complete/skip, revision gate (`buildRevisionPack`) with skip reason |
| Revision center | `RevisionPage.tsx`, `selectors.dueRevisions` | same-day / next-day / weekly / monthly classification, intervals from settings |
| Sunday review | `SundayPage.tsx` | weekly revision + test suggestions |
| Subjects & chapters | `SubjectsPage.tsx` | CRUD subject/chapter/topic, derived chapter status |
| Mock tests (demo bank) | `MockTestsPage.tsx` | 36 seeded demo MCQs, timer, palette, mark for review, auto-submit, review. **Grading and timer are client-only.** |
| Mistake bank | `MistakeBankPage.tsx` | auto-capture from demo mock attempts, categories, practice |
| Analytics | `AnalyticsPage.tsx` | heatmap, trends, radar etc. over `logs` |
| Assistant | `AssistantPage.tsx`, `services/assistant.ts` | **rules-based**, every reply labelled `demo`. No model call. |
| Settings | `SettingsPage.tsx` | profile, targets, reminders + sound test, theme, JSON/CSV export, import, reset demo |
| Reminders | `services/reminder.ts`, `services/audio.ts`, `App.tsx` `ReminderRuntime` | foreground-only state machine + Web Audio loop; honest UI note about background limits |

## 4. Missing features (vs. requested scope)

| Requested | Present? |
|---|---|
| Backend (Express/Mongo) | ❌ none |
| Authentication (register/verify/login/logout/reset/Google) | ❌ none — `profile.name/email` are free-text fields |
| Multi-user data isolation | ❌ impossible: one browser = one dataset |
| Study **cycle** engine (cycle vs day, revision-before-learning per cycle) | ❌ absent; only per-slot revision gate |
| Topic-level revision tasks with dedupe | ❌ revision state is a field on each topic (`nextRevisionDue`), no task records |
| Schedule versioning / change governance | ❌ edits are live and unversioned |
| PDF upload / extraction / OCR | ❌ none |
| Personal question bank with verification workflow | ❌ static demo bank only |
| Configurable mock-test builder (mixed/sectional/subject/chapter/topic) | ❌ 4 fixed demo tests |
| Server-authoritative exam timer, answer persistence, resume | ❌ client timer only; refresh loses the attempt |
| Real AI integration | ❌ rules-based demo (honestly labelled) |
| Background notifications (Web Push) | ❌ (documented limitation) |
| Automated tests | ❌ none (no test runner installed) |

## 5. Defects, fragility and technical debt

1. **Build broken on Node 18** (see §1).
2. **Initial learning is recorded as a revision.** `syncTopicOnCompletion` calls `applyRevision(... type: 'same-day')` the first time a topic is learnt, so a brand-new topic immediately shows one "same-day revision" and its interval index advances. README claims "initial learning never counted as revision" — the code contradicts it. Fix: register learning separately (set `initialLearningDate`, schedule the first interval, no revision record).
3. **Schedule edits rewrite today silently.** `addSlot/updateSlot/copyDaySchedule` regenerate today's session map; `deleteSlot` makes that slot's historical session records unreachable from `sessionViewsForDate` (records remain in storage but no longer display).
4. **Destructive migration.** A `STATE_VERSION` bump reseeds all study history (only settings/profile survive).
5. **Client-trusted grading.** Mock attempt scoring, timer and deadline are computed in the browser.
6. **Hidden demo bootstrapping.** Any first visit generates 365 days of fabricated history; there is no "start fresh" path. Acceptable for a demo, wrong for a real account.
7. **Dead/unused code & deps:** `hono`, `@hono/*` unused; `api.ts` remote transport unused; `public/static/style.css` empty; several no-op `useEffect`s (`App.tsx` "safety net").
8. **Single 870 kB bundle** — no route-level code splitting.
9. **localStorage quota fallback trims logs silently** (`saveState` drops all but the last 120 logs on quota error).
10. **Timezone hard-coded** to Asia/Kolkata in `lib/date.ts` (settings.timezone is display-only).

## 6. Data model limitations

* Curriculum, progress and revision history are nested in one blob (`chapters[].topics[].revisions[]`) — no per-event records, so revision deduplication / audit trails are not possible.
* Session records keyed by `slotId::date`; no link to a schedule version.
* Questions have `correctIndex: number` (always required) — cannot represent unknown answers, multi-correct, or source provenance.
* Mistakes reference demo questions by copying text; no unique constraint, so duplicates are possible.

## 7. Security issues

| Issue | Severity |
|---|---|
| No authentication or authorization of any kind | Critical (for a multi-user product) |
| All data in plain `localStorage` — readable by any script on the origin | High |
| Import accepts arbitrary JSON with only 3 field checks | Medium |
| Profile e-mail is unverified free text | Medium |
| No secrets in bundle (verified: no keys, `aiApi` calls a backend path) | ✅ good |
| AI responses honestly labelled demo | ✅ good |

## 8. Recommended architecture

* Keep the React app and its visual identity; fix the toolchain for Node 18+.
* Add `server/` — Node + Express + TypeScript + Mongoose + Zod + pino, layered as routes → controllers → services → models, with centralized error handling.
* **Auth:** Argon2id passwords, 15-min JWT access token held in memory, rotating opaque refresh token in an HttpOnly cookie (hashed at rest, family reuse detection), email verification, password reset, Google ID-token verification with explicit link confirmation, rate limiting, CSRF header + origin check on cookie endpoints.
* **Two-tier data migration** (to avoid a risky big-bang rewrite of ~8k lines of working UI):
  1. *Legacy workspace* — the existing `StudyState` becomes a per-user server document (`StudyWorkspace`), loaded after login and synced back with optimistic concurrency (revision numbers). This immediately gives every existing feature server persistence and per-user isolation without changing its behaviour. Browser `localStorage` becomes a per-user cache; the old `studyos.state.v3` key is **imported on request, never deleted**.
  2. *New normalized domains* — cycles, revision tasks, schedule versions, documents, question bank, mock tests, attempts, answers, exam mistakes, AI usage — are proper Mongoose collections with ownership fields, indexes and unique constraints, and server-side business rules.
* **Jobs:** Redis is not available locally, so PDF processing uses a Mongo-backed in-process job queue (`ProcessingJob` collection, resumable on restart) behind a small queue interface that can be swapped for BullMQ when Redis is provisioned.
* **Files:** private disk storage outside any static directory; delivery only via HMAC-signed, short-lived URLs issued to the owner.
* **OCR:** provider interface; Tesseract CLI provider auto-detected (`pdftoppm` + `tesseract`); when unavailable, scanned pages are reported as "OCR unavailable" — never faked.
* **AI:** provider interface (Anthropic / OpenAI over HTTPS, no SDK), server-side only, daily per-user limits, timeouts, usage log without content. Disabled cleanly when no key is configured.

## 9. Migration risks

| Risk | Mitigation |
|---|---|
| Users lose browser data when auth is introduced | Onboarding detects `studyos.state.v3` and offers import; key is never removed |
| Two tabs overwrite each other's workspace | `revision` counter; server returns 409 on stale writes; client reloads and keeps a local conflict backup |
| Large workspace payload (~1–2 MB with 365 days of logs) | 8 MB JSON limit on that route only; debounced writes |
| Schedule governance changes the "edit is live" behaviour | Draft/active split; first publish is free and effective immediately; existing schedule auto-published as baseline v1 |
| Fixing the "learning counted as revision" bug changes counts | Affects only new completions; seeded history untouched |
| Vite downgrade | Same plugin API for our usage; verified by build + tests |

## 10. Implementation plan (stages)

1. Toolchain fix (Vite 5, Node ≥18 engines), test runners.
2. Server foundation: config, logger, error handling, Mongo, security middleware.
3. Auth + sessions + Google + email + tests.
4. Workspace persistence + migration + frontend auth shell / protected routes.
5. Study cycle engine + revision tasks + UI + tests.
6. Schedule versioning/governance + UI + tests.
7. Documents upload, private storage, extraction pipeline, OCR provider, parser, AI structuring + tests.
8. Question bank + review UI.
9. Mock test builder + selection service + exam engine + results/review + mistakes + tests.
10. AI assistant backend + frontend integration.
11. Settings (account, security/sessions, policy, revision prefs, AI usage).
12. Docs, `.env.example`, final checks, implementation report.

Progress is tracked in `docs/IMPLEMENTATION_PROGRESS.md`.
