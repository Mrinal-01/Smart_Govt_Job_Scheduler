# StudyOS — Personal Study Management, Revision & Exam Preparation Platform

A study ledger for competitive government exam preparation in India (RRB Group D, SSC,
Railway, State PSC): schedules, sessions, study cycles with revision-before-learning,
spaced revision, a personal PDF-to-question-bank pipeline, timed mock tests with a
server-authoritative exam engine, a Mistake Bank and an AI study assistant.

**Quick start** (Node 18.18+, MongoDB running locally):

```bash
npm run setup
npm run dev          # web http://localhost:3000 · API http://localhost:4000
npm run seed:master  # master login: tester@studyos.local / StudyOS-Test-2026
npm run check        # typecheck + production build
```

Documentation: [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Database](docs/DATABASE_SCHEMA.md) · [API](docs/API_DOCUMENTATION.md) ·
[Security](docs/SECURITY.md)

## Stack

**Web:** React 18 · TypeScript · Vite 5 · React Router 6 · Lucide React · Recharts · plain CSS with design tokens.
**API:** Node · Express · TypeScript · MongoDB (Mongoose) · Zod · pino · Argon2id · optional Anthropic SDK.

```
src/                         # React app
├─ auth/AuthContext.tsx      # email/password auth, in-memory access token, session restore
├─ workspace/                # loads/syncs the per-user workspace, onboarding & import
├─ store/                    # typed study store + selectors (revision engine, mastery)
├─ services/                 # reminders, Web Audio alerts, revision packs, rules-based assistant
├─ pages/                    # dashboard, schedule, cycles, tests, analytics, settings, auth…
└─ styles/                   # tokens, base, components, pages
server/src/                  # API
├─ modules/                  # auth, workspace, settings, schedule, cycles, documents,
│                            # questions, exams, ai, notifications, system
├─ models/                   # Mongoose schemas
├─ integrations/             # mail, private file storage, AI provider
└─ jobs/queue.ts             # Mongo-backed background worker (PDF processing)
```

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register, email verification, login, password reset/change, per-device sessions, sign out everywhere |
| **Dashboard** | Summary cards, timeline, active-session timer, revision overview, per-subject performance |
| **Schedule** | Mon–Sun builder with multiple sessions per subject; edits are drafts, published as immutable versions with a rolling change limit |
| **Study cycles** | Revision of the previous cycle is required before new learning; skips need a reason; carry-forward of unfinished topics |
| **Revision** | Same-day / next-day / weekly / monthly tracked separately on 1·3·7·15·30 intervals; first learning never counts as a revision |
| **Reminders** | `ended → awaiting-completion → overdue` state machine with looping audio alert, snooze and skip |
| **PDF → question bank** | Upload a paper, text/OCR extraction, question/option/answer-key parsing, review & verify |
| **Mock tests** | Mixed / subject / sectional / chapter / topic tests from verified questions; server deadline, autosave, resume, auto-submit |
| **Results & Mistake Bank** | Breakdowns, answer review, retakes, mistakes captured automatically |
| **Analytics** | 365-day heatmap, planned vs actual, accuracy trend, mastery radar, weakest topics |
| **AI assistant** | Rules-based modes always available; live model answers when the operator configures `AI_PROVIDER` |

## Try the main workflows

| Workflow | Where |
|---|---|
| Authentication | `/register` → dev mailbox link → `/login` (or use the master account) |
| Study cycles | `/cycles` → Start cycle 1 → learn each subject → Start cycle 2 |
| Schedule governance | `/schedule` → edit → *Review & publish*; *History* shows versions |
| PDF to question bank | `/tests/new` → upload `samples/sample-question-paper.pdf` → *Review & verify questions* |
| Examination | start a test → answer, mark for review, refresh, submit |
| Reminders | Settings → Reminders & sound → *Trigger reminder now* |

## Known limitations

* Reminders run only while the tab is open (no Web Push / service worker yet).
* OCR needs `pdftoppm` + `tesseract` installed; diagrams are flagged per page, not cropped, and two-column layouts are not reconstructed.
* Files use a local private storage driver (the S3/GCS driver is not written yet).
* No 2FA, email change or admin UI for policy limits (limits are set via env).
* Demo questions are written for this app and never presented as official papers.

## Production

```bash
npm run build:all
pm2 start ecosystem.config.cjs      # API + built web app on http://localhost:3000
```
See [docs/SETUP.md](docs/SETUP.md) for required production environment variables.
