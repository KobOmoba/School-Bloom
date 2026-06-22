// ═══════════════════════════════════════════════════════════════════════
// EDUCATIONAL BLOOM — app.js (MERGED: v1 base + v2 extras)
// Term-based scoring (CA1/CA2/CA3/Exam) is the canonical data model.
// OCR uses full fallback chain: Gemini → OCR.space → Tesseract.
// AI Tools / Voice Agent now use Gemini (see index.html inline scripts).
// ═══════════════════════════════════════════════════════════════════════

// ── Firebase ───────────────────────────────────────────────────────────────
const FB = {
  apiKey: "AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",
  authDomain: "educationbloom-699ed.firebaseapp.com",
  projectId: "educationbloom-699ed",
  storageBucket: "educationbloom-699ed.firebasestorage.app",
  messagingSenderId: "33750392965",
  appId: "1:33750392965:web:2b3da887ede996ea8389ec"
};
let db = null;
try {
  const fbApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(FB);
  db = firebase.firestore(fbApp);
  db.settings({ experimentalForceLongPolling: true, merge: true });
  db.enablePersistence({ synchronizeTabs: true })
    .then(() => console.log('✅ Offline persistence enabled'))
    .catch(err => {
      if (err.code !== 'failed-precondition' && err.code !== 'unimplemented')
        console.warn('Persistence error:', err.code);
    });
  console.log('✅ Firebase ready');
} catch (e) {
  console.error('❌ Firebase init failed:', e.message);
}

// ── Pricing Tiers ────────────────────────────────────────────────────────
const TIERS = [
  { name: 'Small (1–50)', max: 50, price: 10000 },
  { name: 'Medium (51–100)', max: 100, price: 20000 },
  { name: 'Large (101–200)', max: 200, price: 35000 },
  { name: 'Extra Large (201–350)', max: 350, price: 55000 },
  { name: 'Unlimited (351+)', max: 999999, price: 75000 }
];
function getTier(count) {
  return TIERS.find(t => count <= t.max) || TIERS[TIERS.length - 1];
}

// ── Gemini Flash OCR (Structured Outputs) — PRIMARY OCR ──────────────────
// Key stored encoded; managed via AariNAT Command Center Settings
const GEMINI_KEY  = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';  // Set via settings or key prompt
const GEMINI_MODELS = ['gemini-2.0-flash','gemini-2.0-flash-exp','gemini-1.5-flash','gemini-1.5-flash-latest'];

const GEMINI_PROMPT = `You are reading a Nigerian primary/secondary school fee register.
The register has columns: SERIAL NO | SURNAME | FIRST NAME | (fee columns).
The image may be rotated — read it in any orientation.

Your job: extract EVERY student's name as SURNAME + FIRSTNAME pairs.

Nigerian name examples from this type of school:
- Surnames: OGUNLADE, KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE, OLAWALE, ODEREYE, AKINDELE, ADEBAYO, AYANRINDE, SHONPE, OLATUNDE, GBELEKALE, FAFIOLU, OLIYIDE, KOLANOLE, ADEGUNLE, ADEOYE, SABIU, JOHN, LAWAL, OLOOТУ, AYOMIDE, OGUNSOLA, OLOWU, AFOLAБИ, IYELABOYE, OKEIOLUНMI, OBASA
- Firstnames: GABRIEL, RASAQ, GODWIN, ENOCH, ABIGEAL, KOREDE, MICHEAL, ADEMIDE, AMIDAT, WIQUYAT, ISREAL, DORCAS, MARYAM, MUSTEQEEM, AMINAT, CYNTHIA, ELIZABETH, TIRESIMI, WASILAT, DEBORAH, SHINDARA

Rules:
1. Each row in the register = one student. Read ALL rows.
2. Ignore: CLASS, SERIAL NO, NAMES (header), BALANCE, FROM LAST TERM, numbers, dates
3. Do NOT split a single student into two entries
4. If handwriting is unclear, make your BEST guess at the Nigerian name
5. Return surname and firstname SEPARATELY

Return ONLY valid JSON.`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    students: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          surname:   { type: 'STRING' },
          firstname: { type: 'STRING' },
          fullName:  { type: 'STRING' }
        },
        required: ['surname','firstname','fullName']
      }
    }
  },
  required: ['students']
};

async function geminiOCR(base64, mime) {
  // Re-read key at call time (may have been set via the key prompt after page load)
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || GEMINI_KEY;
  if (!apiKey) throw new Error('No Gemini key set — skipping to fallback');
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: GEMINI_PROMPT }
          ]}],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: GEMINI_SCHEMA
          }
        })
      });
      const d = await r.json();
      if (d.error) {
        lastError = d.error.message || 'Gemini error';
        if (d.error.code === 404 || d.error.status === 'NOT_FOUND') continue;
        throw new Error(lastError);
      }
      const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '{"students":[]}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const students = parsed.students || [];
      console.log(`✅ Gemini OCR (${model}): ${students.length} names`);
      return students;
    } catch (e) {
      lastError = e.message;
      console.warn(`Gemini ${model} failed:`, e.message);
    }
  }
  throw new Error('All Gemini models failed: ' + lastError);
}


// ── OCR Upload Overlay ──────────────────────────────────────────────────
function ocrOverlayShow(filename) {
  const el = document.getElementById('ocr-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Reset all steps
  ['load','upload','read','done'].forEach(s => {
    const icon = document.getElementById(`ocr-step-${s}-icon`);
    const text = document.getElementById(`ocr-step-${s}-text`);
    const row  = document.getElementById(`ocr-step-${s}`);
    if (icon) icon.textContent = { load:'⏳', upload:'☁️', read:'🔍', done:'✅' }[s];
    if (row)  row.style.color = '#94a3b8';
  });
  const bar = document.getElementById('ocr-bar');
  if (bar) bar.style.width = '0%';
  const fn = document.getElementById('ocr-filename');
  if (fn) fn.textContent = filename || 'image';
  const st = document.getElementById('ocr-status');
  if (st) st.textContent = 'Preparing...';
  const pg = document.getElementById('ocr-pages');
  if (pg) { pg.style.display = 'none'; pg.textContent = ''; }
  // Hide thumb until we have data
  const tw = document.getElementById('ocr-thumb-wrap');
  if (tw) tw.style.display = 'none';
}

function ocrOverlayThumb(dataUrl) {
  const img = document.getElementById('ocr-thumb');
  const wrap = document.getElementById('ocr-thumb-wrap');
  if (!img || !wrap) return;
  // Only show thumb for image types
  if (dataUrl && dataUrl.startsWith('data:image')) {
    img.src = dataUrl;
    wrap.style.display = 'block';
  }
}

function ocrOverlayStep(step, status, progress) {
  // step: 'load' | 'upload' | 'read' | 'done' | 'error'
  const bar = document.getElementById('ocr-bar');
  const st  = document.getElementById('ocr-status');
  if (bar && progress !== undefined) bar.style.width = progress + '%';
  if (st  && status)  st.textContent = status;

  const stepMap = { load: 0, upload: 1, read: 2, done: 3 };
  const stepIdx = stepMap[step] ?? -1;
  ['load','upload','read','done'].forEach((s, i) => {
    const icon = document.getElementById(`ocr-step-${s}-icon`);
    const row  = document.getElementById(`ocr-step-${s}`);
    if (!icon || !row) return;
    if (i < stepIdx)      { icon.textContent = '✅'; row.style.color = '#4ade80'; }
    else if (i === stepIdx) {
      if (step === 'error') { icon.textContent = '❌'; row.style.color = '#f87171'; }
      else { icon.textContent = '🔄'; row.style.color = '#818cf8'; }
    }
    else { row.style.color = '#94a3b8'; }
  });
  if (step === 'done')  { if (bar) bar.style.width = '100%'; if (bar) bar.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)'; }
  if (step === 'error') { if (bar) bar.style.background = '#ef4444'; }
}

function ocrOverlayPages(cur, total) {
  const pg = document.getElementById('ocr-pages');
  if (!pg) return;
  if (total > 1) { pg.style.display = 'block'; pg.textContent = `Page ${cur} of ${total}`; }
}

function ocrOverlayHide(delayMs) {
  setTimeout(() => {
    const el = document.getElementById('ocr-overlay');
    if (el) el.style.display = 'none';
    // Reset bar colour for next use
    const bar = document.getElementById('ocr-bar');
    if (bar) bar.style.background = 'linear-gradient(90deg,#6366f1,#818cf8)';
  }, delayMs || 0);
}

// ── OCR engine: OCR.space (cloud) with Gemini upgrade path ───────────────
// Tesseract removed — unreliable on school registers, wastes 30s
// Returns array of {surname, firstname, fullName}
async function _readOnePage(file, pageNum, total, fbEl) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async ev => {
      const imgData = ev.target.result;   // full data URI
      const b64    = imgData.split(',')[1];
      const mime   = file.type || 'image/jpeg';

      // Show thumbnail in overlay
      ocrOverlayThumb(imgData);
      ocrOverlayStep('load', 'Image loaded — sending to cloud...', 20);
      ocrOverlayPages(pageNum, total);

      // ── 0. AariNAT OCR — Firebase Cloud Function (primary) ──────────────
      //    Groq Vision (Llama 4 Scout) · endpoint owned by AariNAT
      const AARINAT_OCR_URL = 'https://aarinat-ocr.aarinat-company-limited.workers.dev';
      try {
        ocrOverlayStep('upload', 'AariNAT OCR scanning...', 30);
        var b44Resp = await fetch(AARINAT_OCR_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, mime: mime || 'image/jpeg' })
        });
        if (b44Resp.ok) {
          var b44Data = await b44Resp.json();
          if (b44Data.students && b44Data.students.length > 0) {
            ocrOverlayStep('done', '\u2705 ' + b44Data.students.length + ' names found — AariNAT OCR', 100);
            console.log('AariNAT OCR:', b44Data.students.length, 'names');
            resolve(b44Data.students); return;
          }
        }
      } catch (e) { console.warn('AariNAT OCR failed, trying Base44...', e.message); }

      // ── 0b. Base44 (secondary fallback) ────────────────────────────────
      try {
        ocrOverlayStep('upload', 'Sending to Base44 AI OCR...', 30);
        var b44Resp = await fetch('https://superagent-626f0107.base44.app/functions/bloomOCR', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, mime: mime || 'image/jpeg' })
        });
        if (b44Resp.ok) {
          var b44Data = await b44Resp.json();
          if (b44Data.students && b44Data.students.length > 0) {
            ocrOverlayStep('done', '\u2705 ' + b44Data.students.length + ' names found via Base44 AI', 100);
            console.log('Base44 OCR:', b44Data.students.length, 'names via', b44Data.provider);
            resolve(b44Data.students); return;
          }
        }
      } catch (e) { console.warn('Base44 OCR failed, trying Gemini...', e.message); }

      // ── 1. Gemini (only when key is configured) ────────────────────────
      if (GEMINI_KEY) {
        try {
          ocrOverlayStep('upload', 'Sending to Gemini AI...', 35);
          const names = await geminiOCR(b64, mime);
          if (names && names.length) {
            ocrOverlayStep('done', `✅ ${names.length} names found via Gemini AI`, 100);
            resolve(names); return;
          }
        } catch (e) { console.warn(`Page ${pageNum} Gemini failed:`, e.message); }
      }

      // ── 2. OCR.space — single clean API call ──────────────────────────
      // Only valid free-key params: base64image, language, apikey, OCREngine,
      // scale, detectOrientation, filetype.  isHandwritten/isTable cause HTTP 400.
      try {
        ocrOverlayStep('upload', 'Uploading to cloud OCR...', 40);

        const mimeToFt = {
          'image/jpeg':'JPG','image/jpg':'JPG','image/png':'PNG',
          'image/webp':'JPG','image/heic':'JPG','image/heif':'JPG',
          'application/pdf':'PDF'
        };
        const ft = mimeToFt[mime] || 'JPG';

        const ocrParams = new URLSearchParams({
          base64image:       imgData,   // full data URI
          language:          'eng',
          apikey:            'helloworld',
          OCREngine:         '2',       // best engine for mixed print/handwriting
          scale:             'true',
          detectOrientation: 'true',
          filetype:          ft
        });

        ocrOverlayStep('read', 'Cloud OCR reading text...', 60);

        const controller = new AbortController();
        const ocrTimeout = setTimeout(() => controller.abort(), 30000);

        let result;
        try {
          const resp = await fetch('https://api.ocr.space/parse/image', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    ocrParams.toString(),
            signal:  controller.signal
          });
          clearTimeout(ocrTimeout);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          result = await resp.json();
        } catch (fetchErr) {
          clearTimeout(ocrTimeout);
          const why = fetchErr.name === 'AbortError' ? 'timed out — check connection' : fetchErr.message;
          ocrOverlayStep('error', '⚠️ Network error: ' + why, 60);
          throw fetchErr;
        }

        // Check API-level errors
        if (result.error) throw new Error(result.error);
        if (result.IsErroredOnProcessing) throw new Error((result.ErrorMessage||[]).join('; '));

        ocrOverlayStep('read', 'Extracting student names...', 80);
        const text = (result.ParsedResults || []).map(r => r.ParsedText || '').join('\n');
        console.log('✅ OCR.space text:', text.substring(0, 400));

        if (text.trim().length > 2) {
          // Nigerian register format (most accurate)
          const ng = extractNigerianNames(text);
          if (ng.length) {
            ocrOverlayStep('done', `✅ ${ng.length} names found`, 100);
            resolve(ng.map(n => { const p = n.trim().split(/\s+/); return { surname: p[0]||'', firstname: p.slice(1).join(' ')||'', fullName: n }; }));
            return;
          }
          // Generic name parser
          const gn = extractStudentNames(text);
          if (gn.length) {
            ocrOverlayStep('done', `✅ ${gn.length} names found`, 100);
            resolve(gn.map(n => ({ surname: '', firstname: '', fullName: n })));
            return;
          }
          // Last resort — pair adjacent single-word lines (two-column register support)
          const rawLn = text.split(/\r?\n/)
            .map(l => l.replace(/^[-\d.)\s*•✓✗]+/, '').replace(/[\d,]+\s*$/, '').trim().toUpperCase())
            .filter(l => l.length >= 2 && /[A-Z]{2,}/.test(l));
          const sngl = rawLn.filter(l => l.split(/\s+/).length === 1).length;
          const paired = [];
          if (rawLn.length >= 4 && sngl / rawLn.length > 0.55) {
            for (let ri = 0; ri < rawLn.length; ri += 2) {
              const sur = rawLn[ri] || ''; const fst = rawLn[ri+1] || '';
              if (sur.length >= 2) paired.push({ surname: sur, firstname: fst.length >= 2 ? fst : '', fullName: sur + (fst.length >= 2 ? ' ' + fst : '') });
            }
          } else {
            rawLn.slice(0, 80).forEach(l => {
              const w = l.split(/\s+/);
              paired.push({ surname: w[0]||'', firstname: w.slice(1).join(' ')||'', fullName: l });
            });
          }
          if (paired.length) {
            ocrOverlayStep('done', `📋 ${paired.length} names — please review`, 100);
            resolve(paired); return;
          }
        }

        // OCR returned blank — image may be too blurry
        ocrOverlayStep('error', '⚠️ No text found — try a clearer photo', 100);
        resolve([]);
        return;

      } catch (e) {
        console.warn(`Page ${pageNum} OCR.space failed:`, e.message);
        ocrOverlayStep('error', '⚠️ OCR failed: ' + e.message.substring(0, 60), 100);
        resolve([]);
        return;
      }
    };

    reader.onerror = () => {
      ocrOverlayStep('error', '❌ Could not read file — use an image or PDF', 100);
      resolve([]);
    };

    // Step 1: read file
    ocrOverlayStep('load', 'Reading file...', 10);
    reader.readAsDataURL(file);
  });
}

// ── Name validation / cleanup helpers (for text/OCR import) ──────────────
const UI_BLACKLIST = [
  'educational bloom','school portal','kobomoba','github','send whatsapp',
  'reminders to all','revenue','students','expenses','analytics','settings',
  'support','finance','comms','alumni','health','music','arts','sports',
  'staff','security','opportunities','outstanding','collection rate',
  'collection progress','overdue','unpaid','paid','partial','basic','premium',
  'online','offline','syncing','principal','term ','session','exit','login',
  'add student','import','fix names','upload','download','export','search',
  'all classes','owes','owes:','fee','fees','phone','class','name',
  'send ai','view students','bulk payment','bank statement',
  'no students','loading','saving','please wait','tap to','click to',
  'details','share','wallpaper','use as'
];
const VALID_PREFIXES = /^(mc\.?|cp\.?|ceb\.?|lsses?\.?|lses?\.?|sps\.?|spvenevang\.?|spsupevang\.?|snrldr\.?|honsnrevang\.?|evang\.?|hon\.?|snr\.?|ldr\.?|ven\.?|sup\.?|rev\.?|pastor|deacon|deaconess|bro\.?|sis\.?|mr\.?|mrs\.?|miss|dr\.?|prof\.?)\s/i;

function looksLikeValidName(str) {
  const t = (str || '').trim();
  if (!t || t.length < 2) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  // Allow digits only if looks like a balance annotation — strip those first
  const noDigits = t.replace(/\d+/g, '').trim();
  if (noDigits.length < 2) return false;
  const low = t.toLowerCase();
  if (UI_BLACKLIST.some(b => low.includes(b))) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  const alpha = t.replace(/[^a-zA-Z]/g, '');
  if (alpha.length < 3) return false;
  // Nigerian names are ALL-CAPS from handwritten registers — normalise before checking
  const isAllCaps = alpha === alpha.toUpperCase();
  // Allow up to 8 consonants in a row for Yoruba/Hausa/Igbo names (e.g. AKINWANDE, GBELEGKALE)
  const consonantRun = (t.match(/[^aeiouAEIOU\s.,'\'\-]{9,}/g) || []);
  if (consonantRun.length > 0) return false;
  const hasRealWord = words.some(w => {
    const a = w.replace(/[^a-zA-Z]/g, '');
    return a.length >= 3;
  });
  if (!hasRealWord) return false;
  if (VALID_PREFIXES.test(t)) return true;
  // Accept all-caps words of 3+ letters (Nigerian register format)
  if (isAllCaps && alpha.length >= 3) return true;
  const hasProperNoun = words.some(w => w.length >= 3 && /^[A-Z]/.test(w) && /[a-z]/.test(w));
  return hasProperNoun;
}


// ── Nigerian Name Extractor — handles ALL-CAPS handwritten registers ──────
// Understands: numbered rows, two-column (surname + firstname), balance notes
function extractNigerianNames(raw) {
  // ── Step 1: clean all lines ───────────────────────────────────────────
  const allLines = (raw || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const cleanLine = (line) => {
    const low = line.toLowerCase();
    if (UI_BLACKLIST.some(b => low.includes(b))) return null;
    if (/^(class|serial|no\b|names?|balance|term|from|date|\bsn\b|s\/n)/i.test(line)) return null;

    // ── Reject lines that are entirely class/grade names ──────────────────
    if (/^\s*(BASIC\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|\d+)|NURSERY(\s*\d|\s*1\s*[&AND]+\s*2)?|PRE.?NURSERY|JSS\s*[1-3]|SS[S]?\s*[1-3]|PRIMARY\s*[1-6]|KG\s*[12]?|UNKNOWN|RECEPTION)\s*$/i.test(line)) return null;

    // Strip ALL leading non-letter chars — handles X14, V17, ✓14, •3, "- 2" etc.
    let c = line.replace(/^[^a-zA-Z]+/, '').trim();

    // Strip trailing balance/fee noise
    c = c.replace(/\bBALANCE[\s\d,]*$/i, '')
         .replace(/[\d,]+\s*$/, '')
         .replace(/\b(BALANCE|PAID|OWING|FEE|TERM|CLASS|FROM|BASIC|NURSERY|JSS|SS\d?)\b/gi, '')
         .replace(/[^a-zA-Z\s'\-]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();

    // ── Merge OCR column-split artifacts: "RASA Q" → "RASAQ"
    c = c.replace(/\b([A-Z]{3,})\s+([A-Z]{1,2})\b(?!\s+[A-Z]{3,})/g, '$1$2');

    if (!c || c.length < 2) return null;
    return c.toUpperCase();
  };

  // ── Step 2: classify each cleaned line ───────────────────────────────
  // isNameWord: a word that looks like a Nigerian name token (3+ alpha chars)
  const isNameWord = w => w && /^[A-Z][A-Z'\-]{2,}$/.test(w);

  const cleaned = allLines.map(cleanLine).filter(Boolean);

  // ── Step 3: detect two-column register format ─────────────────────────
  // Signature: many consecutive single-word lines (OCR reads surname col then
  // firstname col as interleaved or back-to-back single tokens).
  // Strategy: scan for runs where >60% of lines are single words → pair them.
  const wordCounts = cleaned.map(l => l.split(/\s+/).filter(isNameWord).length);
  const singleWordLines = wordCounts.filter(n => n === 1).length;
  const isTwoColumnRegister = cleaned.length >= 4 && (singleWordLines / cleaned.length) > 0.55;

  const seen = new Set();
  const results = [];

  const addName = (sur, fst) => {
    sur = (sur || '').trim();
    fst = (fst || '').trim();
    if (!sur || sur.length < 2) return;
    const fullName = fst && fst.length >= 2 ? sur + ' ' + fst : sur;
    if (!looksLikeValidName(fullName)) return;
    const key = fullName.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    results.push(fullName);
  };

  if (isTwoColumnRegister) {
    // ── Two-column mode: pair consecutive single-word lines ──────────────
    // Pattern: line[i]=SURNAME, line[i+1]=FIRSTNAME (both single words)
    // OR the OCR may output all surnames first then all firstnames (less common)
    // We use the simpler approach: walk line by line, pair adjacent singles
    let i = 0;
    while (i < cleaned.length) {
      const line = cleaned[i];
      const words = line.split(/\s+/).filter(isNameWord);

      if (words.length === 0) { i++; continue; }

      if (words.length >= 2) {
        // Already a full "SURNAME FIRSTNAME" on one line — use as-is
        addName(words[0], words[1]);
        i++;
      } else {
        // Single word — look ahead for the next single-word line to pair with
        const next = cleaned[i + 1];
        if (next) {
          const nextWords = next.split(/\s+/).filter(isNameWord);
          if (nextWords.length === 1) {
            // Perfect pair: surname + firstname
            addName(words[0], nextWords[0]);
            i += 2;  // consume both lines
            continue;
          } else if (nextWords.length >= 2) {
            // Next line has a full name — this single might be a stray header
            addName(words[0], '');
            i++;
          } else {
            addName(words[0], '');
            i++;
          }
        } else {
          addName(words[0], '');
          i++;
        }
      }
    }
  } else {
    // ── Normal mode: each line is one student ─────────────────────────────
    cleaned.forEach(line => {
      const words = line.split(/\s+/).filter(isNameWord);
      if (!words.length) return;
      addName(words[0], words[1] || '');
    });
  }

  return results;
}

function extractStudentNames(raw) {
  const lines = (raw || '').split(/\r?\n/);
  const candidates = [];
  lines.forEach(line => {
    const t = line.trim();
    if (!t) return;
    if (t.includes(',') && !/^\d+[.)\s]/.test(t)) {
      const col = t.split(',')[0].replace(/"/g, '').trim();
      if (col) candidates.push(col);
      return;
    }
    const stripped = t.replace(/^\d+[.):\s]+/, '').replace(/^[-*•]\s*/, '').trim();
    if (stripped) candidates.push(stripped);
  });
  const seen = new Set();
  const result = [];
  candidates.forEach(rawName => {
    const n = rawName.replace(/\s+/g, ' ').trim();
    const key = n.toLowerCase().replace(/[^a-z]/g, '');
    if (!key || seen.has(key)) return;
    if (looksLikeValidName(n)) { seen.add(key); result.push(n); }
  });
  return result;
}

// ── State ──────────────────────────────────────────────────────────────────
let schoolId = null, userRole = null, currentStaff = null;
let SD = {
  config: {}, students: [], staff: [], expenses: [], attendance: {},
  scores: {}, affective: {}, sports: { teams: {}, custom: [] },
  arts: { gallery: [] }, music: { practiceLogs: [], instruments: [
    { name: 'Keyboard', status: 'available' },
    { name: 'Guitar', status: 'available' },
    { name: 'Talking Drum', status: 'available' }
  ]}, health: [], alumni: [], socialPages: [], commsLog: [], opportunities: []
};
let activeIdx = null, activeTab = 'fees', currentSport = 'football';

// ── Sync Queue — Offline-First (v2 connectivity probe: generate_204) ─────
const SQ = {
  q: JSON.parse(localStorage.getItem('p_sq') || '[]'),
  _syncing: false,
  save() { localStorage.setItem('p_sq', JSON.stringify(this.q)); },
  push(key, data) {
    SD[key] = data;
    if (schoolId) localStorage.setItem(`p_${schoolId}_${key}`, JSON.stringify(data));
    this.q.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2), key, data, tries: 0 });
    this.save();
    this.flush();
  },
  ping() {
    const el = $('sync');
    if (navigator.onLine) {
      this._offlineSince = null; this._probing = false;
      if (el) {
        el.className = 'sdot ' + (this.q.length ? 'sd-sync' : 'sd-on');
        el.textContent = this.q.length ? '● Syncing' : '● Online';
      }
      if (db && this.q.length) this.flush();
    } else {
      if (!this._probing) {
        this._probing = true;
        if (el) { el.className = 'sdot sd-sync'; el.textContent = '● Connecting...'; }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        fetch('https://clients3.google.com/generate_204', {
          method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller.signal
        }).then(() => {
          clearTimeout(timeoutId);
          this._offlineSince = null; this._probing = false;
          if (el) {
            el.className = 'sdot ' + (this.q.length ? 'sd-sync' : 'sd-on');
            el.textContent = this.q.length ? '● Syncing' : '● Online';
          }
          if (db && this.q.length) this.flush();
        }).catch(() => {
          clearTimeout(timeoutId);
          this._probing = false;
          if (!this._offlineSince) this._offlineSince = Date.now();
          const secs = (Date.now() - this._offlineSince) / 1000;
          if (el && secs > 5) { el.className = 'sdot sd-off'; el.textContent = '● Offline'; }
        });
      }
    }
  },
  async flush() {
    if (!db || !this.q.length || this._syncing) return;
    this._syncing = true;
    const items = [...this.q];
    for (const item of items) {
      try {
        await db.collection('schools').doc(schoolId).set({ [item.key]: item.data }, { merge: true });
        this.q = this.q.filter(x => x.id !== item.id);
      } catch (e) {
        item.tries++;
        if (item.tries > 5) this.q = this.q.filter(x => x.id !== item.id);
      }
    }
    this._syncing = false;
    this.save(); this.ping();
  },
  async silentPull() {
    if (!db || !schoolId) return;
    try {
      const doc = await db.collection('schools').doc(schoolId).get();
      if (!doc.exists) return;
      const d = doc.data();
      const pendingKeys = new Set(this.q.map(x => x.key));
      Object.keys(d).forEach(k => {
        if (!pendingKeys.has(k)) {
          SD[k] = d[k];
          localStorage.setItem(`p_${schoolId}_${k}`, JSON.stringify(d[k]));
        }
      });
      if (typeof renderBanner === 'function') renderBanner();
      if (typeof renderRevenue === 'function' && $('sec-revenue')?.classList.contains('on')) renderRevenue();
      if (typeof renderBirthdays === 'function') renderBirthdays();
      console.log('✅ Silent pull complete from Firestore');
    } catch (e) { console.warn('Silent pull failed (offline?):', e.message); }
  }
};
window.addEventListener('online', () => { SQ.ping(); SQ.flush().then(() => SQ.silentPull()); });
window.addEventListener('offline', () => SQ.ping());

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const fmt = n => '₦' + Number(n || 0).toLocaleString('en-NG');
const openM = id => { const el = $(id); if (el) el.classList.add('on'); };
const closeM = id => { const el = $(id); if (el) el.classList.remove('on'); };
window.onclick = e => { if (e.target.classList.contains('modal')) e.target.classList.remove('on'); };
document.onkeydown = e => { if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.remove('on')); };

function loadLocal(key, def) {
  if (!schoolId) return def;
  const v = localStorage.getItem(`p_${schoolId}_${key}`);
  if (v) try { return JSON.parse(v); } catch (e) {}
  return def;
}
function saveLocal(key, data) {
  if (schoolId) localStorage.setItem(`p_${schoolId}_${key}`, JSON.stringify(data));
}
function gradeScore(t) {
  if (t >= 70) return { g: 'A', r: 'Excellent' };
  if (t >= 60) return { g: 'B', r: 'Good' };
  if (t >= 50) return { g: 'C', r: 'Average' };
  if (t >= 40) return { g: 'D', r: 'Below Average' };
  return { g: 'F', r: 'Fail' };
}
function getGrade(tot) {
  if (tot >= 70) return { g: 'A', r: 'Excellent', col: 'var(--money)' };
  if (tot >= 60) return { g: 'B', r: 'Very Good', col: '#2563eb' };
  if (tot >= 50) return { g: 'C', r: 'Good', col: 'var(--warn)' };
  if (tot >= 40) return { g: 'D', r: 'Fair', col: 'orange' };
  return { g: 'F', r: 'Fail', col: 'var(--danger)' };
}
function toast(msg) {
  let box = $('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:8px 16px;border-radius:20px;font-size:0.8rem;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);pointer-events:none;transition:opacity 0.3s;opacity:0;';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.style.opacity = '1';
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.style.opacity = '0'; }, 2000);
}
function toggleEye(inputId, btn) {
  const inp = $(inputId); if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁️';
  btn.title = show ? 'Hide password' : 'Show password';
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — Login, RBAC, App startup, Navigation
// ═══════════════════════════════════════════════════════════════════════

function defaultOpps() {
  return [
    {id:'ubec',title:'UBEC School Development Grant',provider:'Universal Basic Education Commission',type:'grant',amount:'₦500k–₦2M',deadline:'2026-09-30',audience:['school'],desc:'For primary school infrastructure improvements.'},
    {id:'ptdf',title:'PTDF Undergraduate Scholarship',provider:'PTDF',type:'scholarship',amount:'Full Tuition',deadline:'2026-08-31',audience:['student'],desc:'For Nigerian citizens studying petroleum-related courses.'},
    {id:'nnpc',title:'NNPC/TOTAL Scholarship',provider:'NNPC/TOTAL',type:'scholarship',amount:'₦200,000/year',deadline:'2026-07-15',audience:['student'],desc:'For 100-level STEM students.'},
    {id:'teach',title:'Teach For Nigeria Fellowship',provider:'Teach For Nigeria',type:'internship',amount:'Stipend + Training',deadline:'2026-06-30',audience:['teacher'],desc:'Teaching fellowship for graduates in underserved schools.'}
  ];
}

// ── RBAC helpers ───────────────────────────────────────────────────────
function canSeeFees() { return ['Principal', 'Bursar'].includes(userRole); }
function getAssignedClass() { return currentStaff ? currentStaff.assignedClass : null; }

function applyRoleRestrictions() {
  const links = document.querySelectorAll('.nlink');
  const isClassTeacher = userRole === 'Class Teacher';
  const isSubjectTeacher = userRole === 'Subject Teacher';
  const isBursar = userRole === 'Bursar';
  links.forEach(l => {
    l.style.display = '';
    const tab = l.dataset.t;
    if (isClassTeacher || isSubjectTeacher) {
      if (['revenue', 'staff', 'expenses', 'finance', 'aitools'].includes(tab)) l.style.display = 'none';
    }
    if (isBursar) {
      if (['sports', 'arts', 'music', 'health', 'opps'].includes(tab)) l.style.display = 'none';
    }
  });
}

// ── Staff Login Step 2 ──────────────────────────────────────────────────
function showStaffLoginStep() {
  const loginDiv = $('login'); if (loginDiv) loginDiv.style.display = 'none';
  const staffDiv = $('staff-login'); if (!staffDiv) { console.error('❌ #staff-login not found'); return; }
  staffDiv.style.display = 'flex';
  const nameEl = $('sl-school-name');
  if (nameEl) nameEl.textContent = SD.config?.schoolName || 'Educational Bloom';
  slSetTab('principal');
}

function slSetTab(tab) {
  const isPrincipal = tab === 'principal';
  const pp = $('sl-panel-p'), ps = $('sl-panel-s');
  const tp = $('sl-tab-p'), ts = $('sl-tab-s');
  if (pp) pp.style.display = isPrincipal ? 'block' : 'none';
  if (ps) ps.style.display = isPrincipal ? 'none' : 'block';
  if (tp) { tp.style.background = isPrincipal ? 'var(--brand)' : 'transparent'; tp.style.color = isPrincipal ? '#fff' : 'var(--sub)'; tp.style.borderColor = isPrincipal ? 'var(--brand)' : 'var(--border)'; }
  if (ts) { ts.style.background = isPrincipal ? 'transparent' : 'var(--brand)'; ts.style.color = isPrincipal ? 'var(--sub)' : '#fff'; ts.style.borderColor = isPrincipal ? 'var(--border)' : 'var(--brand)'; }
}

function slForgotPassword() {
  const agent = SD.config?.agent;
  const phone = (agent?.phone || '2348145073941').replace(/\D/g, '');
  const school = SD.config?.schoolName || 'my school';
  const msg = 'Hello, I am the Principal of ' + school + '. I cannot log into EduBloom — please send my school password. School ID: ' + (schoolId || 'unknown');
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
}

function doPrincipalLogin() {
  const pwd = ($('sl-p-pwd')?.value || '').trim();
  const errEl = $('sl-p-err');
  if (errEl) errEl.style.display = 'none';
  if (!pwd) { if (errEl) { errEl.textContent = 'Enter your school password.'; errEl.style.display = 'block'; } return; }
  const principal = (SD.staff || []).find(s => s.role === 'Principal' && (s.password || '') === pwd)
    || (SD.staff || []).find(s => (s.password || '') === pwd);
  if (!principal) {
    if (errEl) { errEl.textContent = 'Incorrect password. Check your agent WhatsApp. Default is bloom2026.'; errEl.style.display = 'block'; }
    return;
  }
  currentStaff = principal; userRole = 'Principal';
  localStorage.setItem('p_' + schoolId + '_staffSession', JSON.stringify(Object.assign({}, principal, { role: 'Principal', schoolId })));
  _saveAuth(schoolId, principal.email || '');
  const div = $('staff-login'); if (div) div.style.display = 'none';
  startApp();
}

function doStaffLogin() {
  const email = ($('sl-email')?.value || '').trim().toLowerCase();
  const pwd = $('sl-pwd')?.value || '';
  const errEl = $('sl-s-err');
  if (errEl) errEl.style.display = 'none';
  if (!email || !pwd) { if (errEl) { errEl.textContent = 'Enter your email and password.'; errEl.style.display = 'block'; } return; }
  const staff = (SD.staff || []).find(s => (s.email || '').trim().toLowerCase() === email && (s.password || '') === pwd);
  if (!staff) {
    if (errEl) { errEl.textContent = 'Not recognised. Ask your Principal to check your staff record.'; errEl.style.display = 'block'; }
    return;
  }
  currentStaff = staff; userRole = staff.role || 'Class Teacher';
  localStorage.setItem('p_' + schoolId + '_staffSession', JSON.stringify(Object.assign({}, staff, { schoolId })));
  _saveAuth(schoolId, email);
  const div = $('staff-login'); if (div) div.style.display = 'none';
  startApp();
}

function loadSchoolIntoSD(sid, school) {
  SD.config = school.config || {};
  SD.students = school.students || [];
  SD.staff = school.staff || [];
  SD.expenses = school.expenses || [];
  SD.attendance = school.attendance || {};
  SD.scores = school.scores || {};
  SD.affective = school.affective || {};
  SD.sports = school.sports || { teams: {}, custom: [] };
  SD.arts = school.arts || { gallery: [] };
  SD.music = school.music || { practiceLogs: [], instruments: [
    { name: 'Keyboard', status: 'available' },
    { name: 'Guitar', status: 'available' },
    { name: 'Talking Drum', status: 'available' }
  ]};
  SD.health = school.health || [];
  SD.alumni = school.alumni || [];
  SD.socialPages = school.socialPages || [];
  SD.commsLog = school.commsLog || [];
  SD.opportunities = school.opportunities || defaultOpps();
  SD.remarks     = school.remarks     || {};
  SD.securityLog   = school.securityLog   || [];
  SD.morningAlerts = school.morningAlerts || {};
  Object.keys(SD).forEach(k => localStorage.setItem(`p_${sid}_${k}`, JSON.stringify(SD[k])));
  // Start AI Agent runtime after data is loaded
  if (typeof startAgentRuntime === 'function') setTimeout(() => startAgentRuntime(), 500);
}

// ─── Demo mode ────────────────────────────────────────────────────────────
function loadDemo() {
  const demoStudents = [
    {id:'d1',name:'Adaeze Okonkwo',   class:'JSS 2',phone:'08012345601',feePaid:25000,feeTotal:50000,paid:25000,totalFee:50000,gender:'F'},
    {id:'d2',name:'Emeka Eze',        class:'JSS 2',phone:'08012345602',feePaid:50000,feeTotal:50000,paid:50000,totalFee:50000,gender:'M'},
    {id:'d3',name:'Fatima Bello',     class:'JSS 2',phone:'08012345603',feePaid:0,    feeTotal:50000,paid:0,totalFee:50000,gender:'F'},
    {id:'d4',name:'Chukwudi Obi',     class:'JSS 2',phone:'08012345604',feePaid:50000,feeTotal:50000,paid:50000,totalFee:50000,gender:'M'},
    {id:'d5',name:'Ngozi Nwosu',      class:'JSS 2',phone:'08012345605',feePaid:30000,feeTotal:50000,paid:30000,totalFee:50000,gender:'F'},
    {id:'d6',name:'Babatunde Adewale',class:'JSS 2',phone:'08012345606',feePaid:50000,feeTotal:50000,paid:50000,totalFee:50000,gender:'M'},
    {id:'d7',name:'Chiamaka Udo',     class:'JSS 2',phone:'08012345607',feePaid:50000,feeTotal:50000,paid:50000,totalFee:50000,gender:'F'},
    {id:'d8',name:'Yusuf Suleiman',   class:'JSS 2',phone:'08012345608',feePaid:0,    feeTotal:50000,paid:0,totalFee:50000,gender:'M'},
    {id:'d9',name:'Blessing Nwobi',   class:'JSS 2',phone:'08012345609',feePaid:50000,feeTotal:50000,paid:50000,totalFee:50000,gender:'F'},
    {id:'d10',name:'Tunde Afolabi',   class:'JSS 2',phone:'08012345610',feePaid:25000,feeTotal:50000,paid:25000,totalFee:50000,gender:'M'},
  ];
  const demoScores = {
    'Term 2': {
      d1:{'Mathematics':{ca1:18,ca2:16,ca3:17,exam:62},'English Language':{ca1:17,ca2:18,ca3:16,exam:65},'Basic Science':{ca1:16,ca2:17,ca3:15,exam:60}},
      d2:{'Mathematics':{ca1:20,ca2:19,ca3:18,exam:75},'English Language':{ca1:16,ca2:17,ca3:15,exam:60},'Basic Science':{ca1:18,ca2:17,ca3:19,exam:70}},
      d3:{'Mathematics':{ca1:12,ca2:14,ca3:11,exam:45},'English Language':{ca1:13,ca2:12,ca3:14,exam:48},'Basic Science':{ca1:14,ca2:13,ca3:12,exam:50}},
      d4:{'Mathematics':{ca1:19,ca2:20,ca3:20,exam:78},'English Language':{ca1:18,ca2:19,ca3:17,exam:70},'Basic Science':{ca1:20,ca2:19,ca3:18,exam:75}},
      d5:{'Mathematics':{ca1:15,ca2:16,ca3:14,exam:55},'English Language':{ca1:15,ca2:16,ca3:14,exam:58},'Basic Science':{ca1:15,ca2:14,ca3:16,exam:56}},
      d6:{'Mathematics':{ca1:18,ca2:17,ca3:19,exam:68},'English Language':{ca1:19,ca2:18,ca3:20,exam:72},'Basic Science':{ca1:17,ca2:18,ca3:16,exam:65}},
      d7:{'Mathematics':{ca1:20,ca2:20,ca3:19,exam:80},'English Language':{ca1:20,ca2:19,ca3:18,exam:78},'Basic Science':{ca1:19,ca2:20,ca3:18,exam:76}},
      d8:{'Mathematics':{ca1:10,ca2:11,ca3:12,exam:40},'English Language':{ca1:11,ca2:10,ca3:12,exam:42},'Basic Science':{ca1:12,ca2:11,ca3:10,exam:44}},
      d9:{'Mathematics':{ca1:16,ca2:15,ca3:17,exam:60},'English Language':{ca1:17,ca2:16,ca3:15,exam:63},'Basic Science':{ca1:16,ca2:15,ca3:17,exam:62}},
      d10:{'Mathematics':{ca1:14,ca2:13,ca3:15,exam:52},'English Language':{ca1:14,ca2:15,ca3:13,exam:54},'Basic Science':{ca1:13,ca2:14,ca3:12,exam:53}},
    }
  };
  const demoAttendance = {
    '2026-06-09':Object.fromEntries(demoStudents.map(s=>[s.name, s.id!=='d3'&&s.id!=='d8'?'Present':'Absent'])),
    '2026-06-10':Object.fromEntries(demoStudents.map(s=>[s.name,'Present'])),
    '2026-06-11':Object.fromEntries(demoStudents.map(s=>[s.name, s.id==='d3'?'Late':'Present'])),
  };
  SD.config = {
    schoolName:'Sunshine Academy', plan:'premium', fee:50000, currentTerm:'Term 2',
    tier:'Small (51–100)', tierPrice:20000, tierMax:100, studentCount:10,
    whatsapp:'2348145073941', agent:{name:'Demo Agent',phone:'2348145073941'},
    _schoolId:'DEMO-SCHOOL', _demo:true,
    subjects:['English Language','Mathematics','Basic Science','Social Studies','Civic Education']
  };
  SD.students = demoStudents;
  SD.staff = [{name:'Mrs. Adaora Obi',email:'demo@sunshine.edu.ng',password:'demo',role:'Principal',phone:'08012345600'}];
  SD.scores = demoScores;
  SD.attendance = demoAttendance;
  SD.affective = {};
  SD.expenses = [
    {id:'e1',description:'Chalk & markers',amount:5000,date:'2026-05-10',category:'Teaching Materials'},
    {id:'e2',description:'Generator fuel',amount:15000,date:'2026-05-15',category:'Utilities (NEPA/Generator)'},
  ];
  SD.sports = {teams:{},custom:[]};
  SD.arts = {gallery:[]};
  SD.music = {practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]};
  SD.health = []; SD.alumni = []; SD.socialPages = []; SD.commsLog = [];
  SD.opportunities = defaultOpps();
  schoolId = 'DEMO-SCHOOL'; userRole = 'Principal'; currentStaff = SD.staff[0];

  const demoBanner = $('demo-banner');
  if (demoBanner) demoBanner.style.display = 'flex';
  startApp();
  console.log('🎬 Demo mode loaded');
}

