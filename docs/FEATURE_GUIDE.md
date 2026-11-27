# StudyOS — feature guide (how each flow works and how to verify it)

Part A is a click-by-click walkthrough with the demo data. Part B explains each feature's rules.

Sidebar: **Dashboard · My Schedule · Revision Center · Subjects & Chapters · Tests · Mistake Bank ·
AI Help · Analytics · Settings**. Sunday Review opens from Dashboard and Revision Center.

---

# Part A — manual walkthrough with the demo data

**Prepare (once per day you test).** The demo story is built relative to the day you seed it.
```bash
npm --prefix server run seed:master -- --reset-all   # wipes the database, builds the demo
npm run dev                                          # web http://localhost:3000 · API http://localhost:4000
```
The demo student studied every day for the last two weeks (Mon–Sat, 4 subjects × 2 cycles), did last
Sunday's weekly review, skipped one session, missed one, used emergency overrides twice, changed the
schedule once, uploaded a PDF and took two mock tests. **Today**, only Mathematics has been revised and
studied (if its 06:15–07:30 slot has passed); every other subject is waiting for its revision.

> The "Session overdue" reminder pops up for sessions whose time has passed — that is the reminder
> feature. Press **Snooze**, or turn on **Settings › Reminders & sound › Quiet mode** while you test.

