# Setup & configuration

The one place for: installing, running, **every key / credential / setting you can add and where**,
production, and maintenance commands.

1. [Requirements](#1-requirements) · 2. [Install & run](#2-install--run-development) ·
3. [Configuration — keys, credentials and where to put them](#3-configuration--keys-credentials-and-where-to-put-them) ·
4. [Checks](#4-checks) · 5. [Production](#5-production) · 6. [Maintenance commands](#6-maintenance-commands)

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | **18.18+** | `engines` is declared in both `package.json` files |
| MongoDB | 6+ (tested with 8.0) | local `mongod` on `127.0.0.1:27017` is the default |
| poppler-utils + tesseract-ocr | optional | only to read **scanned** PDFs (see 3.5) |

Nothing paid is needed to run and test the app locally.

## 2. Install & run (development)

```bash
npm run setup                          # installs the web app and the API (server/)
cp server/.env.example server/.env     # optional for local dev — the defaults work
npm run dev                            # API on :4000 + web on :3000 (Vite proxies /api)
```
Run the pieces separately with `npm run dev:api` and `npm run dev:web`.

Open http://localhost:3000, sign up with a name and a mobile number (+91, 10 digits), then enter the
6-digit code. With the default `SMS_DRIVER=console` no SMS is sent; in development the code is shown
on the screen, printed in the API log and listed at http://localhost:3000/api/dev/sms.

On first sign-in choose **Start fresh** (curriculum + default timetable), **Explore with demo data**,
**Restore a backup file** (JSON from Settings › Data & backup) or **Import data from this browser**
(only shown when an old pre-account copy exists in this browser).

### Demo data

```bash
npm run seed:master                                  # rebuild only the demo account
npm --prefix server run seed:master -- --reset-all   # wipe the WHOLE database, then rebuild the demo
```
Demo student: phone **9000000001** (log in with the code shown on screen). Two weeks of history are
replayed through the real study engine, relative to the day you run it — run it again on another day
to refresh. Click-by-click walkthrough: [FEATURE_GUIDE.md › Part A](FEATURE_GUIDE.md). The script
refuses to run with `NODE_ENV=production`.

---

## 3. Configuration — keys, credentials and where to put them

### Where settings live

| File | What goes in it | Notes |
|---|---|---|
| **`server/.env`** | **everything below** — database, secrets, SMS, AI, OCR, limits | Create it with `cp server/.env.example server/.env`. Git-ignored — never commit it. The example file lists every variable with a comment. **Restart the API after any change** (`Ctrl+C`, then `npm run dev`). |
| `.env.local` (project root) | web-app options only, rarely needed | Copy from `.env.example`. Anything named `VITE_*` is shipped to browsers, so **no secrets here**. |
| `ecosystem.config.cjs` | pm2 process settings for production | No secrets here either; the API still reads `server/.env`. |

The browser never sees any key: AI, SMS and database credentials are read only by the API.

### At a glance

| Feature | Needed? | Variables in `server/.env` | Where you get it | If you leave it out |
|---|---|---|---|---|
| Database | **always** | `MONGODB_URI` | local MongoDB, or MongoDB Atlas | defaults to `mongodb://127.0.0.1:27017/studyos` |
| Security secrets | **production** | `JWT_ACCESS_SECRET`, `FILE_SIGNING_SECRET`, `OTP_SECRET` | generate yourself (3.2) | dev: random per restart (you get logged out of access tokens on restart). Production: the API refuses to start |
| SMS login codes | **production** | `SMS_DRIVER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio Console (3.3) | dev: code shown on screen. Production: login is impossible (console driver refuses to send) |
| AI (AI Help, answers for uploaded questions, explanations) | optional | `AI_PROVIDER=openai`, `OPENAI_API_KEY` | OpenAI platform (3.4) | AI Help shows "not switched on"; uploaded questions without an answer key wait as *pending answer* |
| OCR for scanned PDFs | optional | `OCR_PROVIDER`, `OCR_LANG` (no key) | install system packages (3.5) | scanned pages are reported "OCR unavailable"; text PDFs work |
| Your domain (production) | **production** | `PUBLIC_APP_URL`, `CORS_ORIGINS`, `TRUST_PROXY`, `SERVE_CLIENT_DIST` | your hosting | (3.6) |
| Limits & policy | optional | `SCHEDULE_MAX_CHANGES`, `AI_DAILY_REQUEST_LIMIT`, `MAX_UPLOAD_MB`, … | — | sensible defaults (3.7) |
| **Email** | **not used** | — | — | Sign-up and login are by mobile number + SMS code only. There is no email sending, so there is nothing to configure. |

### 3.1 Database (MongoDB)

```env
# local (default)
MONGODB_URI=mongodb://127.0.0.1:27017/studyos
# cloud (MongoDB Atlas) — Atlas › your cluster › Connect › Drivers, copy the string, add the database name
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/studyos?retryWrites=true&w=majority
```
On Atlas also add your server's IP under **Network Access**. To look at the data, open MongoDB Compass
with the same connection string (database `studyos`). Collections are listed in
[ARCHITECTURE.md › Database](ARCHITECTURE.md#database-mongodb--mongoose).

### 3.2 Security secrets (required in production)

Generate three different values (each ≥ 32 characters) and paste them in:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run once per secret
```
```env
JWT_ACCESS_SECRET=...     # signs login access tokens
FILE_SIGNING_SECRET=...   # signs the short-lived links to uploaded PDFs
OTP_SECRET=...            # hashes stored one-time codes
```
Changing `JWT_ACCESS_SECRET` signs everyone out of their current access token (they stay logged in
through the refresh cookie). Keep the same values across restarts and servers.

### 3.3 SMS for login codes (Twilio)

```env
SMS_DRIVER=twilio
TWILIO_ACCOUNT_SID=AC...          # 34 characters, starts with AC
TWILIO_AUTH_TOKEN=...             # click "show" next to it in the console — treat it like a password
TWILIO_FROM=STUDYO                # your DLT-registered sender ID (India), or a Twilio phone number (+1…)
```
1. Create an account at https://console.twilio.com. **Account SID** and **Auth Token** are on the
   console dashboard under *Account Info* (the token is hidden until you click show).
2. **Sending to Indian numbers needs DLT registration** (TRAI rule): register your company, sender ID
   and the message template on an Indian operator's DLT portal first, then submit the sender ID to
   Twilio. Only DLT-approved templates are delivered. Allow a few weeks. Details:
   https://www.twilio.com/en-us/guidelines/in/sms and
   https://support.twilio.com/hc/en-us/articles/21162166457755
3. The message the app sends is: `<code> is your StudyOS sign-up/login code. It expires in 5 minutes.
   Do not share it with anyone.` — register this text as your DLT template (the code is the variable).
4. Restart the API and log in with a real number to check.

Other values: `SMS_DRIVER=console` (development — code on screen and in the log), `disabled` (no codes
at all). `PHONE_ALLOWED_COUNTRY_CODES=91` (comma-separated country codes allowed to sign up).

### 3.4 AI (OpenAI)

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...             # https://platform.openai.com/api-keys
# optional — defaults shown
AI_MODEL=gpt-6.2-sol              # AI Help + explanations
AI_ANSWER_MODEL=gpt-6.2-sol       # solves uploaded questions that have no answer key
AI_EFFORT=medium
AI_ANSWER_EFFORT=high
AI_DAILY_REQUEST_LIMIT=40         # per student per day
AI_BACKGROUND_DAILY_LIMIT=2000    # whole server per day (background answering)
AI_MAX_OUTPUT_TOKENS=8000
AI_TIMEOUT_MS=120000
```
1. Sign in at https://platform.openai.com, add billing/credit under *Settings › Billing*, then create a
   key at https://platform.openai.com/api-keys.
2. Put both lines in `server/.env` and restart the API. (`AI_API_KEY` is accepted as an older name for
   `OPENAI_API_KEY`.)
3. Check: Settings › AI & tests shows AI available; AI Help answers a study question and refuses
   "tell me a joke". Questions waiting for an answer in the Question Hub are answered within ~10 minutes.

Calls use the Responses API (`POST https://api.openai.com/v1/responses`) with strict JSON-schema
output — https://developers.openai.com/api/docs/guides/structured-outputs,
https://developers.openai.com/api/docs/models. Students can switch AI off for themselves in Settings.

### 3.5 OCR for scanned PDFs (no key)

```bash
sudo apt install poppler-utils tesseract-ocr     # Debian/Ubuntu
```
`OCR_PROVIDER=auto` (default) finds both programs at runtime; `none` disables OCR; `OCR_LANG=eng`
(add `+hin` and install `tesseract-ocr-hin` for Hindi). Already-uploaded scanned papers can be
**Reprocessed** after installing.

### 3.6 Your domain (production)

```env
NODE_ENV=production
PUBLIC_APP_URL=https://study.example.com
CORS_ORIGINS=https://study.example.com
TRUST_PROXY=true                  # behind nginx / a load balancer (correct client IPs for rate limits)
SERVE_CLIENT_DIST=../dist         # the API also serves the built web app (one origin)
APP_TIMEZONE=Asia/Kolkata
# COOKIE_SECURE=true (default in production) · COOKIE_SAMESITE=strict
```
Serve over HTTPS (login cookies are `Secure` in production).

### 3.7 Limits & policy (optional)

| Variable | Default | Meaning |
|---|---|---|
| `SCHEDULE_MAX_CHANGES` / `SCHEDULE_WINDOW_DAYS` | 3 / 7 | schedule publishes allowed per rolling window |
| `MAX_UPLOAD_MB` / `MAX_PDF_PAGES` | 20 / 200 | PDF upload limits |
| `STORAGE_DIR` | `./storage/private` | where uploaded PDFs and sounds are kept — back it up with the database |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | 900 / 30 | login lifetimes |
| `PORT` / `LOG_LEVEL` | 4000 / info | API port and log detail |

**Not configurable yet** (not built): Redis/BullMQ (a MongoDB queue is used), S3/cloud file storage,
background push notifications.

---

## 4. Checks

```bash
npm run check          # typecheck web + API, then build both
```
The project keeps no automated test files (owner's decision). Verify features with the demo account
([FEATURE_GUIDE.md](FEATURE_GUIDE.md)); save a screenshot of any problem in `error snip/`.

## 5. Production

```bash
npm run build:all                    # dist/ (web) + server/dist (API)
pm2 start ecosystem.config.cjs       # API + built web app on one port
```
Before starting, `server/.env` needs the items marked **production** in 3 (secrets, Twilio, domain,
database). The API refuses to start without the three secrets. Back up the database and
`STORAGE_DIR` together.

## 6. Maintenance commands

| Task | Command |
|---|---|
| Upgrade an older database (drops removed features' collections after a backup, moves questions to the shared hub, syncs indexes) | `npm --prefix server run db:upgrade` (dry run), then `npm --prefix server run db:upgrade -- --apply` |
| Make a user an admin | `npm --prefix server run admin:promote -- --phone 9876543210` |
| Import a backup JSON into a user's account | `npm --prefix server run migrate:import-local -- --phone 9876543210 --file ./backup.json [--replace]` (`--replace` first saves the old data to `server/storage/backups/`) |
| Give an old email/password account a phone number | `npm --prefix server run user:set-phone -- someone@example.com 9876543210` |
| Rebuild the demo | see [Demo data](#demo-data) |
