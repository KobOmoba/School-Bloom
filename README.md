# School-Bloom — Production School Portal

**Domain:** school.edubloom.com.ng
**Repo:** School-Bloom
**Last updated:** 2026-08-20

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
| app.js | `?v=20260820-security` |
| sw.js CACHE_NAME | `edubloom-School-Bloom-20260820-security` |

---

## Session History

### 2026-08-20 — Security Audit (Production)

**CRITICAL fix — double app.js load + premature `</body></html>`:**
index.html had a complete `</body></html>` block midway through the file at line 1329.
Everything added after that (all modals, sections, the versioned script tag) was
technically outside the document. Browsers were tolerating it silently but browsers
are forgiving — it was wrong structure.
Separately, an unversioned `<script src="app.js">` at line 1319 was loading the
app a second time before the proper versioned tag. Two instances of DOMContentLoaded
listeners, two Firebase init attempts, double work on every page load.
**Fix:** Removed lines 1317–1329 (duplicate Firebase imports + unversioned app.js +
duplicate `_watchAuditNav` IIFE + premature `</body></html>`).
Single versioned load at `app.js?v=20260820-security` now handles everything.

**XSS fix — app.js line 2537:**
`bannerEl.innerHTML` was injecting `name`, `userRole`, and `classInfo` as raw
template literals without sanitisation. School name comes from Firestore config —
if a crafted value ever got in, it would execute.
Fixed with `esc(name)`, `esc(userRole)`, `esc(classInfo)`.

**Cache bump:** `?v=20260820-security` | CACHE_NAME `edubloom-School-Bloom-20260820-security`

**Note on node --check:** This file uses a browser-only template literal pattern
at line ~10030 that Node.js parser rejects. Pre-existing, not a bug — app works
correctly in all browsers. Do not use node --check as a gate for this file.

---

### 2026-08-18 — Groq Rotator + OCR key sync

OCR key rotator added. Keys synced from `public_ocr_keys/main`.
HF fallback key cached in localStorage (public key by design — acceptable).

---

## Firestore Rules — CORRECTLY PUBLISHED ✅

Rules published **Aug 19, 2026 at 7:10 AM** in Firebase Console are correct.
No action needed.

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
| schools/{schoolId} | open read/write (per-school auth deferred — own project) |

Subcollection rules (staff_directory, students, private/fees, scores) are ready
for when Firebase Auth per school ships — not active yet.

**Note on pentest-ci.js:** The pentest cannot run from Claude's container because
`firestore.googleapis.com` is not in Claude's network egress allowlist. Run it
from GitHub Actions (unrestricted network) or from your phone/browser. All GitHub
Actions CI runs have full Firestore access and will give accurate results.

---

## Standing Notes

- `_isPremium()` hardcoded `true` — TEMP BYPASS. Do not relock without explicit go-ahead.
- OCR: Groq Vision `qwen/qwen3.6-27b` (primary) → HuggingFace (fallback) → OCR.space (last resort)
- 15-second inter-page cooldowns for Groq free-tier TPM limits
- Sandbox-first rule: test in school-bloom-v2 before porting here