// ── Main Login ─────────────────────────────────────────────────────────
async function doLogin() {
  const sid = $('l-school').value.trim().toUpperCase();
  const err = $('l-err'); err.style.display = 'none';
  const btn = $('l-btn');
  if (!sid) { err.textContent = 'Enter your School ID (e.g. BLOOM-ABK0042).'; err.style.display = 'block'; return; }
  if (!sid.startsWith('BLOOM-')) { err.textContent = 'School ID must start with BLOOM- (e.g. BLOOM-ABK0042).'; err.style.display = 'block'; return; }
  btn.textContent = 'Checking...'; btn.disabled = true;

  // STEP 1: localStorage cache first — instant, offline-friendly
  const lc = localStorage.getItem(`p_${sid}_config`);
  const ls = localStorage.getItem(`p_${sid}_staff`);
  if (lc && ls) {
    try {
      const staff = JSON.parse(ls);
      const config = JSON.parse(lc);
      console.log('✅ Login from localStorage cache (offline-first)');
      schoolId = sid;
      _saveAuth(sid, '');
      loadSchoolIntoSD(sid, {
        config, staff,
        students: loadLocal('students', []), expenses: loadLocal('expenses', []),
        attendance: loadLocal('attendance', {}), sports: loadLocal('sports', { teams:{}, custom:[] }),
        arts: loadLocal('arts', { gallery:[] }), music: loadLocal('music', { practiceLogs:[], instruments:[] }),
        health: loadLocal('health', []), alumni: loadLocal('alumni', []),
        socialPages: loadLocal('socialPages', []), commsLog: loadLocal('commsLog', []),
        scores: loadLocal('scores', {}), affective: loadLocal('affective', {}),
        opportunities: loadLocal('opportunities', defaultOpps())
      });
      const cachedSession = localStorage.getItem(`p_${sid}_staffSession`);
      if (cachedSession) {
        try {
          const sess = JSON.parse(cachedSession);
          currentStaff = sess; userRole = sess.role || 'Principal';
          startApp(); btn.textContent = '▶ Enter Portal'; btn.disabled = false; return;
        } catch (e) {}
      }
      if (SD.staff && SD.staff.length > 0) {
        btn.textContent = '▶ Enter Portal'; btn.disabled = false;
        showStaffLoginStep(); return;
      }
      userRole = 'Principal'; currentStaff = null;
      startApp();
      setTimeout(() => SQ.silentPull(), 1500);
      btn.textContent = '▶ Enter Portal'; btn.disabled = false;
      return;
    } catch (e) { console.warn('localStorage parse error:', e); }
  }

  // STEP 2: network login
  btn.textContent = 'Connecting...';
  try {
    let school = null;
    if (db) {
      try {
        const doc = await db.collection('schools').doc(sid).get();
        if (doc.exists) { school = doc.data(); console.log('✅ Found in Firestore schools'); }
      } catch (e) { console.warn('Firestore read failed:', e.message); }
    }
    if (!school && db) {
      try {
        const snap = await db.collection('admin_approved_schools').where('schoolId', '==', sid).get();
        if (!snap.empty) {
          const rec = snap.docs[0].data();
          console.log('✅ Found in admin_approved_schools — bootstrapping school doc');
          school = {
            config: { plan:'basic', fee:50000, schoolName: rec.schoolName||'', principalEmail: rec.principalEmail||'', whatsapp: rec.principalPhone||'', createdAt: new Date().toISOString() },
            staff: [{ name:'Principal', email:(rec.principalEmail||sid.toLowerCase()+'@bloom.edu.ng').toLowerCase(), password: rec.password||'', role:'Principal', phone: rec.principalPhone||'' }],
            students: [], expenses: [], attendance: {}, sports: { teams:{}, custom:[] }, arts: { gallery:[] },
            music: { practiceLogs:[], instruments:[] }, health: [], alumni: [], socialPages: [], commsLog: [], opportunities: [], scores: {}, affective: {}
          };
          try { await db.collection('schools').doc(sid).set(school, { merge: true }); } catch (e2) {}
        }
      } catch (e) { console.warn('admin_approved_schools check failed:', e.message); }
    }
    if (!school) {
      err.textContent = `School ID "${sid}" not found. Double-check the ID sent by your AariNAT agent (format: BLOOM-XXXXXX).`;
      err.style.display = 'block'; btn.textContent = '▶ Enter Portal'; btn.disabled = false; return;
    }
    schoolId = sid;
    _saveAuth(sid, '');
    loadSchoolIntoSD(sid, school);
    const fsSession = localStorage.getItem(`p_${sid}_staffSession`);
    if (fsSession) {
      try { const sess = JSON.parse(fsSession); currentStaff = sess; userRole = sess.role || 'Principal'; startApp(); btn.textContent = '▶ Enter Portal'; btn.disabled = false; return; } catch (e) {}
    }
    if (SD.staff && SD.staff.length > 0) {
      btn.textContent = '▶ Enter Portal'; btn.disabled = false;
      showStaffLoginStep(); return;
    }
    userRole = 'Principal'; currentStaff = null;
    startApp();
  } catch (e) {
    console.error('Login network error:', e);
    err.textContent = 'Connection error: ' + (e?.message || 'Check your internet and try again.');
    err.style.display = 'block';
  }
  btn.textContent = '▶ Enter Portal'; btn.disabled = false;
}

function _saveAuth(sid, email) {
  const rememberMe = $('l-remember')?.checked !== false;
  const authData = JSON.stringify({ schoolId: sid, email: email || '', role: userRole || 'Principal' });
  if (rememberMe) { localStorage.setItem('p_auth', authData); sessionStorage.removeItem('p_auth'); }
  else { sessionStorage.setItem('p_auth', authData); localStorage.removeItem('p_auth'); }
}

function logout() {
  if (!confirm('Clear session and reload?')) return;
  localStorage.removeItem('p_auth');
  sessionStorage.removeItem('p_auth');
  if (schoolId) localStorage.removeItem(`p_${schoolId}_staffSession`);
  currentStaff = null; userRole = null;
  location.reload();
}

// ── App Startup ───────────────────────────────────────────────────────
function startApp() {
  $('login').style.display = 'none';
  const staffLogin = $('staff-login'); if (staffLogin) staffLogin.style.display = 'none';
  $('app').style.display = 'block';
  const name = SD.config.schoolName || schoolId || 'Educational Bloom';
  $('hdr-school').textContent = name;
  $('hdr-role').textContent = userRole + (currentStaff?.assignedClass ? ' · ' + currentStaff.assignedClass : '');
  $('hdr-term').textContent = SD.config.currentTerm || 'Term 1';
  const isPrem = SD.config.plan === 'premium';
  $('planBadge').textContent = isPrem ? 'PREMIUM ✨' : 'BASIC';
  $('planBadge').className = 'plan-badge ' + (isPrem ? 'plan-premium' : 'plan-basic');

  applyRoleRestrictions();
  updateLogoBadges(SD.config.logo);
  if (typeof renderBirthdays === 'function') renderBirthdays();

  const bannerSub = $('banner-sub');
  if (bannerSub) {
    const cnt = (SD.students || []).length;
    bannerSub.textContent = cnt > 0 ? `${cnt} student${cnt !== 1 ? 's' : ''} enrolled` : 'No students yet — add your first student';
  }

  SQ.ping();
  const firstTabs = { Principal: 'revenue', Bursar: 'revenue', 'Class Teacher': 'students', 'Subject Teacher': 'scorecard' };
  go(firstTabs[userRole] || 'revenue');
  setTimeout(() => SQ.flush(), 500);
  setTimeout(() => SQ.silentPull(), 2000);
  [1000, 3000, 6000].forEach(ms => setTimeout(() => {
    SQ.ping();
    if (SQ.q.length) SQ.flush();
    if (ms === 6000) SQ.silentPull();
  }, ms));
}

// ── Navigation ─────────────────────────────────────────────────────────
function go(tab) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b => b.classList.remove('on'));
  const target = $(`sec-${tab}`); if (target) target.classList.add('on');
  const btn = document.querySelector(`[data-t="${tab}"]`); if (btn) btn.classList.add('on');
  const fn = {
    revenue: renderRevenue, students: renderStudentList, staff: renderStaff,
    sports: loadSports, arts: renderArts, music: renderMusic, health: renderHealth,
    alumni: renderAlumni, expenses: renderExpenses, finance: checkFinance,
    comms: renderComms, analytics: renderAnalytics, security: () => {},
    support: renderSupport, settings: loadSettings, opps: renderOpps,
    scorecard: renderScorecard,
    aitools: () => { if (typeof renderAITools === 'function') renderAITools(); }
  };
  if (fn[tab]) fn[tab]();
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Tier enforcement, Revenue, Students CRUD, Scores/Scorecard
// ═══════════════════════════════════════════════════════════════════════

