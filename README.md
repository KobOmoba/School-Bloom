# School-Bloom — Production School Portal

**Domain:** school.edubloom.com.ng
**Repo:** School-Bloom
**Last updated:** 2026-08-24

---

## Current Versions

| File | Version |
|------|---------|
| app.js | `?v=20260824-probe-fix` |
| sw.js CACHE_NAME | `edubloom-School-Bloom-20260824-probe-fix` |

---

## Session History

### 2026-08-24 — Fix: false offline indicator on Nigerian 4G

**Problem:** App showed "● Offline" despite active internet connection.

**Root cause:** `SQ.ping()` was probing `firestore.googleapis.com` directly via
fetch with an 8-second timeout. On Nigerian 4G, high latency routes caused the
timeout to fire before any response arrived. The AbortError went to `.catch()`,
which showed "● Offline" or "● Limited" even though the network was live.

**Fix:**
- Replaced Firestore REST probe with `https://connectivitycheck.gstatic.com/generate_204`
  — the standard Android/Chrome connectivity check URL. Returns 204, faster,
  lighter, works on all Nigerian networks, Brave-safe.
- Added `mode: 'no-cors'` — avoids CORS errors entirely. Fetch resolves in
  `.then()` with an opaque response, which is enough to prove network is reachable.
- Timeout raised from 8 s to 15 s — accommodates Nigerian 4G high-latency routes.
- Added `navigator.onLine === false` fast-path — if device radio is off (airplane
  mode, no SIM), skip the probe and show "● Offline" immediately. This case is
  reliable unlike `navigator.onLine === true`.

---

### 2026-08-24 — Firebase + SW offline reliability fixes

- SW: CDN URLs removed from SHELL_ASSETS (install no longer fails offline)
- Firebase: AutoDetectLongPolling replaces experimentalForceLongPolling
- Firestore ping: probes Firestore directly in go(home) / startApp
- SW: auto-reload on new service worker via SW_UPDATED + controllerchange
- Cache bumped to 20260823c

---

### 2026-08-23 — Syntax repairs + lessons dropdown + SW auto-reload

- Duplicate teaching-tools blocks removed; broken template literals repaired
- Lessons dropdown: Class/Subject selects always repopulate on section open
- SW auto-reload notification on activate
- Multiple cache bumps: 20260823-makeover → 20260823b-fix → 20260823c

---

### 2026-08-22 — Syntax repairs

generateLessonNote, generateQuestions, broken strings and regex repaired.

---

### 2026-08-20 — Security audit (Claude session)

- Structural HTML fix: premature </body></html> at line 1329 removed (app.js was loading twice)
- XSS: esc(name/userRole/classInfo) applied to bannerEl.innerHTML

---

## Firestore Rules — CORRECTLY PUBLISHED ✅

Published Aug 19, 2026 at 7:10 AM. Correct. No changes needed.

---

## Standing Notes

- `_isPremium()` hardcoded `true` — TEMP BYPASS, do not relock without explicit go-ahead
- OCR: Groq Vision `qwen/qwen3.6-27b` primary → HuggingFace → OCR.space last resort
- Aug 22/23/24 commits went directly to production — not sandbox-first
- school-bloom-v2 sandbox is behind production and needs backport
- node --check excluded (pre-existing browser template literal at ~line 10030)
- Full project state: bloom-portal/PROJECT_STATE.md
