# Setup

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | **18.18+** (18, 20 and 22 tested on this machine's 18.20.8) | `engines` is declared in both `package.json` files |
| MongoDB | 6+ (tested with 8.0) | local `mongod` on `127.0.0.1:27017` is the default |
| poppler-utils + tesseract-ocr | optional | only needed to read **scanned** PDFs (OCR) |

No paid service is required to run the app.

## 1. Install

```bash
npm run setup          # installs the web app and the API (server/)
cp server/.env.example server/.env   # optional — defaults work for local dev
```

## 2. Run in development

```bash
npm run dev            # API on :4000 + web on :3000 (Vite proxies /api)
```

Open http://localhost:3000 and sign up with your name and a mobile number (+91, 10 digits),
then enter the 6-digit code. With the default `SMS_DRIVER=console` no SMS is sent; in
development the code is:

* shown on the sign-up / login screen (“Development SMS (not sent): your code is …”),
* printed in the API log (`[dev sms] 123456 is your StudyOS …`), and
* listed at http://localhost:3000/api/dev/sms.

A number can sign up only once; after that use **Log in** (number → code). Codes expire after
5 minutes, can be resent after 60 s, at most 5 per number per hour.

To send real SMS set `SMS_DRIVER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_FROM` (a Twilio number or sender ID). In production the console driver refuses to send.

Existing email/password accounts (created before phone sign-in) can attach a number and then
log in with a code:

```bash
npm --prefix server run user:set-phone -- someone@example.com 9876543210
```

On first sign-in you choose how to create your workspace:

* **Import data from this browser** — appears when the pre-account version of StudyOS
  stored data under `localStorage['studyos.state.v3']`. The browser copy is not deleted.
* **Start fresh** — curriculum + default timetable, no history.
* **Explore with demo data** — the generated 365-day dataset.
* **Restore a backup file** — a JSON export from Settings → Data & backup.

Run the pieces separately with `npm run dev:api` and `npm run dev:web`.

### Master account (development only)

```bash
npm run seed:master
```
Creates or resets the master account with phone **+91 90000 00001** (log in with a one-time code — see above for where the code appears in development). It has demo data, a published schedule v1 and 36 verified sample questions. Use `samples/sample-question-paper.pdf` to try the PDF upload. Override the number with `MASTER_ACCOUNT_PHONE` (the record also keeps `MASTER_ACCOUNT_EMAIL` for reference). The script refuses to run with `NODE_ENV=production` and only touches that one account. It is a normal account: there is deliberately no password that opens every account, because that would be a backdoor.

## 3. Optional integrations

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

## 4. Checks

```bash
npm run check          # typecheck web + API, then build both
```
The project keeps no automated test files (owner's decision). Verify features by signing in with
the master account (above) and using the app; record any problem found as a screenshot in
`error snip/`.

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