// ─── Tier enforcement ──────────────────────────────────────────────────────
function checkTierStatus() {
  const count = (SD.students || []).length;
  const cfg = SD.config || {};
  const tierMax   = cfg.tierMax   || getTier(cfg.studentCount || count).max;
  const tierPrice = cfg.tierPrice || getTier(cfg.studentCount || count).price;
  const tierName  = cfg.tier      || getTier(cfg.studentCount || count).name;
  const sid = cfg._schoolId || schoolId || '';

  if (count !== (cfg._lastReportedCount || 0)) {
    cfg._lastReportedCount = count;
    SQ.push('config', cfg);
    if (db && sid && !cfg._demo) {
      db.collection('schools').doc(sid).update({ 'config.studentCount': count, 'config._lastReportedCount': count }).catch(e => console.warn('studentCount sync:', e));
    }
  }

  const over = count > tierMax;
  const banner = $('tier-alert-banner');

  if (!over) {
    cfg.tierExceededAt = null;
    cfg.tierExceededNewTier = null;
    if (banner) banner.style.display = 'none';
    const lockEl = $('app-lockscreen'); if (lockEl) lockEl.style.display = 'none';
    return;
  }

  if (!cfg.tierExceededAt) {
    cfg.tierExceededAt = new Date().toISOString();
    const newTier = getTier(count);
    cfg.tierExceededNewTier = newTier;
    SQ.push('config', cfg);
    if (db && sid && !cfg._demo) {
      db.collection('schools').doc(sid).update({
        'config.tierExceededAt': cfg.tierExceededAt,
        'config.tierExceededNewTier': cfg.tierExceededNewTier,
        'config.studentCount': count
      }).catch(e => console.warn('tier alert sync:', e));
      db.collection('admin_alerts').add({
        type: 'tier_exceeded', schoolId: sid, schoolName: cfg.schoolName || sid,
        oldTier: tierName, newTier: cfg.tierExceededNewTier.name, newPrice: cfg.tierExceededNewTier.price,
        studentCount: count, exceededAt: cfg.tierExceededAt, resolved: false
      }).catch(e => console.warn('admin alert:', e));
    }
  }

  const newTier = cfg.tierExceededNewTier || getTier(count);
  const exceededAt = new Date(cfg.tierExceededAt);
  const graceDays = 3;
  const lockAt = new Date(exceededAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const msLeft = lockAt - now;
  const daysLeft = Math.ceil(msLeft / 86400000);
  const isLocked = msLeft <= 0;

  if (banner) {
    banner.style.display = 'flex';
    const daysStr = daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left` : 'TODAY — pay now!';
    banner.innerHTML = `
      <div style="flex:1;">
        <strong>⚠️ Student count (${count}) exceeded your ${tierName} tier limit (${tierMax})</strong><br>
        <span style="font-size:0.8rem;">Upgrade to <b>${newTier.name}</b> at <b>₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> — <b style="color:${daysLeft<=1?'#ff4444':'#fbbf24'};">${daysStr}</b> before app locks.</span>
      </div>
      <button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">📞 Contact Admin</button>`;
  }

  if (isLocked) {
    let lockEl = $('app-lockscreen');
    if (!lockEl) {
      lockEl = document.createElement('div'); lockEl.id = 'app-lockscreen';
      lockEl.style.cssText = 'position:fixed;inset:0;background:#0f172a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;';
      lockEl.innerHTML = `
        <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
        <div style="color:#f1f5f9;font-size:1.2rem;font-weight:800;margin-bottom:0.5rem;">App Locked</div>
        <div style="color:#94a3b8;font-size:0.9rem;max-width:320px;margin-bottom:1.5rem;">
          Your school has <b style="color:#f8fafc;">${count} students</b> but your plan covers up to <b style="color:#f8fafc;">${tierMax}</b>.<br><br>
          To unlock, upgrade to <b style="color:#60a5fa;">${newTier.name}</b> at <b style="color:#4ade80;">₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> and contact your agent.
        </div>
        <button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:1rem;font-weight:700;cursor:pointer;">📞 Contact Agent to Unlock</button>`;
      document.body.appendChild(lockEl);
    }
    lockEl.style.display = 'flex';
  }
}

function contactAdminForUpgrade() {
  const cfg = SD.config || {};
  const count = (SD.students || []).length;
  const newTier = cfg.tierExceededNewTier || getTier(count);
  const agent = cfg.agent || {};
  const agentPhone = (agent.phone || '2348145073941').replace(/\D/g, '');
  const msg = `Hello, I need to upgrade my EducationBloom plan.\n\nSchool: ${cfg.schoolName||'My School'}\nCurrent students: ${count}\nRequested tier: ${newTier.name} (₦${Number(newTier.price).toLocaleString('en-NG')}/term)\n\nPlease assist with the upgrade. Thank you.`;
  window.open(`https://wa.me/${agentPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── Banner & Revenue ─────────────────────────────────────────────────────
function renderBanner() {
  let out = 0, cnt = 0;
  (SD.students || []).forEach(s => { const o = (s.totalFee || 0) - (s.paid || 0); if (o > 0) { out += o; cnt++; } });
  const amtEl = $('banner-amount'); if (amtEl) amtEl.textContent = fmt(out);
  const subEl = $('banner-sub');
  if (subEl) {
    const total = (SD.students || []).length;
    if (total === 0) subEl.textContent = 'No students yet — add your first student';
    else subEl.textContent = `${cnt} parent${cnt !== 1 ? 's' : ''} overdue · ${total} total student${total !== 1 ? 's' : ''}`;
  }
}

function renderRevenue() {
  renderBanner();
  const s = SD.students || [];
  let exp = 0, col = 0; s.forEach(x => { exp += (x.totalFee || 0); col += (x.paid || 0); });
  const pct = exp > 0 ? Math.round((col / exp) * 100) : 0;
  if ($('d-students')) $('d-students').textContent = s.length;
  if ($('d-collected')) $('d-collected').textContent = fmt(col);
  if ($('d-outstanding')) $('d-outstanding').textContent = fmt(exp - col);
  if ($('d-rate')) $('d-rate').textContent = pct + '%';
  if ($('prog-pct')) $('prog-pct').textContent = pct + '%';
  if ($('prog-fill')) $('prog-fill').style.width = pct + '%';
  const overdue = s.filter(x => (x.totalFee || 0) - (x.paid || 0) > 0)
    .sort((a, b) => ((b.totalFee || 0) - (b.paid || 0)) - ((a.totalFee || 0) - (a.paid || 0))).slice(0, 6);
  const overdueEl = $('overdue-list');
  if (overdueEl) {
    overdueEl.innerHTML = overdue.length === 0
      ? '<p style="text-align:center;color:var(--sub);padding:1rem;">All fees collected! 🎉</p>'
      : overdue.map(s => {
          const idx = SD.students.indexOf(s); const owe = (s.totalFee || 0) - (s.paid || 0);
          return `<div class="stu-row"><div class="stu-av">${s.name.charAt(0).toUpperCase()}</div><div style="flex:1;"><div class="stu-name">${esc(s.name)}</div><div class="stu-meta">${esc(s.class||'—')} · Owes: <strong style="color:var(--danger);">${fmt(owe)}</strong></div></div><button class="btn-wa btn-sm" onclick="sendReminder(${idx})">📲</button></div>`;
        }).join('');
  }
}

async function handleBulkPayment(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async ev => {
    const lines = ev.target.result.split(/\r?\n/).filter(x => x.trim());
    let matched = 0, skipped = 0, noMatch = 0;
    const nameScore = (a, b) => {
      const wa = a.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
      const wb = b.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
      if (!wa.length || !wb.length) return 0;
      const shared = wa.filter(w => w.length > 1 && wb.includes(w)).length;
      let prefixBonus = 0;
      wa.forEach(w => { if (w.length > 2 && wb.some(v => v.startsWith(w) || w.startsWith(v))) prefixBonus += 0.5; });
      return (shared + prefixBonus) / Math.max(wa.length, wb.length);
    };
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length < 2 || !cols[0] || !cols[1]) continue;
      const csvName = cols[0];
      const amt = parseFloat(cols[1].replace(/[^0-9.]/g, ''));
      if (isNaN(amt) || amt <= 0) continue;
      const scored = SD.students.map((s, idx) => ({ s, idx, score: nameScore(csvName, s.name) }))
        .filter(x => x.score > 0.3).sort((a, b) => b.score - a.score);
      if (!scored.length) { noMatch++; continue; }
      const best = scored[0];
      const isAmbiguous = scored.length > 1 && scored[1].score >= best.score && best.score > 0.5;
      if (isAmbiguous) { skipped++; continue; }
      best.s.paid = (best.s.paid || 0) + amt;
      if (!best.s.paymentHistory) best.s.paymentHistory = [];
      best.s.paymentHistory.unshift({ amount: amt, method: 'Bank Statement', date: new Date().toISOString().split('T')[0], by: 'CSV Import' });
      matched++;
    }
    await SQ.push('students', SD.students); checkTierStatus();
    let msg = `✅ ${matched} matched and updated`;
    if (skipped) msg += ` · ⚠️ ${skipped} ambiguous`;
    if (noMatch) msg += ` · ❓ ${noMatch} not found`;
    if ($('bulk-feedback')) $('bulk-feedback').textContent = msg;
    renderRevenue();
  };
  r.readAsText(f);
}

function sendReminder(idx) {
  const s = SD.students[idx]; const owe = (s.totalFee || 0) - (s.paid || 0);
  const sn = SD.config.schoolName || 'School Management';
  const msg = `Dear Parent,\n\nThis is a friendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
  if (s.phone) window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
  else alert('No phone number for this student.');
}

function sendAllReminders() {
  const overdue = SD.students.filter(s => (s.totalFee || 0) - (s.paid || 0) > 0);
  if (!overdue.length) return alert('No overdue students!');
  const withPhone = overdue.filter(s => s.phone);
  if (withPhone.length > 0) { startBulkWA(); return; }
  const sn = SD.config.schoolName || 'School';
  const total = overdue.reduce((t, s) => t + (s.totalFee || 0) - (s.paid || 0), 0);
  const msg = `Dear Parents of ${sn},\n\nThis is a reminder that *${overdue.length} students* have outstanding fee balances this term.\n\nTotal outstanding: *${fmt(total)}*\n\nKindly ensure prompt payment.\n\n– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  logComm('Fee Reminder Broadcast', `Sent to ${overdue.length} overdue parents. Total: ${fmt(total)}`);
}

// ── Students list / CRUD ──────────────────────────────────────────────────
async function fixGarbledNames() {
  const before = SD.students.length;
  SD.students = SD.students.filter(s => looksLikeValidName((s.name || '').trim()));
  const seen = new Set();
  SD.students = SD.students.filter(s => {
    const key = (s.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const removed = before - SD.students.length;
  if (removed === 0) { alert('Nothing to clean — all names look valid and there are no duplicates! ✅'); return; }
  await SQ.push('students', SD.students); checkTierStatus();
  renderStudentList(); renderBanner(); renderRevenue();
  alert(`✅ Removed ${removed} entr${removed !== 1 ? 'ies' : 'y'} (junk + duplicates).\n\nIf any real student was removed, add them back manually with ➕ Add Student.`);
}


// ── Clear all students ────────────────────────────────────────────────────
async function clearAllStudents() {
  const cls = $('stu-class')?.value || '';
  const filterMsg = cls ? ` in ${cls}` : '';
  const countMsg = cls
    ? SD.students.filter(s => s.class === cls).length
    : SD.students.length;
  if (!countMsg) return toast('No students to clear.');
  if (!confirm(`⚠️ Delete ALL ${countMsg} student${countMsg!==1?'s':''}${filterMsg}?\n\nThis cannot be undone.`)) return;
  if (cls) {
    SD.students = SD.students.filter(s => s.class !== cls);
    toast(`🗑️ All ${cls} students removed`);
  } else {
    // Double confirm for full wipe
    if (!confirm('Are you absolutely sure? This will delete EVERY student in the school.')) return;
    SD.students = [];
    toast('🗑️ All students cleared');
  }
  await SQ.push('students', SD.students);
  renderStudentList(); renderBanner(); renderRevenue(); checkTierStatus();
}

function renderStudentList() {
  const q = ($('stu-search')?.value || '').toLowerCase();
  let cls = $('stu-class')?.value || '';
  const pay = $('stu-pay')?.value || '';
  let list = [...SD.students];

  const assignedCls = getAssignedClass();
  if (assignedCls && (userRole === 'Class Teacher' || userRole === 'Subject Teacher')) {
    cls = assignedCls;
    const clsSel = $('stu-class');
    if (clsSel) { clsSel.value = assignedCls; clsSel.disabled = true; }
  }

  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || (s.phone || '').includes(q));
  if (cls) list = list.filter(s => s.class === cls);
  if (pay === 'paid') list = list.filter(s => (s.totalFee || 0) <= (s.paid || 0));
  else if (pay === 'owing') list = list.filter(s => (s.totalFee || 0) - (s.paid || 0) > 0);
  populateClassFilter();
  const c = $('students-list'); if (!c) return;
  if (!list.length) { c.innerHTML = '<p style="text-align:center;color:var(--sub);padding:2rem;">No students match.</p>'; return; }

  c.innerHTML = list.map(s => {
    const idx = SD.students.indexOf(s);
    const owe = (s.totalFee || 0) - (s.paid || 0);
    const pbc = owe <= 0 ? 'pb-paid' : s.paid > 0 ? 'pb-part' : 'pb-owe';
    const pbt = owe <= 0 ? 'Paid' : s.paid > 0 ? 'Partial' : 'Unpaid';
    const feeBadge = canSeeFees() ? `<span class="pay-badge ${pbc}">${pbt}</span>${owe>0?`<span style="font-size:0.68rem;color:var(--danger);">${fmt(owe)}</span>`:''}` : '';
    return `<div class="stu-row" style="display:flex;align-items:center;gap:0.4rem;">
      <div style="flex:1;display:flex;align-items:center;gap:0.5rem;min-width:0;cursor:pointer;" onclick="openProfile(${idx})">
        <div class="stu-av">${s.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div class="stu-name">${esc(s.name)}</div>
          <div class="stu-meta">${esc(s.class||'—')} · ${s.phone||'—'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">${feeBadge}</div>
      </div>
      <div style="display:flex;gap:0.25rem;flex-shrink:0;margin-left:0.2rem;">
        <button onclick="event.stopPropagation();editStudent(${idx})" 
          style="background:#7c3aed;color:#fff;border:none;border-radius:7px;padding:0.3rem 0.5rem;font-size:0.75rem;cursor:pointer;line-height:1;" title="Edit">✏️</button>
        <button onclick="event.stopPropagation();deleteStudent(${idx})"
          style="background:#ef4444;color:#fff;border:none;border-radius:7px;padding:0.3rem 0.5rem;font-size:0.75rem;cursor:pointer;line-height:1;" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');
}

function populateClassFilter() {
  const sel = $('stu-class'); if (!sel) return;
  const classes = [...new Set(SD.students.map(s => s.class).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${esc(c)}" ${c===cur?'selected':''}>${esc(c)}</option>`).join('');
}

async function addStudent() {
  const name = $('ns-name').value.trim(), phone = $('ns-phone').value.trim().replace(/\D/g, '');
  const cls = $('ns-class').value.trim(), fee = parseFloat($('ns-fee').value) || SD.config.fee || 50000;
  const dob = $('ns-dob')?.value || '';
  if (!name || !phone) return alert('Name and phone required.');
  SD.students.push({ name, phone, class: cls, totalFee: fee, paid: 0, scores: {}, swot: {}, dob });
  await SQ.push('students', SD.students); checkTierStatus();
  closeM('add-student-modal');
  $('ns-name').value=''; $('ns-phone').value=''; $('ns-class').value=''; $('ns-fee').value='';
  if ($('ns-dob')) $('ns-dob').value = '';
  renderStudentList(); renderBanner(); renderRevenue();
}

async function deleteStudent(idx) {
  if (!confirm(`Delete ${SD.students[idx]?.name}?`)) return;
  SD.students.splice(idx, 1);
  await SQ.push('students', SD.students); checkTierStatus();
  closeM('student-modal'); renderStudentList(); renderBanner();
}

// ── Edit Student (v2) ────────────────────────────────────────────────────
function editStudent(idx) {
  const s = SD.students[idx]; if (!s) return;
  const safety = s.safety || {};
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.45rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Student Profile</div>

      <label>Full Name</label>
      <input id="edit-s-name" value="${esc(s.name)}">

      <label>Parent / Guardian Phone (WhatsApp)</label>
      <input id="edit-s-phone" value="${esc(s.phone||'')}" placeholder="+2348012345678">

      <label>Class</label>
      <input id="edit-s-class" value="${esc(s.class||'')}">

      <label>Gender</label>
      <select id="edit-s-gender" style="width:100%;background:#0a1525;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:0.45rem 0.6rem;">
        <option value="" ${!s.gender?'selected':''}>— Select —</option>
        <option value="Male"   ${s.gender==='Male'  ?'selected':''}>Male</option>
        <option value="Female" ${s.gender==='Female'?'selected':''}>Female</option>
      </select>

      <label>Total Fee (₦)</label>
      <input id="edit-s-fee" type="number" value="${s.totalFee||''}">

      <label>Date of Birth</label>
      <input id="edit-s-dob" type="date" value="${esc(s.dob||'')}">

      <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:8px;padding:0.65rem;margin-top:0.3rem;">
        <div style="font-weight:800;font-size:0.8rem;color:#a78bfa;margin-bottom:0.5rem;">🛡️ Security & Safety</div>

        <label style="font-size:0.76rem;">Guardian / Parent Full Name</label>
        <input id="edit-s-guardian" value="${esc(safety.guardianName||'')}" placeholder="e.g. Mr. Kasali Adebayo">

        <label style="font-size:0.76rem;margin-top:0.35rem;">Emergency Phone (different from parent)</label>
        <input id="edit-s-emergency" value="${esc(safety.emergencyPhone||'')}" placeholder="e.g. Uncle's or Aunt's number" style="margin-top:0.2rem;">

        <label style="font-size:0.76rem;margin-top:0.35rem;">Authorised Collectors</label>
        <textarea id="edit-s-collectors" rows="2" placeholder="Names of people allowed to pick up this child, e.g. Mum Fatima, Uncle Tunde, Driver Emeka" style="width:100%;background:#0a1525;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:0.45rem 0.5rem;font-size:0.78rem;resize:none;margin-top:0.2rem;">${esc(safety.collectors||'')}</textarea>
        <div style="font-size:0.68rem;color:var(--sub);margin-top:2px;">Separate names with a comma. The Security Agent checks this list before releasing any child.</div>

        <label style="font-size:0.76rem;margin-top:0.35rem;">Medical / Special Notes</label>
        <input id="edit-s-medical" value="${esc(safety.medical||'')}" placeholder="e.g. asthma, allergy to nuts, hearing aid" style="margin-top:0.2rem;">
      </div>

      <label style="margin-top:0.2rem;">Admission Number</label>
      <input id="edit-s-admno" value="${esc(s.admissionNo||'')}" placeholder="e.g. BLM/2024/001">

      <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditStudent(${idx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-student-modal')">Cancel</button>
      </div>
    </div>`;
  let m = $('edit-student-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'edit-student-modal'; m.className = 'modal';
    m.innerHTML = `<div class="mbox"><button class="mclose" onclick="closeM('edit-student-modal')">✕</button><div id="edit-student-modal-body"></div></div>`;
    document.body.appendChild(m);
  }
  $('edit-student-modal-body').innerHTML = html;
  openM('edit-student-modal');
}

async function saveEditStudent(idx) {
  const s = SD.students[idx]; if (!s) return;
  const old = s.name;
  const n = $('edit-s-name').value.trim(); if (!n) return alert('Name required.');
  s.name        = n;
  s.phone       = ($('edit-s-phone')     ? $('edit-s-phone').value.trim().replace(/\D/g,'') : s.phone||'');
  s.class       = ($('edit-s-class')     ? $('edit-s-class').value.trim()    : s.class||'');
  s.gender      = ($('edit-s-gender')    ? $('edit-s-gender').value          : s.gender||'');
  s.totalFee    = parseFloat($('edit-s-fee')?.value) || s.totalFee || 50000;
  s.dob         = ($('edit-s-dob')       ? $('edit-s-dob').value             : s.dob||'');
  s.admissionNo = ($('edit-s-admno')     ? $('edit-s-admno').value.trim()    : s.admissionNo||'');
  s.safety = {
    guardianName:   $('edit-s-guardian')   ? $('edit-s-guardian').value.trim()   : (s.safety||{}).guardianName||'',
    emergencyPhone: $('edit-s-emergency')  ? $('edit-s-emergency').value.trim().replace(/\D/g,'') : (s.safety||{}).emergencyPhone||'',
    collectors:     $('edit-s-collectors') ? $('edit-s-collectors').value.trim() : (s.safety||{}).collectors||'',
    medical:        $('edit-s-medical')    ? $('edit-s-medical').value.trim()    : (s.safety||{}).medical||''
  };
  if (old !== n && SD.attendance) {
    Object.keys(SD.attendance).forEach(date => {
      if (SD.attendance[date][old] !== undefined) {
        SD.attendance[date][n] = SD.attendance[date][old];
        delete SD.attendance[date][old];
      }
    });
    await SQ.push('attendance', SD.attendance); saveLocal('attendance', SD.attendance);
  }
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  closeM('edit-student-modal');
  renderStudentList(); renderBanner(); renderRevenue();
  toast('✅ Student updated!');
}

// ── Universal student import: CSV, TXT, JPG, PNG, JPEG, WEBP ─────────────
function handleCSV(e) {
  const files = Array.from(e.target.files || []); if (!files.length) return;
  e.target.value = '';
  const ocrFiles = files.filter(f => {
    const n = (f.name || '').toLowerCase(), t = (f.type || '').toLowerCase();
    return t.startsWith('image/') || t === 'application/pdf'
        || /\.(jpg|jpeg|png|webp|bmp|heic|heif|pdf)$/.test(n);
  });
  const texts = files.filter(f => !ocrFiles.includes(f));
  texts.forEach(f => importStudentsFromText(f));
  if (ocrFiles.length) {
    // If no Gemini key, show warning + option to add key before proceeding
    if (!GEMINI_KEY) {
      showGeminiKeyPrompt(() => processImagesSequentially(ocrFiles));
    } else {
      processImagesSequentially(ocrFiles);
    }
  }
}

// ── Gemini API key prompt — shown when OCR is attempted without a key ─────
function showGeminiKeyPrompt(onProceed) {
  const existing = document.getElementById('gemini-key-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'gemini-key-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:20px 20px 0 0;padding:1.5rem 1.2rem 2rem;width:100%;max-width:520px;animation:slideup 0.25s ease;">
      <div style="font-size:1.05rem;font-weight:800;margin-bottom:0.4rem;">🤖 Better OCR Available</div>
      <p style="font-size:0.82rem;color:var(--sub);margin:0 0 1rem;line-height:1.6;">
        Without a <strong>Gemini API key</strong>, OCR.space will be used — it struggles with <em>rotated handwritten Nigerian registers</em> and may produce 40–60% spelling errors.<br><br>
        With Gemini, accuracy jumps to ~85–95% and it understands Nigerian names.
      </p>
      <div style="background:var(--s2);border-radius:12px;padding:0.9rem;margin-bottom:1rem;">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text);margin-bottom:0.5rem;">🔑 Enter Gemini API Key (free)</div>
        <input id="gemini-key-input" type="password" placeholder="AIzaSy..."
          style="width:100%;padding:0.6rem 0.75rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;">
        <div style="font-size:0.72rem;color:var(--sub);margin-top:0.4rem;">
          Get a free key at <strong>aistudio.google.com</strong> → Create API Key
        </div>
      </div>
      <div style="display:flex;gap:0.6rem;">
        <button onclick="saveGeminiKeyAndProceed()" 
          class="btn-brand" style="flex:1;padding:0.75rem;font-size:0.88rem;">
          ✅ Save Key & Scan
        </button>
        <button onclick="skipGeminiKey()" 
          style="flex:1;padding:0.75rem;font-size:0.82rem;border:1.5px solid var(--border);border-radius:12px;background:var(--bg);color:var(--sub);cursor:pointer;">
          ⚠️ Continue Without Key
        </button>
      </div>
      <button onclick="document.getElementById('gemini-key-modal').remove()"
        style="display:block;width:100%;text-align:center;margin-top:0.75rem;background:none;border:none;color:var(--sub);font-size:0.78rem;cursor:pointer;">Cancel</button>
    </div>`;
  document.body.appendChild(modal);

  // Store callback for after key save
  window._geminiKeyCallback = onProceed;
}

function saveGeminiKeyAndProceed() {
  const inp = document.getElementById('gemini-key-input');
  const key = (inp?.value || '').trim();
  if (!key || !key.startsWith('AIza')) {
    inp.style.borderColor = '#ef4444';
    inp.placeholder = 'Must start with AIza... — check your key';
    return;
  }
  // Save to localStorage for this session
  localStorage.setItem('gemini_api_key', key);
  // Inject into runtime — update the GEMINI_KEY variable equivalent
  window.GEMINI_API_KEY = key;
  // Also patch: reload won't be needed since geminiOCR reads GEMINI_KEY at call time
  // We need to update the const — but since it's const we use a workaround via window
  document.getElementById('gemini-key-modal').remove();
  toast('✅ Gemini key saved — scanning with AI...');
  // Small delay then run
  setTimeout(() => {
    if (window._geminiKeyCallback) { window._geminiKeyCallback(); window._geminiKeyCallback = null; }
  }, 300);
}

function skipGeminiKey() {
  document.getElementById('gemini-key-modal').remove();
  toast('⚠️ Using OCR.space — results may need heavy editing');
  if (window._geminiKeyCallback) { window._geminiKeyCallback(); window._geminiKeyCallback = null; }
}

let _ocrPending = [];

async function processImagesSequentially(files) {
  const fbEl = $('csv-fb'); _ocrPending = [];

  // Show the upload overlay for the first file
  if (files.length > 0) {
    const firstName = files[0].name || 'image';
    ocrOverlayShow(firstName);
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Update overlay filename for multi-file uploads
    if (i > 0) {
      const fn = document.getElementById('ocr-filename');
      if (fn) fn.textContent = f.name || `Image ${i+1}`;
    }
    if (fbEl) fbEl.textContent = `📸 Reading page ${i+1} of ${files.length}...`;
    const names = await _readOnePage(f, i + 1, files.length, fbEl);
    _ocrPending.push(...names);
  }

  if (!_ocrPending.length) {
    ocrOverlayHide(2000);
    if (fbEl) fbEl.textContent = '❌ Could not read any names. Try a clearer, well-lit photo.';
    return;
  }
  const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
  _ocrPending = _ocrPending.filter(n => {
    const key = (n.fullName || '').toLowerCase().replace(/[^a-z]/g, '');
    return key.length > 1 && !existingKeys.has(key);
  });
  const totalFound = _ocrPending.length;
  if (fbEl) fbEl.textContent = `✅ Found ${totalFound} name${totalFound!==1?'s':''} — review below.`;
  ocrOverlayStep('done', `✅ ${totalFound} name${totalFound!==1?'s':''} ready to review`, 100);
  // Hide overlay after brief success pause, then open review immediately
  setTimeout(() => {
    ocrOverlayHide(0);
    ocrShowReview(_ocrPending);
  }, 900);
}

function ocrShowReview(names) {
  const modal = $('ocr-review-modal');
  const list  = $('ocr-review-list');
  const info  = $('ocr-review-info');
  if (!modal || !list) { console.error('OCR review modal not found in HTML'); return; }

  // Populate the "Set class for ALL" dropdown from existing class arms
  const classDropdown = $('ocr-class-all');
  if (classDropdown) {
    const arms = [...new Set((SD.students||[]).map(s=>s.class||'').filter(Boolean))].sort();
    // Also include common Nigerian class names as defaults
    const defaults = ['JSS1A','JSS1B','JSS2A','JSS2B','JSS3A','JSS3B','SS1A','SS1B','SS2A','SS2B','SS3A','SS3B'];
    const allArms  = [...new Set([...arms, ...defaults])];
    classDropdown.innerHTML = '<option value="">Set class for ALL ▾</option>' +
      allArms.map(a => `<option value="${a}">${a}</option>`).join('');
  }

  if (info) info.textContent = `${names.length} name${names.length!==1?'s':''} found. ✏️ Edit any wrong names, 🗑️ delete bad ones, then tap Add Students.`;

  // Pre-filter: remove entries that have no usable name content
  const validNames = names.filter(n => {
    const full = (n.fullName || n.surname || '').trim();
    return full.length >= 2 && /[a-zA-Z]{2,}/.test(full);
  });
  // Update info text with actual count after filtering
  if (info) info.textContent = `${validNames.length} name${validNames.length!==1?'s':''} found. ✏️ Edit wrong names, ✕ delete bad ones, then tap Add Students.`;

  list.innerHTML = validNames.map((n, i) => {
    // FIX: define sur/fst properly from the name object
    const sur = (n.surname  || '').trim().toUpperCase();
    const fst = (n.firstname|| '').trim().toUpperCase();
    const fullName = n.fullName || ((sur + ' ' + fst).trim());
    // If surname/firstname not split, put everything in surname field
    const surVal = sur || fullName.split(/\s+/)[0] || '';
    const fstVal = fst || fullName.split(/\s+/).slice(1).join(' ') || '';

    return `<div class="ocr-row" id="ocr-row-${i}" style="display:flex;align-items:center;gap:4px;padding:7px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <input type="checkbox" id="ocr-chk-${i}" checked onchange="ocrUpdateCount()"
        style="width:20px;height:20px;cursor:pointer;accent-color:var(--brand);flex-shrink:0;">
      <input type="text" id="ocr-sur-${i}" value="${surVal.replace(/"/g,'&quot;')}" placeholder="Surname"
        style="width:110px;border:1.5px solid var(--border);border-radius:7px;padding:5px 7px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;text-transform:uppercase;">
      <input type="text" id="ocr-fst-${i}" value="${fstVal.replace(/"/g,'&quot;')}" placeholder="First name"
        style="width:100px;border:1.5px solid var(--border);border-radius:7px;padding:5px 7px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;text-transform:uppercase;">
      <input type="text" id="ocr-cls-${i}" placeholder="Class"
        style="width:68px;border:1.5px solid var(--border);border-radius:7px;padding:5px 6px;font-size:0.78rem;background:var(--bg);color:var(--text);font-family:inherit;flex-shrink:0;">
      <button onclick="document.getElementById('ocr-row-${i}').remove();ocrUpdateCount()"
        style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:7px;padding:5px 10px;cursor:pointer;color:#dc2626;font-size:0.82rem;font-weight:700;flex-shrink:0;">✕</button>
    </div>`;
  }).join('');

  ocrUpdateCount();
  openM('ocr-review-modal');
}

function ocrUpdateCount() {
  const checked = document.querySelectorAll('#ocr-review-list input[type=checkbox]:checked').length;
  const btn = $('ocr-confirm-btn');
  if (btn) btn.textContent = `✅ Add ${checked} Student${checked!==1?'s':''}`;
}
function ocrSelectAll(val) {
  document.querySelectorAll('#ocr-review-list input[type=checkbox]').forEach(c => c.checked = val);
  ocrUpdateCount();
}
function ocrSetClassAll() {
  const cls = ($('ocr-class-all')?.value || '').trim(); if (!cls) return;
  document.querySelectorAll('[id^=ocr-cls-]').forEach(el => { el.value = cls; });
  // Reset dropdown so it acts as a one-shot action
  const dd = $('ocr-class-all'); if (dd) dd.value = '';
}
async function ocrConfirmImport() {
  const rows = document.querySelectorAll('#ocr-review-list .ocr-row');
  const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
  let added = 0; const fee = SD.config?.fee || 50000;
  rows.forEach(row => {
    const chk = row.querySelector('input[type=checkbox]');
    if (!chk || !chk.checked) return;
    const inputs = row.querySelectorAll('input[type=text]');
    let name, cls;
    if (inputs.length >= 3) {
      // New format: surname | firstname | class
      const sur = (inputs[0]?.value || '').trim().toUpperCase();
      const fst = (inputs[1]?.value || '').trim().toUpperCase();
      cls  = (inputs[2]?.value || '').trim();
      name = fst ? sur + ' ' + fst : sur;
    } else {
      name = (inputs[0]?.value || '').trim();
      cls  = (inputs[1]?.value || '').trim();
    }
    if (!name) return;
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    if (existingKeys.has(key)) return;
    SD.students.push({ name, phone: '', class: cls, totalFee: fee, paid: 0, scores: {}, swot: {} });
    existingKeys.add(key); added++;
  });
  if (!added) { alert('No names selected.'); return; }
  await SQ.push('students', SD.students); checkTierStatus();
  closeM('ocr-review-modal');
  renderStudentList(); renderBanner(); renderRevenue();
  const fbEl = $('csv-fb'); if (fbEl) fbEl.textContent = `✅ ${added} student${added!==1?'s':''} added successfully.`;
}

function importStudentsFromText(f) {
  const tryRead = (encoding) => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = ev => resolve(ev.target.result); r.onerror = reject; r.readAsText(f, encoding);
  });
  const looksGarbled = str => {
    const bad = (str.match(/[\uFFFD\u0080-\u009F\u00C2-\u00C3]/g) || []).length;
    return bad > 5 || (bad / Math.max(str.length, 1)) > 0.02;
  };
  const cleanName = n => n.replace(/[^a-zA-Z\s'\-\.]/g, '').replace(/\s+/g, ' ').trim();
  (async () => {
    let raw = await tryRead('UTF-8');
    if (looksGarbled(raw)) raw = await tryRead('windows-1252');
    const lines = raw.split(/\r?\n/).filter(x => x.trim());
    const isStructured = lines.length > 1 && lines[0].toLowerCase().includes('name') && lines[0].includes(',');
    let count = 0;
    if (isStructured) {
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',').map(x => x.trim());
        const nm = cleanName(c[0] || '');
        if (nm && nm.length > 1 && c[1]) {
          SD.students.push({ name: nm, phone: (c[1]||'').replace(/\D/g, ''), class: c[2] || '', totalFee: parseFloat(c[3]) || SD.config.fee || 50000, paid: 0, scores: {}, swot: {} });
          count++;
        }
      }
    } else {
      const names = extractStudentNames(raw);
      const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
      names.forEach(nm => {
        const safe = nm.replace(/[^a-zA-Z\s'\-\.]/g, '').replace(/\s+/g, ' ').trim();
        const key = safe.toLowerCase().replace(/[^a-z]/g, '');
        if (safe.length > 1 && !existingKeys.has(key)) {
          SD.students.push({ name: safe, phone: '', class: '', totalFee: SD.config.fee || 50000, paid: 0, scores: {}, swot: {} });
          existingKeys.add(key); count++;
        }
      });
    }
    await SQ.push('students', SD.students); checkTierStatus();
    if ($('csv-fb')) $('csv-fb').textContent = `✅ Imported ${count} student${count!==1?'s':''}.${isStructured?'':' Add phone/class in profiles.'}`;
    renderStudentList(); renderBanner(); renderRevenue();
  })().catch(() => alert('Could not read file. Try saving it as UTF-8 CSV.'));
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — Student Profile Tabs: Fees, Attendance, Scores, Report, SWOT, Safety
// ═══════════════════════════════════════════════════════════════════════

function openProfile(idx) {
  activeIdx = idx; activeTab = 'fees';
  const s = SD.students[idx]; if (!s) return;
  $('prof-name').textContent = s.name;
  $('prof-meta').textContent = `${s.class||'—'} · ${s.phone||'—'}`;
  const bdayEl = $('prof-bday');
  if (bdayEl) {
    if (s.dob) { bdayEl.style.display = 'block'; bdayEl.textContent = `🎂 DOB: ${s.dob}`; }
    else bdayEl.style.display = 'none';
  }
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.pt === 'fees'));
  renderTab('fees'); openM('student-modal');
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.pt === tab));
  renderTab(tab);
}

function renderTab(tab) {
  const s = SD.students[activeIdx]; if (!s) return;
  const c = $('profile-content'); if (!c) return;
  if (tab === 'fees') c.innerHTML = buildFees(s, activeIdx);
  else if (tab === 'attendance') c.innerHTML = buildAttendance(s);
  else if (tab === 'scores') c.innerHTML = buildScores(s, activeIdx);
  else if (tab === 'report') c.innerHTML = buildReport(s);
  else if (tab === 'swot') c.innerHTML = buildSWOT(s, activeIdx);
  else if (tab === 'safety') c.innerHTML = buildSafety(s, activeIdx);
}

// ── FEES TAB ──────────────────────────────────────────────────────────
function buildFees(s, idx) {
  if (!canSeeFees()) {
    return `<div class="card" style="text-align:center;padding:1.5rem;color:var(--sub);">
      <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div>
      <div style="font-weight:700;font-size:0.88rem;color:var(--text);">Fee data is private</div>
      <div style="font-size:0.78rem;margin-top:0.3rem;">Only the Principal and Bursar can view fee information.</div>
    </div>`;
  }
  const owe = (s.totalFee || 0) - (s.paid || 0);
  const pct = s.totalFee ? Math.min(100, Math.round(((s.paid||0)/s.totalFee)*100)) : 0;
  return `<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;margin-bottom:0.65rem;">
    <div class="stat"><div class="sn" style="font-size:1rem;">${fmt(s.totalFee||0)}</div><div class="sl">Fee</div></div>
    <div class="stat"><div class="sn" style="font-size:1rem;color:var(--money);">${fmt(s.paid||0)}</div><div class="sl">Paid</div></div>
    <div class="stat"><div class="sn" style="font-size:1rem;color:var(--danger);">${fmt(owe)}</div><div class="sl">Owing</div></div>
    </div><div class="prog-bg"><div class="prog-fill" style="width:${pct}%;"></div></div>
    <div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% paid</div></div>
    <div class="card"><div class="ct">Record Payment</div>
    <label>Amount (₦)</label><input type="number" id="pay-amt" placeholder="e.g. 25000">
    <label>Method</label><select id="pay-method"><option>Bank Transfer</option><option>Cash</option><option>POS</option><option>Online</option></select>
    <label>Date</label><input type="date" id="pay-date" value="${new Date().toISOString().split('T')[0]}">
    <button class="btn-money" onclick="recordPayment(${idx})">💵 Record Payment</button>
    ${owe>0?`<button class="btn-wa" style="margin-top:0.4rem;" onclick="sendReminder(${idx})">📲 Send WhatsApp Reminder</button>`:''}
    ${(s.paymentHistory||[]).length?`<div style="margin-top:0.75rem;"><div style="font-weight:700;font-size:0.82rem;margin-bottom:0.4rem;">Payment History</div>${(s.paymentHistory||[]).map((p,pi)=>`
  <div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0;border-bottom:1px solid var(--border);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:0.8rem;font-weight:600;color:var(--money);">${fmt(p.amount)}</div>
      <div style="font-size:0.7rem;color:var(--sub);">${p.date} · ${p.method}</div>
    </div>
    <button onclick="editPayment(${idx},${pi})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
    <button onclick="deletePayment(${idx},${pi})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️ Del</button>
  </div>`).join('')}</div>`:''}
    </div>`;
}

async function recordPayment(idx) {
  const amt = parseFloat($('pay-amt')?.value); if (!amt || amt <= 0) return alert('Enter valid amount.');
  SD.students[idx].paid = (SD.students[idx].paid || 0) + amt;
  if (!SD.students[idx].paymentHistory) SD.students[idx].paymentHistory = [];
  SD.students[idx].paymentHistory.unshift({ amount: amt, method: $('pay-method')?.value || 'Cash', date: $('pay-date')?.value || new Date().toISOString().split('T')[0], by: userRole });
  await SQ.push('students', SD.students); checkTierStatus();
  if ($('pay-amt')) $('pay-amt').value = '';
  renderTab('fees'); renderBanner(); renderRevenue();
  alert(`✅ ${fmt(amt)} recorded for ${SD.students[idx].name}`);
}

async function deletePayment(studentIdx, payIdx) {
  const s = SD.students[studentIdx]; if (!s) return;
  const p = (s.paymentHistory || [])[payIdx]; if (!p) return;
  if (!confirm(`Delete payment of ${fmt(p.amount)} on ${p.date}?`)) return;
  s.paid = Math.max(0, (s.paid || 0) - (p.amount || 0));
  s.paymentHistory.splice(payIdx, 1);
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  activeIdx = studentIdx; renderTab('fees'); renderBanner(); renderRevenue();
  toast('🗑️ Payment deleted.');
}

function editPayment(studentIdx, payIdx) {
  const s = SD.students[studentIdx]; if (!s) return;
  const p = (s.paymentHistory || [])[payIdx]; if (!p) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Payment</div>
      <label>Amount (₦)</label><input id="ep-amt" type="number" value="${p.amount||''}">
      <label>Method</label><select id="ep-method">${['Bank Transfer','Cash','POS','Online'].map(m=>`<option ${m===p.method?'selected':''}>${m}</option>`).join('')}</select>
      <label>Date</label><input id="ep-date" type="date" value="${p.date||''}">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditPayment(${studentIdx},${payIdx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-payment-modal')">Cancel</button>
      </div>
    </div>`;
  let m = $('edit-payment-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'edit-payment-modal'; m.className = 'modal';
    m.innerHTML = `<div class="mbox"><button class="mclose" onclick="closeM('edit-payment-modal')">✕</button><div id="edit-payment-modal-body"></div></div>`;
    document.body.appendChild(m);
  }
  $('edit-payment-modal-body').innerHTML = html;
  openM('edit-payment-modal');
}

async function saveEditPayment(studentIdx, payIdx) {
  const s = SD.students[studentIdx]; if (!s) return;
  const p = (s.paymentHistory || [])[payIdx]; if (!p) return;
  const oldAmt = p.amount || 0;
  const newAmt = parseFloat($('ep-amt').value) || 0; if (!newAmt) return alert('Enter a valid amount.');
  p.amount = newAmt; p.method = $('ep-method').value; p.date = $('ep-date').value;
  s.paid = Math.max(0, (s.paid || 0) - oldAmt + newAmt);
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  closeM('edit-payment-modal'); activeIdx = studentIdx; renderTab('fees'); renderBanner(); renderRevenue();
  toast('✅ Payment updated!');
}

// ── ATTENDANCE TAB ────────────────────────────────────────────────────
function buildAttendance(s) {
  const days = []; for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().split('T')[0]); }
  const att = SD.attendance || {};
  const today = days[0];
  const present = days.filter(d => att[d]?.[s.name] === 'Present').length;
  const absent = days.filter(d => att[d]?.[s.name] === 'Absent').length;
  const late = days.filter(d => att[d]?.[s.name] === 'Late').length;
  const pct = days.length > 0 ? Math.round((present / days.length) * 100) : 0;
  return `<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;">
    <div class="stat"><div class="sn" style="color:var(--money);">${present}</div><div class="sl">Present</div></div>
    <div class="stat"><div class="sn" style="color:var(--danger);">${absent}</div><div class="sl">Absent</div></div>
    <div class="stat"><div class="sn" style="color:var(--warn);">${late}</div><div class="sl">Late</div></div>
    </div><div class="prog-bg" style="margin-top:0.65rem;"><div class="prog-fill" style="width:${pct}%;"></div></div>
    <div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% attendance (last 14 days)</div></div>
    <div class="card"><div class="ct" style="display:flex;justify-content:space-between;align-items:center;"><span>📅 Mark Today (${today})</span><button onclick="checkMorningAbsentees()" style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.25);border-radius:7px;padding:3px 10px;font-size:0.7rem;color:#f87171;cursor:pointer;font-weight:700;white-space:nowrap;">🛡️ Absence Alert</button></div>
    <div style="display:flex;gap:0.4rem;margin-bottom:0.75rem;">
      <button class="btn-money btn-sm" onclick="markAtt(${activeIdx},'${today}','Present')">✅ Present</button>
      <button class="btn-danger btn-sm" onclick="markAtt(${activeIdx},'${today}','Absent')">❌ Absent</button>
      <button style="background:var(--warn);color:white;width:auto;padding:0.32rem 0.7rem;font-size:0.73rem;display:inline-block;margin:0;border-radius:10px;font-weight:700;cursor:pointer;border:none;" onclick="markAtt(${activeIdx},'${today}','Late')">⏰ Late</button>
    </div>
    <div>${days.map(d=>{const st=att[d]?.[s.name]||null;const cls=st==='Present'?'chip-ok':st==='Absent'?'chip-bad':st==='Late'?'chip-warn':'';return`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
      <span style="flex:1;">${d}</span>
      ${st?`<span class="chip ${cls}" style="margin-right:5px;">${st}</span>`:'<span style="color:var(--sub);font-size:0.7rem;margin-right:5px;">—</span>'}
      <div style="display:flex;gap:3px;" onclick="event.stopPropagation()">
        <button onclick="correctAttendance('${esc(s.name)}','${d}','Present')" title="Mark Present" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Present'?'var(--money)':'var(--s2)'};color:${st==='Present'?'white':'var(--text)'};">✅</button>
        <button onclick="correctAttendance('${esc(s.name)}','${d}','Absent')" title="Mark Absent" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Absent'?'var(--danger)':'var(--s2)'};color:${st==='Absent'?'white':'var(--text)'};">❌</button>
        <button onclick="correctAttendance('${esc(s.name)}','${d}','Late')" title="Mark Late" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Late'?'var(--warn)':'var(--s2)'};color:${st==='Late'?'white':'var(--text)'};">⏰</button>
      </div></div>`;}).join('')}</div></div>`;
}

async function markAtt(idx, date, status) {
  const s = SD.students[idx]; if (!s) return;
  if (!SD.attendance) SD.attendance = {};
  if (!SD.attendance[date]) SD.attendance[date] = {};
  SD.attendance[date][s.name] = status;
  await SQ.push('attendance', SD.attendance); saveLocal('attendance', SD.attendance);
  renderTab('attendance');
}

async function correctAttendance(studentName, date, newStatus) {
  if (!SD.attendance) SD.attendance = {};
  if (!SD.attendance[date]) SD.attendance[date] = {};
  if (!newStatus) delete SD.attendance[date][studentName];
  else SD.attendance[date][studentName] = newStatus;
  saveLocal('attendance', SD.attendance); await SQ.push('attendance', SD.attendance);
  toast(`✅ Attendance updated for ${studentName} on ${date}`);
}

// ── SWOT TAB (v2) ─────────────────────────────────────────────────────
function buildSWOT(s, idx) {
  if (!s.swot) s.swot = { s: '', w: '', o: '', t: '' };
  return `<div class="card"><div class="ct">🧠 SWOT Assessment</div>
    <label>Strengths</label><textarea id="swot-s" rows="2">${esc(s.swot.s)}</textarea>
    <label>Weaknesses</label><textarea id="swot-w" rows="2">${esc(s.swot.w)}</textarea>
    <label>Opportunities</label><textarea id="swot-o" rows="2">${esc(s.swot.o)}</textarea>
    <label>Threats</label><textarea id="swot-t" rows="2">${esc(s.swot.t)}</textarea>
    <button class="btn-brand" style="margin-top:0.5rem;" onclick="saveSWOT(${idx})">💾 Save Assessment</button>
    </div>`;
}
async function saveSWOT(idx) {
  const s = SD.students[idx]; if (!s) return;
  s.swot = { s: $('swot-s').value.trim(), w: $('swot-w').value.trim(), o: $('swot-o').value.trim(), t: $('swot-t').value.trim() };
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  toast('✅ Assessment Saved');
}

// ── SAFETY TAB ────────────────────────────────────────────────────────
function buildSafety(s, idx) {
  if (!s.safety) s.safety = { collectors: '', medical: '', notes: '' };
  return `<div class="card"><div class="ct">🛡️ Safety & Pickup Info</div>
    <label>Authorised Collectors</label><textarea id="saf-collectors" rows="2" placeholder="Names of people allowed to pick up this child">${esc(s.safety.collectors||'')}</textarea>
    <label>Medical Notes</label><textarea id="saf-medical" rows="2" placeholder="Allergies, conditions, medications">${esc(s.safety.medical||'')}</textarea>
    <label>Other Notes</label><textarea id="saf-notes" rows="2">${esc(s.safety.notes||'')}</textarea>
    <button class="btn-brand" style="margin-top:0.5rem;" onclick="saveSafety(${idx})">💾 Save Safety Info</button>
    </div>`;
}
async function saveSafety(idx) {
  const s = SD.students[idx]; if (!s) return;
  s.safety = { collectors: $('saf-collectors').value.trim(), medical: $('saf-medical').value.trim(), notes: $('saf-notes').value.trim() };
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  toast('✅ Safety info saved');
}

// ── REPORT TAB ────────────────────────────────────────────────────────
function buildReport(s) {
  const term = SD.config.currentTerm || 'Term 1';
  return `<div class="card"><div class="ct">📋 Print Actions</div>
    <button class="btn-brand" style="width:100%;" onclick="printReportCard(activeIdx, '${term}')">🖨️ Open Printed Report Card</button>
    <p style="font-size:0.76rem;color:var(--sub);margin-top:0.5rem;">Generates a full report card for ${esc(term)} including scores, position, and behavioural ratings.</p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// SCORES — Term-based CA1/CA2/CA3/Exam (canonical model)
// ═══════════════════════════════════════════════════════════════════════
function buildScores(s, idx) {
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const terms = ['Term 1','Term 2','Term 3'];
  const curTerm = SD.config.currentTerm || 'Term 1';
  const sid = s.id || idx;

  const gradeRow = (tot) => {
    const { g, col } = getGrade(tot);
    return `<span style="font-weight:700;color:${col};font-size:0.8rem;">${g}</span>`;
  };

  const termTabs = terms.map(t =>
    `<button class="chip ${t===curTerm?'active':''}" onclick="scorecardSetTerm('${t}',${idx})"
      style="padding:4px 10px;font-size:0.75rem;border-radius:20px;border:1px solid var(--border);
      background:${t===curTerm?'var(--brand)':'var(--s2)'};color:${t===curTerm?'white':'var(--text)'};cursor:pointer;margin:0 2px;">${t}</button>`
  ).join('');

  const buildTermTable = (term) => {
    const termData = (SD.scores[term]||{})[sid] || {};
    let totalSum = 0, subCount = 0;
    const rows = subs.map(sub => {
      const v = termData[sub] || { ca1:0, ca2:0, ca3:0, exam:0 };
      const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
      const tot = caT + (v.exam||0);
      if (tot > 0) { totalSum += tot; subCount++; }
      return `<tr>
        <td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
        <td><input type="number" min="0" max="10" value="${v.ca1||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td><input type="number" min="0" max="10" value="${v.ca2||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td><input type="number" min="0" max="10" value="${v.ca3||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);">${caT||''}</td>
        <td><input type="number" min="0" max="70" value="${v.exam||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;color:${tot>=70?'var(--money)':tot>=50?'var(--text)':'var(--danger)'};">${tot||''}</td>
        <td>${tot>0?gradeRow(tot):''}</td>
      </tr>`;
    }).join('');
    const avg = subCount ? Math.round(totalSum/subCount) : 0;
    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table class="stbl" style="font-size:0.78rem;min-width:500px;">
        <thead><tr><th>Subject</th><th style="font-size:0.7rem;">1st<br>CA/10</th><th style="font-size:0.7rem;">2nd<br>CA/10</th><th style="font-size:0.7rem;">3rd<br>CA/10</th><th style="font-size:0.7rem;">CA<br>Total</th><th style="font-size:0.7rem;">Exam<br>/70</th><th style="font-size:0.7rem;">Total<br>/100</th><th>Grd</th></tr></thead>
        <tbody>${rows}</tbody>
        ${subCount>0?`<tfoot><tr style="background:var(--s2);"><td colspan="6" style="font-weight:700;font-size:0.8rem;">Class Average</td><td style="font-weight:800;color:var(--brand);">${avg}</td><td>${gradeRow(avg)}</td></tr></tfoot>`:''}
      </table></div>`;
  };

  const aff = ((SD.affective||{})[sid]||{})[curTerm] || {};
  const affTraits = ['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
  const psyTraits = ['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const ratingStars = (trait, val, type) =>
    [5,4,3,2,1].map(n=>`<label style="cursor:pointer;font-size:1.1rem;color:${(val||0)>=n?'#f59e0b':'var(--border)'};" onclick="updateAffective(${idx},'${curTerm}','${type}_${trait}',${n})">★</label>`).join('');
  const affRows = affTraits.map(t=>`<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['aff_'+t]||0),'aff')}</td></tr>`).join('');
  const psyRows = psyTraits.map(t=>`<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['psy_'+t]||0),'psy')}</td></tr>`).join('');

  return `<div class="card" style="padding:0.75rem 0.5rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.4rem;">
      <div class="ct" style="margin:0;">📚 Scores</div>
      <div id="score-term-tabs-${idx}">${termTabs}</div>
    </div>
    <div id="score-table-${idx}">${buildTermTable(curTerm)}</div>
    <button class="btn-brand" style="margin-top:0.5rem;width:100%;" onclick="saveScores(${idx})">💾 Save Scores</button>
    <button class="btn-ghost" style="color:var(--danger);font-size:0.76rem;margin-top:0.3rem;width:100%;" onclick="clearStudentScores(${idx},'${curTerm}')">🗑️ Clear All ${curTerm} Scores</button>
    <div class="ct" style="margin-top:1rem;">🌟 Behavioural Assessment (${curTerm})</div>
    <p style="font-size:0.72rem;color:var(--sub);margin-bottom:0.5rem;">Rate each trait ★★★★★ (5=Excellent, 1=Needs Work)</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
      <div><div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">AFFECTIVE DOMAIN</div><table class="stbl" style="font-size:0.78rem;">${affRows}</table></div>
      <div><div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">PSYCHOMOTOR SKILLS</div><table class="stbl" style="font-size:0.78rem;">${psyRows}</table></div>
    </div>
    <button class="btn-ghost" style="margin-top:0.5rem;width:100%;" onclick="printReportCard(${idx},'${curTerm}')">🖨️ Print Report Card</button>
  </div>`;
}

function scorecardSetTerm(term, idx) {
  SD.config.currentTerm = SD.config.currentTerm; // term tab switch is local-only display change
  const tabContent = $('profile-content');
  if (tabContent) {
    // Re-render scores tab with the chosen term as the "current" view by temporarily
    // swapping a local display term. Simplicity: just rebuild table directly.
    const s = SD.students[idx];
    const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
      'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
      'Physical & Health Education','Agricultural Science','National Values Education',
      'French Language','Home Economics','Business Studies','Religious Studies'];
    const sid = s.id || idx;
    const tableEl = $(`score-table-${idx}`);
    if (tableEl) {
      const termData = (SD.scores[term]||{})[sid] || {};
      let totalSum=0, subCount=0;
      const gradeRow = (tot) => { const {g,col}=getGrade(tot); return `<span style="font-weight:700;color:${col};font-size:0.8rem;">${g}</span>`; };
      const rows = subs.map(sub=>{
        const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
        const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0); const tot=caT+(v.exam||0);
        if(tot>0){totalSum+=tot;subCount++;}
        return `<tr><td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
          <td><input type="number" min="0" max="10" value="${v.ca1||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="${v.ca2||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="${v.ca3||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);">${caT||''}</td>
          <td><input type="number" min="0" max="70" value="${v.exam||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;color:${tot>=70?'var(--money)':tot>=50?'var(--text)':'var(--danger)'};">${tot||''}</td>
          <td>${tot>0?gradeRow(tot):''}</td></tr>`;
      }).join('');
      const avg = subCount?Math.round(totalSum/subCount):0;
      tableEl.innerHTML = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table class="stbl" style="font-size:0.78rem;min-width:500px;">
          <thead><tr><th>Subject</th><th style="font-size:0.7rem;">1st<br>CA/10</th><th style="font-size:0.7rem;">2nd<br>CA/10</th><th style="font-size:0.7rem;">3rd<br>CA/10</th><th style="font-size:0.7rem;">CA<br>Total</th><th style="font-size:0.7rem;">Exam<br>/70</th><th style="font-size:0.7rem;">Total<br>/100</th><th>Grd</th></tr></thead>
          <tbody>${rows}</tbody>
          ${subCount>0?`<tfoot><tr style="background:var(--s2);"><td colspan="6" style="font-weight:700;font-size:0.8rem;">Class Average</td><td style="font-weight:800;color:var(--brand);">${avg}</td><td>${gradeRow(avg)}</td></tr></tfoot>`:''}
        </table></div>`;
    }
  }
  // update tab button styles
  document.querySelectorAll(`#score-term-tabs-${idx} .chip`).forEach(b=>{
    const isActive = b.textContent.trim()===term;
    b.style.background = isActive?'var(--brand)':'var(--s2)';
    b.style.color = isActive?'white':'var(--text)';
  });
}

async function updateScore(idx, term, sub, field, val) {
  const sid = SD.students[idx]?.id || idx;
  if (!SD.scores[term]) SD.scores[term] = {};
  if (!SD.scores[term][sid]) SD.scores[term][sid] = {};
  if (!SD.scores[term][sid][sub]) SD.scores[term][sid][sub] = { ca1:0, ca2:0, ca3:0, exam:0 };
  SD.scores[term][sid][sub][field] = parseInt(val) || 0;
}

function updateAffective(idx, term, key, val) {
  const sid = SD.students[idx]?.id || idx;
  if (!SD.affective[sid]) SD.affective[sid] = {};
  if (!SD.affective[sid][term]) SD.affective[sid][term] = {};
  SD.affective[sid][term][key] = val;
  saveLocal('affective', SD.affective);
  SQ.push('affective', SD.affective);
  renderTab('scores');
}

function saveScores(idx) {
  saveLocal('scores', SD.scores);
  SQ.push('scores', SD.scores);
  toast('✅ Scores saved!');
}

async function clearStudentScores(studentIdx, term) {
  const s = SD.students[studentIdx]; if (!s) return;
  if (!confirm(`Clear ALL scores for ${s.name} — ${term}? This cannot be undone.`)) return;
  const sid = s.id || studentIdx;
  if (SD.scores[term] && SD.scores[term][sid]) delete SD.scores[term][sid];
  saveLocal('scores', SD.scores); await SQ.push('scores', SD.scores);
  renderTab('scores');
  toast('🗑️ Scores cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5 — Scorecard / Broadsheet / Report Cards / Wizard
// ═══════════════════════════════════════════════════════════════════════

function calcStudentTermStats(sid, term, subs) {
  const td = (SD.scores[term]||{})[sid] || {};
  let total = 0, count = 0; const perSub = {};
  subs.forEach(sub => {
    const v = td[sub] || { ca1:0, ca2:0, ca3:0, exam:0 };
    const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot = caT + (v.exam||0);
    perSub[sub] = { caT, exam: v.exam||0, tot };
    if (tot > 0) { total += tot; count++; }
  });
  const avg = count ? Math.round(total/count) : 0;
  return { perSub, total, count, avg };
}

function calcCumulative(sid, subs) {
  const terms = ['Term 1','Term 2','Term 3']; const cumSub = {};
  subs.forEach(sub => {
    let tSum=0, tCount=0;
    terms.forEach(term => {
      const td = (SD.scores[term]||{})[sid] || {};
      const v = td[sub] || { ca1:0,ca2:0,ca3:0,exam:0 };
      const tot = (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
      if (tot > 0) { tSum += tot; tCount++; }
    });
    cumSub[sub] = tCount ? Math.round(tSum/tCount) : 0;
  });
  const totals = Object.values(cumSub).filter(v => v > 0);
  const avg = totals.length ? Math.round(totals.reduce((a,b)=>a+b,0)/totals.length) : 0;
  return { cumSub, avg };
}

function renderScorecard() {
  const el = $('scorecard-content'); if (!el) return;
  const classes = [...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const activeClass = el.dataset.cls || (classes[0]||'');
  const activeView = el.dataset.view || 'Term 1';

  const classButtons = classes.map(c =>
    `<button onclick="scorecardSwitchClass('${esc(c)}')" style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);cursor:pointer;background:${c===activeClass?'var(--brand)':'var(--s2)'};color:${c===activeClass?'white':'var(--text)'};">${esc(c)}</button>`
  ).join('');
  const viewTabs = ['Term 1','Term 2','Term 3','Cumulative'].map(v =>
    `<button onclick="scorecardSwitchView('${v}')" style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);cursor:pointer;background:${v===activeView?'var(--brand)':'var(--s2)'};color:${v===activeView?'white':'var(--text)'};">${v==='Cumulative'?'📊 Cumulative':v}</button>`
  ).join('');

  const classStudents = SD.students.filter(s => s.class === activeClass);
  if (!classStudents.length) {
    el.innerHTML = `<div class="card"><div class="ct">📋 Scorecard</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1rem;">${classButtons}</div>
      <p style="color:var(--sub);">No students in this class yet.</p></div>`;
    return;
  }
  const isCum = activeView === 'Cumulative';
  const studentStats = classStudents.map(s => {
    const sid = s.id || SD.students.indexOf(s);
    if (isCum) { const { cumSub, avg } = calcCumulative(sid, subs); return { s, sid, perSub: cumSub, avg }; }
    const { perSub, avg } = calcStudentTermStats(sid, activeView, subs); return { s, sid, perSub, avg };
  });
  const ranked = [...studentStats].sort((a,b)=>b.avg-a.avg);
  const posMap = {}; ranked.forEach((r,i)=>posMap[r.sid]=i+1);

  const subBest = {};
  subs.forEach(sub => {
    let best=null, bestScore=0;
    studentStats.forEach(({s,sid,perSub})=>{
      const v = isCum ? perSub[sub] : (perSub[sub]?.tot||0);
      if (v > bestScore) { bestScore=v; best=s.name; }
    });
    if (bestScore>0) subBest[sub]={name:best,score:bestScore};
  });

  const subHeaders = subs.map(sub=>`<th style="font-size:0.6rem;writing-mode:vertical-lr;transform:rotate(180deg);padding:3px;min-width:26px;">${esc(sub)}</th>`).join('');
  const rows = studentStats.sort((a,b)=>posMap[a.sid]-posMap[b.sid]).map(({s,sid,perSub,avg})=>{
    const pos = posMap[sid]; const {g,col} = getGrade(avg);
    const medal = pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':'';
    const subCells = subs.map(sub=>{
      const v = isCum?perSub[sub]:(perSub[sub]?.tot||0);
      const {col:sc} = getGrade(v||0);
      return `<td style="text-align:center;font-size:0.74rem;font-weight:700;color:${v>0?sc:'var(--border)'};padding:3px 2px;">${v||'–'}</td>`;
    }).join('');
    return `<tr><td style="text-align:center;font-weight:700;font-size:0.72rem;color:${col};">${medal}${pos}</td>
      <td style="font-size:0.74rem;font-weight:600;white-space:nowrap;min-width:110px;">${esc(s.name)}</td>
      ${subCells}
      <td style="text-align:center;font-weight:800;font-size:0.82rem;color:${col};">${avg||'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.74rem;color:${col};">${avg>0?g:'–'}</span></td></tr>`;
  }).join('');

  const top3 = ranked.filter(r=>r.avg>0).slice(0,3);
  const honoursCards = top3.map((r,i)=>{
    const medals=['🥇','🥈','🥉']; const labels=['Best Student','2nd','3rd']; const {col}=getGrade(r.avg);
    return `<div style="background:var(--s2);border-radius:10px;padding:0.5rem 0.7rem;border:1px solid var(--border);flex:1;min-width:90px;text-align:center;">
      <div style="font-size:1.3rem;">${medals[i]}</div><div style="font-size:0.68rem;color:var(--sub);">${labels[i]}</div>
      <div style="font-weight:800;font-size:0.8rem;">${esc(r.s.name)}</div><div style="font-weight:700;font-size:0.76rem;color:${col};">Avg: ${r.avg}</div></div>`;
  }).join('');

  el.dataset.cls = activeClass; el.dataset.view = activeView;
  el.innerHTML = `<div class="card" style="padding:0.75rem 0.5rem;">
    <div class="ct">📋 Scorecard / Broadsheet</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.5rem;">${classButtons}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.7rem;">${viewTabs}</div>
    ${top3.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.7rem;">${honoursCards}</div>`:''}
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;">
      <table class="stbl" style="font-size:0.74rem;min-width:600px;border-collapse:collapse;">
        <thead><tr style="background:var(--s1);"><th style="font-size:0.68rem;min-width:28px;">#</th><th style="font-size:0.68rem;text-align:left;min-width:110px;">Name</th>${subHeaders}<th style="font-size:0.68rem;min-width:36px;">Avg</th><th style="font-size:0.68rem;min-width:28px;">Grd</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${Object.keys(subBest).length?`<div class="ct" style="margin-top:0.9rem;">🏆 Subject Champions</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:0.3rem;">${Object.entries(subBest).map(([sub,{name,score}])=>`<div style="background:var(--s2);border-radius:7px;padding:3px 8px;font-size:0.7rem;border:1px solid var(--border);"><span style="color:var(--sub);">${esc(sub)}:</span> <strong>${esc(name)}</strong> (${score})</div>`).join('')}</div>`:''}
    <div style="display:flex;gap:0.5rem;margin-top:0.7rem;flex-wrap:wrap;">
      <button class="btn-ghost" onclick="printBroadsheet('${esc(activeClass)}','${activeView}')">🖨️ Print Broadsheet</button>
      <button class="btn-ghost" onclick="printAllReportCards('${esc(activeClass)}','${activeView==='Cumulative'?'Term 3':activeView}')">🖨️ Print All Cards</button>
      <button class="btn-ghost" style="background:var(--s2);" onclick="renderBulkScoreGrid('${esc(activeClass)}','${SD.config.currentTerm||'Term 1'}',0)">✏️ Bulk Score Entry</button>
      <button class="btn-brand" onclick="_wizState={cls:'${esc(activeClass)}',term:SD.config.currentTerm||'Term 1',step:1};renderWizard()">🧙 End-of-Term Wizard</button>
    </div>
  </div>`;
}

function scorecardSwitchClass(cls) { const el=$('scorecard-content'); if(!el)return; el.dataset.cls=cls; renderScorecard(); }
function scorecardSwitchView(view) { const el=$('scorecard-content'); if(!el)return; el.dataset.view=view; renderScorecard(); }

// ── Print Report Card (single) ───────────────────────────────────────
function printReportCard(idx, term) {
  const s = SD.students[idx]; if (!s) return;
  const sid = s.id || idx;
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const termData = (SD.scores[term]||{})[sid] || {};
  const aff = ((SD.affective||{})[sid]||{})[term] || {};
  const cfg = SD.config;
  const classStudents = SD.students.filter(st => st.class === s.class);
  const allAvgs = classStudents.map(st => {
    const stid = st.id || SD.students.indexOf(st);
    const { avg } = calcStudentTermStats(stid, term, subs);
    return { name: st.name, avg };
  }).sort((a,b)=>b.avg-a.avg);
  const myPos = (allAvgs.findIndex(r=>r.name===s.name)+1)||'–';

  const rows = subs.map(sub => {
    const v = termData[sub] || {ca1:0,ca2:0,ca3:0,exam:0};
    const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot = caT+(v.exam||0);
    const {g} = getGrade(tot);
    const subRanked = classStudents.map(st=>{
      const stid = st.id || SD.students.indexOf(st);
      const sv = (SD.scores[term]||{})[stid]||{};
      const svs = sv[sub]||{};
      const stot = (svs.ca1||0)+(svs.ca2||0)+(svs.ca3||0)+(svs.exam||0);
      return { name: st.name, tot: stot };
    }).sort((a,b)=>b.tot-a.tot);
    const sPos = (subRanked.findIndex(r=>r.name===s.name)+1)||'–';
    return `<tr><td>${esc(sub)}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td><td>${caT||''}</td><td>${v.exam||''}</td>
      <td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td>
      <td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;
  }).join('');

  const totals = subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);
  const avg = totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
  const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
  const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';
  const affRows = affTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['aff_'+t]||0)}</td></tr>`).join('');
  const psyRows = psyTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['psy_'+t]||0)}</td></tr>`).join('');
  const daysPresent = Object.values(SD.attendance||{}).filter(day=>day[s.name]==='Present').length;

  // ── Stored remarks (set by Report Card Agent or manually) ──
  const remarks = SD.remarks || {};
  const studentRemarks = (remarks[sid]||{})[term] || {};
  const teacherRemark     = studentRemarks.teacher    || '';
  const principalRemark   = studentRemarks.principal  || '';
  const teacherName       = (SD.staff||[]).find(st=>st.role==='Teacher'&&st.class===s.class)?.name || cfg.teacherName || '';
  const principalName     = cfg.principalName || cfg.schoolHead || 'Principal';
  const nextTermDate      = cfg.nextTermDate  || '________________';
  const daysOpened        = cfg.daysOpened    || '–';

  const w = window.open('','_blank','width=820,height=1150');
  if (!w) return alert('Please allow popups to print.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Card — ${esc(s.name)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#111;font-size:11.5px;background:#fff;}
    .hdr{text-align:center;border-bottom:3px double #333;padding-bottom:10px;margin-bottom:12px;}
    .hdr h1{font-size:18px;margin:4px 0;letter-spacing:.5px;}
    .hdr h2{font-size:12px;margin:2px 0;color:#555;}
    .hdr .motto{font-style:italic;font-size:10.5px;color:#777;margin-top:2px;}
    .ig{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:10px;font-size:11px;}
    .ig div{padding:2px 0;border-bottom:1px dotted #ddd;}
    .sm{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0;}
    .sb{border:2px solid #e5e7eb;border-radius:6px;padding:5px;text-align:center;}
    .sv{font-size:16px;font-weight:900;color:#1d4ed8;}
    table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px;}
    th,td{border:1px solid #bbb;padding:3px 5px;}
    th{background:#f3f4f6;font-size:10.5px;font-weight:700;}
    .st{font-weight:800;font-size:11.5px;background:#1e3a5f;color:#fff;padding:4px 7px;margin:8px 0 3px;border-radius:3px;}
    .rg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}
    .rb{border:1.5px solid #bbb;border-radius:6px;padding:8px;min-height:60px;}
    .rb-label{font-weight:800;font-size:11px;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:3px;}
    .rb-content{font-size:11px;color:#222;line-height:1.7;min-height:36px;}
    .rb-sig{margin-top:8px;font-size:10px;color:#555;border-top:1px solid #ddd;padding-top:4px;}
    .gk{display:flex;gap:5px;flex-wrap:wrap;font-size:9.5px;margin:5px 0;}
    .gki{padding:2px 6px;border-radius:3px;border:1px solid #ddd;}
    .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;font-size:10.5px;}
    .sig-box{border-top:1.5px solid #333;padding-top:4px;text-align:center;}
    .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);
      font-size:80px;color:rgba(0,0,0,0.04);font-weight:900;pointer-events:none;z-index:0;white-space:nowrap;}
    @media print{button{display:none;}.watermark{position:fixed;}}
  </style></head><body>
  <div class="watermark">${esc(cfg.schoolName||'EduBloom')}</div>

  <!-- HEADER -->
  <div class="hdr">
    ${cfg.logoUrl?`<img src="${cfg.logoUrl}" style="height:55px;margin-bottom:5px;">` : `<div style="font-size:28px;margin-bottom:3px;">🏫</div>`}
    <h1>${esc(cfg.schoolName||'School')}</h1>
    <h2>${esc(cfg.address||'')}</h2>
    <div class="motto">${esc(cfg.motto||'')}</div>
    <h2 style="margin-top:5px;font-size:13px;font-weight:800;color:#1e3a5f;">STUDENT REPORT CARD</h2>
    <h2>${esc(term)} &nbsp;·&nbsp; ${esc(cfg.session||new Date().getFullYear()+' Academic Session')}</h2>
  </div>

  <!-- STUDENT INFO -->
  <div class="ig">
    <div><b>Student Name:</b> ${esc(s.name)}</div>
    <div><b>Class:</b> ${esc(s.class||'')}</div>
    <div><b>Admission No:</b> ${esc(s.admissionNo||'–')}</div>
    <div><b>Gender:</b> ${esc(s.gender||'–')}</div>
    <div><b>Days School Opened:</b> ${daysOpened}</div>
    <div><b>Days Present:</b> ${daysPresent}</div>
  </div>

  <!-- SUMMARY STATS -->
  <div class="sm">
    <div class="sb"><div class="sv">${avg||'–'}</div><div>Average</div></div>
    <div class="sb"><div class="sv" style="color:${avg>=70?'#16a34a':avg>=50?'#d97706':'#dc2626'}">${avg>0?getGrade(avg).g:'–'}</div><div>Grade</div></div>
    <div class="sb"><div class="sv">${myPos}</div><div>Position</div></div>
    <div class="sb"><div class="sv">${classStudents.length}</div><div>In Class</div></div>
  </div>

  <!-- ACADEMIC TABLE -->
  <div class="st">📚 ACADEMIC PERFORMANCE</div>
  <table>
    <thead><tr>
      <th style="text-align:left;">Subject</th>
      <th>1st CA<br>/10</th><th>2nd CA<br>/10</th><th>3rd CA<br>/10</th>
      <th>CA Total<br>/30</th><th>Exam<br>/70</th>
      <th>Total<br>/100</th><th>Grade</th><th>Pos.</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="gk"><b>Key:</b>
    <span class="gki" style="background:#d1fae5;">A 70–100 Excellent</span>
    <span class="gki" style="background:#dbeafe;">B 60–69 Very Good</span>
    <span class="gki" style="background:#fef9c3;">C 50–59 Good</span>
    <span class="gki" style="background:#ffedd5;">D 40–49 Fair</span>
    <span class="gki" style="background:#fee2e2;">F 0–39 Fail</span>
  </div>

  <!-- AFFECTIVE + PSYCHOMOTOR -->
  <div class="rg">
    <div>
      <div class="st">🌟 AFFECTIVE DOMAIN</div>
      <table><thead><tr><th style="text-align:left;">Trait</th><th>Rating (★★★★★)</th></tr></thead>
      <tbody>${affRows}</tbody></table>
    </div>
    <div>
      <div class="st">⚡ PSYCHOMOTOR SKILLS</div>
      <table><thead><tr><th style="text-align:left;">Skill</th><th>Rating (★★★★★)</th></tr></thead>
      <tbody>${psyRows}</tbody></table>
    </div>
  </div>

  <!-- ═══ DUAL COMMENTS SECTION ═══ -->
  <div class="st">💬 COMMENTS</div>
  <div class="rg" style="margin-top:4px;">

    <!-- CLASS TEACHER COMMENT -->
    <div class="rb" style="border-color:#1d4ed8;">
      <div class="rb-label" style="color:#1d4ed8;">📝 Class Teacher's Comment</div>
      <div class="rb-content">
        ${teacherRemark || '<span style="color:#aaa;font-style:italic;">No remark entered yet.</span>'}
      </div>
      <div class="rb-sig">
        Name: <b>${esc(teacherName)||'____________________'}</b><br>
        Signature: ____________________
      </div>
    </div>

    <!-- PRINCIPAL / HEADMASTER COMMENT -->
    <div class="rb" style="border-color:#065f46;">
      <div class="rb-label" style="color:#065f46;">👑 Head Teacher / Principal's Comment</div>
      <div class="rb-content">
        ${principalRemark || '<span style="color:#aaa;font-style:italic;">No remark entered yet.</span>'}
      </div>
      <div class="rb-sig">
        Name: <b>${esc(principalName)||'____________________'}</b><br>
        Signature: ____________________
      </div>
    </div>

  </div>

  <!-- SIGNATURES + NEXT TERM -->
  <div class="sig-row" style="margin-top:12px;">
    <div class="sig-box">Class Teacher<br>Signature</div>
    <div class="sig-box">Principal<br>Signature</div>
    <div class="sig-box">Parent / Guardian<br>Signature & Date</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:10.5px;background:#f9fafb;padding:6px 8px;border-radius:5px;border:1px solid #e5e7eb;">
    <div>📅 <b>Next Term Begins:</b> ${esc(nextTermDate)}</div>
    <div>🏫 <b>${esc(cfg.schoolName||'')}</b> — Powered by EduBloom 🌸</div>
  </div>

  <div style="text-align:center;margin-top:12px;">
    <button onclick="window.print()" style="padding:8px 22px;font-size:13px;cursor:pointer;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-weight:700;">🖨️ Print / Save as PDF</button>
  </div>
  </body></html>`);
  w.document.close();
}

// ── Print Broadsheet (whole class) ───────────────────────────────────
function printBroadsheet(cls, view) {
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const isCum = view === 'Cumulative';
  const classStudents = SD.students.filter(s=>s.class===cls);
  const stats = classStudents.map(s=>{
    const sid = s.id || SD.students.indexOf(s);
    if (isCum) { const {cumSub,avg}=calcCumulative(sid,subs); return {s,perSub:cumSub,avg}; }
    const {perSub,avg}=calcStudentTermStats(sid,view,subs); return {s,perSub,avg};
  }).sort((a,b)=>b.avg-a.avg);
  const thCells = subs.map(s=>`<th style="writing-mode:vertical-lr;transform:rotate(180deg);font-size:9px;padding:2px;">${esc(s)}</th>`).join('');
  const rows = stats.map(({s,perSub,avg},i)=>{
    const cells = subs.map(sub=>{const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);return`<td style="text-align:center;font-size:9.5px;">${v||'–'}</td>`;}).join('');
    const {g}=getGrade(avg);
    return `<tr><td>${i+1}</td><td style="white-space:nowrap;font-size:10px;">${esc(s.name)}</td>${cells}<td style="font-weight:700;">${avg||'–'}</td><td>${avg>0?g:''}</td></tr>`;
  }).join('');
  const w = window.open('','_blank','width=1100,height=800'); if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Broadsheet</title>
  <style>body{font-family:Arial;font-size:10px;padding:12px;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #999;padding:2px 4px;}th{background:#f0f0f0;font-weight:700;}@media print{button{display:none;}}</style>
  </head><body>
  <h2 style="text-align:center;margin-bottom:3px;">${esc(SD.config.schoolName||'School')} — Broadsheet</h2>
  <h3 style="text-align:center;margin-bottom:8px;">${esc(cls)} &nbsp;|&nbsp; ${view==='Cumulative'?'Cumulative (All Terms)':view} &nbsp;|&nbsp; ${esc(SD.config.session||'')}</h3>
  <table><thead><tr><th>#</th><th>Student Name</th>${thCells}<th>Avg</th><th>Grd</th></tr></thead><tbody>${rows}</tbody></table>
  <button onclick="window.print()" style="margin-top:8px;padding:5px 14px;cursor:pointer;">🖨️ Print</button>
  </body></html>`);
  w.document.close();
}

// ── Bulk Score Entry Grid ─────────────────────────────────────────────
function renderBulkScoreGrid(cls, term, subIdx) {
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const sub = subs[subIdx] || subs[0];
  const classStudents = SD.students.filter(s=>s.class===cls);
  const el = $('scorecard-content'); if (!el) return;

  const subTabs = subs.map((s,i)=>
    `<button onclick="renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${i})" style="padding:4px 9px;border-radius:16px;font-size:0.72rem;white-space:nowrap;border:1px solid var(--border);cursor:pointer;background:${i===subIdx?'var(--brand)':'var(--s2)'};color:${i===subIdx?'white':'var(--text)'};">${esc(s)}</button>`
  ).join('');

  const rows = classStudents.map((s,i)=>{
    const sid = s.id || SD.students.indexOf(s);
    const v = ((SD.scores[term]||{})[sid]||{})[sub] || {ca1:0,ca2:0,ca3:0,exam:0};
    const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot = caT+(v.exam||0);
    const {g,col}=getGrade(tot);
    const tabBase = i*4;
    return `<tr id="bsg-row-${i}" style="${tot>=70?'background:rgba(16,185,129,0.04)':''}">
      <td style="font-size:0.76rem;font-weight:600;padding:5px 6px;white-space:nowrap;">${esc(s.name)}</td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca1||''}" tabindex="${tabBase+1}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca1',this.value)" onkeydown="bsgNav(event,${i},0,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${v.ca1?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-0"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca2||''}" tabindex="${tabBase+2}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca2',this.value)" onkeydown="bsgNav(event,${i},1,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${v.ca2?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-1"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca3||''}" tabindex="${tabBase+3}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca3',this.value)" onkeydown="bsgNav(event,${i},2,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${v.ca3?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-2"></td>
      <td style="padding:2px;"><input type="number" min="0" max="70" value="${v.exam||''}" tabindex="${tabBase+4}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'exam',this.value)" onkeydown="bsgNav(event,${i},3,${classStudents.length})" style="width:48px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${v.exam?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-3"></td>
      <td style="text-align:center;font-weight:700;font-family:'DM Mono',monospace;font-size:0.82rem;color:${tot>0?'var(--text)':'var(--border)'};">${tot||'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span></td>
    </tr>`;
  }).join('');

  const entered = classStudents.filter(s=>{
    const sid=s.id||SD.students.indexOf(s);
    const v=((SD.scores[term]||{})[sid]||{})[sub]||{};
    return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;
  }).length;

  el.innerHTML = `<div class="card" style="padding:0.75rem 0.5rem;">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem;">
      <button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="renderScorecard()">← Broadsheet</button>
      <div class="ct" style="margin:0;flex:1;">✏️ Bulk Score Entry — ${esc(cls)} · ${term}</div>
      <button class="btn-brand" style="padding:5px 12px;font-size:0.78rem;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}')">💾 Save All</button>
    </div>
    <p style="font-size:0.74rem;color:var(--sub);margin-bottom:0.5rem;">📌 <strong>${esc(sub)}</strong> &nbsp;·&nbsp; ${entered}/${classStudents.length} students entered &nbsp;·&nbsp; Tab/Enter to move between cells</p>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;overflow-x:auto;padding-bottom:4px;">${subTabs}</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;">
      <table class="stbl" style="font-size:0.78rem;min-width:380px;">
        <thead><tr style="background:var(--s1);"><th style="text-align:left;min-width:110px;">Student</th><th style="min-width:50px;font-size:0.7rem;">1st CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:50px;font-size:0.7rem;">2nd CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:50px;font-size:0.7rem;">3rd CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:54px;font-size:0.7rem;">Exam<br><span style="color:var(--sub)">/70</span></th><th style="min-width:40px;font-size:0.7rem;">Total<br><span style="color:var(--sub)">/100</span></th><th style="min-width:32px;font-size:0.7rem;">Grd</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem;flex-wrap:wrap;gap:0.4rem;">
      ${subIdx>0?`<button class="btn-ghost" style="font-size:0.76rem;padding:5px 12px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx-1})">← ${esc(subs[subIdx-1]||'')}</button>`:'<div></div>'}
      ${subIdx<subs.length-1?`<button class="btn-brand" style="font-size:0.76rem;padding:5px 12px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx+1})">${esc(subs[subIdx+1]||'')} →</button>`:`<button class="btn-brand" style="font-size:0.76rem;padding:5px 14px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderScorecard()">✅ Done — View Broadsheet</button>`}
    </div>
  </div>`;

  setTimeout(()=>{ for(let i=0;i<classStudents.length;i++){ const e=$(`bsg-${i}-3`); if(e&&!e.value){e.focus();break;} } },100);
}

function bsgUpdate(cls, term, sub, rowIdx, field, val) {
  const classStudents = SD.students.filter(s=>s.class===cls);
  const s = classStudents[rowIdx]; if (!s) return;
  const sid = s.id || SD.students.indexOf(s);
  if (!SD.scores[term]) SD.scores[term]={};
  if (!SD.scores[term][sid]) SD.scores[term][sid]={};
  if (!SD.scores[term][sid][sub]) SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
  SD.scores[term][sid][sub][field] = parseInt(val)||0;
  const v = SD.scores[term][sid][sub];
  const tot = (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
  const row = $('bsg-row-'+rowIdx);
  if (row) {
    const cells = row.querySelectorAll('td');
    const {g,col}=getGrade(tot);
    if (cells[5]) cells[5].textContent = tot||'–';
    if (cells[6]) cells[6].innerHTML = `<span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span>`;
    row.style.background = tot>=70?'rgba(16,185,129,0.04)':'';
    const inp = $(`bsg-${rowIdx}-${['ca1','ca2','ca3','exam'].indexOf(field)}`);
    if (inp) inp.style.borderColor = val?'var(--brand)':'var(--border)';
  }
}

function bsgNav(e, row, col, total) {
  if (e.key==='Enter'||e.key==='ArrowDown') { e.preventDefault(); const next=$(`bsg-${row+1}-${col}`); if(next)next.focus(); }
  else if (e.key==='ArrowUp') { e.preventDefault(); const prev=$(`bsg-${row-1}-${col}`); if(prev)prev.focus(); }
}

function bsgSaveAll(cls, term) { saveLocal('scores',SD.scores); SQ.push('scores',SD.scores); toast('✅ Scores saved!'); }

// ── Print All Report Cards ────────────────────────────────────────────
function printAllReportCards(cls, term) {
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const classStudents = SD.students.filter(s=>s.class===cls);
  if (!classStudents.length) { toast('No students in this class.'); return; }
  const cfg = SD.config;
  const allAvgs = classStudents.map(s=>{
    const sid = s.id||SD.students.indexOf(s);
    const {avg}=calcStudentTermStats(sid,term,subs);
    return {name:s.name,avg};
  }).sort((a,b)=>b.avg-a.avg);

  const cards = classStudents.map(s=>{
    const sid = s.id||SD.students.indexOf(s);
    const termData = (SD.scores[term]||{})[sid]||{};
    const aff = ((SD.affective||{})[sid]||{})[term]||{};
    const myPos = (allAvgs.findIndex(r=>r.name===s.name)+1)||'–';
    const daysPresent = Object.values(SD.attendance||{}).filter(day=>day[s.name]==='Present').length;
    const rows = subs.map(sub=>{
      const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
      const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0); const tot=caT+(v.exam||0); const {g}=getGrade(tot);
      const subRanked = classStudents.map(st=>{
        const stid=st.id||SD.students.indexOf(st);
        const sv=((SD.scores[term]||{})[stid]||{})[sub]||{};
        return {name:st.name,tot:(sv.ca1||0)+(sv.ca2||0)+(sv.ca3||0)+(sv.exam||0)};
      }).sort((a,b)=>b.tot-a.tot);
      const sPos = (subRanked.findIndex(r=>r.name===s.name)+1)||'–';
      return `<tr><td>${esc(sub)}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td><td>${caT||''}</td><td>${v.exam||''}</td>
        <td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td><td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;
    }).join('');
    const totals = subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);
    const avg = totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
    const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
    const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
    const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';
    const affRows=affTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['aff_'+t]||0)}</td></tr>`).join('');
    const psyRows=psyTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['psy_'+t]||0)}</td></tr>`).join('');

    return `<div class="card-page" style="page-break-after:always;padding:18px;font-family:Arial,sans-serif;font-size:11.5px;color:#111;max-width:720px;margin:0 auto;">
      <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:10px;">
        <h1 style="font-size:17px;margin:3px 0;">${esc(cfg.schoolName||'School')}</h1>
        <h2 style="font-size:12px;margin:2px 0;color:#555;">Student Report Card — ${term} ${esc(cfg.session||'')}</h2>
        ${cfg.address?`<p style="font-size:10px;margin:1px 0;">${esc(cfg.address)}</p>`:''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px;">
        <div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div>
        <div><b>Admission No:</b> ${esc(s.admissionNo||'–')}</div><div><b>Term:</b> ${term}</div>
        <div><b>Days Opened:</b> ${cfg.daysOpened||'–'}</div><div><b>Days Present:</b> ${daysPresent}</div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0;text-align:center;">
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg||'–'}</div>Average</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg>0?getGrade(avg).g:'–'}</div>Grade</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${myPos}</div>Position</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${classStudents.length}</div>In Class</div></div>
      <div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin:6px 0 3px;">ACADEMIC PERFORMANCE</div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:8px;">
        <thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:3px 4px;text-align:left;">Subject</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">1st CA</th><th style="border:1px solid #bbb;padding:3px 2px;">2nd CA</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">3rd CA</th><th style="border:1px solid #bbb;padding:3px 2px;">CA/30</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">Exam/70</th><th style="border:1px solid #bbb;padding:3px 2px;font-weight:700;">Total/100</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">Grade</th><th style="border:1px solid #bbb;padding:3px 2px;">Pos.</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div style="display:flex;gap:5px;flex-wrap:wrap;font-size:9.5px;margin:4px 0 6px;">
        <b>Grades:</b>
        <span style="padding:1px 5px;border-radius:3px;background:#d1fae5;">A 70-100 Excellent</span>
        <span style="padding:1px 5px;border-radius:3px;background:#dbeafe;">B 60-69 Very Good</span>
        <span style="padding:1px 5px;border-radius:3px;background:#fef9c3;">C 50-59 Good</span>
        <span style="padding:1px 5px;border-radius:3px;background:#ffedd5;">D 40-49 Fair</span>
        <span style="padding:1px 5px;border-radius:3px;background:#fee2e2;">F 0-39 Fail</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <div><div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin-bottom:3px;">AFFECTIVE DOMAIN</div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;text-align:left;">Trait</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead><tbody>${affRows}</tbody></table></div>
        <div><div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin-bottom:3px;">PSYCHOMOTOR SKILLS</div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;text-align:left;">Skill</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead><tbody>${psyRows}</tbody></table></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Class Teacher's Remark:</b><br><br>____________________</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Principal's Comment:</b><br><br>____________________</div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;flex-wrap:wrap;gap:4px;">
        <div>Teacher's Signature: ______________</div><div>Principal's Signature: ______________</div>
        <div>Next Term Begins: ______________</div><div>Parent's Signature: ______________</div></div>
    </div>`;
  }).join('\n');

  const w = window.open('','_blank','width=820,height=900');
  if (!w) return alert('Please allow popups.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Cards – ${esc(cls)} – ${term}</title>
  <style>body{margin:0;padding:10px;background:#f5f5f5;}.card-page{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);margin-bottom:20px;}table td,table th{border:1px solid #bbb;padding:3px 4px;}
  @media print{body{background:none;padding:0;}.card-page{box-shadow:none;margin:0;page-break-after:always;}.no-print{display:none;}}</style>
  </head><body>
  <div class="no-print" style="position:sticky;top:0;background:#1e293b;color:white;padding:10px 16px;display:flex;align-items:center;gap:12px;z-index:999;font-family:sans-serif;">
    <span style="font-weight:700;">📋 ${classStudents.length} Report Cards — ${esc(cls)} · ${term}</span>
    <button onclick="window.print()" style="padding:6px 18px;background:#22c55e;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;">🖨️ Print All / Save PDF</button>
    <span style="font-size:11px;color:#94a3b8;">Tip: In print dialog → "Save as PDF" to get a digital copy</span></div>
  ${cards}
  </body></html>`);
  w.document.close();
}

// ── End-of-Term Wizard ────────────────────────────────────────────────
let _wizState = { cls:'', term:'', step:1 };

function renderWizard() {
  const el = $('scorecard-content'); if (!el) return;
  const classes = [...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const { cls, term, step } = _wizState;
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];

  if (step === 1) {
    const classOpts = classes.map(c=>`<option value="${esc(c)}" ${c===cls?'selected':''}>${esc(c)}</option>`).join('');
    el.innerHTML = `<div class="card" style="padding:1rem 0.75rem;max-width:440px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:1rem;">
        <div style="font-size:2rem;">📋</div>
        <div style="font-weight:800;font-size:1.05rem;">End-of-Term Wizard</div>
        <p style="color:var(--sub);font-size:0.8rem;margin-top:4px;">Close out the term in 3 steps — score entry, review rankings, print all cards.</p></div>
      <div style="display:flex;flex-direction:column;gap:0.6rem;">
        <div><label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Class</label><select id="wiz-class" style="width:100%;font-size:0.9rem;">${classOpts}</select></div>
        <div><label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Term to close</label>
          <select id="wiz-term" style="width:100%;font-size:0.9rem;">
            <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
            <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
            <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option></select></div>
        <button class="btn-brand" style="margin-top:0.4rem;padding:0.65rem;" onclick="wizNext1()">Let's go → Step 1: Enter Scores</button>
        <button class="btn-ghost" style="font-size:0.78rem;" onclick="renderScorecard()">← Back to Broadsheet</button>
      </div>
      <div style="margin-top:1rem;background:var(--s2);border-radius:8px;padding:0.6rem 0.75rem;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:4px;">WHAT THE WIZARD DOES</div>
        <div style="font-size:0.76rem;display:flex;flex-direction:column;gap:3px;">
          <div>✏️ <b>Step 1:</b> Enter scores for all subjects class by class</div>
          <div>📊 <b>Step 2:</b> Review computed rankings &amp; honours board</div>
          <div>🖨️ <b>Step 3:</b> Print all ${cls?SD.students.filter(s=>s.class===cls).length:''} report cards in one click</div></div>
      </div></div>`;
    return;
  }

  if (step === 2) {
    const classStudents = SD.students.filter(s=>s.class===cls);
    const totalSubs = subs.length;
    const subsDone = subs.filter(sub=>{
      return classStudents.some(s=>{
        const sid=s.id||SD.students.indexOf(s);
        const v=((SD.scores[term]||{})[sid]||{})[sub]||{};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;
      });
    }).length;
    const pct = Math.round(subsDone/totalSubs*100);
    const subChips = subs.map((sub,i)=>{
      const done = classStudents.some(s=>{
        const sid=s.id||SD.students.indexOf(s);
        const v=((SD.scores[term]||{})[sid]||{})[sub]||{};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;
      });
      return `<div onclick="wizOpenSubject(${i})" style="padding:3px 8px;border-radius:12px;font-size:0.7rem;cursor:pointer;border:1px solid ${done?'var(--money)':'var(--border)'};background:${done?'rgba(16,185,129,0.08)':'var(--s2)'};color:${done?'var(--money)':'var(--text)'};">${done?'✅':'○'} ${esc(sub)}</div>`;
    }).join('');

    el.innerHTML = `<div class="card" style="padding:0.75rem 0.5rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=1;renderWizard()">← Back</button>
        <div class="ct" style="margin:0;flex:1;">Step 1: Enter Scores — ${esc(cls)} · ${term}</div>
        <button class="btn-brand" style="padding:5px 12px;font-size:0.78rem;" onclick="wizStep3()">Next: Review Rankings →</button></div>
      <div style="background:var(--s2);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.65rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:0.78rem;font-weight:700;">${subsDone}/${totalSubs} subjects entered</span>
          <span style="font-size:0.76rem;color:var(--brand);font-weight:700;">${pct}%</span></div>
        <div style="background:var(--border);border-radius:6px;height:7px;"><div style="background:var(--brand);width:${pct}%;height:7px;border-radius:6px;transition:width 0.3s;"></div></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;">${subChips}</div>
      <p style="font-size:0.74rem;color:var(--sub);">Tap a subject above to open its score entry grid. Green = scores entered.</p>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;font-size:0.8rem;" onclick="wizOpenSubject(0)">✏️ Start with ${esc(subs[0])}</button>
        <button class="btn-ghost" style="font-size:0.78rem;" onclick="wizStep3()">Skip to Rankings →</button></div>
    </div>`;
    return;
  }

  if (step === 3) {
    const classStudents = SD.students.filter(s=>s.class===cls);
    const stats = classStudents.map(s=>{
      const sid=s.id||SD.students.indexOf(s);
      const {avg,count}=calcStudentTermStats(sid,term,subs);
      return {s,avg,count};
    }).sort((a,b)=>b.avg-a.avg);
    const entered = stats.filter(r=>r.count>0).length;
    const medals=['🥇','🥈','🥉'];
    const honours = stats.filter(r=>r.avg>0).slice(0,3).map((r,i)=>{
      const {g,col}=getGrade(r.avg);
      return `<div style="background:var(--s2);border-radius:10px;padding:0.6rem 0.75rem;text-align:center;flex:1;min-width:100px;border:1px solid var(--border);">
        <div style="font-size:1.5rem;">${medals[i]}</div><div style="font-weight:800;font-size:0.82rem;">${esc(r.s.name)}</div>
        <div style="font-size:0.76rem;color:${col};font-weight:700;">Avg: ${r.avg} · Grade ${g}</div></div>`;
    }).join('');
    const rankRows = stats.map((r,i)=>{
      const {g,col}=getGrade(r.avg); const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      return `<tr><td style="text-align:center;font-weight:700;color:${col};">${medal}${i+1}</td>
        <td style="font-size:0.78rem;font-weight:600;">${esc(r.s.name)}</td>
        <td style="text-align:center;font-weight:800;color:${col};">${r.avg||'–'}</td>
        <td style="text-align:center;"><span style="font-weight:700;color:${col};">${r.avg>0?g:'–'}</span></td></tr>`;
    }).join('');

    el.innerHTML = `<div class="card" style="padding:0.75rem 0.5rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=2;renderWizard()">← Back to Scores</button>
        <div class="ct" style="margin:0;flex:1;">Step 2: Rankings — ${esc(cls)} · ${term}</div></div>
      <p style="font-size:0.76rem;color:var(--sub);margin-bottom:0.65rem;">${entered}/${classStudents.length} students have scores entered</p>
      ${honours?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.75rem;">${honours}</div>`:''}
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:0.65rem;">
        <table class="stbl" style="font-size:0.78rem;"><thead><tr style="background:var(--s1);"><th style="width:36px;">#</th><th style="text-align:left;">Student</th><th>Average</th><th>Grade</th></tr></thead><tbody>${rankRows}</tbody></table></div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="flex:1;" onclick="_wizState.step=2;renderWizard()">← Fix Scores</button>
        <button class="btn-brand" style="flex:2;font-size:0.88rem;padding:0.65rem;" onclick="wizPrintAll()">🖨️ Print All ${classStudents.length} Report Cards →</button></div>
    </div>`;
    return;
  }
}

function wizNext1() {
  _wizState.cls = $('wiz-class')?.value || '';
  _wizState.term = $('wiz-term')?.value || 'Term 1';
  _wizState.step = 2; renderWizard();
}
function wizOpenSubject(subIdx) {
  const { cls, term } = _wizState;
  renderBulkScoreGrid(cls, term, subIdx);
  setTimeout(()=>{
    const backBtns = document.querySelectorAll('#scorecard-content button');
    backBtns.forEach(b=>{ if (b.textContent.includes('← Broadsheet')) {
      b.textContent='← Back to Wizard';
      b.onclick=()=>{_wizState.step=2;renderWizard();};
    }});
  },80);
}
function wizStep3() { _wizState.step=3; renderWizard(); }
function wizPrintAll() { const {cls,term}=_wizState; printAllReportCards(cls,term); }

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6 — Staff, Expenses, Attendance Modals, Score Modals
// ═══════════════════════════════════════════════════════════════════════

function renderStaff() {
  const staff = SD.staff || [];
  const isPrem = SD.config.plan === 'premium';
  const limit = isPrem ? '∞' : 3;
  if ($('staff-count')) $('staff-count').textContent = `${staff.length}/${limit} (${isPrem?'Premium':'Basic'})`;
  const el = $('staff-list'); if (!el) return;
  if (!staff.length) { el.innerHTML = '<p style="text-align:center;color:var(--sub);padding:2rem;">No staff added yet.</p>'; return; }
  el.innerHTML = staff.map((s,i) => `
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.88rem;">${esc(s.name)}</div>
        <div style="font-size:0.72rem;color:var(--sub);">${esc(s.email||'')} · ${esc(s.role||'')}${s.assignedClass?' · '+esc(s.assignedClass):''}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="editStaff(${i})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
        ${s.role!=='Principal'?`<button onclick="deleteStaff(${i})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#dc2626;white-space:nowrap;">🗑️</button>`:''}
      </div>
    </div>`).join('');
  const atLimit = !isPrem && staff.length >= 3;
  if ($('staff-upgrade')) $('staff-upgrade').style.display = atLimit ? 'block' : 'none';
}

async function addStaff() {
  const name = $('sf-name').value.trim(), email = $('sf-email').value.trim(), pwd = $('sf-pwd').value;
  const role = $('sf-role').value;
  const assignedClass = ($('sf-class')?.value || '').trim();
  const assignedSubjectsRaw = ($('sf-subjects')?.value || '').trim();
  const assignedSubjects = assignedSubjectsRaw ? assignedSubjectsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  if (!name || !email || !pwd) return alert('Fill all fields.');
  if (pwd.length < 4) return alert('Password min 4 chars.');
  if (role === 'Class Teacher' && !assignedClass) return alert('Assign a class for this Class Teacher.');
  if ((SD.staff||[]).find(s => s.email === email)) return alert('Email already registered.');
  const isPrem = SD.config.plan === 'premium';
  if (!isPrem && (SD.staff||[]).length >= 3) { openUpgradeModal(); return; }
  if (!SD.staff) SD.staff = [];
  SD.staff.push({ name, email, password: pwd, role, assignedClass: assignedClass||null, assignedSubjects });
  await SQ.push('staff', SD.staff);
  closeM('add-staff-modal');
  $('sf-name').value=''; $('sf-email').value=''; $('sf-pwd').value='';
  const sfc=$('sf-class'); if(sfc) sfc.value='';
  const sfs=$('sf-subjects'); if(sfs) sfs.value='';
  renderStaff();
  alert(`✅ ${name} added as ${role}${assignedClass?' ('+assignedClass+')':''}.`);
}

function onRoleChange(sel) {
  const role = sel.value;
  const classRow = $('sf-class-row'); if (classRow) classRow.style.display = role==='Class Teacher'?'block':'none';
  const subjectRow = $('sf-subjects-row'); if (subjectRow) subjectRow.style.display = role==='Subject Teacher'?'block':'none';
}

function editStaff(idx) {
  const s = (SD.staff||[])[idx]; if (!s) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Staff</div>
      <label>Full Name</label><input id="est-name" value="${esc(s.name||'')}">
      <label>Email</label><input id="est-email" value="${esc(s.email||'')}">
      <label>Role</label>
      <select id="est-role">${['Class Teacher','Subject Teacher','Bursar','Principal'].map(r=>`<option value="${r}" ${s.role===r?'selected':''}>${r}</option>`).join('')}</select>
      <label>Assigned Class</label><input id="est-class" value="${esc(s.assignedClass||'')}" placeholder="e.g. JSS 1A">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditStaff(${idx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-staff-modal')">Cancel</button>
      </div>
    </div>`;
  let m = $('edit-staff-modal');
  if (!m) {
    m = document.createElement('div'); m.id='edit-staff-modal'; m.className='modal';
    m.innerHTML=`<div class="mbox"><button class="mclose" onclick="closeM('edit-staff-modal')">✕</button><div id="edit-staff-modal-body"></div></div>`;
    document.body.appendChild(m);
  }
  $('edit-staff-modal-body').innerHTML = html;
  openM('edit-staff-modal');
}

async function saveEditStaff(idx) {
  const s = (SD.staff||[])[idx]; if (!s) return;
  s.name  = $('est-name').value.trim() || s.name;
  s.email = $('est-email').value.trim() || s.email;
  s.role  = $('est-role').value;
  s.assignedClass = $('est-class').value.trim() || null;
  await SQ.push('staff', SD.staff); saveLocal('staff', SD.staff);
  closeM('edit-staff-modal'); renderStaff(); toast('✅ Staff updated!');
}

async function deleteStaff(idx) {
  const s = (SD.staff||[])[idx]; if (!s) return;
  if (!confirm(`Remove ${s.name} from staff?`)) return;
  SD.staff.splice(idx,1);
  await SQ.push('staff',SD.staff); saveLocal('staff',SD.staff);
  renderStaff(); toast('🗑️ Staff removed.');
}

// ── Expenses ─────────────────────────────────────────────────────────────
function renderExpenses() {
  const exp = SD.expenses || [];
  let total = 0; exp.forEach(e => total += (e.amount||0));
  if ($('exp-total')) $('exp-total').textContent = fmt(total);
  const el = $('exp-list'); if (!el) return;
  if (!exp.length) { el.innerHTML = '<p style="text-align:center;color:var(--sub);padding:2rem;">No expenses logged yet.</p>'; return; }
  el.innerHTML = exp.map((e,i) => `
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;font-weight:600;">${esc(e.description||'')}</div>
        <div style="font-size:0.7rem;color:var(--sub);">${esc(e.category||'')} · ${esc(e.date||'')}</div>
      </div>
      <strong style="font-family:'DM Mono',monospace;color:var(--danger);font-size:0.82rem;flex-shrink:0;">${fmt(e.amount||0)}</strong>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="editExpense(${i})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
        <button onclick="deleteExpenseItem(${i})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️ Del</button>
      </div>
    </div>`).join('');
}

async function addExpense() {
  const cat=$('exp-cat').value, desc=$('exp-desc').value.trim(), amt=parseFloat($('exp-amt').value);
  if (!desc||!amt) return alert('Fill description and amount.');
  if (!SD.expenses) SD.expenses=[];
  SD.expenses.unshift({ category:cat, description:desc, amount:amt, date:new Date().toISOString().split('T')[0], by:userRole });
  await SQ.push('expenses',SD.expenses); closeM('add-expense-modal');
  $('exp-desc').value=''; $('exp-amt').value=''; renderExpenses();
}

function editExpense(idx) {
  const e = (SD.expenses||[])[idx]; if (!e) return;
  const cats=['Staff Salaries','Utilities (NEPA/Generator)','Building Maintenance','Teaching Materials','Government/Ministry Fees','Cleaning & Security','Transport','Examination Fees','Other'];
  const html=`
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Expense</div>
      <label>Category</label><select id="ee-cat">${cats.map(c=>`<option ${c===e.category?'selected':''}>${c}</option>`).join('')}</select>
      <label>Description</label><input id="ee-desc" value="${esc(e.description||'')}">
      <label>Amount (₦)</label><input id="ee-amt" type="number" value="${e.amount||''}">
      <label>Date</label><input id="ee-date" type="date" value="${e.date||''}">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditExpense(${idx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-expense-modal')">Cancel</button>
      </div>
    </div>`;
  let m=$('edit-expense-modal');
  if (!m) {
    m=document.createElement('div'); m.id='edit-expense-modal'; m.className='modal';
    m.innerHTML=`<div class="mbox"><button class="mclose" onclick="closeM('edit-expense-modal')">✕</button><div id="edit-expense-modal-body"></div></div>`;
    document.body.appendChild(m);
  }
  $('edit-expense-modal-body').innerHTML=html; openM('edit-expense-modal');
}

async function saveEditExpense(idx) {
  const e=(SD.expenses||[])[idx]; if(!e) return;
  e.category=$('ee-cat').value; e.description=$('ee-desc').value.trim()||e.description;
  e.amount=parseFloat($('ee-amt').value)||e.amount; e.date=$('ee-date').value||e.date;
  await SQ.push('expenses',SD.expenses); saveLocal('expenses',SD.expenses);
  closeM('edit-expense-modal'); renderExpenses(); toast('✅ Expense updated!');
}

async function deleteExpenseItem(idx) {
  if (!confirm('Delete this expense?')) return;
  SD.expenses.splice(idx,1);
  await SQ.push('expenses',SD.expenses); saveLocal('expenses',SD.expenses);
  renderExpenses(); toast('🗑️ Expense deleted.');
}

// ── Class Attendance Modal ─────────────────────────────────────────────────
function openClassAttendance() { populateClassAttendanceSelectors(); openM('class-att-modal'); }

function populateClassAttendanceSelectors() {
  const sel=$('ca-class-sel'); if(!sel) return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  sel.innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const dateInput=$('ca-date'); if(dateInput&&!dateInput.value) dateInput.value=new Date().toISOString().split('T')[0];
  renderClassRoll();
}

function renderClassRoll() {
  const cls=$('ca-class-sel')?.value, date=$('ca-date')?.value, listEl=$('ca-list');
  if(!cls||!date||!listEl) return;
  const classStudents=SD.students.filter(s=>s.class===cls);
  if(!classStudents.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1rem;">No students in this class.</p>';return;}
  const att=SD.attendance[date]||{};
  let present=0,absent=0,late=0;
  listEl.innerHTML=classStudents.map(s=>{
    const status=att[s.name]||'Present';
    if(status==='Present')present++;else if(status==='Absent')absent++;else if(status==='Late')late++;
    const ap=status==='Present'?'ca-btn-active-p':'';
    const aa=status==='Absent'?'ca-btn-active-a':'';
    const al=status==='Late'?'ca-btn-active-l':'';
    return `<div class="ca-row"><div class="ca-name">${esc(s.name)}</div>
      <div class="ca-btns">
        <button class="ca-btn ${ap}" onclick="setRollStatus('${esc(s.name)}','Present',this)">✅</button>
        <button class="ca-btn ${aa}" onclick="setRollStatus('${esc(s.name)}','Absent',this)">✕</button>
        <button class="ca-btn ${al}" onclick="setRollStatus('${esc(s.name)}','Late',this)">⏰</button>
      </div></div>`;
  }).join('');
  if($('ca-summary')) $('ca-summary').textContent=`Present: ${present} · Absent: ${absent} · Late: ${late}`;
}

function setRollStatus(name,status,btnEl){
  const row=btnEl.closest('.ca-row'); if(!row) return;
  row.querySelectorAll('.ca-btn').forEach(b=>b.classList.remove('ca-btn-active-p','ca-btn-active-a','ca-btn-active-l'));
  if(status==='Present')btnEl.classList.add('ca-btn-active-p');
  else if(status==='Absent')btnEl.classList.add('ca-btn-active-a');
  else if(status==='Late')btnEl.classList.add('ca-btn-active-l');
  updateRollSummary();
}

function updateRollSummary(){
  let present=0,absent=0,late=0;
  document.querySelectorAll('.ca-row').forEach(row=>{
    const btns=row.querySelectorAll('.ca-btn');
    if(btns[0]?.classList.contains('ca-btn-active-p'))present++;
    else if(btns[1]?.classList.contains('ca-btn-active-a'))absent++;
    else if(btns[2]?.classList.contains('ca-btn-active-l'))late++;
  });
  if($('ca-summary')) $('ca-summary').textContent=`Present: ${present} · Absent: ${absent} · Late: ${late}`;
}

function markAllPresent(){document.querySelectorAll('.ca-row').forEach(row=>row.querySelectorAll('.ca-btn')[0]?.click());}
function markAllAbsent(){document.querySelectorAll('.ca-row').forEach(row=>row.querySelectorAll('.ca-btn')[1]?.click());}

async function saveClassAttendance(){
  const date=$('ca-date')?.value; if(!date) return;
  if(!SD.attendance[date]) SD.attendance[date]={};
  document.querySelectorAll('.ca-row').forEach(row=>{
    const name=row.querySelector('.ca-name')?.textContent;
    const btns=row.querySelectorAll('.ca-btn');
    let status='Present';
    if(btns[1]?.classList.contains('ca-btn-active-a'))status='Absent';
    else if(btns[2]?.classList.contains('ca-btn-active-l'))status='Late';
    if(name) SD.attendance[date][name]=status;
  });
  await SQ.push('attendance',SD.attendance); saveLocal('attendance',SD.attendance);
  toast('✅ Attendance saved.'); closeM('class-att-modal');
}

// ════════════════════════════════════════════════════════════════════════
// ATTENDANCE ALERT SYSTEM — Absence · Late · Early Departure · Resumption
// ════════════════════════════════════════════════════════════════════════

// ── Notify parents of ABSENT students ───────────────────────────────────
async function notifyAbsentParents() {
  const date = $('ca-date')?.value;
  const cls  = $('ca-class-sel')?.value;
  if (!date || !cls) return;

  const classStudents = SD.students.filter(s => s.class === cls);
  const att = SD.attendance[date] || {};
  const absentees = classStudents.filter(s => att[s.name] === 'Absent');
  const lateOnes  = classStudents.filter(s => att[s.name] === 'Late');

  if (!absentees.length && !lateOnes.length) {
    toast('✅ No absences or late arrivals to report!');
    return;
  }

  const school = SD.config?.schoolName || 'Our School';
  const displayDate = new Date(date).toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long' });
  let sent = 0;

  // Absent notifications
  absentees.forEach(function(s, i) {
    if (!s.phone) return;
    const msg = encodeURIComponent(
      'Dear Parent / Guardian,\n\n' +
      '*' + school + '* 🌸\n\n' +
      'This is to inform you that *' + s.name + '* (' + (s.class||'') + ') was *ABSENT* from school today, *' + displayDate + '*.\n\n' +
      'If this was unplanned, please contact the class teacher or front desk immediately.\n\n' +
      'If your child is unwell, kindly send a note tomorrow.\n\n' +
      '— EduBloom Comms Agent'
    );
    setTimeout(function() {
      window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + msg, '_blank');
    }, i * 1200);
    sent++;
  });

  // Late notifications
  lateOnes.forEach(function(s, i) {
    if (!s.phone) return;
    const delay = (absentees.length + i) * 1200;
    const msg = encodeURIComponent(
      'Dear Parent / Guardian,\n\n' +
      '*' + school + '* 🌸\n\n' +
      '*' + s.name + '* (' + (s.class||'') + ') arrived *LATE* to school today, *' + displayDate + '*.\n\n' +
      'Kindly ensure your child leaves home earlier to avoid missing morning lessons.\n\n' +
      'Thank you for your cooperation.\n\n' +
      '— EduBloom Comms Agent'
    );
    setTimeout(function() {
      window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + msg, '_blank');
    }, delay);
    sent++;
  });

  toast('📲 Sending alerts to ' + sent + ' parent(s)...');
  logComm('Attendance Alert', 'Absent: ' + absentees.length + ' · Late: ' + lateOnes.length + ' · Date: ' + date);
  BloomAgents._log('📚 Teacher Agent', 'Attendance alerts sent', absentees.length + ' absent · ' + lateOnes.length + ' late · ' + date);
}

// ── Morning check — all classes combined ─────────────────────────────────
function checkMorningAbsentees() {
  const date = new Date().toISOString().split('T')[0];
  const att  = SD.attendance[date] || {};
  const school = SD.config?.schoolName || 'Our School';
  const displayDate = new Date(date).toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long' });

  const absentList = Object.keys(att).filter(name => att[name] === 'Absent');
  const lateList   = Object.keys(att).filter(name => att[name] === 'Late');

  if (!absentList.length && !lateList.length) {
    toast('✅ No absences or late arrivals recorded today.');
    return;
  }

  if (!confirm(
    'Send attendance alerts for today (' + displayDate + ')?\n\n' +
    '❌ Absent: ' + absentList.length + ' student(s)\n' +
    '⏰ Late: '   + lateList.length   + ' student(s)'
  )) return;

  let sent = 0;
  const allToAlert = [
    ...absentList.map(name => ({ name, status: 'Absent' })),
    ...lateList.map(name   => ({ name, status: 'Late'   }))
  ];

  allToAlert.forEach(function(entry, i) {
    const s = SD.students.find(x => x.name === entry.name);
    if (!s || !s.phone) return;
    const isAbsent = entry.status === 'Absent';
    const msg = encodeURIComponent(
      'Dear Parent / Guardian,\n\n' +
      '*' + school + '* 🌸\n\n' +
      '*' + s.name + '* (' + (s.class||'') + ') was marked *' + (isAbsent ? 'ABSENT ❌' : 'LATE ⏰') + '* today, *' + displayDate + '*.\n\n' +
      (isAbsent
        ? 'Please contact the school if this was unplanned.\n'
        : 'Kindly ensure earlier departure from home tomorrow.\n') +
      '\n— EduBloom Comms Agent'
    );
    setTimeout(function() {
      window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + msg, '_blank');
    }, i * 1200);
    sent++;
  });

  toast('📲 Sending ' + sent + ' attendance alerts...');
  logComm('Morning Attendance Broadcast', absentList.length + ' absent · ' + lateList.length + ' late');
}

// ── Late Resumption Alert — school reopening after break ─────────────────
function sendLateResumptionAlert() {
  openM('resumption-alert-modal');
}

function confirmResumptionAlert() {
  const msg     = $('resumption-msg')?.value.trim();
  const dateStr = $('resumption-date')?.value;
  if (!msg || !dateStr) { toast('Fill in the message and date.'); return; }

  const school = SD.config?.schoolName || 'Our School';
  const displayDate = new Date(dateStr).toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const students = SD.students || [];
  const withPhone = students.filter(s => s.phone);
  if (!withPhone.length) { toast('No parent contacts found.'); return; }

  const fullMsg = encodeURIComponent(
    'Dear Parent / Guardian,\n\n' +
    '*' + school + '* 🌸\n\n' +
    '📢 *RESUMPTION NOTICE*\n\n' +
    msg + '\n\n' +
    '📅 *Resumption Date: ' + displayDate + '*\n\n' +
    'Please ensure your child reports to school on time.\n\n' +
    '— EduBloom Comms Agent'
  );

  if (!confirm('Send resumption notice to ' + withPhone.length + ' parents?')) return;
  closeM('resumption-alert-modal');

  withPhone.forEach(function(s, i) {
    setTimeout(function() {
      window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + fullMsg, '_blank');
    }, i * 1200);
  });

  toast('📲 Resumption notice going to ' + withPhone.length + ' parents...');
  logComm('Resumption Notice', 'Date: ' + displayDate + ' — sent to ' + withPhone.length + ' parents');
  BloomAgents._log('📢 Comms Agent', 'Resumption notice sent', displayDate + ' · ' + withPhone.length + ' parents');
}

// ════════════════════════════════════════════════════════════════════════
// EARLY DEPARTURE SYSTEM
// A student wanting to leave before closing time MUST be verified:
// 1. Record the early departure with reason
// 2. Notify parent instantly via WhatsApp
// 3. Verify who is collecting (security check)
// 4. Log in incident record
// ════════════════════════════════════════════════════════════════════════

function openEarlyDeparture(studentName) {
  // Pre-fill name if passed (e.g. called from student profile)
  if (studentName && $('early-dep-student')) $('early-dep-student').value = studentName;
  // Set default time to now
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  if ($('early-dep-time')) $('early-dep-time').value = hh + ':' + mm;
  // Populate datalist with student names
  const dl = document.getElementById('student-names-datalist');
  if (dl) {
    dl.innerHTML = (SD.students||[]).map(function(s){ return '<option value="' + esc(s.name) + '">'; }).join('');
  }
  $('early-dep-result').style.display = 'none';
  openM('early-departure-modal');
}

async function processEarlyDeparture() {
  const studentName = $('early-dep-student')?.value.trim();
  const reason      = $('early-dep-reason')?.value.trim();
  const collectedBy = $('early-dep-collector')?.value.trim();
  const timeStr     = $('early-dep-time')?.value || new Date().toTimeString().slice(0,5);

  if (!studentName || !reason) { toast('Student name and reason are required.'); return; }

  const s = (SD.students || []).find(x => x.name && x.name.toLowerCase().includes(studentName.toLowerCase()));
  const school = SD.config?.schoolName || 'Our School';
  const today  = new Date().toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long' });

  // Security check — verify collector if provided
  let securityNote = '';
  if (collectedBy) {
    const verify = SecurityAgent.verifyCollector(studentName, collectedBy);
    if (verify.ok === false) {
      const resultEl = $('early-dep-result');
      resultEl.style.display   = 'block';
      resultEl.style.background = 'rgba(239,68,68,0.12)';
      resultEl.style.border    = '1.5px solid rgba(239,68,68,0.5)';
      resultEl.style.color     = '#ef4444';
      resultEl.innerHTML = '🚫 <strong>STOP — DO NOT RELEASE</strong><br>' + esc(verify.reason) + '<br><span style="font-size:0.72rem;">Authorised: ' + esc(verify.authorised||'None listed') + '</span>';
      // Log the attempt
      SecurityAgent.logUnauthorizedPickup(studentName, collectedBy);
      return;
    }
    if (verify.ok === null) securityNote = '⚠️ Collector not verified — parent was called to confirm.';
    if (verify.ok === true)  securityNote = '✅ Verified collector: ' + collectedBy;
  }

  // Log the early departure
  const entry = {
    type:         'early_departure',
    student:      s ? s.name : studentName,
    class:        s ? (s.class||'') : '',
    reason:       reason,
    collectedBy:  collectedBy || 'Self / walked',
    time:         timeStr,
    date:         new Date().toISOString().split('T')[0],
    securityNote: securityNote,
    approvedBy:   userRole || 'Staff'
  };
  SD.securityLog = SD.securityLog || [];
  SD.securityLog.unshift(entry);
  SQ.push('securityLog', SD.securityLog);

  // WhatsApp parent notification
  if (s && s.phone) {
    const msg = encodeURIComponent(
      'Dear Parent / Guardian,\n\n' +
      '*' + school + '* 🌸\n\n' +
      '📢 *EARLY DEPARTURE NOTICE*\n\n' +
      '*' + (s.name) + '* (' + (s.class||'') + ') left school early today (' + today + ') at *' + timeStr + '*.\n\n' +
      '📌 Reason: *' + reason + '*\n' +
      (collectedBy ? '👤 Collected by: *' + collectedBy + '*\n' : '') +
      (securityNote ? '\n' + securityNote + '\n' : '') +
      '\nIf you did NOT authorise this, please call the school immediately.\n\n' +
      '— EduBloom Security Agent'
    );
    window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + msg, '_blank');
  }

  BloomAgents._log('🔒 Security Agent', 'Early departure: ' + (s?.name||studentName), 'Time: ' + timeStr + ' · Reason: ' + reason + (collectedBy ? ' · By: ' + collectedBy : ''));

  // Show success
  const resultEl = $('early-dep-result');
  resultEl.style.display   = 'block';
  resultEl.style.background = 'rgba(34,197,94,0.1)';
  resultEl.style.border    = '1.5px solid rgba(34,197,94,0.3)';
  resultEl.style.color     = '#22c55e';
  resultEl.innerHTML = '✅ Logged & parent notified via WhatsApp.<br><span style="font-size:0.72rem;color:var(--sub);">' + (securityNote||'No security flags.') + '</span>';

  // Clear form
  if ($('early-dep-reason'))    $('early-dep-reason').value = '';
  if ($('early-dep-collector')) $('early-dep-collector').value = '';

  renderSecurityLog();
  toast('✅ Early departure logged. Parent alerted.');
}

// ── Subject Scores Modal ──────────────────────────────────────────────────
function openSubjectScores(){populateSubjectScoresSelectors();openM('subj-scores-modal');}

function populateSubjectScoresSelectors(){
  const clsSel=$('ss-class-sel'),subjSel=$('ss-subj-sel'); if(!clsSel||!subjSel) return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  clsSel.innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  subjSel.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  renderSubjectScoreList();
}

function renderSubjectScoreList(){
  const cls=$('ss-class-sel')?.value,sub=$('ss-subj-sel')?.value,listEl=$('ss-list');
  if(!cls||!sub||!listEl) return;
  const classStudents=SD.students.filter(s=>s.class===cls);
  if(!classStudents.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1rem;">No students in this class.</p>';return;}
  const term=SD.config.currentTerm||'Term 1';
  const termScores=SD.scores[term]||{};
  listEl.innerHTML=`<div class="ss-row" style="font-weight:700;border-bottom:2px solid var(--border);">
    <div>Student Name</div><div style="text-align:center;">CA/30</div><div style="text-align:center;">Exam/70</div><div style="text-align:center;">Total</div></div>`
    +classStudents.map(s=>{
      const sid=s.id||SD.students.indexOf(s);
      const scoreRecord=termScores[sid]?.[sub]||{};
      // Support both term-based (ca1+ca2+ca3) and any imported flat ca field
      const caVal=scoreRecord.ca!==undefined?scoreRecord.ca:((scoreRecord.ca1||0)+(scoreRecord.ca2||0)+(scoreRecord.ca3||0))||'';
      const examVal=scoreRecord.exam!==undefined?scoreRecord.exam:'';
      const tot=(parseInt(caVal)||0)+(parseInt(examVal)||0);
      return `<div class="ss-row" data-sid="${sid}">
        <div style="font-weight:600;font-size:0.8rem;">${esc(s.name)}</div>
        <div><input type="number" min="0" max="30" class="ss-inp ca-input" value="${caVal}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div><input type="number" min="0" max="70" class="ss-inp exam-input" value="${examVal}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div class="ss-tot">${tot||'–'}</div></div>`;
    }).join('');
}

function recalcSSTotal(inputEl){
  const row=inputEl.closest('.ss-row'); if(!row) return;
  const ca=parseInt(row.querySelector('.ca-input').value)||0;
  const exam=parseInt(row.querySelector('.exam-input').value)||0;
  row.querySelector('.ss-tot').textContent=(ca+exam)||'–';
}

async function saveSubjectScores(){
  const cls=$('ss-class-sel')?.value,sub=$('ss-subj-sel')?.value;
  const term=SD.config.currentTerm||'Term 1',listEl=$('ss-list');
  if(!cls||!sub||!listEl) return;
  if(!SD.scores[term]) SD.scores[term]={};
  listEl.querySelectorAll('.ss-row[data-sid]').forEach(row=>{
    const sid=row.getAttribute('data-sid');
    const ca=parseInt(row.querySelector('.ca-input').value)||0;
    const exam=parseInt(row.querySelector('.exam-input').value)||0;
    if(!SD.scores[term][sid]) SD.scores[term][sid]={};
    // Store as ca1 so canonical model stays consistent; ca2/ca3 remain 0 for manual entry
    SD.scores[term][sid][sub]={ca1:ca,ca2:0,ca3:0,exam};
  });
  await SQ.push('scores',SD.scores); saveLocal('scores',SD.scores);
  toast('✅ Scores Saved.'); closeM('subj-scores-modal');
  if(typeof renderScorecard==='function') renderScorecard();
}

// ── Score OCR Modal ───────────────────────────────────────────────────────
function openScoreOCR(){populateScoreOCRSelectors();openM('score-ocr-modal');}

function populateScoreOCRSelectors(){
  const clsSel=$('socr-class'),subjSel=$('socr-subj'); if(!clsSel||!subjSel) return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  clsSel.innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  subjSel.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
}
function socrPickPhoto(){$('socr-img-input')?.click();}

async function socrHandleImage(event){
  const file=event.target.files[0]; if(!file) return;
  const statusEl=$('socr-status');
  if(statusEl) statusEl.innerHTML='<span style="color:var(--brand);">⏳ Reading score sheet with Gemini...</span>';
  const reader=new FileReader();
  reader.onload=async ev=>{
    const b64=ev.target.result.split(',')[1];
    const mime=file.type||'image/jpeg';
    const cls=$('socr-class')?.value;
    const sub=$('socr-subj')?.value;
    const classStudents=SD.students.filter(s=>s.class===cls);
    if(!classStudents.length){if(statusEl)statusEl.innerHTML='<span style="color:var(--danger);">No students in this class.</span>';return;}
    try {
      // Use Gemini to extract names + scores from score sheet
      const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
      const prompt=`Extract student names and their scores from this Nigerian school score sheet for subject: ${sub}.
Return ONLY valid JSON array:
[{"name":"Adaeze Okonkwo","ca":25,"exam":58},...]
CA is continuous assessment (0-30 or 0-40), exam is exam score (0-60 or 0-70).
Match names exactly as written. If you cannot read a score, use 0.`;
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        contents:[{parts:[{inline_data:{mime_type:mime,data:b64}},{text:prompt}]}]
      })});
      const d=await r.json();
      const raw=d.candidates?.[0]?.content?.parts?.[0]?.text||'[]';
      const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
      if(parsed.length){
        if(statusEl) statusEl.innerHTML=`<span style="color:var(--money);">✅ Gemini found ${parsed.length} entries. Review below:</span>`;
        let pHTML=`<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:0.5rem;padding:0.5rem;">
          <table class="stbl" style="font-size:0.75rem;"><thead><tr><th>Student Name</th><th>CA</th><th>Exam</th></tr></thead><tbody>`;
        parsed.forEach(item=>{
          pHTML+=`<tr class="socr-preview-row" data-name="${esc(item.name)}">
            <td><b>${esc(item.name)}</b></td>
            <td><input type="number" class="socr-ca-val" value="${item.ca||0}" style="width:50px;padding:3px;margin:0;"></td>
            <td><input type="number" class="socr-exam-val" value="${item.exam||0}" style="width:50px;padding:3px;margin:0;"></td>
          </tr>`;
        });
        pHTML+=`</tbody></table></div>`;
        const previewEl=$('socr-preview'); if(previewEl) previewEl.innerHTML=pHTML;
        const saveBtn=$('socr-save-btn'); if(saveBtn) saveBtn.style.display='block';
        return;
      }
    } catch(e){console.warn('Gemini score OCR failed:',e);}
    // Fallback: show manual grid
    if(statusEl) statusEl.innerHTML='<span style="color:var(--warn);">Could not auto-read. Please enter scores manually below:</span>';
    let pHTML=`<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:0.5rem;padding:0.5rem;">
      <table class="stbl" style="font-size:0.75rem;"><thead><tr><th>Student Name</th><th>CA/30</th><th>Exam/70</th></tr></thead><tbody>`;
    classStudents.forEach(s=>{
      pHTML+=`<tr class="socr-preview-row" data-name="${esc(s.name)}">
        <td><b>${esc(s.name)}</b></td>
        <td><input type="number" class="socr-ca-val" value="" style="width:50px;padding:3px;margin:0;" placeholder="0"></td>
        <td><input type="number" class="socr-exam-val" value="" style="width:50px;padding:3px;margin:0;" placeholder="0"></td>
      </tr>`;
    });
    pHTML+=`</tbody></table></div>`;
    const previewEl=$('socr-preview'); if(previewEl) previewEl.innerHTML=pHTML;
    const saveBtn=$('socr-save-btn'); if(saveBtn) saveBtn.style.display='block';
  };
  reader.readAsDataURL(file);
}

