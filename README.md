# StudyOS — Personal Study Management, Revision & Exam Preparation Platform

A study ledger for competitive government exam preparation in India (RRB Group D, SSC,
Railway, State PSC): schedules, sessions, study cycles with revision-before-learning,
spaced revision, a personal PDF-to-question-bank pipeline, timed mock tests with a
server-authoritative exam engine, a Mistake Bank and an AI study assistant.

**Quick start** (Node 18.18+, MongoDB running locally):

```bash
npm run setup
npm run dev          # web http://localhost:3000 · API http://localhost:4000
npm run check        # typecheck + all tests + production build
```

Documentation: [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Database](docs/DATABASE_SCHEMA.md) · [API](docs/API_DOCUMENTATION.md) ·
[Security](docs/SECURITY.md) · [Audit](docs/CODEBASE_AUDIT.md) ·
[Implementation report](docs/IMPLEMENTATION_REPORT.md)

> The sections below describe the original frontend features, which are all still present.
> Where they mention localStorage-only storage, no backend or a demo-only assistant, that is
> historical: data is now stored per account on the server, and live AI is available when the
> operator configures it.

---

## Stack

React 18 · TypeScript · Vite · React Router 6 · Lucide React · Recharts ·
plain CSS with design tokens (no Tailwind). State lives in a typed store with
`localStorage` persistence behind a swappable service layer.

```
src/
├─ types/index.ts            # domain models — mirror the Mongo documents
├─ data/curriculum.ts        # 4 subjects, 31 chapters, ~90 topics
├─ data/questions.ts         # 36-question demo bank (never claimed as PYQ)
├─ data/seed.ts              # deterministic 365-day demo dataset
├─ lib/date.ts               # Asia/Kolkata date/time helpers
├─ lib/storage.ts            # versioned persistence + migration
├─ store/StudyStore.tsx      # all mutations (start/pause/complete/revise…)
├─ store/selectors.ts        # revision engine, mastery, chapter status
├─ services/
│  ├─ api.ts                 # remote transport — flip USE_REMOTE_API
│  ├─ remainder.ts           # reminder state machine (pure)
│  ├─ audio.ts               # Web Audio looping alert engine
│  ├─ revisionPack.ts        # "revision before new learning" pack builder
│  └─ assistant.ts           # rules-based demo assistant
├─ components/               # ui kit, app shell, session workflow
├─ pages/                    # 12 routed pages
└─ styles/                   # tokens, base, components, pages
docs/API_CONTRACT.md         # full Node + Express + MongoDB spec
```

---

## What works (verified in-browser, zero console errors)

| Area | Status |
|---|---|
| **Dashboard** | 6 summary cards, chronological timeline, active-session timer, revision overview, per-subject performance |
| **Schedule builder** | Mon–Sun, **multiple sessions per subject per day**, add/edit/delete/reorder, copy-a-day, overlap detection, copy-to-many-days |
| **Revision gate** | Starting a revision-flagged session opens the Revision Preparation Panel (due topics + previous topics + wrong questions + formulas) **before** new learning; skip requires a recorded reason |
| **Session lifecycle** | Start → Pause → Resume → Complete, live timer, revision checklist, completion modal with learning/revision/practice split, confidence, duration validation |
| **Revision tracking** | Same-day / next-day / weekly / monthly tracked **separately**; initial learning never counted as revision; 1·3·7·15·30 intervals; full per-topic history |
| **Reminder system** | Real state machine (`ended → awaiting-completion → overdue`), configurable grace + repeat, **loopWeb Audio** alert, overlay with Update/Snooze/Skip, sound stops instantly on completion |
| **Subjects & chapters** | 4 subjects, 31 chapters, ~90 topics; filters (all / completed / in-progress / weak / not started); CRUD at every level; chapter status never auto-"mastered" from one session |
| **Sunday review** | Separate weekly revision + mock-test workflow per subject, weekly-only revision type, weakest-chapter test suggestions |
| **Mock tests** | Countdown timer, palette, mark-for-review, auto-submit, server-style grading, subject/topic breakdown, full answer review, test history |
| **Mistake Bank** | Auto-captured from wrong answers, 6 categories, filters, Practice Again with reveal, auto-3-attempt resolution, pattern analysis |
| **Analytics** | 365-cell heatmap, planned-vs-actual area chart, accuracy trend, subject bars, mastery radar, monthly/12-week volume, chapter completion, weakest topics, 7/30/90/365 range filters |
| **AI Assistant** | 5 modes, chat UI, **every response labelled `demo`** — rules over real local data, never a fake model call |
| **Settings** | Profile/exam, targets, revision intervals, reminders + sound test, theme (light/dark/system), JSON+CSV export, import, reset |
| **Responsive** | Desktop-first; sidebar collapses to a drawer ≤960px; cards stack ≤720px |

