# Implementation Progress

Legend: ✅ done & tested · 🟡 partial · ⬜ not started. Final status and test numbers: [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md).

## Stage 1 — Toolchain
- ✅ Vite 8 → 5.4 / plugin-react 6 → 4.3 so the app builds on the installed Node 18 (and 20/22)
- ✅ Removed unused Hono packages; added Vitest + Testing Library; vendor chunks

## Stage 2 — Backend foundation (`server/`)
- ✅ Express + TypeScript + Mongoose + Zod + pino, centralized errors, env validation
- ✅ Helmet CSP, CORS allow-list, rate limits, `$`-key guard, body limits

## Stage 3 — Authentication
- ✅ Register / verify / resend / login / logout / logout-all / forgot / reset / change password / sessions
- ✅ Argon2id, lockout, rotating hashed refresh tokens with reuse detection, CSRF guard
- ✅ Google ID-token verification + explicit linking (mock-tested; live needs credentials)
- ✅ Auth screens, protected routes, in-memory access token

## Stage 4 — Workspace persistence & migration
- ✅ Server workspace with optimistic concurrency, per-user cache, conflict banner
- ✅ Onboarding: import browser data / fresh / demo / backup file; CLI import script

## Stage 5 — Study cycle engine
- ✅ Cycles, blocks, study logs, deduplicated cycle revision tasks, revision logs
- ✅ Revision gate, skips with reasons, carry-forward, partial topics, configurable timings
- ✅ Study Cycles page; topic ledger kept in sync

## Stage 6 — Schedule governance
- ✅ Immutable versions, diffs, rolling limit, audited override, effective dates
- ✅ Draft editing, publish dialog, history, baseline auto-publish

## Stage 7 — PDF pipeline & question bank
- ✅ Upload validation, private storage, signed URLs, Mongo job queue
- ✅ Parser, answer keys, OCR provider interface, AI structuring with grounding
- 🟡 Real Tesseract / real model not exercised here; diagrams page-level only; no two-column layout handling
- ✅ Review, verify, bulk actions, search, manual questions

## Stage 8–9 — Mock tests & exam engine
- ✅ Builder for all five types, templates, difficulty/topic selection, availability preview
- ✅ Server deadline, autosave, resume, auto-submit, idempotent submit, unscored handling
- ✅ Results, breakdowns, review, retakes, Mistake Bank integration

## Stage 10 — AI assistant
- ✅ Provider abstraction (official Anthropic SDK), limits, usage log, grounded analyses, explanations, practice generation (mock-tested; live needs key)

## Stage 11 — Settings
- ✅ Account, security & sessions, schedule policy, revision preferences, AI usage

## Stage 12 — Docs & checks
- ✅ AUDIT, ARCHITECTURE, DATABASE_SCHEMA, API_DOCUMENTATION, SECURITY, SETUP, REPORT, `.env.example` files
- ✅ `npm run check` green; E2E smoke green

## Not started (documented)
- ⬜ Web Push background notifications
- ⬜ S3/GCS storage driver
- ⬜ Normalized Subject/Chapter/Topic/DailySession collections (kept in workspace by design)
- ⬜ Admin UI for policy limits; email change; 2FA
