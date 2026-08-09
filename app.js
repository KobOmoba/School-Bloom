// ═══════════════════════════════════════════════════════════════════════
// EDUCATIONAL BLOOM — app.js (MERGED: v1 base + v2 extras)
// Term-based scoring (CA1/CA2/CA3/Exam) is the canonical data model.
// OCR uses Groq Vision (qwen/qwen3.6-27b) — sole engine, no fallback chain.
// AI Tools (report card remarks, insights) now use Groq (see index.html inline scripts).
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

// ── Groq Vision OCR (Structured Outputs) — PRIMARY OCR ──────────────────
// Key stored encoded; managed via AariNAT Command Center Settings

// ── OCR Upload Overlay ──────────────────────────────────────────────────
function ocrOverlayShow(filename) {
  const el = document.getElementById('ocr-overlay');
  if (el) el.style.display = 'flex';
  const fn = document.getElementById('ocr-filename');
  if (fn) fn.textContent = filename || 'image';
  const defaultText = { load: 'Loading image...', upload: 'Uploading to cloud OCR', read: 'Reading names from image', done: 'Done' };
  ['load','upload','read','done'].forEach(s => {
    const row = document.getElementById('ocr-step-' + s);
    const icon = document.getElementById('ocr-step-' + s + '-icon');
    const text = document.getElementById('ocr-step-' + s + '-text');
    if (row) row.style.color = '#94a3b8';
    if (icon) icon.textContent = s === 'load' ? '⏳' : '🔍';
    if (text) text.textContent = defaultText[s]; // clear stale text from a previous scan
  });
  const loadRow = document.getElementById('ocr-step-load');
  if (loadRow) loadRow.style.color = '#6366f1';
  const bar = document.getElementById('ocr-bar');
  if (bar) { bar.style.width = '0%'; bar.style.background = 'linear-gradient(90deg,#6366f1,#818cf8)'; }
  const thumbWrap = document.getElementById('ocr-thumb-wrap');
  if (thumbWrap) thumbWrap.style.display = 'none';
}

function ocrOverlayThumb(dataUrl) {
  const wrap = document.getElementById('ocr-thumb-wrap');
  const img  = document.getElementById('ocr-thumb');
  if (wrap && img) { img.src = dataUrl; wrap.style.display = 'block'; }
}

function ocrOverlayStep(step, status, progress) {
  const map = { load: 'load', upload: 'upload', scan: 'upload', read: 'read', done: 'done', error: 'done' };
  const key = map[step] || step;
  const row  = document.getElementById('ocr-step-' + key);
  const icon = document.getElementById('ocr-step-' + key + '-icon');
  const text = document.getElementById('ocr-step-' + key + '-text');
  if (row)  row.style.color = step === 'error' ? '#f87171' : '#6366f1';
  if (icon) icon.textContent = step === 'error' ? '⚠️' : (step === 'done' ? '✅' : '🔍');
  if (text && status) text.textContent = status;
  const bar = document.getElementById('ocr-bar');
  if (bar) {
    bar.style.width = Math.min(progress || 0, 100) + '%';
    if (step === 'error') bar.style.background = 'linear-gradient(90deg,#f87171,#dc2626)';
    if (step === 'done')  bar.style.background = 'linear-gradient(90deg,#34d399,#10b981)';
  }
  ['load','upload','read','done'].forEach(s => {
    if (s === key) return;
    const r = document.getElementById('ocr-step-' + s);
    if (r && (progress || 0) >= 100 && step !== 'error') r.style.color = '#34d399';
  });
}

function ocrOverlayPages(cur, total) {
  const fn = document.getElementById('ocr-filename');
  if (fn && total > 1) fn.textContent = 'Page ' + cur + ' of ' + total;
}

function ocrOverlayHide(delayMs) {
  setTimeout(() => {
    const el = document.getElementById('ocr-overlay');
    if (el) el.style.display = 'none';
    const bar = document.getElementById('ocr-bar');
    if (bar) bar.style.background = 'linear-gradient(90deg,#6366f1,#818cf8)';
  }, delayMs || 0);
}

// ── OpenCV.js loader (lazy-loaded on first OCR scan) ──────────────────────
let _cvReady = false, _cvLoading = false;
function loadOpenCV() {
  return new Promise(resolve => {
    if (_cvReady) return resolve(true);
    if (_cvLoading) { const wait = setInterval(() => { if (_cvReady) { clearInterval(wait); resolve(true); } }, 200); return; }
    _cvLoading = true;
    if (document.getElementById('opencv-js')) { // script tag exists but Module not ready
      const wait = setInterval(() => {
        if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; clearInterval(wait); resolve(true); }
      }, 200);
      return;
    }
    const s = document.createElement('script');
    s.id = 'opencv-js';
    s.src = 'https://docs.opencv.org/4.x/opencv.js';
    s.async = true;
    s.onload = () => {
      // OpenCV.js uses a Module init pattern
      if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; resolve(true); }
      else if (window.cv) {
        cv['onRuntimeInitialized'] = () => { _cvReady = true; _cvLoading = false; resolve(true); };
      } else {
        // Fallback: poll for readiness
        const wait = setInterval(() => {
          if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; clearInterval(wait); resolve(true); }
        }, 300);
        setTimeout(() => { if (!_cvReady) { clearInterval(wait); _cvLoading = false; resolve(false); } }, 15000);
      }
    };
    s.onerror = () => { _cvLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
}

// ── OpenCV preprocessing: grayscale → denoise → adaptive threshold → deskew ──
async function preprocessWithOpenCV(canvas) {
  if (!_cvReady) return canvas;
  try {
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Denoise (removes shadows and phone-camera noise)
    const denoised = new cv.Mat();
    cv.fastNlMeansDenoising(gray, denoised, 10, 7, 21);

    // Adaptive threshold (makes handwriting crisp black-on-white)
    const binary = new cv.Mat();
    cv.adaptiveThreshold(denoised, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 10);

    // Deskew: find the dominant text angle and rotate to straighten
    const deskewed = _deskew(binary);

    // Write back to canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = deskewed.cols; outCanvas.height = deskewed.rows;
    cv.imshow(outCanvas, deskewed);

    src.delete(); gray.delete(); denoised.delete(); binary.delete(); deskewed.delete();
    return outCanvas;
  } catch (e) {
    console.warn('[OpenCV] preprocessing failed, using raw image:', e.message);
    return canvas;
  }
}

function _deskew(binaryMat) {
  try {
    // Use Hough line transform to estimate skew angle
    const edges = new cv.Mat();
    cv.Canny(binaryMat, edges, 50, 150);
    const lines = new cv.Mat();
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 30, 10);

    let angles = [];
    for (let i = 0; i < Math.min(lines.rows, 30); i++) {
      const x1 = lines.data32F[i * 4], y1 = lines.data32F[i * 4 + 1];
      const x2 = lines.data32F[i * 4 + 2], y2 = lines.data32F[i * 4 + 3];
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      // Only accept near-horizontal lines (text lines are mostly horizontal)
      if (Math.abs(angle) < 20) angles.push(angle);
    }
    edges.delete(); lines.delete();

    if (angles.length < 3) return binaryMat.clone(); // not enough lines to estimate

    // Median angle (robust against outliers)
    angles.sort((a, b) => a - b);
    const median = angles[Math.floor(angles.length / 2)];
    if (Math.abs(median) < 0.5) return binaryMat.clone(); // already straight

    // Rotate the image to correct the skew
    const rows = binaryMat.rows, cols = binaryMat.cols;
    const M = cv.getRotationMatrix2D(new cv.Point(cols / 2, rows / 2), median, 1);
    const rotated = new cv.Mat();
    cv.warpAffine(binaryMat, rotated, M, new cv.Size(cols, rows), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255));
    M.delete();
    return rotated;
  } catch (e) {
    console.warn('[OpenCV] deskew failed:', e.message);
    return binaryMat.clone();
  }
}

function resizeImageForOCR(dataURL) {
  return new Promise(async resolve => {
    const img = new Image();
    img.onload = async () => {
      const MAX = 1000;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // OpenCV preprocessing (if available) — improves handwriting clarity
      let finalCanvas = canvas;
      try {
        const cvReady = await loadOpenCV();
        if (cvReady) {
          finalCanvas = await preprocessWithOpenCV(canvas);
        }
      } catch (e) {
        console.warn('[OCR] OpenCV preprocess skipped:', e.message);
        finalCanvas = canvas;
      }

      resolve(finalCanvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// OCR ENGINE — Groq Vision (primary) → HuggingFace Vision → OCR.space
// Exact copy of the Bloom Agent OCR pipeline — kept identical across both apps.
// Keys are centrally managed in Firestore admin_settings/main (groqApiKey, hfApiKey)
// and auto-synced into localStorage on login — never hardcoded per-app.
// ═══════════════════════════════════════════════════════════════════════════

const AARINAT_OCR_URL = 'https://aarinat-ocr.aarinat-company-limited.workers.dev';

const GROQ_KEY_STORAGE = 'groq_api_key';
let _lastOcrError = '';
function getGroqKey() { return window.GROQ_API_KEY || localStorage.getItem(GROQ_KEY_STORAGE) || ''; }
const GROQ_OCR_MODEL = 'qwen/qwen3.6-27b'; // llama-4-scout deprecated June 17 2026
let _groqRateLimitedThisSession = false; // once Groq hits an org-wide rate limit, skip it for remaining pages this scan

// ═══════════════════════════════════════════════════════════════════════
// OCR ENGINE v2 — schema-driven, one engine for every document type
//
// Every discipline fix, every anti-hallucination rule, and every
// adaptive-reading improvement lives in ONE place (OCR_CORE_DISCIPLINE).
// Adding a new document type = one new entry in OCR_SCHEMAS. No new
// hand-written prompt needed, no risk of discipline rules drifting out
// of sync between features.
//
// Usage: buildOcrPrompt('schema_key')
//        buildOcrPrompt('schema_key', { subject: 'Mathematics', termNum: '2' })
// ═══════════════════════════════════════════════════════════════════════

const OCR_CORE_DISCIPLINE = [
  'CORE RULES (apply regardless of document type):',
  '1. NO HALLUCINATION: Transcribe ONLY what is visibly present. Do not add',
  '   contextual words, correct spelling, infer missing data, or summarize.',
  '2. NUMBERS: Read digit by digit, not at a glance. Common handwriting',
  '   confusions: 7 vs 1 — 0 vs 6 — 4 vs 9 — 5 vs 8 — 3 vs 8.',
  '3. ILLEGIBLE/UNCERTAIN: If a field is illegible, cropped, or you are not',
  '   confident, output null for that field — never guess a plausible value.',
  '   Exception: domain rules for a specific schema may override this for names.',
  '4. STAMPS & SIGNATURES: Use a bracketed note e.g. [SIGNATURE PRESENT].',
  '5. Return ONLY valid JSON — no markdown fences, no explanation text,',
  '   no conversational filler before or after the JSON object.'
].join('\n');

const OCR_ADAPTIVE_STRUCTURE = [
  'ADAPTIVE STRUCTURE READING:',
  '- Do not assume a fixed column position or field order.',
  '- Read the actual headers/labels present on THIS specific page first.',
  '- Map what you find to the requested fields based on the header text',
  '  AND the pattern of the data (small numbers near dates = payment amounts;',
  '  large round numbers = fee totals).',
  '- If related numeric fields do not reconcile logically (e.g. stated total',
  '  does not equal balance_bf + termFees), re-examine your column mapping.'
].join('\n');

const NIGERIAN_NAME_REFERENCE = [
  'NIGERIAN NAMES — use these for recognition, not for guessing:',
  'Surnames: OGUNLADE, KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE,',
  '  OLAWALE, SHONPE, GBELEKALE, OLIYIDE, KOLANOLE, ADEGUNLE, ADEOYE, LAWAL,',
  '  AYOMIDE, OBASA, OLATUNDE, ADENIYI, OGUNSOLA, ILELABOYE, OLOOETU',
  'Firstnames: GABRIEL, RASAQ, GODWIN, ENOCH, ABIGEAL, KOREDE, MICHEAL,',
  '  ADEMIDE, SUCCESS, EZEKIEL, AWAL, EMMANUEL, BIGGOLD, QUARDRI, MUEEZ,',
  '  ZAINAB, SALAM, WAJUD, SALAIM, AISHA, ABDULLAHI, KHALEED, EMEKA, CHIOMA'
].join('\n');

const OCR_SCHEMAS = {

  // ── 1. Student class register (names extraction) ───────────────────
  student_roster: {
    intro: 'You are reading a Nigerian school attendance/class register photo.',
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES:',
      '- Every row = one student — read ALL rows, do not skip any.',
      '- Combine as "SURNAME FIRSTNAME" (all caps).',
      '- Ignore serial numbers, headers (NAMES, S/N), fee columns, dates, totals.',
      '- Look for a class/form name anywhere on the page (header, title, corner)',
      '  and return as detected_class (all caps, e.g. "JSS 2A"). Return null if',
      '  not visible — do NOT guess.',
      '- NAME EXCEPTION: make your best effort to read handwritten names even if',
      '  unclear — a garbled name is better than omitting the student entirely.'
    ],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: { detected_class: null, names: ['SURNAME FIRSTNAME'] }
  },

  // ── 2. Fee payment ledger (the 14-column handwritten register) ─────
  fee_ledger: {
    intro: 'You are reading a photograph of a Nigerian school fees ledger (handwritten register book). Extract ALL student payment records visible.',
    usesAdaptiveStructure: true,
    domainRules: [
      'COLUMN STRUCTURE (typical, may vary — adapt to what is actually on this page):',
      '  S/N | NAMES | BALANCE FROM LAST TERM | CURRENT TERMS FEES | TOTAL |',
      '  1ST PAYMENT | BALANCE | DATE | 2ND PAYMENT | BALANCE | DATE |',
      '  3RD PAYMENT | BALANCE | DATE',
      'PAYMENT STATUS — scan the ENTIRE row before deciding:',
      '  - "FULLY PAID" / "FULL PAID" / "FULLY P" / "F.P." / "FP" / ticks (✓)',
      '    or a zero remaining balance anywhere on the row → "FULLY PAID"',
      '  - Partial amount less than total, or remaining balance > 0 → "Partial"',
      '  - No evidence of payment on the entire row → "No Payment"',
      '  - Never default silently to "No Payment" — any mark or amount on the',
      '    row must be investigated before using "No Payment".',
      'NUMERIC RULES:',
      '  - Naira amounts as integers: 28,000 and 28.000 and ₦28000 all = 28000',
      '  - Dates in D/M/YY format (e.g. 12/5/26 = 12 May 2026)',
      '  - Crossed-out number = correction; use the newer number beside it',
      '  - Blank cell = null',
      '  - Ignore TOTAL rows at the bottom of the page',
      '  - "BALANCE 3,000" appearing before CURRENT TERMS FEES = bal_bf'
    ],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: {
      class: '', term: '', year: '',
      students: [{
        sn: 1, surname: '', firstname: '',
        bal_bf: null, term_fees: 0, total: 0,
        pmt1: null, bal1: null, date1: null,
        pmt2: null, bal2: null, date2: null,
        pmt3: null, bal3: null, date3: null,
        status: 'FULLY PAID|Partial|No Payment'
      }]
    }
  },

  // ── 3a. Score sheet — read all 3 terms ────────────────────────────
  score_sheet_all: {
    intro: (p) => `You are reading a Nigerian school CA/exam score sheet (broadsheet) for subject: ${p && p.subject ? p.subject : 'unknown subject'}.`,
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES:',
      '- The sheet has THREE term blocks side by side: "1ST TERM", "2ND TERM", "3RD TERM".',
      '- Within each block: 1st CA | 2nd CA | 3rd CA (each /10) | Exam (/70).',
      '- Read EVERY student row and ALL THREE terms.',
      '- If the sheet only shows one or two terms, fill the missing terms with zeros.',
      '- Names: SURNAME FIRSTNAME, all caps.',
      '- NAME EXCEPTION: best-effort on unclear names — garbled > omitted.'
    ],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: [{
      name: 'SURNAME FIRSTNAME',
      t1: { ca1: 0, ca2: 0, ca3: 0, exam: 0 },
      t2: { ca1: 0, ca2: 0, ca3: 0, exam: 0 },
      t3: { ca1: 0, ca2: 0, ca3: 0, exam: 0 }
    }]
  },

  // ── 3b. Score sheet — read one specific term only ──────────────────
  score_sheet_single: {
    intro: (p) => {
      const labels = { '1': '1ST TERM', '2': '2ND TERM', '3': '3RD TERM' };
      const label = labels[p && p.termNum] || '1ST TERM';
      return `You are reading a Nigerian school CA/exam score sheet for subject: ${p && p.subject ? p.subject : 'unknown subject'}. Read ONLY the ${label} columns.`;
    },
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES:',
      '- The sheet may show multiple terms — read ONLY the columns under the',
      '  requested term block; ignore all other terms\' columns.',
      '- Within that term: 1st CA | 2nd CA | 3rd CA (each /10) | Exam (/70).',
      '- Blank or illegible score cell = 0.',
      '- Names: SURNAME FIRSTNAME, all caps.',
      '- NAME EXCEPTION: best-effort on unclear names — garbled > omitted.'
    ],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: [{ name: 'SURNAME FIRSTNAME', ca1: 0, ca2: 0, ca3: 0, exam: 0 }]
  },

  // ── 4. Exam script (individual student answer sheet) ───────────────
  exam_script: {
    intro: 'You are reading a single Nigerian student\'s exam script or answer sheet.',
    usesAdaptiveStructure: false,
    domainRules: [
      'DOMAIN RULES:',
      '- Read the student name (usually at the top of the page).',
      '- Read the total marked score — the final marked total, not intermediate sums.',
      '- If multiple scores appear, return the one circled or marked as final.'
    ],
    outputShape: { name: '', score: 0 }
  },

  // ── 5. Student admission form / ID / register entry ────────────────
  // Used by: scanStudentForm, scanStudentFormEdit
  student_info: {
    intro: 'You are reading a photograph that contains Nigerian school student information. The document format can be ANYTHING — printed admission form, handwritten notebook page, register table, student ID card, WhatsApp screenshot, or typed list.',
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES (find these fields ANYWHERE in the image regardless of format):',
      '- name: student full name. Look under "Name:", "Student:", "Pupil:", or column',
      '  "Names". Can be SURNAME FIRSTNAME or FIRSTNAME SURNAME.',
      '- parent_phone: 11-digit Nigerian number (starts 07/08/09) or +234 prefix.',
      '  Look near "Phone:", "WhatsApp:", "Tel:", "Parent:", or column "Phone No".',
      '- class: class/grade. Values: Basic 1–6, Primary 1–6, JSS 1–3, SSS 1–3,',
      '  Nursery 1–2, KG. Look near "Class:", "Form:", "Grade:", or column "Class".',
      '- fee: Naira fee amount. Near "Fee:", ₦ symbol, or column "Fee". Integer only.',
      '- dob: date of birth ONLY if clearly visible. Return exactly as written.',
      '- FIELD EXCEPTION: output "UNCLEAR" (not null) for fields you cannot read —',
      '  this triggers the per-field retry UI for the school staff.'
    ],
    outputShape: { name: '', parent_phone: '', class: '', fee: null, dob: '' }
  },

  // ── 6–10. New document types — schemas ready, UI not built yet ─────

  subjects: {
    intro: 'You are reading a Nigerian school curriculum sheet, timetable, or subject list.',
    usesAdaptiveStructure: false,
    domainRules: [
      'DOMAIN RULES:',
      '- Normalize subject names (e.g. "MATHS" → "Mathematics", "ENG LANG" → "English Language").',
      '- Do not duplicate a subject that appears more than once.',
      '- Ignore class names, teacher names, times, room numbers, and any other metadata.'
    ],
    outputShape: { subjects: [''] }
  },

  staff: {
    intro: 'You are reading a Nigerian school staff or teacher list.',
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES:',
      '- Role is one of: Class Teacher, Subject Teacher, Bursar, Principal.',
      '- Infer the closest role from context (e.g. "Form Tutor" → "Class Teacher").',
      '- assignedClass: the class this teacher is responsible for, or null.'
    ],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: { staff: [{ name: '', role: '', assignedClass: null }] }
  },

  alumni: {
    intro: 'You are reading a Nigerian school alumni or graduates list.',
    usesAdaptiveStructure: true,
    domainRules: [],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: { alumni: [{ name: '', year: null, job: null, phone: null }] }
  },

  expenses: {
    intro: 'You are reading a Nigerian school expense record, receipt, or expense ledger.',
    usesAdaptiveStructure: true,
    domainRules: [
      'DOMAIN RULES:',
      '- If a total line is visible, check that extracted amounts roughly sum to it.',
      '  Re-read digits if they do not reconcile.',
      '- Categories (pick the closest): Staff Salaries, Utilities, Building Maintenance,',
      '  Teaching Materials, Government/Ministry Fees, Cleaning & Security, Transport,',
      '  Examination Fees, Other.'
    ],
    outputShape: { expenses: [{ description: '', amount: 0, date: null, category: 'Other' }] }
  },

  sports_roster: {
    intro: 'You are reading a Nigerian school sports team roster or fixture list.',
    usesAdaptiveStructure: true,
    domainRules: [],
    referenceData: NIGERIAN_NAME_REFERENCE,
    outputShape: { players: [{ name: '', num: null, pos: null }] }
  }
};

// ── Engine: builds a complete prompt from a schema entry ─────────────────
function buildOcrPrompt(schemaKey, params) {
  const schema = OCR_SCHEMAS[schemaKey];
  if (!schema) throw new Error('[OCR] Unknown schema: ' + schemaKey);
  const intro = typeof schema.intro === 'function' ? schema.intro(params) : schema.intro;
  const parts = [
    intro, '',
    OCR_CORE_DISCIPLINE,
    schema.usesAdaptiveStructure ? '\n' + OCR_ADAPTIVE_STRUCTURE : '',
    schema.domainRules && schema.domainRules.length ? '\n' + schema.domainRules.join('\n') : '',
    schema.referenceData ? '\n' + schema.referenceData : '',
    '',
    'Return JSON in exactly this shape (no markdown, no extra text):',
    JSON.stringify(schema.outputShape, null, 2)
  ];
  return parts.filter(Boolean).join('\n');
}

const GROQ_OCR_PROMPT = buildOcrPrompt('student_roster');

// Set by groqVisionOCR/hfVisionOCR when the model spots a class/form header on the page.
// Reset to '' at the start of each new multi-page scan (see processImagesSequentially).
let _lastDetectedClass = '';

const HF_OCR_MODEL = 'DEPRECATED'; // HF fallback removed — Groq only
const HF_KEY_STORAGE = 'hf_api_key';
function getHFKey() { return window.HF_API_KEY || localStorage.getItem(HF_KEY_STORAGE) || ''; }

// Keys sync from Firestore admin_settings/main — survives browsing-data clears
async function _fetchGroqKeyFromFirestore() {
  // Reads directly from Firestore now — no external proxy. public_ocr_keys/main
  // holds ONLY the OCR keys (never anything sensitive), mirrored there by the
  // portal whenever Bayo updates a key in Settings.
  try {
    if (!db) return;
    const doc = await db.collection('public_ocr_keys').doc('main').get();
    if (!doc.exists) return; // fall back to whatever's cached in localStorage
    const d = doc.data();
    if (d.groqApiKey) {
      window.GROQ_API_KEY = d.groqApiKey;
      localStorage.setItem(GROQ_KEY_STORAGE, d.groqApiKey);
      console.log('✅ Groq key loaded from Firestore');
    }
    if (d.hfApiKey) {
      window.HF_API_KEY = d.hfApiKey;
      localStorage.setItem(HF_KEY_STORAGE, d.hfApiKey);
      console.log('✅ HF key loaded from Firestore');
    }
  } catch(e) { /* offline — use whatever is in localStorage */ }
}