### Verifying the reminder system (important)
At 02:19 IST no session has ended yet, so overdue can't occur naturally.
Go to **Settings → Reminders & sound → “Trigger reminder now”**. That mutates
the *real* session state to `overdue` (not a mock overlay), which fires the
overlay and the looping sound. Then use **Snooze** or **Skip with reason** and
confirm the audio stops immediately.

**Honest limitation, shown in the UI:** browser timers only run while the tab
is alive. Background delivery when the browser is closed or the device sleeps
requires server-side scheduling + Web Push + a service worker — specified in
`docs/API_CONTRACT.md` §3.10 + §7.

---

## Backend: what you asked for

`docs/API_CONTRACT.md` contains the complete spec to build the Node.js +
Express + MongoDB API, including:

* **Every MongoDB collection** with fields, enums and required indexes
  (users, settings, subjects, chapters, topics, scheduleSlots, sessionRecords,
  dailyLogs, mistakes, questions, mockTests, mockAttempts, aiMessages)
* **~70 endpoints** across auth, bootstrap `/state`, subjects/chapters/topics,
  schedule, sessions, revisions, mistakes, mock tests, analytics, reminders,
  push and AI
* **The semantic rules that make this app non-trivial** — handled explicitly:
  * `POST /sessions/:key/start` returns `revisionRequired` + the full
    `revisionPack` payload
  * `POST /sessions/:key/complete` lists all 8 side-effects in one Mongo
    transaction (learning registration vs revision registration, interval
    advance, log upsert) and demands idempotency on `(slotId, date)`
  * chapter status derivation, and the rule that `mastered` needs every topic
    learnt **plus** ≥2 revisions **plus** mastery ≥78
  * consistency formula based on completed sessions vs targets — never logins
* **A runnable `reminderService.js` cron sketch** with Web Push
* Suggested folder layout, validation matrix, error codes, domain events

### Connecting the prototype to your API
```ts
// src/services/api.ts
const USE_REMOTE_API = true   // flip this
```
Set `VITE_API_BASE_URL`. No page or component changes needed — the transport
signatures already match the contract.

**Security:** `OPENAI_API_KEY`, `MONGODB_URI`, `JWT_SECRET` and VAPID private
keys live on the server only. No key exists anywhere in this bundle, and the
AI page does not pretend to be a live model.

---

## Demo data
Deterministic seed keyed by the calendar date: 4 subjects, 31 chapters, ~90
topics with realistic learning/revision/accuracy history, 364 days of daily
logs, a full Mon–Sat + Sunday timetable with multiple sessions per subject,
36 questions, 4 mock tests, 6 seeded attempts, seeded mistakes, and pending
revisions. Progress you make is stored in `localStorage` and survives refresh;
**Settings → Reset demo data** regenerates everything.

## Run locally
See [docs/SETUP.md](docs/SETUP.md). Production single process:
```bash
npm run build:all
pm2 start ecosystem.config.cjs      # API + built web app on http://localhost:3000
```

## Known limitations (prototype scope)
* No auth/backend — data is per-browser in `localStorage`.
* Reminders are foreground-only, by design and by browser policy.
* AI responses are rules-based demo output, explicitly labelled.
* Demo MCQs are written for this prototype, tagged `origin: 'demo-bank'` /
  `ai-generated` / `unofficial-pyq` — never presented as official papers.
* Single bundle ≈871 kB (Recharts + router); code-splitting is the next
  optimisation if this goes to production.
