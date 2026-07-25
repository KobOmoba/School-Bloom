# EduBloom School Management Portal

**Production site:** [school.edubloom.com.ng](https://school.edubloom.com.ng)

## Latest Update — 2026-07-25 (v20260725c)

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