async function groqVisionOCR(base64, mime, _retry) {
  if (_retry === undefined) _retry = 0;
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('No Groq API key');

  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), 45000);

  let resp;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: GROQ_OCR_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
            { type: 'text', text: GROQ_OCR_PROMPT }
          ]
        }],
        temperature: 0.2,
        max_tokens: 4096,
        reasoning_format: 'hidden'
      })
    });
    clearTimeout(fetchTimer);
  } catch (fetchErr) {
    clearTimeout(fetchTimer);
    if (fetchErr.name === 'AbortError') {
      if (_retry >= 2) throw new Error('Groq timed out — page skipped (slow connection or server busy)');
      const ld = document.getElementById('csv-loading');
      for (let s = 25; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Groq slow — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
        await new Promise(r => setTimeout(r, 1000));
      }
      return groqVisionOCR(base64, mime, _retry + 1);
    }
    if (_retry < 2) {
      const ld = document.getElementById('csv-loading');
      for (let s = 15; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Network error — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
        await new Promise(r => setTimeout(r, 1000));
      }
      return groqVisionOCR(base64, mime, _retry + 1);
    }
    throw fetchErr;
  }

  if (resp.status === 429 || resp.status === 503 || resp.status === 529) {
    if (_retry >= 2) {
      const errData = await resp.json().catch(() => ({}));
      if (resp.status === 429) _groqRateLimitedThisSession = true; // stop hammering Groq for the rest of this scan
      throw new Error((errData.error && errData.error.message) || 'Groq unavailable — page skipped, try rescanning.');
    }
    const is429 = resp.status === 429;
    const resetRaw = is429 ? (resp.headers.get('x-ratelimit-reset-tokens') || '65') : '25';
    const waitSecs = Math.ceil(parseFloat(resetRaw)) + 5;
    const reason = is429 ? 'rate limit' : 'over capacity';
    const ld = document.getElementById('csv-loading');
    for (let s = waitSecs; s > 0; s--) {
      if (ld) ld.textContent = '⏳ Groq ' + reason + ' — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
      await new Promise(r => setTimeout(r, 1000));
    }
    return groqVisionOCR(base64, mime, _retry + 1);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Groq API key invalid — check Settings');
  }

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error((errData.error && errData.error.message) || ('Groq ' + resp.status));
  }

  const data = await resp.json();
  let text = data.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('Groq returned empty response');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let jsonStr = text.trim();
  const cb = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/); if (cb) jsonStr = cb[1].trim();
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch(_) {
    const fallbackNames = (typeof extractNamesFromText === 'function') ? extractNamesFromText(text) : [];
    return fallbackNames.map(n => { const p=n.trim().toUpperCase().split(/\s+/); return {surname:p[0]||'',firstname:p.slice(1).join(' ')||'',fullName:n.trim().toUpperCase()}; }).filter(s=>s.fullName.length>=3);
  }
  if (parsed && !Array.isArray(parsed) && parsed.detected_class) {
    const dc = String(parsed.detected_class).trim().toUpperCase();
    if (dc) _lastDetectedClass = dc;
  }
  const names = Array.isArray(parsed) ? parsed : (parsed.names || parsed.students || []);
  if (!Array.isArray(names) || !names.length) throw new Error('Groq returned 0 names');
  return names.map(n => {
    if (typeof n === 'string') {
      const p = n.trim().toUpperCase().split(/\s+/);
      return { surname: p[0]||'', firstname: p.slice(1).join(' ')||'', fullName: n.trim().toUpperCase() };
    }
    const sur=(n.surname||'').trim().toUpperCase(), fst=(n.firstname||n.first_name||n.firstName||'').trim().toUpperCase();
    const full=(n.fullName||n.full_name||'').trim().toUpperCase()||(sur+' '+fst).trim();
    return {surname:sur, firstname:fst, fullName:full};
  }).filter(s=>s.fullName.length>=2);
}

