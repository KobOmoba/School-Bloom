## 2026-08-10 — Bug fix: Score OCR reads names but not numbers

**Root cause:** `_groqScoreOCR` was missing `reasoning_format:'hidden'` in its
Groq API call. The `qwen/qwen3.6-27b` model generates internal thinking tokens
which, without `reasoning_format:'hidden'`, are streamed into the response and
counted against the `max_tokens: 4096` budget. For a score sheet with 11 students
× 3 terms × 4 scores = 132 numbers to extract, the thinking tokens consumed
most of the 4096 token budget, leaving the actual JSON score output truncated
or empty.

The student roster OCR (`groqVisionOCR`) already had `reasoning_format:'hidden'`
— which is why names read correctly. Only `_groqScoreOCR` was missing it.

Every other Groq call in the codebase already uses `reasoning_format:'hidden'`:
- `groqVisionOCR` (line ~588) ✅
- exam script OCR (line ~5410) ✅  
- generic Groq call (line ~6437) ✅
- fee ledger OCR (line ~6842) ✅
- `_groqScoreOCR` (line 4828) ← was missing, now fixed ✅

**Fix:** Added `reasoning_format:'hidden'` to the `_groqScoreOCR` Groq API body.

**Applied to:** School-Bloom (production) + bloom-school-v2 (sandbox).
**Cache-bust:** `?v=20260810-scorefix2` in School-Bloom index.html.
**Confirmed by:** Bayo — Groq key was working (names read), so the problem
was specifically in the score-specific OCR call, not the API key.

---

## 2026-08-10 — Bug fix: Scan Score Sheet review table not rendering

**Bug:** `_renderScoreOcrPreview` used `isAllTerms` and `termNum` without declaring
them in its own scope. Every other function that uses these variables declares them
locally from `termMode`, but this one was missing the two lines. Result: `isAllTerms`
was `undefined`, `termsToShow` became `[NaN]`, the table loop silently produced nothing.
The status message showed ("✅ Found 11 entries") but the review table was blank.

**Fix:** Added the two missing declarations at the top of `_renderScoreOcrPreview`:
```
const isAllTerms=(termMode==='all'||!termMode);
const termNum=isAllTerms?'1':(termMode||'1');
```

**Applied to:** School-Bloom (production) + bloom-school-v2 (sandbox) — same bug in both.
**Cache-bust:** `?v=20260810-scorefix` in School-Bloom index.html.
**Verified by:** Bayo tested on FUTURE PROMISE COMPREHENSIVE COLLEGE — scan found 11 entries
but review table was blank. Fix resolves the blank table.

---

# EduBloom School Management Portal

