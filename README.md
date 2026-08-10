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