async function _readOnePage(file, pageNum, total, fbEl, skipGroq) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async ev => {
      try {
      const imgData = await resizeImageForOCR(ev.target.result);
      const b64    = imgData.split(',')[1];
      let mime = file.type || '';
      if (!mime || mime === 'application/octet-stream' || mime === 'application/unknown') {
        mime = 'image/jpeg';
      }

      ocrOverlayThumb(imgData);
      ocrOverlayPages(pageNum, total);

      const groqKey = getGroqKey();
      const canTryGroq = !!groqKey && !skipGroq;

      ocrOverlayStep('load', canTryGroq
        ? 'Image loaded — sending to Groq Vision...'
        : '⚠️ No Groq API key — scanning unavailable (page ' + pageNum + ')...', 20);

      // Retry loading keys once if the proxy hadn't finished/succeeded yet (e.g. slow network on first login)
      if (!groqKey && typeof _fetchGroqKeyFromFirestore === 'function') {
        await _fetchGroqKeyFromFirestore().catch(() => {});
      }

      if (canTryGroq) {
        try {
          ocrOverlayStep('upload', 'Groq Vision scanning (page ' + pageNum + '/' + total + ')...', 50);
          const names = await groqVisionOCR(b64, mime);
          if (names && names.length) {
            ocrOverlayStep('done', '✅ ' + names.length + ' names found (page ' + pageNum + ')', 100);
            resolve(names); return;
          }
          _lastOcrError = 'Groq returned 0 names';
        } catch (e) {
          _lastOcrError = e.message || 'Groq Vision failed';
          console.error('Groq Vision error (page ' + pageNum + '):', _lastOcrError);
        }
      } else {
        _lastOcrError = 'Groq API key not configured — contact admin';
      }
      ocrOverlayStep('error', '⚠️ OCR failed: ' + _lastOcrError.slice(0, 60), 100);
      resolve([]);
      } catch(fatal) { console.error('_readOnePage fatal:', fatal.message||String(fatal)); resolve([]); }
    };

    reader.onerror = () => {
      _lastOcrError = 'Could not read file';
      ocrOverlayStep('error', '❌ Could not read file — use an image or PDF', 100);
      resolve([]);
    };

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
  const noDigits = t.replace(/\d+/g, '').trim();
  if (noDigits.length < 2) return false;
  const low = t.toLowerCase();
  if (UI_BLACKLIST.some(b => low.includes(b))) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  const alpha = t.replace(/[^a-zA-Z]/g, '');
  if (alpha.length < 3) return false;
  const isAllCaps = alpha === alpha.toUpperCase();
  const consonantRun = (t.match(/[^aeiouAEIOU\s.,'\'\-]{9,}/g) || []);
  if (consonantRun.length > 0) return false;
  const hasRealWord = words.some(w => {
    const a = w.replace(/[^a-zA-Z]/g, '');
    return a.length >= 3;
  });
  if (!hasRealWord) return false;
  if (VALID_PREFIXES.test(t)) return true;
  if (isAllCaps && alpha.length >= 3) return true;
  const hasProperNoun = words.some(w => w.length >= 3 && /^[A-Z]/.test(w) && /[a-z]/.test(w));
  return hasProperNoun;
}

// ── Nigerian Name Extractor — handles ALL-CAPS handwritten registers ──────

function extractNigerianNames(raw) {
  // ── Step 1: clean all lines ───────────────────────────────────────────
  const allLines = (raw || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const cleanLine = (line) => {
    const low = line.toLowerCase();
    if (UI_BLACKLIST.some(b => low.includes(b))) return null;
    if (/^(class|serial|no\b|names?|balance|term|from|date|\bsn\b|s\/n)/i.test(line)) return null;

    // ── Reject lines that are entirely class/grade names ──────────────────
    if (/^\s*(BASIC\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|\d+)|NURSERY(\s*\d|\s*1\s*[&AND]+\s*2)?|PRE.?NURSERY|JSS\s*[1-3]|SS[S]?\s*[1-3]|(BASIC|PRIMARY)\s*[1-6]|KG\s*[12]?|UNKNOWN|RECEPTION)\s*$/i.test(line)) return null;

    // Strip ALL leading non-letter chars — handles X14, V17, ✓14, •3, "- 2" etc.
    let c = line.replace(/^[^a-zA-Z]+/, '').trim();

    // Strip trailing balance/fee noise
    c = c.replace(/\bBALANCE[\s\d,]*$/i, '')
         .replace(/[\d,]+\s*$/, '')
         .replace(/\b(BALANCE|PAID|OWING|FEE|TERM|CLASS|FROM|BASIC|NURSERY|JSS|SS\d?)\b/gi, '')
         .replace(/[^a-zA-Z\s'\-]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();

    // ── Merge OCR column-split artifacts: "RASA Q" → "RASAQ", "OGUND EI" → "OGUNDEI"
    // When a word of 3+ letters is followed by 1-2 isolated letters, merge them
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
    const stripped = t.replace(/^\d+[.)\s]+/, '').replace(/^[-\u2022*]\s*/, '').trim();
    if (!stripped || stripped.length < 2) return;
    if (/^\d+$/.test(stripped.replace(/[,.\-]/g, ''))) return;
    if (looksLikeValidName(stripped)) candidates.push(stripped);
  });
  // Deduplicate
  const seen = new Set();
  return candidates.filter(n => {
    const key = n.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Alias used by hfVisionOCR / ocrSpaceOCR fallback text parsing
function extractNamesFromText(raw) {
  return extractNigerianNames(raw);
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
    if (window._demoMode) return; // Demo mode — no persistence, no Firestore writes
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
          // Use a persistent offline timestamp — UI updates after 5s
          setTimeout(() => {
            if (this._offlineSince && !navigator.onLine && el) {
              el.className = 'sdot sd-off'; el.textContent = '● Offline';
            }
          }, 5000);
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
    if (window._demoMode || !db || !schoolId) return;
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
const _PREMIUM_SCAN_MODALS = { 'add-student-modal': 'ns', 'add-staff-modal': 'sf', 'add-expense-modal': 'exp' };
// ── Password hashing (SHA-256 via Web Crypto) ────────────────────────────────
async function _hashPassword(pwd) {
  if (!pwd) return '';
  try {
    const enc = new TextEncoder().encode('bloom_salt_v1:' + pwd);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch(e) {
    // Fallback for older browsers
    let h = 0;
    const s = 'bloom_salt_v1:' + pwd;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return 'fallback_' + Math.abs(h).toString(16);
  }
}

async function _verifyPassword(pwd, storedHash) {
  if (!storedHash) return !pwd; // no password set = any empty password works
  if (!pwd) return false;
  // Check if stored value is a hash (64 hex chars for SHA-256) or plaintext (legacy)
  if (storedHash.length === 64 && /^[0-9a-f]+$/.test(storedHash)) {
    const h = await _hashPassword(pwd);
    return h === storedHash;
  }
  // Legacy plaintext fallback — auto-migrate on next successful login
  if (storedHash === pwd) return true;
  return false;
}

async function _migratePasswordIfNeeded(staff, pwd) {
  if (!staff.password) return;
  // If password is already hashed (64 hex chars), skip
  if (staff.password.length === 64 && /^[0-9a-f]+$/.test(staff.password)) return;
  // If plaintext matches, hash it and save
  if (staff.password === pwd) {
    staff.password = await _hashPassword(pwd);
  }
}

const openM = id => {
  const el = $(id); if (el) el.classList.add('on');
  const prefix = _PREMIUM_SCAN_MODALS[id];
  if (prefix) {
    const scanBox = $(prefix + '-premium-scan'), nudgeBox = $(prefix + '-premium-nudge');
    if (_isPremium()) {
      if (scanBox) scanBox.style.display = 'block';
      if (nudgeBox) nudgeBox.style.display = 'none';
    } else {
      if (scanBox) scanBox.style.display = 'none';
      if (nudgeBox) nudgeBox.style.display = 'block';
    }
  }
};
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
  if (window._demoMode) return; // Demo mode — no persistence
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
// ── Score validation helpers ──────────────────────────────────────────
// Caps CA values to 0–10 and Exam to 0–70 to catch OCR misreads and
// impossible entries. Returns the capped values + flags.
function _capScoreEntry(v) {
  if (!v) v = { ca1:0, ca2:0, ca3:0, exam:0 };
  const cap = (val, max) => {
    const n = Number(val) || 0;
    return { raw: n, capped: Math.max(0, Math.min(max, n)), over: n > max };
  };
  const ca1 = cap(v.ca1, 10);
  const ca2 = cap(v.ca2, 10);
  const ca3 = cap(v.ca3, 10);
  const exam = cap(v.exam, 70);
  const caT = ca1.capped + ca2.capped + ca3.capped;
  const tot = caT + exam.capped;
  const hasOverflow = ca1.over || ca2.over || ca3.over || exam.over;
  return { ca1: ca1.capped, ca2: ca2.capped, ca3: ca3.capped, exam: exam.capped,
           ca1Raw: ca1.raw, ca2Raw: ca2.raw, ca3Raw: ca3.raw, examRaw: exam.raw,
           caT, tot, hasOverflow };
}

// Returns true if a subject entry actually exists in the term data
// (distinguishes "student scored 0" from "no scores entered yet")
function _hasScoreEntry(termData, sub) {
  return termData && termData[sub] && typeof termData[sub] === 'object';
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
// ── Role-based navigation whitelist ──────────────────────────────────────
// null = Principal (sees everything). All other roles use explicit whitelists.
// Anything NOT in the set is hidden from the nav AND gated in go().
const ROLE_TABS = {
  'Principal':       null,
  'Class Teacher':   new Set(['students','sports','arts','music','health','comms','security','support']),
  'Subject Teacher': new Set(['students','sports','arts','music','health','comms','security','support','scorecard']),
  'Bursar':          new Set(['revenue','students','expenses','finance','comms','analytics','support']),
};
const ROLE_DEFAULT_TAB = {
  'Principal': 'revenue', 'Bursar': 'revenue',
  'Class Teacher': 'students', 'Subject Teacher': 'scorecard'
};

// Normalise legacy role strings → canonical ROLE_TABS keys
const ROLE_NORMALISE = {
  'teacher': 'Class Teacher', 'class teacher': 'Class Teacher',
  'subject teacher': 'Subject Teacher', 'arts teacher': 'Subject Teacher',
  'music teacher': 'Subject Teacher', 'sports coach': 'Subject Teacher',
  'bursar': 'Bursar', 'accountant': 'Bursar',
  'head teacher': 'Principal', 'vice principal': 'Principal',
  'admin': 'Principal', 'principal': 'Principal',
};
function _normRole(r) { return ROLE_NORMALISE[(r||'').toLowerCase()] || r || 'Class Teacher'; }
function _allowedTabs() { return ROLE_TABS[_normRole(userRole)] || null; }
function _canGo(tab)    { const a = _allowedTabs(); return !a || a.has(tab); }

function canSeeFees() { return ['Principal', 'Bursar'].includes(userRole); }
function getAssignedClass() { return currentStaff ? currentStaff.assignedClass : null; }

function applyRoleRestrictions() {
  const allowed = _allowedTabs();
  document.querySelectorAll('.nlink').forEach(btn => {
    const tab = btn.dataset.t;
    btn.style.display = (!allowed || !tab || allowed.has(tab)) ? '' : 'none';
  });
  // Principal-only UI elements
  const principalOnly = ['btn-add-staff','btn-school-settings','sec-settings'];
  principalOnly.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (userRole === 'Principal') ? '' : 'none';
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

async function doPrincipalLogin() {
  const pwd = ($('sl-p-pwd')?.value || '').trim();
  const errEl = $('sl-p-err');
  if (errEl) errEl.style.display = 'none';
  if (!pwd) { if (errEl) { errEl.textContent = 'Enter your school password.'; errEl.style.display = 'block'; } return; }
  // Check principal login with hashed password support (async)
  let principal = null;
  for (const s of (SD.staff || [])) {
    if (await _verifyPassword(pwd, s.password || '')) {
      principal = s;
      break;
    }
  }
  if (!principal) {
    if (errEl) { errEl.textContent = 'Incorrect password. Check your agent WhatsApp. Default is bloom2026.'; errEl.style.display = 'block'; }
    return;
  }
  currentStaff = principal; userRole = 'Principal';
  localStorage.setItem('p_' + schoolId + '_staffSession', JSON.stringify(Object.assign({}, principal, { role: 'Principal', schoolId })));
  _saveAuth(schoolId, principal.email || '');
  // Silently attempt Firebase Auth so subcollection security rules work for Principal.
  // Fails gracefully if Principal doesn't have a Firebase Auth account yet —
  // the flat parent document (public read) still loads the school data.
  if (principal.email) {
    const pPlain = $('p-pwd')?.value || '';
    firebase.auth().signInWithEmailAndPassword(principal.email, pPlain).catch(() => {});
  }
  const div = $('staff-login'); if (div) div.style.display = 'none';
  startApp();
}

async function doStaffLogin() {
  const email = ($('sl-email')?.value || '').trim().toLowerCase();
  const pwd = $('sl-pwd')?.value || '';
  const errEl = $('sl-s-err');
  if (errEl) errEl.style.display = 'none';
  if (!email || !pwd) { if (errEl) { errEl.textContent = 'Enter your email and password.'; errEl.style.display = 'block'; } return; }

  // Try real Firebase Auth first (own project, matches the pattern used for admin login).
  try {
    const v2Staff = await staffLoginV2(schoolId, email, pwd);
    const staffRecord = (SD.staff || []).find(s => (s.email || '').trim().toLowerCase() === email) || {
      name: v2Staff.name, email, role: v2Staff.role, assignedClass: v2Staff.assignedClass, assignedSubjects: v2Staff.assignedSubjects
    };
    staffRecord._v2Uid = v2Staff.uid;
    currentStaff = staffRecord; userRole = _normRole(v2Staff.role || staffRecord.role || 'Class Teacher');
    localStorage.setItem('p_' + schoolId + '_staffSession', JSON.stringify(Object.assign({}, currentStaff, { schoolId })));
    _saveAuth(schoolId, email);
    const div = $('staff-login'); if (div) div.style.display = 'none';
    startApp();
    return;
  } catch (authErr) {
    // No real account yet, or wrong password for it — fall through to the legacy check below.
  }

  // Legacy fallback: hashed password stored on the staff record.
  let staff = null;
  for (const s of (SD.staff || [])) {
    if ((s.email || '').trim().toLowerCase() === email && await _verifyPassword(pwd, s.password || '')) {
      staff = s;
      break;
    }
  }
  if (!staff) {
    const emailFound = (SD.staff || []).find(s => (s.email || '').trim().toLowerCase() === email);
    const msg = emailFound
      ? '❌ Wrong password. Ask your Principal to reset it, or tap Forgot Password below.'
      : '❌ Email not found in staff list. Ask your Principal to check your staff record.';
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    return;
  }
  currentStaff = staff; userRole = _normRole(staff.role || 'Class Teacher');
  localStorage.setItem('p_' + schoolId + '_staffSession', JSON.stringify(Object.assign({}, staff, { schoolId })));
  _saveAuth(schoolId, email);
  const div = $('staff-login'); if (div) div.style.display = 'none';
  startApp();
}

// ═══════════════════════════════════════════════════════════════════════
// DATA MODEL — subcollection structure (the ONLY data store for this app)
//
//   schools/{id}/students/{studentId}                      → profile (name, class, phone)
//   schools/{id}/students/{studentId}/private/fees         → totalFee, paid, paymentHistory
//   schools/{id}/students/{studentId}/scores/{term_sub}    → ca1/ca2/ca3/exam per subject per term
//   schools/{id}/staff_directory/{uid}                     → Firebase Auth UID, role, assignedClass, assignedSubjects
//
// Score doc IDs: "Term1_Mathematics" style — spaces stripped, human-readable.
// Firestore security rules are drafted in the README (Phase 3) — publish
// after real-device testing is confirmed passing.
// ═══════════════════════════════════════════════════════════════════════

function _scoreDocId(term, subject) {
  return String(term).replace(/\s+/g, '') + '_' + String(subject).replace(/\s+/g, '');
}
function _studentsColV2(schoolId) {
  return db.collection('schools').doc(schoolId).collection('students');
}
function _staffDirColV2(schoolId) {
  return db.collection('schools').doc(schoolId).collection('staff_directory');
}

// ── Students (profile only — no fees, no scores) ──────────────────────────
async function loadAllStudentsV2(schoolId, classFilter) {
  let query = _studentsColV2(schoolId);
  if (classFilter) query = query.where('class', '==', classFilter);
  const snap = await query.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function saveStudentProfileV2(schoolId, student) {
  const profile = {
    name: student.name || '', phone: student.phone || '', class: student.class || '',
    promotion: student.promotion || null,
    updatedAt: new Date().toISOString()
  };
  const docId = student._v2Id || _studentsColV2(schoolId).doc().id;
  await _studentsColV2(schoolId).doc(docId).set(profile, { merge: true });
  return docId;
}
async function deleteStudentV2(schoolId, studentId) {
  const studentRef = _studentsColV2(schoolId).doc(studentId);
  // Delete score sub-documents first
  const scoresSnap = await studentRef.collection('scores').get();
  const batch = db.batch();
  scoresSnap.docs.forEach(doc => batch.delete(doc.ref));
  batch.delete(studentRef.collection('private').doc('fees'));
  batch.delete(studentRef);
  await batch.commit();
}

// ── Fees (separately gated sub-document — Principal/Bursar only once rules are live) ──
async function loadStudentFeesV2(schoolId, studentId) {
  const doc = await _studentsColV2(schoolId).doc(studentId).collection('private').doc('fees').get();
  return doc.exists ? doc.data() : { totalFee: 0, paid: 0, paymentHistory: [] };
}
async function saveStudentFeesV2(schoolId, studentId, feeData) {
  await _studentsColV2(schoolId).doc(studentId).collection('private').doc('fees')
    .set({ ...feeData, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Scores (one document per student, per term, per subject — this split is
// what makes per-subject-teacher rules possible; see Phase 3 rule design) ──
async function saveScoreV2(schoolId, studentId, term, subject, scoreData) {
  await _studentsColV2(schoolId).doc(studentId).collection('scores').doc(_scoreDocId(term, subject))
    .set({ term, subject, ca1: scoreData.ca1||0, ca2: scoreData.ca2||0, ca3: scoreData.ca3||0, exam: scoreData.exam||0 }, { merge: true });
}
async function loadStudentScoresV2(schoolId, studentId) {
  const snap = await _studentsColV2(schoolId).doc(studentId).collection('scores').get();
  const scores = {}; // { term: { subject: {ca1,ca2,ca3,exam} } }
  snap.docs.forEach(doc => {
    const d = doc.data();
    if (!scores[d.term]) scores[d.term] = {};
    scores[d.term][d.subject] = { ca1: d.ca1||0, ca2: d.ca2||0, ca3: d.ca3||0, exam: d.exam||0 };
  });
  return scores;
}

// ── Staff (real Firebase Auth accounts, keyed by their real uid) ──────────
async function createStaffAccountV2(schoolId, email, password, staffData) {
  const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
  await _staffDirColV2(schoolId).doc(cred.user.uid).set({
    name: staffData.name || '', email, role: staffData.role,
    assignedClass: staffData.assignedClass || null,       // Class Teacher only
    assignedSubjects: staffData.assignedSubjects || [],    // Subject Teacher only
    createdAt: new Date().toISOString()
  });
  return cred.user.uid;
}
async function staffLoginV2(schoolId, email, password) {
  const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
  const uid  = cred.user.uid;
  const doc  = await _staffDirColV2(schoolId).doc(uid).get();

  if (!doc.exists) {
    // staff_directory write may have failed during addStaff — auto-heal from SD.staff
    const rec = (SD.staff || []).find(s => (s.email || '').trim().toLowerCase() === email.toLowerCase());
    if (rec) {
      const entry = {
        email, name: rec.name, role: rec.role,
        assignedClass: rec.assignedClass || null,
        assignedSubjects: rec.assignedSubjects || [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      try { await _staffDirColV2(schoolId).doc(uid).set(entry); } catch(e) { /* non-fatal */ }
      return { uid, ...entry };
    }
    await firebase.auth().signOut();
    throw new Error('Firebase Auth OK but no staff record at this school. Ask your Principal to re-add your account.');
  }
  return { uid, ...doc.data() };
}
async function loadStaffDirectoryV2(schoolId) {
  const snap = await _staffDirColV2(schoolId).get();
  return snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
}

// ── Read path: subcollections → in-memory shape ───────────────────────────
// Loads all students, fees, and scores from the subcollection structure into
// the SD in-memory shape that all render functions already understand.
// Called on every login. Empty subcollections = new school with no students yet.
async function hydrateFromV2(schoolId) {
  if (!schoolId || SD.config?._demo) return;
  try {
    // Class Teachers must filter by their class — this also makes the Firestore
    // security rule satisfiable (rule requires resource.data.class == myClass,
    // which requires a matching where() clause in the query).
    const classFilter = (userRole === 'Class Teacher' && currentStaff?.assignedClass)
      ? currentStaff.assignedClass : null;

    const v2Students = await loadAllStudentsV2(schoolId, classFilter);

    const students = [];
    const scores   = {};
    for (const s of v2Students) {
      const fees          = await loadStudentFeesV2(schoolId, s.id);
      const studentScores = await loadStudentScoresV2(schoolId, s.id);
      const student = {
        _v2Id: s.id, name: s.name, phone: s.phone || '', class: s.class || '',
        totalFee: fees.totalFee || 0, paid: fees.paid || 0,
        paymentHistory: fees.paymentHistory || []
      };
      students.push(student);
      const sid = s.id;
      Object.keys(studentScores).forEach(term => {
        if (!scores[term]) scores[term] = {};
        scores[term][sid] = studentScores[term];
      });
    }

    // Only replace existing data if:
    // a) We got students back, OR
    // b) A class filter was applied (0 students in that class is a legitimate result)
    if (students.length > 0 || classFilter !== null) {
      SD.students = students;
      SD.scores   = scores;
      saveLocal('students', SD.students);
      saveLocal('scores', SD.scores);
    }
    // If 0 results with no filter (auth issue or permission denied returned []),
    // keep whatever loadSchoolIntoSD already loaded from the flat parent document.
    console.log(`✅ Hydrated ${students.length} students from V2 (filter: ${classFilter || 'none'})`);
  } catch(e) {
    console.warn('hydrateFromV2 failed — keeping flat data:', e.message);
  }
}

// ── Staff account claim — staff member sets a password once, which creates
// their real Firebase Auth account and links it via staff_directory.
// Their legacy password login continues to work as a fallback.
async function sendStaffPasswordReset(email) {
  if (!email) { toast('Enter your email above first.'); return; }
  try {
    await firebase.auth().sendPasswordResetEmail(email.trim().toLowerCase());
    toast('✅ Password reset email sent to ' + email + '. Check your inbox.');
  } catch(e) {
    toast('❌ ' + (e.message || 'Could not send reset email. Check the address.'));
  }
}
async function claimStaffAccountV2(schoolId, email, newPassword) {
  const normEmail = (email || '').trim().toLowerCase();
  const staffRecord = (SD.staff || []).find(s => (s.email || '').trim().toLowerCase() === normEmail);
  if (!staffRecord) throw new Error('No staff record found with that email at this school.');
  if (newPassword.length < 6) throw new Error('Password needs at least 6 characters (Firebase Auth requirement).');
  const uid = await createStaffAccountV2(schoolId, normEmail, newPassword, {
    name: staffRecord.name, role: staffRecord.role,
    assignedClass: staffRecord.assignedClass || null,
    assignedSubjects: staffRecord.assignedSubjects || []
  });
  staffRecord._v2Uid = uid;
  await SQ.push('staff', SD.staff);
  return uid;
}

function claimAccountUI() {
  const errEl = $('claim-err'); if (errEl) errEl.style.display = 'none';
  if ($('claim-email')) $('claim-email').value = '';
  if ($('claim-pwd')) $('claim-pwd').value = '';
  openM('claim-account-modal');
}
async function submitClaimAccount() {
  const email = ($('claim-email')?.value || '').trim();
  const pwd = $('claim-pwd')?.value || '';
  const errEl = $('claim-err');
  const btn = $('claim-submit-btn');
  if (errEl) errEl.style.display = 'none';
  if (!email || !pwd) {
    if (errEl) { errEl.textContent = 'Fill in both fields.'; errEl.style.display = 'block'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up...'; }
  try {
    await claimStaffAccountV2(schoolId, email, pwd);
    closeM('claim-account-modal');
    alert('✅ Account claimed. You can now log in with this email + password directly.');
  } catch (e) {
    if (errEl) { errEl.textContent = e.message || 'Failed — try again.'; errEl.style.display = 'block'; }
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔑 Claim Account'; }
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
      d1:{'Mathematics':{ca1:8,ca2:7,ca3:8,exam:62},'English Language':{ca1:7,ca2:8,ca3:7,exam:65},'Basic Science':{ca1:7,ca2:8,ca3:7,exam:60}},
      d2:{'Mathematics':{ca1:9,ca2:9,ca3:8,exam:75},'English Language':{ca1:7,ca2:8,ca3:7,exam:60},'Basic Science':{ca1:8,ca2:8,ca3:9,exam:70}},
      d3:{'Mathematics':{ca1:5,ca2:7,ca3:5,exam:45},'English Language':{ca1:6,ca2:6,ca3:7,exam:48},'Basic Science':{ca1:7,ca2:6,ca3:6,exam:50}},
      d4:{'Mathematics':{ca1:9,ca2:10,ca3:9,exam:78},'English Language':{ca1:8,ca2:9,ca3:8,exam:70},'Basic Science':{ca1:9,ca2:9,ca3:8,exam:75}},
      d5:{'Mathematics':{ca1:7,ca2:8,ca3:7,exam:55},'English Language':{ca1:7,ca2:8,ca3:7,exam:58},'Basic Science':{ca1:7,ca2:7,ca3:8,exam:56}},
      d6:{'Mathematics':{ca1:8,ca2:8,ca3:9,exam:68},'English Language':{ca1:9,ca2:8,ca3:10,exam:72},'Basic Science':{ca1:8,ca2:9,ca3:8,exam:65}},
      d7:{'Mathematics':{ca1:10,ca2:10,ca3:9,exam:80},'English Language':{ca1:10,ca2:9,ca3:9,exam:78},'Basic Science':{ca1:9,ca2:10,ca3:9,exam:76}},
      d8:{'Mathematics':{ca1:5,ca2:5,ca3:6,exam:40},'English Language':{ca1:5,ca2:5,ca3:6,exam:42},'Basic Science':{ca1:6,ca2:5,ca3:5,exam:44}},
      d9:{'Mathematics':{ca1:8,ca2:7,ca3:8,exam:60},'English Language':{ca1:8,ca2:8,ca3:7,exam:63},'Basic Science':{ca1:8,ca2:7,ca3:8,exam:62}},
      d10:{'Mathematics':{ca1:7,ca2:6,ca3:7,exam:52},'English Language':{ca1:7,ca2:7,ca3:6,exam:54},'Basic Science':{ca1:6,ca2:7,ca3:6,exam:53}},
    }
  };
  // Term 1 (slightly lower — start of session)
  demoScores['Term 1'] = {
    d1:{'Mathematics':{ca1:7,ca2:8,ca3:7,exam:55},'English Language':{ca1:8,ca2:7,ca3:8,exam:58},'Basic Science':{ca1:7,ca2:8,ca3:7,exam:52}},
    d2:{'Mathematics':{ca1:9,ca2:9,ca3:8,exam:68},'English Language':{ca1:7,ca2:8,ca3:7,exam:55},'Basic Science':{ca1:8,ca2:8,ca3:9,exam:65}},
    d3:{'Mathematics':{ca1:5,ca2:6,ca3:5,exam:38},'English Language':{ca1:6,ca2:5,ca3:6,exam:42},'Basic Science':{ca1:6,ca2:6,ca3:5,exam:44}},
    d4:{'Mathematics':{ca1:9,ca2:8,ca3:9,exam:72},'English Language':{ca1:8,ca2:9,ca3:8,exam:65},'Basic Science':{ca1:9,ca2:8,ca3:9,exam:70}},
    d5:{'Mathematics':{ca1:7,ca2:7,ca3:6,exam:48},'English Language':{ca1:7,ca2:7,ca3:6,exam:50},'Basic Science':{ca1:6,ca2:7,ca3:7,exam:50}},
    d6:{'Mathematics':{ca1:8,ca2:8,ca3:9,exam:62},'English Language':{ca1:9,ca2:8,ca3:9,exam:65},'Basic Science':{ca1:8,ca2:8,ca3:7,exam:58}},
    d7:{'Mathematics':{ca1:9,ca2:9,ca3:9,exam:75},'English Language':{ca1:9,ca2:9,ca3:8,exam:70},'Basic Science':{ca1:9,ca2:9,ca3:8,exam:68}},
    d8:{'Mathematics':{ca1:4,ca2:5,ca3:5,exam:35},'English Language':{ca1:5,ca2:4,ca3:5,exam:38},'Basic Science':{ca1:5,ca2:5,ca3:4,exam:40}},
    d9:{'Mathematics':{ca1:7,ca2:8,ca3:7,exam:55},'English Language':{ca1:8,ca2:7,ca3:7,exam:58},'Basic Science':{ca1:7,ca2:8,ca3:7,exam:56}},
    d10:{'Mathematics':{ca1:6,ca2:7,ca3:6,exam:48},'English Language':{ca1:6,ca2:7,ca3:6,exam:50},'Basic Science':{ca1:6,ca2:6,ca3:7,exam:48}},
  };
  // Term 3 (slightly higher — end of session)
  demoScores['Term 3'] = {
    d1:{'Mathematics':{ca1:9,ca2:8,ca3:9,exam:66},'English Language':{ca1:9,ca2:9,ca3:8,exam:68},'Basic Science':{ca1:8,ca2:9,ca3:8,exam:62}},
    d2:{'Mathematics':{ca1:10,ca2:9,ca3:9,exam:78},'English Language':{ca1:8,ca2:9,ca3:8,exam:65},'Basic Science':{ca1:9,ca2:9,ca3:10,exam:72}},
    d3:{'Mathematics':{ca1:6,ca2:7,ca3:6,exam:48},'English Language':{ca1:7,ca2:6,ca3:7,exam:50},'Basic Science':{ca1:7,ca2:7,ca3:6,exam:52}},
    d4:{'Mathematics':{ca1:10,ca2:10,ca3:9,exam:80},'English Language':{ca1:9,ca2:10,ca3:9,exam:72},'Basic Science':{ca1:10,ca2:9,ca3:10,exam:75}},
    d5:{'Mathematics':{ca1:8,ca2:8,ca3:7,exam:58},'English Language':{ca1:8,ca2:8,ca3:7,exam:60},'Basic Science':{ca1:7,ca2:8,ca3:8,exam:58}},
    d6:{'Mathematics':{ca1:9,ca2:8,ca3:9,exam:70},'English Language':{ca1:10,ca2:9,ca3:10,exam:75},'Basic Science':{ca1:8,ca2:9,ca3:8,exam:67}},
    d7:{'Mathematics':{ca1:10,ca2:10,ca3:10,exam:82},'English Language':{ca1:10,ca2:10,ca3:9,exam:80},'Basic Science':{ca1:10,ca2:10,ca3:9,exam:78}},
    d8:{'Mathematics':{ca1:5,ca2:6,ca3:6,exam:42},'English Language':{ca1:6,ca2:5,ca3:6,exam:44},'Basic Science':{ca1:6,ca2:6,ca3:5,exam:46}},
    d9:{'Mathematics':{ca1:8,ca2:8,ca3:9,exam:62},'English Language':{ca1:9,ca2:8,ca3:8,exam:65},'Basic Science':{ca1:8,ca2:9,ca3:8,exam:60}},
    d10:{'Mathematics':{ca1:7,ca2:8,ca3:7,exam:55},'English Language':{ca1:7,ca2:8,ca3:7,exam:58},'Basic Science':{ca1:7,ca2:7,ca3:8,exam:56}},
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
    subjects:['English Language','Mathematics','Basic Science','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','Home Economics','Christian Religious Studies','Handwriting','Quantitative Reasoning']
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
  window._demoMode = true; // Block all persistence in demo mode
  startApp();
  console.log('🎬 Demo mode loaded — no data will be saved');
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
      await hydrateFromV2(sid).catch(() => {});
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
    await hydrateFromV2(sid).catch(() => {});
    const fsSession = localStorage.getItem(`p_${sid}_staffSession`);
    if (fsSession) {
      try { const sess = JSON.parse(fsSession); currentStaff = sess; userRole = _normRole(sess.role || 'Principal'); startApp(); btn.textContent = '▶ Enter Portal'; btn.disabled = false; return; } catch (e) {}
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
  // Visible build version — confirms which code is running without needing DevTools
  const vEl = document.getElementById('build-version');
  if (vEl) vEl.textContent = 'v20260806-b';

  const bannerSub = $('banner-sub');
  if (bannerSub) {
    const cnt = (SD.students || []).length;
    bannerSub.textContent = cnt > 0 ? `${cnt} student${cnt !== 1 ? 's' : ''} enrolled` : 'No students yet — add your first student';
  }

  SQ.ping();
  // Pull Groq/HF OCR keys from admin_settings — survives browsing-data clears
  _fetchGroqKeyFromFirestore();
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
// Tap logo or school name anywhere → back to dashboard (revenue)
function goDashboard() {
  const nav = document.getElementById('mainNav');
  const backdrop = document.getElementById('navBackdrop');
  if (nav) nav.classList.remove('open');
  if (backdrop) backdrop.classList.remove('on');
  go(ROLE_DEFAULT_TAB[userRole] || 'revenue');
}

function go(tab) {
  // Role gate — silently redirect to default tab if section is not allowed
  if (userRole && !_canGo(tab)) {
    const def = ROLE_DEFAULT_TAB[userRole] || 'students';
    if (tab !== def) { toast(`⛔ Your role (${userRole}) cannot access this section.`); go(def); }
    return;
  }
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

// ── Dashboard stat tiles → drill-down navigation ─────────────────────────
function dashTileClick(which) {
  if (which === 'students') {
    if ($('stu-pay')) $('stu-pay').value = '';
    go('students');
  } else if (which === 'collected') {
    if ($('stu-pay')) $('stu-pay').value = 'paid';
    go('students');
    if (typeof renderStudentList === 'function') renderStudentList();
  } else if (which === 'outstanding') {
    if ($('stu-pay')) $('stu-pay').value = 'owing';
    go('students');
    if (typeof renderStudentList === 'function') renderStudentList();
  } else if (which === 'rate') {
    go('analytics');
  }
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
    if (!lines.length) { if ($('bulk-feedback')) $('bulk-feedback').textContent = '❌ Empty file.'; return; }

    // Detect bank statement format — col headers like Date, Narration, Reference, Balance
    const headerRow = lines[0].toLowerCase();
    const bankHeaders = ['narration', 'reference', 'transaction', 'debit', 'credit', 'value date'];
    if (bankHeaders.some(h => headerRow.includes(h))) {
      if ($('bulk-feedback')) $('bulk-feedback').innerHTML =
        `❌ This looks like a bank statement export, not a payments CSV.<br>
         The importer needs a simple 2-column file:<br>
         <strong>StudentName, Amount</strong><br>
         e.g. <em>ELIZABETH ADESOHIA, 25000</em><br>
         Export your bank app's CSV, then manually copy student name + amount into a new spreadsheet and save as CSV.`;
      return;
    }

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
// ── OCR character-level correction rules ─────────────────────────────────
const OCR_FIX_MAP = {
  // Digit → letter confusion (very common in OCR of handwriting)
  '0': 'O', '1': 'I', '5': 'S', '8': 'B',
  // Common garble pairs in handwritten Nigerian registers
  'rn': 'm', 'vv': 'w', 'vv': 'W', '|': 'I', 'l': 'I',
  // Letter swaps from smudged handwriting
  'ph': 'PH', 'ck': 'CK', 'ee': 'EE',
};

// Nigerian name fragments that help validate corrections
const NIGERIAN_NAME_FRAGMENTS = [
  'ADE', 'OLA', 'OYE', 'OGUN', 'AKIN', 'AYO', 'OLU', 'SAN', 'KASALI', 'OGUNLADE',
  'ALAWODE', 'OYESANWO', 'OGUNDEYI', 'ALAO', 'AKINWANDE', 'OLAWALE', 'OBASA',
  'OLATUNDE', 'ADENIYI', 'ADEOYE', 'LAWAL', 'AYOMIDE', 'RASAQ', 'GABRIEL',
  'GODWIN', 'ENOCH', 'EMMANUEL', 'KOREDE', 'SUCCESS', 'EZEKIEL', 'ZAINAB',
  'SALAM', 'WAJUD', 'MUEEZ', 'QUARDRI', 'BIGGOLD', 'ADEMIDE', 'ABIGEAL',
  'MICHEAL', 'MICHAEL', 'CHRISTIANA', 'CHRISTIAN', 'MOHAMMED', 'MUHAMMED',
  'IBRAHIM', 'ABDUL', 'ABDULLAH', 'YUSUF', 'YUSUFF', 'NUHU', 'MUSA', 'ISA',
  'HASSAN', 'HUSSEIN', 'ALIYU', 'ALIU', 'USMAN', 'SULE', 'SULEIMAN', 'YAKUBU',
  'GIDEON', 'DANIEL', 'SAMUEL', 'DAVID', 'JOHN', 'PAUL', 'PETER', 'JAMES',
  'MARY', 'GRACE', 'FAITH', 'HOPE', 'CHARITY', 'JOY', 'PEACE', 'MERCY',
  'PATIENCE', 'BLESSED', 'GIFT', 'PRECIOUS', 'VICTORY', 'GLORY', 'DIVINE',
  'CHIDINMA', 'CHIAMAKA', 'NWAFOR', 'OKEKE', 'EZE', 'NWOSU', 'IGWE',
  'OBI', 'OKORO', 'NNAMDI', 'CHUKWU', 'ANIEFIOK', 'EFFIONG', 'AKPAN',
  'EDIDIONG', 'UDO', 'IME', 'NSIKAN', 'SAMUEL', 'TIEMI', 'INIABASI',
  'GBOLAHAN', 'GBADEBO', 'GBELEKALE', 'SHONPE', 'OLIYIDE', 'KOLANOLE'
];

function _fixOcrChars(name) {
  let fixed = name.toUpperCase().trim();

  // Fix leading/trailing digits attached to names (e.g. "1OGUNLADE" → "OGUNLADE")
  fixed = fixed.replace(/^\d+([A-Z])/, '$1');

  // Fix trailing digits (e.g. "GABRIEL5" → "GABRIEL")
  fixed = fixed.replace(/([A-Z])\d+$/, '$1');

  // Fix embedded digits in names (e.g. "ADE0YE" → "ADEOYE", "GABR1EL" → "GABRIEL")
  fixed = fixed.replace(/([A-Z])0([A-Z])/g, '$1O$2');
  fixed = fixed.replace(/([A-Z])1([A-Z])/g, '$1I$2');
  fixed = fixed.replace(/([A-Z])5([A-Z])/g, '$1S$2');
  fixed = fixed.replace(/([A-Z])8([A-Z])/g, '$1B$2');

  // Fix "rn" → "m" when not at start of a word (e.g. "GABRNEL" → "GABMEL"... actually better: "ARNU" → "AMU")
  // Only fix if the result looks more like a Nigerian name
  const rnFixed = fixed.replace(/RN/g, 'M');
  if (_nameScore(rnFixed) > _nameScore(fixed)) fixed = rnFixed;

  // Fix standalone "l" → "I" in all-caps context (e.g. "ALAO" where l is actually I → "AIAO"? no, skip if it makes it worse)
  // Be conservative — only apply if score improves

  // Remove stray non-alpha characters (except spaces and hyphens)
  fixed = fixed.replace(/[^A-Z\s\-\']/g, '');

  // Collapse multiple spaces
  fixed = fixed.replace(/\s+/g, ' ').trim();

  return fixed;
}

// Score how "Nigerian-name-like" a string is (higher = more likely correct)
function _nameScore(name) {
  let score = 0;
  const upper = name.toUpperCase();
  for (const frag of NIGERIAN_NAME_FRAGMENTS) {
    if (upper.includes(frag)) score += frag.length;
  }
  // Penalize names with too many consonants in a row (likely garbled)
  const consonantRuns = (upper.match(/[^AEIOU\s]{7,}/g) || []);
  score -= consonantRuns.length * 3;
  return score;
}

async function fixGarbledNames() {
  const before = SD.students.length;
  let fixedCount = 0;

  // Phase 1: OCR character correction
  SD.students.forEach(s => {
    const original = (s.name || '').trim();
    const corrected = _fixOcrChars(original);
    if (corrected !== original && corrected.length >= 3) {
      // Only apply if the correction improves the name score
      if (_nameScore(corrected) >= _nameScore(original)) {
        s.name = corrected;
        fixedCount++;
      }
    }
  });

  // Phase 2: Remove junk (invalid names)
  SD.students = SD.students.filter(s => looksLikeValidName((s.name || '').trim()));

  // Phase 3: Remove duplicates
  const seen = new Set();
  SD.students = SD.students.filter(s => {
    const key = (s.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const removed = before - SD.students.length;
  const msg = (fixedCount > 0 ? `🔧 Fixed ${fixedCount} garbled name${fixedCount !== 1 ? 's' : ''} (digit→letter, OCR smudge corrections).\n` : '')
            + (removed > 0 ? `🗑️ Removed ${removed} junk entr${removed !== 1 ? 'ies' : 'y'} (invalid + duplicates).` : '');

  if (!msg) { alert('Nothing to fix — all names look clean and valid! ✅'); return; }

  await SQ.push('students', SD.students); checkTierStatus();
  renderStudentList(); renderBanner(); renderRevenue();
  alert(msg + '\n\nIf any real student was removed or a name was over-corrected, fix it manually with ✏️ edit.');
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

  // Role context banner — shows who is logged in and what they can see
  const bannerEl = $('stu-role-banner');
  if (bannerEl) {
    if (userRole && userRole !== 'Principal') {
      const name = currentStaff?.name || userRole;
      const classInfo = assignedCls ? ` · ${assignedCls} only` : '';
      bannerEl.style.display = 'flex';
      bannerEl.innerHTML = `<span style="font-size:0.78rem;color:var(--sub);">👤 ${name} <strong>${userRole}</strong>${classInfo}</span>`;
    } else {
      bannerEl.style.display = 'none';
    }
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
        <div class="stu-av" style="${s.photo?'background:none;padding:0;overflow:hidden;':''}">${s.photo?`<img src="${esc(s.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:s.name.charAt(0).toUpperCase()}</div>
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

function openAddStudentModal() {
  const sel = $('ns-class');
  if (sel) populateClassSelect(sel, '');
  openM('add-student-modal');
}

async function addStudent() {
  const name = $('ns-name').value.trim(), phone = $('ns-phone').value.trim().replace(/\D/g, '');
  const cls = $('ns-class').value.trim(), fee = parseFloat($('ns-fee').value) || SD.config.fee || 50000;
  const dob = $('ns-dob')?.value || '';
  if (!name || !phone) return alert('Name and phone required.');
  const newStudent = { name, phone, class: cls, totalFee: fee, paid: 0, scores: {}, swot: {}, dob };
  SD.students.push(newStudent);
  if (schoolId && !SD.config?._demo) {
    try {
      const v2Id = await saveStudentProfileV2(schoolId, newStudent);
      newStudent._v2Id = v2Id;
      await saveStudentFeesV2(schoolId, v2Id, { totalFee: fee, paid: 0, paymentHistory: [] });
    } catch (e) { console.warn('addStudent write failed:', e.message); }
  }
  await SQ.push('students', SD.students); checkTierStatus();
  closeM('add-student-modal');
  $('ns-name').value=''; $('ns-phone').value=''; $('ns-class').value=''; $('ns-fee').value='';
  if ($('ns-dob')) $('ns-dob').value = '';
  renderStudentList(); renderBanner(); renderRevenue();
}

async function deleteStudent(idx) {
  if (!confirm(`Delete ${SD.students[idx]?.name}?`)) return;
  const v2Id = SD.students[idx]?._v2Id;
  const sid  = SD.students[idx]?.id ?? idx;
  SD.students.splice(idx, 1);

  // Clean up flat scores for this student across all terms
  if (SD.scores) {
    Object.keys(SD.scores).forEach(term => {
      if (SD.scores[term]) delete SD.scores[term][sid];
    });
    saveLocal('scores', SD.scores);
    SQ.push('scores', SD.scores);
  }

  // Delete subcollection documents (profile + private/fees + all score docs)
  if (schoolId && v2Id && !SD.config?._demo) {
    try { await deleteStudentV2(schoolId, v2Id); } catch (e) { console.warn('deleteStudent subcollection delete failed:', e.message); }
  }

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

      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
        <div id="edit-photo-preview" style="width:56px;height:56px;border-radius:12px;overflow:hidden;flex-shrink:0;background:var(--s2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;">
          ${s.photo ? `<img src="${esc(s.photo)}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:1.4rem;color:var(--sub);">${esc(s.name.charAt(0).toUpperCase())}</span>`}
        </div>
        <div>
          <button class="btn-brand btn-sm" style="font-size:0.72rem;" onclick="$('edit-photo-input').click()">📷 Take/Upload Photo</button>
          ${s.photo ? `<button class="btn-ghost btn-sm" style="font-size:0.72rem;margin-left:0.3rem;color:var(--danger);" onclick="removeStudentPhoto(${idx})">🗑️ Remove</button>` : ''}
        </div>
        <input type="file" id="edit-photo-input" accept="image/*" style="display:none;" onchange="handleEditPhoto(${idx},event)">
      </div>

      <input type="file" accept="image/*" id="edit-scan-input" style="display:none;" onchange="scanStudentFormEdit(${idx},event)">
      <button class="btn-brand" style="width:100%;margin-bottom:0.3rem;background:linear-gradient(135deg,#7c3aed,#2563eb);font-size:0.82rem;" onclick="$('edit-scan-input').click()">📷 Scan to Fill Missing Fields</button>
      <div id="edit-scan-fb" style="display:none;font-size:0.78rem;color:var(--sub);margin-bottom:0.4rem;text-align:center;"></div>

      <label>Full Name</label>
      <input id="edit-s-name" value="${esc(s.name)}">

      <label>Parent / Guardian Phone (WhatsApp)</label>
      <input id="edit-s-phone" value="${esc(s.phone||'')}" placeholder="+2348012345678">

      <label>Class</label>
      <select id="edit-s-class" onchange="handleClassSelectChange(this)"></select>

      <label>Gender</label>
      <select id="edit-s-gender" style="width:100%;background:var(--input,#f1f5f9);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:0.45rem 0.6rem;">
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
        <textarea id="edit-s-collectors" rows="2" placeholder="Names of people allowed to pick up this child, e.g. Mum Fatima, Uncle Tunde, Driver Emeka" style="width:100%;background:var(--input,#f1f5f9);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:0.45rem 0.5rem;font-size:0.78rem;resize:none;margin-top:0.2rem;">${esc(safety.collectors||'')}</textarea>
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
  setTimeout(() => { const sel = $('edit-s-class'); if (sel) populateClassSelect(sel, s.class || ''); }, 20);
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

async function handleEditPhoto(idx, event) {
  const file = (event.target.files||[])[0]; if (!file) return;
  event.target.value = '';
  try {
    const dataUrl = await _compressImage(file, 400, 0.7);
    SD.students[idx].photo = dataUrl;
    await SQ.push('students', SD.students); saveLocal('students', SD.students);
    const prev = $('edit-photo-preview');
    if (prev) prev.innerHTML = `<img src="${esc(dataUrl)}" style="width:100%;height:100%;object-fit:cover;">`;
    renderStudentList();
    toast('✅ Photo saved!');
  } catch(e) { alert('Could not process photo. Try another image.'); }
}

async function removeStudentPhoto(idx) {
  if (!confirm('Remove student photo?')) return;
  delete SD.students[idx].photo;
  await SQ.push('students', SD.students); saveLocal('students', SD.students);
  const prev = $('edit-photo-preview');
  if (prev) prev.innerHTML = `<span style="font-size:1.4rem;color:var(--sub);">${esc(SD.students[idx].name.charAt(0).toUpperCase())}</span>`;
  renderStudentList();
  toast('🗑️ Photo removed.');
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
    processImagesSequentially(ocrFiles);
  }
}


let _ocrPending = [];

// ── Sequential multi-image processor — identical page-looping/dedup logic
// to the Bloom Agent OCR pipeline. Ends by opening the shared review modal
// directly (no agent-specific commission/tier card here).
async function processImagesSequentially(files) {
  const fbEl = $('csv-fb');
  const allNames = [];
  const _seen = new Set();
  const GROQ_DELAY_S = 15;
  if (files.length > 0) ocrOverlayShow(files[0].name || 'image');
  _groqRateLimitedThisSession = false; // fresh scan — give Groq another chance
  _lastDetectedClass = ''; // fresh scan — clear any class detected during a previous scan
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && files.length > 1) {
      for (let s = GROQ_DELAY_S; s > 0; s--) {
        if (fbEl) fbEl.textContent = '⏳ Cooling down (' + s + 's) before page ' + (i + 1) + ' of ' + files.length + '...';
        const fn = document.getElementById('ocr-filename'); if (fn) fn.textContent = files[i].name || 'Image ' + (i + 1);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (fbEl) fbEl.textContent = '📸 Reading page ' + (i + 1) + ' of ' + files.length + '...';
    const pageNames = await _readOnePage(files[i], i + 1, files.length, fbEl, _groqRateLimitedThisSession);
    pageNames.forEach(n => {
      const full = (n.fullName || (n.surname + ' ' + n.firstname)).trim().toUpperCase();
      const key  = full.replace(/[^A-Z]/g, '');
      if (full.length >= 2 && !_seen.has(key)) { _seen.add(key); allNames.push(full); }
    });
  }
  ocrOverlayHide(800);
  if (!allNames.length) {
    if (fbEl) fbEl.textContent = '❌ Could not read any names. Try clearer photo.';
    const _ed = _lastOcrError ? ('\n\nError: ' + _lastOcrError.slice(0,150)) : '';
    alert('No student names found in any image.' + _ed + '\n\nTips:\n• Hold phone directly above the register\n• Flatten the page fully\n• Use good lighting (avoid shadows)\n• Make sure all columns are visible');
    return;
  }
  // Remove names that already exist in the roster
  const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
  const fresh = allNames.filter(n => {
    const k = n.toLowerCase().replace(/[^a-z]/g, '');
    return k.length > 1 && !existingKeys.has(k);
  });
  if (fbEl) fbEl.textContent = '✅ Found ' + fresh.length + ' name' + (fresh.length !== 1 ? 's' : '') + ' — review below.';
  setTimeout(() => { openOcrReviewModal(fresh, _lastDetectedClass); }, 250);
}

// ── OCR Review Modal — exact copy of the Bloom Agent review UI, including
// the invisible-text fix (explicit colors) and the delete-button width fix
// (global `button{width:100%}` was stretching the ✕ button over the name field).
let _ocrReviewData = [];

// ── Known classes for the dropdowns — merges classes already used in the
// roster with a standard Nigerian curriculum list, so the dropdown is useful
// even for a brand-new school with zero students so far.
function getKnownClasses() {
  const existing = [...new Set((SD.students || []).map(s => (s.class || '').trim().toUpperCase()).filter(Boolean))];
  const defaults = ['DAYCARE','PLAYGROUP','PRE-NURSERY','NURSERY 1','NURSERY 2','KG 1','KG 2','BASIC 1','BASIC 2','BASIC 3','BASIC 4','BASIC 5','BASIC 6','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
  return [...new Set([...existing, ...defaults])].sort();
}

// Fills a <select> with known classes + a "New class…" option, preserving `current`.
function populateClassSelect(sel, current) {
  const cur = (current || sel.value || '').trim().toUpperCase();
  let classes = getKnownClasses();
  if (cur && !classes.includes(cur)) classes = [...classes, cur].sort();
  let html = '<option value="">— Select —</option>';
  html += classes.map(c => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  html += '<option value="__new__">➕ New class…</option>';
  sel.innerHTML = html;
}

// Handles the "➕ New class…" option on any class <select> — prompts once, adds
// the custom value as a real option, and selects it. Resets to blank if cancelled.
function handleClassSelectChange(sel) {
  if (sel.value !== '__new__') return;
  const v = (prompt('Enter class name (e.g. JSS 2A):') || '').trim().toUpperCase();
  if (v) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v; opt.selected = true;
    sel.insertBefore(opt, sel.lastElementChild);
  } else {
    sel.value = '';
  }
}

// Bulk "apply to all selected" dropdown at the top of the review modal —
// picking a class auto-applies it immediately (Set → button still works too).
function bulkClassChanged(sel) {
  handleClassSelectChange(sel);
  if (sel.value && sel.value !== '__new__') ocrSetClassAll();
}

function openOcrReviewModal(parsedNames, detectedClass) {
  const dc = (detectedClass || '').trim().toUpperCase();
  _ocrReviewData = (parsedNames || []).map(p => {
    const nm = typeof p === 'string' ? p : (p.name || p.fullName || '');
    return { name: nm.trim().toUpperCase(), cls: dc, sel: true };
  }).filter(r => r.name.length > 1);
  _renderOcrReviewList();
  openM('ocr-review-modal');
  setTimeout(() => {
    const bulkSel = document.getElementById('ocr-class-all');
    if (bulkSel) populateClassSelect(bulkSel, dc);
    const info = document.getElementById('ocr-review-info');
    if (info && dc) info.textContent = '🤖 Detected class from the page header: ' + dc + ' — auto-filled below, edit if wrong, then tap Add.';
  }, 30);
}

function _renderOcrReviewList() {
  const c = document.getElementById('ocr-review-list');
  if (!c) { console.error('[OCR Review] #ocr-review-list not found in DOM'); return; }
  while (c.firstChild) c.removeChild(c.firstChild);
  for (let i = 0; i < _ocrReviewData.length; i++) {
    const r = _ocrReviewData[i];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;padding:4px 2px;border-bottom:1px solid var(--border);';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!r.sel;
    cb.style.cssText = 'width:18px;height:18px;flex-shrink:0;cursor:pointer;';
    (function(idx){ cb.onchange = function(){ _ocrReviewData[idx].sel = this.checked; _ocrUpdateCount(); }; })(i);
    const ni = document.createElement('input');
    ni.type = 'text'; ni.value = r.name || ''; ni.autocomplete = 'off'; ni.setAttribute('autocapitalize','off');
    ni.style.cssText = 'flex:1;margin:0;padding:3px 6px;font-size:0.78rem;min-width:0;text-transform:uppercase;border:1px solid #2d4562;border-radius:6px;background:#0f1d2e !important;color:#f0f6ff !important;-webkit-text-fill-color:#f0f6ff;caret-color:#f0f6ff;';
    (function(idx){ ni.onchange = function(){ _ocrReviewData[idx].name = this.value.trim().toUpperCase(); }; })(i);
    const ci = document.createElement('select');
    ci.style.cssText = 'width:82px;flex-shrink:0;margin:0;padding:3px 2px;font-size:0.7rem;border:1px solid #2d4562;border-radius:6px;background:#0f1d2e !important;color:#f0f6ff !important;';
    populateClassSelect(ci, r.cls);
    (function(idx){ ci.onchange = function(){ handleClassSelectChange(this); _ocrReviewData[idx].cls = this.value === '__new__' ? '' : this.value; }; })(i);
    const db = document.createElement('button');
    db.textContent = '\u2715';
    db.style.cssText = 'width:auto;display:inline-block;flex:0 0 auto;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:2px 7px;cursor:pointer;font-size:0.72rem;color:#dc2626;flex-shrink:0;';
    (function(idx){ db.onclick = function(){ _ocrDelRow(idx); }; })(i);
    row.appendChild(cb); row.appendChild(ni); row.appendChild(ci); row.appendChild(db);
    c.appendChild(row);
  }
  _ocrUpdateCount();
}

function _ocrUpdateCount() {
  const n = _ocrReviewData.filter(r => r.sel).length;
  const tot = _ocrReviewData.length;
  const btn  = document.getElementById('ocr-confirm-btn');
  const info = document.getElementById('ocr-review-info');
  if (btn)  btn.textContent  = '\u2705 Add ' + n + ' Student' + (n !== 1 ? 's' : '') + ' \u2192';
  if (info) info.textContent = n + ' of ' + tot + ' selected \u2014 edit names, set class, then tap Add.';
}

function _ocrDelRow(i) {
  _ocrReviewData.splice(i, 1);
  _renderOcrReviewList();
}

function ocrSelectAll(checked) {
  _ocrReviewData.forEach(r => r.sel = checked);
  _renderOcrReviewList();
}

function ocrSetClassAll() {
  const cls = (document.getElementById('ocr-class-all')?.value || '').trim();
  if (!cls || cls === '__new__') return;
  _ocrReviewData.forEach(r => { if (r.sel) r.cls = cls; });
  _renderOcrReviewList();
}

// ── Confirm import — School-specific data handoff (SD.students / SQ.push).
// The extraction + review UI above is identical to Bloom Agent; only this
// final step differs, since School Bloom writes straight into the roster.
async function ocrConfirmImport() {
  const sel = _ocrReviewData.filter(r => r.sel && r.name && r.name.length > 1);
  if (!sel.length) { alert('Select at least one name.'); return; }
  const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
  const fee = SD.config?.fee || 50000;
  let added = 0;
  sel.forEach(r => {
    const key = r.name.toLowerCase().replace(/[^a-z]/g, '');
    if (existingKeys.has(key)) return;
    SD.students.push({ name: r.name, phone: '', class: r.cls || '', totalFee: fee, paid: 0, scores: {}, swot: {} });
    existingKeys.add(key); added++;
  });
  if (!added) { alert('No new names to add (all already exist).'); return; }
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
  activeIdx = idx; activeTab = 'profile';
  const s = SD.students[idx]; if (!s) return;
  $('prof-name').textContent = s.name;
  $('prof-meta').textContent = `${s.class||'—'} · ${s.phone||'—'}`;
  const bdayEl = $('prof-bday');
  if (bdayEl) {
    if (s.dob) { bdayEl.style.display = 'block'; bdayEl.textContent = `🎂 DOB: ${s.dob}`; }
    else bdayEl.style.display = 'none';
  }
  // Render photo or initial in header
  const photoWrap = $('prof-photo-wrap');
  if (photoWrap) {
    if (s.photo) {
      photoWrap.innerHTML = `<img src="${esc(s.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      photoWrap.innerHTML = `<span style="font-size:1.2rem;font-weight:800;">${esc(s.name.charAt(0).toUpperCase())}</span>`;
    }
  }
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.pt === 'profile'));
  renderTab('profile'); openM('student-modal');
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.pt === tab));
  renderTab(tab);
}

function renderTab(tab) {
  const s = SD.students[activeIdx]; if (!s) return;
  const c = $('profile-content'); if (!c) return;
  if (tab === 'profile') c.innerHTML = buildProfile(s, activeIdx);
  else if (tab === 'fees') c.innerHTML = buildFees(s, activeIdx);
  else if (tab === 'attendance') c.innerHTML = buildAttendance(s);
  else if (tab === 'scores') c.innerHTML = buildScores(s, activeIdx);
  else if (tab === 'report') c.innerHTML = buildReport(s);
  else if (tab === 'swot') c.innerHTML = buildSWOT(s, activeIdx);
  else if (tab === 'safety') c.innerHTML = buildSafety(s, activeIdx);
  else if (tab === 'promotion') c.innerHTML = buildPromotion(s, activeIdx);
}

// ── PROFILE TAB ───────────────────────────────────────────────────────
function buildProfile(s, idx) {
  const safety = s.safety || {};
  const ageStr = s.dob ? _calcAge(s.dob) : '—';
  const feeOwe = (s.totalFee||0) - (s.paid||0);
  const feePct = s.totalFee ? Math.round(((s.paid||0)/s.totalFee)*100) : 0;
  // attendance summary
  const att = SD.attendance || {};
  let present=0, absent=0, late=0, totalDays=0;
  Object.keys(att).forEach(d => { if (att[d][s.name]) { totalDays++; const st=att[d][s.name]; if(st==='Present')present++; else if(st==='Absent')absent++; else if(st==='Late')late++; } });
  const attPct = totalDays>0 ? Math.round((present/totalDays)*100) : 0;
  // scores summary
  const term = SD.config.currentTerm || 'Term 1';
  const sid = s.id || idx;
  const termScores = (SD.scores?.[term]?.[sid]) || {};
  const scoredSubs = Object.keys(termScores).filter(sub => { const v=termScores[sub]; return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0; });
  let totalScore=0; scoredSubs.forEach(sub => { const v=termScores[sub]; totalScore += (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0); });
  const avg = scoredSubs.length>0 ? Math.round(totalScore/scoredSubs.length) : 0;

  return `
    <div class="card" style="margin-bottom:0.65rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
        <div style="width:72px;height:72px;border-radius:14px;overflow:hidden;flex-shrink:0;background:var(--s2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;">
          ${s.photo 
            ? `<img src="${esc(s.photo)}" style="width:100%;height:100%;object-fit:cover;">` 
            : `<div style="font-size:1.8rem;font-weight:800;color:var(--sub);">${esc(s.name.charAt(0).toUpperCase())}</div>`}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:1.05rem;color:var(--text);">${esc(s.name)}</div>
          <div style="font-size:0.78rem;color:var(--sub);margin-top:2px;">${esc(s.class||'No class set')}</div>
          <div style="display:flex;gap:0.4rem;margin-top:0.4rem;flex-wrap:wrap;">
            <button class="btn-brand btn-sm" style="font-size:0.72rem;padding:0.3rem 0.55rem;" onclick="uploadStudentPhoto(${idx})">📷 Photo</button>
            <button class="btn-ghost btn-sm" style="font-size:0.72rem;padding:0.3rem 0.55rem;" onclick="editStudent(${idx})">✏️ Edit</button>
          </div>
        </div>
      </div>

      <input type="file" id="student-photo-input" accept="image/*" style="display:none;" onchange="handleStudentPhoto(${idx},event)">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
        <div style="background:var(--s2);padding:0.55rem;border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:0.63rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.04em;">Gender</div>
          <div style="font-size:0.82rem;font-weight:600;margin-top:2px;">${esc(s.gender||'—')}</div>
        </div>
        <div style="background:var(--s2);padding:0.55rem;border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:0.63rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.04em;">Date of Birth</div>
          <div style="font-size:0.82rem;font-weight:600;margin-top:2px;">${esc(s.dob||'—')}${ageStr!=='—'?' <span style=\'color:var(--sub);font-size:0.72rem;\'>('+ageStr+')</span>':''}</div>
        </div>
        <div style="background:var(--s2);padding:0.55rem;border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:0.63rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.04em;">Admission No.</div>
          <div style="font-size:0.82rem;font-weight:600;margin-top:2px;">${esc(s.admissionNo||'—')}</div>
        </div>
        <div style="background:var(--s2);padding:0.55rem;border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:0.63rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.04em;">Parent Phone</div>
          <div style="font-size:0.82rem;font-weight:600;margin-top:2px;">${s.phone?'<a href="https://wa.me/'+s.phone+'" style="color:var(--brand);text-decoration:none;">'+esc(s.phone)+'</a>':'—'}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:0.65rem;">
      <div class="ct">📊 Quick Stats</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;">
        <div class="stat"><div class="sn" style="font-size:0.95rem;color:${attPct>=70?'var(--money)':'var(--warn)'};">${attPct}%</div><div class="sl">Attendance</div></div>
        <div class="stat"><div class="sn" style="font-size:0.95rem;color:${avg>=50?'var(--money)':'var(--danger)'};">${avg||'—'}</div><div class="sl">Avg Score</div></div>
        <div class="stat"><div class="sn" style="font-size:0.95rem;color:${feeOwe<=0?'var(--money)':'var(--danger)'};">${feeOwe<=0?'✅':'₦'+(feeOwe).toLocaleString()}</div><div class="sl">Fees</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:0.65rem;border-left:4px solid #8b5cf6;">
      <div class="ct">🛡️ Safety & Guardian</div>
      ${_profileRow('Guardian Name', safety.guardianName)}
      ${_profileRow('Emergency Phone', safety.emergencyPhone, true)}
      ${_profileRow('Authorised Collectors', safety.collectors)}
      ${_profileRow('Medical Notes', safety.medical)}
    </div>

    <div class="card">
      <div class="ct">📚 This Term (${esc(term)})</div>
      <div style="font-size:0.78rem;color:var(--sub);line-height:1.7;">
        <div>Subjects with scores: <b style="color:var(--text);">${scoredSubs.length}</b></div>
        <div>Total marks: <b style="color:var(--text);">${totalScore}</b></div>
        <div>Average: <b style="color:var(--text);">${avg||'—'}</b></div>
        ${scoredSubs.length>0?`<button class="btn-ghost btn-sm" style="margin-top:0.5rem;font-size:0.72rem;" onclick="setTab('scores')">📚 View Full Scores →</button>`:''}
      </div>
    </div>
  `;
}

function _profileRow(label, value, isPhone) {
  if (!value) return `<div style="display:flex;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border);"><div style="font-size:0.72rem;color:var(--sub);min-width:110px;flex-shrink:0;">${label}</div><div style="font-size:0.78rem;color:var(--sub);">—</div></div>`;
  return `<div style="display:flex;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border);">
    <div style="font-size:0.72rem;color:var(--sub);min-width:110px;flex-shrink:0;">${label}</div>
    <div style="font-size:0.78rem;font-weight:500;color:var(--text);">${isPhone?'<a href="https://wa.me/'+value.replace(/\D/g,'')+'" style="color:var(--brand);text-decoration:none;">'+esc(value)+'</a>':esc(value)}</div>
  </div>`;
}

function _calcAge(dob) {
  const d = new Date(dob); if (isNaN(d)) return '—';
  const now = new Date(); let age = now.getFullYear()-d.getFullYear();
  const m = now.getMonth()-d.getMonth(); if (m<0||(m===0&&now.getDate()<d.getDate())) age--;
  return age>=0?age+' yrs':'—';
}

// ── Student Photo Upload ──────────────────────────────────────────────
function uploadStudentPhoto(idx) {
  const inp = $('student-photo-input'); if (!inp) return;
  inp.click();
}

async function handleStudentPhoto(idx, event) {
  const file = (event.target.files||[])[0]; if (!file) return;
  event.target.value = '';
  // Compress image to max 400px, JPEG quality 0.7
  try {
    const dataUrl = await _compressImage(file, 400, 0.7);
    SD.students[idx].photo = dataUrl;
    await SQ.push('students', SD.students); saveLocal('students', SD.students);
    // Update header photo
    const photoWrap = $('prof-photo-wrap');
    if (photoWrap) photoWrap.innerHTML = `<img src="${esc(dataUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    renderTab('profile');
    renderStudentList();
    toast('✅ Photo saved!');
  } catch(e) {
    console.error('Photo upload error:', e);
    alert('Could not process photo. Please try a different image.');
  }
}

function _compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) { if (width > maxDim) { height = Math.round(height*maxDim/width); width = maxDim; } }
        else { if (height > maxDim) { width = Math.round(width*maxDim/height); height = maxDim; } }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
    
    <input type="file" accept="image/*" id="pay-scan-input" style="display:none" onchange="scanPaymentReceipt(event,${idx})">
    <button class="btn-brand" style="width:100%;margin-bottom:0.5rem;background:linear-gradient(135deg,#7c3aed,#2563eb);" onclick="document.getElementById('pay-scan-input').click()">📷 Scan Receipt</button>
    <div id="pay-scan-fb" style="display:none;font-size:0.78rem;color:var(--sub);margin-bottom:0.5rem;text-align:center;"></div>
    
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
  const v2Id = SD.students[idx]?._v2Id;
  if (schoolId && v2Id && !SD.config?._demo) {
    try {
      await saveStudentFeesV2(schoolId, v2Id, {
        totalFee: SD.students[idx].totalFee || 0,
        paid: SD.students[idx].paid,
        paymentHistory: SD.students[idx].paymentHistory
      });
    } catch (e) { console.warn('recordPayment write failed:', e.message); }
  }
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
    <button class="btn-brand" style="width:100%;margin-top:0.6rem;background:linear-gradient(135deg,#7c3aed,#2563eb);" onclick="printPromotionReportCard(activeIdx)">🎓 Open Annual Promotion Report</button>
    <p style="font-size:0.76rem;color:var(--sub);margin-top:0.5rem;">Summarizes all 3 terms into one final card with cumulative average, position, and the promotion decision.</p>
    </div>`;
}

// ── PROMOTION TAB ──────────────────────────────────────────────────────
// Decision belongs to the Class Teacher of this student's specific class —
// the Principal can always see it, but doesn't enter it themselves.
function _canDecidePromotion(s) {
  if (userRole === 'Principal') return true; // sees everything, can override if needed
  return userRole === 'Class Teacher' && getAssignedClass() === s.class;
}
function buildPromotion(s, idx) {
  const promo = s.promotion || {};
  const canDecide = _canDecidePromotion(s);
  const readOnlyNote = canDecide ? '' :
    `<div style="background:var(--s2);border-radius:8px;padding:0.6rem;font-size:0.76rem;color:var(--sub);margin-bottom:0.7rem;">
      🔒 Only ${esc(s.class)}'s Class Teacher can set this decision. You can view it here.
    </div>`;
  return `<div class="card">
    <div class="ct">🎓 End-of-Year Promotion Decision</div>
    ${readOnlyNote}
    <label style="font-size:0.8rem;font-weight:600;">Academic Year</label>
    <input type="text" id="promo-year" value="${esc(promo.year || SD.config.session || '')}" placeholder="e.g. 2025/2026" ${canDecide?'':'disabled'}>
    <label style="font-size:0.8rem;font-weight:600;margin-top:0.5rem;display:block;">Decision</label>
    <select id="promo-decision" ${canDecide?'':'disabled'}>
      <option value="" ${!promo.decision?'selected':''}>— Not yet decided —</option>
      <option value="Promoted" ${promo.decision==='Promoted'?'selected':''}>Promoted</option>
      <option value="Promoted on Trial" ${promo.decision==='Promoted on Trial'?'selected':''}>Promoted on Trial</option>
      <option value="Repeat" ${promo.decision==='Repeat'?'selected':''}>Repeat Class</option>
    </select>
    <label style="font-size:0.8rem;font-weight:600;margin-top:0.5rem;display:block;">Next Class (if promoted)</label>
    <input type="text" id="promo-nextclass" value="${esc(promo.nextClass || '')}" placeholder="e.g. JSS 2B" ${canDecide?'':'disabled'}>
    <label style="font-size:0.8rem;font-weight:600;margin-top:0.5rem;display:block;">Class Teacher's Comment</label>
    <textarea id="promo-comment" rows="3" placeholder="Brief note for the promotion report card" ${canDecide?'':'disabled'}>${esc(promo.comment || '')}</textarea>
    ${promo.decidedBy ? `<p style="font-size:0.72rem;color:var(--sub);margin-top:0.4rem;">Last set by ${esc(promo.decidedBy)} on ${promo.decidedAt ? new Date(promo.decidedAt).toLocaleDateString() : '—'}</p>` : ''}
    ${canDecide ? `<button class="btn-brand" style="width:100%;margin-top:0.6rem;" onclick="savePromotionDecision(${idx})">💾 Save Decision</button>` : ''}
  </div>`;
}
async function savePromotionDecision(idx) {
  const s = SD.students[idx]; if (!s) return;
  if (!_canDecidePromotion(s)) return alert("Only this class's Class Teacher (or the Principal) can set this.");
  const decision = $('promo-decision')?.value || '';
  if (!decision) return alert('Select a decision first.');
  s.promotion = {
    year: $('promo-year')?.value.trim() || SD.config.session || '',
    decision,
    nextClass: $('promo-nextclass')?.value.trim() || '',
    comment: $('promo-comment')?.value.trim() || '',
    decidedBy: currentStaff?.name || userRole,
    decidedAt: new Date().toISOString()
  };
  if (schoolId && s._v2Id && !SD.config?._demo) {
    try { await saveStudentProfileV2(schoolId, s); } catch (e) { console.warn('promotion write failed:', e.message); }
  }
  await SQ.push('students', SD.students);
  toast('✅ Promotion decision saved');
  renderTab('promotion');
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
      if (!_hasScoreEntry(termData, sub)) {
        return `<tr>
          <td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);"></td>
          <td><input type="number" min="0" max="70" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;"></td>
          <td></td>
        </tr>`;
      }
      const e = _capScoreEntry(termData[sub]);
      if (e.tot > 0 || _hasScoreEntry(termData, sub)) { totalSum += e.tot; subCount++; }
      const ovFlag = e.hasOverflow ? '⚠️ ' : '';
      return `<tr>
        <td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
        <td><input type="number" min="0" max="10" value="${e.ca1||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca1Raw>10?'border-color:var(--danger);':''}"></td>
        <td><input type="number" min="0" max="10" value="${e.ca2||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca2Raw>10?'border-color:var(--danger);':''}"></td>
        <td><input type="number" min="0" max="10" value="${e.ca3||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca3Raw>10?'border-color:var(--danger);':''}"></td>
        <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);">${e.caT||''}</td>
        <td><input type="number" min="0" max="70" value="${e.exam||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;${e.examRaw>70?'border-color:var(--danger);':''}"></td>
        <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;color:${e.tot>=70?'var(--money)':e.tot>=50?'var(--text)':'var(--danger)'};">${ovFlag}${e.tot||''}</td>
        <td>${gradeRow(e.tot)}</td>
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
        if (!_hasScoreEntry(termData, sub)) {
          return `<tr><td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td><input type="number" min="0" max="10" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);"></td>
          <td><input type="number" min="0" max="70" value="" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td>
          <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;"></td>
          <td></td></tr>`;
        }
        const e=_capScoreEntry(termData[sub]);
        if(e.tot>0||_hasScoreEntry(termData,sub)){totalSum+=e.tot;subCount++;}
        const ovFlag=e.hasOverflow?'⚠️ ':'';
        return `<tr><td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
          <td><input type="number" min="0" max="10" value="${e.ca1||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca1Raw>10?'border-color:var(--danger);':''}"></td>
          <td><input type="number" min="0" max="10" value="${e.ca2||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca2Raw>10?'border-color:var(--danger);':''}"></td>
          <td><input type="number" min="0" max="10" value="${e.ca3||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;${e.ca3Raw>10?'border-color:var(--danger);':''}"></td>
          <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);">${e.caT||''}</td>
          <td><input type="number" min="0" max="70" value="${e.exam||''}" placeholder="0" onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;${e.examRaw>70?'border-color:var(--danger);':''}"></td>
          <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;color:${e.tot>=70?'var(--money)':e.tot>=50?'var(--text)':'var(--danger)'};">${ovFlag}${e.tot||''}</td>
          <td>${gradeRow(e.tot)}</td></tr>`;
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

async function saveScores(idx) {
  saveLocal('scores', SD.scores);
  SQ.push('scores', SD.scores);
  const v2Id = SD.students[idx]?._v2Id;
  const sid = SD.students[idx]?.id || idx;
  if (schoolId && v2Id && !SD.config?._demo) {
    const writes = [];
    Object.keys(SD.scores).forEach(term => {
      const subjMap = SD.scores[term]?.[sid];
      if (!subjMap) return;
      Object.keys(subjMap).forEach(subject => {
        writes.push(saveScoreV2(schoolId, v2Id, term, subject, subjMap[subject]));
      });
    });
    try { await Promise.all(writes); } catch (e) { console.warn('saveScores write failed:', e.message); }
  }
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
    if (!_hasScoreEntry(td, sub)) { perSub[sub] = { caT:0, exam:0, tot:0, hasData:false }; return; }
    const e = _capScoreEntry(td[sub]);
    perSub[sub] = { caT: e.caT, exam: e.exam, tot: e.tot, hasData:true, hasOverflow:e.hasOverflow,
                   ca1:e.ca1, ca2:e.ca2, ca3:e.ca3, ca1Raw:e.ca1Raw, ca2Raw:e.ca2Raw, ca3Raw:e.ca3Raw, examRaw:e.examRaw };
    if (e.tot > 0 || _hasScoreEntry(td, sub)) { total += e.tot; count++; }
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
      if (!_hasScoreEntry(td, sub)) return; // skip genuine gaps — don't treat as zero
      const e = _capScoreEntry(td[sub]);
      if (e.tot > 0 || _hasScoreEntry(td, sub)) { tSum += e.tot; tCount++; }
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
    if (isCum) {
      const { cumSub, avg } = calcCumulative(sid, subs);
      const hasAny = subs.some(sub => cumSub[sub] > 0 || ['Term 1','Term 2','Term 3'].some(t => _hasScoreEntry((SD.scores[t]||{})[sid]||{}, sub)));
      return { s, sid, perSub: cumSub, avg, hasData: hasAny };
    }
    const { perSub, avg, count } = calcStudentTermStats(sid, activeView, subs);
    return { s, sid, perSub, avg, hasData: count > 0 };
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
  const rows = studentStats.sort((a,b)=>posMap[a.sid]-posMap[b.sid]).map(({s,sid,perSub,avg,hasData})=>{
    const pos = posMap[sid]; const {g,col} = getGrade(avg);
    const medal = pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':'';
    const subCells = subs.map(sub=>{
      let v, hasSub;
      if (isCum) {
        v = perSub[sub]||0;
        hasSub = ['Term 1','Term 2','Term 3'].some(t => _hasScoreEntry((SD.scores[t]||{})[sid]||{}, sub));
      } else {
        const ps = perSub[sub];
        v = ps?.hasData ? ps.tot : 0;
        hasSub = ps?.hasData;
      }
      const {col:sc} = getGrade(v||0);
      return `<td style="text-align:center;font-size:0.74rem;font-weight:700;color:${hasSub?(v>0?sc:'var(--danger)'):'var(--border)'};padding:3px 2px;">${hasSub?v:'–'}</td>`;
    }).join('');
    return `<tr><td style="text-align:center;font-weight:700;font-size:0.72rem;color:${col};">${medal}${pos}</td>
      <td style="font-size:0.74rem;font-weight:600;white-space:nowrap;min-width:110px;">${esc(s.name)}</td>
      ${subCells}
      <td style="text-align:center;font-weight:800;font-size:0.82rem;color:${col};">${avg||'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.74rem;color:${col};">${hasData?g:'–'}</span></td></tr>`;
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
// ── Report card visual theme — "classic" (default, unchanged look) or "bold" ──
function _reportCardThemeCSS() {
  const theme = SD.config?.reportCardTheme || 'classic';
  if (theme !== 'bold') return ''; // classic = no override, exactly the original look
  return `
    body{background:#fff;}
    .hdr{background:#1e2a5e;color:#fbbf24;border-bottom:none;border-radius:10px;padding:16px 10px;margin-bottom:14px;}
    .hdr h1{color:#fbbf24;font-weight:900;}
    .hdr h2{color:#fde68a;}
    .hdr .motto{color:#c7d2fe;}
    .sb{background:#1e2a5e;border-color:#1e2a5e;}
    .sv{color:#fbbf24;}
    th{background:#1e2a5e;color:#fbbf24;}
    .st{background:#fbbf24;color:#1e2a5e;}
    .sig-box{border-top-color:#1e2a5e;}
  `;
}

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
    if (!_hasScoreEntry(termData, sub)) {
      return `<tr><td>${esc(sub)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
    }
    const e = _capScoreEntry(termData[sub]);
    const {g} = getGrade(e.tot);
    const subRanked = classStudents.map(st=>{
      const stid = st.id || SD.students.indexOf(st);
      const sv = (SD.scores[term]||{})[stid]||{};
      if (!_hasScoreEntry(sv, sub)) return { name: st.name, tot: 0 };
      const se = _capScoreEntry(sv[sub]);
      return { name: st.name, tot: se.tot };
    }).sort((a,b)=>b.tot-a.tot);
    const sPos = (subRanked.findIndex(r=>r.name===s.name)+1)||'–';
    const ovFlag = e.hasOverflow ? '⚠️' : '';
    return `<tr><td>${esc(sub)}</td><td>${e.ca1||''}</td><td>${e.ca2||''}</td><td>${e.ca3||''}</td><td>${e.caT||''}</td><td>${e.exam||''}</td>
      <td style="font-weight:700;color:${e.tot>=70?'green':e.tot>=50?'#333':'red'};">${ovFlag}${e.tot||''}</td>
      <td style="font-weight:700;">${g}</td><td>${sPos}</td></tr>`;
  }).join('');

  const totals = subs.filter(sub=>_hasScoreEntry(termData,sub)).map(sub=>{const e=_capScoreEntry(termData[sub]);return e.tot;}).filter(v=>v>0);
  const allZeroCount = subs.filter(sub=>_hasScoreEntry(termData,sub)&&_capScoreEntry(termData[sub]).tot===0).length;
  const avg = (totals.length||allZeroCount)?Math.round(totals.reduce((a,b)=>a+b,0)/Math.max(totals.length,1)):0;
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
    ${_reportCardThemeCSS()}
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

// ── ANNUAL PROMOTION REPORT — summarizes all 3 terms into one final card ──
function printPromotionReportCard(idx) {
  const s = SD.students[idx]; if (!s) return;
  const sid = s.id || idx;
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const cfg = SD.config;
  const promo = s.promotion || {};
  const classStudents = SD.students.filter(st => st.class === s.class);

  const { cumSub, avg: myAvg } = calcCumulative(sid, subs);
  const ranked = classStudents.map(st => {
    const stid = st.id || SD.students.indexOf(st);
    const { avg } = calcCumulative(stid, subs);
    return { name: st.name, avg };
  }).sort((a,b) => b.avg - a.avg);
  const myPos = (ranked.findIndex(r => r.name === s.name) + 1) || '–';

  const termAvgs = ['Term 1','Term 2','Term 3'].map(term => {
    const { avg } = calcStudentTermStats(sid, term, subs);
    return { term, avg };
  });

  const rows = subs.map(sub => {
    const cumAvg = cumSub[sub] || 0;
    const perTerm = ['Term 1','Term 2','Term 3'].map(term => {
      const td = (SD.scores[term]||{})[sid] || {};
      if (!_hasScoreEntry(td, sub)) return '';
      return _capScoreEntry(td[sub]).tot || '';
    });
    const { g } = getGrade(cumAvg);
    return `<tr><td>${esc(sub)}</td><td>${perTerm[0]}</td><td>${perTerm[1]}</td><td>${perTerm[2]}</td>
      <td style="font-weight:800;color:${cumAvg>=70?'green':cumAvg>=50?'#333':'red'};">${cumAvg||'–'}</td>
      <td style="font-weight:700;">${cumAvg>0?g:'–'}</td></tr>`;
  }).join('');

  const daysPresent = Object.values(SD.attendance||{}).filter(day => day[s.name]==='Present').length;
  const daysAbsent  = Object.values(SD.attendance||{}).filter(day => day[s.name]==='Absent').length;
  const { g: overallGrade } = getGrade(myAvg);
  const decisionColor = promo.decision === 'Repeat' ? '#dc2626' : promo.decision === 'Promoted on Trial' ? '#f59e0b' : '#16a34a';

  const w = window.open('', '_blank', 'width=820,height=1150');
  if (!w) return alert('Please allow popups to print.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Annual Promotion Report — ${esc(s.name)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#111;font-size:11.5px;background:#fff;}
    .hdr{text-align:center;border-bottom:3px double #333;padding-bottom:10px;margin-bottom:12px;}
    .hdr h1{font-size:19px;margin:4px 0;letter-spacing:.5px;}
    .hdr h2{font-size:13px;margin:2px 0;color:#555;font-weight:700;}
    .ig{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:10px;font-size:11px;}
    .ig div{padding:2px 0;border-bottom:1px dotted #ddd;}
    .sm{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0;}
    .sb{border:2px solid #e5e7eb;border-radius:6px;padding:5px;text-align:center;}
    .sv{font-size:16px;font-weight:900;color:#1d4ed8;}
    table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px;}
    th,td{border:1px solid #bbb;padding:3px 5px;text-align:center;}
    td:first-child, th:first-child{text-align:left;}
    th{background:#f3f4f6;font-size:10.5px;font-weight:700;}
    .st{font-weight:800;font-size:11.5px;background:#1e3a5f;color:#fff;padding:4px 7px;margin:8px 0 3px;border-radius:3px;}
    .decision-box{border:3px solid ${decisionColor};border-radius:8px;padding:12px;text-align:center;margin:12px 0;background:${decisionColor}10;}
    .decision-box .label{font-size:11px;color:#555;font-weight:700;}
    .decision-box .value{font-size:20px;font-weight:900;color:${decisionColor};margin:4px 0;}
    .rg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}
    .rb{border:1.5px solid #bbb;border-radius:6px;padding:8px;min-height:50px;}
    .rb-label{font-weight:800;font-size:11px;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:3px;}
    .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px;font-size:10.5px;}
    .sig-box{border-top:1.5px solid #333;padding-top:4px;text-align:center;}
    @media print{button{display:none;}}
    ${_reportCardThemeCSS()}
  </style></head><body>

  <div class="hdr">
    ${cfg.logoUrl?`<img src="${cfg.logoUrl}" style="height:55px;margin-bottom:5px;">` : `<div style="font-size:28px;margin-bottom:3px;">🏫</div>`}
    <h1>${esc(cfg.schoolName||'School')}</h1>
    <h2>ANNUAL PROMOTION REPORT — ${esc(promo.year || cfg.session || '')}</h2>
  </div>

  <div class="ig">
    <div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div>
    <div><b>Admission No:</b> ${esc(s.admissionNo||'–')}</div><div><b>Position in Class:</b> ${myPos} of ${classStudents.length}</div>
    <div><b>Days Present (full year):</b> ${daysPresent}</div><div><b>Days Absent:</b> ${daysAbsent}</div>
  </div>

  <div class="sm">
    <div class="sb"><div class="sv">${termAvgs[0].avg||'–'}</div>Term 1 Avg</div>
    <div class="sb"><div class="sv">${termAvgs[1].avg||'–'}</div>Term 2 Avg</div>
    <div class="sb"><div class="sv">${termAvgs[2].avg||'–'}</div>Term 3 Avg</div>
    <div class="sb"><div class="sv">${myAvg||'–'}</div>Cumulative Avg</div>
  </div>

  <div class="st">CUMULATIVE ACADEMIC PERFORMANCE — ALL 3 TERMS</div>
  <table><thead><tr><th>Subject</th><th>Term 1</th><th>Term 2</th><th>Term 3</th><th>Cumulative</th><th>Grade</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p style="font-size:10px;color:#777;">Overall Cumulative Average: <b>${myAvg}</b> · Overall Grade: <b>${overallGrade}</b></p>

  <div class="decision-box">
    <div class="label">END-OF-YEAR DECISION</div>
    <div class="value">${esc(promo.decision || 'Not yet decided')}</div>
    ${promo.nextClass ? `<div style="font-size:12px;color:#333;">Proceeding to: <b>${esc(promo.nextClass)}</b></div>` : ''}
  </div>

  <div class="rg">
    <div class="rb"><div class="rb-label">Class Teacher's Comment</div>${esc(promo.comment || '____________________')}</div>
    <div class="rb"><div class="rb-label">Principal's Comment</div>____________________</div>
  </div>

  <div class="sig-row">
    <div class="sig-box">Class Teacher<br>Signature</div>
    <div class="sig-box">Principal<br>Signature</div>
    <div class="sig-box">Parent / Guardian<br>Signature & Date</div>
  </div>
  ${promo.decidedBy ? `<p style="font-size:9.5px;color:#999;margin-top:8px;">Decision recorded by ${esc(promo.decidedBy)} on ${promo.decidedAt ? new Date(promo.decidedAt).toLocaleDateString() : '—'}</p>` : ''}

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
    if (isCum) { const {cumSub,avg}=calcCumulative(sid,subs); const cnt=subs.reduce((n,sub)=>cumSub[sub]?n+1:n,0); return {s,perSub:cumSub,avg,count:cnt}; }
    const {perSub,avg,count}=calcStudentTermStats(sid,view,subs); return {s,perSub,avg,count};
  }).sort((a,b)=>b.avg-a.avg);
  const thCells = subs.map(s=>`<th style="writing-mode:vertical-lr;transform:rotate(180deg);font-size:9px;padding:2px;">${esc(s)}</th>`).join('');
  const rows = stats.map(({s,perSub,avg},i)=>{
    const cells = subs.map(sub=>{if(isCum){const v=perSub[sub]||0;return`<td style="text-align:center;font-size:9.5px;">${v||'–'}</td>`;}const ps=perSub[sub];if(!ps||!ps.hasData)return`<td style="text-align:center;font-size:9.5px;color:#ccc;">–</td>`;return`<td style="text-align:center;font-size:9.5px;">${ps.tot}</td>`;}).join('');
    const {g}=getGrade(avg);
    return `<tr><td>${i+1}</td><td style="white-space:nowrap;font-size:10px;">${esc(s.name)}</td>${cells}<td style="font-weight:700;">${avg||'–'}</td><td>${stats[i].count>0?g:'–'}</td></tr>`;
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
    const td = ((SD.scores[term]||{})[sid]||{});
    const hasData = _hasScoreEntry(td, sub);
    const e = hasData ? _capScoreEntry(td[sub]) : { ca1:0,ca2:0,ca3:0,exam:0,ca1Raw:0,ca2Raw:0,ca3Raw:0,examRaw:0,caT:0,tot:0,hasOverflow:false };
    const {g,col}=getGrade(e.tot);
    const tabBase = i*4;
    return `<tr id="bsg-row-${i}" style="${e.tot>=70?'background:rgba(16,185,129,0.04)':''}">
      <td style="font-size:0.76rem;font-weight:600;padding:5px 6px;white-space:nowrap;">${esc(s.name)}</td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${e.ca1||''}" tabindex="${tabBase+1}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca1',this.value)" onkeydown="bsgNav(event,${i},0,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${e.ca1Raw>10?'var(--danger)':e.ca1?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-0"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${e.ca2||''}" tabindex="${tabBase+2}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca2',this.value)" onkeydown="bsgNav(event,${i},1,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${e.ca2Raw>10?'var(--danger)':e.ca2?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-1"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${e.ca3||''}" tabindex="${tabBase+3}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca3',this.value)" onkeydown="bsgNav(event,${i},2,${classStudents.length})" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${e.ca3Raw>10?'var(--danger)':e.ca3?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-2"></td>
      <td style="padding:2px;"><input type="number" min="0" max="70" value="${e.exam||''}" tabindex="${tabBase+4}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'exam',this.value)" onkeydown="bsgNav(event,${i},3,${classStudents.length})" style="width:48px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid ${e.examRaw>70?'var(--danger)':e.exam?'var(--brand)':'var(--border)'};border-radius:6px;" id="bsg-${i}-3"></td>
      <td style="text-align:center;font-weight:700;font-family:'DM Mono',monospace;font-size:0.82rem;color:${hasData?(e.tot>0?'var(--text)':'var(--danger)'):'var(--border)'};">${hasData?(e.hasOverflow?'⚠️ ':'')+e.tot:'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.76rem;color:${col};">${hasData?g:'–'}</span></td>
    </tr>`;
  }).join('');

  const entered = classStudents.filter(s=>{
    const sid=s.id||SD.students.indexOf(s);
    const td=((SD.scores[term]||{})[sid]||{});
    return _hasScoreEntry(td, sub);
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
  const e = _capScoreEntry(v);
  const row = $('bsg-row-'+rowIdx);
  if (row) {
    const cells = row.querySelectorAll('td');
    const {g,col}=getGrade(e.tot);
    if (cells[5]) cells[5].textContent = e.hasOverflow ? '⚠️ '+e.tot : (e.tot||'–');
    if (cells[6]) cells[6].innerHTML = `<span style="font-weight:700;font-size:0.76rem;color:${col};">${g}</span>`;
    row.style.background = e.tot>=70?'rgba(16,185,129,0.04)':'';
    const inp = $(`bsg-${rowIdx}-${['ca1','ca2','ca3','exam'].indexOf(field)}`);
    const maxVal = field==='exam'?70:10;
    if (inp) inp.style.borderColor = (parseInt(val)>maxVal)?'var(--danger)':(val?'var(--brand)':'var(--border)');
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
      if (!_hasScoreEntry(termData, sub)) {
        return `<tr><td>${esc(sub)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
      }
      const e=_capScoreEntry(termData[sub]); const {g}=getGrade(e.tot);
      const subRanked = classStudents.map(st=>{
        const stid=st.id||SD.students.indexOf(st);
        const sv=((SD.scores[term]||{})[stid]||{});
        if (!_hasScoreEntry(sv, sub)) return {name:st.name,tot:0};
        const se=_capScoreEntry(sv[sub]);
        return {name:st.name,tot:se.tot};
      }).sort((a,b)=>b.tot-a.tot);
      const sPos = (subRanked.findIndex(r=>r.name===s.name)+1)||'–';
      const ovFlag=e.hasOverflow?'⚠️':'';
      return `<tr><td>${esc(sub)}</td><td>${e.ca1||''}</td><td>${e.ca2||''}</td><td>${e.ca3||''}</td><td>${e.caT||''}</td><td>${e.exam||''}</td>
        <td style="font-weight:700;color:${e.tot>=70?'green':e.tot>=50?'#333':'red'};">${ovFlag}${e.tot||''}</td><td style="font-weight:700;">${g}</td><td>${sPos}</td></tr>`;
    }).join('');
    const {avg:avg, count:dataCount} = calcStudentTermStats(sid, term, subs);
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
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${dataCount>0?getGrade(avg).g:'–'}</div>Grade</div>
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
  if (pwd.length < 6) return alert('Password min 6 chars (Firebase Auth requirement).');
  if (role === 'Class Teacher' && !assignedClass) return alert('Assign a class for this Class Teacher.');
  if ((SD.staff||[]).find(s => s.email === email)) return alert('Email already registered.');
  const isPrem = SD.config.plan === 'premium';
  if (!isPrem && (SD.staff||[]).length >= 3) { openUpgradeModal(); return; }
  if (!SD.staff) SD.staff = [];
    const hashedPwd = await _hashPassword(pwd);
  SD.staff.push({ name, email, password: hashedPwd, role, assignedClass: assignedClass||null, assignedSubjects });
  if (schoolId && !SD.config?._demo) {
    try {
      const uid = await createStaffAccountV2(schoolId, email, pwd, { name, role, assignedClass: assignedClass||null, assignedSubjects });
      SD.staff[SD.staff.length-1]._v2Uid = uid;
      // createUserWithEmailAndPassword signs in as the new staff member — sign back out
      // so the Principal's session is not replaced by the newly created account.
      try { await firebase.auth().signOut(); } catch(e) {}
    } catch (e) { console.warn('addStaff Firebase Auth failed — legacy login still works:', e.message); }
  }
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
      <label>Assigned Class</label><select id="est-class" onchange="handleClassSelectChange(this)"></select>
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
  setTimeout(() => { const sel = $('est-class'); if (sel) populateClassSelect(sel, s.assignedClass || ''); }, 20);
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
    <div>Student Name</div><div style="text-align:center;">1CA/10</div><div style="text-align:center;">2CA/10</div><div style="text-align:center;">3CA/10</div><div style="text-align:center;">Exam/70</div><div style="text-align:center;">Total</div></div>`
    +classStudents.map(s=>{
      const sid=s.id||SD.students.indexOf(s);
      const scoreRecord=termScores[sid]?.[sub]||{};
      // Support legacy flat "ca" field (older single-CA records) by seeding ca1 with it
      const ca1Val=scoreRecord.ca1!==undefined?scoreRecord.ca1:(scoreRecord.ca!==undefined?scoreRecord.ca:'');
      const ca2Val=scoreRecord.ca2!==undefined?scoreRecord.ca2:'';
      const ca3Val=scoreRecord.ca3!==undefined?scoreRecord.ca3:'';
      const examVal=scoreRecord.exam!==undefined?scoreRecord.exam:'';
      const tot=(parseInt(ca1Val)||0)+(parseInt(ca2Val)||0)+(parseInt(ca3Val)||0)+(parseInt(examVal)||0);
      return `<div class="ss-row" data-sid="${sid}">
        <div style="font-weight:600;font-size:0.8rem;">${esc(s.name)}</div>
        <div><input type="number" min="0" max="10" class="ss-inp ca1-input" value="${ca1Val}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div><input type="number" min="0" max="10" class="ss-inp ca2-input" value="${ca2Val}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div><input type="number" min="0" max="10" class="ss-inp ca3-input" value="${ca3Val}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div><input type="number" min="0" max="70" class="ss-inp exam-input" value="${examVal}" placeholder="0" oninput="recalcSSTotal(this)"></div>
        <div class="ss-tot">${tot||'–'}</div></div>`;
    }).join('');
}

function recalcSSTotal(inputEl){
  const row=inputEl.closest('.ss-row'); if(!row) return;
  const ca1=parseInt(row.querySelector('.ca1-input').value)||0;
  const ca2=parseInt(row.querySelector('.ca2-input').value)||0;
  const ca3=parseInt(row.querySelector('.ca3-input').value)||0;
  const exam=parseInt(row.querySelector('.exam-input').value)||0;
  row.querySelector('.ss-tot').textContent=(ca1+ca2+ca3+exam)||'–';
}

async function saveSubjectScores(){
  const cls=$('ss-class-sel')?.value,sub=$('ss-subj-sel')?.value;
  const term=SD.config.currentTerm||'Term 1',listEl=$('ss-list');
  if(!cls||!sub||!listEl) return;
  if(!SD.scores[term]) SD.scores[term]={};
  listEl.querySelectorAll('.ss-row[data-sid]').forEach(row=>{
    const sid=row.getAttribute('data-sid');
    const ca1=parseInt(row.querySelector('.ca1-input').value)||0;
    const ca2=parseInt(row.querySelector('.ca2-input').value)||0;
    const ca3=parseInt(row.querySelector('.ca3-input').value)||0;
    const exam=parseInt(row.querySelector('.exam-input').value)||0;
    if(!SD.scores[term][sid]) SD.scores[term][sid]={};
    // 3 CAs @10% each (30% total) + Exam @70% — matches the school's real grading structure
    SD.scores[term][sid][sub]={ca1,ca2,ca3,exam};
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

function _buildScoreOcrPrompt(sub, termMode) {
  if (termMode === 'all') {
    return buildOcrPrompt('score_sheet_all', { subject: sub });
  } else {
    return buildOcrPrompt('score_sheet_single', { subject: sub, termNum: String(termMode) });
  }
}
function _parseScoreOcrJson(raw){
  let text=(raw||'[]').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  const cb=text.match(/```(?:json)?\s*([\s\S]*?)```/); if(cb) text=cb[1].trim();
  const am=text.match(/(\[[\s\S]*\])/); if(am) text=am[1].trim();
  return JSON.parse(text);
}

async function _groqScoreOCR(b64, mime, prompt){
  const groqKey=getGroqKey();
  if(!groqKey) throw new Error('No Groq key configured');
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),60000);
  let r;
  try {
    r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqKey},body:JSON.stringify({
      model: GROQ_OCR_MODEL, temperature:0.2, max_tokens: 4096,
      messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:'+mime+';base64,'+b64}},{type:'text',text:prompt}]}]
    })});
  } finally { clearTimeout(timer); }
  if(!r.ok){ const ed=await r.json().catch(()=>({})); throw new Error('Groq '+r.status+': '+(ed.error?.message||r.statusText)); }
  const d=await r.json();
  const raw=d.choices?.[0]?.message?.content||'[]';
  const parsed=_parseScoreOcrJson(raw);
  if(!Array.isArray(parsed)||!parsed.length) throw new Error('Groq returned 0 score entries');
  return parsed;
}

// _hfScoreOCR removed — Groq-only OCR pipeline

function _renderScoreOcrPreview(rows, classStudents, termMode){
  const statusEl=$('socr-status');
  if(statusEl) statusEl.innerHTML=`<span style="color:var(--money);">✅ Found ${rows.length} entries — all 3 terms. Review before saving:</span>`;
  const actionRow=$('socr-action-row'); if(actionRow) actionRow.style.display='flex';

  // Build a 3-term tabbed preview. Each row has t1/t2/t3 objects.
  // Normalize: if rows have flat ca1/ca2/ca3/exam (Tesseract fallback), wrap into t1.
  const normalized = rows.map(r => {
    if (r.t1) return r;
    return { name: r.name, t1: { ca1:r.ca1||0, ca2:r.ca2||0, ca3:r.ca3||0, exam:r.exam||0 }, t2:{ca1:0,ca2:0,ca3:0,exam:0}, t3:{ca1:0,ca2:0,ca3:0,exam:0} };
  });

  // Term tabs
  let pHTML = `<div style="margin-top:0.5rem;">
    <div style="display:flex;gap:0.3rem;margin-bottom:0.4rem;">
      <button id="socr-tab-t1" class="socr-term-tab" onclick="socrSwitchTermTab(1)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--brand);background:var(--brand);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;">Term 1</button>
      <button id="socr-tab-t2" class="socr-term-tab" onclick="socrSwitchTermTab(2)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.75rem;font-weight:700;cursor:pointer;">Term 2</button>
      <button id="socr-tab-t3" class="socr-term-tab" onclick="socrSwitchTermTab(3)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.75rem;font-weight:700;cursor:pointer;">Term 3</button>
    </div>`;

  // Render term tables — in single-term mode, only render the selected term
  const termsToShow = isAllTerms ? [1, 2, 3] : [parseInt(termNum)];
  for (const t of termsToShow) {
    const tKey = 't' + t;
    pHTML += `<div id="socr-term-${t}-panel" style="display:block;">`;
    if (!isAllTerms) {
      const tLabel = t === 1 ? 'Term 1' : t === 2 ? 'Term 2' : 'Term 3';
      pHTML += `<p style="font-size:0.72rem;color:var(--sub);margin-bottom:0.3rem;font-weight:600;">${tLabel}</p>`;
    }
    pHTML += `<div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:0.3rem;">
        <table class="stbl" style="font-size:0.72rem;width:100%;">
          <thead><tr>
            <th style="text-align:left;">Student Name</th>
            <th>1CA</th><th>2CA</th><th>3CA</th><th>Exam</th><th></th>
          </tr></thead><tbody>`;
    normalized.forEach((item, idx) => {
      const td = item[tKey] || { ca1:0, ca2:0, ca3:0, exam:0 };
      pHTML += `<tr class="socr-preview-row socr-row-${idx}" data-name="${esc(item.name||'')}" data-row-idx="${idx}">
        <td style="text-align:left;"><b>${esc(item.name||'')}</b></td>
        <td>${_buildCaDropdown(td.ca1||0, t, 'ca1', idx)}</td>
        <td>${_buildCaDropdown(td.ca2||0, t, 'ca2', idx)}</td>
        <td>${_buildCaDropdown(td.ca3||0, t, 'ca3', idx)}</td>
        <td>${_buildExamDropdown(td.exam||0, t, idx)}</td>
        <td><button onclick="socrSwapRow(${idx})" style="font-size:0.6rem;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:transparent;cursor:pointer;" title="Swap with next row">⇅</button></td>
      </tr>`;
    });
    pHTML += `</tbody></table></div></div>`;
  }

  pHTML += `</div>`;

  const previewEl=$('socr-preview'); if(previewEl) previewEl.innerHTML=pHTML;
  const saveBtn=$('socr-save-btn'); if(saveBtn) saveBtn.style.display='block';

  // Store normalized data + term mode for save + swap
  window._socrPreviewData = normalized;
  window._socrTermMode = isAllTerms ? 'all' : termMode;
}

// ── Term tab switcher ──
function socrSwitchTermTab(t) {
  for (let i = 1; i <= 3; i++) {
    const panel = $('socr-term-' + i + '-panel');
    const tab = $('socr-tab-t' + i);
    if (panel) panel.style.display = (i === t) ? 'block' : 'none';
    if (tab) {
      if (i === t) { tab.style.background = 'var(--brand)'; tab.style.color = '#fff'; tab.style.borderColor = 'var(--brand)'; }
      else { tab.style.background = 'transparent'; tab.style.color = 'var(--text)'; tab.style.borderColor = 'var(--border)'; }
    }
  }
}

// ── Swap two adjacent rows (fixes Tesseract positional mismatches) ──
function socrSwapRow(idx) {
  const data = window._socrPreviewData;
  if (!data || idx >= data.length - 1) return;
  // Swap in data array
  [data[idx], data[idx + 1]] = [data[idx + 1], data[idx]];
  // Re-render with current input values preserved
  // First, capture current input values from all 3 term panels
  const captured = data.map((item, i) => {
    const row = document.querySelector('.socr-row-' + i);
    if (!row) return item;
    const updated = { name: item.name, t1: {...item.t1}, t2: {...item.t2}, t3: {...item.t3} };
    for (let t = 1; t <= 3; t++) {
      ['ca1','ca2','ca3','exam'].forEach(f => {
        const inp = row.querySelector('input.socr-t' + t + '-' + f) || row.querySelector('select.socr-t' + t + '-' + f);
        if (inp) updated['t' + t][f] = parseInt(inp.value) || 0;
      });
    }
    return updated;
  });
  // Swap in captured too
  [captured[idx], captured[idx + 1]] = [captured[idx + 1], captured[idx]];
  window._socrPreviewData = captured;
  // Re-render
  _renderScoreOcrPreview(captured, SD.students.filter(s => s.class === $('socr-class')?.value), window._socrTermMode || 'all');
}

function _renderScoreOcrManualGrid(classStudents, termMode){
  const statusEl=$('socr-status');
  if(statusEl) statusEl.innerHTML='<span style="color:var(--warn);">⚠️ Could not auto-read this photo. Enter scores manually below, or tap Rescan to try a clearer photo:</span>';
  const actionRow=$('socr-action-row'); if(actionRow) actionRow.style.display='flex';

  // Build manual grid with all 3 terms, same tabbed layout
  const manualRows = classStudents.map(s => ({
    name: s.name.toUpperCase(),
    t1: { ca1:0, ca2:0, ca3:0, exam:0 },
    t2: { ca1:0, ca2:0, ca3:0, exam:0 },
    t3: { ca1:0, ca2:0, ca3:0, exam:0 }
  }));
  _renderScoreOcrPreview(manualRows, classStudents, termMode || 'all');
  // Override the status message for manual mode
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--warn);">⚠️ Could not auto-read. Enter scores manually — switch between Term 1/2/3 tabs:</span>';
}

// ── Manual mode toggle — skip scanning, go straight to dropdown entry ──
function socrToggleManualMode(){
  const cls=$('socr-class')?.value;
  const sub=$('socr-subj')?.value;
  const termMode=$('socr-term')?.value || 'all';
  if(!cls){ $('socr-status').innerHTML='<span style="color:var(--danger);">Pick a class first.</span>'; return; }
  const classStudents=SD.students.filter(s=>s.class===cls);
  if(!classStudents.length){
    $('socr-status').innerHTML='<span style="color:var(--danger);">No students in this class. Add students first.</span>';
    return;
  }
  window._socrTermMode=termMode;
  _renderScoreOcrDropdownGrid(classStudents, termMode);
}

// ── Dropdown-based manual entry grid (CA 0-10, Exam 0-70) ──
function _buildCaDropdown(val, term, field, idx){
  let opts='<option value="0">-</option>';
  for(let i=0;i<=10;i++){
    opts+=`<option value="${i}"${(val===i)?' selected':''}>${i}</option>`;
  }
  return `<select class="socr-t${term}-${field} socr-dd" data-term="${term}" data-field="${field}" data-row="${idx}" style="width:48px;padding:2px;margin:0;font-size:0.72rem;border:1px solid var(--border);border-radius:4px;">${opts}</select>`;
}

function _buildExamDropdown(val, term, idx){
  let opts='<option value="0">-</option>';
  for(let i=0;i<=70;i++){
    opts+=`<option value="${i}"${(val===i)?' selected':''}>${i}</option>`;
  }
  return `<select class="socr-t${term}-exam socr-dd" data-term="${term}" data-field="exam" data-row="${idx}" style="width:54px;padding:2px;margin:0;font-size:0.72rem;border:1px solid var(--border);border-radius:4px;">${opts}</select>`;
}

function _renderScoreOcrDropdownGrid(classStudents, termMode){
  const isAllTerms=(termMode==='all'||!termMode);
  const termNum=isAllTerms?'1':(termMode||'1');
  const statusEl=$('socr-status');
  if(statusEl) statusEl.innerHTML='<span style="color:var(--brand);">✍️ Manual entry mode — pick scores from the dropdowns. No scanning needed.</span>';

  const actionRow=$('socr-action-row'); if(actionRow) actionRow.style.display='flex';

  // Build data rows with zeros
  const manualRows=classStudents.map(s=>({
    name:s.name.toUpperCase(),
    t1:{ca1:0,ca2:0,ca3:0,exam:0},
    t2:{ca1:0,ca2:0,ca3:0,exam:0},
    t3:{ca1:0,ca2:0,ca3:0,exam:0}
  }));

  // Build the same tabbed or single-term layout but with dropdowns
  let pHTML=`<div style="margin-top:0.5rem;">`;
  if(isAllTerms){
    pHTML+=`<div style="display:flex;gap:0.3rem;margin-bottom:0.4rem;">
      <button id="socr-tab-t1" class="socr-term-tab" onclick="socrSwitchTermTab(1)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--brand);background:var(--brand);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;">Term 1</button>
      <button id="socr-tab-t2" class="socr-term-tab" onclick="socrSwitchTermTab(2)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.75rem;font-weight:700;cursor:pointer;">Term 2</button>
      <button id="socr-tab-t3" class="socr-term-tab" onclick="socrSwitchTermTab(3)" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.75rem;font-weight:700;cursor:pointer;">Term 3</button>
    </div>`;
  }

  const termsToShow=isAllTerms?[1,2,3]:[parseInt(termNum)];
  for(const t of termsToShow){
    pHTML+=`<div id="socr-term-${t}-panel" style="display:${(isAllTerms&&t!==1)?'none':'block'};">`;
    if(!isAllTerms){
      const tLabel=t===1?'Term 1':t===2?'Term 2':'Term 3';
      pHTML+=`<p style="font-size:0.72rem;color:var(--sub);margin-bottom:0.3rem;font-weight:600;">${tLabel}</p>`;
    }
    pHTML+=`<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:0.3rem;">
      <table class="stbl" style="font-size:0.72rem;width:100%;">
        <thead><tr>
          <th style="text-align:left;">Student Name</th>
          <th>1CA</th><th>2CA</th><th>3CA</th><th>Exam</th>
        </tr></thead><tbody>`;
    manualRows.forEach((item, idx)=>{
      pHTML+=`<tr class="socr-preview-row socr-row-${idx}" data-name="${esc(item.name)}" data-row-idx="${idx}">
        <td style="text-align:left;"><b>${esc(classStudents[idx].name)}</b></td>
        <td>${_buildCaDropdown(0, t, 'ca1', idx)}</td>
        <td>${_buildCaDropdown(0, t, 'ca2', idx)}</td>
        <td>${_buildCaDropdown(0, t, 'ca3', idx)}</td>
        <td>${_buildExamDropdown(0, t, idx)}</td>
      </tr>`;
    });
    pHTML+=`</tbody></table></div></div>`;
  }
  pHTML+=`</div>`;

  const previewEl=$('socr-preview'); if(previewEl) previewEl.innerHTML=pHTML;
  const saveBtn=$('socr-save-btn'); if(saveBtn) saveBtn.style.display='block';

  // Store data + term mode for save
  window._socrPreviewData=manualRows;
  window._socrTermMode=isAllTerms?'all':termMode;
  window._socrManualMode=true;
}

function socrRescan(){
  // Reset the modal back to Step 2 (photo taking) so the agent can try a clearer/better-lit shot.
  const statusEl=$('socr-status'); if(statusEl) statusEl.innerHTML='';
  const previewEl=$('socr-preview'); if(previewEl) previewEl.innerHTML='';
  const actionRow=$('socr-action-row'); if(actionRow) actionRow.style.display='none';
  const saveBtn=$('socr-save-btn'); if(saveBtn) saveBtn.style.display='none';
  const imgInput=$('socr-img-input'); if(imgInput) imgInput.value='';
}

async function socrHandleImage(event){
  const files = Array.from(event.target.files || []); if (!files.length) return;
  const statusEl = $('socr-status');
  const actionRow = $('socr-action-row'); if (actionRow) actionRow.style.display = 'none';
  const cls = $('socr-class')?.value;
  const sub = $('socr-subj')?.value;
  const termMode = $('socr-term')?.value || 'all'; // 'all', '1', '2', or '3'
  const classStudents = SD.students.filter(s => s.class === cls);
  if (!classStudents.length) { if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">No students in this class.</span>'; return; }

  // ── Route files by type (same logic as Agent app) ──
  const csvOnly = files.filter(f => {
    const n = (f.name || '').toLowerCase(), t = (f.type || '').toLowerCase();
    return t === 'text/csv' || t === 'text/plain' || /\.(csv|txt)$/.test(n);
  });
  const ocrFiles = files.filter(f => !csvOnly.includes(f));

  // Handle CSV/TXT files — parse names + scores directly
  csvOnly.forEach(f => {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--brand);">📄 Reading CSV/text file...</span>';
    socrHandleCSVFile(f, classStudents, sub, termMode, statusEl);
  });

  // Handle image/PDF files — full OCR pipeline
  if (ocrFiles.length) {
    await socrHandleImageFiles(ocrFiles, classStudents, sub, termMode, statusEl);
  }
}

// ── CSV/TXT handler for score sheets (supports all 3 terms) ──
function socrHandleCSVFile(file, classStudents, sub, termMode, statusEl) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Empty file.</span>';
        return;
      }

      const hasHeader = /name|student|ca|exam|score|total|term/i.test(lines[0]);
      const dataLines = hasHeader ? lines.slice(1) : lines;
      const rows = [];
      const isAllTerms = (termMode === 'all' || !termMode);
      const termNum = isAllTerms ? '1' : (termMode || '1');

      dataLines.forEach(line => {
        const parts = line.includes(',') ? line.split(',').map(p => p.trim().replace(/"/g, ''))
                    : line.split(/\s{2,}|\t/).map(p => p.trim());
        if (!parts.length) return;

        const name = parts[0] || '';
        if (!name || name.length < 2) return;
        if (/^(s\/n|serial|no\.?|total|class|#)/i.test(name)) return;

        const nums = parts.slice(1).map(p => parseFloat(p) || 0);
        const row = { name: name.toUpperCase() };

        if (isAllTerms && nums.length >= 12) {
          // All 3 terms present in CSV
          row.t1 = { ca1: Math.min(nums[0],10), ca2: Math.min(nums[1],10), ca3: Math.min(nums[2],10), exam: Math.min(nums[3],70) };
          row.t2 = { ca1: Math.min(nums[4],10), ca2: Math.min(nums[5],10), ca3: Math.min(nums[6],10), exam: Math.min(nums[7],70) };
          row.t3 = { ca1: Math.min(nums[8],10), ca2: Math.min(nums[9],10), ca3: Math.min(nums[10],10), exam: Math.min(nums[11],70) };
        } else if (isAllTerms && nums.length >= 8) {
          // 2 terms in CSV
          row.t1 = { ca1: Math.min(nums[0],10), ca2: Math.min(nums[1],10), ca3: Math.min(nums[2],10), exam: Math.min(nums[3],70) };
          row.t2 = { ca1: Math.min(nums[4],10), ca2: Math.min(nums[5],10), ca3: Math.min(nums[6],10), exam: Math.min(nums[7],70) };
          row.t3 = { ca1:0, ca2:0, ca3:0, exam:0 };
        } else {
          // Single term — flat row, renderer will wrap into the correct term slot
          row.ca1 = Math.min(nums[0]||0,10);
          row.ca2 = Math.min(nums[1]||0,10);
          row.ca3 = Math.min(nums[2]||0,10);
          row.exam = Math.min(nums[3]||0,70);
        }
        rows.push(row);
      });

      if (rows.length) {
        if (statusEl) statusEl.innerHTML = isAllTerms
          ? `<span style="color:var(--money);">✅ Read ${rows.length} entries (all 3 terms) from CSV.</span>`
          : `<span style="color:var(--money);">✅ Read ${rows.length} entries from CSV.</span>`;
        _renderScoreOcrPreview(rows, classStudents, termMode);
      } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--warn);">No score data found in CSV.</span>';
        _renderScoreOcrManualGrid(classStudents, termMode);
      }
    } catch (err) {
      console.warn('CSV parse error:', err.message);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Could not read CSV file.</span>';
      _renderScoreOcrManualGrid(classStudents, termMode);
    }
  };
  reader.onerror = () => {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Could not read file.</span>';
    _renderScoreOcrManualGrid(classStudents, termMode);
  };
  reader.readAsText(file);
}

// ── Image/PDF handler — full OpenCV + Groq → HF → Tesseract pipeline ──
async function socrHandleImageFiles(files, classStudents, sub, termMode, statusEl) {
  const prompt = _buildScoreOcrPrompt(sub, termMode);
  const allRows = [];
  let usedTesseractFallback = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = (file.name || '').toLowerCase();
    const isPDF = file.type === 'application/pdf' || fileName.endsWith('.pdf');

    if (i > 1 && files.length > 1) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--brand);">⏳ Page ${i + 1} of ${files.length}...</span>`;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (isPDF) {
      // PDF → render pages to images → OCR each page
      try {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--brand);">⏳ Loading PDF...</span>';
        const pageImages = await socrRenderPDFToImages(file, statusEl);
        for (let p = 0; p < pageImages.length; p++) {
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--brand);">⏳ Reading PDF page ${p + 1}/${pageImages.length}...</span>`;
          const res = await socrOcrOneImage(pageImages[p], 'image/jpeg', prompt, statusEl, classStudents, termMode);
          if (res && res.rows && res.rows.length) { allRows.push(...res.rows); if (res.fromTesseract) usedTesseractFallback = true; }
        }
      } catch (pdfErr) {
        console.warn('PDF rendering failed:', pdfErr.message);
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--warn);">⚠️ Could not read PDF. Try taking a photo instead.</span>';
      }
    } else {
      // Image file — read + preprocess + OCR
      const res = await socrOcrOneImageFile(file, prompt, statusEl, classStudents, termMode);
      if (res && res.rows && res.rows.length) { allRows.push(...res.rows); if (res.fromTesseract) usedTesseractFallback = true; }
    }
  }

  if (allRows.length) {
    if (statusEl) {
      statusEl.innerHTML = usedTesseractFallback
        ? `<span style="color:var(--money);">✅ Found ${allRows.length} entries. Names matched to your roster (Tesseract read the numbers — please double-check them below).</span>`
        : `<span style="color:var(--money);">✅ Found ${allRows.length} entries.</span>`;
    }
    _renderScoreOcrPreview(allRows, classStudents, termMode);
  } else {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--warn);">⚠️ Could not read scores automatically. Enter manually below or tap Rescan.</span>';
    _renderScoreOcrManualGrid(classStudents, termMode);
  }
}

// ── OCR one image file: read → OpenCV preprocess → Groq → HF → Tesseract ──
async function socrOcrOneImageFile(file, prompt, statusEl, classStudents, termMode) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async ev => {
      const rawDataURL = ev.target.result;
      const result = await socrOcrOneImage(rawDataURL, file.type || 'image/jpeg', prompt, statusEl, classStudents, termMode);
      resolve(result);
    };
    reader.onerror = () => { console.warn('File read error'); resolve(null); };
    reader.readAsDataURL(file);
  });
}

// ── OCR one image data URL: OpenCV → Groq → HF → Tesseract (numbers-only, matched to roster) ──
// Returns { rows, fromTesseract } so the caller knows to show the "please double-check" note.
async function socrOcrOneImage(dataURL, mime, prompt, statusEl, classStudents, termMode) {
  // ── OpenCV preprocessing (denoise + threshold + deskew) ──
  let processedDataURL = dataURL;
  try {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--brand);">⏳ Enhancing image (OpenCV)...</span>';
    processedDataURL = await resizeImageForOCR(dataURL);
    mime = 'image/jpeg';
  } catch (preErr) {
    console.warn('[Score OCR] OpenCV preprocess failed, using raw:', preErr.message);
    processedDataURL = dataURL;
  }
  const b64 = processedDataURL.split(',')[1];

  // ── Step 1: Groq Vision — reads names AND numbers directly off the sheet ──
  try {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--brand);">⏳ Reading with Groq...</span>';
    const rows = await _groqScoreOCR(b64, mime, prompt);
    if (rows && rows.length) return { rows, fromTesseract: false };
  } catch (e1) {
    console.warn('Groq score OCR failed:', e1.message);
  }

    // ── Groq-only: no fallback engines ──
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">⚠️ Groq scan failed. Check image quality and retry.</span>';
  return null;
}

// ── Tesseract.js loader (lazy-loaded on first use) ──
let _tesseractLoading = null;
// loadTesseract removed — Groq-only OCR pipeline


// ── Tesseract.js OCR — runs entirely in-browser, no API key needed ──
// IMPORTANT: Tesseract is unreliable at reading handwritten cursive names
// (it produces garbage like "BLE LEPOLUDAL KOLSG" for real names). So we
// completely IGNORE whatever text/name Tesseract reads. Instead we:
//   1. Pull out every row that looks like it has score numbers on it
//   2. Sort the real class roster alphabetically (standard register order)
//   3. Map row 1 of numbers → student 1 of roster, row 2 → student 2, etc.
// This guarantees the names shown are always correct, real student names —
// only the numbers came from OCR, and the user reviews/edits them anyway.
// socrTesseractOCR removed — Groq-only OCR pipeline


// ── PDF.js loader (lazy-loaded on first PDF scan) ──
let _pdfjsLoading = null;
function loadPDFJS() {
  if (window.pdfjsLib) return Promise.resolve(true);
  if (_pdfjsLoading) return _pdfjsLoading;
  _pdfjsLoading = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      resolve(!!window.pdfjsLib);
    };
    s.onerror = () => { console.warn('PDF.js failed to load'); resolve(false); };
    document.head.appendChild(s);
  });
  return _pdfjsLoading;
}

// ── Render PDF pages to image data URLs ──
async function socrRenderPDFToImages(file, statusEl) {
  const ready = await loadPDFJS();
  if (!ready) throw new Error('PDF.js not loaded');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];
  const maxPages = Math.min(pdf.numPages, 10); // safety cap

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // high-res for OCR
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    // Run through OpenCV preprocessing
    let outputCanvas = canvas;
    try {
      const cvReady = await loadOpenCV();
      if (cvReady) outputCanvas = await preprocessWithOpenCV(canvas);
    } catch (e) { console.warn('[PDF] OpenCV preprocess skipped:', e.message); }

    images.push(outputCanvas.toDataURL('image/jpeg', 0.85));
  }

  return images;
}

async function socrSaveScores(){
  const cls=$('socr-class')?.value,sub=$('socr-subj')?.value;
  const termMode = window._socrTermMode || 'all';
  const termNames={'1':'Term 1','2':'Term 2','3':'Term 3'};
  const isAllTerms = (termMode === 'all');
  const data = window._socrPreviewData;
  if (!data || !data.length) { toast('No data to save.'); return; }

  // Capture latest input values from the DOM (user may have edited)
  // Works for both <input type="number"> (OCR mode) and <select> dropdowns (manual mode)
  const finalRows = data.map((item, i) => {
    const row = document.querySelector('.socr-row-' + i);
    const updated = { name: item.name, t1: {...(item.t1||{})}, t2: {...(item.t2||{})}, t3: {...(item.t3||{})} };
    if (row) {
      for (let t = 1; t <= 3; t++) {
        ['ca1','ca2','ca3','exam'].forEach(f => {
          // Try input first, then select (dropdown)
          const inp = row.querySelector('input.socr-t' + t + '-' + f) || row.querySelector('select.socr-t' + t + '-' + f);
          if (inp) updated['t' + t][f] = parseInt(inp.value) || 0;
        });
      }
    }
    return updated;
  });

  let saved = 0;
  // In single-term mode, only save to the selected term.
  // In all-terms mode, save to all 3.
  const termsToSave = isAllTerms ? [1, 2, 3] : [parseInt(termMode)];

  finalRows.forEach(item => {
    const s = SD.students.find(st => st.name === item.name || esc(st.name) === item.name || st.name.toUpperCase() === item.name.toUpperCase());
    if (!s) return;
    const sid = s.id || SD.students.indexOf(s);

    termsToSave.forEach(t => {
      const termName = termNames[String(t)];
      const td = item['t' + t];
      if (!td) return;
      if (!SD.scores[termName]) SD.scores[termName] = {};
      if (!SD.scores[termName][sid]) SD.scores[termName][sid] = {};
      SD.scores[termName][sid][sub] = {
        ca1: td.ca1 || 0,
        ca2: td.ca2 || 0,
        ca3: td.ca3 || 0,
        exam: td.exam || 0
      };
    });
    saved++;
  });

  await SQ.push('scores', SD.scores); saveLocal('scores', SD.scores);
  const termLabel = isAllTerms ? 'all 3 terms' : termNames[termMode];
  toast(`✅ Saved ${saved} students (${termLabel}) for ${sub}.`);
  closeM('score-ocr-modal');
  if (typeof renderScorecard === 'function') renderScorecard();
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
  if(statusEl) statusEl.innerHTML='<span style="color:var(--brand);">\u23f3 Groq is reading the marked script...</span>';
  const reader=new FileReader();
  reader.onload=async ev=>{
    const b64=ev.target.result.split(',')[1];
    const mime=file.type||'image/jpeg';
    const sub=$('scan-subj')?.value||'';
    try {
      const groqKey = getGroqKey();
      if (!groqKey) throw new Error('No Groq key configured');
      const prompt=`This is a Nigerian student examination script for subject: ${sub}.
Read the student's name (usually written at the top) and their total score/marks.
Return ONLY valid JSON: {"name":"Student Full Name","score":72}
If you cannot read the name, use "Unknown". If you cannot read the score, use 0.`;
      const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqKey},body:JSON.stringify({
        model: GROQ_OCR_MODEL, temperature:0.2, max_tokens:4096, reasoning_format:'hidden',
        messages:[
          {role:'system',content:'You are a JSON data extraction tool. Output ONLY valid JSON — no explanation, no markdown.'},
          {role:'user',content:[{type:'image_url',image_url:{url:'data:'+mime+';base64,'+b64}},{type:'text',text:prompt}]}
        ]
      })});
      const d=await r.json();
      let raw=(d.choices?.[0]?.message?.content||'{"name":"Unknown","score":0}').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
      const cb=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(cb) raw=cb[1].trim();
      const parsed=JSON.parse(raw);
      const term=SD.config.currentTerm||'Term 1';
      _scannedQueue.push({name:parsed.name,score:parsed.score||0,sub,term});
      if(statusEl) statusEl.innerHTML=`<span style="color:var(--money);">\u2705 Read: <b>${esc(parsed.name)}</b> \u2014 Score: <b>${parsed.score}</b></span>`;
      const countEl=$('scan-queue-count'); if(countEl) countEl.textContent=`${_scannedQueue.length} script${_scannedQueue.length!==1?'s':''} scanned this session`;
      const resultEl=$('scan-result');
      if(resultEl) resultEl.innerHTML=`<div class="card" style="margin-top:0.5rem;padding:0.6rem;background:var(--s2);">
        <div style="font-weight:700;font-size:0.85rem;color:var(--brand);">\ud83d\udcc4 Script Read</div>
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
  // Use Groq for finance AI (text-only chat completion — same key as OCR)
  try{
    const groqKey = getGroqKey();
    if (!groqKey) throw new Error('No Groq key configured');
    const prompt=`You are EduBloom's Finance Advisor for Nigerian schools. School data: ${context}. Question: ${q}\n\nGive a direct, practical answer in 3-4 sentences. Use ₦ for amounts.`;
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqKey},body:JSON.stringify({
      model:'llama-3.3-70b-versatile', temperature:0.3, max_tokens:300,
      messages:[{role:'user',content:prompt}]
    })});
    const d=await r.json();
    const reply=d.choices?.[0]?.message?.content||'Could not get a response.';
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
  const rt = $('s-report-theme'); if(rt) rt.value = cfg.reportCardTheme || 'classic';
  const isPrem = cfg.plan==='premium';
  const planEl=$('settings-plan'); if(planEl) planEl.textContent=isPrem?'PREMIUM ✨':'BASIC';
  const slEl=$('settings-staff-limit'); if(slEl) slEl.textContent=isPrem?'Unlimited':'3';
  const aiEl=$('settings-ai'); if(aiEl) aiEl.textContent=isPrem?'Premium Advisor':'Basic Analysis';
  updateLogoBadges(cfg.logo);
  renderSubjectChips();
  const subjScanBox=$('subj-premium-scan'), subjNudgeBox=$('subj-premium-nudge');
  if (_isPremium()) {
    if (subjScanBox) subjScanBox.style.display = 'block';
    if (subjNudgeBox) subjNudgeBox.style.display = 'none';
  } else {
    if (subjScanBox) subjScanBox.style.display = 'none';
    if (subjNudgeBox) subjNudgeBox.style.display = 'block';
  }
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

// Function name kept as loadGeminiKeySetting for HTML/loadSettings() compatibility.
// Manual key entry (saveGeminiKeySetting/clearGeminiKey) removed — key is fully
// auto-loaded via the secure proxy (_fetchGroqKeyFromFirestore) on login.
// If Groq is ever unreachable, the tiered pipeline auto-falls to HuggingFace Vision,
// then OCR.space — no manual override needed.
function loadGeminiKeySetting() {
  const status = $('gemini-key-status');
  if (!status) return;
  if (getGroqKey()) {
    status.innerHTML = '✅ Scanner ready — Groq Vision active';
    status.style.color = '#22c55e';
  } else {
    status.innerHTML = '⚠️ Groq API key not loaded — contact admin to configure';
    status.style.color = '#f87171';
  }
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

// ── Subject list / curriculum photo scan (Premium) ────────────────────────
// Photograph a printed curriculum sheet, timetable header, or subject list
// and bulk-extract the subject names instead of typing each one.
async function scanSubjectList(event) {
  if (!_isPremium()) { _gateScan('subj'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('subj-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.textContent = m; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading subject list...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const prompt = `You are reading a photograph of a Nigerian school curriculum sheet, timetable, or list of subject names.
Extract every distinct subject name visible (e.g. "Mathematics", "English Language", "Basic Science & Technology").
${_OCR_DISCIPLINE}
Output ONLY: {"subjects":["Subject Name 1","Subject Name 2"]}
If nothing legible is found, output: {"subjects":[]}`;
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, prompt, 600);
    if (fb) fb.style.display = 'none';
    const found = Array.isArray(result.subjects) ? result.subjects.filter(s => s && s !== 'UNCLEAR') : [];
    if (!found.length) { show('❌ No subjects found — try a clearer photo, or add manually below.'); return; }
    if (!SD.config.subjects) SD.config.subjects = [];
    let added = 0;
    found.forEach(s => {
      const clean = String(s).trim();
      if (clean && !SD.config.subjects.some(x => x.toLowerCase() === clean.toLowerCase())) {
        SD.config.subjects.push(clean); added++;
      }
    });
    renderSubjectChips();
    show(`✅ Added ${added} subject${added!==1?'s':''} from photo — review the list above before saving.`);
    setTimeout(() => { if (fb) fb.style.display = 'none'; }, 5000);
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read subject list. Try a clearer photo.'));
  }
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
  SD.config.reportCardTheme = $('s-report-theme')?.value || 'classic';
  const pwd = $('set-pwd')?.value.trim();
  if (pwd) {
    const pr = (SD.staff||[]).find(s=>s.role==='Principal');
    if (pr) pr.password = await _hashPassword(pwd);
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

async function handleLogoUpload(event) {
  const file = event.target.files[0]; if(!file) return;
  event.target.value = '';
  try {
    const dUrl = await _compressImage(file, 256, 0.8);
    SD.config.logo = dUrl;
    await SQ.push('config', SD.config); saveLocal('config', SD.config);
    updateLogoBadges(dUrl);
    toast('✅ School logo updated.');
  } catch(e) { alert('Could not process logo. Try another image.'); }
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
  const hdrBadge=$('hdr-logo-badge'), hdrInitial=$('hdr-logo-initial');
  const navBadge=$('nav-logo-badge'), navInitial=$('nav-logo-initial'), navName=$('nav-school-name');
  if (navName) navName.textContent = SD.config.schoolName || 'Educational Bloom';
  if (logoUrl) {
    if (badge)  { badge.style.backgroundImage=`url(${logoUrl})`; if(badgeText) badgeText.style.display='none'; }
    if (preview){ preview.style.backgroundImage=`url(${logoUrl})`; if(previewText) previewText.style.display='none'; }
    if (nameEl)  nameEl.textContent='School logo loaded';
    if (hdrBadge)  { hdrBadge.style.backgroundImage=`url(${logoUrl})`; if(hdrInitial) hdrInitial.style.display='none'; }
    if (navBadge)  { navBadge.style.backgroundImage=`url(${logoUrl})`; if(navInitial) navInitial.style.display='none'; }
  } else {
    if (badge)  { badge.style.backgroundImage='none'; if(badgeText){ badgeText.style.display='inline'; badgeText.textContent=initial; } }
    if (preview){ preview.style.backgroundImage='none'; if(previewText){ previewText.style.display='inline'; previewText.textContent=initial; } }
    if (nameEl)  nameEl.textContent='No logo uploaded';
    if (hdrBadge)  { hdrBadge.style.backgroundImage='none'; if(hdrInitial){ hdrInitial.style.display='inline'; hdrInitial.textContent=initial; } }
    if (navBadge)  { navBadge.style.backgroundImage='none'; if(navInitial){ navInitial.style.display='inline'; navInitial.textContent=initial; } }
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


// ═══════════════════════════════════════════════════════════════════════
// FEE REGISTER SCANNER — Groq Vision → Structured Data → Payment Import
// Workflow: photo of physical handwritten fee register → Groq reads it
// → extracts structured JSON → matches students → imports payments
// ═══════════════════════════════════════════════════════════════════════

let _feeGroqKey = null;
let _feeImportData = null;  // holds last scanned result for import confirm

// ── 1. Get Groq key from public_ocr_keys (safe to read without admin auth) ──
async function _getFeeGroqKey() {
  if (_feeGroqKey) return _feeGroqKey;
  try {
    if (!db) return null;
    const doc = await db.collection('public_ocr_keys').doc('main').get();
    if (doc.exists && doc.data().groqApiKey) {
      _feeGroqKey = doc.data().groqApiKey;
      return _feeGroqKey;
    }
  } catch(e) { console.warn('Groq key fetch:', e.message); }
  return null;
}

// ── 2. File input handler wired from index.html ───────────────────────
async function handleFeeRegisterPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const fb = document.getElementById('fee-scan-fb');
  const show = msg => { if (fb) { fb.style.display = 'block'; fb.textContent = msg; } };

  if (!navigator.onLine) { show('❌ No internet. Connect to scan a register.'); return; }

  show('📸 Resizing image...');
  let resized;
  try { resized = await _resizeFeeImage(file, 800); }
  catch(e) { show('❌ Could not read image: ' + e.message); return; }

  show('🔑 Fetching AI key...');
  const key = await _getFeeGroqKey();
  if (!key) {
    show('❌ Groq API key not found. Ask Bayo to add groqApiKey in the portal admin settings.');
    return;
  }

  show('🤖 Groq AI is reading your register... (10–20 seconds)');
  try {
    const result = await _callGroqFeeVision(key, resized.base64, resized.mimeType);
    if (fb) fb.style.display = 'none';
    _feeImportData = result;
    _showFeeImportReview(result);
  } catch(e) {
    console.error('Fee register scan:', e);
    show('❌ ' + (e.message || 'Unknown error. Try a clearer, well-lit photo.'));
  }
}

// ── 3. Resize image before sending to Groq ───────────────────────────
function _resizeFeeImage(file, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PREMIUM OCR ENTRY POINTS — Expense/Payment/Student/Staff
// Reuses _getFeeGroqKey() and _resizeFeeImage() above. All four features
// share one generic Groq call (same qwen/qwen3.6-27b model + reading
// discipline as the fee register scanner) instead of duplicating logic.
// Gated behind SD.config.plan === 'premium', same mechanism as BloomCollect.
// ═══════════════════════════════════════════════════════════════════════

// ── HuggingFace Qwen2.5-VL — cascade fallback when Groq fails ────────────
// Same prompt, different model. No key needed for free tier (rate-limited).
// With hfApiKey set in portal admin settings, limits are higher.
async function _callHFGenericVision(base64, mimeType, prompt) {
  const HF_URL = 'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-VL-7B-Instruct/v1/chat/completions';
  const hfKey  = getHFKey ? getHFKey() : (window.HF_API_KEY || '');
  const hdrs   = { 'Content-Type': 'application/json' };
  if (hfKey) hdrs['Authorization'] = 'Bearer ' + hfKey;
  const body = JSON.stringify({
    model: 'Qwen/Qwen2.5-VL-7B-Instruct',
    max_tokens: 4096, temperature: 0.1,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
      { type: 'text', text: prompt }
    ]}]
  });
  let resp = await fetch(HF_URL, { method: 'POST', headers: hdrs, body });
  // Handle cold start (model loading)
  if (resp.status === 503) {
    const errData = await resp.json().catch(() => ({}));
    const wait = Math.min((errData.estimated_time || 20) * 1000, 35000);
    console.log('[HF] Cold start — waiting', Math.round(wait / 1000) + 's');
    await new Promise(r => setTimeout(r, wait));
    resp = await fetch(HF_URL, { method: 'POST', headers: hdrs, body });
  }
  if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error('HuggingFace ' + resp.status + ': ' + (err.error?.message || '')); }
  const data = await resp.json();
  let raw = (data.choices?.[0]?.message?.content || '').trim();
  raw = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/gi, '').trim();
  window._lastHFRaw = raw;
  try { return JSON.parse(raw); } catch(e) {}
  const extracted = _extractJSONObject(raw);
  if (extracted) { try { return JSON.parse(extracted); } catch(e) {} }
  throw new Error('HuggingFace: could not parse response');
}

// ── OCR Cascade — Groq → HuggingFace ─────────────────────────────────────
// Tries each engine in order. First with a parseable result wins.
// onProgress(msg) is called with a status string as each engine is attempted.
// This is the same pattern as bloom-agent's buildLedgerCascade — first
// engine wins, next tried only on failure, surfacing per-field retry only
// when ALL engines have failed.
async function _callScanCascade(base64, mimeType, prompt, onProgress) {
  // ── Engine 1: Groq ───────────────────────────────────────────────────────
  if (onProgress) onProgress('📸 Reading with Groq…');
  try {
    const groqKey = await _getFeeGroqKey();
    if (groqKey) {
      const result = await _callGroqGenericVision(groqKey, base64, mimeType, prompt, 4096);
      if (result) return { result, provider: 'Groq' };
    }
  } catch(e) { console.warn('[OCR Cascade] Groq:', e.message); }

  // ── Engine 2: HuggingFace Qwen2.5-VL ────────────────────────────────────
  if (onProgress) onProgress('⚡ Groq busy — trying HuggingFace Qwen…');
  try {
    const result = await _callHFGenericVision(base64, mimeType, prompt);
    if (result) return { result, provider: 'HuggingFace' };
  } catch(e) { console.warn('[OCR Cascade] HuggingFace:', e.message); }

  // ── All providers failed ─────────────────────────────────────────────────
  throw new Error('All OCR providers failed — use the 📷 retry buttons below for each missing field, or type values manually.');
}

// ── Brace-matching JSON extractor — more robust than regex ─────────────
// Handles explanation text before/after JSON, nested objects, etc.
function _extractJSONObject(text) {
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function _callGroqGenericVision(apiKey, base64, mimeType, userPrompt, maxTokens, _retry) {
  if (_retry === undefined) _retry = 0;
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'qwen/qwen3.6-27b',
      max_tokens: maxTokens || 4096,
      temperature: 0,
      reasoning_format: 'hidden',
      messages: [
        {
          role: 'system',
          content: 'You are a JSON data extraction tool. Your output must be ONLY a valid JSON object — no explanations, no introductions, no markdown, no text of any kind outside the JSON. If you cannot determine a value, use null or "UNCLEAR" as specified in the prompt. You must always output the JSON object even if the image quality is poor.'
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
            { type: 'text', text: userPrompt }
          ]
        }
      ]
    })
  });

  if (resp.status === 429 || resp.status === 503 || resp.status === 529) {
    if (_retry >= 3) throw new Error('Groq rate-limited after multiple retries — try again shortly.');
    const retryAfter = resp.headers.get('retry-after');
    let waitMs = parseFloat(retryAfter) * 1000;
    if (!waitMs || isNaN(waitMs)) waitMs = 15000;
    waitMs = Math.min(Math.max(waitMs, 3000), 60000);
    await new Promise(r => setTimeout(r, waitMs));
    return _callGroqGenericVision(apiKey, base64, mimeType, userPrompt, maxTokens, _retry + 1);
  }
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('Groq ' + resp.status + ': ' + err.slice(0, 200));
  }

  const data = await resp.json();
  let raw = (data.choices?.[0]?.message?.content || '').trim();

  // Strip reasoning blocks if any leaked through
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip markdown fences
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Store for debugging (inspect via window._lastGroqRaw in browser console)
  window._lastGroqRaw = raw;

  // Attempt 1: parse directly
  try { return JSON.parse(raw); } catch(e) {}

  // Attempt 2: extract the outermost JSON object by brace-matching
  const jsonStr = _extractJSONObject(raw);
  if (jsonStr) { try { return JSON.parse(jsonStr); } catch(e) {} }

  // Attempt 3: fix common Groq formatting issues then parse
  if (jsonStr) {
    try {
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')   // trailing commas
        .replace(/:\s*undefined/g, ':null'); // undefined values
      return JSON.parse(fixed);
    } catch(e) {}
  }

  console.error('[EduBloom] Groq parse failed. Raw response (first 400 chars):', raw.slice(0, 400));
  throw new Error('Could not read document. Tap console (F12) to see what Groq returned, or try a clearer photo.');
}

// _OCR_DISCIPLINE kept as alias for backward compatibility with _buildRetryPrompt
const _OCR_DISCIPLINE = OCR_CORE_DISCIPLINE;

function _isPremium() { return true; /* TEMP BYPASS - matches production School-Bloom, Bayo verifying premium features across both. Do not restore until he confirms. */ }
// ── Premium gate for scan buttons ─────────────────────────────────────────
function _gateScan(prefix, scanInputId) {
  if (_isPremium()) { return true; }
  const nudge = $(prefix + '-premium-nudge');
  const scan = $(prefix + '-premium-scan');
  if (nudge) { nudge.style.display = 'block'; }
  if (scan) { scan.style.display = 'none'; }
  toast('⭐ Premium feature — upgrade to scan');
  return false;
}

function _gateScanFn(prefix) {
  return function() { return _gateScan(prefix, prefix + '-scan-input'); };
}


// Parses common Nigerian D/M/YY or D/M/YYYY date text into YYYY-MM-DD
function _parseNigerianDate(raw) {
  const m = String(raw).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// ── 1. Expense receipt scan ─────────────────────────────────────────────
async function scanExpenseReceipt(event) {
  if (!_isPremium()) { _gateScan('exp'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('exp-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.textContent = m; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading receipt...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const prompt = `You are reading a photograph of a Nigerian school expense receipt or payment teller/slip.
Extract:
  vendor      = the shop/vendor/payee name written on the receipt (text)
  description = a short 3-8 word description of what was purchased or paid for
  amount      = the TOTAL amount paid (integer, Naira)
  date        = the date on the receipt if visible (raw text as written, e.g. "12/5/26")
  category    = your single best guess, ONE of exactly: Staff Salaries, Utilities (NEPA/Generator), Building Maintenance, Teaching Materials, Government/Ministry Fees, Cleaning & Security, Transport, Examination Fees, Other
${_OCR_DISCIPLINE}
Output ONLY: {"vendor":"","description":"","amount":0,"date":"","category":""}`;
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, prompt, 500);
    if (fb) fb.style.display = 'none';
    const descParts = [result.vendor, result.description].filter(v => v && v !== 'UNCLEAR');
    if ($('exp-desc')) $('exp-desc').value = descParts.join(' — ');
    if ($('exp-amt') && result.amount && result.amount !== 'UNCLEAR') $('exp-amt').value = result.amount;
    const catSel = $('exp-cat');
    if (catSel && result.category && result.category !== 'UNCLEAR') {
      const opt = [...catSel.options].find(o => o.value === result.category);
      if (opt) catSel.value = result.category;
    }
    show('✅ Filled from receipt — please verify before saving.');
    setTimeout(() => { if (fb) fb.style.display = 'none'; }, 4000);
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read receipt. Try a clearer photo.'));
  }
}

// ── 2. Payment teller/receipt scan ──────────────────────────────────────
async function scanPaymentReceipt(event, idx) {
  if (!_isPremium()) { toast('⭐ Premium feature — upgrade to scan receipts'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('pay-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.textContent = m; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading payment slip...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const prompt = `You are reading a photograph of a Nigerian bank payment teller, POS slip, transfer receipt, or cash receipt for a school fee payment.
Extract ALL of the following:
  amount    = the amount paid (integer, Naira). Look for "AMOUNT", "N", "₦", or the largest numeric value. Common formats: 25,000 / 25000 / 25.000 all mean 25000.
  date      = the date on the slip if visible (raw text as written, e.g. "12/5/26", "8th June 2026")
  method    = your best guess, ONE of exactly: Bank Transfer, Cash, POS, Online — based on what kind of document this looks like
  payer     = the name of the person who made the payment, if visible (text). Look near "FROM", "DEPOSITOR", "REMITTER", "CUSTOMER", "PAID BY".
  recipient = the school or account name receiving the payment, if visible (text). Look near "TO", "BENEFICIARY", "ACCOUNT NAME".
  reference = the transaction reference, teller number, or session ID, if visible (text). Look near "REF", "TELLER NO", "SESSION ID", "RRR", "TRANS ID".
  account_no = the destination account number if visible (10-digit NUBAN, digits only)

${_OCR_DISCIPLINE}
Output ONLY: {"amount":0,"date":"","method":"","payer":"","recipient":"","reference":"","account_no":""}`;
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, prompt, 500);
    if (fb) fb.style.display = 'none';
    if ($('pay-amt') && result.amount && result.amount !== 'UNCLEAR') $('pay-amt').value = result.amount;
    if ($('pay-date') && result.date && result.date !== 'UNCLEAR') {
      const parsed = _parseNigerianDate(result.date);
      if (parsed) $('pay-date').value = parsed;
    }
    const methodSel = $('pay-method');
    if (methodSel && result.method && result.method !== 'UNCLEAR') {
      const opt = [...methodSel.options].find(o => o.value === result.method);
      if (opt) methodSel.value = result.method;
    }
    const extra = [];
    if (result.payer && result.payer !== 'UNCLEAR') extra.push('Payer: ' + result.payer);
    if (result.reference && result.reference !== 'UNCLEAR') extra.push('Ref: ' + result.reference);
    const msg = extra.length ? '✅ Filled from receipt — ' + extra.join(' · ') + '. Please verify before saving.' : '✅ Filled from receipt — please verify before saving.';
    show(msg);
    setTimeout(() => { if (fb) fb.style.display = 'none'; }, 6000);
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read receipt. Try a clearer photo.'));
  }
}

// ── Universal student info prompt — reads ANY document format ────────────
// Tells Groq what DATA to find, not what FORMAT to expect. Handles formal
// admission forms, handwritten notebook pages, register tables, ID cards,
// WhatsApp screenshots — all without any format assumptions.
const _STUDENT_INFO_PROMPT = buildOcrPrompt('student_info');

// ── Targeted retry prompts — one per field ────────────────────────────────
// Used when the first scan misses a specific field. Narrower focus = better hit rate.
function _buildRetryPrompt(fieldKey) {
  const discipline = `Do NOT guess. If you cannot clearly see it, output UNCLEAR. Output ONLY valid JSON.`;
  const map = {
    name:         `Look ONLY for a Nigerian student's full name. Nigerian names: Yoruba (Adeoye, Ogunsola), Hausa (Musa, Aisha), Igbo (Emeka, Chioma). Could be under "Name:", "Student:", or in a column "Names". ${discipline} Output ONLY: {"name":""}`,
    parent_phone: `Look ONLY for a Nigerian phone number. Starts with 07, 08, or 09 (11 digits, e.g. 07085369494) or +234. Could be near "Phone:", "WhatsApp:", "Tel:", "Parent:", or column "Phone No". ${discipline} Output ONLY: {"parent_phone":""}`,
    class:        `Look ONLY for a student's class or grade. Nigerian classes: Basic 1-6, Primary 1-6, JSS 1-3, SSS 1-3, Nursery 1-2, KG. Could be near "Class:", "Form:", "Grade:", or column "Class". ${discipline} Output ONLY: {"class":""}`,
    fee:          `Look ONLY for a school fee amount in Naira. Near "Fee:", "Amount:", "School Fee:", "Termly Fee:", ₦ symbol, or column "Fee". Return as integer only (e.g. 36000). ${discipline} Output ONLY: {"fee":null}`,
    dob:          `Look ONLY for a date of birth. Near "D.O.B", "Date of Birth", "Born:", "DOB:". Return raw date text exactly as written. ${discipline} Output ONLY: {"dob":""}`,
  };
  return map[fieldKey] || '';
}

// ── Field maps: scan result key → HTML input ID ───────────────────────────
const _SCAN_MAP_ADD  = { name:'ns-name', parent_phone:'ns-phone', class:'ns-class', fee:'ns-fee', dob:'ns-dob' };
const _SCAN_MAP_EDIT = { name:'edit-s-name', parent_phone:'edit-s-phone', class:'edit-s-class', fee:'edit-s-fee', dob:'edit-s-dob' };

// ── Fill form inputs from scan result, return what was found vs unclear ───
function _fillStudentFromResult(result, fieldMap) {
  const found = [], unclear = [];
  const r = result || {};
  const ok = (v) => v && v !== 'UNCLEAR' && v !== null;

  if (fieldMap.name) {
    if (ok(r.name)) { $(fieldMap.name).value = r.name; found.push('name'); }
    else unclear.push('name');
  }
  if (fieldMap.parent_phone) {
    if (ok(r.parent_phone)) { $(fieldMap.parent_phone).value = r.parent_phone.replace(/\D/g,''); found.push('phone'); }
    else unclear.push('phone');
  }
  if (fieldMap.class) {
    if (ok(r.class)) {
      const el = $(fieldMap.class);
      const opt = el ? [...el.options].find(o => o.value.toLowerCase() === r.class.toLowerCase()) : null;
      if (opt) { el.value = opt.value; found.push('class'); } else unclear.push('class');
    } else unclear.push('class');
  }
  if (fieldMap.fee) {
    if (ok(r.fee) && Number(r.fee) > 0) { $(fieldMap.fee).value = Number(r.fee); found.push('fee'); }
    else unclear.push('fee');
  }
  if (fieldMap.dob) {
    if (ok(r.dob)) {
      const parsed = _parseNigerianDate(r.dob);
      if (parsed) { $(fieldMap.dob).value = parsed; found.push('dob'); }
      else unclear.push('dob');
    } else unclear.push('dob');
  }
  return { found, unclear };
}

// ── Render field-by-field scan feedback with per-field retry buttons ──────
function _renderScanFeedback(fbEl, found, unclear, fieldMap, fbElId) {
  if (!fbEl) return;
  fbEl.style.display = 'block';
  const labels = { name:'Name', parent_phone:'Phone', class:'Class', fee:'Fee', dob:'DOB' };
  const mapJson = encodeURIComponent(JSON.stringify(fieldMap));
  let html = '';
  if (found.length)
    html += `<div style="color:#22c55e;font-size:0.76rem;margin-bottom:0.25rem;">✅ Filled: ${found.join(', ')}</div>`;
  if (unclear.length) {
    html += `<div style="font-size:0.76rem;color:#f59e0b;margin-bottom:0.15rem;">⚠️ Not found — retry or type manually:</div>`;
    unclear.forEach(f => {
      const key = f === 'phone' ? 'parent_phone' : f;
      html += `<div style="display:flex;align-items:center;gap:0.35rem;margin-bottom:0.2rem;">
        <span style="font-size:0.75rem;color:var(--sub);min-width:40px;">${labels[key]||f}</span>
        <button onclick="_triggerRetryField('${key}','${mapJson}','${fbElId}')"
          style="font-size:0.68rem;padding:2px 8px;border-radius:5px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.35);color:#a78bfa;cursor:pointer;">📷 Retry</button>
      </div>`;
    });
  }
  if (!found.length && !unclear.length)
    html = '<span style="color:var(--danger);font-size:0.76rem;">❌ Nothing found. Try a clearer, flatter photo.</span>';
  fbEl.innerHTML = html;
}

// ── Trigger a targeted retry scan for one missing field ───────────────────
function _triggerRetryField(fieldKey, mapJson, fbElId) {
  let inp = document.getElementById('_retry-field-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.id = '_retry-field-input'; inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.onchange = (e) => _doRetryField(e, fieldKey, mapJson, fbElId);
  inp.click();
}

async function _doRetryField(event, fieldKey, mapJson, fbElId) {
  const file = event.target.files[0]; if (!file) return;
  const fb = document.getElementById(fbElId);
  const note = m => { if (fb) fb.innerHTML += `<div style="font-size:0.75rem;color:var(--sub);margin-top:0.2rem;">${m}</div>`; };
  note('📸 Scanning for ' + fieldKey + '...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey(); if (!key) { note('❌ Groq key not found.'); return; }
    const prompt = _buildRetryPrompt(fieldKey); if (!prompt) { note('❌ Unknown field.'); return; }
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, prompt, 4096);
    const fieldMap = JSON.parse(decodeURIComponent(mapJson));
    const value = result[fieldKey];
    const el = fieldMap[fieldKey] ? $(fieldMap[fieldKey]) : null;
    if (!value || value === 'UNCLEAR' || !el) {
      note(`<span style="color:#f59e0b;">Still couldn't read ${fieldKey} — please type it manually.</span>`);
      return;
    }
    if (fieldKey === 'parent_phone') el.value = value.replace(/\D/g,'');
    else if (fieldKey === 'fee') { if (Number(value) > 0) el.value = Number(value); }
    else if (fieldKey === 'dob') { const p = _parseNigerianDate(value); if (p) el.value = p; }
    else if (fieldKey === 'class') {
      const opt = [...el.options].find(o => o.value.toLowerCase() === value.toLowerCase());
      if (opt) el.value = opt.value;
    }
    else el.value = value;
    note(`<span style="color:#22c55e;">✅ ${fieldKey} filled!</span>`);
  } catch(e) { note('❌ Retry failed — try typing manually.'); }
}

// ── 3. Student admission scan — universal, any document format ────────────
async function scanStudentForm(event) {
  if (!_isPremium()) { _gateScan('ns'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('ns-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.innerHTML = `<span style="font-size:0.76rem;color:var(--sub);">${m}</span>`; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading document...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, _STUDENT_INFO_PROMPT, 4096);
    const { found, unclear } = _fillStudentFromResult(result, _SCAN_MAP_ADD);
    _renderScanFeedback(fb, found, unclear, _SCAN_MAP_ADD, 'ns-scan-fb');
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read document. Try a clearer photo.'));
  }
}

// ── 3b. Scan to fill missing fields on existing student (Edit modal) ─────
async function scanStudentFormEdit(idx, event) {
  if (!_isPremium()) { _gateScan('ns'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('edit-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.innerHTML = `<span style="font-size:0.76rem;color:var(--sub);">${m}</span>`; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading document...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, _STUDENT_INFO_PROMPT, 4096);
    const { found, unclear } = _fillStudentFromResult(result, _SCAN_MAP_EDIT);
    _renderScanFeedback(fb, found, unclear, _SCAN_MAP_EDIT, 'edit-scan-fb');
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read document. Try a clearer photo.'));
  }
}

// ── 4. Staff ID/CV scan ──────────────────────────────────────────────────
// Deliberately does NOT touch the password field — a scanned photo should
// never generate or guess a login credential.
async function scanStaffID(event) {
  if (!_isPremium()) { _gateScan('sf'); return; }
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  const fb = document.getElementById('sf-scan-fb');
  const show = m => { if (fb) { fb.style.display = 'block'; fb.textContent = m; } };
  if (!navigator.onLine) { show('❌ No internet connection.'); return; }
  show('📸 Reading staff ID/CV...');
  try {
    const resized = await _resizeFeeImage(file, 800);
    const key = await _getFeeGroqKey();
    if (!key) { show('❌ Groq key not found — ask Bayo to add it in portal settings.'); return; }
    const prompt = `You are reading a photograph of a staff ID card or CV/resume for a Nigerian school employee.
Extract ALL of the following:
  name  = the staff member's full name (text). Look near "NAME", "FULL NAME", "STAFF NAME". Nigerian names: Yoruba (Adeoye, Ogunsola, Olatunde), Hausa (Musa, Abdullahi), Igbo (Emeka, Chioma).
  email = an email address if visible (text)
  role  = the job title or position, if stated (text). Look near "POSITION", "ROLE", "DESIGNATION", "TITLE". Common Nigerian school roles: Teacher, Bursar, Head Teacher, Vice Principal, Admin, Sports Coach, Arts Teacher, Music Teacher.
  phone = a phone number if visible (digits only). Look near "PHONE", "TEL", "MOBILE", "CONTACT".

${_OCR_DISCIPLINE}
Output ONLY: {"name":"","email":"","role":"","phone":""}`;
    const result = await _callGroqGenericVision(key, resized.base64, resized.mimeType, prompt, 4096);
    if (fb) fb.style.display = 'none';
    if ($('sf-name') && result.name && result.name !== 'UNCLEAR') $('sf-name').value = result.name;
    if ($('sf-email') && result.email && result.email !== 'UNCLEAR') $('sf-email').value = result.email;
    const roleSel = $('sf-role');
    if (roleSel && result.role && result.role !== 'UNCLEAR') {
      const opt = [...roleSel.options].find(o => o.value.toLowerCase() === String(result.role).toLowerCase()
        || o.value.toLowerCase().includes(String(result.role).toLowerCase())
        || String(result.role).toLowerCase().includes(o.value.toLowerCase()));
      if (opt) roleSel.value = opt.value;
    }
    const extra6 = [];
    if (result.phone && result.phone !== 'UNCLEAR') extra6.push('Phone: ' + result.phone);
    if (result.role && result.role !== 'UNCLEAR' && !roleSel?.value?.toLowerCase().includes(String(result.role).toLowerCase())) extra6.push('Role: ' + result.role);
    const msg6 = extra6.length ? '✅ Filled from ID — ' + extra6.join(' · ') + '. Set a password before saving.' : '✅ Filled from ID — please verify name/email and set a password before saving.';
    show(msg6);
    setTimeout(() => { if (fb) fb.style.display = 'none'; }, 6000);
  } catch(e) {
    show('❌ ' + (e.message || 'Could not read ID. Try a clearer photo.'));
  }
}

// ── 4. Groq Vision call with Nigerian fee ledger system prompt ────────
async function _callGroqFeeVision(apiKey, base64, mimeType) {
  const prompt = buildOcrPrompt('fee_ledger');
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'qwen/qwen3.6-27b',
      max_tokens: 4096,
      temperature: 0.1,
      reasoning_format: 'hidden',
      messages: [
        {
          role: 'system',
          content: 'You are a JSON data extraction tool. Output ONLY valid JSON — no markdown, no explanation text, no fences. If you cannot read a value, use null.'
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
            { type: 'text', text: prompt }
          ]
        }
      ]
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('Groq ' + resp.status + ': ' + err.slice(0, 200));
  }
  const data = await resp.json();
  let raw = (data.choices?.[0]?.message?.content || '').trim();
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  window._lastGroqRaw = raw;
  try { return JSON.parse(raw); } catch(e) {}
  const extracted = _extractJSONObject(raw);
  if (extracted) { try { return JSON.parse(extracted); } catch(e) {} }
  throw new Error('Could not parse fee register response. Try a clearer, straighter photo of the register.');
}

// ── 5. Show review modal before importing ─────────────────────────────
function _showFeeImportReview(data) {
  const students = data.students || [];
  if (!students.length) {
    alert('No student records found. Try a closer, well-lit photo with the register page flat.');
    return;
  }

  // Fuzzy name match against existing SD.students
  function matchStudent(surname, firstname) {
    const query = ((surname || '') + ' ' + (firstname || '')).toLowerCase().replace(/[^a-z\s]/g, '');
    const words = query.split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return null;
    let best = null, bestScore = 0;
    SD.students.forEach((s, idx) => {
      const sn = (s.name || '').toLowerCase().replace(/[^a-z\s]/g, '');
      const sw = sn.split(/\s+/).filter(w => w.length > 1);
      let shared = 0;
      words.forEach(w => { if (sw.some(v => v === w || v.startsWith(w) || w.startsWith(v))) shared++; });
      const score = shared / Math.max(words.length, sw.length, 1);
      if (score > bestScore) { bestScore = score; best = { idx, name: s.name }; }
    });
    return bestScore >= 0.35 ? best : null;
  }

  const matched = students.map(s => ({ ...s, _match: matchStudent(s.surname, s.firstname) }));
  const matchCount = matched.filter(s => s._match).length;

  // Remove existing modal if any
  document.getElementById('_fee_import_modal')?.remove();

  const modal = document.createElement('div');
  modal.id = '_fee_import_modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9998;overflow-y:auto;padding:1rem 0;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--s1);border-radius:14px;padding:1rem;max-width:580px;margin:0 auto;border:1px solid var(--border);';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;gap:0.5rem;';
  hdr.innerHTML =
    '<div><div style="font-weight:800;font-size:1rem;color:var(--text);">📋 Review Scanned Register</div>' +
    '<div style="font-size:0.75rem;color:var(--sub);margin-top:3px;">' +
    'Class: <b style="color:var(--text);">' + esc(data.class||'—') + '</b> · ' +
    'Term: <b style="color:var(--text);">' + esc(data.term||'—') + '</b> · ' +
    'Year: <b style="color:var(--text);">' + esc(data.year||'—') + '</b><br>' +
    matchCount + ' of ' + students.length + ' students matched to existing records</div></div>' +
    '<button onclick="document.getElementById(\'_fee_import_modal\').remove()" ' +
    'style="background:none;border:none;color:var(--sub);font-size:1.4rem;cursor:pointer;padding:0;line-height:1;">✕</button>';
  box.appendChild(hdr);

  // Student rows
  const rowsDiv = document.createElement('div');
  matched.forEach((s, i) => {
    const m = s._match;
    const fullName = [s.surname, s.firstname].filter(Boolean).join(' ');
    const statusColor = s.status === 'FULLY PAID' ? '#22c55e' : s.status === 'No Payment' ? '#ef4444' : '#f59e0b';
    const totalPaid = (s.pmt1||0) + (s.pmt2||0) + (s.pmt3||0);

    const row = document.createElement('div');
    row.style.cssText = 'background:' + (i%2===0?'var(--s2)':'var(--s1)') + ';border:1px solid ' + (m?'var(--border)':'rgba(239,68,68,0.3)') + ';border-radius:8px;padding:0.55rem 0.7rem;margin-bottom:0.35rem;';
    row.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">' +
        '<div style="font-weight:700;font-size:0.86rem;">' + s.sn + '. ' + esc(fullName) + '</div>' +
        '<span style="font-size:0.72rem;font-weight:700;color:' + statusColor + ';">' + esc(s.status||'—') + '</span>' +
      '</div>' +
      '<div style="font-size:0.71rem;margin-top:2px;color:' + (m?'#60a5fa':'#ef4444') + ';">' +
        (m ? '✅ Matches: <b>' + esc(m.name) + '</b>' : '⚠️ No match — will be skipped') +
      '</div>' +
      (totalPaid ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;font-size:0.69rem;color:var(--sub);">' +
        (s.pmt1 ? '<span>1st: <b style="color:var(--money);">₦' + Number(s.pmt1).toLocaleString('en-NG') + '</b>' + (s.date1?' ('+s.date1+')':'') + '</span>' : '') +
        (s.pmt2 ? '<span>2nd: <b style="color:var(--money);">₦' + Number(s.pmt2).toLocaleString('en-NG') + '</b>' + (s.date2?' ('+s.date2+')':'') + '</span>' : '') +
        (s.pmt3 ? '<span>3rd: <b style="color:var(--money);">₦' + Number(s.pmt3).toLocaleString('en-NG') + '</b>' + (s.date3?' ('+s.date3+')':'') + '</span>' : '') +
        '<span>Total: <b style="color:var(--money);">₦' + totalPaid.toLocaleString('en-NG') + '</b></span>' +
        '</div>' : '');
    rowsDiv.appendChild(row);
  });
  box.appendChild(rowsDiv);

  // Footer buttons
  const ftr = document.createElement('div');
  ftr.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.75rem;';

  const importBtn = document.createElement('button');
  importBtn.className = 'btn-brand';
  importBtn.style.cssText = 'flex:1;';
  importBtn.textContent = '✅ Import ' + matchCount + ' Matched Records';
  importBtn.onclick = () => _confirmFeeImport(matched);
  ftr.appendChild(importBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-ghost';
  cancelBtn.style.cssText = 'flex:0 0 auto;';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => modal.remove();
  ftr.appendChild(cancelBtn);

  box.appendChild(ftr);
  modal.appendChild(box);
  // Close on backdrop tap
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ── 6. Confirm and apply the import ──────────────────────────────────
async function _confirmFeeImport(matched) {
  let importedEntries = 0, skippedStudents = 0;
  const today = new Date().toISOString().split('T')[0];

  matched.forEach(s => {
    if (!s._match) { skippedStudents++; return; }
    const student = SD.students[s._match.idx];
    if (!student) { skippedStudents++; return; }

    // Set totalFee from register if student has none yet
    if (s.term_fees && !student.totalFee) student.totalFee = s.term_fees;

    // Ensure paymentHistory array exists
    if (!student.paymentHistory) student.paymentHistory = [];

    // Import each payment instalment
    const payments = [
      [s.pmt1, s.date1, '1st instalment'],
      [s.pmt2, s.date2, '2nd instalment'],
      [s.pmt3, s.date3, '3rd instalment']
    ];

    payments.forEach(([amt, rawDate, label]) => {
      if (!amt || amt <= 0) return;
      // Parse D/M/YY date to YYYY-MM-DD
      let dateStr = today;
      if (rawDate) {
        const parts = rawDate.split('/');
        if (parts.length === 3) {
          const yr = parts[2].length === 2 ? '20' + parts[2] : parts[2];
          const mo = parts[1].padStart(2, '0');
          const dy = parts[0].padStart(2, '0');
          dateStr = yr + '-' + mo + '-' + dy;
        }
      }
      // Dedup: skip if identical amount+date already exists
      const dup = student.paymentHistory.some(p => p.amount === amt && p.date === dateStr);
      if (dup) return;

      student.paid = (student.paid || 0) + amt;
      student.paymentHistory.unshift({
        amount: amt,
        method: 'Register Scan',
        date: dateStr,
        by: 'Fee Register OCR'
      });
      importedEntries++;
    });
  });

  await SQ.push('students', SD.students);
  checkTierStatus();
  document.getElementById('_fee_import_modal')?.remove();
  renderRevenue();
  renderStudentList();

  alert(
    '✅ Import complete!\n\n' +
    importedEntries + ' payment entries added\n' +
    skippedStudents + ' students skipped (no name match)\n\n' +
    'Open individual student profiles to verify.'
  );
}



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
    hydrateFromV2(auth.schoolId).catch(() => {}); // non-blocking — offline-first startup shouldn't wait on this
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

  // ── Shared AI text caller — now Groq (was Gemini). Same signature/contract
  // so all callers below (_gemini(...)) keep working unchanged.
  async _gemini(prompt, maxTokens = 512) {
    const key = getGroqKey();
    if (!key) return null;
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.choices?.[0]?.message?.content || '';
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

    // AI insight — only if Groq key set
    const key = getGroqKey();
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
    // SD.attendance structure: { date: { studentName: 'Present'|'Absent'|'Late' } }
    const absentStreaks = [];
    const allDates = Object.keys(attData).sort().slice(-7); // last 7 recorded dates
    students.forEach(s => {
      let streak = 0;
      for (let i = allDates.length - 1; i >= 0; i--) {
        const status = attData[allDates[i]]?.[s.name];
        if (status === 'Absent' || status === 'A') streak++;
        else break;
      }
      if (streak >= 3) absentStreaks.push({ name: s.name, class: s.class, streak });
    });

    // Students with no scores at all this term
    // SD.scores structure: { 'Term 1': { studentId: { subject: {ca1,ca2,ca3,exam} } } }
    const term = SD.config?.currentTerm || 'Term 1';
    const noScores = students.filter(s => {
      const termScores = (SD.scores?.[term]||{})[s.id];
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

  // Auto-draft teacher remarks for a student using Groq
  async draftRemark(studentName, scores, className) {
    const key = getGroqKey();
    if (!key) { toast('⚠️ Add Groq key in Settings for AI remarks.'); return; }
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
    const key = getGroqKey();
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
  // students using Groq AI. Stores in SD.remarks for printReportCard to use.
  // ════════════════════════════════════════════════════════════════════════
  async runReportCardAgent(term, onProgress) {
    const students = SD.students || [];
    const subs = SD.config && SD.config.subjects ? SD.config.subjects : ["English Language","Mathematics","Basic Science"];
    const schoolName = (SD.config && SD.config.schoolName) ? SD.config.schoolName : "Our School";
    const key = getGroqKey();

    if (!key) {
      toast("Add Groq API key in Settings to generate AI remarks.");
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
        // Backoff on rate limit (429) to avoid storm of failing requests
        if (e.message && (e.message.includes('429') || e.message.includes('rate'))) {
          await new Promise(function(r){ setTimeout(r, 5000); });
        }
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
