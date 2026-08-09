# EduBloom School Management Portal

**Production site:** [school.edubloom.com.ng](https://school.edubloom.com.ng)

## Latest Update — 2026-08-09 — Step 4 Complete: Full port from bloom-school-v2 to production

**Step 4 of the roadmap executed.** Firestore security rules confirmed published by Bayo
(Step 3 screenshot verified) → port immediately executed.

**What was ported (verbatim code-for-code from bloom-school-v2, zero deviations):**

- `app.js` (8,384 lines) — verbatim copy from `bloom-school-v2` as of 2026-08-08
- `index.html` (1,649 lines) — verbatim copy from `bloom-school-v2`, only `?v=` bumped
- `style.css` — verbatim copy from `bloom-school-v2`
- `sw.js` — production file unchanged except `CACHE_NAME` bumped to `edu-bloom-v20260809-step4port`

**What this brings to production (everything built and proven in the sandbox):**

- **V2 subcollection data model** — students, scores, fees now stored as separate
  Firestore sub-documents per student, per term, per subject. Enables proper
  per-role data isolation enforced by the new Firestore security rules.
- **OCR Engine v2** — schema-driven architecture (`OCR_SCHEMAS`, `buildOcrPrompt`).
  One engine, all document types. 800px resize + 4096 max_tokens + `reasoning_format:'hidden'`
  throughout. Per-field retry system for student scans.
- **Firebase Auth for staff** — `staffLoginV2` + `claimStaffAccountV2`. Each staff
  member claims their own Firebase Auth account once; legacy password hash login
  remains as fallback during transition.
- **Role-based nav whitelist** (`ROLE_TABS`, `ROLE_NORMALISE`, `_normRole()`,
  `applyRoleRestrictions()`) — full whitelist model. Legacy role strings
  (e.g. `teacher`) normalised to canonical keys at all login paths.
- **`hydrateFromV2()`** — sole read path on login. Loads subcollection data back
  into the existing in-memory shape — all render functions unchanged.
- **`deleteStudentV2`** — cascade delete (profile + private/fees + all score docs).
- **Aug 8 fixes** — `loadAllStudentsV2` class filter (Class Teacher only sees
  their class), `hydrateFromV2` empty-override protection, `addStaff` Firebase
  Auth sign-out (prevents replacing Principal session), role context banner in
  Students view, Principal silent Firebase Auth sign-in.
- **Promotion report card** — Annual promotion tab + `printPromotionReportCard()`.
- **Report card theme picker** — Classic / Bold themes in Settings.
- **Score validation** — `_capScoreEntry()`, `_hasScoreEntry()`, overflow flags,
  all 7 edge cases stress-tested and passing.
- **Staff forgot-password** — `sendStaffPasswordReset()` via Firebase Auth email.
- **`_isPremium()` bypass** — still `return true` (TEMP BYPASS, in sync with
  sandbox). Do NOT restore real plan check without Bayo's explicit go-ahead.

**Cache-busting:** `?v=20260809-step4port` on `app.js` in `index.html`.
`CACHE_NAME` bumped to `edu-bloom-v20260809-step4port` in `sw.js`.

---

## 📍 Current Position — 2026-08-09

### ✅ STEP 4 COMPLETE — Production is now running bloom-school-v2 codebase

### What to verify on device (school.edubloom.com.ng)
- Hard-refresh (clear site data) on Brave/Chrome then open the portal
- Enter Portal with an existing School ID → should hydrate from V2 subcollections
- Add a student → check Firestore console for `schools/{id}/students/{sid}` doc
- Enter scores → check `schools/{id}/students/{sid}/scores/Term1_Mathematics` doc
- Staff claim account → log in as staff → confirm role-based nav whitelist applies
- OCR scan → confirm 800px resize + Groq returns JSON correctly

### What's still deferred (from bloom-school-v2 README)
- **HuggingFace cascade** — `_callHFGenericVision` + `_callScanCascade` dormant.
  Wire up when HF connectivity confirmed.
- **New OCR schemas with UI** — subjects, staff, alumni, expenses, sports_roster
  schemas registered in `OCR_SCHEMAS`, just need UI buttons wired.
- **OCR Service (PaddleOCR VPS)** — `edubloom-ocr-service` built and ready.
  Bayo provisions Oracle Cloud VM, runs `deploy.sh`, adds URL to
  `admin_settings/main.ocrServiceUrl`. No code changes needed.
- **Delete old `v2_schools` collection** — orphaned. Delete from Firebase Console.
- **Delete second Firebase web app** (`appId: 0f9d338f`) — orphaned after API key
  consolidation. Delete from Firebase Console → Project Settings → Your Apps.
- **Relock `_isPremium()`** — Bayo's call when premium verification is complete.

---

## Previous Updates

### 2026-08-05 — Collection rename + API key consolidation

**`v2_schools` → `schools` rename (7 occurrences)**
All Firestore collection references renamed from `v2_schools` to `schools`.
- Aligns v1 with the portal (which has always written approved schools to `schools`) and with bloom-school-v2 sandbox
- Previously, a new school approved via portal landed in `schools` but v1 read from `v2_schools`, causing a bootstrap detour on every first login
- Safe to do now: no real school data existed in Firestore yet
- All four apps (portal, v1 school, v2 sandbox, agent) now read and write the same collection

**Firebase API key consolidated**
- school-bloom already used the original single registration (`appId: 2b3da887`)
- No change needed here; documented for completeness

---

## Latest Update — 2026-08-02 (2) — sw.js cache bump

**Context:** while debugging why Bayo kept seeing pre-fix behaviour on
`bloom-portal` after real pushes, root cause turned out to be the service
worker (`sw.js`) cache-first-serving the old app shell — `?v=N` on the
`<script>` tag does **not** bust it, since the SW caches by request URL,
not querystring. Full writeup in `bloom-portal`'s README.

**Standing rule for next Claude:** any push touching `index.html`,
`app.js`, or `style.css` in an app that has a `sw.js` **must** also bump
that file's `CACHE_NAME` in the same push, or the fix is live on GitHub
but invisible to users. Check `bloom-agent`'s `sw.js` too before assuming
a push there is "live" — same pattern found there, not yet bumped as of
this writing (no bloom-agent changes were made today, so left as-is, but
flag it if you touch that repo next).

---

## Latest Update — 2026-08-02 (v20260802-forgotpwd) — Forgot password

See previous changelog for full details on:
1. Principal login → routes to AariNAT (`2348145073941`)
2. Staff login → forgot-password link added
3. Staff tab → `resetStaffPassword(idx)` Principal-only reset button

---

## 📌 Standing Rules (never skip)

- **Cache-bust:** every push touching `app.js`, `index.html`, or `style.css`
  must bump `?v=YYYYMMDD-descriptor` in `index.html` AND `CACHE_NAME` in `sw.js`
- **Verbatim port:** when porting between v2 and v1, copy code exactly as written —
  no initiative, no unrequested changes
- **`_isPremium()`:** currently `return true` (TEMP BYPASS). Do not restore
  `SD.config.plan === 'premium'` without Bayo's explicit go-ahead
- **Password recovery:** routes to Bayo/AariNAT (`2348145073941`) only, never agents
- **README:** update after every push, same session, no exceptions
