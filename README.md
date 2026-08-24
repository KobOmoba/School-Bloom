# School-Bloom — Production School Portal

**Domain:** school.edubloom.com.ng
**Repo:** School-Bloom
**Last updated:** 2026-08-24

---

## App Overview

Vanilla JS/HTML PWA. School staff manage fees, attendance, scores, expenses, staff, safety, and reports.
Firebase Firestore for data. Offline-first with localStorage cache + SQ sync queue.
No Firebase Auth per school — login via School ID + staff email/password (custom RBAC).

---

## Current Versions

| File | Version |
|------|---------|
| app.js | `?v=20260823c` |
| sw.js CACHE_NAME | `edubloom-School-Bloom-20260823c` |

---

## Session History

### 2026-08-24 — Firebase + SW offline reliability fixes (direct production)

Three commits pushed directly to production:
- `fix(sw)`: Removed CDN URLs (gstatic.com Firebase SDK) from SHELL_ASSETS —
  service worker install was failing when CDN unreachable offline. Firebase SDK
  now loaded from network only (not pre-cached), which is correct behaviour.
- `fix(firebase)`: Switched from `experimentalForceLongPolling` to `AutoDetectLongPolling`.
  Also added simple Firestore ping in `go(home)` / `startApp` to trigger connection.
  Fixes "offline" indicator on Nigerian 4G where navigator.onLine returns true
  but Firestore socket is not yet connected.
- Cache bumped to `20260823c` after these fixes.

---

### 2026-08-23 — Syntax repairs + lessons dropdown + SW auto-reload (direct production)

- `fix(syntax)`: Collapsed duplicate teaching-tools blocks, cleaned broken template literals
- `fix(lessons)`: Class/Subject dropdowns always repopulate when lessons section opens
- `fix(sw)`: SW notifies clients on activate → page auto-reloads on new SW
- `fix(sw)`: Listens for SW_UPDATED + controllerchange → auto-reload
- `fix(ping)`: Probes Firestore directly instead of navigator.onLine (fixes Nigerian 4G false offline)
- Multiple CACHE_NAME bumps: 20260823-makeover → 20260823b-fix → 20260823c

---

### 2026-08-22 — Syntax repairs (direct production)

- `fix(syntax)`: Repaired generateLessonNote + generateQuestions (broken string concatenation)
- `fix(syntax)`: Fixed systemMsg apostrophe + broken regex — Enter Portal + Try Demo restored
- `fix(syntax)`: Iterative repair of all broken strings

---

### 2026-08-20 — Security audit (Claude session)

- Structural HTML fix: removed premature `</body></html>` at line 1329 (app.js loaded twice)
- XSS: `esc(name/userRole/classInfo)` applied to `bannerEl.innerHTML` line 2537
- Cache bumped to `20260820-security` (since superseded by Aug 23/24 commits)

---

## Firestore Rules — CORRECTLY PUBLISHED ✅

Published Aug 19, 2026 at 7:10 AM. Correct. No changes needed.
See bloom-portal/PROJECT_STATE.md Section 5 for full collection access map.

---

## Standing Notes

- `_isPremium()` hardcoded `true` — TEMP BYPASS, do not relock without explicit go-ahead
- OCR: Groq Vision `qwen/qwen3.6-27b` primary → HuggingFace → OCR.space last resort
- Aug 22/23/24 commits went directly to production — not sandbox-first
- school-bloom-v2 sandbox is behind production and needs backport
- node --check excluded for this file (pre-existing browser template literal at ~line 10030)
- Full project state: bloom-portal/PROJECT_STATE.md