async function socrSaveScores(){
  const cls=$('socr-class')?.value,sub=$('socr-subj')?.value;
  const termMap={'1':'Term 1','2':'Term 2','3':'Term 3'};
  const term=termMap[$('socr-term')?.value]||'Term 1';
  if(!SD.scores[term]) SD.scores[term]={};
  document.querySelectorAll('.socr-preview-row').forEach(row=>{
    const name=row.getAttribute('data-name');
    const ca=parseInt(row.querySelector('.socr-ca-val')?.value)||0;
    const exam=parseInt(row.querySelector('.socr-exam-val')?.value)||0;
    // Find student by name
    const s=SD.students.find(st=>st.name===name||esc(st.name)===name);
    if(!s) return;
    const sid=s.id||SD.students.indexOf(s);
    if(!SD.scores[term][sid]) SD.scores[term][sid]={};
    SD.scores[term][sid][sub]={ca1:ca,ca2:0,ca3:0,exam};
  });
  await SQ.push('scores',SD.scores); saveLocal('scores',SD.scores);
  toast('✅ Scores saved.'); closeM('score-ocr-modal');
  if(typeof renderScorecard==='function') renderScorecard();
}

// ── Script Scan Modal ─────────────────────────────────────────────────────
function openScriptScan(){populateScriptScanSelectors();openM('script-scan-modal');}

