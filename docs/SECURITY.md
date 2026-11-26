# Security

## Authentication
* **Passwords:** Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1 — OWASP baseline). Never stored or logged in plain text. Policy: 10–128 chars, a letter and a number, not the email name, not on a small common-password list.
* **Login hardening:** identical error for unknown email / wrong password, dummy hash on unknown email (timing), lockout for 15 minutes after 5 failures, per-IP rate limits.
* **Email verification** required before password login (`REQUIRE_EMAIL_VERIFICATION`). Verification and reset tokens are 256-bit random, stored as SHA-256 hashes, single use, TTL-indexed (24 h / 1 h). Forgot-password and resend endpoints respond identically for unknown emails.
* **Access token:** HS256 JWT, 15 minutes, issuer + audience checked, carries `tokenVersion`; held in memory only on the client (never `localStorage`).
* **Refresh token:** 384-bit opaque value in an `HttpOnly`, `Secure` (production), `SameSite=strict` cookie scoped to `/api/auth`. Stored hashed. Rotated on every use; presenting an already-rotated token revokes the whole session family (theft detection), with a 15-second race window for parallel tabs.
* **Revocation:** logout revokes the family; “sign out everywhere” and password change/reset revoke all refresh sessions **and** bump `tokenVersion`, which invalidates outstanding access tokens immediately (checked on every request).
* **Google:** ID tokens verified server-side with `google-auth-library` (signature, audience, issuer, expiry), plus `email_verified`. Nothing else the browser sends about the Google user is trusted. Existing email accounts are never linked automatically — the user must confirm with the account password via a 10-minute signed link ticket.
* **CSRF:** only `/auth/refresh` and `/auth/logout` use the cookie; they require the `X-StudyOS-CSRF: 1` header (forces a CORS preflight) and an allow-listed `Origin`. All other endpoints use bearer tokens.

## Authorization & data isolation
* Every collection has an owner `userId`; every query includes it; foreign ids return 404.
* Business rules (revision gating, change limits, deadlines, scoring, dedupe) run on the server and are backed by unique/partial indexes where concurrency matters.
* `tests/isolation.test.ts` exercises read/write/list/aggregate access across two accounts.

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
Helmet (CSP allowing only self + Google Identity Services, HSTS, frame-ancestors self, no-sniff), CORS allow-list with credentials, `x-powered-by` off, generic 500 messages.

## Secrets & configuration
`.env` files are git-ignored; `.env.example` files document every variable. In production the API refuses to start without 32+ character `JWT_ACCESS_SECRET` and `FILE_SIGNING_SECRET`.

## Dependency audit (2026-11-26)
| Package | Status |
|---|---|
| API production deps | `npm audit --omit=dev`: 1 advisory — `pdfjs-dist` ≤4.1.392 (CVE-2024-4367, font-eval). **Mitigated** (eval disabled, text extraction only). Fixed versions require Node ≥20; upgrade when the runtime moves to Node 20+. |
| nodemailer | removed (patched releases need Node 20+); mail uses the HTTPS Resend API |
| `uuid` (via google-auth-library) | overridden to a patched version |
| Web app | dev-only advisories in Vitest/esbuild dev servers; `react-router` 6.x advisory fixed only in 7.x (planned migration) |

## Known gaps
* No 2FA / passkeys; no email-change flow; no CAPTCHA (rate limits + lockout only).
* The development mailbox endpoint exists only when `NODE_ENV=development`.
* Workspace documents are stored as JSON blobs (structure-validated, not field-by-field).
* Background (closed-tab) reminders via Web Push are not implemented.
