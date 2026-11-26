# Setup

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | **18.18+** (18, 20 and 22 tested on this machine's 18.20.8) | `engines` is declared in both `package.json` files |
| MongoDB | 6+ (tested with 8.0) | local `mongod` on `127.0.0.1:27017` is the default |
| poppler-utils + tesseract-ocr | optional | only needed to read **scanned** PDFs (OCR) |

No paid service is required to run the app or the test suite.

## 1. Install

```bash
npm run setup          # installs the web app and the API (server/)
cp server/.env.example server/.env   # optional — defaults work for local dev
```

## 2. Run in development

```bash
npm run dev            # API on :4000 + web on :3000 (Vite proxies /api)
```

Open http://localhost:3000, create an account, then open the verification link.
With the default `MAIL_DRIVER=console` no email is sent: the link is printed in the API log
and the **“Show recent emails”** button on the verify/forgot-password screens lists it
(development only).

On first sign-in you choose how to create your workspace:

* **Import data from this browser** — appears when the pre-account version of StudyOS
  stored data under `localStorage['studyos.state.v3']`. The browser copy is not deleted.
* **Start fresh** — curriculum + default timetable, no history.
* **Explore with demo data** — the generated 365-day dataset.
* **Restore a backup file** — a JSON export from Settings → Data & backup.

Run the pieces separately with `npm run dev:api` and `npm run dev:web`.

## 3. Optional integrations

### Google sign-in
1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* → **Web application**.
2. Authorized JavaScript origins: `http://localhost:3000` (and your production origin).
3. Set `GOOGLE_CLIENT_ID` in `server/.env` and restart the API. The button appears automatically
   (`/api/config` publishes the client id; no frontend rebuild needed).

### Email delivery
Set `MAIL_DRIVER=resend`, `RESEND_API_KEY`, and a `MAIL_FROM` on a domain verified in Resend.
(Nodemailer/SMTP was not used: its patched versions require Node 20+.)

### AI
```
AI_PROVIDER=anthropic
AI_API_KEY=sk-ant-...          # or ANTHROPIC_API_KEY
AI_MODEL=claude-opus-5-5       # default
AI_DAILY_REQUEST_LIMIT=40
```
The key is only read by the API. When unset, AI features report “not configured” and
the rule-based assistant keeps working.

### OCR for scanned PDFs
```bash
sudo apt install poppler-utils tesseract-ocr     # Debian/Ubuntu
```
`OCR_PROVIDER=auto` detects both binaries at runtime. Without them, scanned pages are reported
as “OCR unavailable” and the document can be **Reprocessed** after installing.

### Redis / BullMQ
Not required. PDF processing uses a durable MongoDB-backed queue (`ProcessingJob`) that resumes
after restarts. See ARCHITECTURE.md for the swap path.

## 4. Tests & checks

```bash
npm run check          # typecheck web + API, run both test suites, production build
npm test               # web tests only (Vitest + Testing Library, jsdom)
npm --prefix server test   # API tests (Vitest + Supertest) — needs MongoDB running
```
API tests create and drop a throwaway database per file (`MONGODB_TEST_URI`, default
`mongodb://127.0.0.1:27017`). Google, AI, OCR and email are faked in tests.

End-to-end smoke test against a running `npm run dev`:
```bash
npm --prefix server run e2e:smoke
```

## 5. Production build

```bash
npm run build:all                         # dist/ (web) + server/dist (API)
cd server
NODE_ENV=production \
JWT_ACCESS_SECRET=... FILE_SIGNING_SECRET=... \
MONGODB_URI=mongodb://... \
PUBLIC_APP_URL=https://study.example.com CORS_ORIGINS=https://study.example.com \
SERVE_CLIENT_DIST=../dist TRUST_PROXY=true \
npm start
```
The API refuses to start in production without 32+ character secrets. Serve over HTTPS
(cookies are `Secure` in production). Back up `STORAGE_DIR` with the database — it holds the
private PDFs.

## 6. Data migration tools

```bash
# Import an exported browser backup into a user's server workspace
npm --prefix server run migrate:import-local -- --email student@example.com --file ./backup.json [--replace]
# Grant the admin role
npm --prefix server run admin:promote -- --email admin@example.com
```
`--replace` first saves the previous workspace to `server/storage/backups/`.