function populateScriptScanSelectors(){
  const subjSel=$('scan-subj'); if(!subjSel) return;
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  subjSel.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
}
function scanSubjChanged(){const s=$('scan-status');if(s)s.textContent=`Ready to scan ${$('scan-subj')?.value||''} papers.`;}
function triggerScriptScan(){$('scan-img-input')?.click();}

let _scannedQueue=[];
async function handleScriptImage(event){
  const file=event.target.files[0]; if(!file) return;
  const statusEl=$('scan-status');
  if(statusEl) statusEl.innerHTML='<span style="color:var(--brand);">⏳ Gemini is reading the marked script...</span>';
  const reader=new FileReader();
  reader.onload=async ev=>{
    const b64=ev.target.result.split(',')[1];
    const mime=file.type||'image/jpeg';
    const sub=$('scan-subj')?.value||'';
    try {
      const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
      const prompt=`This is a Nigerian student examination script for subject: ${sub}.
Read the student's name (usually written at the top) and their total score/marks.
Return ONLY valid JSON: {"name":"Student Full Name","score":72}
If you cannot read the name, use "Unknown". If you cannot read the score, use 0.`;
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        contents:[{parts:[{inline_data:{mime_type:mime,data:b64}},{text:prompt}]}]
      })});
      const d=await r.json();
      const raw=d.candidates?.[0]?.content?.parts?.[0]?.text||'{"name":"Unknown","score":0}';
      const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const term=SD.config.currentTerm||'Term 1';
      _scannedQueue.push({name:parsed.name,score:parsed.score||0,sub,term});
      if(statusEl) statusEl.innerHTML=`<span style="color:var(--money);">✅ Read: <b>${esc(parsed.name)}</b> — Score: <b>${parsed.score}</b></span>`;
      const countEl=$('scan-queue-count'); if(countEl) countEl.textContent=`${_scannedQueue.length} script${_scannedQueue.length!==1?'s':''} scanned this session`;
      const resultEl=$('scan-result');
      if(resultEl) resultEl.innerHTML=`<div class="card" style="margin-top:0.5rem;padding:0.6rem;background:var(--s2);">
        <div style="font-weight:700;font-size:0.85rem;color:var(--brand);">📄 Script Read</div>
        <div style="font-size:0.8rem;margin:4px 0;"><b>Name:</b> ${esc(parsed.name)}</div>
        <div style="font-size:0.8rem;"><b>Score:</b> ${parsed.score} / 100</div></div>`;
    } catch(e){
      if(statusEl) statusEl.innerHTML='<span style="color:var(--danger);">Could not read script. Try a clearer photo.</span>';
    }
  };
  reader.readAsDataURL(file);
}

