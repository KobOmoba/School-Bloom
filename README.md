# EduBloom School Management Portal

**Production site:** [school.edubloom.com.ng](https://school.edubloom.com.ng)

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