**Production site:** [school.edubloom.com.ng](https://school.edubloom.com.ng)

## 📍 Current Position — 2026-08-10

### ✅ STEP 4 COMPLETE — Production running bloom-school-v2 codebase

### 🔴 FIRESTORE RULES CORRECTION REQUIRED

The Step 3 rules published 2026-08-09 used `authed()` (Firebase Auth) for all
`admin_*` collections and `schools` top-level doc. The portal has no Firebase Auth
— approval writes failed immediately. Corrected rules issued 2026-08-10.

**Bayo must publish the corrected rules before any school approval will work.**

See bloom-portal README for full corrected rules text and cleanup checklist.

### What to verify after rules are published:
- Hard-refresh `school.edubloom.com.ng` on Brave
- Enter Portal with an existing School ID
- Add a student → check Firestore for `schools/{id}/students/{sid}` subcollection doc
- Staff claim account → role-based nav whitelist applies correctly
- OCR scan → Groq returns JSON correctly

### What remains deferred:
- HuggingFace cascade dormant — wire up when HF connectivity confirmed
- New OCR schemas (subjects, staff, alumni, expenses, sports_roster) — UI buttons only
- OCR Service (PaddleOCR VPS) — Bayo provisions Oracle Cloud VM, runs deploy.sh
- Delete orphaned `v2_schools` collection from Firebase Console
- Delete second Firebase web app (appId: 0f9d338f) from Firebase Console
- Relock `_isPremium()` — Bayo's call when premium verification complete

---

## Previous Update — 2026-08-09 — Step 4 Complete

app.js, index.html, style.css ported verbatim from bloom-school-v2.
Cache-busting: `?v=20260809-step4port` / CACHE_NAME `edu-bloom-v20260809-step4port`.

### Standing Rules (never skip)
- Cache-bust every push touching app.js, index.html, or style.css:
  bump `?v=YYYYMMDD-descriptor` in index.html AND `CACHE_NAME` in sw.js
- Port between v2 and v1: copy code exactly as written — no deviations
- `_isPremium()`: currently `return true` (TEMP BYPASS) — do not restore without Bayo go-ahead
- Password recovery: routes to Bayo/AariNAT (+2348145073941) only, never agents
- **Update README after every action, same session, no exceptions**



---

## 2026-08-10 — Session: Score OCR Fix + Term Panel Display Bug

### Changes pushed this session (`app.js` — 2 commits)

---

### 🔴 BUG FIX — Two score tables stacking on screen (visual)

**Symptom:** When OCR fails and falls back to manual entry, two separate student grids
appeared stacked on the screen with different student names visible.

**Root cause:**
`_renderScoreOcrPreview()` was opening all three term panels with `style="display:block"`:
```javascript
// BEFORE (bug):
pHTML += `<div id="socr-term-${t}-panel" style="display:block;">`;

// AFTER (fix):
pHTML += `<div id="socr-term-${t}-panel" style="display:${(isAllTerms && t !== 1) ? 'none' : 'block'};">`;
```
With all three panels visible simultaneously, the viewport showed:
- **Top group**: Term 1's table (inner 240px scroll container) scrolled to students 7–11
  (ADERUSIWA FOLA, ANWOSUE DAVID, AZEMU OPEYEMI, MEBOSIWA FELA, MAICU DANIELLA)
- **Bottom group**: Term 2's table (stacked directly below, also display:block) starting
  fresh from student 1 with its own header row (ANWOJIE DANID, AREMU OPEYEMI...)

The students were NOT duplicated — all 11 were the same students in all 3 panels.
The "different names" effect was entirely the scroll position of Term 1's inner div.

`_renderScoreOcrDropdownGrid` (the other render path) already had the correct `display:none`
logic. `_renderScoreOcrPreview` (used in OCR-failed fallback) was missing it. Fixed to match.

**Commit:** `4114e8e`

---

### 🔴 BUG FIX — Score OCR always failing (even though Groq key works for name scanning)

**Symptom:** Photo upload → "Could not auto-read" every time, even though the same Groq key
successfully reads student names in the agent app.

**Root cause — 3 compounding issues:**

**Issue 1 (primary): `reasoning_format: 'hidden'` was missing from `_groqScoreOCR`**
Every other Groq call in the app (`groqVisionOCR` for names, fee ledger, AI-assist) had
`reasoning_format: 'hidden'`. The score OCR was the only exception. Without it, the Qwen3
model (`qwen/qwen3.6-27b`) writes its full chain-of-thought into the completion output before
producing JSON. That thinking can consume 1,000–3,000 of the 4,096 token budget. By the time
the model finishes reasoning about the grid structure, there's no room left for the actual
JSON — it truncates or Groq cuts it off. `_parseScoreOcrJson` gets empty/invalid content and
throws `"Groq returned 0 score entries"`.

**Issue 2: `max_tokens: 4096` too tight for score output**
A full broadsheet (11 students × 3 terms × 4 values = 132 numbers) serialised to JSON is
~500–900 tokens on its own. Combined with visible reasoning tokens, 4,096 was routinely
insufficient. Raised to **8,192**.

**Issue 3: Score prompt assumed a specific broadsheet layout**
`score_sheet_all` said: *"The sheet has THREE term blocks side by side: '1ST TERM', '2ND TERM',
'3RD TERM'."* If the uploaded photo shows only one term's scores (very common), the model
looks for a 3-column structure, fails to find it, and returns empty. Prompt rewritten to list
all common Nigerian formats and tell the model to adapt:
- Broadsheet (3 terms side by side)
- Single-term sheet (fill t1, zero t2/t3)
- Two-term sheet (fill t1/t2, zero t3)
- Portrait layout (terms stacked vertically)

**Bonus fix: Image resolution raised from 1,000px → 1,800px for score images**
Score sheets have small numbers in dense columns. Name lists have large text. The student name
OCR was fine at 1,000px; score numbers need the extra pixels. `resizeImageForOCR()` now accepts
an optional `maxPx` parameter; score OCR calls it with `1800`. Default for all other OCR
paths remains `1000`.

**What was NOT changed:** the OCR pipeline order, the Groq model, or the agent app.

**Commit:** `8872c9b`

---

### Improved OCR error messages
When score OCR fails, the status message now indicates the specific reason:
- No Groq key → directs to **Settings → API Keys**
- 401 / invalid key → "Groq API key rejected — go to Settings → API Keys and update it"
- 429 / rate limit → "wait a moment and try again"
- Groq empty response → "try a closer, well-lit photo with score columns clearly visible"
- Generic failure → shows the actual error message from Groq

---

### Standing rules (unchanged)
- Cache-bust every push: bump `?v=YYYYMMDD-descriptor` in index.html AND `CACHE_NAME` in sw.js
- `_isPremium()`: currently `return true` (TEMP BYPASS) — do not restore without Bayo go-ahead
- Password recovery: routes to Bayo/AariNAT only, never agents
- **Update README after every action, same session, no exceptions**


---

## 2026-08-10 — Strategic Decision: Basic Tier Eliminated

**Bayo's decision:** Basic tier completely eliminated. All schools are now Premium.
New slogan: **GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE**

> "We can't chase both basic and premium markets at the same time."

### Changes — `app.js`
- `_isPremium()` permanently returns `true` — the "TEMP BYPASS" comment replaced with
  the permanent rationale: *"All schools are Premium — basic tier eliminated per Bayo's
  decision 2026-08-10."* No conditional logic remains.
- All `_gateScan()` and feature-gate calls already pass through (since `_isPremium()` is
  always true). No other JS changes needed.

### Changes — `index.html`
- **Login subtitle** updated to: `GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE`
- **planBadge** — `plan-basic` class and "Basic" text removed; now `plan-premium` / "Premium"
- **Settings plan label** — "Current Plan: Basic" → "Plan: ✨ Premium" (green)
- **Finance AI label** — "Basic" → "Premium"
- **staff-upgrade div** — removed entirely (the "Upgrade to Premium for unlimited staff" block)
- **upgrade-modal** — removed entirely (both instances, including orphaned fragment)
- **"Upgrade to Premium" buttons** — removed from settings section and opportunity scout
- **opp-premium-cta** (opportunity scout upgrade prompt) — removed
- **premium nudge boxes** (ns, sf, exp, subj) — removed
- **opp-plan-badge "PREMIUM" span** — removed (redundant)
- **"How do I upgrade to Premium?"** FAQ entry — removed

### Commits
- `0cea5ec` — app.js: _isPremium permanent
- `64d0f23` — index.html: slogan + all premium UI cleanup


---

## 2026-08-11 — Finance AI Setup Agent (complete rebuild)

### Problem statement
The old Finance AI received 7 data points as context (school name, student count, 3 totals,
net, term). It could not answer specific questions because it had no salary data, no cash
position, no per-class breakdown, and no payment details. Proprietors were not intimidated by
the concept — they were intimidated by not knowing what to put in. The solution is an agent
that gathers the missing information conversationally, one question at a time.

---

### Data gaps audited and addressed

| Category | Was captured | Now captured |
|---|---|---|
| Fee per student | `totalFee` + `paid` ✅ | Same, plus per-class fee map (`classFees`) |
| Cash/bank balance | ❌ Nothing | `SD.config.cashBalance` + `cashBalanceDate` |
| Staff salaries | ❌ Nothing | `SD.staff[].salary` (monthly amount) |
| Salary pay date | ❌ Nothing | `SD.config.salaryPayDay` (day of month) |
| Per-class breakdown | ❌ Single flat fee | `SD.config.classFees` per class |
| Upcoming big expenses | ❌ Nothing | `SD.config.upcomingExpenses[]` (notes) |
| Finance AI context | 7-word string | Full structured brief (see below) |

---

### New: `_financeAudit()` — completeness checker
Checks 5 conditions: fee set, cash balance recorded, staff salaries set, pay date set,
students exist. Returns a `score` (0–100%). Progress bar in Finance section shows this score.

### New: `buildRichFinanceContext()` — full financial brief
Replaces the 7-word string. Now passes to the AI:
- Fee collection: expected, collected, outstanding, collection rate
- Per-class breakdown: every class with its own expected/collected/owed
- Top 6 defaulters by name, class, and balance
- Cash position with date of last entry
- Monthly payroll total and pay date
- Projected net after next payroll (cash + collected − expenses − salaries)
- Staff and individual salaries
- Expenses by category (sorted by amount)
- Upcoming expenses noted by proprietor

### New: `FSA` — Finance Setup Agent
Conversational wizard that gathers missing financial data without forms or overwhelm.

**Flow:**
1. Proprietor opens Finance section → completeness score checked
2. If < 100% and no prior data: `FSA.start()` auto-launches
3. Agent greets proprietor by first name (from staff records)
4. Asks ONE question at a time in this order:
   - Fee structure: "same for all classes or different?" → handles both paths
   - If "different": goes class by class ("Fee for JSS 1?", "Fee for JSS 2?", etc.)
   - Cash balance: "how much in bank and hand right now?"
   - For each staff member with no salary: "[Name]'s monthly salary?"
   - Salary pay date: "what day of month?"
5. Each answer is immediately saved to Firestore via `SQ.push()`
6. Progress bar updates after each answer
7. On completion: shows financial snapshot summary → loads dashboard

**Key UX decisions:**
- Never asks more than one thing at a time
- Accepts natural language ("end of month", "same", "different", "none")
- Shows what it calculated from each answer immediately (e.g. "✅ ₦35,000 set for all 11 students")
- "Skip setup — show dashboard" escape hatch always visible
- "🔄 Update Setup Info" button on dashboard to re-run anytime

### Upgraded: `runFinanceAgent()`
Now includes:
- Salary capacity check: compares (cash + collected) vs monthly payroll
- `canPaySalary` flag used in health cards
- Uses `buildRichFinanceContext()` for the AI insight prompt
- Richer BloomAgents log entry with cash and payroll data

### New: Finance health cards (4 cards in 2×2 grid)
- 💰 Fee collected vs target (colour-coded by %)
- 🏦 Cash balance with date
- ✅/🔴 Payroll capacity (green if safe, red if at risk)
- 📉 Expenses recorded

### New: Suggested questions (Finance dashboard)
Four one-tap question buttons:
- "Top defaulters"
- "Can I pay salaries?"
- "Worst-paying class"
- "Net position"

### Finance section layout (new states)
- **Setup state** (`#finance-setup`): chat UI with input, shown on first open if no data
- **Empty state** (`#finance-empty`): "Start Finance Setup" button, shown if explicitly dismissed
- **Dashboard** (`#finance-analysis`): stats + health cards + chat + suggested questions

### Commits
- `7d6d575` — app.js: FSA agent + rich context + upgraded runFinanceAgent
- `cb3e683` — index.html: setup chat UI + health cards + suggested questions panel


---

## 2026-08-11 — Navigation Rebuild: Sub-pages + Finance Quick Questions

### Problem
18 items in the nav tray with no grouping. Sports/Arts/Music/Health occupied prime spots
while Scores, Attendance, Student Profile, and Payroll had no dedicated pages at all —
they were buried as modals inside other sections. Hidden information the proprietor couldn't
find without knowing to look.

### Nav tray reorganised into 4 groups

```
STUDENTS        Revenue · Students · Profile · Scores · Attendance · Report Card
STAFF & FINANCE Staff · Payroll · Expenses · Finance AI
INSIGHTS        Analytics · Security · Agents · Scout
EXTRAS          Sports · Arts · Music · Health · Alumni · Comms
SYSTEM          Support · Settings
```

Group labels are styled dividers (uppercase, muted, non-interactive).

### New full-page: 👤 Profile (`sec-profile`)
- Tapping any student row now navigates to their full Profile page (`openProfilePage(idx)`)
  instead of the old quick-view modal
- 4 tabs: **Fees** (paid/owed/history + Record Payment), **Scores** (per-term per-subject),
  **Attendance** (last 20 days coloured present/late/absent), **SWOT**
- Edit button navigates back to Students and opens the edit modal
- Breadcrumb shows student name + class

### New full-page: 📝 Scores (`sec-scores`)
- Class selector + Subject selector + Term selector (all in one row)
- Shows every student's CA1 + CA2 + CA3 + Exam = Total with colour-coded grade badge
  (A/B/C/D/E/F)
- Class average shown per subject
- Tapping a student's name navigates to their Profile page
- **📸 Scan Scores** button → routes to Score OCR
- **⬇️ Export CSV** → downloads scores for selected class/term

### New full-page: 📅 Attendance (`sec-attendance`)
- Class selector + Date picker
- Each student has ✓ Present / L Late / ✗ Absent toggle buttons
- Running summary at top (X present, X absent, X late)
- **✅ All Present** one-tap button
- **💾 Save** → persists to `SD.students[].attendance[date]` and Firestore
- **⬇️ Export CSV** for the selected date

### New full-page: 💸 Payroll (`sec-payroll`)
- **Summary card**: monthly obligation, cash + collections vs payroll (green/red),
  salary pay date, "already run" banner if payroll ran this month
- **Staff list**: each member with name, role, and monthly salary.
  Missing salary → "Set salary" button → `promptSalary()` inline
- **▶ Run Payroll** button:
  - Confirms total and staff count
  - Logs `{month, date, total, records[]}` to `SD.config.payrollHistory`
  - Deducts from `SD.config.cashBalance` and updates `cashBalanceDate`
  - Saves to Firestore
  - Button disables for the rest of the month ("✅ Already Run")
- **Payroll History**: last 6 payroll runs with month, date, and total

### Finance AI: four one-tap question cards (2×2 grid)
Replaced the small ghost-button row with four large coloured tappable cards:

| Card | Colour | Question sent |
|---|---|---|
| 🔴 Top defaulters | Red | "Who are my top defaulters and exactly how much does each one owe?" |
| 💸 Can I pay salaries? | Green | "Can I pay staff salaries this month? Show collections vs payroll obligation." |
| 📚 Worst-paying class | Amber | "Which class has the worst fee collection rate and what should I do about it?" |
| 📊 Net position | Blue | "What is my net cash position after all salaries and expenses?" |

Each card has a bold label and a subtitle hint. Tapping fires `askFinanceQ(question)` which
pre-fills the input, scrolls the chat into view, and calls `askFinanceAI()` immediately —
one tap, no typing.

### Commits
- `1059e12` — app.js: go() dispatch + sub-page renderers + askFinanceQ + openProfilePage
- `2ce1d22` — index.html: nav groups + 4 new sections + Finance question cards


---

## 2026-08-12 — BloomCollect Zero-Cost: Bank Details Now in All Fee Reminders

### Context
BloomCollect bank registration was already built (Settings → enter bank name, account number,
account name → save). What was missing was those bank details actually appearing in the
WhatsApp messages sent to parents. That gap is now closed.

### What changed — `app.js` (commit `98ef9f5`)

**Three reminder paths upgraded — all now include bank details when set:**

**1. `sendReminder(idx)`** — individual student reminder from Revenue/Profile:
- New message format: school name header + fee summary (Total / Paid / Outstanding) +
  conditional payment block
- If bank details are set: shows Bank Name, Account Number, Account Name, and instructs
  parent to use **student's full name as reference**
- If no bank details: directs parent to visit school office
- If no phone number: copies message to clipboard instead of failing silently

**2. `renderBulkWA()`** — bulk reminder sequence (Send All Reminders):
- Same upgraded message format with bank details block
- Logs to comms record after each send

**3. Finance Agent automated reminders**:
- Same message format with bank details injected dynamically

### What a parent now receives (when bank is set):

```
*Future Promise Comprehensive College* — Fee Reminder 🌸

Dear Parent/Guardian of *ADAEZE OKONKWO* (JSS 2),

📋 *Fee Summary — Term 1*
Total Fee:   ₦35,000
Paid:        ₦15,000
Outstanding: ₦20,000

💳 *Payment Instructions*
Bank: GTBank
Account Number: 0123456789
Account Name: Future Promise College
Reference: ADAEZE OKONKWO

Please use your child's full name as the transfer reference so we can confirm
payment quickly.

Send your receipt/alert to this number after payment.

Thank you for your continued support. 🙏
– *Future Promise Comprehensive College*
```

### Why this IS BloomCollect (zero-cost version)
The school registers their account once in Settings. Every reminder sent to every
parent from that point forward includes bank details and a reference. Parents transfer
directly to the school's bank — no gateway, no 2.5% fee, no third-party involvement.
The school uploads their monthly bank statement CSV → app auto-reconciles by matching
the reference (student name) → student marked paid.

**Cost to school: ₦0. Cost to AariNAT: ₦0. Works with any Nigerian bank today.**

### Gateway version (future)
When AariNAT is ready to add Squad/Monnify/Paystack, a "Pay Now" link replaces the
bank transfer block in the same message. The architecture is already provider-agnostic —
the `payBlock` variable just needs a URL instead of bank details.


---

## 2026-08-12 — BloomCollect: Full Payment Link System Built

### Business decision (Bayo — 2026-08-12)
**Option B confirmed:** Parent pays school fee + processing surcharge on top. School always
receives its exact fee. Nothing deducted from school.

**Fee model:**
- Parent pays: school_fee + 2.5% (1.5% gateway + 1% AariNAT)
- School receives: exact school_fee (guaranteed via flat Paystack `transaction_charge`)
- AariNAT nets: ~1% of school_fee after gateway fees
- Example: ₦35,000 fee → parent pays ₦35,875 → school gets ₦35,000 → AariNAT gets ~₦237

### Files changed — 3 commits

**`app.js` (`d554eef`):**
- `calcParentCharge(schoolFee, gatewayRate, aarinatRate)` — calculates exact parent payment
- `getGatewayConfig()` — reads gateway config from `SD.config.bloomcollect`
- `sendPaymentLink(idx)` — full flow:
  - If gateway active + subaccount set → calls Cloud Function, gets Paystack URL, sends via WhatsApp
  - If gateway not active but bank details set → falls back to `sendReminder()` with bank transfer
  - If neither → guides user to Settings
- `saveGatewayDetails()` — saves gateway + public key when AariNAT activates for a school
- `💳 Send Link` button added to: defaulter rows in Revenue section + Student Profile Fees tab

**`index.html` (`59159ae`):**
- BloomCollect settings card rebuilt with:
  - "How It Works" explainer box (₦35,000 → parent pays ₦35,875 → school gets ₦35,000)
  - Step 1: Bank account registration (unchanged functionality)
  - Step 2: Gateway Payments — COMING SOON placeholder with 3-column fee split display
  - Fee split visual: Parent pays (Fee + 2.5%) | School gets (Full fee ✓) | AariNAT gets (1%)
  - Hidden gateway form (shown when AariNAT activates): gateway selector + public key field
- "Powered by Kora" removed — now "Powered by AariNAT" (gateway-agnostic)

**`functions/bloomcollect.js` (`284f5d5`) — NEW FILE:**
Three Firebase Cloud Functions ready to deploy:

1. `createSubaccount` — called once when school saves bank details:
   - Verifies account via Paystack NIP name enquiry
   - Creates Paystack subaccount for the school
   - Stores `subaccountCode` in `schools/{schoolId}/config.bloomcollect`
   - Creates record in `admin_bloomcollect/{schoolId}`

2. `createPaymentLink` — called when principal taps 💳:
   - Calculates parent charge (school_fee × 1.025)
   - Initialises Paystack transaction with flat split (school gets exact fee)
   - Returns `authorization_url` (the payment link)
   - Stores pending transaction in `admin_bloomcollect_txns/{txRef}`

3. `paystackWebhook` — Paystack calls this when parent pays:
   - Verifies HMAC signature
   - Marks student as paid in `schools/{schoolId}.students`
   - Adds payment to student's paymentHistory (method: 'BloomCollect')
   - Updates school's BloomCollect stats (totalVolume, aarinatEarnings, txCount)
   - Adds entry to `admin_bloomcollect_ledger` (AariNAT's revenue record)

### To activate for a school (when AariNAT has Paystack account):
1. `firebase functions:secrets:set PAYSTACK_SECRET_KEY` (once, for the project)
2. `firebase deploy --only functions:createSubaccount,createPaymentLink,paystackWebhook`
3. In Portal: add school's subaccount code to `schools/{schoolId}/config.bloomcollect`
   (or call `createSubaccount` function from portal when school registers bank)
4. Set `config.bloomcollect.functionUrl` in school's Firestore doc to the Cloud Function URL
5. School app auto-enables payment links — 💳 button becomes live

### Gateway flexibility
Paystack is the default. To switch to Squad (1% rate):
- Change `gatewayRate: 0.015` → `0.01` in the school's Firestore config
- Parent surcharge drops from 2.5% to 2%
- No code changes needed — the rate is read from Firestore

### Fintech pathway note (from business discussion 2026-08-12)
At 2,000 schools processing fees through BloomCollect:
- Annual fee flow: ~₦36B
- AariNAT 1% net: ~₦360M/year
- This is the revenue base for a PSSP licence application (₦100M capital requirement)
- The `admin_bloomcollect_ledger` collection is the financial record for that application


---

## 2026-08-15 — Branding Correction: Edu-BLOOM (not EduBloom / Educational Bloom)

**Issue identified:** The real logo uses "Edu-" in purple and "BLOOM" in orange. The codebase
had been using "EduBloom" (no hyphen, wrong caps) and "Educational Bloom" (wrong expansion
entirely) across all three apps and all WhatsApp message templates.

**Total replacements across all 6 files: 52**

| Wrong | Correct | Count |
|---|---|---|
| `Educational Bloom` | `Edu-BLOOM` | 17 |
| `EduBloom` | `Edu-BLOOM` | 35 |

**ID card canvas logo (portal_app.js):**
- Before: `ctx.fillStyle = '#ffffff'` → `fillText('Edu', ...)` + `ctx.fillStyle = '#f59e0b'` → `fillText('BLOOM', ...)`
- After: `ctx.fillStyle = '#7c3aed'` (purple) → `fillText('Edu-', ...)` + `ctx.fillStyle = '#f97316'` (orange) → `fillText('BLOOM', ...)`

The hyphen is now included. Logo baseline raised from y=55 to y=57 to accommodate 30px font (was 28px).


---

## 2026-08-16 — Edu-BLOOM User Manual (Personal + In-App)

### Why this was built
Bayo's request: "I need a manual — both personally and inside the app — where all features
are highlighted and explained in simple English so even an internet-illiterate person can understand."

---

### 1. Personal Manual — `EduBLOOM_School_App_Manual.docx` (commit `d846cd0`)

**32 pages. Branded in Edu-BLOOM colours (purple + orange). Professional layout with:**
- Header on every page: "Edu-BLOOM · School App User Manual · AariNAT Company Limited"
- Footer on every page: website, WhatsApp number, page number
- Cover page with Edu-BLOOM branding, tagline, AariNAT address, RC number, August 2026

**23 chapters covering every feature:**

| Chapter | Topic |
|---|---|
| How to Read This Manual | Symbol guide (💡 tip, ✅ note, ⚠️ warning) |
| 1 | Getting Started — First Login |
| 2 | The Menu — What Every Button Does |
| 3 | Revenue — Fee Tracking |
| 4 | Students — Managing Records |
| 5 | Student Profile — Complete Record |
| 6 | Scores — Entering and Viewing Marks |
| 7 | Score Sheet Scan — App Reads Marks Automatically |
| 8 | Attendance — Daily Register |
| 9 | Report Cards / Scorecard |
| 10 | Staff — Managing Teachers and Workers |
| 11 | Payroll — Staff Salaries |
| 12 | Expenses — Recording School Spending |
| 13 | Finance AI — Personal Money Advisor |
| 14 | BloomCollect — Fee Collection by WhatsApp |
| 15 | Safety Features (Absence Alert, Collector Check, Sign-Out Alert) |
| 16 | Opportunity Scout — Scholarships and Grants |
| 17 | Communications — Messaging Parents |
| 18 | Analytics |
| 19 | AI Agents |
| 20 | Sports, Arts, Music, Health, Alumni |
| 21 | Settings |
| 22 | Working Without Internet |
| 23 | Frequently Asked Questions (8 Q&As) |

**Writing style:**
- Zero technical jargon — "Groq", "Firestore", "OCR", "API" never appear
- Step-by-step instructions for every action (Step 1, Step 2...)
- 💡 Tips for shortcuts and best practices
- ✅ Notes confirming correct behaviour
- ⚠️ Warnings to prevent common mistakes
- Feature-explanation tables (Feature name | What it does in plain English)
- Sample WhatsApp messages shown as they actually appear to parents
- Written in Nigerian context (NAPPS, term dates, bank transfers, WAEC, etc.)

---

### 2. In-App Help System — `app.js` + `index.html` (commits `1bcc723`, `4ada61b`)

**Accessible from:** ❓ Support in the left menu (same section, now also shows help topics)

**Features:**
- 🔍 **Search bar** at the top — type any word (e.g. "fees", "scan", "absent") and matching topics filter instantly
- **18 help topics** as accordion cards — tap a topic to expand it, tap again to close
- **Topics covered:**
  🔑 Logging In · 🎓 Students · 💰 Fees · 📅 Attendance · 📝 Scores · 📸 Score Scan ·
  📋 Report Cards · 👤 Profile · 👥 Staff · 💸 Payroll · 📉 Expenses ·
  🤖 Finance AI · 💳 BloomCollect · 🔒 Safety · 📶 Offline · 🔍 Scout · 📢 Comms ·
  ⚙️ Settings · ❓ FAQ
- **Agent contact card** (rendered by existing `renderSupport()`) shown at the top so the principal can WhatsApp their agent or AariNAT directly
- **One section, no duplicates** — the old "Your Agent" support card was merged into the new Help section

**How it works technically:**
- `HELP_TOPICS` array (18 objects with `{id, emoji, title, tags[], body}`)
- `renderHelp()` — renders all topics as accordion cards into `#help-topics`
- `toggleHelp(id)` — opens/closes one topic; auto-closes all others (only one open at a time)
- `filterHelp(query)` — hides cards that don't match the search term (checks tags + title)
- `go('support')` now calls both `renderHelp()` and `renderSupport()`