async function finishScriptScan(){
  if(!_scannedQueue.length){closeM('script-scan-modal');return;}
  for(const item of _scannedQueue){
    const term=item.term||SD.config.currentTerm||'Term 1';
    if(!SD.scores[term]) SD.scores[term]={};
    // Match student by name (fuzzy)
    const s=SD.students.find(st=>st.name.toLowerCase()===item.name.toLowerCase())
      ||SD.students.find(st=>st.name.toLowerCase().includes(item.name.toLowerCase().split(' ')[0]));
    if(!s) continue;
    const sid=s.id||SD.students.indexOf(s);
    if(!SD.scores[term][sid]) SD.scores[term][sid]={};
    // Store exam score; keep any existing CA scores
    const existing=SD.scores[term][sid][item.sub]||{ca1:0,ca2:0,ca3:0,exam:0};
    SD.scores[term][sid][item.sub]={...existing,exam:item.score};
  }
  await SQ.push('scores',SD.scores); saveLocal('scores',SD.scores);
  toast(`✅ Saved ${_scannedQueue.length} scripts!`);
  _scannedQueue=[];
  const countEl=$('scan-queue-count'); if(countEl) countEl.textContent='';
  const resultEl=$('scan-result'); if(resultEl) resultEl.innerHTML='';
  closeM('script-scan-modal');
  if(typeof renderScorecard==='function') renderScorecard();
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7 — Sports, Arts, Music, Health, Alumni, Comms, Finance, Analytics
// ═══════════════════════════════════════════════════════════════════════

// ── Birthdays Widget (v2) ──────────────────────────────────────────────────
function renderBirthdays(){
  const widget=$('birthday-widget'); if(!widget) return;
  const today=new Date().toISOString().slice(5,10);
  const celebrants=SD.students.filter(s=>s.dob&&s.dob.slice(5,10)===today);
  if(!celebrants.length){widget.style.display='none';return;}
  widget.style.cssText='background:linear-gradient(135deg,#fdf2f8,#fce7f3);border:1px solid #fbcfe8;border-radius:12px;padding:0.75rem 1rem;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;';
  widget.innerHTML=`<div style="font-size:0.8rem;color:#9d174d;line-height:1.4;">🎉 <b>Today's Celebrant${celebrants.length>1?'s':''}:</b> ${celebrants.map(c=>`<b>${esc(c.name)}</b> (${esc(c.class||'—')})`).join(', ')}!</div>
    <button onclick="sendBulkBirthdayWishes()" style="background:#ec4899;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;">Wish Parent</button>`;
}

function sendBulkBirthdayWishes(){
  const today=new Date().toISOString().slice(5,10);
  const celebrants=SD.students.filter(s=>s.dob&&s.dob.slice(5,10)===today);
  const sn=SD.config.schoolName||'School';
  celebrants.forEach(c=>{
    if(c.phone){
      const msg=`Dear Parent,\n\nWe celebrate *${c.name}* on their birthday today! 🎂\n\nWe wish them long life and success.\n\nBest regards,\n*${sn}*`;
      window.open(`https://wa.me/${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
    }
  });
}

// ── Bulk WA / RC Sequence ─────────────────────────────────────────────────
let _bulkWAIdx=0,_bulkWAStudents=[];
function startBulkWA(){
  _bulkWAStudents=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0&&s.phone);
  if(!_bulkWAStudents.length) return alert('No owing students with registered phone numbers found.');
  _bulkWAIdx=0; openM('bulk-wa-modal'); renderBulkWA();
}
function renderBulkWA(){
  if(_bulkWAIdx>=_bulkWAStudents.length){closeBulkWA();return;}
  const s=_bulkWAStudents[_bulkWAIdx],owe=(s.totalFee||0)-(s.paid||0);
  if($('bwa-progress')) $('bwa-progress').textContent=`${_bulkWAIdx+1} of ${_bulkWAStudents.length}`;
  if($('bwa-pct')) $('bwa-pct').style.width=`${((_bulkWAIdx+1)/_bulkWAStudents.length)*100}%`;
  if($('bwa-name')) $('bwa-name').textContent=s.name;
  if($('bwa-owe')) $('bwa-owe').textContent=fmt(owe);
  if($('bwa-phone')) $('bwa-phone').textContent=s.phone;
  const sn=SD.config.schoolName||'School Management';
  const msg=`Dear Parent,\n\nFriendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
  const btn=$('bwa-open-btn');
  if(btn) btn.onclick=()=>window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
}
function nextBulkWA(){_bulkWAIdx++;if(_bulkWAIdx>=_bulkWAStudents.length){alert('Bulk sequence completed.');closeBulkWA();}else renderBulkWA();}
function closeBulkWA(){closeM('bulk-wa-modal');}

let _bulkRCIdx=0,_bulkRCStudents=[];
function startBulkReportCards(){
  _bulkRCStudents=SD.students.filter(s=>s.phone);
  if(!_bulkRCStudents.length) return alert('No students with registered phone numbers found.');
  _bulkRCIdx=0; openM('bulk-rc-modal'); renderBulkRC();
}
function renderBulkRC(){
  if(_bulkRCIdx>=_bulkRCStudents.length){closeBulkRC();return;}
  const s=_bulkRCStudents[_bulkRCIdx];
  if($('brc-progress')) $('brc-progress').textContent=`${_bulkRCIdx+1} of ${_bulkRCStudents.length}`;
  if($('brc-pct')) $('brc-pct').style.width=`${((_bulkRCIdx+1)/_bulkRCStudents.length)*100}%`;
  if($('brc-name')) $('brc-name').textContent=s.name;
  if($('brc-phone')) $('brc-phone').textContent=s.phone;
  const sn=SD.config.schoolName||'School',term=SD.config.currentTerm||'Term 1';
  const msg=`Dear Parent,\n\nThe report card for *${s.name}* (${s.class||''}) for *${term}* is now ready.\n\nKindly contact the school to collect.\n\n– ${sn}`;
  const btn=$('brc-open-btn');
  if(btn) btn.onclick=()=>window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
}
function nextBulkRC(){_bulkRCIdx++;if(_bulkRCIdx>=_bulkRCStudents.length){alert('Bulk report cards sent.');closeBulkRC();}else renderBulkRC();}
function closeBulkRC(){closeM('bulk-rc-modal');}

// ── Sports ──────────────────────────────────────────────────────────────
function loadSports(){
  const label=$('current-sport-label'); if(label) label.textContent=currentSport.charAt(0).toUpperCase()+currentSport.slice(1);
  const grid=$('custom-sports-grid');
  if(grid){
    const custom=SD.sports.custom||[];
    grid.innerHTML=custom.map(s=>`<div class="sport-card ${s.id===currentSport?'sel':''}" onclick="selectSport('${s.id}',this)">
      <div style="font-size:1.3rem;">${esc(s.icon||'🏆')}</div>
      <div style="font-weight:700;font-size:0.85rem;">${esc(s.name)}</div>
      <div style="font-size:0.7rem;color:var(--sub);">${esc(s.desc||'')}</div></div>`).join('');
  }
  const sel=$('player-sel');
  if(sel) sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${esc(s.id||s.name)}">${esc(s.name)}</option>`).join('');
  renderTeamList();
}

function selectSport(sportId,btnEl){
  currentSport=sportId;
  document.querySelectorAll('.sport-card').forEach(c=>c.classList.remove('sel'));
  if(btnEl) btnEl.classList.add('sel');
  const label=$('current-sport-label');
  if(label){const custom=(SD.sports.custom||[]).find(s=>s.id===sportId);label.textContent=custom?custom.name:sportId.toUpperCase();}
  renderTeamList();
}

async function addCustomSport(){
  const name=$('cs-name').value.trim(),icon=$('cs-icon').value.trim(),desc=$('cs-desc').value.trim();
  if(!name) return alert('Sport name required.');
  if(!SD.sports.custom) SD.sports.custom=[];
  const id=name.toLowerCase().replace(/[^a-z0-9]/g,'');
  SD.sports.custom.push({id,name,icon,desc});
  await SQ.push('sports',SD.sports); saveLocal('sports',SD.sports);
  closeM('custom-sport-modal'); $('cs-name').value=''; $('cs-icon').value=''; $('cs-desc').value=''; loadSports();
}

function renderTeamList(){
  const listEl=$('team-list'); if(!listEl) return;
  const players=(SD.sports.teams||{})[currentSport]||[];
  if(!players.length){listEl.innerHTML='<p style="color:var(--sub);font-size:0.8rem;text-align:center;">No players registered in team.</p>';return;}
  listEl.innerHTML=players.map((p,idx)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);">
      <div><span style="font-weight:700;color:var(--brand);margin-right:5px;">#${p.num||'—'}</span><span style="font-weight:600;">${esc(p.name)}</span><span style="font-size:0.72rem;color:var(--sub);margin-left:5px;">(${esc(p.pos||'')})</span></div>
      <button onclick="removePlayer(${idx})" style="background:none;border:none;color:var(--danger);cursor:pointer;">✕</button>
    </div>`).join('');
}

async function addPlayer(){
  const sVal=$('player-sel').value,pos=$('player-pos').value.trim(),num=$('player-num').value.trim();
  if(!sVal) return alert('Select student.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal); if(!s) return;
  if(!SD.sports.teams) SD.sports.teams={};
  if(!SD.sports.teams[currentSport]) SD.sports.teams[currentSport]=[];
  SD.sports.teams[currentSport].push({id:s.id||s.name,name:s.name,pos,num});
  await SQ.push('sports',SD.sports); saveLocal('sports',SD.sports);
  closeM('add-player-modal'); $('player-pos').value=''; $('player-num').value=''; renderTeamList();
}

async function removePlayer(idx){
  if(!confirm('Remove player?')) return;
  SD.sports.teams[currentSport].splice(idx,1);
  await SQ.push('sports',SD.sports); saveLocal('sports',SD.sports); renderTeamList();
}

function recordMatchResult(){const res=prompt('Match result (e.g. Our School 2–1 Kings Academy):');if(res) toast('✅ Result recorded: '+res);}

// ── Arts ───────────────────────────────────────────────────────────────────
function renderArts(){
  const gallery=$('art-gallery'); if(!gallery) return;
  const art=SD.arts?.gallery||[];
  let html=`<div class="art-card" onclick="openM('add-artwork-modal')"><div class="art-prev" style="background:#f1f5f9;color:var(--sub);font-size:2rem;">➕</div><div class="art-info"><div class="art-title">Add Artwork</div><div class="art-stu">Tap to add</div></div></div>`;
  html+=art.map((item,idx)=>`<div class="art-card">
    <div class="art-prev" style="background:#e2e8f0;font-size:1.5rem;display:flex;align-items:center;justify-content:center;">🎨</div>
    <div class="art-info" style="position:relative;">
      <div class="art-title" style="font-weight:700;">${esc(item.title)}</div>
      <div class="art-stu" style="font-size:0.75rem;color:var(--sub);">${esc(item.studentName)} (${esc(item.medium)})</div>
      <button onclick="deleteArtwork(${idx})" style="position:absolute;right:5px;bottom:5px;background:none;border:none;color:var(--danger);cursor:pointer;">🗑️</button>
    </div></div>`).join('');
  gallery.innerHTML=html;
  const sel=$('art-stu-sel');
  if(sel) sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${esc(s.id||s.name)}">${esc(s.name)}</option>`).join('');
}

async function saveArtwork(){
  const sVal=$('art-stu-sel').value,title=$('art-title').value.trim(),medium=$('art-medium').value,desc=$('art-desc').value.trim();
  if(!sVal||!title) return alert('Select student and specify title.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal); if(!s) return;
  if(!SD.arts) SD.arts={gallery:[]};
  SD.arts.gallery.push({studentId:s.id||s.name,studentName:s.name,title,medium,desc});
  await SQ.push('arts',SD.arts); saveLocal('arts',SD.arts);
  closeM('add-artwork-modal'); $('art-title').value=''; $('art-desc').value=''; renderArts();
}

async function deleteArtwork(idx){
  if(!confirm('Remove artwork?')) return;
  SD.arts.gallery.splice(idx,1);
  await SQ.push('arts',SD.arts); saveLocal('arts',SD.arts); renderArts();
}

function planExhibition(){const desc=prompt('Enter exhibition title:');if(desc) toast('✅ Exhibition planned: '+desc);}

// ── Music ───────────────────────────────────────────────────────────────────
function renderMusic(){
  const logsEl=$('practice-logs');
  if(logsEl){
    const logs=SD.music?.practiceLogs||[];
    if(!logs.length) logsEl.innerHTML='<p style="color:var(--sub);font-size:0.8rem;text-align:center;padding:0.75rem;">No practice logs yet.</p>';
    else logsEl.innerHTML=logs.map(l=>`<div style="padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
      <span style="font-weight:700;">${esc(l.studentName)}</span> — ${esc(l.activity)} (${esc(l.duration)})
      <div style="color:var(--sub);font-size:0.7rem;">${esc(l.notes||'')}</div></div>`).join('');
  }
  ['prac-stu','lesson-stu'].forEach(id=>{
    const el=$(id); if(el) el.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${esc(s.id||s.name)}">${esc(s.name)}</option>`).join('');
  });
  renderInstruments();
}

function renderInstruments(){
  const listEl=$('instrument-list'); if(!listEl) return;
  const inst=SD.music?.instruments||[];
  listEl.innerHTML=inst.map((item,idx)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
      <div><b>${esc(item.name)}</b> — <span style="color:${item.status==='available'?'var(--money)':'var(--danger)'};">${item.status}</span></div>
      <button onclick="toggleInstrumentStatus(${idx})" style="background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:2px 8px;cursor:pointer;">🔄</button>
    </div>`).join('');
}

async function savePractice(){
  const sVal=$('prac-stu').value,act=$('prac-act').value.trim(),dur=$('prac-dur').value,notes=$('prac-notes').value.trim();
  if(!sVal||!act) return alert('Select student and specify activity.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal); if(!s) return;
  if(!SD.music) SD.music={practiceLogs:[],instruments:[]};
  SD.music.practiceLogs.unshift({studentId:s.id||s.name,studentName:s.name,activity:act,duration:dur,notes});
  await SQ.push('music',SD.music); saveLocal('music',SD.music);
  closeM('log-practice-modal'); $('prac-act').value=''; $('prac-notes').value=''; renderMusic();
}

async function bookLesson(){
  const sVal=$('lesson-stu').value,inst=$('lesson-inst').value,date=$('lesson-date').value,time=$('lesson-time').value;
  if(!sVal||!date) return alert('Select student and specify date.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal); if(!s) return;
  toast(`✅ Lesson confirmed for ${s.name} — ${inst} (${date} at ${time})`);
  closeM('book-lesson-modal');
}

async function addInstrument(){
  const name=prompt('Enter instrument name:'); if(!name) return;
  if(!SD.music.instruments) SD.music.instruments=[];
  SD.music.instruments.push({name,status:'available'});
  await SQ.push('music',SD.music); saveLocal('music',SD.music); renderInstruments();
}

async function toggleInstrumentStatus(idx){
  const item=SD.music.instruments[idx]; if(!item) return;
  item.status=item.status==='available'?'borrowed':'available';
  await SQ.push('music',SD.music); saveLocal('music',SD.music); renderInstruments();
}

// ── Health ──────────────────────────────────────────────────────────────────
function renderHealth(){
  const visitsEl=$('h-visits'),openEl=$('h-open'),listEl=$('health-list');
  if(!listEl) return;
  const records=SD.health||[];
  if(visitsEl) visitsEl.textContent=records.length;
  if(openEl) openEl.textContent=records.filter(r=>r.status==='open').length;
  if(!records.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1.5rem;">No incidents logged yet.</p>';}
  else{
    listEl.innerHTML=records.map((r,idx)=>`
      <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
        <div style="font-weight:700;">${esc(r.studentName)} — ${esc(r.type)}</div>
        <div style="font-size:0.72rem;color:var(--sub);">${esc(r.action)} · ${r.date}</div>
        <div style="margin-top:2px;">${esc(r.notes||'')}</div>
        <button class="btn-ghost btn-sm" style="color:var(--danger);padding:2px 6px;margin-top:3px;" onclick="deleteIncident(${idx})">🗑️ Remove</button>
      </div>`).join('');
  }
  const sel=$('inc-stu');
  if(sel) sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${esc(s.id||s.name)}">${esc(s.name)}</option>`).join('');
}

async function logIncident(){
  const sVal=$('inc-stu').value,type=$('inc-type').value.trim(),action=$('inc-action').value,notes=$('inc-notes').value.trim();
  if(!sVal||!type) return alert('Select student and specify incident type.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal); if(!s) return;
  if(!SD.health) SD.health=[];
  SD.health.unshift({studentId:s.id||s.name,studentName:s.name,type,action,notes,status:'open',date:new Date().toISOString().split('T')[0]});
  await SQ.push('health',SD.health); saveLocal('health',SD.health);
  closeM('log-incident-modal'); $('inc-type').value=''; $('inc-notes').value=''; renderHealth();
}

async function deleteIncident(idx){
  if(!confirm('Remove this record?')) return;
  SD.health.splice(idx,1);
  await SQ.push('health',SD.health); saveLocal('health',SD.health); renderHealth();
}

// ── Alumni ──────────────────────────────────────────────────────────────────
function renderAlumni(){
  const listEl=$('alumni-list'),countEl=$('al-count'),donEl=$('al-donations');
  if(!listEl) return;
  const records=SD.alumni||[];
  if(countEl) countEl.textContent=records.length;
  let totalDon=0; records.forEach(r=>totalDon+=(r.donations||0));
  if(donEl) donEl.textContent=fmt(totalDon);
  if(!records.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1.5rem;">No alumni added yet.</p>';}
  else{
    listEl.innerHTML=records.map((r,idx)=>`
      <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
        <div style="font-weight:700;">${esc(r.name)} (${esc(String(r.year))})</div>
        <div style="font-size:0.72rem;color:var(--sub);">${esc(r.job||'—')}</div>
        <div style="margin-top:2px;">Phone: ${esc(r.phone||'—')} · Contributions: <b>${fmt(r.donations||0)}</b></div>
        <div style="display:flex;gap:5px;margin-top:4px;">
          <button class="btn-ghost btn-sm" style="color:var(--brand);" onclick="recordAlumniDonation(${idx})">💰 Log Contribution</button>
          <button class="btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteAlumni(${idx})">🗑️</button>
        </div>
      </div>`).join('');
  }
}

async function addAlumni(){
  const name=$('al-name').value.trim(),year=parseInt($('al-year').value),phone=$('al-phone').value.trim(),job=$('al-job').value.trim();
  if(!name||!year) return alert('Name and year required.');
  if(!SD.alumni) SD.alumni=[];
  SD.alumni.push({name,year,phone,job,donations:0});
  await SQ.push('alumni',SD.alumni); saveLocal('alumni',SD.alumni);
  closeM('add-alumni-modal'); $('al-name').value=''; $('al-year').value=''; $('al-phone').value=''; $('al-job').value=''; renderAlumni();
}

async function recordAlumniDonation(idx){
  const amt=parseFloat(prompt('Enter contribution amount (₦):')); if(!amt||amt<=0) return;
  SD.alumni[idx].donations=(SD.alumni[idx].donations||0)+amt;
  await SQ.push('alumni',SD.alumni); saveLocal('alumni',SD.alumni); renderAlumni();
}

async function deleteAlumni(idx){
  if(!confirm('Remove this alumni member?')) return;
  SD.alumni.splice(idx,1);
  await SQ.push('alumni',SD.alumni); saveLocal('alumni',SD.alumni); renderAlumni();
}

function sendFundraisingAppeal(){
  const records=SD.alumni||[],sn=SD.config.schoolName||'School';
  const msg=`Hello! This is *${sn}* reaching out to our valued alumni. We appreciate your continued support of our school programs. Any contribution — no matter how small — is deeply appreciated.`;
  records.forEach(r=>{if(r.phone) window.open(`https://wa.me/${r.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');});
  if(!records.length) alert('No alumni with phone numbers found.');
}

// ── Comms ───────────────────────────────────────────────────────────────────
function renderComms(){
  const pagesEl=$('social-pages');
  if(pagesEl){
    const pages=SD.socialPages||[];
    if(!pages.length) pagesEl.innerHTML='<p style="font-size:0.8rem;color:var(--sub);text-align:center;padding:0.75rem;">No pages added yet.</p>';
    else pagesEl.innerHTML=pages.map((p,idx)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
      <div><b>${esc(p.platform.toUpperCase())}:</b> ${esc(p.name)}</div>
      <button onclick="removeSocialPage(${idx})" style="background:none;border:none;color:var(--danger);cursor:pointer;">✕</button>
    </div>`).join('');
  }
  renderCommsHistory();
}

async function addSocialPage(){
  const platform=$('soc-platform').value,name=$('soc-name').value.trim(),url=$('soc-url').value.trim();
  if(!platform||!name) return alert('Platform and handle label are required.');
  if(!SD.socialPages) SD.socialPages=[];
  SD.socialPages.push({platform,name,url});
  await SQ.push('socialPages',SD.socialPages); saveLocal('socialPages',SD.socialPages);
  $('soc-platform').value=''; $('soc-name').value=''; $('soc-url').value=''; renderComms();
}

async function removeSocialPage(idx){
  if(!confirm('Remove social page?')) return;
  SD.socialPages.splice(idx,1);
  await SQ.push('socialPages',SD.socialPages); saveLocal('socialPages',SD.socialPages); renderComms();
}

function broadcastFeeReminder(){const count=SD.students.filter(s=>(s.totalFee-s.paid)>0).length;if(confirm(`Send reminders to ${count} outstanding accounts?`))sendAllReminders();}
function broadcastEvent(){const ev=prompt('Event announcement:');if(ev){logComm('Event Notice',ev);alert('Announcement logged.');}}
function broadcastAnnouncement(){const ann=prompt('General announcement:');if(ann){logComm('Public Announcement',ann);alert('Announcement logged.');}}

async function logComm(type,desc){
  if(!SD.commsLog) SD.commsLog=[];
  SD.commsLog.unshift({type,desc,date:new Date().toISOString().replace('T',' ').slice(0,16)});
  await SQ.push('commsLog',SD.commsLog); saveLocal('commsLog',SD.commsLog);
  renderCommsHistory();
}

function renderCommsHistory(){
  const listEl=$('comms-history-list'); if(!listEl) return;
  const logs=SD.commsLog||[];
  if(!logs.length) listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No messages sent yet.</p>';
  else listEl.innerHTML=logs.map(l=>`<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
    <div style="font-weight:700;color:var(--brand);">${esc(l.type)}</div>
    <div style="color:var(--sub);font-size:0.7rem;">${l.date}</div>
    <div style="margin-top:2px;">${esc(l.desc)}</div></div>`).join('');
}

// ── Finance AI ──────────────────────────────────────────────────────────────
function checkFinance(){
  const hasData=(SD.expenses||[]).length>0||(SD.students||[]).some(s=>s.paid>0);
  if(hasData){
    const fe=$('finance-empty'),fa=$('finance-analysis');
    if(fe) fe.style.display='none'; if(fa) fa.style.display='block';
    runLiveFinanceSummary();
  } else {
    const fe=$('finance-empty'),fa=$('finance-analysis');
    if(fe) fe.style.display='block'; if(fa) fa.style.display='none';
  }
}

function runLiveFinanceSummary(){
  const s=SD.students||[];
  const exp=s.reduce((a,x)=>a+(x.totalFee||0),0),col=s.reduce((a,x)=>a+(x.paid||0),0);
  const expenses=(SD.expenses||[]).reduce((a,e)=>a+(e.amount||0),0);
  const el1=$('ai-projection'); if(el1) el1.textContent=fmt(exp);
  const el2=$('ai-anomalies'); if(el2) el2.textContent=(SD.expenses||[]).filter(e=>e.amount>100000).length;
  const recEl=$('ai-recommendation');
  if(recEl){
    const pct=exp>0?(col/exp*100):0;
    if(pct<50) recEl.innerHTML=`⚠️ <b>Budget Warning:</b> Fee collection is at <b>${Math.round(pct)}%</b>. Recovering outstanding balances must be prioritized.`;
    else recEl.innerHTML=`✅ <b>Insight:</b> Fee collection is at <b>${Math.round(pct)}%</b>. Keep monitoring ledger expenditures. Net liquid: ${fmt(col-expenses)}.`;
  }
}

function handleFinanceUpload(event){if(event.target.files[0]){toast('Statement imported. Running budget analysis.');checkFinance();}}

async function askFinanceAI(){
  const qInput=$('ai-question'),q=qInput?.value.trim(); if(!q) return;
  const chatArea=$('ai-chat-area');
  if(chatArea){const uMsg=document.createElement('div');uMsg.style.cssText='background:var(--s2);padding:8px;border-radius:8px;margin-bottom:5px;font-size:0.8rem;';uMsg.innerHTML=`<b>You:</b> ${esc(q)}`;chatArea.appendChild(uMsg);}
  if(qInput) qInput.value='';
  const s=SD.students||[];
  const exp=s.reduce((a,x)=>a+(x.totalFee||0),0),col=s.reduce((a,x)=>a+(x.paid||0),0);
  const expenses=(SD.expenses||[]).reduce((a,e)=>a+(e.amount||0),0);
  const context=`School: ${SD.config.schoolName||'School'}, Students: ${s.length}, Expected: ${fmt(exp)}, Collected: ${fmt(col)}, Expenses: ${fmt(expenses)}, Net: ${fmt(col-expenses)}, Term: ${SD.config.currentTerm||'Term 1'}`;
  // Use Gemini for finance AI (no Anthropic key needed)
  try{
    const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const prompt=`You are EduBloom's Finance Advisor for Nigerian schools. School data: ${context}. Question: ${q}\n\nGive a direct, practical answer in 3-4 sentences. Use ₦ for amounts.`;
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
    const d=await r.json();
    const reply=d.candidates?.[0]?.content?.parts?.[0]?.text||'Could not get a response.';
    if(chatArea){const bMsg=document.createElement('div');bMsg.style.cssText='background:rgba(124,58,237,0.08);border-left:3px solid var(--brand);padding:8px;border-radius:4px;margin-bottom:5px;font-size:0.8rem;';bMsg.innerHTML=`<b>Finance AI:</b> ${esc(reply)}`;chatArea.appendChild(bMsg);chatArea.scrollTop=chatArea.scrollHeight;}
  }catch(e){
    if(chatArea){const bMsg=document.createElement('div');bMsg.style.cssText='background:rgba(124,58,237,0.08);border-left:3px solid var(--brand);padding:8px;border-radius:4px;margin-bottom:5px;font-size:0.8rem;';bMsg.innerHTML=`<b>Finance AI:</b> Connection error. Please check your internet.`;chatArea.appendChild(bMsg);}
  }
}

// ── Analytics ───────────────────────────────────────────────────────────────
function renderAnalytics(){
  const el=$('analytics-content'); if(!el) return;
  const s=SD.students||[];
  const exp=s.reduce((a,x)=>a+(x.totalFee||0),0),col=s.reduce((a,x)=>a+(x.paid||0),0);
  const expenses=(SD.expenses||[]).reduce((a,x)=>a+(x.amount||0),0);
  const netCollected=col-expenses;
  const pct=exp>0?Math.round(col/exp*100):0;
  const owing=s.filter(x=>(x.totalFee||0)-(x.paid||0)>0).length;
  el.innerHTML=`<div class="card">
    <div class="ct">📊 Term Operational Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem;">
      <div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:0.68rem;color:var(--sub);">Net Liquid Profit</div>
        <b style="font-size:1rem;color:${netCollected>=0?'var(--money)':'var(--danger)'};">${fmt(netCollected)}</b></div>
      <div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:0.68rem;color:var(--sub);">Pending Receivables</div>
        <b style="font-size:1rem;color:var(--danger);">${fmt(exp-col)}</b></div>
      <div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:0.68rem;color:var(--sub);">Collection Rate</div>
        <b style="font-size:1rem;color:${pct>=70?'var(--money)':pct>=50?'var(--warn)':'var(--danger)'};">${pct}%</b></div>
      <div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:0.68rem;color:var(--sub);">Owing Parents</div>
        <b style="font-size:1rem;color:var(--danger);">${owing}</b></div>
    </div>
    <div style="font-size:0.76rem;line-height:1.6;color:var(--sub);">
      Net profit = collected fees (${fmt(col)}) minus expenses (${fmt(expenses)}). Expected fee income this term: ${fmt(exp)}.
    </div>
  </div>`;
}

// ── Security ───────────────────────────────────────────────────────────────
function securitySearch(){
  const q=($('sec-search')?.value||'').toLowerCase(),resultsEl=$('security-results'); if(!resultsEl) return;
  if(!q){resultsEl.innerHTML='';return;}
  const matches=SD.students.filter(s=>s.name.toLowerCase().includes(q)||(s.phone&&s.phone.includes(q)));
  if(!matches.length){resultsEl.innerHTML='<p style="color:var(--danger);font-size:0.8rem;">❌ No active records found for that search.</p>';return;}
  resultsEl.innerHTML=matches.map(s=>`
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:0.6rem;margin-top:0.4rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b style="font-size:0.85rem;">${esc(s.name)}</b>
        <span class="chip chip-ok" style="font-size:0.7rem;">Enrolled ✓</span></div>
      <div style="font-size:0.78rem;color:var(--sub);margin-top:3px;"><b>Class:</b> ${esc(s.class||'—')} · <b>Parent Contact:</b> ${s.phone||'—'}</div>
      ${s.safety?.collectors?`<div style="font-size:0.72rem;background:rgba(5,150,105,0.06);border:1px solid rgba(5,150,105,0.2);border-radius:6px;padding:4px 8px;margin-top:5px;color:#059669;">🛡️ Authorised collectors: ${esc(s.safety.collectors)}</div>`:''}
    </div>`).join('');
}

// ── Support ────────────────────────────────────────────────────────────────
function renderSupport(){
  const contactEl=$('agent-contact'); if(!contactEl) return;
  const agent=SD.config?.agent||{name:'AariNAT Support Desk',phone:'2348145073941'};
  contactEl.innerHTML=`
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.4rem 0;">
      <div style="font-size:2.5rem;">🛡️</div>
      <div style="flex:1;">
        <div style="font-size:0.68rem;color:var(--sub);text-transform:uppercase;">Assigned Agent</div>
        <div style="font-weight:700;font-size:0.9rem;">${esc(agent.name)}</div>
        <div style="font-size:0.76rem;color:var(--sub);">${esc(agent.phone||'2348145073941')}</div>
      </div>
      <button class="btn-wa btn-sm" onclick="window.open('https://wa.me/${(agent.phone||'2348145073941').replace(/\D/g,'')}?text=${encodeURIComponent('Hello '+agent.name+', I need help with Educational Bloom.')}','_blank')">📲 Chat</button>
    </div>`;
}

// ── Opportunities ──────────────────────────────────────────────────────────
function renderOpps(){
  const cat=$('opp-cat')?.value||'',days=parseInt($('opp-deadline')?.value)||0,listEl=$('opps-list'); if(!listEl) return;
  let list=[...(SD.opportunities||defaultOpps())];
  if(cat) list=list.filter(o=>o.type===cat);
  if(days){const cutoff=new Date();cutoff.setDate(cutoff.getDate()+days);list=list.filter(o=>new Date(o.deadline)<=cutoff);}
  listEl.innerHTML=list.map(o=>`
    <div style="padding:0.6rem;background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:0.5rem;font-size:0.78rem;">
      <div style="display:flex;justify-content:space-between;align-items:start;"><b style="font-size:0.85rem;color:var(--brand);">${esc(o.title)}</b><span class="chip chip-ok" style="font-size:0.68rem;">${o.type.toUpperCase()}</span></div>
      <div style="font-size:0.72rem;color:var(--sub);margin:2px 0;">Provider: ${esc(o.provider)} · Amount: <b>${esc(o.amount)}</b></div>
      <p style="margin:4px 0;line-height:1.45;">${esc(o.desc)}</p>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:0.72rem;">
        <span style="color:var(--danger);font-weight:700;">Deadline: ${o.deadline}</span>
        <button onclick="applyToOpp('${o.id}')" style="background:var(--brand);color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.72rem;">Apply</button>
      </div>
    </div>`).join('');
}

function applyToOpp(id){toast('Routing application for opportunity: '+id);}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8 — Settings, Branding, Plan/Upgrade, Auto-login
// ═══════════════════════════════════════════════════════════════════════

function loadSettings() {
  const cfg = SD.config || {};
  const sn = $('set-name'); if(sn) sn.value = cfg.schoolName||'';
  const sp = $('set-phone'); if(sp) sp.value = cfg.whatsapp||'';
  const se = $('set-email'); if(se) se.value = cfg.principalEmail||'';
  const sf = $('set-fee'); if(sf) sf.value = cfg.fee||50000;
  const st = $('set-term'); if(st) st.value = cfg.currentTerm||'Term 1';
  const ss = $('set-session'); if(ss) ss.value = cfg.session||'2025/2026';
  const isPrem = cfg.plan==='premium';
  const planEl=$('settings-plan'); if(planEl) planEl.textContent=isPrem?'PREMIUM ✨':'BASIC';
  const slEl=$('settings-staff-limit'); if(slEl) slEl.textContent=isPrem?'Unlimited':'3';
  const aiEl=$('settings-ai'); if(aiEl) aiEl.textContent=isPrem?'Premium Advisor':'Basic Analysis';
  updateLogoBadges(cfg.logo);
  renderSubjectChips();
  loadGeminiKeySetting();
  loadBankDetails();
}


// ── BloomCollect — Bank Account Details (Settings) ────────────────────────
// Schools register their bank account here so fees go directly to them.
// AariNAT's Kora key lives server-side in the Cloud Function only — never here.
// Fee structure: Kora 1.5% + AariNAT 1% = 2.5% total per transaction.
function loadBankDetails() {
  const bd = SD.config.bankDetails || {};
  const bankSel  = $('set-bank-name');
  const acctInp  = $('set-bank-account');
  const nameInp  = $('set-bank-acct-name');
  const badge    = $('bc-status-badge');
  const statusEl = $('bc-bank-status');
  if (bankSel) bankSel.value = bd.bankName      || '';
  if (acctInp) acctInp.value = bd.accountNumber || '';
  if (nameInp) nameInp.value = bd.accountName   || '';
  const isSet = !!(bd.bankName && bd.accountNumber && bd.accountName);
  if (badge) {
    badge.textContent       = isSet ? '✅ Active' : '⚠️ Not Set Up';
    badge.style.background  = isSet ? 'rgba(0,200,83,0.15)' : 'rgba(255,82,82,0.1)';
    badge.style.color       = isSet ? '#00C853' : '#FF5252';
  }
  if (statusEl) {
    statusEl.textContent = isSet
      ? '✅ BloomCollect active — ' + (bd.bankName||'') + ' · ' + (bd.accountNumber||'')
      : 'Enter your school bank account above to activate BloomCollect';
    statusEl.style.color = isSet ? '#22c55e' : '#f59e0b';
  }
}

function loadGeminiKeySetting() {
  const saved = localStorage.getItem('gemini_api_key') || window.GEMINI_API_KEY || '';
  const inp = $('set-gemini-key');
  const status = $('gemini-key-status');
  if (inp) inp.value = saved;
  if (status) {
    if (saved) {
      status.innerHTML = '✅ <strong>AI OCR active</strong> — register scanning uses Gemini';
      status.style.color = '#22c55e';
    } else {
      status.innerHTML = '⚠️ No key set — OCR.space will be used (lower accuracy for handwritten registers)';
      status.style.color = '#f59e0b';
    }
  }
}

function saveGeminiKeySetting() {
  const inp = $('set-gemini-key');
  const key = (inp?.value || '').trim();
  if (key && !key.startsWith('AIza')) {
    if (inp) inp.style.borderColor = '#ef4444';
    toast('❌ Invalid key — must start with AIza...');
    return;
  }
  if (key) {
    localStorage.setItem('gemini_api_key', key);
    window.GEMINI_API_KEY = key;
    toast('✅ Gemini AI key saved — register scanning now uses AI');
  } else {
    localStorage.removeItem('gemini_api_key');
    window.GEMINI_API_KEY = '';
    toast('Key cleared');
  }
  loadGeminiKeySetting();
}

function clearGeminiKey() {
  localStorage.removeItem('gemini_api_key');
  window.GEMINI_API_KEY = '';
  const inp = $('set-gemini-key'); if (inp) inp.value = '';
  loadGeminiKeySetting();
  toast('🗑️ AI key cleared — OCR.space will be used');
}

function renderSubjectChips() {
  const subs = SD.config.subjects || [];
  const container = $('subj-chips'), area = $('set-subjects');
  if (!container) return;
  container.innerHTML = subs.map((s,idx) =>
    `<span class="subj-chip">${esc(s)}<button type="button" class="chip-del" onclick="removeSubject(${idx})">×</button></span>`
  ).join('');
  if (area) area.value = subs.join('\n');
}

function addSubjectFromInput() {
  const inp = $('new-subj-inp'), val = (inp?.value||'').trim(); if(!val) return;
  if (!SD.config.subjects) SD.config.subjects = [];
  if (!SD.config.subjects.includes(val)) { SD.config.subjects.push(val); renderSubjectChips(); }
  if (inp) inp.value = '';
}

function removeSubject(idx) {
  if (SD.config.subjects) { SD.config.subjects.splice(idx,1); renderSubjectChips(); }
}

function loadPresetSubjects(type) {
  const presets = {
    primary: ['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','Home Economics','National Values Education'],
    jss:    ['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','Business Studies','Religious Studies','French Language','National Values Education'],
    sss:    ['English Language','Mathematics','Biology','Chemistry','Physics','Civic Education','Geography','Economics','Agricultural Science','Further Mathematics','Technical Drawing','Computer Studies','Literature in English']
  };
  SD.config.subjects = presets[type] || presets.primary;
  renderSubjectChips();
}


// ── BloomCollect Kora bank detail helpers (Settings) ──────────────────────
async function saveBankDetails() {
  const bankName      = ($('set-bank-name')?.value     || '').trim();
  const accountNumber = ($('set-bank-account')?.value  || '').replace(/\D/g,'');
  const accountName   = ($('set-bank-acct-name')?.value || '').trim();
  if (!bankName)                  return toast('❌ Select a bank.');
  if (accountNumber.length !== 10) return toast('❌ Account number must be exactly 10 digits.');
  if (!accountName)               return toast('❌ Enter the account name.');
  SD.config.bankDetails = { bankName, accountNumber, accountName };
  await SQ.push('config', SD.config);
  saveLocal('config', SD.config);
  loadBankDetails();
  toast('✅ Bank details saved — BloomCollect is now active!');
}

async function clearBankDetails() {
  if (!confirm('Remove bank details? BloomCollect will be disabled.')) return;
  SD.config.bankDetails = {};
  await SQ.push('config', SD.config);
  saveLocal('config', SD.config);
  loadBankDetails();
  toast('Bank details cleared.');
}

async function saveSettings() {
  const newName = $('set-name')?.value.trim(); if(!newName) return alert('School name is required.');
  SD.config.schoolName  = newName;
  SD.config.whatsapp    = $('set-phone')?.value.trim()||'';
  SD.config.principalEmail = $('set-email')?.value.trim()||'';
  SD.config.fee         = parseFloat($('set-fee')?.value)||50000;
  SD.config.currentTerm = $('set-term')?.value||'Term 1';
  SD.config.session     = $('set-session')?.value.trim()||'';
  const pwd = $('set-pwd')?.value.trim();
  if (pwd) {
    const pr = (SD.staff||[]).find(s=>s.role==='Principal');
    if (pr) pr.password = pwd;
    if ($('set-pwd')) $('set-pwd').value='';
  }
  // Sync subjects from textarea if chips are empty
  const textSubs = ($('set-subjects')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  if (textSubs.length && (!SD.config.subjects||!SD.config.subjects.length)) SD.config.subjects = textSubs;
  await SQ.push('config', SD.config); saveLocal('config', SD.config);
  if ($('hdr-school')) $('hdr-school').textContent = newName;
  if ($('hdr-term')) $('hdr-term').textContent = SD.config.currentTerm;
  alert('✅ Settings saved successfully!');
}

// ── School Logo / Branding ─────────────────────────────────────────────
function handleLogoBadgeTap() {
  if (userRole==='Principal') $('logo-file-input')?.click();
  else alert('Only the Principal can change the school logo.');
}

function handleLogoUpload(event) {
  const file = event.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dUrl = e.target.result;
    SD.config.logo = dUrl;
    await SQ.push('config', SD.config); saveLocal('config', SD.config);
    updateLogoBadges(dUrl);
    toast('✅ School logo updated.');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  if (userRole!=='Principal') return alert('Only the Principal can remove the school logo.');
  if (confirm('Remove school logo?')) {
    SD.config.logo = null;
    SQ.push('config', SD.config); saveLocal('config', SD.config);
    updateLogoBadges(null);
    toast('Logo removed.');
  }
}

function updateLogoBadges(logoUrl) {
  const initial = SD.config.schoolName ? SD.config.schoolName.charAt(0).toUpperCase() : 'S';
  const badge=$('school-logo-badge'), badgeText=$('school-logo-initial');
  const preview=$('settings-logo-preview'), previewText=$('settings-logo-initial');
  const nameEl=$('settings-logo-name');
  if (logoUrl) {
    if (badge)  { badge.style.backgroundImage=`url(${logoUrl})`; if(badgeText) badgeText.style.display='none'; }
    if (preview){ preview.style.backgroundImage=`url(${logoUrl})`; if(previewText) previewText.style.display='none'; }
    if (nameEl)  nameEl.textContent='School logo loaded';
  } else {
    if (badge)  { badge.style.backgroundImage='none'; if(badgeText){ badgeText.style.display='inline'; badgeText.textContent=initial; } }
    if (preview){ preview.style.backgroundImage='none'; if(previewText){ previewText.style.display='inline'; previewText.textContent=initial; } }
    if (nameEl)  nameEl.textContent='No logo uploaded';
  }
}

// ── Plan / Upgrade Modal ──────────────────────────────────────────────────
function renderUpgradeModal() {
  const cfg  = SD.config||{};
  const count= (SD.students||[]).length;
  const tMax = cfg.tierMax   || getTier(count).max;
  const tName= cfg.tier      || getTier(count).name;
  const tPrice=cfg.tierPrice || getTier(count).price;
  const isPrem=cfg.plan==='premium';
  const nameEl=$('up-plan-name'), tierEl=$('up-tier-info'), stuEl=$('up-student-info'), tableEl=$('up-tier-table');
  if(nameEl) nameEl.textContent=(isPrem?'⭐ PREMIUM':'📋 BASIC')+' — '+(tName||'—');
  if(tierEl) tierEl.textContent='₦'+Number(tPrice||0).toLocaleString('en-NG')+'/term · Up to '+(tMax||'?')+' students';
  if(stuEl)  stuEl.textContent='Current students: '+count+(count>tMax?' ⚠️ OVER LIMIT':' ✅');
  if(tableEl){
    tableEl.innerHTML=TIERS.map(t=>{
      const current=count<=t.max&&(TIERS.indexOf(t)===0||count>TIERS[TIERS.indexOf(t)-1].max);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;margin-bottom:4px;background:${current?'#ecfdf5':'var(--s2)'};border:1px solid ${current?'#86efac':'var(--border)'};">
        <span>${current?'✅ ':''}<b>${t.name}</b></span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--money);">₦${Number(t.price).toLocaleString('en-NG')}/term</span>
      </div>`;
    }).join('');
  }
}

function openUpgradeModal() { renderUpgradeModal(); openM('upgrade-modal'); }

async function refreshPlanFromFirestore(btn) {
  if(!btn) btn=document.querySelector('[onclick*="refreshPlanFromFirestore"]');
  if(btn){ btn.textContent='⏳ Checking...'; btn.disabled=true; }
  const sid=schoolId||SD.config?._schoolId;
  if(!sid||!db){ if(btn){ btn.textContent='❌ Not connected'; btn.disabled=false; } return; }
  try{
    const snap=await db.collection('schools').doc(sid).get();
    if(snap.exists){
      const cfg=snap.data().config||{};
      SD.config=Object.assign({},SD.config,cfg);
      localStorage.setItem(`p_${sid}_config`,JSON.stringify(SD.config));
      checkTierStatus(); renderUpgradeModal();
      if(btn) btn.textContent='✅ Plan refreshed!';
    } else { if(btn) btn.textContent='❌ School not found'; }
  }catch(e){ if(btn) btn.textContent='❌ Error — try again'; console.error('refreshPlan:',e); }
  setTimeout(()=>{ if(btn){ btn.textContent='🔄 Refresh Plan (after payment)'; btn.disabled=false; } },3000);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9 — Auto-login on page load
// ═══════════════════════════════════════════════════════════════════════

(function autoLogin() {
  const raw = localStorage.getItem('p_auth') || sessionStorage.getItem('p_auth');
  if (!raw) return;
  try {
    const auth = JSON.parse(raw);
    if (!auth.schoolId) return;
    const lc = localStorage.getItem(`p_${auth.schoolId}_config`);
    const ls = localStorage.getItem(`p_${auth.schoolId}_staff`);
    if (!lc) return;
    schoolId  = auth.schoolId;
    userRole  = auth.role || 'Principal';
    loadSchoolIntoSD(auth.schoolId, {
      config:       JSON.parse(lc),
      staff:        ls ? JSON.parse(ls) : [],
      students:     loadLocal('students', []),
      expenses:     loadLocal('expenses', []),
      attendance:   loadLocal('attendance', {}),
      scores:       loadLocal('scores', {}),
      affective:    loadLocal('affective', {}),
      sports:       loadLocal('sports', { teams:{}, custom:[] }),
      arts:         loadLocal('arts', { gallery:[] }),
      music:        loadLocal('music', { practiceLogs:[], instruments:[] }),
      health:       loadLocal('health', []),
      alumni:       loadLocal('alumni', []),
      socialPages:  loadLocal('socialPages', []),
      commsLog:     loadLocal('commsLog', []),
      opportunities:loadLocal('opportunities', defaultOpps())
    });
    // Restore staff session if cached — otherwise show role selector
    const cachedSession = localStorage.getItem(`p_${auth.schoolId}_staffSession`);
    if (cachedSession) {
      try {
        const sess = JSON.parse(cachedSession);
        currentStaff = sess; userRole = sess.role || 'Principal';
        startApp();
        setTimeout(() => SQ.silentPull(), 2000);
        return;
      } catch(e) {}
    }
    // No cached session — show staff login screen
    if (SD.staff && SD.staff.length > 0) {
      showStaffLoginStep();
    } else {
      userRole = 'Principal'; currentStaff = null;
      startApp();
    }
    setTimeout(() => SQ.silentPull(), 2000);
  } catch(e) { console.warn('Auto-login failed:', e); }
})();


// ════════════════════════════════════════════════════════════════════════════
// BLOOM AI AGENT WORKFORCE
// Each agent is a twin of a human role — they watch data and act automatically
// Agents run silently in the background; results surface in the AI tab
// ════════════════════════════════════════════════════════════════════════════


// ── Report Card Agent UI runner ──────────────────────────────────────────
async function runRCAgent() {
  const term = document.getElementById("rc-agent-term")?.value || "First Term";
  const students = SD.students || [];
  if (!students.length) { toast("No students loaded yet."); return; }

  const wrap   = document.getElementById("rc-agent-progress-wrap");
  const bar    = document.getElementById("rc-agent-progress-bar");
  const label  = document.getElementById("rc-agent-progress-label");
  const result = document.getElementById("rc-agent-result");

  if (wrap)   wrap.style.display  = "block";
  if (result) result.style.display = "none";

  const { done, total } = await BloomAgents.runReportCardAgent(term, function(done, total, name) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (bar)   bar.style.width   = pct + "%";
    if (label) label.textContent = "Writing remark for " + name + "... (" + done + "/" + total + ")";
  });

  if (wrap)   wrap.style.display  = "none";
  if (result) {
    result.style.display = "block";
    result.textContent   = "✅ " + done + " remarks generated for " + term + ". Print any report card to see them.";
  }
  toast("✅ " + done + " AI remarks ready for " + term + "!");
}
const BloomAgents = {

  // ── Shared Gemini caller ─────────────────────────────────────────────────
  async _gemini(prompt, maxTokens = 512) {
    const key = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
    if (!key) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens }
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  },

  _log(agentName, action, detail) {
    const logs = JSON.parse(localStorage.getItem('agent_logs') || '[]');
    logs.unshift({ agent: agentName, action, detail, ts: new Date().toISOString() });
    localStorage.setItem('agent_logs', JSON.stringify(logs.slice(0, 200)));
    renderAgentLog();
  },

  // ════════════════════════════════════════════════════════════════════════
  // AGENT 1 — FINANCE AGENT
  // Watches fees every time dashboard loads. Flags defaulters, sends reminders,
  // predicts end-of-term collection, suggests fee adjustments.
  // ════════════════════════════════════════════════════════════════════════
  async runFinanceAgent() {
    const students = SD.students || [];
    if (!students.length) return;

    const overdue = students.filter(s => ((s.totalFee || 0) - (s.paid || 0)) > 0);
    const totalOwed = overdue.reduce((t, s) => t + (s.totalFee || 0) - (s.paid || 0), 0);
    const totalExpected = students.reduce((t, s) => t + (s.totalFee || 0), 0);
    const totalCollected = students.reduce((t, s) => t + (s.paid || 0), 0);
    const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    // Auto-flag critical defaulters (owe > 50% of their fee)
    const critical = overdue.filter(s => ((s.totalFee||0)-(s.paid||0)) / (s.totalFee||1) > 0.5);

    // Update finance agent panel
    const panel = document.getElementById('ai-finance-panel');
    if (panel) {
      panel.innerHTML = `
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:${collectionRate>=80?'#22c55e':collectionRate>=50?'#f59e0b':'#ef4444'}">${collectionRate}%</span>
          <span class="ai-stat-lbl">Collection Rate</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#ef4444">${overdue.length}</span>
          <span class="ai-stat-lbl">Defaulters</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#f59e0b">${fmt(totalOwed)}</span>
          <span class="ai-stat-lbl">Outstanding</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#22c55e">${fmt(totalCollected)}</span>
          <span class="ai-stat-lbl">Collected</span>
        </div>`;
    }

    // AI insight — only if Gemini key set
    const key = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
    if (key && overdue.length > 0) {
      try {
        const insight = await BloomAgents._gemini(
          `You are EduBloom's Finance AI for a Nigerian school.
Data: ${overdue.length} students owe fees. Total outstanding: ₦${totalOwed.toLocaleString()}. Collection rate: ${collectionRate}%.
${critical.length} are critical defaulters (>50% unpaid).
Classes with most defaults: ${[...new Set(overdue.map(s=>s.class||'Unknown'))].slice(0,3).join(', ')}.

In 2 short sentences (max 30 words each), give the principal ONE urgent action and ONE prediction about end-of-term collection. Be direct, use Nigerian school context.`, 120);
        const insightEl = document.getElementById('ai-finance-insight');
        if (insightEl && insight) insightEl.textContent = insight;
      } catch(e) { console.warn('Finance AI insight failed:', e.message); }
    }

    BloomAgents._log('💰 Finance Agent', `Scanned ${students.length} students`, `${overdue.length} defaulters · ₦${totalOwed.toLocaleString()} outstanding · ${collectionRate}% collected`);

    // Return data for use by other agents
    return { overdue, critical, totalOwed, collectionRate };
  },

  // Auto-batch send WA reminders to all defaulters (called by agent, confirmed by human)
  prepareReminderBatch() {
    const overdue = (SD.students || []).filter(s => ((s.totalFee||0)-(s.paid||0)) > 0 && s.phone);
    if (!overdue.length) { toast('✅ No defaulters with phone numbers.'); return; }
    const schoolName = SD.config?.schoolName || 'Our School';
    const messages = overdue.map(s => {
      const owe = (s.totalFee||0) - (s.paid||0);
      return {
        name: s.name,
        phone: s.phone,
        msg: `Dear Parent,\n\n*${schoolName}* 🌸\n\nThis is an automated fee reminder.\n\n*Student:* ${s.name}\n*Class:* ${s.class||'—'}\n*Outstanding:* *${fmt(owe)}*\n\nPlease pay promptly to avoid disruption to your child's learning.\n\nReply to this message for payment options.\n\nThank you.\n– EduBloom Finance Agent`
      };
    });
    openAgentReminderModal(messages);
  },

  // ════════════════════════════════════════════════════════════════════════
  // AGENT 2 — TEACHER AGENT
  // Helps teachers: auto-generates subject scores from class photo,
  // auto-fills attendance from register scan, flags absent streaks,
  // drafts teacher remarks for report cards.
  // ════════════════════════════════════════════════════════════════════════
  async runTeacherAgent() {
    const students = SD.students || [];
    if (!students.length) return;

    const today = new Date().toISOString().split('T')[0];
    const attData = SD.attendance || {};

    // Find students with 3+ consecutive absences
    const absentStreaks = [];
    students.forEach(s => {
      const records = attData[s.name] || {};
      const dates = Object.keys(records).sort().slice(-7); // last 7 days
      let streak = 0;
      for (let i = dates.length - 1; i >= 0; i--) {
        if (records[dates[i]] === 'A') streak++;
        else break;
      }
      if (streak >= 3) absentStreaks.push({ name: s.name, class: s.class, streak });
    });

    // Students with no scores at all this term
    const term = SD.scores?.currentTerm || 'First Term';
    const noScores = students.filter(s => {
      const termScores = SD.scores?.[term]?.[s.name];
      return !termScores || Object.keys(termScores).length === 0;
    });

    const panel = document.getElementById('ai-teacher-panel');
    if (panel) {
      panel.innerHTML = `
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:${absentStreaks.length>0?'#ef4444':'#22c55e'}">${absentStreaks.length}</span>
          <span class="ai-stat-lbl">Absent Streaks</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:${noScores.length>0?'#f59e0b':'#22c55e'}">${noScores.length}</span>
          <span class="ai-stat-lbl">No Scores Yet</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#60a5fa">${students.length}</span>
          <span class="ai-stat-lbl">Total Students</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#a78bfa">${[...new Set(students.map(s=>s.class).filter(Boolean))].length}</span>
          <span class="ai-stat-lbl">Classes</span>
        </div>`;
    }

    if (absentStreaks.length > 0) {
      const list = document.getElementById('ai-absent-streaks');
      if (list) {
        list.innerHTML = absentStreaks.map(a =>
          `<div class="ai-alert-row">
            <span>⚠️ <b>${esc(a.name)}</b> (${esc(a.class||'—')}) — ${a.streak} days absent</span>
            <button onclick="agentNotifyParent('${esc(a.name)}')" class="ai-mini-btn">📲 Notify Parent</button>
          </div>`
        ).join('');
      }
    }

    BloomAgents._log('📚 Teacher Agent', `Scanned attendance & scores`, `${absentStreaks.length} absent streaks · ${noScores.length} students need scores`);
    return { absentStreaks, noScores };
  },

  // Auto-draft teacher remarks for a student using Gemini
  async draftRemark(studentName, scores, className) {
    const key = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
    if (!key) { toast('⚠️ Add Gemini key in Settings for AI remarks.'); return; }
    const scoreStr = Object.entries(scores||{}).map(([k,v])=>`${k}: ${v}`).join(', ');
    try {
      const remark = await BloomAgents._gemini(
        `You are a Nigerian primary school teacher writing a report card remark for a student.
Student: ${studentName}, Class: ${className}
Scores: ${scoreStr || 'not yet available'}
Write a single encouraging sentence (max 20 words) suitable for a Nigerian school report card. Be positive but honest. No emojis.`, 60);
      return remark?.trim() || '';
    } catch(e) { return ''; }
  },

  // ════════════════════════════════════════════════════════════════════════
  // AGENT 3 — PRINCIPAL AGENT
  // Monitors school health: enrollment vs capacity, fee trends,
  // staff activity, upcoming exams, generates weekly summary for principal.
  // ════════════════════════════════════════════════════════════════════════
  async runPrincipalAgent() {
    const students = SD.students || [];
    const config = SD.config || {};
    const tier = config.tier || '';
    const tierMax = { 'Starter (1–50)':50,'Small (51–100)':100,'Medium (101–200)':200,'Large (201–350)':350,'Enterprise (351+)':9999 }[tier] || 50;
    const capacityPct = Math.round((students.length / tierMax) * 100);

    const overdue = students.filter(s => ((s.totalFee||0)-(s.paid||0)) > 0);
    const totalExpected = students.reduce((t,s) => t+(s.totalFee||0),0);
    const totalCollected = students.reduce((t,s) => t+(s.paid||0),0);
    const healthScore = Math.round(
      (totalExpected > 0 ? (totalCollected/totalExpected)*40 : 40) +
      (students.length > 5 ? 30 : students.length * 6) +
      (capacityPct < 90 ? 30 : 10)
    );

    const panel = document.getElementById('ai-principal-panel');
    if (panel) {
      const hColor = healthScore >= 80 ? '#22c55e' : healthScore >= 50 ? '#f59e0b' : '#ef4444';
      panel.innerHTML = `
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:${hColor}">${healthScore}</span>
          <span class="ai-stat-lbl">School Health</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#60a5fa">${students.length}/${tierMax}</span>
          <span class="ai-stat-lbl">Capacity</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#22c55e">${fmt(totalCollected)}</span>
          <span class="ai-stat-lbl">Revenue</span>
        </div>
        <div class="ai-agent-stat">
          <span class="ai-stat-val" style="color:#ef4444">${overdue.length}</span>
          <span class="ai-stat-lbl">Defaulters</span>
        </div>`;
    }

    // AI weekly briefing
    const key = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
    if (key) {
      try {
        const brief = await BloomAgents._gemini(
          `You are EduBloom's Principal AI for a Nigerian school called "${config.schoolName||'this school'}".
School data: ${students.length} students enrolled (capacity: ${tierMax}). 
Fee collection: ${totalCollected > 0 ? Math.round((totalCollected/totalExpected)*100) : 0}% collected. 
${overdue.length} students have outstanding fees. School health score: ${healthScore}/100.

Write a 3-sentence principal briefing for today. Cover: what's going well, what needs attention, one action to take today. 
Use a respectful, professional tone suitable for a Nigerian school principal.`, 150);
        const briefEl = document.getElementById('ai-principal-brief');
        if (briefEl && brief) briefEl.textContent = brief;
      } catch(e) { console.warn('Principal AI brief failed:', e.message); }
    }

    BloomAgents._log('👑 Principal Agent', `School health check`, `Score: ${healthScore}/100 · ${students.length} students · ${fmt(totalCollected)} collected`);
    return { healthScore, capacityPct, students, overdue };
  },

  // ════════════════════════════════════════════════════════════════════════
  // AGENT 4 — ONBOARDING AGENT
  // Fires when a new school first loads with pre-populated students.
  // Guides principal through: confirm students → set fees → assign classes → done
  // ════════════════════════════════════════════════════════════════════════
  checkOnboarding() {
    const students = SD.students || [];
    const config = SD.config || {};
    const onboardDone = localStorage.getItem(`onboard_done_${config.schoolId || 'x'}`);
    if (onboardDone) return;

    // New school: has students but fees not set or classes not assigned
    const noFees = students.filter(s => !(s.totalFee > 0));
    const noClass = students.filter(s => !s.class);
    const isNewSchool = students.length > 0 && (noFees.length > students.length * 0.7 || noClass.length > students.length * 0.5);

    if (isNewSchool) {
      openOnboardingWizard(students, noFees, noClass);
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // AGENT 4 — REPORT CARD AGENT
  // End-of-term: auto-drafts teacher remarks + principal comments for all
  // students using Gemini AI. Stores in SD.remarks for printReportCard to use.
  // ════════════════════════════════════════════════════════════════════════
  async runReportCardAgent(term, onProgress) {
    const students = SD.students || [];
    const subs = SD.config && SD.config.subjects ? SD.config.subjects : ["English Language","Mathematics","Basic Science"];
    const schoolName = (SD.config && SD.config.schoolName) ? SD.config.schoolName : "Our School";
    const key = (window.GEMINI_API_KEY || localStorage.getItem("gemini_api_key") || "").trim();

    if (!key) {
      toast("Add Gemini API key in Settings to generate AI remarks.");
      return { done: 0, total: students.length };
    }

    SD.remarks = SD.remarks || {};
    let done = 0;
    const total = students.length;

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const sid = s.id || i;
      const termData = ((SD.scores || {})[term] || {})[sid] || {};

      const scoreLines = subs.map(function(sub) {
        const v = termData[sub] || {};
        const tot = (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
        return tot > 0 ? (sub + ": " + tot + "/100") : null;
      }).filter(Boolean).join(", ") || "scores not yet available";

      const totals = subs.map(function(sub){
        const v = termData[sub] || {};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
      }).filter(function(v){ return v > 0; });
      const avg = totals.length ? Math.round(totals.reduce(function(a,b){return a+b;},0)/totals.length) : 0;
      const grade = avg>=70?"A (Excellent)":avg>=60?"B (Very Good)":avg>=50?"C (Good)":avg>=40?"D (Fair)":"F (Needs Improvement)";
      const attData = SD.attendance || {};
      const daysPresent = Object.values(attData).filter(function(day){ return day[s.name]==="Present"; }).length;

      try {
        if (onProgress) onProgress(done, total, s.name);

        const teacherPrompt = "You are a Nigerian primary/secondary school class teacher writing a report card remark.\n" +
          "Student: " + s.name + ", Class: " + (s.class||"unknown") + ", School: " + schoolName + "\n" +
          "Term: " + term + ", Average: " + avg + "%, Grade: " + grade + "\n" +
          "Subjects: " + scoreLines + "\n" +
          "Days Present: " + daysPresent + "\n\n" +
          "Write ONE sentence (max 25 words) as the class teacher remark for this student's report card.\n" +
          "- Address the parent. Be specific about performance. Warm but honest tone.\n" +
          "- Nigerian school report card style. No emojis. Output the remark only.";

        const principalPrompt = "You are the Head Teacher/Principal of " + schoolName + ", a Nigerian school.\n" +
          "Writing the principal comment on the report card for: " + s.name + " (Class: " + (s.class||"—") + ").\n" +
          "Term: " + term + ". Average: " + avg + "%. Grade: " + grade + ".\n\n" +
          "Write ONE sentence (max 20 words) as the Principal comment.\n" +
          "- Formal administrative tone. Acknowledge performance. Encourage continued effort.\n" +
          "- Start with student first name or This student. No emojis. Output the comment only.";

        const teacherRemark   = await BloomAgents._gemini(teacherPrompt, 80);
        const principalComment = await BloomAgents._gemini(principalPrompt, 60);

        SD.remarks[sid] = SD.remarks[sid] || {};
        SD.remarks[sid][term] = {
          teacher:   (teacherRemark   || "").trim().replace(/^\W+|\W+$/g, ""),
          principal: (principalComment|| "").trim().replace(/^\W+|\W+$/g, ""),
          generatedAt: new Date().toISOString()
        };

        done++;
        await new Promise(function(r){ setTimeout(r, 350); });
      } catch(e) {
        console.warn("Remark failed for " + s.name + ":", e.message);
        done++;
      }
    }

    if (done > 0) {
      await SQ.push("remarks", SD.remarks);
      BloomAgents._log("📄 Report Card Agent", "Generated remarks for " + done + "/" + total + " students", "Term: " + term + " — AI teacher + principal comments ready");
    }
    return { done: done, total: total };
  },

  saveRemark: function(sid, term, type, text) {
    SD.remarks = SD.remarks || {};
    SD.remarks[sid] = SD.remarks[sid] || {};
    SD.remarks[sid][term] = SD.remarks[sid][term] || {};
    SD.remarks[sid][term][type] = text;
    SD.remarks[sid][term].editedAt = new Date().toISOString();
    SQ.push("remarks", SD.remarks);
    BloomAgents._log("📄 Report Card Agent", "Remark updated", type + " remark for student " + sid);
  },

  // ════════════════════════════════════════════════════════════════════════
  // MASTER RUN — fires all agents on app load + every 5 mins
  // ════════════════════════════════════════════════════════════════════════
  async runAll(silent = false) {
    if (!SD.students?.length) return;
    const [finance, teacher, principal] = await Promise.allSettled([
      BloomAgents.runFinanceAgent(),
      BloomAgents.runTeacherAgent(),
      BloomAgents.runPrincipalAgent()
    ]);
    BloomAgents.checkOnboarding();
    if (!silent) renderAgentLog();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// AGENT UI HELPERS
// ════════════════════════════════════════════════════════════════════════════

function renderAgentLog() {
  const logs = JSON.parse(localStorage.getItem('agent_logs') || '[]');
  const el = document.getElementById('ai-agent-log');
  if (!el) return;
  if (!logs.length) { el.innerHTML = '<p style="color:var(--sub);font-size:0.78rem;text-align:center;">Agents will log activity here.</p>'; return; }
  el.innerHTML = logs.slice(0, 20).map(l => {
    const t = new Date(l.ts).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    return `<div class="agent-log-row">
      <span class="agent-log-icon">${l.agent.split(' ')[0]}</span>
      <div class="agent-log-body">
        <div class="agent-log-action">${esc(l.action)}</div>
        <div class="agent-log-detail">${esc(l.detail)}</div>
      </div>
      <span class="agent-log-time">${t}</span>
    </div>`;
  }).join('');
}

function agentNotifyParent(studentName) {
  const s = (SD.students || []).find(x => x.name === studentName);
  if (!s?.phone) { toast('⚠️ No phone number for ' + studentName); return; }
  const school = SD.config?.schoolName || 'School';
  const msg = encodeURIComponent(
    `Dear Parent,\n\n*${school}* 🌸\n\n` +
    `We are concerned about *${studentName}'s* attendance. ` +
    `Your child has been absent for 3 or more consecutive days.\n\n` +
    `Please contact the school or reply to this message.\n\n– EduBloom Teacher Agent`
  );
  window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${msg}`, '_blank');
  BloomAgents._log('📚 Teacher Agent', `Notified parent of ${studentName}`, 'Absence alert sent via WhatsApp');
}

function openAgentReminderModal(messages) {
  let idx = 0;
  const send = () => {
    if (idx >= messages.length) { toast(`✅ All ${messages.length} reminders sent!`); return; }
    const m = messages[idx];
    window.open(`https://wa.me/${(m.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(m.msg)}`, '_blank');
    idx++;
    setTimeout(send, 1200);
  };
  if (!confirm(`📲 Finance Agent will send fee reminders to ${messages.length} parents via WhatsApp.\n\nTap OK to start — messages open one by one.`)) return;
  send();
  BloomAgents._log('💰 Finance Agent', `Sent ${messages.length} fee reminders`, 'Batch WhatsApp reminders dispatched');
}

// ── Onboarding Wizard ─────────────────────────────────────────────────────
function openOnboardingWizard(students, noFees, noClass) {
  const el = document.getElementById('onboard-wizard-modal');
  if (!el) return;
  document.getElementById('onboard-student-count').textContent = students.length;
  document.getElementById('onboard-nofee-count').textContent = noFees.length;
  document.getElementById('onboard-noclass-count').textContent = noClass.length;
  el.style.display = 'flex';
}

function closeOnboardWizard() {
  const el = document.getElementById('onboard-wizard-modal');
  if (el) el.style.display = 'none';
  const config = SD.config || {};
  localStorage.setItem(`onboard_done_${config.schoolId || 'x'}`, '1');
}

function onboardGoFees() {
  closeOnboardWizard();
  go('revenue');
  toast('💰 Set each student\'s fee in the Fee column. Agent will track collection automatically.');
}

function onboardGoStudents() {
  closeOnboardWizard();
  go('students');
  toast('👥 Assign classes to each student. Use the Class column.');
}

// Auto-run agents on load (after SD is populated)
function startAgentRuntime() {
  BloomAgents.runAll(true);
  runSecurityChecks();
  // Load morningAlerts from SD on startup
  SD.morningAlerts = SD.morningAlerts || {};
  // Schedule the 8:30am and 9:30am checks
  MorningAlertSystem.scheduleDailyChecks();
  CommsAgent.checkBirthdays && (function(){
    const bdays = CommsAgent.checkBirthdays();
    if (bdays.length) BloomAgents._log("📢 Comms Agent", "Birthdays today: " + bdays.map(function(s){return s.name;}).join(", "), bdays.length + " student(s)");
  })();
  // Re-run agents every 5 minutes silently
  setInterval(function() { BloomAgents.runAll(true); }, 5 * 60 * 1000);
}



// ════════════════════════════════════════════════════════════════════════════
// AGENT 5 — COMMS AGENT
// Handles all parent communication: announcements, birthdays, result
// notifications, emergency broadcasts. No human manually writing messages.
// ════════════════════════════════════════════════════════════════════════════

const CommsAgent = {

  // ── Send a school-wide broadcast to ALL parents ─────────────────────────
  broadcastToAll(message, type) {
    const students = SD.students || [];
    const withPhone = students.filter(s => s.phone);
    if (!withPhone.length) { toast("No parent phone numbers saved yet."); return; }

    const school = SD.config && SD.config.schoolName ? SD.config.schoolName : "Our School";
    const fullMsg = "*" + school + "* \uD83C\uDF38\n\n" + message + "\n\n\u2014 EduBloom Comms Agent";
    const encoded = encodeURIComponent(fullMsg);

    // Queue messages — open one WA tab per parent, staggered
    let idx = 0;
    const next = function() {
      if (idx >= withPhone.length) {
        toast("\u2705 Broadcast sent to " + withPhone.length + " parents.");
        logComm("Broadcast: " + (type || "Announcement"), "Sent to " + withPhone.length + " parents.");
        CommsAgent._log("broadcast", type || "Announcement", withPhone.length + " parents reached");
        return;
      }
      const s = withPhone[idx];
      window.open("https://wa.me/" + s.phone.replace(/\D/g, "") + "?text=" + encoded, "_blank");
      idx++;
      setTimeout(next, 1300);
    };

    if (!confirm("Send this message to ALL " + withPhone.length + " parents?\n\n" + message.substring(0, 120) + (message.length > 120 ? "..." : ""))) return;
    next();
  },

  // ── Birthday scanner — runs daily, finds today's birthdays ──────────────
  checkBirthdays() {
    const students = SD.students || [];
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayMMDD = mm + "-" + dd;

    const birthdays = students.filter(function(s) {
      if (!s.dob) return false;
      // Support formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
      const dob = s.dob.replace(/\//g, "-");
      const parts = dob.split("-");
      let bMM, bDD;
      if (parts[0].length === 4) { bMM = parts[1]; bDD = parts[2]; }
      else { bDD = parts[0]; bMM = parts[1]; }
      return (bMM + "-" + bDD) === todayMMDD;
    });

    return birthdays;
  },

  sendBirthdayMessages() {
    const birthdays = CommsAgent.checkBirthdays();
    if (!birthdays.length) { toast("No birthdays today \uD83C\uDF82"); return; }
    const school = SD.config && SD.config.schoolName ? SD.config.schoolName : "Our School";

    birthdays.forEach(function(s) {
      if (!s.phone) return;
      const msg = encodeURIComponent(
        "Happy Birthday \uD83C\uDF89 to *" + s.name + "*!\n\n" +
        "From all of us at *" + school + "*, we wish you a wonderful birthday today. May this year bring you great success in your studies and beyond.\n\n" +
        "\uD83C\uDF82\uD83C\uDF38 \u2014 EduBloom"
      );
      setTimeout(function() {
        window.open("https://wa.me/" + s.phone.replace(/\D/g, "") + "?text=" + msg, "_blank");
      }, birthdays.indexOf(s) * 1200);
    });

    logComm("Birthday Messages", "Sent to " + birthdays.length + " students: " + birthdays.map(function(s) { return s.name; }).join(", "));
    CommsAgent._log("birthday", "Sent birthday wishes", birthdays.length + " student(s): " + birthdays.map(function(s) { return s.name; }).join(", "));
    toast("\uD83C\uDF82 Birthday messages sent for " + birthdays.length + " student(s)!");
  },

  // ── Term result notification — tells parents results are ready ───────────
  sendResultNotifications(term) {
    const students = SD.students || [];
    const school = SD.config && SD.config.schoolName ? SD.config.schoolName : "Our School";
    const withPhone = students.filter(function(s) { return s.phone; });
    if (!withPhone.length) { toast("No parent contacts found."); return; }

    let idx = 0;
    const next = function() {
      if (idx >= withPhone.length) {
        toast("\u2705 Result notifications sent to " + withPhone.length + " parents.");
        logComm("Result Notification: " + term, "Sent to " + withPhone.length + " parents.");
        CommsAgent._log("results", term + " result notifications sent", withPhone.length + " parents notified");
        return;
      }
      const s = withPhone[idx];
      const subs = SD.config && SD.config.subjects ? SD.config.subjects : [];
      const sid = s.id || students.indexOf(s);
      const termData = (SD.scores && SD.scores[term] ? SD.scores[term][sid] : null) || {};
      const totals = subs.map(function(sub) {
        const v = termData[sub] || {};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
      }).filter(function(v) { return v > 0; });
      const avg = totals.length ? Math.round(totals.reduce(function(a,b){return a+b;},0)/totals.length) : 0;

      const msg = encodeURIComponent(
        "Dear Parent,\n\n*" + school + "* \uD83C\uDF38\n\n" +
        "The " + term + " results for *" + s.name + "* are now ready.\n\n" +
        (avg > 0 ? "\uD83D\uDCCA Average Score: *" + avg + "%*\n\n" : "") +
        "Please visit the school to collect the report card or contact your class teacher.\n\n" +
        "\u2014 EduBloom Comms Agent"
      );
      window.open("https://wa.me/" + s.phone.replace(/\D/g, "") + "?text=" + msg, "_blank");
      idx++;
      setTimeout(next, 1300);
    };

    if (!confirm("Send " + term + " result notifications to " + withPhone.length + " parents?")) return;
    next();
  },

  _log: function(type, action, detail) {
    BloomAgents._log("\uD83D\uDCE2 Comms Agent [" + type + "]", action, detail);
  }
};

// ── Comms Agent UI functions ─────────────────────────────────────────────
function commsAgentBroadcast() {
  const msg = document.getElementById("comms-agent-msg") ? document.getElementById("comms-agent-msg").value.trim() : "";
  if (!msg) { toast("Type your message first."); return; }
  CommsAgent.broadcastToAll(msg, "Custom Announcement");
}

function commsAgentResult() {
  const term = document.getElementById("comms-term-select") ? document.getElementById("comms-term-select").value : "First Term";
  CommsAgent.sendResultNotifications(term);
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT 6 — SECURITY AGENT
// Real threat response for Nigerian school context:
// - Unauthorized pickup alert
// - Panic/emergency broadcast to ALL parents instantly
// - Unknown visitor log
// - Daily attendance anomaly (sudden mass absence = flag)
// - Safe arrival confirmation system
// - Authorized collector verification
// ════════════════════════════════════════════════════════════════════════════

const SecurityAgent = {

  // ── PANIC BUTTON — mass emergency alert to all parents ──────────────────
  // This is the most critical function. One tap sends to everyone.
  emergencyBroadcast(level) {
    const students = SD.students || [];
    const school = SD.config && SD.config.schoolName ? SD.config.schoolName : "Our School";
    const addr = SD.config && SD.config.address ? SD.config.address : "";
    const allPhones = [];

    students.forEach(function(s) {
      if (s.phone) allPhones.push({ name: s.name, phone: s.phone, type: "parent" });
      if (s.safety && s.safety.emergencyPhone) allPhones.push({ name: s.name + " (emergency)", phone: s.safety.emergencyPhone, type: "emergency" });
    });

    // Also alert staff
    (SD.staff || []).forEach(function(st) {
      if (st.phone) allPhones.push({ name: st.name, phone: st.phone, type: "staff" });
    });

    const unique = allPhones.filter(function(p, i, arr) {
      return arr.findIndex(function(x) { return x.phone === p.phone; }) === i;
    });

    if (!unique.length) { alert("CRITICAL: No contact numbers saved!\n\nGo to Students and add parent phone numbers immediately."); return; }

    const levelMessages = {
      "lockdown": "\uD83D\uDEA8 *SCHOOL LOCKDOWN — " + school.toUpperCase() + "*\n\nDO NOT come to the school to pick up your child right now.\n\nThe school is in LOCKDOWN. All students are SAFE and secured indoors.\n\nWe will send an ALL CLEAR when it is safe.\n\nDo NOT call the school line — keep it free for emergency services.\n\n\uD83D\uDCCD " + addr,
      "threat":   "\u26A0\uFE0F *SECURITY ALERT — " + school.toUpperCase() + "*\n\nThere is an active security threat near the school. Students are SAFE and accounted for.\n\nWe are cooperating with security forces. Do NOT attempt to come to the school now.\n\nYou will receive an update within 30 minutes.\n\n\uD83D\uDCCD " + addr,
      "fire":     "\uD83D\uDD25 *FIRE/EVACUATION ALERT — " + school.toUpperCase() + "*\n\nAll students have been safely evacuated. No casualties.\n\nPickup point: Please go to the DESIGNATED ASSEMBLY POINT near the school.\n\nBring your ID to collect your child.\n\n\uD83D\uDCCD " + addr,
      "allclear": "\u2705 *ALL CLEAR — " + school.toUpperCase() + "*\n\nThe earlier security alert has been resolved. All students are SAFE.\n\nNormal school activities have resumed. Thank you for your patience.\n\n\u2014 " + school + " Management"
    };

    const msg = levelMessages[level] || levelMessages["threat"];
    const encoded = encodeURIComponent(msg);

    const levelNames = { lockdown: "LOCKDOWN", threat: "SECURITY ALERT", fire: "FIRE/EVACUATION", allclear: "ALL CLEAR" };
    const confirmText = level === "allclear"
      ? "Send ALL CLEAR to " + unique.length + " contacts?"
      : "SEND " + (levelNames[level]||"EMERGENCY") + " ALERT to " + unique.length + " contacts (parents + staff)?\n\nThis will open WhatsApp for each contact.";

    if (!confirm(confirmText)) return;

    // Fire immediately — no delay for emergency
    let idx = 0;
    const fireNext = function() {
      if (idx >= unique.length) {
        SecurityAgent._log("EMERGENCY: " + (levelNames[level]||level), unique.length + " contacts alerted", "CRITICAL EVENT");
        alert("\u2705 Alert sent to " + unique.length + " contacts.\n\nIf any contact was unreachable, call them directly.");
        return;
      }
      window.open("https://wa.me/" + unique[idx].phone.replace(/\D/g,"") + "?text=" + encoded, "_blank");
      idx++;
      setTimeout(fireNext, 800);
    };
    fireNext();
  },

  // ── Unauthorized pickup attempt logger ───────────────────────────────────
  logUnauthorizedPickup(studentName, attemptedBy) {
    const students = SD.students || [];
    const s = students.find(function(x) { return x.name && x.name.toLowerCase() === studentName.toLowerCase(); });
    const school = SD.config && SD.config.schoolName ? SD.config.schoolName : "Our School";

    // Alert parent immediately
    if (s && s.phone) {
      const msg = encodeURIComponent(
        "\u26A0\uFE0F *PICKUP ALERT — " + school + "*\n\n" +
        "Someone we could NOT verify just attempted to collect *" + s.name + "* from school.\n\n" +
        "Person identified as: *" + attemptedBy + "*\n\n" +
        "We have REFUSED the pickup and your child is SAFE.\n\n" +
        "Please call the school NOW or reply to confirm if this person is authorised.\n\n" +
        "\u2014 EduBloom Security Agent"
      );
      window.open("https://wa.me/" + s.phone.replace(/\D/g,"") + "?text=" + msg, "_blank");
    }

    // Log the incident
    const incident = {
      type: "unauthorized_pickup",
      student: studentName,
      attemptedBy: attemptedBy,
      time: new Date().toISOString(),
      reportedBy: (SD.currentUser && SD.currentUser.name) ? SD.currentUser.name : userRole || "Staff"
    };
    SD.securityLog = SD.securityLog || [];
    SD.securityLog.unshift(incident);
    SQ.push("securityLog", SD.securityLog);

    SecurityAgent._log("Unauthorized Pickup", studentName + " — attempted by: " + attemptedBy, "Parent alerted via WhatsApp");
    renderSecurityLog();
    toast("\u26A0\uFE0F Incident logged. Parent alerted.");
  },

  // ── Visitor log ──────────────────────────────────────────────────────────
  logVisitor(name, purpose, phone) {
    const visit = {
      type: "visitor",
      name: name,
      purpose: purpose,
      phone: phone || "",
      timeIn: new Date().toISOString(),
      timeOut: null,
      clearedBy: null
    };
    SD.securityLog = SD.securityLog || [];
    SD.securityLog.unshift(visit);
    SQ.push("securityLog", SD.securityLog);
    SecurityAgent._log("Visitor Logged", name + " — " + purpose, "Logged at " + new Date().toLocaleTimeString());
    renderSecurityLog();
  },

  checkoutVisitor: function(idx) {
    SD.securityLog = SD.securityLog || [];
    if (!SD.securityLog[idx]) return;
    SD.securityLog[idx].timeOut = new Date().toISOString();
    SD.securityLog[idx].clearedBy = userRole || "Staff";
    SQ.push("securityLog", SD.securityLog);
    renderSecurityLog();
    toast("\u2705 Visitor checked out.");
  },

  // ── Anomaly detector: large sudden absence (potential mass threat) ───────
  checkAttendanceAnomaly() {
    const students = SD.students || [];
    if (students.length < 5) return;
    const today = new Date().toISOString().split("T")[0];
    const attData = SD.attendance || {};

    // Count today's absences
    let presentToday = 0, absentToday = 0, notMarked = 0;
    students.forEach(function(s) {
      const status = attData[today] ? attData[today][s.name] : null;
      if (status === "Present") presentToday++;
      else if (status === "Absent" || status === "A") absentToday++;
      else notMarked++;
    });

    const absentPct = Math.round((absentToday / students.length) * 100);
    const el = document.getElementById("security-anomaly-banner");
    if (!el) return;

    if (absentPct >= 40) {
      el.style.display = "block";
      el.style.background = "rgba(239,68,68,0.15)";
      el.style.borderColor = "rgba(239,68,68,0.5)";
      el.innerHTML = "\uD83D\uDEA8 <strong>ANOMALY DETECTED:</strong> " + absentPct + "% of students absent today (" + absentToday + "/" + students.length + "). This is unusually high — verify school safety.";
      SecurityAgent._log("Attendance Anomaly", absentPct + "% absent today", "Possible mass incident — manual check recommended");
    } else if (absentPct >= 25) {
      el.style.display = "block";
      el.style.background = "rgba(245,158,11,0.12)";
      el.style.borderColor = "rgba(245,158,11,0.4)";
      el.innerHTML = "\u26A0\uFE0F High absence today: " + absentToday + " students (" + absentPct + "%) not in school.";
    } else {
      el.style.display = "none";
    }
  },

  // ── Verify if a person is authorised to collect a student ───────────────
  verifyCollector(studentName, collectorName) {
    const s = (SD.students || []).find(function(x) {
      return x.name && x.name.toLowerCase().includes(studentName.toLowerCase());
    });
    if (!s) return { ok: false, reason: "Student not found in system" };

    const authorised = s.safety && s.safety.collectors ? s.safety.collectors : "";
    if (!authorised) return {
      ok: null,
      reason: "No authorised collectors listed for " + s.name + ". Call parent to confirm.",
      phone: s.phone || ""
    };

    const isAuth = authorised.toLowerCase().includes(collectorName.toLowerCase());
    return {
      ok: isAuth,
      name: s.name,
      authorised: authorised,
      reason: isAuth
        ? collectorName + " is listed as an authorised collector for " + s.name
        : collectorName + " is NOT in the authorised list. DO NOT release student."
    };
  },

  _log: function(action, detail, severity) {
    BloomAgents._log("\uD83D\uDD12 Security Agent", action, detail + (severity ? " [" + severity + "]" : ""));
  }
};

// ── Security Agent UI helpers ────────────────────────────────────────────
function renderSecurityLog() {
  const el = document.getElementById("security-incident-log");
  if (!el) return;
  const log = SD.securityLog || [];
  if (!log.length) {
    el.innerHTML = "<p style='font-size:0.78rem;color:var(--sub);text-align:center;padding:1rem;'>No incidents logged today.</p>";
    return;
  }
  el.innerHTML = log.slice(0, 30).map(function(e, i) {
    const t = new Date(e.timeIn || e.time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
    const isPickup = e.type === "unauthorized_pickup";
    const isVisitor = e.type === "visitor";
    const color = isPickup ? "#ef4444" : isVisitor ? "#f59e0b" : "#60a5fa";
    const icon  = isPickup ? "\uD83D\uDEA8" : isVisitor ? "\uD83D\uDC64" : "\uD83D\uDCCC";
    return "<div style='padding:0.5rem;border-left:3px solid " + color + ";margin-bottom:0.4rem;background:rgba(255,255,255,0.03);border-radius:0 6px 6px 0;font-size:0.78rem;'>" +
      "<div style='display:flex;justify-content:space-between;align-items:center;'>" +
      "<span>" + icon + " <strong>" + esc(isPickup ? "UNAUTH PICKUP — " + e.student : isVisitor ? "VISITOR: " + e.name : e.type) + "</strong></span>" +
      "<span style='color:var(--sub);font-size:0.7rem;'>" + t + "</span></div>" +
      (isPickup ? "<div style='color:#ef4444;font-size:0.72rem;margin-top:2px;'>Attempted by: " + esc(e.attemptedBy) + " · Reported by: " + esc(e.reportedBy) + "</div>" : "") +
      (isVisitor ? "<div style='color:var(--sub);font-size:0.72rem;margin-top:2px;'>Purpose: " + esc(e.purpose) + (e.timeOut ? " · \u2705 Checked out" : " · <span style=\"color:#f59e0b;\">Still inside</span>" + "<button onclick=\"SecurityAgent.checkoutVisitor(" + i + ")\" style=\"background:#059669;color:#fff;border:none;border-radius:4px;padding:1px 6px;font-size:0.68rem;cursor:pointer;margin-left:6px;\">Check Out</button>") + "</div>" : "") +
    "</div>";
  }).join("");
}

function securityVerifyCollector() {
  const student = document.getElementById("verify-student") ? document.getElementById("verify-student").value.trim() : "";
  const collector = document.getElementById("verify-collector") ? document.getElementById("verify-collector").value.trim() : "";
  const resultEl = document.getElementById("verify-result");
  if (!student || !collector) { toast("Enter both student name and collector name."); return; }

  const r = SecurityAgent.verifyCollector(student, collector);
  if (!resultEl) return;

  if (r.ok === true) {
    resultEl.style.background = "rgba(34,197,94,0.1)";
    resultEl.style.borderColor = "rgba(34,197,94,0.4)";
    resultEl.style.color = "#22c55e";
    resultEl.innerHTML = "\u2705 <strong>CLEARED</strong> — " + esc(r.reason);
  } else if (r.ok === false) {
    resultEl.style.background = "rgba(239,68,68,0.12)";
    resultEl.style.borderColor = "rgba(239,68,68,0.5)";
    resultEl.style.color = "#ef4444";
    resultEl.innerHTML = "\uD83D\uDEAB <strong>DO NOT RELEASE</strong> — " + esc(r.reason) + (r.authorised ? "<br><span style='font-size:0.72rem;color:#aaa;'>Authorised: " + esc(r.authorised) + "</span>" : "");
  } else {
    resultEl.style.background = "rgba(245,158,11,0.1)";
    resultEl.style.borderColor = "rgba(245,158,11,0.4)";
    resultEl.style.color = "#f59e0b";
    resultEl.innerHTML = "\u26A0\uFE0F <strong>CALL PARENT</strong> — " + esc(r.reason) + (r.phone ? " <a href='tel:" + esc(r.phone) + "' style='color:#60a5fa;margin-left:6px;'>\uD83D\uDCDE " + esc(r.phone) + "</a>" : "");
  }
  resultEl.style.display = "block";
  resultEl.style.padding = "0.6rem";
  resultEl.style.borderRadius = "8px";
  resultEl.style.border = "1.5px solid";
  resultEl.style.marginTop = "0.5rem";
  resultEl.style.fontWeight = "700";
  resultEl.style.fontSize = "0.82rem";
}

function securityLogPickup() {
  const student = document.getElementById("pickup-student") ? document.getElementById("pickup-student").value.trim() : "";
  const person  = document.getElementById("pickup-person")  ? document.getElementById("pickup-person").value.trim()  : "";
  if (!student || !person) { toast("Fill in both fields."); return; }
  SecurityAgent.logUnauthorizedPickup(student, person);
  document.getElementById("pickup-student").value = "";
  document.getElementById("pickup-person").value  = "";
}

function securityLogVisitor() {
  const name    = document.getElementById("visitor-name")    ? document.getElementById("visitor-name").value.trim()    : "";
  const purpose = document.getElementById("visitor-purpose") ? document.getElementById("visitor-purpose").value.trim() : "";
  const phone   = document.getElementById("visitor-phone")   ? document.getElementById("visitor-phone").value.trim()   : "";
  if (!name || !purpose) { toast("Visitor name and purpose are required."); return; }
  SecurityAgent.logVisitor(name, purpose, phone);
  document.getElementById("visitor-name").value    = "";
  document.getElementById("visitor-purpose").value = "";
  if (document.getElementById("visitor-phone")) document.getElementById("visitor-phone").value = "";
}

// Run security anomaly check after school data loads
function runSecurityChecks() {
  SecurityAgent.checkAttendanceAnomaly();
  SD.securityLog = SD.securityLog || [];
  renderSecurityLog();
}



// ════════════════════════════════════════════════════════════════════════════
// MORNING ALERT SYSTEM — Auto 8:30am absence check + no-reply follow-up
//
// Flow:
// 1. App loads → schedules 8:30am check (or fires immediately if past 8:30)
// 2. 8:30am → scans attendance for today
//    - Students already marked Present → skip
//    - Students marked Absent → send absence alert immediately
//    - Students NOT YET MARKED (unknown) → send "we haven't seen your child" alert
// 3. All alerts are logged in SD.morningAlerts with timestamp
// 4. No-reply tracker: at 9:30am, re-checks who hasn't responded
//    → sends follow-up escalation to parent + flags for principal
// ════════════════════════════════════════════════════════════════════════════

const MorningAlertSystem = {

  // ── Core: fire the 8:30am check ─────────────────────────────────────────
  runMorningCheck: function(forced) {
    const students = SD.students || [];
    if (!students.length) return;

    const today     = new Date().toISOString().split('T')[0];
    const school    = (SD.config && SD.config.schoolName) ? SD.config.schoolName : 'Our School';
    const att       = (SD.attendance && SD.attendance[today]) ? SD.attendance[today] : {};
    const alertKey  = 'morning_alert_sent_' + today;
    const alreadySent = localStorage.getItem(alertKey);

    // Don't double-send on same day unless forced
    if (alreadySent && !forced) {
      BloomAgents._log('⏰ Morning Alert', 'Already sent today — skipping', today);
      return;
    }

    const displayDate = new Date(today + 'T00:00:00').toLocaleDateString('en-NG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    const absent      = [];  // marked Absent
    const notMarked   = [];  // no record yet — unknown status
    const present     = [];  // marked Present

    students.forEach(function(s) {
      const status = att[s.name];
      if (status === 'Present')                   present.push(s);
      else if (status === 'Absent' || status === 'A') absent.push(s);
      else                                        notMarked.push(s);
    });

    // Nothing to alert if everyone is present
    if (!absent.length && !notMarked.length) {
      BloomAgents._log('⏰ Morning Alert', 'All students present — no alerts needed', today);
      localStorage.setItem(alertKey, new Date().toISOString());
      return;
    }

    // Only alert students who have a phone number
    const toAlert = [...absent, ...notMarked].filter(function(s) { return s.phone; });
    if (!toAlert.length) {
      BloomAgents._log('⏰ Morning Alert', 'No parent contacts to alert', today);
      localStorage.setItem(alertKey, new Date().toISOString());
      return;
    }

    // Confirm before firing (principal must approve)
    const summary =
      (absent.length    ? '❌ Absent: '    + absent.length    + '\n' : '') +
      (notMarked.length ? '❓ Not marked: ' + notMarked.length + '\n' : '') +
      '\nTotal parents to notify: ' + toAlert.length;

    if (!forced && !confirm(
      '⏰ 8:30am Morning Alert\n\n' + summary + '\n\nSend attendance alerts now?'
    )) return;

    // Build alert log record
    SD.morningAlerts = SD.morningAlerts || {};
    SD.morningAlerts[today] = SD.morningAlerts[today] || { sent: [], noReply: [], escalated: [] };

    // Fire messages
    toAlert.forEach(function(s, i) {
      const isAbsent   = absent.includes(s);
      const isUnknown  = notMarked.includes(s);

      let msgBody;
      if (isAbsent) {
        msgBody =
          'Your child *' + s.name + '* (' + (s.class||'') + ') has *NOT been seen at school* as of 8:30am today, *' + displayDate + '*.\n\n' +
          'Kindly reply with ONE of the following so we can confirm whereabouts:\n\n' +
          '1️⃣ Reply *SICK* — Child is unwell and staying home\n' +
          '2️⃣ Reply *COMING* — Child is on the way\n' +
          '3️⃣ Reply *EXCUSED* — Planned absence (travel, appointment, etc.)\n' +
          '4️⃣ Reply *UNKNOWN* — You are not sure where your child is\n\n' +
          '⚠️ *No reply within 1 hour means we will escalate to your emergency contact.*\n\n' +
          '— ' + school + ' Safety Team';
      } else {
        msgBody =
          'Your child *' + s.name + '* (' + (s.class||'') + ') has *NOT been seen at school* as of 8:30am today, *' + displayDate + '*.\n\n' +
          'Kindly reply with ONE of the following so we can confirm whereabouts:\n\n' +
          '1️⃣ Reply *SICK* — Child is unwell and staying home\n' +
          '2️⃣ Reply *COMING* — Child is on the way\n' +
          '3️⃣ Reply *EXCUSED* — Planned absence (travel, appointment, etc.)\n' +
          '4️⃣ Reply *UNKNOWN* — You are not sure where your child is\n\n' +
          '⚠️ *No reply within 1 hour means we will escalate to your emergency contact.*\n\n' +
          '— ' + school + ' Safety Team';
      }

      const fullMsg = encodeURIComponent(
        'Dear Parent / Guardian,\n\n' +
        '*' + school + '* 🌸\n\n' +
        msgBody + '\n\n' +
        '— EduBloom Morning Alert System'
      );

      setTimeout(function() {
        window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + fullMsg, '_blank');
      }, i * 1100);

      // Log this alert
      SD.morningAlerts[today].sent.push({
        name:      s.name,
        phone:     s.phone,
        class:     s.class || '',
        status:    isAbsent ? 'absent' : 'unknown',
        sentAt:    new Date().toISOString(),
        replied:   false,
        escalated: false
      });
    });

    // Persist alert log
    SQ.push('morningAlerts', SD.morningAlerts);
    localStorage.setItem(alertKey, new Date().toISOString());

    BloomAgents._log(
      '⏰ Morning Alert',
      'Sent to ' + toAlert.length + ' parents',
      'Absent: ' + absent.length + ' · Unmarked: ' + notMarked.length + ' · ' + displayDate
    );

    // Schedule no-reply follow-up for 9:30am (1 hour later)
    MorningAlertSystem.scheduleNoReplyCheck();

    toast('⏰ 8:30am alerts sent to ' + toAlert.length + ' parents.');
  },

  // ── No-reply follow-up at 9:30am ─────────────────────────────────────────
  // Since we cannot receive WA replies automatically, we treat anyone whose
  // status hasn't been updated by 9:30am as "no reply" and escalate.
  runNoReplyCheck: function() {
    const today   = new Date().toISOString().split('T')[0];
    const school  = (SD.config && SD.config.schoolName) ? SD.config.schoolName : 'Our School';
    const alerts  = (SD.morningAlerts && SD.morningAlerts[today]) ? SD.morningAlerts[today] : null;
    if (!alerts || !alerts.sent || !alerts.sent.length) return;

    const att = (SD.attendance && SD.attendance[today]) ? SD.attendance[today] : {};
    const displayDate = new Date(today + 'T00:00:00').toLocaleDateString('en-NG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    // Check who is STILL absent/unmarked and hasn't been resolved
    const noReply = alerts.sent.filter(function(entry) {
      if (entry.escalated) return false; // already escalated
      const currentStatus = att[entry.name];
      // If now marked Present, they showed up — no follow-up needed
      if (currentStatus === 'Present') return false;
      return true; // still absent or still not marked
    });

    if (!noReply.length) {
      BloomAgents._log('⏰ Morning Alert', 'No-reply check: all resolved', today);
      return;
    }

    // Show principal the no-reply list
    const names = noReply.map(function(e) { return e.name + ' (' + e.class + ')'; }).join('\n');

    if (!confirm(
      '🔴 9:30am No-Reply Follow-Up\n\n' +
      noReply.length + ' parent(s) have NOT confirmed receipt of the morning alert:\n\n' +
      names + '\n\n' +
      'Send escalation messages now?'
    )) return;

    noReply.forEach(function(entry, i) {
      const s = (SD.students||[]).find(function(x) { return x.name === entry.name; });
      if (!s || !s.phone) return;

      const hasEmergency = s.safety && s.safety.emergencyPhone;

      // Escalation message to parent
      const parentMsg = encodeURIComponent(
        'Dear Parent / Guardian,\n\n' +
        '*' + school + '* 🌸 — FOLLOW-UP\n\n' +
        '🔴 *URGENT — No Response Received*\n\n' +
        'We sent a safety alert this morning about *' + s.name + '* and have received *no reply*.\n\n' +
        'As of 9:30am, we *cannot confirm the whereabouts* of your child.\n\n' +
        'You MUST respond to this message immediately with one of:\n\n' +
        '1️⃣ *SICK* — Unwell at home\n' +
        '2️⃣ *COMING* — On the way\n' +
        '3️⃣ *EXCUSED* — Known absence\n' +
        '4️⃣ *UNKNOWN* — You do not know where your child is\n\n' +
        'If we do not hear from you, we will contact your *emergency contact* and notify the *school authority*.\n\n' +
        '— ' + school + ' Safety Team'
      );

      setTimeout(function() {
        window.open('https://wa.me/' + s.phone.replace(/\D/g,'') + '?text=' + parentMsg, '_blank');
      }, i * 1100);

      // If there is a separate emergency contact, alert them too
      if (hasEmergency) {
        setTimeout(function() {
          const emergMsg = encodeURIComponent(
            'URGENT — *' + school + '*\n\n' +
            'You are listed as the emergency contact for *' + s.name + '*.\n\n' +
            'As of 9:30am, the parent of this child has *not responded* to our safety alert.\n\n' +
            'We cannot confirm this child\'s whereabouts today.\n\n' +
            'Please contact the parent *immediately* and confirm whether ' + s.name + ' is safe.\n\n' +
            'Then reply to this message: *SAFE* or *UNKNOWN*.\n\n' +
            '— ' + school + ' Safety Team'
          );
          window.open('https://wa.me/' + s.safety.emergencyPhone.replace(/\D/g,'') + '?text=' + emergMsg, '_blank');
        }, (noReply.length + i) * 1100);
      }

      // Mark as escalated in log
      entry.escalated = true;
      entry.escalatedAt = new Date().toISOString();
      alerts.noReply.push({ name: entry.name, escalatedAt: entry.escalatedAt });
    });

    // Persist
    SQ.push('morningAlerts', SD.morningAlerts);

    BloomAgents._log(
      '⏰ Morning Alert',
      '9:30am no-reply escalation: ' + noReply.length + ' parent(s)',
      noReply.map(function(e){ return e.name; }).join(', ')
    );

    toast('🔴 Escalation sent to ' + noReply.length + ' unconfirmed parent(s).');
    renderMorningAlertStatus();
  },

  // ── Schedule the checks at the right times ───────────────────────────────
  scheduleDailyChecks: function() {
    const now     = new Date();
    const today   = now.toISOString().split('T')[0];
    const alertKey = 'morning_alert_sent_' + today;
    const alreadySent = localStorage.getItem(alertKey);

    // Target times in milliseconds from now
    const t830  = new Date(today + 'T08:30:00').getTime();
    const t930  = new Date(today + 'T09:30:00').getTime();
    const nowMs = now.getTime();

    // ── 8:30am check ──
    if (nowMs < t830) {
      // Schedule for later today
      const msUntil830 = t830 - nowMs;
      setTimeout(function() {
        MorningAlertSystem.runMorningCheck(false);
      }, msUntil830);
      BloomAgents._log('⏰ Morning Alert', 'Scheduled for 8:30am today', Math.round(msUntil830/60000) + ' mins away');
    } else if (!alreadySent && nowMs < t930) {
      // It's between 8:30 and 9:30 — fire immediately if not sent
      setTimeout(function() {
        MorningAlertSystem.runMorningCheck(false);
      }, 3000);
      BloomAgents._log('⏰ Morning Alert', 'Past 8:30am — firing now (not yet sent today)', '');
    } else if (alreadySent && nowMs > t830) {
      BloomAgents._log('⏰ Morning Alert', 'Already sent today', alertKey);
    }

    // ── 9:30am no-reply check ──
    if (nowMs < t930) {
      const msUntil930 = t930 - nowMs;
      setTimeout(function() {
        MorningAlertSystem.runNoReplyCheck();
      }, msUntil930);
    } else {
      // Past 9:30 — check if escalation was done
      const alerts = SD.morningAlerts && SD.morningAlerts[today];
      if (alerts && alerts.sent && alerts.sent.length && !alerts.noReply.length) {
        // Escalation not yet done — offer it
        setTimeout(function() {
          MorningAlertSystem.runNoReplyCheck();
        }, 5000);
      }
    }
  },

  scheduleNoReplyCheck: function() {
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const t930  = new Date(today + 'T09:30:00').getTime();
    const nowMs = now.getTime();
    const delay = Math.max(t930 - nowMs, 60000); // min 1 min if already past 9:30
    setTimeout(function() {
      MorningAlertSystem.runNoReplyCheck();
    }, delay);
  }
};

// ── Morning alert status panel renderer ────────────────────────────────────
function renderMorningAlertStatus() {
  const el = document.getElementById('morning-alert-status');
  if (!el) return;

  const today  = new Date().toISOString().split('T')[0];
  const alerts = SD.morningAlerts && SD.morningAlerts[today];
  const att    = (SD.attendance && SD.attendance[today]) ? SD.attendance[today] : {};

  if (!alerts || !alerts.sent || !alerts.sent.length) {
    el.innerHTML = '<p style="font-size:0.76rem;color:var(--sub);text-align:center;padding:0.5rem;">No morning alerts sent yet today.</p>';
    return;
  }

  el.innerHTML = alerts.sent.map(function(entry) {
    const currentStatus = att[entry.name];
    const resolved  = currentStatus === 'Present';
    const escalated = entry.escalated;
    const color = resolved ? '#22c55e' : escalated ? '#ef4444' : '#f59e0b';
    const icon  = resolved ? '✅' : escalated ? '🔴' : '⏳';
    const label = resolved ? 'Now Present' : escalated ? 'Escalated 9:30am' : 'Awaiting Confirmation';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.76rem;">' +
      '<span>' + icon + ' <b>' + esc(entry.name) + '</b> <span style="color:var(--sub);">(' + esc(entry.class) + ')</span></span>' +
      '<span style="color:' + color + ';font-size:0.7rem;font-weight:700;">' + label + '</span>' +
      '</div>';
  }).join('');
}

// ── Manual trigger for principal ────────────────────────────────────────────
function triggerMorningAlertNow() {
  MorningAlertSystem.runMorningCheck(true);
}

function triggerNoReplyCheckNow() {
  MorningAlertSystem.runNoReplyCheck();
}