| # | Go to | Do | You should see |
|---|---|---|---|
| A1 | `/login` | Mobile **9000000001** → Send code → the code shown under "Development SMS" → Log in | Dashboard as **Demo Student** |
| A2 | `/login` (log out first, avatar menu) | Try **1234567890** and an unknown valid number such as 9876500000 | "Indian mobile numbers start with 6, 7, 8 or 9."; "No account for this number — sign up first." |
| A3 | `/register` | Sign up with 9000000001 | "This number is already registered — please log in" |
| A4 | Dashboard | Look at the yellow **Previous-day revision due today** banner and the session list | 1 of 5 done (Mathematics ✓). Reasoning has two items — one **overdue · bypassed** (from the override day) |
| A5 | My Schedule (today's tab) | Scroll the Friday/today list | Revision rows sit right above each subject's first session (e.g. "Revise Reasoning — previous-day topics"); those sessions show **Locked**; Mathematics cycle 1 is **Completed** with "Revision completed"; above Maths cycle 2 is "Revise Mathematics — cycle 1 topics" |
| A6 | My Schedule | Click **Locked — revise first** on Reasoning (or ⋯ › Start session) | Lock dialog listing both Reasoning revisions |
| A7 | Lock dialog | **Revise** → Start revision → try Complete without ticking → tick all topics → fill counts/confidence → Complete. Repeat for the second Reasoning revision | "Tick every topic…" error first; after both, Reasoning cycle 1 starts automatically. Physical Science and Current Affairs **stay locked** (subjects are independent) |
| A8 | Dashboard / session card | **Update progress** on Reasoning cycle 1 → pick a topic, keep "Learning fully completed" → Save | Toast "Same-day revision scheduled"; Reasoning cycle 2 now has "Revise Reasoning — cycle 1 topics" above it and is locked |
| A9 | My Schedule | On Current Affairs: ⋯ › **Request exception (emergency override)** → reason ≥10 chars → tick → Record | Session unlocks as **Exception approved**; the Current Affairs revision still shows **bypassed** (not completed) |
| A10 | My Schedule | ⋯ on any session › **View details** / **View dependencies** / **View revision requirements** | Slot settings, today's status, required revisions, overrides history |
| A11 | My Schedule | **Add session** (or Edit) → change anything → Save; then **Review & publish** | Draft bar appears; publish dialog shows the diff and **1/3 changes used** (the demo already used one) — publishing uses 1 more |
| A12 | My Schedule | **History** | v1 (initial) and v2 ("Add static GK to the Sunday review") |
| A13 | Revision Center | Tabs **Open / Same-day / Next-day / Weekly / Overdue / Completed** | Overdue: 4 (incl. the bypassed one and same-day revisions left open by the skip, the miss and the override); Completed: dozens with questions/correct/wrong/confidence |
| A13b | My Schedule | Click the **Sunday** day tab | **4 sessions, one per subject**: Weekly Revision — Mathematics, Physical Science, Reasoning, Current Affairs & GK (no learning, never locked). Day summary lists each subject once. The note links to Sunday Review and Tests (the weekly mock test is taken from Tests, not from a Sunday slot) |
| A14 | Sunday Review | This week | All **4 subjects** with topics grouped Mon…today, status "opens on review day" (Sunday) |
| A15 | Sunday Review | **Previous week** | 4/4 subjects revised (done last Sunday), with results |
| A16 | Tests | Overview | 45 ready questions in the hub, 3 waiting for AI, 2 need review; 3 tests (2 finished) |
| A17 | Tests › Results | Open the **Weekly mixed test** result | Score, review, answer-source badge per question; **Report wrong answer** on a question you answered |
| A18 | Tests › My tests | Take **Reasoning practice (not taken yet)** → answer, refresh mid-test, submit | Timer continues after refresh; result appears; wrong answers go to the Mistake Bank |
| A19 | Tests › Question hub | Filter **Status: Waiting for AI answer** / **Needs review** | 3 waiting ("add OPENAI_API_KEY" notice), the figure question in Needs review, the PDF's descriptive question too |
| A20 | Tests › Create mock test | Upload `samples/sample-question-paper.pdf` again with subject Physical Science | "You already uploaded this PDF" (same file is stored once) |
| A21 | Mistake Bank | Both tabs | Entries from the demo tests and history; mark one resolved |
| A22 | AI Help | Click the tab, and also type `localhost:3000/ai` directly (check in Brave/Chrome) | Page loads with the sidebar: "Not switched on yet" + a labelled example conversation (answered question, schedule answer, refused off-topic question). With a key: ask a study question and "tell me a joke" |
| A23 | Analytics | 7 / 30 days | Charts + **Learning vs revision**: learning and revision time separate, revision completion rates, overdue count, overrides (3 gate + 0 schedule), subject and chapter progress |
| A24 | Settings › Reminders & sound | Pick **Gong** → Test; **Upload sound** (short MP3/WAV) | Plays; upload shows "1/10" and is selected; **Trigger reminder now** plays it |
| A25 | Settings › Study cycles & revision | Change carryover to **All subjects first** → Save, reload My Schedule | Every learning session now waits for every subject's carryover (switch back afterwards) |
| A26 | Settings | Walk the 8 sections | Only working settings; time zone lives under Study cycles & revision |
| A27 | Dark mode | Moon icon in the header | Every page readable |
| A28 | Phone width | Browser dev-tools device mode (390 px) | One-line header, no sideways scrolling, dialogs as bottom sheets |

> If a page ever fails, it now shows "This page hit an unexpected error…" with a **Reload app** button while the sidebar keeps working — it never goes blank. Take a screenshot of that message for `error snip/`.

---

# Part B — feature rules

## 1. Sign up and log in (mobile number + one-time code)

**Flow**
1. Sign up: name + mobile (+91, 10 digits starting 6–9) + accept terms → **Send code** → 6-digit code → account created and logged in.
2. Log in: mobile → **Send code** → code → logged in. No passwords, no email.

**Rules**
- One account per number. Signing up again shows "already registered — please log in" with a link.
- Logging in with an unknown number shows "sign up first".
- A code lasts 5 minutes and works once. 5 wrong tries kill it.
- You must wait 60 s before requesting another code, and you can get at most 5 codes per number per hour.
- Codes are sent by SMS through Twilio once `SMS_DRIVER=twilio` is set. In development the code is shown on screen and at `/api/dev/sms`.

**Verify:** sign up with a new number; sign up again with the same number (refused); type a wrong code 5 times (code dies); log in.

---

## 2. First day — the default timetable

A new account (**Start fresh** on first login) gets a cycle timetable (Mon–Sat, 15-minute gaps reserved for revision):

| Cycle 1 (no same-day revision) | Cycle 2 (revise that subject's cycle-1 topics first) |
|---|---|
| Maths 06:15 · Science 07:45 · Reasoning 09:15 · Current Affairs 10:45 | Maths 14:15 · Science 15:30 · Reasoning 16:45 · Current Affairs 18:00 |

Sunday: one weekly revision session per subject (Maths 08:00, Science 10:15, Reasoning 13:00, Current Affairs 15:00) — no new learning. The weekly mock test is taken from **Tests**.

**Verify:** sign up fresh → My Schedule shows Cycle 1 and Cycle 2 for today; no session is locked on day one.

---

## 3. A study day — sessions, cycles and revision gates (enforced by the server)

**Flow on any day**
1. **Before a subject's first session** (from the second study day on): a revision block "Revise *Subject* — previous-day topics" appears right above that session. The session stays **locked** until that subject's revision is completed. Revising Maths unlocks only Maths.
2. **Start** a session → study → **Update progress**: pick the topic(s); tick "Learning fully completed" only if you finished them. Partly done topics are never used for revision.
3. **Cycle 2 of the same subject** is then locked. A block "Revise *Subject* — cycle 1 topics" appears above it with exactly the topics you fully completed in cycle 1.
4. **Revise** opens the Revision Preparation Panel:
   - It shows the topics, key points and formulas, your session notes, practice questions from the Question Hub, and your past mistakes.
   - Press **Start revision** (the timer runs on the server), tick every topic, enter questions attempted, correct and wrong, your confidence, and optional notes, then press **Complete revision**.
   - The session unlocks.
5. At midnight (in your time zone) everything you fully completed that day becomes the next study day's per-subject revision. Rest days and holidays are skipped.

**Other rules**
- **Skip** (with a reason) never clears a revision; it stays pending and is shown as overdue later.
- **Emergency override** (on a locked session):
  - It needs a reason of at least 10 characters and unlocks only that one session.
  - It is recorded with who, when and what it bypassed.
  - The revision stays pending and is counted as bypassed, not completed.
- Completed sessions and revisions can never be changed. A start or completion sent twice is recorded once.
- Settings → Study cycles & revision → "How the next-day revision gates learning" can switch to **All subjects first** (finish every subject's carryover before any learning).

**Verify:**
1. Complete Maths cycle 1 with a topic → Maths cycle 2 shows the revision block and is locked.
2. Reasoning is unaffected.
3. Revise → cycle 2 unlocks.
4. Next day: each subject has its own previous-day revision above its first session.
5. Try an override → it shows in Analytics › emergency overrides.

---

## 4. My Schedule — editing and publishing

**Flow:** edit the week (**Add session**, **Edit**, **⋯ menu**, **Generate cycles**, **Copy this day**). Edits are a **draft**; **Review & publish** shows the differences and applies them from tomorrow.

**The session form:** subject, session type (learning / revision / practice / mock test), chapter and topics from your syllabus, cycle number, day and times, learning target, practice target, revision duration, revision policy, and prerequisites (earlier sessions on the same day).

**The ⋯ menu:**
- Start session
- View details
- Edit
- Duplicate
- Reschedule today only
- View dependencies
- View revision requirements
- Request skip
- Request exception
- Delete

**Rules**
- **Change limit:** at most 3 published changes in any 7 days. The first publish is free. Drafts, completing sessions and revisions never count. Past the limit you need an emergency override with a reason (recorded).
- **History is safe:** every version is kept (History). Past and today's sessions are never rewritten.
- **Validation:** publishing is blocked if dependencies are invalid (a wrong chapter or topic, a prerequisite that doesn't start earlier, or cycle numbers out of order).

**Verify:** edit a session → "unpublished changes" bar → publish 3 times → the 4th is refused (429) unless overridden; History lists every version.

---

## 5. Revision Center

- **Top — revisions you must do:** tabs Open / Same-day / Next-day / Weekly / Overdue / Completed. Each card shows the subject, chapters, topics, source session, due date, planned time, status and (when done) questions, correct, wrong and confidence.
- **Below — spaced revision:** topics due on the 1·3·7·15·30-day plan.
- A completed revision is **not** "mastered". Mastery needs repeated revisions and good accuracy.

**Verify:** after day 3 above, the Next-day tab lists the per-subject revisions. Complete one; it moves to Completed with your numbers.

---

## 6. Sunday Review — the whole week in one sitting

**Flow**
1. During the week, every topic you fully complete Mon–Sat is added to that subject's **weekly revision** (grouped by day).
2. On the review day (Sunday by default, set in Settings) each subject's card opens. **Revise** uses the same preparation panel.
3. Then **Build weekly test** (from the Question Hub).
4. The page also shows weak topics, unresolved test mistakes, and the week's numbers: sessions done, missed/skipped, learning time, revision time and revisions by type.

**Rules:** weekly revision is separate. It never completes a same-day or next-day revision, and it never locks learning. Before Sunday the cards show "opens on review day".

**Verify:** complete some topics during the week → Sunday Review lists them per subject and day → on Sunday revise one subject → progress shows 1/N.

---

## 7. Tests — the shared Question Hub, AI answers and mock tests

**Upload (Tests › Create mock test, or Question Hub)**
1. Upload a question-paper PDF and choose its subject (required).
2. The server extracts the questions (text, OCR for scanned pages, answer key if the paper has one).
3. Every question goes into **one shared hub** for all students, filed by subject. The same question uploaded twice is stored once.

**Answer status**

| Status | Meaning | Used in tests? |
|---|---|---|
| Ready | has a trusted answer: the paper's answer key, the uploader's answer, or AI-solved with ≥75 % confidence | yes |
| Waiting for AI answer | no answer key; AI is solving it in the background | no |
| Needs review | unclear extraction, AI unsure or the question is unanswerable, or reported as wrong | no |
| Rejected | excluded by its uploader | no |

**AI answering (background)**
- The AI solves questions without an answer key in batches. An answer is accepted only if:
  - every option label it gives really exists on that question;
  - a single-answer question gets exactly one option;
  - its confidence is at least 0.75.
- Otherwise the question goes to Needs review. An AI error never makes a question ready.
- Without an API key, questions wait; within ~10 minutes of adding the key they are answered automatically.

**Build and take a mock test**
1. Choose the test type, subjects (each shows how many ready questions the hub has), count, time and marking.
2. The test is built only from **ready** questions. If there aren't enough it says exactly how many are available.
3. Timed on the server. Answers autosave; refresh resumes the test.
4. **Results:** score, review, and for every question where its answer came from ("Answer key in the paper" / "Solved by AI · 92 % confident" / "Set by the uploader"). Your answers are checked against that stored answer.
5. **Report wrong answer** (only after answering it in a test): the question leaves new tests and AI re-checks it at higher effort; it returns only if the re-check agrees. The uploader can also correct it.

**Verify:**
1. Upload `samples/sample-question-paper.pdf` with a subject → watch statuses in the document review.
2. With AI off, questions without a key say "waiting for AI — add OPENAI_API_KEY".
3. Build a test from another account and see the same questions available.
4. Finish it and check the answer-source badges.

---

## 8. AI Help — study questions only

**Flow:** AI Help → ask, or tap a suggestion. It answers:
- topic and concept explanations;
- step-by-step solutions to exam questions;
- your schedule and what to revise, using your real data;
- exam strategy.

**Out of scope** (chit-chat, jokes, coding, news, personal/medical/legal, attempts to change its rules) → the fixed reply "I can only help with your studies…". The server decides this, so the AI cannot be talked into answering.

**Limits:** 40 questions per student per day (shown on the page).

**Verify (needs the key):** ask "Explain HCF and LCM" → answer; ask "tell me a joke" → refusal. Without a key the page says AI Help is not switched on yet.

---

## 9. Mistake Bank and Analytics

- **Mistake Bank:** wrong answers from your tests are added automatically (Settings › AI & tests); review and mark them resolved.
- **Analytics** (7 / 30 / 90 days / 1 year): it shows the following, with learning time and revision time always kept separate:
  - planned vs actual time;
  - completion rates for same-day, next-day and weekly revision;
  - overdue revisions, and skipped or missed sessions;
  - emergency overrides;
  - completion by subject and progress by chapter;
  - learning vs revision accuracy.

---

## 10. Reminders and alert sounds (Settings › Reminders & sound)

- When a session's end time passes without an update, an overlay appears with a looping sound (Update now / Snooze / Skip with reason). It works only while the tab is open.
- **Built-in sounds:** Chime, Bell, Marimba, Soft ping, Digital, Gong, Pulse, Alarm, Silent.
- **Upload your own:** up to **10** sounds, MP3/WAV/OGG/M4A/WebM, ≤2 MB and ≤30 s each. The real file type is checked on the server, and only you can play your files. If a sound can't play, Chime is used.

**Verify:** upload a short MP3 → it appears in "Your sounds" and is selected → **Trigger reminder now** plays it; an 11th upload is refused.

---

## 11. Settings (8 sections)

| Section | Contains |
|---|---|
| Account & security | name, mobile number, signed-in devices, sign out everywhere |
| Profile & exam | name, target exam, exam date (dashboard countdown) |
| Study targets | weekly target, spaced-revision intervals |
| Study cycles & revision | subject order and per-subject revision minutes; study-day time zone; cycles per day; session/break length; same-day / next-day / weekly revision minutes; per-subject or all-subjects carryover; weekly review day; rest days; holidays; require practice in revisions |
| Reminders & sound | reminders on/off, quiet mode, grace period, repeat interval, sound + uploads, volume, browser notifications, test trigger |
| AI & tests | allow AI for my account, today's AI usage, add wrong test answers to the Mistake Bank |
| Appearance | light/dark theme, compact sidebar |
| Data & backup | export JSON / sessions CSV, import a backup |

---

## 12. For the operator

Keys, credentials (AI, SMS, database, secrets), production and maintenance commands are all in
[SETUP.md](SETUP.md) › *Configuration*. Collections and data rules: [ARCHITECTURE.md › Database](ARCHITECTURE.md#database-mongodb--mongoose).
