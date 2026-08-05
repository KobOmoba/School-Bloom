# EduBloom School Management Portal

**Production site:** [school.edubloom.com.ng](https://school.edubloom.com.ng)

## Latest Update — 2026-08-02 (2) — sw.js cache bump (same class of bug as bloom-portal)

**Context:** while debugging why Bayo kept seeing pre-fix behaviour on
`bloom-portal` after real pushes, root cause turned out to be the service
worker (`sw.js`) cache-first-serving the old app shell — `?v=N` on the
`<script>` tag does **not** bust it, since the SW caches by request URL,
not querystring. Full writeup in `bloom-portal`'s README.

**Checked School-Bloom for the same trap — found it.** `sw.js` here uses
the identical cache-first pattern and `CACHE_NAME` (`edu-bloom-v2`) hadn't
been bumped since before today's forgot-password push. That means the
`app.js`/`index.html` changes below may have been invisible to anyone who
already had School-Bloom open or installed as a PWA, even though the
correct code was already live on GitHub Pages.

**Fix:** bumped `CACHE_NAME` to `edu-bloom-v20260802-forgotpwd`. SW's
`activate` handler already deletes any cache not matching `CACHE_NAME`
and calls `skipWaiting()`/`clients.claim()`, so this alone forces a
refresh on next visit — no other code changes needed.

**Standing rule for next Claude:** any push touching `index.html`,
`app.js`, or `style.css` in an app that has a `sw.js` **must** also bump
that file's `CACHE_NAME` in the same push, or the fix is live on GitHub
but invisible to users. Check `bloom-agent`'s `sw.js` too before assuming
a push there is "live" — same pattern found there, not yet bumped as of
this writing (no bloom-agent changes were made today, so left as-is, but
flag it if you touch that repo next).

---

## Latest Update — 2026-08-02 (v20260802-forgotpwd) — Forgot password, everywhere a password is required

**Requested by Bayo:** "add forgotten password to everywhere password is
required and making it Retrievable." Staff passwords here are SHA-256
hashed (deliberate — Bayo confirmed this was done to close security
loopholes, see the Security section below), so a hash literally cannot be
turned back into the original password. **True retrieval isn't possible
without undoing that hashing, which Bayo did not want undone** — so the
secure equivalent (reset, not retrieve) was built at every point a
password exists in this app:

1. **Principal login** — `slForgotPassword()` already existed (opens
   WhatsApp with a prefilled message). **Fixed the routing**: it was
   messaging the school's **agent**, who has no way to actually reset
   anything — now goes straight to AariNAT/Bayo's number
   (`2348145073941`), the only person with the tool to fix it (see
   `bloom-portal`'s "🔑 Reset Password" button, that repo's README).
   Wording also corrected from "send my school password" (implies
   retrieval) to "reset my school password" (accurate).

2. **Staff (email + password) login** — had no forgot-password link at
   all. Added `slStaffForgotPassword()` + matching button. First tap
   shows an inline nudge to ask their Principal (who can now self-serve
   this, see #3). Second tap (or if the Principal's unreachable) opens
   WhatsApp to AariNAT directly — not the agent, same reasoning as #1.

3. **Staff tab (Principal-only)** — this was the real gap: a Principal
   had **no way at all** to reset a staff member's password if they
   forgot it, short of asking Claude/Bayo to hand-edit Firestore. Added
   **`resetStaffPassword(idx)`** + a "🔑 Reset Pwd" button next to each
   staff row (Principal-only, gated by both hiding the button for other
   roles and a `userRole !== 'Principal'` check inside the function
   itself). Prompts for a new password (min 4 chars), hashes it with the
   existing `_hashPassword()` — same function `addStaff()` already
   uses, so no new hashing path was introduced — saves it, then offers to
   WhatsApp the new password to that staff member directly. Works for any
   role including resetting a second Principal-role entry if one exists.

**Net effect:** every login screen in this app now has a working,
self-service-first path back in, without weakening the password hashing
Bayo asked to have in place.

### Commit
`app.js` (staff reset function + button, forgot-password routing fixes),
`index.html` (staff panel forgot-password link, cache bumped to
`?v=20260802-forgotpwd`).

---

## Latest Update — 2026-07-25 (v20260725e) — OCR resilience repair + premium gate status

### ⚠️ IMPORTANT: premium gate is currently bypassed, deliberately, by Bayo
`_isPremium()` in the live `app.js` reads `return true; /* TEMP BYPASS */`
right now — **every school has free premium access**. This is NOT what
the section below describes (that describes the *real*, intended logic).
Origin: commit `828f2e43` (2026-07-25, "TEMP: Force `_isPremium()` to
true — bypass premium gate for verification, restore after testing"). It
was flagged and a fix was prepared, but **Bayo explicitly stopped the
restore** — he's still using this bypass to verify Base44's OCR work
across premium-gated features. **Do not restore `_isPremium()` to its
real check without Bayo's direct go-ahead** — the correct code is
preserved below for whenever he says go:
```js
function _isPremium() { return (SD.config && SD.config.plan === 'premium') || (window._demoMode === true); }
```

### OCR audit against bloom-agent/bloom-agent-v2's proven implementations
Bayo asked whether every OCR path here has "the right prompt," using
bloom-agent as the reference. Found genuine inconsistency across the
three OCR tasks:
- **Name-reading** (`groqVisionOCR` + `GROQ_OCR_PROMPT`) — already solid,
  near-identical to bloom-agent's reference, full retry/backoff present.
- **Financial/ledger** (`_callGroqFeeVision` + `LEDGER_PROMPT`) — prompt
  confirmed byte-for-byte identical to bloom-agent-v2's. Was missing the
  `updateGroqRateState(resp)` call v2 has — **fixed**, ported
  `groqRateState`/`updateGroqRateState`/`parseGroqDuration` from v2 and
  wired the call into `callGroqVision()`.
- **Score-sheet OCR** (`_groqScoreOCR`) — this was the weak one. It had
  its own bare `fetch()` call instead of going through the shared
  `callGroqVision` helper: no `reasoning_effort:'none'`, no
  `response_format:json_object`, and **zero retry/backoff on 429/503** —
  a single failed request just threw, no recovery. **Fixed** — rewrote it
  to call `callGroqVision()` internally, same external signature and
  return contract (still returns a parsed array, still throws on 0
  entries), now gets all the same hardening as the other two paths for free.

### Commit
`app.js` (rate-state infra + score OCR rewrite), `index.html` (cache
bumped to `?v=20260725e`).

---

## Latest Update — 2026-07-25 (v20260725c) [previous entry]

### Codebase Port: v2 → Production
- Full codebase synchronization from `bloom-school-v2` sandbox to `School-Bloom` production repo
- `app.js` (7,393 lines) and `index.html` (1,598 lines) updated to latest v2 code

### Premium Gate System
- `_isPremium()` checks `SD.config.plan === 'premium'` or `window._demoMode === true`
- `_gateScan(prefix, scanInputId)` controls scan button visibility per modal
- `openM(id)` toggles scan button vs upgrade nudge based on premium status
- Free users see upgrade nudges; premium users see scan buttons
- Demo mode treated as premium for testing

### Security
- SHA-256 password hashing with auto-migration from plaintext

### Demo Mode
- Fully ephemeral — no data persistence
- Pre-populated with comprehensive sample data

### OCR Pipeline
- Uses Groq API with `qwen/qwen3.6-27b` model

### Cache-Busting
- Version: `?v=20260725c`


---

## Changelog

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
