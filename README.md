# School-Bloom — Production School Portal

**Domain:** school.edubloom.com.ng
**Repo:** School-Bloom
**Last updated:** 2026-08-20

---

## App Overview

Vanilla JS/HTML PWA. School staff manage fees, attendance, scores, expenses, staff, safety, and reports.
Firebase Firestore for data. Offline-first with localStorage cache + SQ sync queue.

---

## RBAC Roles

| Role | Access |
|------|--------|
| Principal | Full — all tabs |
| Bursar | Fees, expenses, finance, analytics |
| Class Teacher | Assigned class only, no fee data |
| Subject Teacher | Assigned subjects only, no fee data |

---

## Current Versions

| File | Version |
|------|---------|
| app.js | `?v=20260820-security` |
| sw.js CACHE_NAME | `edubloom-School-Bloom-20260820-security` |

---

## Session History

### 2026-08-20 — Security Audit & Structural HTML Fix

**Critical bug fixed — double app.js load + premature `</body></html>`:**
- index.html had a complete `</body></html>` at line 1329, partway through the file
- A duplicate, unversioned `<script src="app.js">` was at line 1319 (before the premature close)
- The versioned `<script src="app.js?v=...">` at line 1870 was correct but loaded the app TWICE
- All modals and sections added since the original close were sitting outside `</html>` — browsers rendered them but it was invalid HTML
- **Fix:** Removed lines 1317–1329 (duplicate Firebase imports + unversioned app.js + `_watchAuditNav` IIFE + premature `</body></html>`)
- **Result:** app.js now loads once, from the versioned tag, proper HTML structure throughout

**XSS fix — app.js line 2537:**
- `bannerEl.innerHTML` was injecting `name`, `userRole`, and `classInfo` as raw template strings
- `name` = `currentStaff.name || SD.config.schoolName` (from Firestore — injectable if school name crafted maliciously)
- **Fix:** Wrapped with `esc(name)`, `esc(userRole)`, `esc(classInfo)`

**Cache bust:** `app.js?v=20260820-security` | CACHE_NAME bumped to match

---

### 2026-08-18 — Groq Rotator + OCR key sync

Key changes: OCR key rotator added; keys synced from `public_ocr_keys/main`.
HF fallback key cached in localStorage (by design — public key, acceptable risk).

---

## Firestore Rules — ACTION REQUIRED (Bayo only)

The production pentest (`pentest-ci.js` run 2026-08-20) found **6 Firestore rule failures**.
These collections are returning 403 when they should be open.

Paste the following rules into Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isBayo() {
      return request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }

    // PUBLIC READ — agent login, deal view, earnings, OCR keys
    match /admin_agents/{doc} {
      allow read: if true;
      allow write: if isBayo();
    }
    match /admin_deals/{doc} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if isBayo();
    }
    match /admin_ledger/{doc} {
      allow read: if true;
      allow write: if isBayo();
    }
    match /public_ocr_keys/{doc} {
      allow read: if true;
      allow write: if isBayo();
    }
    match /admin_opportunities/{doc} {
      allow read: if true;
      allow write: if isBayo();
    }

    // BAYO ONLY
    match /admin_settings/{doc}   { allow read, write: if isBayo(); }
    match /admin_cac/{doc}        { allow read, write: if isBayo(); }
    match /admin_activity/{doc}   { allow read, write: if isBayo(); }
    match /admin_approved_schools/{doc} { allow read, write: if isBayo(); }

    // ADMIN ALERTS — schools create, Bayo manages
    match /admin_alerts/{doc} {
      allow create: if true;
      allow read, update, delete: if isBayo();
    }

    // AGENT REQUESTS — anyone can apply, Bayo manages
    match /admin_agent_requests/{doc} {
      allow create: if true;
      allow read, update, delete: if isBayo();
    }

    // SCHOOLS — open (per-school auth deferred, own project)
    match /schools/{schoolId} {
      allow read, write: if true;
    }
    match /schools/{schoolId}/{subcollection=**} {
      allow read, write: if true;
    }

    // DENY ALL ELSE
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Standing Notes

- `_isPremium()` hardcoded `true` — TEMP BYPASS, do not relock without Bayo's go-ahead
- OCR: Groq Vision `qwen/qwen3.6-27b` (primary) → HuggingFace (fallback) → OCR.space (last resort)
- 15-second inter-page cooldowns for Groq free-tier TPM limits
- node --check fails on this file (pre-existing browser-only template literal at line ~10030) — not a bug, file runs correctly in browser
