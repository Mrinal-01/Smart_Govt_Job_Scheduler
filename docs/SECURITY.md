# Security

## Authentication
* **Sign-up and login use a mobile number + one-time code (OTP)** — no passwords. Numbers are normalized to E.164 and restricted to `PHONE_ALLOWED_COUNTRY_CODES` (default India, 10 digits starting 6–9). One account per number (partial unique index; concurrent sign-ups collapse to one account).
* **OTP storage & lifetime:** 6 digits from `crypto.randomInt`; only `HMAC-SHA256(OTP_SECRET, phone:purpose:code)` is stored (`phoneotps`); compared in constant time; valid 5 minutes; single use (atomic consume); one active code per number and purpose; 5 wrong attempts invalidate the code. Documents are TTL-purged.
* **OTP abuse limits:** 60 s resend cooldown and at most 5 codes per number per rolling hour, plus 20 OTP requests/hour/IP and 10 register/login attempts per 15 min per IP. Codes are never logged in production; the console SMS driver refuses to send in production (503) so codes cannot leak to logs.
* **Enumeration trade-off (product decision):** `otp/request` tells the user whether a number is registered (sign-up answers `PHONE_IN_USE`, login answers `PHONE_NOT_REGISTERED`) so they are sent to the right screen. The per-number and per-IP limits bound how fast numbers can be probed.
* **Development codes:** with `NODE_ENV=development` and `SMS_DRIVER=console` only, the code is returned as `devOtp`, printed in the API log and listed at `GET /api/dev/sms`.
* **Legacy accounts:** accounts created with email/password keep their Argon2id hash; they log in by OTP after a phone is attached (`npm --prefix server run user:set-phone`). Email verification and password reset were removed.
* **Access token:** HS256 JWT, 15 minutes, issuer + audience checked, carries `tokenVersion`; held in memory only on the client (never `localStorage`).
* **Refresh token:** 384-bit opaque value in an `HttpOnly`, `Secure` (production), `SameSite=strict` cookie scoped to `/api/auth`. Stored hashed. Rotated on every use; presenting an already-rotated token revokes the whole session family (theft detection), with a 15-second race window for parallel tabs.
* **Revocation:** logout revokes the family; “sign out everywhere” and a (legacy) password change revoke all refresh sessions **and** bump `tokenVersion`, which invalidates outstanding access tokens immediately (checked on every request).
* **CSRF:** only `/auth/refresh` and `/auth/logout` use the cookie; they require the `X-StudyOS-CSRF: 1` header (forces a CORS preflight) and an `Origin` that is allow-listed or the same host the request was sent to. All other endpoints use bearer tokens.

## Authorization & data isolation
* Every collection has an owner `userId`; every query includes it; foreign ids return 404.
* Business rules (revision gating, change limits, deadlines, scoring, dedupe) run on the server and are backed by unique/partial indexes where concurrency matters.

## Input handling
* Zod validation on every route (unknown keys stripped, types coerced to primitives).
* Requests containing `$`-prefixed keys are rejected (NoSQL operator injection); `strictQuery` on.
* JSON body limit 1 MB (8 MB only for `/api/workspace`).

## Files
* PDFs are validated (extension/MIME, `%PDF-` magic bytes, parseable, page limit, size limit) and stored under `STORAGE_DIR` with 0600 permissions, outside any static directory, at server-generated paths (`<userId>/<documentId>.pdf`, regex-checked, traversal-checked).
* Delivery only through 5-minute HMAC-signed URLs bound to document id + owner; responses are `no-store`, `nosniff`, `frame-ancestors 'self'`.
* pdf.js runs with `isEvalSupported: false`, no font loading and no network (mitigates CVE-2024-4367). The optional native `canvas` dependency is replaced by an empty stub so no native code or install-time `tar` extraction is involved.

## AI
* Provider keys exist only in server environment variables.
* Per-user enable switch, daily request limit, per-minute burst limit, timeouts, max output tokens.
* `aiusagelogs` record feature, model, tokens, latency and status — **never prompts or outputs**. Logger redacts authorization headers, cookies, passwords and tokens.
* Prompts contain only the requesting user's data; the model is told not to invent history, never to set correct answers during PDF structuring, and AI-structured output is rejected unless its text is found in the PDF.

## HTTP hardening
Helmet (CSP allowing only self + Google Fonts, HSTS, frame-ancestors self, no-sniff), CORS allow-list with credentials, `x-powered-by` off, generic 500 messages.

## Secrets & configuration
`.env` files are git-ignored; `.env.example` files document every variable. In production the API refuses to start without 32+ character `JWT_ACCESS_SECRET`, `FILE_SIGNING_SECRET` and `OTP_SECRET`.

## Dependency audit (2026-11-26)
| Package | Status |
|---|---|
| API production deps | `npm audit --omit=dev`: 1 advisory — `pdfjs-dist` ≤4.1.392 (CVE-2024-4367, font-eval). **Mitigated** (eval disabled, text extraction only). Fixed versions require Node ≥20; upgrade when the runtime moves to Node 20+. |
| nodemailer | removed (patched releases need Node 20+); mail uses the HTTPS Resend API |
| Web app | dev-only advisory in the esbuild dev server; `react-router` 6.x advisory fixed only in 7.x (planned migration) |

## Known gaps
* No passkeys; no phone-number change flow; no CAPTCHA (rate limits + per-number caps only). SMS OTP is vulnerable to SIM-swap like any SMS login.
* The development mailbox and SMS inbox endpoints exist only when `NODE_ENV=development`.
* Workspace documents are stored as JSON blobs (structure-validated, not field-by-field).
* Background (closed-tab) reminders via Web Push are not implemented.
