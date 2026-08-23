# School-Bloom — Production School Portal

**Domain:** school.edubloom.com.ng
**Repo:** School-Bloom
**Last updated:** 2026-08-23

---

## App Overview

Vanilla JS/HTML PWA. School staff manage fees, attendance, scores, expenses, staff, safety, and reports.
Firebase Firestore for data. Offline-first with localStorage cache + SQ sync queue.
No Firebase Auth — schools log in with School ID + staff email/password (custom RBAC).

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
| app.js | `?v=20260823-makeover` |
| sw.js CACHE_NAME | `edubloom-School-Bloom-20260823-makeover` |

---

## Session History

### 2026-08-23 — Syntax repair + lessons dropdown fix

Five commits pushed to production directly:
- `fix(syntax)`: Collapsed duplicate teaching-tools blocks and cleaned template
  literals that were causing node parser issues (pre-existing browser-only pattern)
- `fix(lessons)`: Class/Subject dropdowns now always repopulate when the lessons
  section is shown — previously showed stale or empty options on second visit
- Cache bumped: `?v=20260823-makeover` | CACHE_NAME bumped to match

Note: these commits went directly to production without sandbox-first.
Backport to school-bloom-v2 pending.

---

### 2026-08-20 — Security Audit (XSS fixes + structural HTML fix)

Critical structural bug fixed: index.html had a premature `</body></html>` at
line 1329 with app.js loading twice. Removed. Single versioned load now.
XSS: `bannerEl.innerHTML` on line 2537 — `esc(name/userRole/classInfo)` applied.
Cache bumped to `20260820-security`.

---

### 2026-08-20 — Health Data Compliance (sandbox school-bloom-v2)

AES-256-GCM encrypted health records, Principal-only RBAC, audit logging built
in school-bloom-v2 sandbox. Pending Bayo's go-ahead to port to production.
See school-bloom-v2/HEALTH_DATA_COMPLIANCE.md.

---

## Firestore Rules — CORRECTLY PUBLISHED ✅

Published Aug 19, 2026 at 7:10 AM. Correct. No changes needed.

| Collection | Access |
|-----------|--------|
| admin_agents | public read, Bayo-only write |
| admin_deals | public read + create, Bayo-only update/delete |
| admin_ledger | public read, Bayo-only write |
| public_ocr_keys | public read, Bayo-only write |
| admin_opportunities | public read, Bayo-only write |
| admin_agent_requests | public create, Bayo-only read/update/delete |
| admin_alerts | public create, Bayo-only read/update/delete |
| admin_settings / admin_cac / admin_activity / admin_approved_schools | Bayo-only |
| schools/{schoolId} | open read/write (per-school auth deferred) |

---

## Standing Notes

- `_isPremium()` hardcoded `true` — TEMP BYPASS, do not relock without explicit go-ahead
- OCR: Groq Vision `qwen/qwen3.6-27b` primary → HuggingFace fallback → OCR.space last resort
- Sandbox-first rule: new features go to school-bloom-v2 before production
- node --check fails on this file at line ~10030 (pre-existing browser-only template literal) — not a bug
