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

