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

