// ── Firebase ───────────────────────────────────────────────────────────────
const FB={apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",authDomain:"educationbloom-699ed.firebaseapp.com",projectId:"educationbloom-699ed",storageBucket:"educationbloom-699ed.firebasestorage.app",messagingSenderId:"33750392965",appId:"1:33750392965:web:2b3da887ede996ea8389ec"};
let db=null;
try{
  // If already initialized (e.g. hot reload), reuse existing app
  const fbApp=firebase.apps.length?firebase.app():firebase.initializeApp(FB);
  db=firebase.firestore(fbApp);
  console.log('✅ Firebase ready');
}catch(e){console.error('❌ Firebase init failed:',e.message);}

// ── Gemini Flash OCR (Structured Outputs) ─────────────────────────────────
// Model: gemini-2.0-flash | Free tier via Google AI Studio
// Strict JSON schema prevents hallucinations — no phantom names
// Key stored encoded; managed via AariNAT Command Center Settings
const GEMINI_KEY  = atob('QVEuQWI4Uk42SWE4WjVNNmNVMkh2WkV1NGMyRF9TdnVEZWlDOE16ZmgyYkY2X1lsM0UxVGc=');
// Try these models in order — newer ones first, fall back if unavailable
const GEMINI_MODELS = ['gemini-2.0-flash','gemini-2.0-flash-exp','gemini-1.5-flash','gemini-1.5-flash-latest'];

const GEMINI_PROMPT = `Extract every student name from this Nigerian school register photo.
Nigerian format: SURNAME FIRSTNAME (e.g. DADA Moses, GBELEKALE Aminat, KASALI Rasaq).
Rules:
- Image may be rotated any direction — read correctly regardless of orientation
- Ignore serial numbers, fee amounts, BALANCE, CLASS headers, dates, totals
- Include ALL names visible even if handwriting is unclear — make your best attempt
- Common Nigerian surnames: Oliyide, Gbelekale, Ogunlade, Kasali, Alawode, Shonpe, Lawal, Ogunsola, Dada, Idowu, Awolowo, Adebayo, Akinola, Oyesanwo
Return ONLY the JSON object.`;

const GEMINI_SCHEMA = {
  type:'OBJECT',
  properties:{
    students:{
      type:'ARRAY',
      items:{
        type:'OBJECT',
        properties:{
          surname:  {type:'STRING'},
          firstname:{type:'STRING'},
          fullName: {type:'STRING'}
        },
        required:['surname','firstname','fullName']
      }
    }
  },
  required:['students']
};

async function geminiOCR(base64, mime){
  let lastError = null;
  for(const model of GEMINI_MODELS){
    try{
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
      const r = await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contents:[{parts:[
            {inline_data:{mime_type:mime,data:base64}},
            {text:GEMINI_PROMPT}
          ]}],
          generationConfig:{
            response_mime_type:'application/json',
            response_schema:GEMINI_SCHEMA
          }
        })
      });
      const d = await r.json();
      if(d.error){
        lastError = d.error.message||'Gemini error';
        // 404 = model not found — try next
        if(d.error.code===404||d.error.status==='NOT_FOUND') continue;
        throw new Error(lastError);
      }
      const raw = d.candidates?.[0]?.content?.parts?.[0]?.text||'{"students":[]}';
      const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
      const students = parsed.students||[];
      console.log(`✅ Gemini OCR (${model}): ${students.length} names`);
      return students;
    }catch(e){
      lastError = e.message;
      console.warn(`Gemini ${model} failed:`, e.message);
    }
  }
  throw new Error('All Gemini models failed: ' + lastError);
}


// ── Claude Vision OCR ─────────────────────────────────────────────────────
// Set this key to activate Claude Vision for handwritten register OCR.
// Get from: console.anthropic.com → API Keys
// Without it, falls back to OCR.space free tier then Tesseract.
const ANTHROPIC_KEY = ''; // 'sk-ant-...'
const OCR_MODEL = 'claude-haiku-4-5-20251001';

async function claudeVisionOCR(base64, mediaType) {
  const headers = { 'Content-Type': 'application/json' };
  if (ANTHROPIC_KEY) headers['x-api-key'] = ANTHROPIC_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: OCR_MODEL, max_tokens: 2000,
      system: `You are an OCR specialist for Nigerian handwritten school registers.
Extract ONLY student names. Rules:
- Image may be rotated any direction — read correctly regardless
- Nigerian surname often FIRST (e.g. DADA Aishat = fullName "Dada Aishat")
- Ignore serial numbers, dates, fee amounts, column headers
- Nigerian names: Yoruba (Olayiwola, Gbelekale), Hausa (Zainab, Rasaq), Igbo (Chisom), English (Dominion, Gold)
- Read EVERY name — do not skip unclear ones
- Return names top to bottom as they appear
Return ONLY valid JSON array: [{"surname":"DADA","firstname":"Aishat","fullName":"Dada Aishat"},...]
If no names found: []`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Extract all student names from this school register photo.' }
        ]
      }]
    })
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text || '[]';
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return []; }
}


// ── State ──────────────────────────────────────────────────────────────────
let schoolId=null,userRole=null,currentStaff=null;

// ── Login Step 2: Who are you? ────────────────────────────────────────────
// All HTML is pre-rendered in index.html — we just show/hide it.
// Never replace innerHTML here — Android keyboard won't trigger on dynamic inputs.
function showStaffLoginStep(){
  const loginDiv=$('login');
  if(loginDiv) loginDiv.style.display='none';
  const staffDiv=$('staff-login');
  if(!staffDiv){ console.error('❌ #staff-login not found in HTML'); return; }
  staffDiv.style.display='flex';
  const nameEl=$('sl-school-name');
  if(nameEl) nameEl.textContent=SD.config?.schoolName||'Educational Bloom';
  slSetTab('principal');
}

function slSetTab(tab){
  const isPrincipal=tab==='principal';
  const pp=$('sl-panel-p'),ps=$('sl-panel-s');
  const tp=$('sl-tab-p'),ts=$('sl-tab-s');
  if(pp) pp.style.display=isPrincipal?'block':'none';
  if(ps) ps.style.display=isPrincipal?'none':'block';
  if(tp){tp.style.background=isPrincipal?'var(--brand)':'transparent';tp.style.color=isPrincipal?'#fff':'var(--sub)';tp.style.borderColor=isPrincipal?'var(--brand)':'var(--border)';}
  if(ts){ts.style.background=isPrincipal?'transparent':'var(--brand)';ts.style.color=isPrincipal?'var(--sub)':'#fff';ts.style.borderColor=isPrincipal?'var(--border)':'var(--brand)';}
}

function slForgotPassword(){
  const agent=SD.config?.agent;
  const phone=(agent?.phone||'2348145073941').replace(/\D/g,'');
  const school=SD.config?.schoolName||'my school';
  const msg='Hello, I am the Principal of '+school+'. I cannot log into EduBloom — please send me my school password. School ID: '+(schoolId||'unknown');
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
}

function doPrincipalLogin(){
  const pwd=($('sl-p-pwd')?.value||'').trim();
  const errEl=$('sl-p-err');
  if(errEl) errEl.style.display='none';
  if(!pwd){if(errEl){errEl.textContent='Enter your school password.';errEl.style.display='block';}return;}
  const principal=(SD.staff||[]).find(s=>s.role==='Principal'&&(s.password||'')===pwd)
    ||(SD.staff||[]).find(s=>(s.password||'')===pwd);
  if(!principal){
    if(errEl){errEl.textContent='Incorrect password. Check your agent WhatsApp. Default is bloom2026.';errEl.style.display='block';}
    return;
  }
  currentStaff=principal; userRole='Principal';
  localStorage.setItem('p_'+schoolId+'_staffSession',JSON.stringify(Object.assign({},principal,{role:'Principal',schoolId})));
  _saveAuth(schoolId,principal.email||'');
  const div=$('staff-login'); if(div) div.style.display='none';
  startApp();
}

function doStaffLogin(){
  const email=($('sl-email')?.value||'').trim().toLowerCase();
  const pwd=$('sl-pwd')?.value||'';
  const errEl=$('sl-s-err');
  if(errEl) errEl.style.display='none';
  if(!email||!pwd){if(errEl){errEl.textContent='Enter your email and password.';errEl.style.display='block';}return;}
  const staff=(SD.staff||[]).find(s=>(s.email||'').trim().toLowerCase()===email&&(s.password||'')===pwd);
  if(!staff){
    if(errEl){errEl.textContent='Not recognised. Ask your Principal to check your staff record.';errEl.style.display='block';}
    return;
  }
  currentStaff=staff; userRole=staff.role||'Class Teacher';
  localStorage.setItem('p_'+schoolId+'_staffSession',JSON.stringify(Object.assign({},staff,{schoolId})));
  _saveAuth(schoolId,email);
  const div=$('staff-login'); if(div) div.style.display='none';
  startApp();
}


let SD={config:{},students:[],staff:[],expenses:[],attendance:{},scores:{},affective:{},sports:{teams:{},custom:[]},arts:{gallery:[]},music:{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]};
let activeIdx=null,activeTab='fees',currentSport='football';

// ── Sync Queue — Offline-First ────────────────────────────────────────────
// Writes go to localStorage immediately. Firestore sync happens silently
// in the background whenever network is available. No permission needed.
const SQ={
  q:JSON.parse(localStorage.getItem('p_sq')||'[]'),
  _syncing:false,
  save(){localStorage.setItem('p_sq',JSON.stringify(this.q));},
  push(key,data){
    // 1. Update in-memory state immediately
    SD[key]=data;
    // 2. Persist to localStorage immediately (works offline)
    if(schoolId)localStorage.setItem(`p_${schoolId}_${key}`,JSON.stringify(data));
    // 3. Queue for background Firestore sync
    this.q.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),key,data,tries:0});
    this.save();
    // 4. Try to flush silently — if offline, it just waits
    this.flush();
  },
  ping(){
    const netOk=navigator.onLine;
    const syncOk=netOk&&!!db;
    const el=$('sync');
    if(el){
      if(netOk&&this.q.length){ el.className='sdot sd-sync'; el.textContent='● Syncing'; }
      else if(netOk){           el.className='sdot sd-on';   el.textContent='● Online';  }
      else {
        // Don't show Offline immediately — Android gives false negatives on load.
        // Only show Offline if we've been disconnected for more than 4 seconds.
        if(!this._offlineSince) this._offlineSince=Date.now();
        const secs=Math.round((Date.now()-this._offlineSince)/1000);
        if(secs<4){
          el.className='sdot sd-sync'; el.textContent='● Connecting...';
        } else {
          el.className='sdot sd-off'; el.textContent='● Offline';
        }
      }
    }
    if(netOk) this._offlineSince=null; // reset on next online ping
    // Extra: if navigator says offline, try a real network probe after 2s
    if(!netOk && !this._probing){
      this._probing=true;
      setTimeout(async()=>{
        try{
          await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`,
            {method:'HEAD',signal:AbortSignal.timeout(4000)});
          // If we get here, network is actually available
          this._offlineSince=null; this.ping();
        }catch(e){ /* truly offline */ }
        this._probing=false;
      },2000);
    }
    if(syncOk&&this.q.length)this.flush();
  },
  async flush(){
    if(!db||!navigator.onLine||!this.q.length||this._syncing)return;
    this._syncing=true;
    const items=[...this.q];
    for(const item of items){
      try{
        await db.collection('schools').doc(schoolId).set({[item.key]:item.data},{merge:true});
        this.q=this.q.filter(x=>x.id!==item.id);
      }catch(e){
        item.tries++;
        if(item.tries>5)this.q=this.q.filter(x=>x.id!==item.id); // drop after 5 tries
      }
    }
    this._syncing=false;
    this.save();this.ping();
  },
  // Silent pull from Firestore — merges fresh data into localStorage + SD
  // Called automatically when network comes back. No UI prompts.
  async silentPull(){
    if(!db||!navigator.onLine||!schoolId)return;
    try{
      const doc=await db.collection('schools').doc(schoolId).get();
      if(!doc.exists)return;
      const d=doc.data();
      // Merge: only overwrite keys that aren't in our outgoing queue
      const pendingKeys=new Set(this.q.map(x=>x.key));
      Object.keys(d).forEach(k=>{
        if(!pendingKeys.has(k)){
          SD[k]=d[k];
          localStorage.setItem(`p_${schoolId}_${k}`,JSON.stringify(d[k]));
        }
      });
      // Refresh visible UI silently
      if(typeof renderBanner==='function')renderBanner();
      if(typeof renderRevenue==='function'&&$('sec-revenue')?.classList.contains('on'))renderRevenue();
      console.log('✅ Silent pull complete from Firestore');
    }catch(e){console.warn('Silent pull failed (offline?):', e.message);}
  }
};

// Network event handlers — everything happens silently, no permission needed
window.addEventListener('online',()=>{
  SQ.ping();
  // When network returns: push any queued writes, then pull fresh data
  SQ.flush().then(()=>SQ.silentPull());
});
window.addEventListener('offline',()=>SQ.ping());

// ── Helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const esc=s=>{if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;};
const fmt=n=>'₦'+Number(n||0).toLocaleString('en-NG');
const openM=id=>$(id).classList.add('on');
const closeM=id=>$(id).classList.remove('on');
window.onclick=e=>{if(e.target.classList.contains('modal'))e.target.classList.remove('on');};
document.onkeydown=e=>{if(e.key==='Escape')document.querySelectorAll('.modal').forEach(m=>m.classList.remove('on'));};
function loadLocal(key,def){if(!schoolId)return def;const v=localStorage.getItem(`p_${schoolId}_${key}`);if(v)try{return JSON.parse(v);}catch(e){}return def;}
function gradeScore(t){if(t>=70)return{g:'A',r:'Excellent'};if(t>=60)return{g:'B',r:'Good'};if(t>=50)return{g:'C',r:'Average'};if(t>=40)return{g:'D',r:'Below Average'};return{g:'F',r:'Fail'};}

// ── Password Eye Toggle ────────────────────────────────────────────────────
function toggleEye(inputId,btn){
  const inp=$(inputId);if(!inp)return;
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  btn.textContent=show?'🙈':'👁️';
  btn.title=show?'Hide password':'Show password';
}

// ── Login — Offline-First ──────────────────────────────────────────────────
// ORDER: localStorage → Firestore → admin_approved_schools
// Login always works offline if the school logged in before.
// On first login, needs network once to cache credentials. After that — offline forever.

function matchUser(staff,input){
  // Match by principal email first, then fallback to password (legacy)
  const v=(input||'').trim().toLowerCase();
  return staff.find(s=>(s.email||'').trim().toLowerCase()===v)
      || staff.find(s=>(s.password||'').trim().toLowerCase()===v)
      || null;
}

function loadSchoolIntoSD(sid,school){
  SD.config=school.config||{};
  SD.students=school.students||[];
  SD.staff=school.staff||[];
  SD.expenses=school.expenses||[];
  SD.attendance=school.attendance||{};
  SD.scores=school.scores||{};   // ✅ FIX: scores now loaded properly
  SD.affective=school.affective||{};
  SD.sports=school.sports||{teams:{},custom:[]};
  SD.arts=school.arts||{gallery:[]};
  SD.music=school.music||{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]};
  SD.health=school.health||[];
  SD.alumni=school.alumni||[];
  SD.socialPages=school.socialPages||[];
  SD.commsLog=school.commsLog||[];
  SD.opportunities=school.opportunities||defaultOpps();
  // Cache everything to localStorage immediately
  Object.keys(SD).forEach(k=>localStorage.setItem(`p_${sid}_${k}`,JSON.stringify(SD[k])));
}

// ✅ FIX: checkTierStatus moved AFTER function definition — no hoisting risk




// ─── Demo mode ────────────────────────────────────────────────────────────
function loadDemo(){
  const demoStudents=[
    {id:'d1',name:'Adaeze Okonkwo',   class:'JSS 2',phone:'08012345601',feePaid:25000,feeTotal:50000,gender:'F'},
    {id:'d2',name:'Emeka Eze',        class:'JSS 2',phone:'08012345602',feePaid:50000,feeTotal:50000,gender:'M'},
    {id:'d3',name:'Fatima Bello',     class:'JSS 2',phone:'08012345603',feePaid:0,    feeTotal:50000,gender:'F'},
    {id:'d4',name:'Chukwudi Obi',     class:'JSS 2',phone:'08012345604',feePaid:50000,feeTotal:50000,gender:'M'},
    {id:'d5',name:'Ngozi Nwosu',      class:'JSS 2',phone:'08012345605',feePaid:30000,feeTotal:50000,gender:'F'},
    {id:'d6',name:'Babatunde Adewale',class:'JSS 2',phone:'08012345606',feePaid:50000,feeTotal:50000,gender:'M'},
    {id:'d7',name:'Chiamaka Udo',     class:'JSS 2',phone:'08012345607',feePaid:50000,feeTotal:50000,gender:'F'},
    {id:'d8',name:'Yusuf Suleiman',   class:'JSS 2',phone:'08012345608',feePaid:0,    feeTotal:50000,gender:'M'},
    {id:'d9',name:'Blessing Nwobi',   class:'JSS 2',phone:'08012345609',feePaid:50000,feeTotal:50000,gender:'F'},
    {id:'d10',name:'Tunde Afolabi',   class:'JSS 2',phone:'08012345610',feePaid:25000,feeTotal:50000,gender:'M'},
  ];
  const demoScores={
    'Mathematics':{
      d1:{ca1:18,ca2:16,ca3:17,exam:62},d2:{ca1:20,ca2:19,ca3:18,exam:75},
      d3:{ca1:12,ca2:14,ca3:11,exam:45},d4:{ca1:19,ca2:20,ca3:20,exam:78},
      d5:{ca1:15,ca2:16,ca3:14,exam:55},d6:{ca1:18,ca2:17,ca3:19,exam:68},
      d7:{ca1:20,ca2:20,ca3:19,exam:80},d8:{ca1:10,ca2:11,ca3:12,exam:40},
      d9:{ca1:16,ca2:15,ca3:17,exam:60},d10:{ca1:14,ca2:13,ca3:15,exam:52},
    },
    'English Language':{
      d1:{ca1:17,ca2:18,ca3:16,exam:65},d2:{ca1:16,ca2:17,ca3:15,exam:60},
      d3:{ca1:13,ca2:12,ca3:14,exam:48},d4:{ca1:18,ca2:19,ca3:17,exam:70},
      d5:{ca1:15,ca2:16,ca3:14,exam:58},d6:{ca1:19,ca2:18,ca3:20,exam:72},
      d7:{ca1:20,ca2:19,ca3:18,exam:78},d8:{ca1:11,ca2:10,ca3:12,exam:42},
      d9:{ca1:17,ca2:16,ca3:15,exam:63},d10:{ca1:14,ca2:15,ca3:13,exam:54},
    },
    'Basic Science':{
      d1:{ca1:16,ca2:17,ca3:15,exam:60},d2:{ca1:18,ca2:17,ca3:19,exam:70},
      d3:{ca1:14,ca2:13,ca3:12,exam:50},d4:{ca1:20,ca2:19,ca3:18,exam:75},
      d5:{ca1:15,ca2:14,ca3:16,exam:56},d6:{ca1:17,ca2:18,ca3:16,exam:65},
      d7:{ca1:19,ca2:20,ca3:18,exam:76},d8:{ca1:12,ca2:11,ca3:10,exam:44},
      d9:{ca1:16,ca2:15,ca3:17,exam:62},d10:{ca1:13,ca2:14,ca3:12,exam:53},
    },
  };
  const demoAttendance={
    '2026-05-19':Object.fromEntries(demoStudents.map(s=>[s.id,s.id!=='d3'&&s.id!=='d8'?'present':'absent'])),
    '2026-05-20':Object.fromEntries(demoStudents.map(s=>[s.id,'present'])),
    '2026-05-21':Object.fromEntries(demoStudents.map(s=>[s.id,s.id==='d3'?'late':'present'])),
  };

  // Build SD directly
  SD.config={
    schoolName:'Sunshine Academy',
    plan:'premium',
    fee:50000,
    currentTerm:'Term 2',
    tier:'Small (51–100)',
    tierPrice:20000,
    tierMax:100,
    studentCount:10,
    whatsapp:'2348145073941',
    agent:{name:'Demo Agent',phone:'2348145073941'},
    _schoolId:'DEMO-SCHOOL',
    _demo:true,
  };
  SD.students = demoStudents;
  SD.staff    = [{name:'Mrs. Adaora Obi',email:'demo@sunshine.edu.ng',password:'demo',role:'Principal',phone:'08012345600'}];
  SD.scores   = demoScores;
  SD.attendance = demoAttendance;
  SD.expenses = [
    {id:'e1',desc:'Chalk & markers',amount:5000,date:'2026-05-10',category:'Supplies'},
    {id:'e2',desc:'Generator fuel',amount:15000,date:'2026-05-15',category:'Utilities'},
  ];
  SD.sports={teams:{},custom:[]};
  SD.arts={gallery:[]};
  SD.music={practiceLogs:[],instruments:[]};
  SD.health=[];SD.alumni=[];SD.socialPages=[];SD.commsLog=[];
  SD.opportunities=defaultOpps();

  // Set session vars
  schoolId='DEMO-SCHOOL';
  userRole='Principal';

  // Show demo banner
  const demoBanner=document.getElementById('demo-banner');
  if(demoBanner) demoBanner.style.display='flex';

  startApp();
  console.log('🎬 Demo mode loaded');
}

async function doLogin(){
  const sid=$('l-school').value.trim().toUpperCase();
  const err=$('l-err');err.style.display='none';
  const btn=$('l-btn');
  if(!sid){err.textContent='Enter your School ID (e.g. BLOOM-ABK0042).';err.style.display='block';return;}
  if(!sid.startsWith('BLOOM-')){err.textContent='School ID must start with BLOOM- (e.g. BLOOM-ABK0042).';err.style.display='block';return;}
  btn.textContent='Checking...';btn.disabled=true;

  // ── STEP 1: localStorage first — instant, works with zero network ──
  const lc=localStorage.getItem(`p_${sid}_config`);
  const ls=localStorage.getItem(`p_${sid}_staff`);
  if(lc&&ls){
    try{
      const staff=JSON.parse(ls);
      const config=JSON.parse(lc);
      console.log('✅ Login from localStorage cache (offline-first, ID only)');
      schoolId=sid;
      _saveAuth(sid,'');
      loadSchoolIntoSD(sid,{
        config,staff,
        students:loadLocal('students',[]),expenses:loadLocal('expenses',[]),
        attendance:loadLocal('attendance',{}),sports:loadLocal('sports',{teams:{},custom:[]}),
        arts:loadLocal('arts',{gallery:[]}),music:loadLocal('music',{practiceLogs:[],instruments:[]}),
        health:loadLocal('health',[]),alumni:loadLocal('alumni',[]),
        socialPages:loadLocal('socialPages',[]),commsLog:loadLocal('commsLog',[]),
        scores:loadLocal('scores',{}),
      opportunities:loadLocal('opportunities',defaultOpps())
      });
      // ── RBAC: check for cached staff session ──
      const cachedSession=localStorage.getItem(`p_${sid}_staffSession`);
      if(cachedSession){
        try{
          const sess=JSON.parse(cachedSession);
          currentStaff=sess; userRole=sess.role||'Principal';
          startApp(); btn.textContent='▶ Enter Portal';btn.disabled=false; return;
        }catch(e){}
      }
      // No staff session cached — if staff exist, show staff login; else Principal
      if(SD.staff&&SD.staff.length>0){
        btn.textContent='▶ Enter Portal';btn.disabled=false;
        showStaffLoginStep(); return;
      }
      userRole='Principal'; currentStaff=null;
      startApp();
      setTimeout(()=>SQ.silentPull(),1500);
      btn.textContent='▶ Enter Portal';btn.disabled=false;
      return;
    }catch(e){console.warn('localStorage parse error:',e);}
  }

  // ── STEP 2: No local cache — need network for first-time login ──
  if(!navigator.onLine){
    err.innerHTML='📶 <strong>No internet & no saved data.</strong><br>Connect to network for your first login. After that you can use the app offline.';
    err.style.display='block';btn.textContent='▶ Enter Portal';btn.disabled=false;return;
  }

  btn.textContent='Connecting...';
  try{
    let school=null;

    // Try Firestore schools collection
    if(db){
      try{
        const doc=await db.collection('schools').doc(sid).get();
        if(doc.exists){school=doc.data();console.log('✅ Found in Firestore schools');}
      }catch(e){console.warn('Firestore read failed:', e.message);}
    }

    // Try admin_approved_schools (older approvals / fallback)
    if(!school&&db){
      try{
        const snap=await db.collection('admin_approved_schools').where('schoolId','==',sid).get();
        if(!snap.empty){
          const rec=snap.docs[0].data();
          console.log('✅ Found in admin_approved_schools — bootstrapping school doc');
          school={
            config:{plan:'basic',fee:50000,schoolName:rec.schoolName||'',principalEmail:rec.principalEmail||'',whatsapp:rec.principalPhone||'',createdAt:new Date().toISOString()},
            staff:[{name:'Principal',email:(rec.principalEmail||sid.toLowerCase()+'@bloom.edu.ng').toLowerCase(),password:rec.password||'',role:'Principal',phone:rec.principalPhone||''}],
            students:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},
            music:{practiceLogs:[],instruments:[]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]
          };
          try{await db.collection('schools').doc(sid).set(school,{merge:true});}catch(e2){}
        }
      }catch(e){console.warn('admin_approved_schools check failed:', e.message);}
    }

    if(!school){
      err.textContent=`School ID "${sid}" not found. Double-check the ID sent by your AariNAT agent (format: BLOOM-XXXXXX).`;
      err.style.display='block';btn.textContent='▶ Enter Portal';btn.disabled=false;return;
    }

    // ✅ First-time login success — cache everything locally
    schoolId=sid;
    _saveAuth(sid,'');
    loadSchoolIntoSD(sid,school);
    // ── RBAC: route to staff login if staff exist ──
    const fsSession=localStorage.getItem(`p_${sid}_staffSession`);
    if(fsSession){
      try{const sess=JSON.parse(fsSession);currentStaff=sess;userRole=sess.role||'Principal';startApp();btn.textContent='▶ Enter Portal';btn.disabled=false;return;}catch(e){}
    }
    if(SD.staff&&SD.staff.length>0){
      btn.textContent='▶ Enter Portal';btn.disabled=false;
      showStaffLoginStep(); return;
    }
    userRole='Principal'; currentStaff=null;
    startApp();

  }catch(e){
    console.error('Login network error:', e);
    err.textContent='Connection error: '+(e?.message||'Check your internet and try again.');
    err.style.display='block';
  }
  btn.textContent='▶ Enter Portal';btn.disabled=false;
}

function _saveAuth(sid,email){
  const rememberMe=$('l-remember')?.checked!==false;
  const authData=JSON.stringify({schoolId:sid,email:email||'',role:userRole||'Principal'});
  if(rememberMe){
    localStorage.setItem('p_auth',authData);
    sessionStorage.removeItem('p_auth');
  } else {
    sessionStorage.setItem('p_auth',authData);
    localStorage.removeItem('p_auth');
  }
}

function defaultOpps(){
  return[
    {id:'ubec',title:'UBEC School Development Grant',provider:'Universal Basic Education Commission',type:'grant',amount:'₦500k–₦2M',deadline:'2026-09-30',audience:['school'],desc:'For primary school infrastructure improvements.'},
    {id:'ptdf',title:'PTDF Undergraduate Scholarship',provider:'PTDF',type:'scholarship',amount:'Full Tuition',deadline:'2026-08-31',audience:['student'],desc:'For Nigerian citizens studying petroleum-related courses.'},
    {id:'nnpc',title:'NNPC/TOTAL Scholarship',provider:'NNPC/TOTAL',type:'scholarship',amount:'₦200,000/year',deadline:'2026-07-15',audience:['student'],desc:'For 100-level STEM students.'},
    {id:'teach',title:'Teach For Nigeria Fellowship',provider:'Teach For Nigeria',type:'internship',amount:'Stipend + Training',deadline:'2026-06-30',audience:['teacher'],desc:'Teaching fellowship for graduates in underserved schools.'}
  ];
}

function logout(){
  if(!confirm('Clear session and reload?'))return;
  localStorage.removeItem('p_auth');
  sessionStorage.removeItem('p_auth');
  if(schoolId) localStorage.removeItem(`p_${schoolId}_staffSession`);
  currentStaff=null; userRole=null;
  location.reload();
}

function startApp(){
  // Called after login — refresh header and apply RBAC restrictions
  $('login').style.display='none';
  const staffLogin=$('staff-login'); if(staffLogin) staffLogin.style.display='none';
  $('app').style.display='block';
  const name=SD.config.schoolName||schoolId||'Educational Bloom';
  $('hdr-school').textContent=name;
  $('hdr-role').textContent=userRole+(currentStaff?.assignedClass?' · '+currentStaff.assignedClass:'');
  $('hdr-term').textContent=SD.config.currentTerm||'Term 1';
  const isPrem=SD.config.plan==='premium';
  $('planBadge').textContent=isPrem?'PREMIUM ✨':'BASIC';
  $('planBadge').className='plan-badge '+(isPrem?'plan-premium':'plan-basic');
  applyRoleRestrictions();

  // Clear "Loading..." placeholder immediately — even with zero data it shows correct state
  const bannerSub=$('banner-sub');
  if(bannerSub){
    const cnt=(SD.students||[]).length;
    bannerSub.textContent=cnt>0?`${cnt} student${cnt!==1?'s':''} enrolled`:'No students yet — add your first student';
  }

  SQ.ping();
  // Route to best first tab for this role
  const firstTabs={Principal:'revenue',Bursar:'revenue','Class Teacher':'students','Subject Teacher':'scorecard'};
  go(firstTabs[userRole]||'revenue');
  setTimeout(()=>SQ.flush(),500);
  setTimeout(()=>SQ.silentPull(),2000);

  // Android navigator.onLine gives false negatives on page load.
  // Re-check connectivity at 1s, 3s, 6s — updates the dot as soon as Android confirms internet.
  [1000,3000,6000].forEach(ms=>setTimeout(()=>{
    SQ.ping();
    if(navigator.onLine && SQ.q.length) SQ.flush();
    if(navigator.onLine && ms===6000) SQ.silentPull();
  }, ms));
}

// ── Navigation ─────────────────────────────────────────────────────────────
function go(tab){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b=>b.classList.remove('on'));
  $(`sec-${tab}`).classList.add('on');
  const btn=document.querySelector(`[data-t="${tab}"]`);if(btn)btn.classList.add('on');
  const fn={revenue:renderRevenue,students:renderStudentList,staff:renderStaff,sports:loadSports,arts:renderArts,music:renderMusic,health:renderHealth,alumni:renderAlumni,expenses:renderExpenses,finance:checkFinance,comms:renderComms,analytics:renderAnalytics,security:()=>{},support:renderSupport,settings:loadSettings,opps:renderOpps,scorecard:renderScorecard,aitools:()=>{if(typeof renderAITools==='function')renderAITools();}};
  if(fn[tab])fn[tab]();
}

// ── Banner ─────────────────────────────────────────────────────────────────

// ─── Tier enforcement ──────────────────────────────────────────────────────
function checkTierStatus(){
  const count = (SD.students||[]).length;
  const cfg   = SD.config || {};
  const tierMax   = cfg.tierMax   || getTier(cfg.studentCount||0).max;
  const tierPrice = cfg.tierPrice || getTier(cfg.studentCount||0).price;
  const tierName  = cfg.tier      || getTier(cfg.studentCount||0).name;
  const schoolId  = cfg._schoolId || localStorage.getItem('p_activeSchoolId') || '';

  // Save live studentCount to Firestore so admin can see it
  if(count !== (cfg._lastReportedCount||0)){
    cfg._lastReportedCount = count;
    SQ.push('config', cfg);
    // Write studentCount directly to the schools/{id}/config path so admin sees it in real time
    if(db && schoolId && !SD.config?._demo){
      db.collection('schools').doc(schoolId).update({'config.studentCount': count, 'config._lastReportedCount': count})
        .catch(e=>console.warn('studentCount sync:', e));
    }
  }

  const over = count > tierMax;
  const banner = document.getElementById('tier-alert-banner');

  if(!over){
    cfg.tierExceededAt = null;
    cfg.tierExceededNewTier = null;
    if(banner) banner.style.display = 'none';
    // Unlock if was locked
    const lockEl = document.getElementById('app-lockscreen');
    if(lockEl) lockEl.style.display = 'none';
    return;
  }

  // First time crossing — record timestamp + notify admin
  if(!cfg.tierExceededAt){
    cfg.tierExceededAt = new Date().toISOString();
    const newTier = getTier(count);
    cfg.tierExceededNewTier = newTier;
    SQ.push('config', cfg);
    // Firestore alert so admin sees it immediately
    if(db && schoolId){
      db.collection('schools').doc(schoolId).update({
        'config.tierExceededAt': cfg.tierExceededAt,
        'config.tierExceededNewTier': cfg.tierExceededNewTier,
        'config.studentCount': count
      }).catch(e=>console.warn('tier alert sync:', e));
      // Write to admin_alerts collection so admin dashboard can show it
      db.collection('admin_alerts').add({
        type: 'tier_exceeded',
        schoolId,
        schoolName: cfg.schoolName||schoolId,
        oldTier: tierName,
        newTier: cfg.tierExceededNewTier.name,
        newPrice: cfg.tierExceededNewTier.price,
        studentCount: count,
        exceededAt: cfg.tierExceededAt,
        resolved: false
      }).catch(e=>console.warn('admin alert:', e));
    }
  }

  const newTier = cfg.tierExceededNewTier || getTier(count);
  const exceededAt = new Date(cfg.tierExceededAt);
  const graceDays = 3;
  const lockAt    = new Date(exceededAt.getTime() + graceDays*24*60*60*1000);
  const now       = new Date();
  const msLeft    = lockAt - now;
  const hoursLeft = Math.max(0, Math.floor(msLeft / 3600000));
  const daysLeft  = Math.ceil(msLeft / 86400000);
  const isLocked  = msLeft <= 0;

  // Show / update banner
  if(banner){
    banner.style.display = 'flex';
    const daysStr = daysLeft > 0 ? `${daysLeft} day${daysLeft!==1?'s':''} left` : 'TODAY — pay now!';
    banner.innerHTML = `
      <div style="flex:1;">
        <strong>⚠️ Student count (${count}) exceeded your ${tierName} tier limit (${tierMax})</strong><br>
        <span style="font-size:0.8rem;">Upgrade to <b>${newTier.name}</b> at <b>₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> — <b style="color:${daysLeft<=1?'#ff4444':'#fbbf24'};">${daysStr}</b> before app locks.</span>
      </div>
      <button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">📞 Contact Admin</button>
    `;
  }

  // LOCK the app if grace period expired
  if(isLocked){
    let lockEl = document.getElementById('app-lockscreen');
    if(!lockEl){
      lockEl = document.createElement('div');
      lockEl.id = 'app-lockscreen';
      lockEl.style.cssText = 'position:fixed;inset:0;background:#0f172a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;';
      lockEl.innerHTML = `
        <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
        <div style="color:#f1f5f9;font-size:1.2rem;font-weight:800;margin-bottom:0.5rem;">App Locked</div>
        <div style="color:#94a3b8;font-size:0.9rem;max-width:320px;margin-bottom:1.5rem;">
          Your school has <b style="color:#f8fafc;">${count} students</b> but your plan covers up to <b style="color:#f8fafc;">${tierMax}</b>.<br><br>
          To unlock, upgrade to <b style="color:#60a5fa;">${newTier.name}</b> at <b style="color:#4ade80;">₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> and contact your agent.
        </div>
        <button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:1rem;font-weight:700;cursor:pointer;">📞 Contact Agent to Unlock</button>
      `;
      document.body.appendChild(lockEl);
    }
    lockEl.style.display = 'flex';
  }
}

function contactAdminForUpgrade(){
  const cfg = SD.config||{};
  const count = (SD.students||[]).length;
  const newTier = cfg.tierExceededNewTier || getTier(count);
  const agent = cfg.agent || {};
  const agentPhone = (agent.phone||'').replace(/\D/g,'');
  const msg = `Hello, I need to upgrade my EducationBloom plan.\n\nSchool: ${cfg.schoolName||'My School'}\nCurrent students: ${count}\nRequested tier: ${newTier.name} (₦${Number(newTier.price).toLocaleString('en-NG')}/term)\n\nPlease assist with the upgrade. Thank you.`;
  if(agentPhone){
    window.open(`https://wa.me/${agentPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  } else {
    alert('Contact your agent or admin to upgrade your plan.');
  }
}

function renderBanner(){
  let out=0,cnt=0;
  (SD.students||[]).forEach(s=>{const o=(s.totalFee||0)-(s.paid||0);if(o>0){out+=o;cnt++;}});
  const amtEl=$('banner-amount'); if(amtEl) amtEl.textContent=fmt(out);
  const subEl=$('banner-sub');
  if(subEl){
    const total=(SD.students||[]).length;
    if(total===0) subEl.textContent='No students yet — add your first student';
    else subEl.textContent=`${cnt} parent${cnt!==1?'s':''} overdue · ${total} total student${total!==1?'s':''}`;
  }
}

// ── 1. REVENUE ─────────────────────────────────────────────────────────────
function renderRevenue(){
  renderBanner();
  const s=SD.students||[];
  let exp=0,col=0;s.forEach(x=>{exp+=(x.totalFee||0);col+=(x.paid||0);});
  const pct=exp>0?Math.round((col/exp)*100):0;
  $('d-students').textContent=s.length;
  $('d-collected').textContent=fmt(col);
  $('d-outstanding').textContent=fmt(exp-col);
  $('d-rate').textContent=pct+'%';
  $('prog-pct').textContent=pct+'%';
  $('prog-fill').style.width=pct+'%';
  const overdue=s.filter(x=>(x.totalFee||0)-(x.paid||0)>0).sort((a,b)=>((b.totalFee||0)-(b.paid||0))-((a.totalFee||0)-(a.paid||0))).slice(0,6);
  $('overdue-list').innerHTML=overdue.length===0?'<p style="text-align:center;color:var(--sub);padding:1rem;">All fees collected! 🎉</p>':overdue.map(s=>{
    const idx=SD.students.indexOf(s);const owe=(s.totalFee||0)-(s.paid||0);
    return`<div class="stu-row"><div class="stu-av">${s.name.charAt(0).toUpperCase()}</div><div style="flex:1;"><div class="stu-name">${esc(s.name)}</div><div class="stu-meta">${esc(s.class||'—')} · Owes: <strong style="color:var(--danger);">${fmt(owe)}</strong></div></div><button class="btn-wa btn-sm" onclick="sendReminder(${idx})">📲</button></div>`;
  }).join('');
}

async function handleBulkPayment(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    const lines=ev.target.result.split(/\r?\n/).filter(x=>x.trim());
    let matched=0,skipped=0,noMatch=0;

    // Score how well two name strings match (word overlap, 0–1)
    const nameScore=(a,b)=>{
      const wa=a.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(Boolean);
      const wb=b.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(Boolean);
      if(!wa.length||!wb.length)return 0;
      // Count shared words
      const shared=wa.filter(w=>w.length>1&&wb.includes(w)).length;
      // Also check if any word from one is a prefix of a word in the other
      let prefixBonus=0;
      wa.forEach(w=>{if(w.length>2&&wb.some(v=>v.startsWith(w)||w.startsWith(v)))prefixBonus+=0.5;});
      return(shared+prefixBonus)/Math.max(wa.length,wb.length);
    };

    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',').map(c=>c.trim());
      if(cols.length<2||!cols[0]||!cols[1])continue;
      const csvName=cols[0];
      const amt=parseFloat(cols[1].replace(/[^0-9.]/g,''));
      if(isNaN(amt)||amt<=0)continue;

      // Score every student
      const scored=SD.students.map((s,idx)=>({s,idx,score:nameScore(csvName,s.name)}))
        .filter(x=>x.score>0.3)
        .sort((a,b)=>b.score-a.score);

      if(!scored.length){noMatch++;continue;}

      const best=scored[0];
      // Ambiguous only if two candidates have equal top score AND both >0.5
      const isAmbiguous=scored.length>1&&scored[1].score>=best.score&&best.score>0.5;
      if(isAmbiguous){skipped++;continue;}

      best.s.paid=(best.s.paid||0)+amt;
      if(!best.s.paymentHistory)best.s.paymentHistory=[];
      best.s.paymentHistory.unshift({amount:amt,method:'Bank Statement',date:new Date().toISOString().split('T')[0],by:'CSV Import'});
      matched++;
    }

    await SQ.push('students',SD.students); checkTierStatus();
    let msg=`✅ ${matched} matched and updated`;
    if(skipped)msg+=` · ⚠️ ${skipped} ambiguous`;
    if(noMatch)msg+=` · ❓ ${noMatch} not found`;
    $('bulk-feedback').textContent=msg;
    renderRevenue();
  };
  r.readAsText(f);
}

function sendReminder(idx){
  const s=SD.students[idx];const owe=(s.totalFee||0)-(s.paid||0);
  const sn=SD.config.schoolName||'School Management';
  const msg=`Dear Parent,\n\nThis is a friendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
  if(s.phone)window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
  else alert('No phone number for this student.');
}

function sendAllReminders(){
  const overdue=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  if(!overdue.length)return alert('No overdue students!');
  // Use guided bulk sequence if students have phone numbers
  const withPhone=overdue.filter(s=>s.phone);
  if(withPhone.length>0){startBulkWA();return;}
  // Fallback: broadcast message for parents without individual numbers
  const sn=SD.config.schoolName||'School';
  const total=overdue.reduce((t,s)=>t+(s.totalFee||0)-(s.paid||0),0);
  const msg=`Dear Parents of ${sn},

This is a reminder that *${overdue.length} students* have outstanding fee balances this term.

Total outstanding: *${fmt(total)}*

Kindly ensure prompt payment.

– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
  logComm('Fee Reminder Broadcast',`Sent to ${overdue.length} overdue parents. Total: ${fmt(total)}`);
}
// (old sendAllReminders replaced)
function _sendAllReminders_REPLACED(){
}

// ── 2. STUDENTS (central hub) ──────────────────────────────────────────────

// ── Fix garbled student names already in storage ──────────────────────────
async function fixGarbledNames(){
  const before=SD.students.length;

  // Step 1: remove entries that don't look like valid names
  SD.students=SD.students.filter(s=>looksLikeValidName((s.name||'').trim()));

  // Step 2: remove duplicates (same normalised name)
  const seen=new Set();
  SD.students=SD.students.filter(s=>{
    const key=(s.name||'').toLowerCase().replace(/[^a-z]/g,'');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });

  const removed=before-SD.students.length;
  if(removed===0){
    alert('Nothing to clean — all names look valid and there are no duplicates! ✅');
    return;
  }
  await SQ.push('students',SD.students); checkTierStatus();
  renderStudentList();renderBanner();renderRevenue();
  alert(`✅ Removed ${removed} entr${removed!==1?'ies':'y'} (junk + duplicates).\n\nIf any real student was removed, add them back manually with ➕ Add Student.`);
}
function renderStudentList(){
  const q=($('stu-search')?.value||'').toLowerCase();
  let cls=$('stu-class')?.value||'';
  const pay=$('stu-pay')?.value||'';
  let list=[...SD.students];

  // ── RBAC: Class Teacher sees ONLY their assigned class ────────────────────
  const assignedCls=getAssignedClass();
  if(assignedCls&&(userRole==='Class Teacher'||userRole==='Subject Teacher')){
    cls=assignedCls;
    // Lock the class filter dropdown to their class
    const clsSel=$('stu-class');
    if(clsSel){clsSel.value=assignedCls;clsSel.disabled=true;}
  }

  if(q)list=list.filter(s=>s.name.toLowerCase().includes(q)||(s.phone||'').includes(q));
  if(cls)list=list.filter(s=>s.class===cls);
  if(pay==='paid')list=list.filter(s=>(s.totalFee||0)<=(s.paid||0));
  else if(pay==='owing')list=list.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  populateClassFilter();
  const c=$('students-list');
  if(!list.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No students match.</p>';return;}

  c.innerHTML=list.map(s=>{
    const idx=SD.students.indexOf(s);
    const owe=(s.totalFee||0)-(s.paid||0);
    const pbc=owe<=0?'pb-paid':s.paid>0?'pb-part':'pb-owe';
    const pbt=owe<=0?'Paid':s.paid>0?'Partial':'Unpaid';
    // ── RBAC: hide fee badge from Class/Subject Teachers ─────────────────────
    const feeBadge=canSeeFees()?`<span class="pay-badge ${pbc}">${pbt}</span>${owe>0?`<span style="font-size:0.68rem;color:var(--danger);">${fmt(owe)}</span>`:''}`:'' ;
    return`<div class="stu-row" onclick="openProfile(${idx})"><div class="stu-av">${s.name.charAt(0).toUpperCase()}</div><div style="flex:1;min-width:0;"><div class="stu-name">${esc(s.name)}</div><div class="stu-meta">${esc(s.class||'—')} · ${s.phone||'—'}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">${feeBadge}</div></div>`;
  }).join('');
}

function populateClassFilter(){
  const sel=$('stu-class');if(!sel)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const cur=sel.value;
  sel.innerHTML='<option value="">All Classes</option>'+classes.map(c=>`<option value="${esc(c)}" ${c===cur?'selected':''}>${esc(c)}</option>`).join('');
}

async function addStudent(){
  const name=$('ns-name').value.trim(),phone=$('ns-phone').value.trim().replace(/\D/g,'');
  const cls=$('ns-class').value.trim(),fee=parseFloat($('ns-fee').value)||SD.config.fee||50000;
  if(!name||!phone)return alert('Name and phone required.');
  SD.students.push({name,phone,class:cls,totalFee:fee,paid:0,scores:{},swot:{}});
  await SQ.push('students',SD.students); checkTierStatus();
  closeM('add-student-modal');
  $('ns-name').value='';$('ns-phone').value='';$('ns-class').value='';$('ns-fee').value='';
  renderStudentList();renderBanner();renderRevenue();
}

async function deleteStudent(idx){
  if(!confirm(`Delete ${SD.students[idx]?.name}?`))return;
  SD.students.splice(idx,1);await SQ.push('students',SD.students); checkTierStatus();
  closeM('student-modal');renderStudentList();renderBanner();
}

// ── Universal student import: CSV, TXT, JPG, PNG, JPEG, WEBP ─────────────
function handleCSV(e){
  const files=Array.from(e.target.files||[]); if(!files.length)return;
  e.target.value='';
  const images=files.filter(f=>{
    const n=(f.name||'').toLowerCase(),t=(f.type||'').toLowerCase();
    return t.startsWith('image/')||/\.(jpg|jpeg|png|webp|bmp)$/.test(n);
  });
  const texts=files.filter(f=>!images.includes(f));
  // Process text/CSV files immediately (sync)
  texts.forEach(f=>importStudentsFromText(f));
  // Process images sequentially with progress feedback
  if(images.length) processImagesSequentially(images);
}

// ── Multi-page OCR with Gemini Flash + Review Panel ──────────────────────
let _ocrPending = []; // names waiting for review

async function processImagesSequentially(files){
  const fbEl=$('csv-fb');
  _ocrPending=[];

  for(let i=0;i<files.length;i++){
    const f=files[i];
    if(fbEl) fbEl.textContent=`📸 Reading page ${i+1} of ${files.length}...`;
    const names = await _readOnePage(f, i+1, files.length, fbEl);
    _ocrPending.push(...names);
  }

  if(!_ocrPending.length){
    if(fbEl) fbEl.textContent='❌ Could not read any names. Try clearer photos or use CSV import.';
    return;
  }

  // Deduplicate against existing students
  const existingKeys=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
  _ocrPending=_ocrPending.filter(n=>{
    const key=(n.fullName||'').toLowerCase().replace(/[^a-z]/g,'');
    return key.length>1&&!existingKeys.has(key);
  });

  if(fbEl) fbEl.textContent=`✅ Extracted ${_ocrPending.length} names from ${files.length} page${files.length>1?'s':''}. Review and confirm below.`;
  ocrShowReview(_ocrPending);
}

async function _readOnePage(file, pageNum, total, fbEl){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=async ev=>{
      const imgData=ev.target.result;
      const b64=imgData.split(',')[1];
      const mime=file.type||'image/jpeg';

      // ── Gemini Flash (primary — structured JSON, no hallucinations) ──
      try{
        if(fbEl) fbEl.textContent=`📸 Page ${pageNum}/${total}: Gemini reading...`;
        const names=await geminiOCR(b64,mime);
        if(names&&names.length){ resolve(names); return; }
      }catch(e){ console.warn(`Page ${pageNum} Gemini failed:`,e.message); }

      // ── OCR.space fallback ───────────────────────────────────────────
      try{
        if(fbEl) fbEl.textContent=`📸 Page ${pageNum}/${total}: cloud OCR fallback...`;
        const arr=imgData.split(','); const mtype=arr[0].match(/:(.*?);/)[1];
        const bstr=atob(arr[1]); let bn=bstr.length;
        const u8=new Uint8Array(bn); while(bn--) u8[bn]=bstr.charCodeAt(bn);
        const blob=new Blob([u8],{type:mtype});
        const fd=new FormData();
        fd.append('file',blob,'page.jpg'); fd.append('language','eng');
        fd.append('apikey','helloworld'); fd.append('isHandwritten','true');
        fd.append('scale','true'); fd.append('OCREngine','2');
        const resp=await fetch('https://api.ocr.space/parse/image',{method:'POST',body:fd});
        const result=await resp.json();
        const text=result.ParsedResults?.[0]?.ParsedText||'';
        if(text.trim()){
          const raw=extractStudentNames(text);
          resolve(raw.map(n=>({surname:'',firstname:'',fullName:n})));
          return;
        }
      }catch(e){ console.warn(`Page ${pageNum} OCR.space failed:`,e.message); }

      // ── Last resort: Tesseract offline ───────────────────────────────────────
      try{
        if(fbEl) fbEl.textContent=`📸 Page ${pageNum}/${total}: offline OCR (~30s)...`;
        const loadTesseract=()=>new Promise((res,rej)=>{
          if(window.Tesseract){res();return;}
          const s=document.createElement('script');
          s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          s.onload=res;s.onerror=rej;document.head.appendChild(s);
        });
        await loadTesseract();
        const{data:{text}}=await Tesseract.recognize(imgData,'eng',{
          logger:m=>{if(m.status==='recognizing text'&&fbEl)
            fbEl.textContent=`📸 Page ${pageNum}/${total}: offline OCR ${Math.round((m.progress||0)*100)}%...`;}
        });
        if(text.trim()){
          const raw=extractStudentNames(text);
          if(raw.length){ resolve(raw.map(n=>({surname:'',firstname:'',fullName:n}))); return; }
        }
      }catch(e){ console.warn(`Page ${pageNum} Tesseract failed:`,e.message); }

      resolve([]);
    };
    reader.onerror=()=>resolve([]);
    reader.readAsDataURL(file);
  });
}

// ── OCR Review Panel ──────────────────────────────────────────────────────
function ocrShowReview(names){
  const modal=document.getElementById('ocr-review-modal');
  const list=document.getElementById('ocr-review-list');
  const info=document.getElementById('ocr-review-info');
  if(!modal||!list) return;

  if(info) info.textContent=`${names.length} names extracted. Tick each correct name, edit any that look wrong, then tap Add Students.`;

  list.innerHTML=names.map((n,i)=>{
    const name=n.fullName||((n.surname||'')+' '+(n.firstname||'')).trim();
    return `<div class="ocr-row" id="ocr-row-${i}" style="display:flex;align-items:center;gap:6px;padding:6px 4px;border-bottom:1px solid var(--border);">
      <input type="checkbox" id="ocr-chk-${i}" checked onchange="ocrUpdateCount()"
        style="width:18px;height:18px;cursor:pointer;accent-color:var(--brand);flex-shrink:0;">
      <input type="text" id="ocr-name-${i}" value="${name.replace(/"/g,'&quot;')}"
        style="flex:1;border:1px solid var(--border);border-radius:6px;padding:5px 8px;
        font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;min-width:0;">
      <input type="text" id="ocr-cls-${i}" placeholder="Class"
        style="width:72px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;
        font-size:0.78rem;background:var(--bg);color:var(--text);font-family:inherit;flex-shrink:0;">
      <button onclick="document.getElementById('ocr-row-${i}').remove();ocrUpdateCount()"
        style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
        padding:4px 8px;cursor:pointer;color:#dc2626;font-size:0.78rem;flex-shrink:0;">✕</button>
    </div>`;
  }).join('');

  ocrUpdateCount();
  modal.classList.add('on');
}

function ocrUpdateCount(){
  const checked=document.querySelectorAll('#ocr-review-list input[type=checkbox]:checked').length;
  const btn=document.getElementById('ocr-confirm-btn');
  if(btn) btn.textContent=`✅ Add ${checked} Student${checked!==1?'s':''}`;
}

function ocrSelectAll(val){
  document.querySelectorAll('#ocr-review-list input[type=checkbox]').forEach(c=>c.checked=val);
  ocrUpdateCount();
}

function ocrSetClassAll(){
  const cls=(document.getElementById('ocr-class-all')?.value||'').trim();
  if(!cls) return;
  document.querySelectorAll('[id^=ocr-cls-]').forEach(el=>el.value=cls);
}

async function ocrConfirmImport(){
  const rows=document.querySelectorAll('#ocr-review-list .ocr-row');
  const existingKeys=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
  let added=0;
  const fee=SD.config?.fee||50000;

  rows.forEach((row,i)=>{
    const chk=row.querySelector('input[type=checkbox]');
    if(!chk||!chk.checked) return;
    const nameEl=row.querySelector('input[type=text]');
    const clsEl=row.querySelectorAll('input[type=text]')[1];
    const name=(nameEl?.value||'').trim();
    const cls=(clsEl?.value||'').trim();
    if(!name) return;
    const key=name.toLowerCase().replace(/[^a-z]/g,'');
    if(existingKeys.has(key)) return;
    SD.students.push({name,phone:'',class:cls,totalFee:fee,paid:0,scores:{},swot:{}});
    existingKeys.add(key); added++;
  });

  if(!added){ alert('No names selected.'); return; }
  await SQ.push('students',SD.students); checkTierStatus();
  document.getElementById('ocr-review-modal').classList.remove('on');
  renderStudentList(); renderBanner(); renderRevenue();
  const fbEl=$('csv-fb');
  if(fbEl) fbEl.textContent=`✅ ${added} student${added!==1?'s':''} added successfully.`;
}

function importStudentsFromText(f){
  // Try reading as UTF-8 first; if result looks garbled, retry as Latin-1
  const tryRead=(encoding)=>new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=ev=>resolve(ev.target.result);
    r.onerror=reject;
    r.readAsText(f,encoding);
  });

  const looksGarbled=str=>{
    // Count replacement chars and high non-latin unicode symbols
    const bad=(str.match(/[\uFFFD\u0080-\u009F\u00C2-\u00C3]/g)||[]).length;
    return bad>5||(bad/Math.max(str.length,1))>0.02;
  };

  const cleanName=n=>n
    .replace(/[^a-zA-Z\s'\-\.]/g,'')   // keep only letters, space, apostrophe, hyphen, dot
    .replace(/\s+/g,' ')
    .trim();

  (async()=>{
    let raw=await tryRead('UTF-8');
    if(looksGarbled(raw)){
      // Retry with Windows-1252 / Latin-1
      raw=await tryRead('windows-1252');
    }
    const lines=raw.split(/\r?\n/).filter(x=>x.trim());
    const isStructured=lines.length>1&&lines[0].toLowerCase().includes('name')&&lines[0].includes(',');
    let count=0;
    if(isStructured){
      for(let i=1;i<lines.length;i++){
        const c=lines[i].split(',').map(x=>x.trim());
        const nm=cleanName(c[0]||'');
        if(nm&&nm.length>1&&c[1]){
          SD.students.push({name:nm,phone:c[1].replace(/\D/g,''),class:c[2]||'',totalFee:parseFloat(c[3])||SD.config.fee||50000,paid:0,scores:{},swot:{}});
          count++;
        }
      }
    } else {
      const names=extractStudentNames(raw);
      const existingKeys=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
      names.forEach(nm=>{
        const safe=nm.replace(/[^a-zA-Z\s'\-\.]/g,'').replace(/\s+/g,' ').trim();
        const key=safe.toLowerCase().replace(/[^a-z]/g,'');
        if(safe.length>1&&!existingKeys.has(key)){
          SD.students.push({name:safe,phone:'',class:'',totalFee:SD.config.fee||50000,paid:0,scores:{},swot:{}});
          existingKeys.add(key);
          count++;
        }
      });
    }
    await SQ.push('students',SD.students); checkTierStatus();
    $('csv-fb').textContent=`✅ Imported ${count} student${count!==1?'s':''}.${isStructured?'':' Add phone/class in profiles.'}`;
    renderStudentList();renderBanner();renderRevenue();
  })().catch(()=>alert('Could not read file. Try saving it as UTF-8 CSV.'));
}

async function importStudentsFromImage(f){
  const fbEl = $('csv-fb');
  if(fbEl) fbEl.textContent = '📸 Reading photo...';
  const reader = new FileReader();
  reader.onload = async ev => {
    const imgData = ev.target.result;
    const b64    = imgData.split(',')[1];
    const mime   = f.type || 'image/jpeg';
    try {
      // ── Claude Vision (best for Nigerian handwriting) ──────────────────
      if(fbEl) fbEl.textContent = '📸 Aari is reading the handwriting...';
      const names = await claudeVisionOCR(b64, mime);
      if(names.length){
        let count = 0;
        const existingKeys = new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
        names.forEach(n=>{
          const safe = (n.fullName||'').replace(/[^a-zA-Z\s'\-.]/g,'').replace(/\s+/g,' ').trim();
          const key  = safe.toLowerCase().replace(/[^a-z]/g,'');
          if(safe.length > 1 && !existingKeys.has(key)){
            SD.students.push({name:safe,phone:'',class:'',totalFee:SD.config.fee||50000,paid:0,scores:{},swot:{}});
            existingKeys.add(key); count++;
          }
        });
        await SQ.push('students',SD.students); checkTierStatus();
        if(fbEl) fbEl.textContent = `✅ Aari found ${count} student${count!==1?'s':''} from photo. Add phone/class in profiles.`;
        renderStudentList(); renderBanner(); renderRevenue();
        return;
      }
    } catch(e){ console.warn('Claude Vision OCR failed, falling back:', e); }

    // ── Fallback: OCR.space free tier ──────────────────────────────────────
    try {
      if(fbEl) fbEl.textContent = '📸 Processing with cloud OCR...';
      const arr=imgData.split(','); const mtype=arr[0].match(/:(.*?);/)[1];
      const bstr=atob(arr[1]); let n=bstr.length;
      const u8=new Uint8Array(n); while(n--) u8[n]=bstr.charCodeAt(n);
      const blob=new Blob([u8],{type:mtype});
      const fd=new FormData();
      fd.append('file',blob,'register.jpg');
      fd.append('language','eng'); fd.append('apikey','helloworld');
      fd.append('isHandwritten','true');
      const resp=await fetch('https://api.ocr.space/parse/image',{method:'POST',body:fd});
      const result=await resp.json();
      const text = result.ParsedResults?.[0]?.ParsedText||'';
      if(text.trim()){
        const nameList = extractStudentNames(text);
        let count=0;
        const existingKeys=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
        nameList.forEach(nm=>{
          const safe=nm.replace(/[^a-zA-Z\s'\-.]/g,'').replace(/\s+/g,' ').trim();
          const key=safe.toLowerCase().replace(/[^a-z]/g,'');
          if(safe.length>1&&!existingKeys.has(key)){
            SD.students.push({name:safe,phone:'',class:'',totalFee:SD.config.fee||50000,paid:0,scores:{},swot:{}});
            existingKeys.add(key); count++;
          }
        });
        await SQ.push('students',SD.students); checkTierStatus();
        if(fbEl) fbEl.textContent=`✅ Found ${count} student${count!==1?'s':''} from photo.`;
        renderStudentList(); renderBanner(); renderRevenue(); return;
      }
    } catch(e){ console.warn('OCR.space failed, using Tesseract:', e); }

    // ── Last resort: Tesseract (offline) ───────────────────────────────────
    await importStudentsFromImageTesseract(imgData);
  };
  reader.onerror = () => alert('Could not read image.');
  reader.readAsDataURL(f);
}

async function importStudentsFromImageTesseract(imgData){
  const fbEl = $('csv-fb');
  const loadTesseract=()=>new Promise((resolve,reject)=>{
    if(window.Tesseract){resolve();return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload=resolve;s.onerror=reject;
    document.head.appendChild(s);
  });
  try{
    if(fbEl) fbEl.textContent='📸 Offline OCR loading (~30s)...';
    await loadTesseract();
    const{data:{text}}=await Tesseract.recognize(imgData,'eng',{
      logger:m=>{if(m.status==='recognizing text'&&fbEl)
        fbEl.textContent='📸 Offline OCR... '+Math.round((m.progress||0)*100)+'%';}
    });
    const names=extractStudentNames(text);
    let count=0;
    const existingKeys=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
    names.forEach(nm=>{
      const safe=nm.replace(/[^a-zA-Z\s'\-.]/g,'').replace(/\s+/g,' ').trim();
      const key=safe.toLowerCase().replace(/[^a-z]/g,'');
      if(safe.length>1&&!existingKeys.has(key)){
        SD.students.push({name:safe,phone:'',class:'',totalFee:SD.config.fee||50000,paid:0,scores:{},swot:{}});
        existingKeys.add(key);count++;
      }
    });
    await SQ.push('students',SD.students); checkTierStatus();
    if(fbEl) fbEl.textContent=`✅ Found ${count} student${count!==1?'s':''} from photo.`;
    renderStudentList();renderBanner();renderRevenue();
  }catch(err){
    if(fbEl) fbEl.textContent='❌ Photo reading failed. Try a clearer image or use CSV.';
  }
}

// ── Name validation helpers ──────────────────────────────────────────────
const UI_BLACKLIST=[
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

// Nigerian name prefixes that appear on this list — these are valid
const VALID_PREFIXES=/^(mc\.?|cp\.?|ceb\.?|lsses?\.?|lses?\.?|sps\.?|spvenevang\.?|spsupevang\.?|snrldr\.?|honsnrevang\.?|evang\.?|hon\.?|snr\.?|ldr\.?|ven\.?|sup\.?|rev\.?|pastor|deacon|deaconess|bro\.?|sis\.?|mr\.?|mrs\.?|miss|dr\.?|prof\.?)\s/i;

function looksLikeValidName(str){
  const t=str.trim();
  if(!t||t.length<4)return false;

  // Must have at least one letter
  if(!/[a-zA-Z]/.test(t))return false;

  // Reject if contains digits
  if(/\d/.test(t))return false;

  // Reject obvious UI/junk phrases
  const low=t.toLowerCase();
  if(UI_BLACKLIST.some(b=>low.includes(b)))return false;

  // Split into words
  const words=t.split(/\s+/).filter(Boolean);

  // Too many words = sentence, not a name
  if(words.length>6)return false;

  // Reject if too few chars total after stripping non-alpha
  const alpha=t.replace(/[^a-zA-Z]/g,'');
  if(alpha.length<4)return false;

  // Check for gibberish: if >40% of consecutive chars are consonant clusters
  // (real names rarely have more than 3 consonants in a row)
  const consonantRun=(t.match(/[^aeiouAEIOU\s.,'\-]{5,}/g)||[]);
  if(consonantRun.length>0)return false;

  // Must have at least one word with 3+ real letters
  const hasRealWord=words.some(w=>{
    const a=w.replace(/[^a-zA-Z]/g,'');
    return a.length>=3;
  });
  if(!hasRealWord)return false;

  // If it starts with a known Nigerian title prefix, trust it
  if(VALID_PREFIXES.test(t))return true;

  // Must have at least one capitalised word of 3+ letters (proper name)
  const hasProperNoun=words.some(w=>w.length>=3&&/^[A-Z]/.test(w)&&/[a-z]/.test(w));
  return hasProperNoun;
}

function extractStudentNames(raw){
  // Split on newlines and process each line independently
  const lines=raw.split(/\r?\n/);
  const candidates=[];

  lines.forEach(line=>{
    const t=line.trim();
    if(!t)return;

    // CSV: take only first column
    if(t.includes(',')&&!/^\d+[.)\s]/.test(t)){
      const col=t.split(',')[0].replace(/"/g,'').trim();
      if(col)candidates.push(col);
      return;
    }

    // Strip leading number/bullet: "1. Name" or "• Name"
    const stripped=t
      .replace(/^\d+[.):\s]+/,'')
      .replace(/^[-*•]\s*/,'')
      .trim();

    if(stripped)candidates.push(stripped);
  });

  // Deduplicate and validate
  const seen=new Set();
  const result=[];
  candidates.forEach(raw=>{
    const n=raw.replace(/\s+/g,' ').trim();
    const key=n.toLowerCase().replace(/[^a-z]/g,'');
    if(!key||seen.has(key))return;
    if(looksLikeValidName(n)){
      seen.add(key);
      result.push(n);
    }
  });
  return result;
}

// ── STUDENT PROFILE ────────────────────────────────────────────────────────
function openProfile(idx){
  activeIdx=idx;activeTab='fees';
  const s=SD.students[idx];if(!s)return;
  $('prof-name').textContent=s.name;
  $('prof-meta').textContent=`${s.class||'—'} · ${s.phone||'—'}`;
  document.querySelectorAll('.ptab').forEach(t=>t.classList.toggle('on',t.dataset.pt==='fees'));
  renderTab('fees');openM('student-modal');
}

function setTab(tab){
  activeTab=tab;
  document.querySelectorAll('.ptab').forEach(t=>t.classList.toggle('on',t.dataset.pt===tab));
  renderTab(tab);
}

function renderTab(tab){
  const s=SD.students[activeIdx];if(!s)return;
  const c=$('profile-content');
  if(tab==='fees')c.innerHTML=buildFees(s,activeIdx);
  else if(tab==='attendance')c.innerHTML=buildAttendance(s);
  else if(tab==='scores')c.innerHTML=buildScores(s,activeIdx);
  else if(tab==='report')c.innerHTML=buildReport(s);
  else if(tab==='swot')c.innerHTML=buildSWOT(s,activeIdx);
  else if(tab==='safety')c.innerHTML=buildSafety(s,activeIdx);
}

// FEES TAB
function buildFees(s,idx){
  // ── RBAC: Class/Subject Teachers cannot see fee data ─────────────────────
  if(!canSeeFees()){
    return`<div class="card" style="text-align:center;padding:1.5rem;color:var(--sub);">
      <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div>
      <div style="font-weight:700;font-size:0.88rem;color:var(--text);">Fee data is private</div>
      <div style="font-size:0.78rem;margin-top:0.3rem;">Only the Principal and Bursar can view fee information.</div>
    </div>`;
  }
  const owe=(s.totalFee||0)-(s.paid||0);
  const pct=s.totalFee?Math.min(100,Math.round(((s.paid||0)/s.totalFee)*100)):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;margin-bottom:0.65rem;">
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
    ${owe>0&&SD.config.plan==='premium'?`<button id="bc-btn-${idx}" class="btn-sm" style="background:linear-gradient(135deg,#059669,#065f46);color:#fff;border:none;border-radius:8px;padding:0.5rem;font-size:0.8rem;cursor:pointer;font-weight:700;width:100%;margin-top:0.4rem;" onclick="generatePaymentLink(${idx})">💳 Send BloomCollect Payment Link</button>`:''}
    ${(s.paymentHistory||[]).length?`<div style="margin-top:0.75rem;"><div style="font-weight:700;font-size:0.82rem;margin-bottom:0.4rem;">Payment History</div>${(s.paymentHistory||[]).map((p,pi)=>`
  <div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0;border-bottom:1px solid var(--border);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:0.8rem;font-weight:600;color:var(--money);">${fmt(p.amount)}</div>
      <div style="font-size:0.7rem;color:var(--sub);">${p.date} · ${p.method}</div>
    </div>
    <button onclick="editPayment(${idx},${pi})"
      style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
      padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
    <button onclick="deletePayment(${idx},${pi})"
      style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
      padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️ Del</button>
  </div>`).join('')}</div>`:''}
    </div>`;
}

async function recordPayment(idx){
  const amt=parseFloat($('pay-amt')?.value);if(!amt||amt<=0)return alert('Enter valid amount.');
  SD.students[idx].paid=(SD.students[idx].paid||0)+amt;
  if(!SD.students[idx].paymentHistory)SD.students[idx].paymentHistory=[];
  SD.students[idx].paymentHistory.unshift({amount:amt,method:$('pay-method')?.value||'Cash',date:$('pay-date')?.value||new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('students',SD.students); checkTierStatus();
  $('pay-amt').value='';renderTab('fees');renderBanner();renderRevenue();
  alert(`✅ ${fmt(amt)} recorded for ${SD.students[idx].name}`);
}

// ATTENDANCE TAB
function buildAttendance(s){
  const days=[];for(let i=0;i<14;i++){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
  const att=SD.attendance||{};
  const today=days[0];
  const present=days.filter(d=>att[d]?.[s.name]==='Present').length;
  const absent=days.filter(d=>att[d]?.[s.name]==='Absent').length;
  const late=days.filter(d=>att[d]?.[s.name]==='Late').length;
  const pct=days.length>0?Math.round((present/days.length)*100):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;">
    <div class="stat"><div class="sn" style="color:var(--money);">${present}</div><div class="sl">Present</div></div>
    <div class="stat"><div class="sn" style="color:var(--danger);">${absent}</div><div class="sl">Absent</div></div>
    <div class="stat"><div class="sn" style="color:var(--warn);">${late}</div><div class="sl">Late</div></div>
    </div><div class="prog-bg" style="margin-top:0.65rem;"><div class="prog-fill" style="width:${pct}%;"></div></div>
    <div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% attendance (last 14 days)</div></div>
    <div class="card"><div class="ct" style="display:flex;justify-content:space-between;align-items:center;"><span>📅 Mark Today (${today})</span><button onclick="checkMorningAbsentees()" style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.25);border-radius:7px;padding:3px 10px;font-size:0.7rem;color:#f87171;cursor:pointer;font-weight:700;white-space:nowrap;">🛡️ Absence Alert</button></div>
    <div style="display:flex;gap:0.4rem;margin-bottom:0.75rem;">
      <button class="btn-money btn-sm" onclick="markAtt(${activeIdx},'${today}','Present')">✅ Present</button>
      <button class="btn-danger btn-sm" onclick="markAtt(${activeIdx},'${today}','Absent')">❌ Absent</button>
      <button style="background:var(--warn);color:white;width:auto;padding:0.32rem 0.7rem;font-size:0.73rem;display:inline-block;margin:0;border-radius:10px;font-weight:700;cursor:pointer;" onclick="markAtt(${activeIdx},'${today}','Late')">⏰ Late</button>
    </div>
    <div>${days.map(d=>{const st=att[d]?.[s.name]||null;const cls=st==='Present'?'chip-ok':st==='Absent'?'chip-bad':st==='Late'?'chip-warn':'';return`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
      <span style="flex:1;">${d}</span>
      ${st?`<span class="chip ${cls}" style="margin-right:5px;">${st}</span>`:'<span style="color:var(--sub);font-size:0.7rem;margin-right:5px;">—</span>'}
      <div style="display:flex;gap:3px;" onclick="event.stopPropagation()">
        <button onclick="correctAttendance('${esc(s.name)}','${"'+d+'"}','Present')" title="Mark Present"
          style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;
          background:${st==='Present'?'var(--money)':'var(--s2)'};color:${st==='Present'?'white':'var(--text)'};">✅</button>
        <button onclick="correctAttendance('${esc(s.name)}','${"'+d+'"}','Absent')" title="Mark Absent"
          style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;
          background:${st==='Absent'?'var(--danger)':'var(--s2)'};color:${st==='Absent'?'white':'var(--text)'};">❌</button>
        <button onclick="correctAttendance('${esc(s.name)}','${"'+d+'"}','Late')" title="Mark Late"
          style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;
          background:${st==='Late'?'var(--warn)':'var(--s2)'};color:${st==='Late'?'white':'var(--text)'};">⏰</button>
      </div></div>`;}).join('')}</div></div>`;
}

async function markAtt(idx,date,status){
  const s=SD.students[idx];if(!s)return;
  if(!SD.attendance)SD.attendance={};
  if(!SD.attendance[date])SD.attendance[date]={};
  SD.attendance[date][s.name]=status;
  await SQ.push('attendance',SD.attendance);
  renderTab('attendance');
}

// SCORES TAB
function buildScores(s,idx){
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const terms = ['Term 1','Term 2','Term 3'];
  const curTerm = SD.config.currentTerm || 'Term 1';

  // scores structure: SD.scores[term][studentId][subject] = {ca1,ca2,ca3,exam}
  const sid = s.id || idx;
  const gradeRow = (tot) => {
    const {g,r} = gradeScore(tot);
    const col = g==='A'?'var(--money)':g==='B'?'#2563eb':g==='C'?'var(--warn)':g==='D'?'orange':'var(--danger)';
    return `<span style="font-weight:700;color:${col};font-size:0.8rem;">${g}</span>`;
  };

  const termTabs = terms.map(t =>
    `<button class="chip ${t===curTerm?'active':''}" onclick="scorecardSetTerm('${t}',${idx})" 
      style="padding:4px 10px;font-size:0.75rem;border-radius:20px;border:1px solid var(--border);
      background:${t===curTerm?'var(--brand)':'var(--s2)'};color:${t===curTerm?'white':'var(--text)'};cursor:pointer;margin:0 2px;">${t}</button>`
  ).join('');

  const buildTermTable = (term) => {
    const termData = (SD.scores[term]||{})[sid] || {};
    let totalSum=0, subCount=0;
    const rows = subs.map(sub => {
      const v = termData[sub] || {ca1:0,ca2:0,ca3:0,exam:0};
      const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
      const tot = caT + (v.exam||0);
      if(tot>0){totalSum+=tot;subCount++;}
      const {g,r} = gradeScore(tot);
      return `<tr>
        <td style="font-weight:600;font-size:0.76rem;max-width:90px;">${esc(sub)}</td>
        <td><input type="number" min="0" max="10" value="${v.ca1||''}" placeholder="0"
          onchange="updateScore(${idx},'${term}','${esc(sub)}','ca1',this.value)"
          style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td><input type="number" min="0" max="10" value="${v.ca2||''}" placeholder="0"
          onchange="updateScore(${idx},'${term}','${esc(sub)}','ca2',this.value)"
          style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td><input type="number" min="0" max="10" value="${v.ca3||''}" placeholder="0"
          onchange="updateScore(${idx},'${term}','${esc(sub)}','ca3',this.value)"
          style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td style="font-weight:700;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--sub);">${caT||''}</td>
        <td><input type="number" min="0" max="70" value="${v.exam||''}" placeholder="0"
          onchange="updateScore(${idx},'${term}','${esc(sub)}','exam',this.value)"
          style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td>
        <td style="font-weight:800;font-size:0.85rem;font-family:'DM Mono',monospace;
          color:${tot>=70?'var(--money)':tot>=50?'var(--text)':'var(--danger)'};">${tot||''}</td>
        <td>${tot>0?gradeRow(tot):''}</td>
      </tr>`;
    }).join('');
    const avg = subCount ? Math.round(totalSum/subCount) : 0;
    const {g:ag,r:ar} = gradeScore(avg);
    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table class="stbl" style="font-size:0.78rem;min-width:500px;">
        <thead><tr>
          <th>Subject</th><th style="font-size:0.7rem;">1st<br>CA/10</th>
          <th style="font-size:0.7rem;">2nd<br>CA/10</th><th style="font-size:0.7rem;">3rd<br>CA/10</th>
          <th style="font-size:0.7rem;">CA<br>Total</th><th style="font-size:0.7rem;">Exam<br>/70</th>
          <th style="font-size:0.7rem;">Total<br>/100</th><th>Grd</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        ${subCount>0?`<tfoot><tr style="background:var(--s2);">
          <td colspan="6" style="font-weight:700;font-size:0.8rem;">Class Average</td>
          <td style="font-weight:800;color:var(--brand);">${avg}</td>
          <td>${gradeRow(avg)}</td></tr></tfoot>`:''}
      </table>
    </div>`;
  };

  // Affective domain
  const aff = ((SD.affective||{})[sid]||{})[curTerm] || {};
  const affTraits = ['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
  const psyTraits = ['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const ratingStars = (trait,val,type) =>
    [5,4,3,2,1].map(n=>`<label style="cursor:pointer;font-size:1.1rem;color:${(val||0)>=n?'#f59e0b':'var(--border)'};"
      onclick="updateAffective(${idx},'${curTerm}','${type}_${trait}',${n})">★</label>`).join('');

  const affRows = affTraits.map(t=>
    `<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['aff_'+t]||0),'aff')}</td></tr>`
  ).join('');
  const psyRows = psyTraits.map(t=>
    `<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['psy_'+t]||0),'psy')}</td></tr>`
  ).join('');

  return `<div class="card" style="padding:0.75rem 0.5rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.4rem;">
      <div class="ct" style="margin:0;">📚 Scores</div>
      <div id="score-term-tabs-${idx}">${termTabs}</div>
    </div>
    <div id="score-table-${idx}">${buildTermTable(curTerm)}</div>
    <button class="btn-brand" style="margin-top:0.5rem;width:100%;" onclick="saveScores(${idx})">💾 Save Scores</button>
    <button class="btn-ghost" style="color:var(--danger);font-size:0.76rem;margin-top:0.3rem;width:100%;" onclick="clearStudentScores(${idx},\`${curTerm}\`)">🗑️ Clear All ${curTerm} Scores</button>

    <div class="ct" style="margin-top:1rem;">🌟 Behavioural Assessment (${curTerm})</div>
    <p style="font-size:0.72rem;color:var(--sub);margin-bottom:0.5rem;">Rate each trait ★★★★★ (5=Excellent, 1=Needs Work)</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
      <div>
        <div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">AFFECTIVE DOMAIN</div>
        <table class="stbl" style="font-size:0.78rem;">${affRows}</table>
      </div>
      <div>
        <div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">PSYCHOMOTOR SKILLS</div>
        <table class="stbl" style="font-size:0.78rem;">${psyRows}</table>
      </div>
    </div>
    <button class="btn-ghost" style="margin-top:0.5rem;width:100%;" onclick="printReportCard(${idx},'${curTerm}')">🖨️ Print Report Card</button>
  </div>`;
}

function scorecardSetTerm(term,idx){
  // Switch term tab in student score view
  const subs = SD.config.subjects || ['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const sid = SD.students[idx]?.id || idx;
  const termData = (SD.scores[term]||{})[sid] || {};
  // Rebuild table
  buildScores(SD.students[idx], idx); // Easiest: re-render whole tab
  const tabContent = document.getElementById('prof-tab-content');
  if(tabContent) tabContent.innerHTML = buildScores(SD.students[idx], idx);
  // Update tab button styles
  ['Term 1','Term 2','Term 3'].forEach(t=>{
    const btn = document.querySelector(`[onclick*="scorecardSetTerm('${t}'"]`);
    if(btn){
      btn.style.background = t===term ? 'var(--brand)' : 'var(--s2)';
      btn.style.color = t===term ? 'white' : 'var(--text)';
    }
  });
}


// FEES TAB
function buildFees(s,idx){
  // ── RBAC: Class/Subject Teachers cannot see fee data ─────────────────────
  if(!canSeeFees()){
    return`<div class="card" style="text-align:center;padding:1.5rem;color:var(--sub);">
      <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div>
      <div style="font-weight:700;font-size:0.88rem;color:var(--text);">Fee data is private</div>
      <div style="font-size:0.78rem;margin-top:0.3rem;">Only the Principal and Bursar can view fee information.</div>
    </div>`;
  }
  const owe=(s.totalFee||0)-(s.paid||0);
  const pct=s.totalFee?Math.min(100,Math.round(((s.paid||0)/s.totalFee)*100)):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;margin-bottom:0.65rem;">
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
    ${owe>0&&SD.config.plan==='premium'?`<button id="bc-btn-${idx}" class="btn-sm" style="background:linear-gradient(135deg,#059669,#065f46);color:#fff;border:none;border-radius:8px;padding:0.5rem;font-size:0.8rem;cursor:pointer;font-weight:700;width:100%;margin-top:0.4rem;" onclick="generatePaymentLink(${idx})">💳 Send BloomCollect Payment Link</button>`:''}
    ${(s.paymentHistory||[]).length?`<div style="margin-top:0.75rem;"><div style="font-weight:700;font-size:0.82rem;margin-bottom:0.4rem;">Payment History</div>${(s.paymentHistory||[]).map((p,pi)=>`
  <div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0;border-bottom:1px solid var(--border);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:0.8rem;font-weight:600;color:var(--money);">${fmt(p.amount)}</div>
      <div style="font-size:0.7rem;color:var(--sub);">${p.date} · ${p.method}</div>
    </div>
    <button onclick="editPayment(${idx},${pi})"
      style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
      padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
    <button onclick="deletePayment(${idx},${pi})"
      style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
      padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️ Del</button>
  </div>`).join('')}</div>`:''}
    </div>`;
}

async function recordPayment(idx){
  const amt=parseFloat($('pay-amt')?.value);if(!amt||amt<=0)return alert('Enter valid amount.');
  SD.students[idx].paid=(SD.students[idx].paid||0)+amt;
  if(!SD.students[idx].paymentHistory)SD.students[idx].paymentHistory=[];
  SD.students[idx].paymentHistory.unshift({amount:amt,method:$('pay-method')?.value||'Cash',date:$('pay-date')?.value||new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('students',SD.students); checkTierStatus();
  $('pay-amt').value='';renderTab('fees');renderBanner();renderRevenue();
  alert(`✅ ${fmt(amt)} recorded for ${SD.students[idx].name}`);
}

// ATTENDANCE TAB
function buildAttendance(s){
  const days=[];for(let i=0;i<14;i++){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
  const att=SD.attendance||{};
  const today=days[0];
  const present=days.filter(d=>att[d]?.[s.name]==='Present').length;
  const absent=days.filter(d=>att[d]?.[s.name]==='Absent').length;
  const late=days.filter(d=>att[d]?.[s.name]==='Late').length;
  const pct=days.length>0?Math.round((present/days.length)*100):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;">
    <div class="stat"><div class="sn" style="color:var(--money);">${present}</div><div class="sl">Present</div></div>
    <div class="stat"><div class="sn" style="color:var(--danger);">${absent}</div><div class="sl">Absent</div></div>
    <div class="stat"><div class="sn" style="color:var(--warn);">${late}</div><div class="sl">Late</div></div>
    </div><div class="prog-bg" style="margin-top:0.65rem;"><div class="prog-fill" style="width:${pct}%;"></div></div>
    <div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% attendance (last 14 days)</div></div>
    <div class="card"><div class="ct" style="display:flex;justify-content:space-between;align-items:center;"><span>📅 Mark Today (${today})</span><button onclick="checkMorningAbsentees()" style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.25);border-radius:7px;padding:3px 10px;font-size:0.7rem;color:#f87171;cursor:pointer;font-weight:700;white-space:nowrap;">🛡️ Absence Alert</button></div>
    <div style="display:flex;gap:0.4rem;margin-bottom:0.75rem;">
      <button class="btn-money btn-sm" onclick="markAtt(${activeIdx},'${today}','Present')">✅ Present</button>
      <button class="btn-danger btn-sm" onclick="markAtt(${activeIdx},'${today}','Absent')">❌ Absent</button>
      <button style="background:var(--warn);color:white;width:auto;padding:0.32rem 0.7rem;font-size:0.73rem;display:inline-block;margin:0;border-radius:10px;font-weight:700;cursor:pointer;" onclick="markAtt(${activeIdx},'${today}','Late')">⏰ Late</button>
    </div>
    <div>${days.map(d=>{const st=att[d]?.[s.name]||null;const cls=st==='Present'?'chip-ok':st==='Absent'?'chip-bad':st==='Late'?'chip-warn':'';return`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><span>${d}</span>${st?`<span class="chip ${cls}">${st}</span>`:'<span style="color:var(--sub);font-size:0.7rem;">—</span>'}</div>`;}).join('')}</div></div>`;
}

async function markAtt(idx,date,status){
  const s=SD.students[idx];if(!s)return;
  if(!SD.attendance)SD.attendance={};
  if(!SD.attendance[date])SD.attendance[date]={};
  SD.attendance[date][s.name]=status;
  await SQ.push('attendance',SD.attendance);
  renderTab('attendance');
}

// SCORES TAB
function buildScores(s,idx){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
      'Social Studies','Civic Education','Cultural & Creative Arts',
      'Computer Science','Physical & Health Education','Agricultural Science',
      'National Values Education','French Language','Home Economics',
      'Business Studies','Religious Studies'];
  const sc=s.scores||{};const term=SD.config.currentTerm||'Term 1';
  return`<div class="card"><div class="ct">📚 ${esc(term)} Scores</div>
    <p style="font-size:0.75rem;color:var(--sub);margin-bottom:0.65rem;">CA max 40 · Exam max 60 · Total 100</p>
    <table class="stbl"><thead><tr><th>Subject</th><th>CA/40</th><th>Exam/60</th><th>Total</th><th>Grade</th></tr></thead><tbody>
    ${subs.map(sub=>{const v=sc[sub]||{ca:0,exam:0};const tot=(v.ca||0)+(v.exam||0);const{g}=gradeScore(tot);
    return`<tr><td style="font-weight:600;font-size:0.8rem;">${esc(sub)}</td>
      <td><input type="number" min="0" max="40" value="${v.ca||''}" placeholder="0" onchange="updateScore(${idx},'${esc(sub)}','ca',this.value)" style="margin:0;"></td>
      <td><input type="number" min="0" max="60" value="${v.exam||''}" placeholder="0" onchange="updateScore(${idx},'${esc(sub)}','exam',this.value)" style="margin:0;"></td>
      <td style="font-weight:700;font-family:'DM Mono',monospace;">${tot||0}</td>
      <td class="g${g}">${g}</td></tr>`;}).join('')}
    </tbody></table>
    <button class="btn-brand" onclick="saveScores(${idx})">💾 Save Scores</button></div>`;
}

async function updateScore(idx,term,sub,field,val){
  const sid = SD.students[idx]?.id || idx;
  if(!SD.scores[term]) SD.scores[term]={};
  if(!SD.scores[term][sid]) SD.scores[term][sid]={};
  if(!SD.scores[term][sid][sub]) SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
  SD.scores[term][sid][sub][field] = parseInt(val)||0;
}

function updateAffective(idx,term,key,val){
  const sid = SD.students[idx]?.id || idx;
  if(!SD.affective[sid]) SD.affective[sid]={};
  if(!SD.affective[sid][term]) SD.affective[sid][term]={};
  SD.affective[sid][term][key] = val;
  saveLocal('affective', SD.affective);
  SQ.push({key:'affective', data:SD.affective});
}


// ══════════════════════════════════════════════════════════════════════════
// SCORECARD / BROADSHEET MODULE
// ══════════════════════════════════════════════════════════════════════════

function getGrade(tot){
  if(tot>=70)return{g:'A',r:'Excellent',col:'var(--money)'};
  if(tot>=60)return{g:'B',r:'Very Good',col:'#2563eb'};
  if(tot>=50)return{g:'C',r:'Good',col:'var(--warn)'};
  if(tot>=40)return{g:'D',r:'Fair',col:'orange'};
  return{g:'F',r:'Fail',col:'var(--danger)'};
}

function calcStudentTermStats(sid,term,subs){
  const td=(SD.scores[term]||{})[sid]||{};
  let total=0,count=0;const perSub={};
  subs.forEach(sub=>{
    const v=td[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
    const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot=caT+(v.exam||0);
    perSub[sub]={caT,exam:v.exam||0,tot};
    if(tot>0){total+=tot;count++;}
  });
  const avg=count?Math.round(total/count):0;
  return{perSub,total,count,avg};
}

function calcCumulative(sid,subs){
  const terms=['Term 1','Term 2','Term 3'];const cumSub={};
  subs.forEach(sub=>{
    let tSum=0,tCount=0;
    terms.forEach(term=>{
      const td=(SD.scores[term]||{})[sid]||{};
      const v=td[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
      const tot=(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
      if(tot>0){tSum+=tot;tCount++;}
    });
    cumSub[sub]=tCount?Math.round(tSum/tCount):0;
  });
  const totals=Object.values(cumSub).filter(v=>v>0);
  const avg=totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
  return{cumSub,avg};
}

function renderScorecard(){
  const el=document.getElementById('scorecard-content');
  if(!el)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const activeClass=el.dataset.cls||(classes[0]||'');
  const activeView=el.dataset.view||'Term 1';

  const classButtons=classes.map(c=>
    `<button onclick="scorecardSwitchClass('${esc(c)}')"
      style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);
      cursor:pointer;background:${c===activeClass?'var(--brand)':'var(--s2)'};
      color:${c===activeClass?'white':'var(--text)'};">${esc(c)}</button>`
  ).join('');
  const viewTabs=['Term 1','Term 2','Term 3','Cumulative'].map(v=>
    `<button onclick="scorecardSwitchView('${v}')"
      style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);
      cursor:pointer;background:${v===activeView?'var(--brand)':'var(--s2)'};
      color:${v===activeView?'white':'var(--text)'};">${v==='Cumulative'?'📊 Cumulative':v}</button>`
  ).join('');

  const classStudents=SD.students.filter(s=>s.class===activeClass);
  if(!classStudents.length){
    el.innerHTML=`<div class="card"><div class="ct">📋 Scorecard</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1rem;">${classButtons}</div>
      <p style="color:var(--sub);">No students in this class yet.</p></div>`;
    return;
  }
  const isCum=activeView==='Cumulative';
  const studentStats=classStudents.map(s=>{
    const sid=s.id||SD.students.indexOf(s);
    if(isCum){const{cumSub,avg}=calcCumulative(sid,subs);return{s,sid,perSub:cumSub,avg};}
    const{perSub,avg}=calcStudentTermStats(sid,activeView,subs);return{s,sid,perSub,avg};
  });
  const ranked=[...studentStats].sort((a,b)=>b.avg-a.avg);
  const posMap={};ranked.forEach((r,i)=>posMap[r.sid]=i+1);

  const subBest={};
  subs.forEach(sub=>{
    let best=null,bestScore=0;
    studentStats.forEach(({s,sid,perSub})=>{
      const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);
      if(v>bestScore){bestScore=v;best=s.name;}
    });
    if(bestScore>0)subBest[sub]={name:best,score:bestScore};
  });

  const subHeaders=subs.map(sub=>`<th style="font-size:0.6rem;writing-mode:vertical-lr;transform:rotate(180deg);padding:3px;min-width:26px;">${esc(sub)}</th>`).join('');
  const rows=studentStats.sort((a,b)=>posMap[a.sid]-posMap[b.sid]).map(({s,sid,perSub,avg})=>{
    const pos=posMap[sid];
    const{g,col}=getGrade(avg);
    const medal=pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':'';
    const subCells=subs.map(sub=>{
      const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);
      const{col:sc}=getGrade(v||0);
      return`<td style="text-align:center;font-size:0.74rem;font-weight:700;color:${v>0?sc:'var(--border)'};padding:3px 2px;">${v||'–'}</td>`;
    }).join('');
    return`<tr><td style="text-align:center;font-weight:700;font-size:0.72rem;color:${col};">${medal}${pos}</td>
      <td style="font-size:0.74rem;font-weight:600;white-space:nowrap;min-width:110px;">${esc(s.name)}</td>
      ${subCells}
      <td style="text-align:center;font-weight:800;font-size:0.82rem;color:${col};">${avg||'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.74rem;color:${col};">${avg>0?g:'–'}</span></td></tr>`;
  }).join('');

  const top3=ranked.filter(r=>r.avg>0).slice(0,3);
  const honoursCards=top3.map((r,i)=>{
    const medals=['🥇','🥈','🥉'];const labels=['Best Student','2nd','3rd'];
    const{col}=getGrade(r.avg);
    return`<div style="background:var(--s2);border-radius:10px;padding:0.5rem 0.7rem;border:1px solid var(--border);flex:1;min-width:90px;text-align:center;">
      <div style="font-size:1.3rem;">${medals[i]}</div>
      <div style="font-size:0.68rem;color:var(--sub);">${labels[i]}</div>
      <div style="font-weight:800;font-size:0.8rem;">${esc(r.s.name)}</div>
      <div style="font-weight:700;font-size:0.76rem;color:${col};">Avg: ${r.avg}</div></div>`;
  }).join('');

  el.dataset.cls=activeClass;el.dataset.view=activeView;
  el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;">
    <div class="ct">📋 Scorecard / Broadsheet</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.5rem;">${classButtons}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.7rem;">${viewTabs}</div>
    ${top3.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.7rem;">${honoursCards}</div>`:''}
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;">
      <table class="stbl" style="font-size:0.74rem;min-width:600px;border-collapse:collapse;">
        <thead><tr style="background:var(--s1);">
          <th style="font-size:0.68rem;min-width:28px;">#</th>
          <th style="font-size:0.68rem;text-align:left;min-width:110px;">Name</th>
          ${subHeaders}
          <th style="font-size:0.68rem;min-width:36px;">Avg</th>
          <th style="font-size:0.68rem;min-width:28px;">Grd</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${Object.keys(subBest).length?`<div class="ct" style="margin-top:0.9rem;">🏆 Subject Champions</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:0.3rem;">
      ${Object.entries(subBest).map(([sub,{name,score}])=>
        `<div style="background:var(--s2);border-radius:7px;padding:3px 8px;font-size:0.7rem;border:1px solid var(--border);">
          <span style="color:var(--sub);">${esc(sub)}:</span> <strong>${esc(name)}</strong> (${score})</div>`
      ).join('')}
    </div>`:''}
    <div style="display:flex;gap:0.5rem;margin-top:0.7rem;flex-wrap:wrap;">
      <button class="btn-ghost" onclick="printBroadsheet('${esc(activeClass)}','${activeView}')">🖨️ Print Broadsheet</button>
      <button class="btn-ghost" onclick="printAllReportCards('${esc(activeClass)}','${activeView==='Cumulative'?'Term 3':activeView}')">🖨️ Print All Cards</button>
      <button class="btn-ghost" style="background:var(--s2);" onclick="renderBulkScoreGrid('${esc(activeClass)}','${SD.config.currentTerm||'Term 1'}',0)">✏️ Bulk Score Entry</button>
      <button class="btn-brand" onclick="_wizState={cls:'${esc(activeClass)}',term:SD.config.currentTerm||'Term 1',step:1};renderWizard()">🧙 End-of-Term Wizard</button>
    </div>
  </div>`;
}

function scorecardSwitchClass(cls){const el=document.getElementById('scorecard-content');if(!el)return;el.dataset.cls=cls;renderScorecard();}
function scorecardSwitchView(view){const el=document.getElementById('scorecard-content');if(!el)return;el.dataset.view=view;renderScorecard();}

function printReportCard(idx,term){
  const s=SD.students[idx];if(!s)return;
  const sid=s.id||idx;
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const termData=(SD.scores[term]||{})[sid]||{};
  const aff=((SD.affective||{})[sid]||{})[term]||{};
  const cfg=SD.config;
  const classStudents=SD.students.filter(st=>st.class===s.class);
  const allAvgs=classStudents.map(st=>{
    const stid=st.id||SD.students.indexOf(st);
    const{avg}=calcStudentTermStats(stid,term,subs);
    return{name:st.name,avg};
  }).sort((a,b)=>b.avg-a.avg);
  const myPos=(allAvgs.findIndex(r=>r.name===s.name)+1)||'–';

  const rows=subs.map(sub=>{
    const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
    const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot=caT+(v.exam||0);
    const{g}=getGrade(tot);
    const subRanked=classStudents.map(st=>{
      const stid=st.id||SD.students.indexOf(st);
      const sv=(SD.scores[term]||{})[stid]||{};
      const svs=sv[sub]||{};
      const stot=(svs.ca1||0)+(svs.ca2||0)+(svs.ca3||0)+(svs.exam||0);
      return{name:st.name,tot:stot};
    }).sort((a,b)=>b.tot-a.tot);
    const sPos=(subRanked.findIndex(r=>r.name===s.name)+1)||'–';
    return`<tr><td>${sub}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td>
      <td>${caT||''}</td><td>${v.exam||''}</td>
      <td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td>
      <td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;
  }).join('');

  const totals=subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);
  const avg=totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
  const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
  const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';
  const affRows=affTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['aff_'+t]||0)}</td></tr>`).join('');
  const psyRows=psyTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['psy_'+t]||0)}</td></tr>`).join('');
  const daysPresent=Object.values(SD.attendance[s.name]||{}).filter(v=>v==='present').length;

  const w=window.open('','_blank','width=800,height=1100');
  if(!w)return alert('Please allow popups to print.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Card</title>
  <style>body{font-family:Arial,sans-serif;margin:0;padding:18px;color:#111;font-size:11.5px;}
  .hdr{text-align:center;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px;}
  .hdr h1{font-size:17px;margin:3px 0;}.hdr h2{font-size:12px;margin:2px 0;color:#555;}
  .ig{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:10px;}
  .sm{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0;}
  .sb{border:1px solid #ccc;border-radius:4px;padding:5px;text-align:center;}
  .sv{font-size:15px;font-weight:800;color:#2563eb;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;}
  th,td{border:1px solid #bbb;padding:3px 5px;}th{background:#f0f0f0;font-size:10.5px;}
  .st{font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin:8px 0 3px;}
  .rg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;}
  .rb{border:1px solid #ccc;border-radius:4px;padding:6px;min-height:45px;}
  .gk{display:flex;gap:5px;flex-wrap:wrap;font-size:9.5px;margin:5px 0;}
  .gki{padding:2px 5px;border-radius:3px;}
  @media print{button{display:none;}}</style>
  </head><body>
  <div class="hdr"><h1>${esc(cfg.schoolName||'School')}</h1>
  <h2>Report Card — ${term} &nbsp;|&nbsp; ${cfg.session||''}</h2></div>
  <div class="ig">
    <div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div>
    <div><b>Admission No:</b> ${esc(s.admissionNo||'–')}</div><div><b>Term:</b> ${term}</div>
    <div><b>Days Opened:</b> ${cfg.daysOpened||'–'}</div><div><b>Days Present:</b> ${daysPresent}</div>
  </div>
  <div class="sm">
    <div class="sb"><div class="sv">${avg||'–'}</div>Average</div>
    <div class="sb"><div class="sv">${avg>0?getGrade(avg).g:'–'}</div>Grade</div>
    <div class="sb"><div class="sv">${myPos}</div>Position</div>
    <div class="sb"><div class="sv">${classStudents.length}</div>In Class</div>
  </div>
  <div class="st">ACADEMIC PERFORMANCE</div>
  <table><thead><tr><th>Subject</th><th>1st CA</th><th>2nd CA</th><th>3rd CA</th>
    <th>CA /30</th><th>Exam /70</th><th>Total /100</th><th>Grade</th><th>Pos.</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="gk"><b>Grades:</b>
    <span class="gki" style="background:#d1fae5;">A 70-100 Excellent</span>
    <span class="gki" style="background:#dbeafe;">B 60-69 Very Good</span>
    <span class="gki" style="background:#fef9c3;">C 50-59 Good</span>
    <span class="gki" style="background:#ffedd5;">D 40-49 Fair</span>
    <span class="gki" style="background:#fee2e2;">F 0-39 Fail</span></div>
  <div class="rg">
    <div><div class="st">AFFECTIVE DOMAIN</div>
    <table><thead><tr><th>Trait</th><th>Rating</th></tr></thead><tbody>${affRows}</tbody></table></div>
    <div><div class="st">PSYCHOMOTOR SKILLS</div>
    <table><thead><tr><th>Skill</th><th>Rating</th></tr></thead><tbody>${psyRows}</tbody></table></div>
  </div>
  <div class="rg" style="margin-top:6px;">
    <div class="rb"><b>Class Teacher's Remark:</b><br><br>____________________</div>
    <div class="rb"><b>Principal's Comment:</b><br><br>____________________</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;">
    <div>Teacher's Signature: ______________</div>
    <div>Principal's Signature: ______________</div>
    <div>Next Term Begins: ______________</div>
    <div>Parent's Signature: ______________</div>
  </div>
  <div style="text-align:center;margin-top:10px;">
    <button onclick="window.print()" style="padding:7px 18px;cursor:pointer;">🖨️ Print / Save PDF</button>
  </div></body></html>`);
  w.document.close();
}

function printBroadsheet(cls,view){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const isCum=view==='Cumulative';
  const classStudents=SD.students.filter(s=>s.class===cls);
  const stats=classStudents.map(s=>{
    const sid=s.id||SD.students.indexOf(s);
    if(isCum){const{cumSub,avg}=calcCumulative(sid,subs);return{s,perSub:cumSub,avg};}
    const{perSub,avg}=calcStudentTermStats(sid,view,subs);return{s,perSub,avg};
  }).sort((a,b)=>b.avg-a.avg);
  const thCells=subs.map(s=>`<th style="writing-mode:vertical-lr;transform:rotate(180deg);font-size:9px;padding:2px;">${s}</th>`).join('');
  const rows=stats.map(({s,perSub,avg},i)=>{
    const cells=subs.map(sub=>{const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);return`<td style="text-align:center;font-size:9.5px;">${v||'–'}</td>`;}).join('');
    const{g}=getGrade(avg);
    return`<tr><td>${i+1}</td><td style="white-space:nowrap;font-size:10px;">${esc(s.name)}</td>${cells}<td style="font-weight:700;">${avg||'–'}</td><td>${avg>0?g:''}</td></tr>`;
  }).join('');
  const w=window.open('','_blank','width=1100,height=800');if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Broadsheet</title>
  <style>body{font-family:Arial;font-size:10px;padding:12px;}
  table{border-collapse:collapse;width:100%;}th,td{border:1px solid #999;padding:2px 4px;}
  th{background:#f0f0f0;font-weight:700;}@media print{button{display:none;}}</style>
  </head><body>
  <h2 style="text-align:center;margin-bottom:3px;">${esc(SD.config.schoolName||'School')} — Broadsheet</h2>
  <h3 style="text-align:center;margin-bottom:8px;">${esc(cls)} &nbsp;|&nbsp; ${view==='Cumulative'?'Cumulative (All Terms)':view} &nbsp;|&nbsp; ${SD.config.session||''}</h3>
  <table><thead><tr><th>#</th><th>Student Name</th>${thCells}<th>Avg</th><th>Grd</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <button onclick="window.print()" style="margin-top:8px;padding:5px 14px;cursor:pointer;">🖨️ Print</button>
  </body></html>`);
  w.document.close();
}


// ═══════════════════════════════════════════════════════════════════════
// BULK SCORE ENTRY GRID
// ═══════════════════════════════════════════════════════════════════════

function renderBulkScoreGrid(cls, term, subIdx){
  const subs = SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const sub = subs[subIdx] || subs[0];
  const classStudents = SD.students.filter(s=>s.class===cls);
  const el = document.getElementById('scorecard-content');
  if(!el) return;

  const subTabs = subs.map((s,i)=>
    `<button onclick="renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${i})"
      style="padding:4px 9px;border-radius:16px;font-size:0.72rem;white-space:nowrap;
      border:1px solid var(--border);cursor:pointer;
      background:${i===subIdx?'var(--brand)':'var(--s2)'};
      color:${i===subIdx?'white':'var(--text)'};">${esc(s)}</button>`
  ).join('');

  const rows = classStudents.map((s,i)=>{
    const sid = s.id || SD.students.indexOf(s);
    const v = ((SD.scores[term]||{})[sid]||{})[sub] || {ca1:0,ca2:0,ca3:0,exam:0};
    const caT = (v.ca1||0)+(v.ca2||0)+(v.ca3||0);
    const tot = caT + (v.exam||0);
    const {g,col} = getGrade(tot);
    const tabBase = i*4;
    return`<tr id="bsg-row-${i}" style="${tot>=70?'background:rgba(16,185,129,0.04)':''}">
      <td style="font-size:0.76rem;font-weight:600;padding:5px 6px;white-space:nowrap;">${esc(s.name)}</td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca1||''}"
        tabindex="${tabBase+1}" placeholder="0"
        onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca1',this.value)"
        onkeydown="bsgNav(event,${i},0,${classStudents.length})"
        style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;
        border:1px solid ${v.ca1?'var(--brand)':'var(--border)'};border-radius:6px;"
        id="bsg-${i}-0"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca2||''}"
        tabindex="${tabBase+2}" placeholder="0"
        onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca2',this.value)"
        onkeydown="bsgNav(event,${i},1,${classStudents.length})"
        style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;
        border:1px solid ${v.ca2?'var(--brand)':'var(--border)'};border-radius:6px;"
        id="bsg-${i}-1"></td>
      <td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca3||''}"
        tabindex="${tabBase+3}" placeholder="0"
        onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'ca3',this.value)"
        onkeydown="bsgNav(event,${i},2,${classStudents.length})"
        style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;
        border:1px solid ${v.ca3?'var(--brand)':'var(--border)'};border-radius:6px;"
        id="bsg-${i}-2"></td>
      <td style="padding:2px;"><input type="number" min="0" max="70" value="${v.exam||''}"
        tabindex="${tabBase+4}" placeholder="0"
        onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${esc(sub)}',${i},'exam',this.value)"
        onkeydown="bsgNav(event,${i},3,${classStudents.length})"
        style="width:48px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;
        border:1px solid ${v.exam?'var(--brand)':'var(--border)'};border-radius:6px;"
        id="bsg-${i}-3"></td>
      <td style="text-align:center;font-weight:700;font-family:'DM Mono',monospace;
        font-size:0.82rem;color:${tot>0?'var(--text)':'var(--border)'};">${tot||'–'}</td>
      <td style="text-align:center;"><span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span></td>
    </tr>`;
  }).join('');

  // count entered
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

    <p style="font-size:0.74rem;color:var(--sub);margin-bottom:0.5rem;">
      📌 <strong>${esc(sub)}</strong> &nbsp;·&nbsp; ${entered}/${classStudents.length} students entered
      &nbsp;·&nbsp; Tab/Enter to move between cells
    </p>

    <!-- Subject tabs -->
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;overflow-x:auto;padding-bottom:4px;">
      ${subTabs}
    </div>

    <!-- Score grid -->
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;">
      <table class="stbl" style="font-size:0.78rem;min-width:380px;">
        <thead><tr style="background:var(--s1);">
          <th style="text-align:left;min-width:110px;">Student</th>
          <th style="min-width:50px;font-size:0.7rem;">1st CA<br><span style="color:var(--sub)">/10</span></th>
          <th style="min-width:50px;font-size:0.7rem;">2nd CA<br><span style="color:var(--sub)">/10</span></th>
          <th style="min-width:50px;font-size:0.7rem;">3rd CA<br><span style="color:var(--sub)">/10</span></th>
          <th style="min-width:54px;font-size:0.7rem;">Exam<br><span style="color:var(--sub)">/70</span></th>
          <th style="min-width:40px;font-size:0.7rem;">Total<br><span style="color:var(--sub)">/100</span></th>
          <th style="min-width:32px;font-size:0.7rem;">Grd</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Next subject quick nav -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem;flex-wrap:wrap;gap:0.4rem;">
      ${subIdx>0?`<button class="btn-ghost" style="font-size:0.76rem;padding:5px 12px;"
        onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx-1})">
        ← ${esc(subs[subIdx-1]||'')}</button>`:'<div></div>'}
      ${subIdx<subs.length-1?`<button class="btn-brand" style="font-size:0.76rem;padding:5px 12px;"
        onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx+1})">
        ${esc(subs[subIdx+1]||'')} →</button>`:`<button class="btn-brand" style="font-size:0.76rem;padding:5px 14px;"
        onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderScorecard()">
        ✅ Done — View Broadsheet</button>`}
    </div>
  </div>`;

  // Focus first empty cell
  setTimeout(()=>{
    for(let i=0;i<classStudents.length;i++){
      const el=document.getElementById(`bsg-${i}-3`);
      if(el&&!el.value){el.focus();break;}
    }
  },100);
}

function bsgUpdate(cls,term,sub,rowIdx,field,val){
  const classStudents=SD.students.filter(s=>s.class===cls);
  const s=classStudents[rowIdx]; if(!s) return;
  const sid=s.id||SD.students.indexOf(s);
  if(!SD.scores[term]) SD.scores[term]={};
  if(!SD.scores[term][sid]) SD.scores[term][sid]={};
  if(!SD.scores[term][sid][sub]) SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
  SD.scores[term][sid][sub][field]=parseInt(val)||0;
  // Live update total cell
  const v=SD.scores[term][sid][sub];
  const tot=(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
  const row=document.getElementById('bsg-row-'+rowIdx);
  if(row){
    const cells=row.querySelectorAll('td');
    const {g,col}=getGrade(tot);
    if(cells[5]) cells[5].textContent=tot||'–';
    if(cells[6]) cells[6].innerHTML=`<span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span>`;
    row.style.background=tot>=70?'rgba(16,185,129,0.04)':'';
    // highlight border
    const inp=document.getElementById(`bsg-${rowIdx}-${['ca1','ca2','ca3','exam'].indexOf(field)}`);
    if(inp) inp.style.borderColor=val?'var(--brand)':'var(--border)';
  }
}

function bsgNav(e,row,col,total){
  // Enter or ArrowDown → next row same col; ArrowUp → prev row same col
  if(e.key==='Enter'||e.key==='ArrowDown'){
    e.preventDefault();
    const next=document.getElementById(`bsg-${row+1}-${col}`);
    if(next) next.focus();
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    const prev=document.getElementById(`bsg-${row-1}-${col}`);
    if(prev) prev.focus();
  }
}

function bsgSaveAll(cls,term){
  saveLocal('scores',SD.scores);
  SQ.push({key:'scores',data:SD.scores});
  toast('✅ Scores saved!');
}

// ═══════════════════════════════════════════════════════════════════════
// PRINT ALL REPORT CARDS AT ONCE
// ═══════════════════════════════════════════════════════════════════════

function printAllReportCards(cls, term){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];
  const classStudents=SD.students.filter(s=>s.class===cls);
  if(!classStudents.length){toast('No students in this class.');return;}
  const cfg=SD.config;

  // Pre-compute positions
  const allAvgs=classStudents.map(s=>{
    const sid=s.id||SD.students.indexOf(s);
    const {avg}=calcStudentTermStats(sid,term,subs);
    return{name:s.name,avg};
  }).sort((a,b)=>b.avg-a.avg);

  const cards=classStudents.map(s=>{
    const sid=s.id||SD.students.indexOf(s);
    const termData=(SD.scores[term]||{})[sid]||{};
    const aff=((SD.affective||{})[sid]||{})[term]||{};
    const myPos=(allAvgs.findIndex(r=>r.name===s.name)+1)||'–';
    const daysPresent=Object.values(SD.attendance[s.name]||{}).filter(v=>v==='present').length;

    const rows=subs.map(sub=>{
      const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
      const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);
      const tot=caT+(v.exam||0);
      const{g}=getGrade(tot);
      const subRanked=classStudents.map(st=>{
        const stid=st.id||SD.students.indexOf(st);
        const sv=((SD.scores[term]||{})[stid]||{})[sub]||{};
        return{name:st.name,tot:(sv.ca1||0)+(sv.ca2||0)+(sv.ca3||0)+(sv.exam||0)};
      }).sort((a,b)=>b.tot-a.tot);
      const sPos=(subRanked.findIndex(r=>r.name===s.name)+1)||'–';
      return`<tr><td>${sub}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td>
        <td>${caT||''}</td><td>${v.exam||''}</td>
        <td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td>
        <td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;
    }).join('');
    const totals=subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);
    const avg=totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
    const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
    const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
    const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';
    const affRows=affTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['aff_'+t]||0)}</td></tr>`).join('');
    const psyRows=psyTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['psy_'+t]||0)}</td></tr>`).join('');

    return`<div class="card-page" style="page-break-after:always;padding:18px;font-family:Arial,sans-serif;font-size:11.5px;color:#111;max-width:720px;margin:0 auto;">
      <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:10px;">
        <h1 style="font-size:17px;margin:3px 0;">${esc(cfg.schoolName||'School')}</h1>
        <h2 style="font-size:12px;margin:2px 0;color:#555;">Student Report Card — ${term} ${cfg.session||''}</h2>
        ${cfg.address?`<p style="font-size:10px;margin:1px 0;">${esc(cfg.address)}</p>`:''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px;">
        <div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div>
        <div><b>Admission No:</b> ${esc(s.admissionNo||'–')}</div><div><b>Term:</b> ${term}</div>
        <div><b>Days Opened:</b> ${cfg.daysOpened||'–'}</div><div><b>Days Present:</b> ${daysPresent}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0;text-align:center;">
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg||'–'}</div>Average</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg>0?getGrade(avg).g:'–'}</div>Grade</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${myPos}</div>Position</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${classStudents.length}</div>In Class</div>
      </div>
      <div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin:6px 0 3px;">ACADEMIC PERFORMANCE</div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:8px;">
        <thead><tr style="background:#f0f0f0;">
          <th style="border:1px solid #bbb;padding:3px 4px;text-align:left;">Subject</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">1st CA</th><th style="border:1px solid #bbb;padding:3px 2px;">2nd CA</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">3rd CA</th><th style="border:1px solid #bbb;padding:3px 2px;">CA/30</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">Exam/70</th><th style="border:1px solid #bbb;padding:3px 2px;font-weight:700;">Total/100</th>
          <th style="border:1px solid #bbb;padding:3px 2px;">Grade</th><th style="border:1px solid #bbb;padding:3px 2px;">Pos.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:5px;flex-wrap:wrap;font-size:9.5px;margin:4px 0 6px;">
        <b>Grades:</b>
        <span style="padding:1px 5px;border-radius:3px;background:#d1fae5;">A 70-100 Excellent</span>
        <span style="padding:1px 5px;border-radius:3px;background:#dbeafe;">B 60-69 Very Good</span>
        <span style="padding:1px 5px;border-radius:3px;background:#fef9c3;">C 50-59 Good</span>
        <span style="padding:1px 5px;border-radius:3px;background:#ffedd5;">D 40-49 Fair</span>
        <span style="padding:1px 5px;border-radius:3px;background:#fee2e2;">F 0-39 Fail</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <div><div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin-bottom:3px;">AFFECTIVE DOMAIN</div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;text-align:left;">Trait</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead>
            <tbody>${affRows}</tbody></table></div>
        <div><div style="font-weight:700;font-size:11px;background:#e8e8e8;padding:3px 5px;margin-bottom:3px;">PSYCHOMOTOR SKILLS</div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;text-align:left;">Skill</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead>
            <tbody>${psyRows}</tbody></table></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Class Teacher's Remark:</b><br><br>____________________</div>
        <div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Principal's Comment:</b><br><br>____________________</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;flex-wrap:wrap;gap:4px;">
        <div>Teacher's Signature: ______________</div>
        <div>Principal's Signature: ______________</div>
        <div>Next Term Begins: ______________</div>
        <div>Parent's Signature: ______________</div>
      </div>
    </div>`;
  }).join('\n');

  const w=window.open('','_blank','width=820,height=900');
  if(!w)return alert('Please allow popups.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Report Cards – ${esc(cls)} – ${term}</title>
  <style>
    body{margin:0;padding:10px;background:#f5f5f5;}
    .card-page{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);margin-bottom:20px;}
    table td,table th{border:1px solid #bbb;padding:3px 4px;}
    @media print{
      body{background:none;padding:0;}
      .card-page{box-shadow:none;margin:0;page-break-after:always;}
      .no-print{display:none;}
    }
  </style>
  </head><body>
  <div class="no-print" style="position:sticky;top:0;background:#1e293b;color:white;
    padding:10px 16px;display:flex;align-items:center;gap:12px;z-index:999;font-family:sans-serif;">
    <span style="font-weight:700;">📋 ${classStudents.length} Report Cards — ${esc(cls)} · ${term}</span>
    <button onclick="window.print()" style="padding:6px 18px;background:#22c55e;color:white;
      border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;">🖨️ Print All / Save PDF</button>
    <span style="font-size:11px;color:#94a3b8;">Tip: In print dialog → "Save as PDF" to get a digital copy</span>
  </div>
  ${cards}
  </body></html>`);
  w.document.close();
}

// ═══════════════════════════════════════════════════════════════════════
// END-OF-TERM WIZARD
// ═══════════════════════════════════════════════════════════════════════

let _wizState = {cls:'', term:'', step:1};

function renderWizard(){
  const el=document.getElementById('scorecard-content');
  if(!el)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const {cls,term,step}=_wizState;
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology',
    'Social Studies','Civic Education','Cultural & Creative Arts','Computer Science',
    'Physical & Health Education','Agricultural Science','National Values Education',
    'French Language','Home Economics','Business Studies','Religious Studies'];

  if(step===1){
    const classOpts=classes.map(c=>`<option value="${esc(c)}" ${c===cls?'selected':''}>${esc(c)}</option>`).join('');
    el.innerHTML=`<div class="card" style="padding:1rem 0.75rem;max-width:440px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:1rem;">
        <div style="font-size:2rem;">📋</div>
        <div style="font-weight:800;font-size:1.05rem;">End-of-Term Wizard</div>
        <p style="color:var(--sub);font-size:0.8rem;margin-top:4px;">
          Close out the term in 3 steps — score entry, review rankings, print all cards.
        </p>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.6rem;">
        <div>
          <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Class</label>
          <select id="wiz-class" style="width:100%;font-size:0.9rem;">
            ${classOpts}
          </select>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Term to close</label>
          <select id="wiz-term" style="width:100%;font-size:0.9rem;">
            <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
            <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
            <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option>
          </select>
        </div>
        <button class="btn-brand" style="margin-top:0.4rem;padding:0.65rem;" onclick="wizNext1()">
          Let's go → Step 1: Enter Scores
        </button>
        <button class="btn-ghost" style="font-size:0.78rem;" onclick="renderScorecard()">← Back to Broadsheet</button>
      </div>
      <div style="margin-top:1rem;background:var(--s2);border-radius:8px;padding:0.6rem 0.75rem;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:4px;">WHAT THE WIZARD DOES</div>
        <div style="font-size:0.76rem;display:flex;flex-direction:column;gap:3px;">
          <div>✏️ <b>Step 1:</b> Enter scores for all subjects class by class</div>
          <div>📊 <b>Step 2:</b> Review computed rankings &amp; honours board</div>
          <div>🖨️ <b>Step 3:</b> Print all ${cls?SD.students.filter(s=>s.class===cls).length:''} report cards in one click</div>
        </div>
      </div>
    </div>`;
    return;
  }

  if(step===2){
    // Step 2: Bulk score entry for all subjects — reuse bsg but with wizard chrome
    const classStudents=SD.students.filter(s=>s.class===cls);
    const totalSubs=subs.length;
    const subsDone=subs.filter(sub=>{
      return classStudents.some(s=>{
        const sid=s.id||SD.students.indexOf(s);
        const v=((SD.scores[term]||{})[sid]||{})[sub]||{};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;
      });
    }).length;
    const pct=Math.round(subsDone/totalSubs*100);

    // Progress bar + subject completion chips
    const subChips=subs.map((sub,i)=>{
      const done=classStudents.some(s=>{
        const sid=s.id||SD.students.indexOf(s);
        const v=((SD.scores[term]||{})[sid]||{})[sub]||{};
        return (v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;
      });
      return`<div onclick="wizOpenSubject(${i})" style="padding:3px 8px;border-radius:12px;font-size:0.7rem;
        cursor:pointer;border:1px solid ${done?'var(--money)':'var(--border)'};
        background:${done?'rgba(16,185,129,0.08)':'var(--s2)'};
        color:${done?'var(--money)':'var(--text)'};">
        ${done?'✅':'○'} ${esc(sub)}</div>`;
    }).join('');

    el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=1;renderWizard()">← Back</button>
        <div class="ct" style="margin:0;flex:1;">Step 1: Enter Scores — ${esc(cls)} · ${term}</div>
        <button class="btn-brand" style="padding:5px 12px;font-size:0.78rem;" onclick="wizStep3()">Next: Review Rankings →</button>
      </div>

      <!-- Progress -->
      <div style="background:var(--s2);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.65rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:0.78rem;font-weight:700;">${subsDone}/${totalSubs} subjects entered</span>
          <span style="font-size:0.76rem;color:var(--brand);font-weight:700;">${pct}%</span>
        </div>
        <div style="background:var(--border);border-radius:6px;height:7px;">
          <div style="background:var(--brand);width:${pct}%;height:7px;border-radius:6px;transition:width 0.3s;"></div>
        </div>
      </div>

      <!-- Subject chips -->
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;">${subChips}</div>
      <p style="font-size:0.74rem;color:var(--sub);">Tap a subject above to open its score entry grid. Green = scores entered.</p>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;font-size:0.8rem;" onclick="wizOpenSubject(0)">✏️ Start with ${esc(subs[0])}</button>
        <button class="btn-ghost" style="font-size:0.78rem;" onclick="wizStep3()">Skip to Rankings →</button>
      </div>
    </div>`;
    return;
  }

  if(step===3){
    // Step 3: Rankings review
    const classStudents=SD.students.filter(s=>s.class===cls);
    const stats=classStudents.map(s=>{
      const sid=s.id||SD.students.indexOf(s);
      const{avg,count}=calcStudentTermStats(sid,term,subs);
      return{s,avg,count};
    }).sort((a,b)=>b.avg-a.avg);
    const entered=stats.filter(r=>r.count>0).length;
    const medals=['🥇','🥈','🥉'];
    const honours=stats.filter(r=>r.avg>0).slice(0,3).map((r,i)=>{
      const{g,col}=getGrade(r.avg);
      return`<div style="background:var(--s2);border-radius:10px;padding:0.6rem 0.75rem;text-align:center;flex:1;min-width:100px;border:1px solid var(--border);">
        <div style="font-size:1.5rem;">${medals[i]}</div>
        <div style="font-weight:800;font-size:0.82rem;">${esc(r.s.name)}</div>
        <div style="font-size:0.76rem;color:${col};font-weight:700;">Avg: ${r.avg} · Grade ${g}</div>
      </div>`;
    }).join('');
    const rankRows=stats.map((r,i)=>{
      const{g,col}=getGrade(r.avg);
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      return`<tr>
        <td style="text-align:center;font-weight:700;color:${col};">${medal}${i+1}</td>
        <td style="font-size:0.78rem;font-weight:600;">${esc(r.s.name)}</td>
        <td style="text-align:center;font-weight:800;color:${col};">${r.avg||'–'}</td>
        <td style="text-align:center;"><span style="font-weight:700;color:${col};">${r.avg>0?g:'–'}</span></td>
      </tr>`;
    }).join('');

    el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=2;renderWizard()">← Back to Scores</button>
        <div class="ct" style="margin:0;flex:1;">Step 2: Rankings — ${esc(cls)} · ${term}</div>
      </div>
      <p style="font-size:0.76rem;color:var(--sub);margin-bottom:0.65rem;">${entered}/${classStudents.length} students have scores entered</p>
      ${honours?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.75rem;">${honours}</div>`:''}
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:0.65rem;">
        <table class="stbl" style="font-size:0.78rem;">
          <thead><tr style="background:var(--s1);">
            <th style="width:36px;">#</th><th style="text-align:left;">Student</th>
            <th>Average</th><th>Grade</th>
          </tr></thead>
          <tbody>${rankRows}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="btn-ghost" style="flex:1;" onclick="_wizState.step=2;renderWizard()">← Fix Scores</button>
        <button class="btn-brand" style="flex:2;font-size:0.88rem;padding:0.65rem;"
          onclick="wizPrintAll()">🖨️ Print All ${classStudents.length} Report Cards →</button>
      </div>
    </div>`;
    return;
  }
}

function wizNext1(){
  _wizState.cls=document.getElementById('wiz-class')?.value||'';
  _wizState.term=document.getElementById('wiz-term')?.value||'Term 1';
  _wizState.step=2;renderWizard();
}
function wizOpenSubject(subIdx){
  const{cls,term}=_wizState;
  // Open bulk grid, but back button returns to wizard step 2
  renderBulkScoreGrid(cls,term,subIdx);
  // Patch back button to return to wizard
  setTimeout(()=>{
    const backBtns=document.querySelectorAll('#scorecard-content button');
    backBtns.forEach(b=>{if(b.textContent.includes('← Broadsheet')){
      b.textContent='← Back to Wizard';
      b.onclick=()=>{_wizState.step=2;renderWizard();};
    }});
  },80);
}
function wizStep3(){_wizState.step=3;renderWizard();}
function wizPrintAll(){
  const{cls,term}=_wizState;
  printAllReportCards(cls,term);
}

function saveScores(idx){
  saveLocal('scores', SD.scores);
  SQ.push({key:'scores', data:SD.scores});
  toast('✅ Scores saved!');
}



function renderStaff(){
  const staff=SD.staff||[];
  const isPrem=SD.config.plan==='premium';
  const limit=isPrem?'∞':3;
  if($('staff-count')) $('staff-count').textContent=`${staff.length}/${limit} (${isPrem?'Premium':'Basic'})`;
  const el=$('staff-list'); if(!el) return;
  if(!staff.length){
    el.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No staff added yet.</p>';return;
  }
  el.innerHTML=staff.map((s,i)=>`
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.88rem;">${esc(s.name)}</div>
        <div style="font-size:0.72rem;color:var(--sub);">${s.email||''} · ${(s.role||'').replace('_',' ')}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="editStaff(${i})"
          style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
          padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
        ${s.role!=='Principal'?`<button onclick="deleteStaff(${i})"
          style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
          padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#dc2626;white-space:nowrap;">🗑️</button>`:''}
      </div>
    </div>`).join('');
  const atLimit=!isPrem&&staff.length>=3;
  if($('staff-upgrade')) $('staff-upgrade').style.display=atLimit?'block':'none';
}

function renderExpenses(){
  const exp=SD.expenses||[];
  let total=0; exp.forEach(e=>total+=e.amount||0);
  if($('exp-total')) $('exp-total').textContent=fmt(total);
  const el=$('exp-list'); if(!el) return;
  if(!exp.length){
    el.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No expenses logged yet.</p>';return;
  }
  el.innerHTML=exp.map((e,i)=>`
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;font-weight:600;">${esc(e.description||'')}</div>
        <div style="font-size:0.7rem;color:var(--sub);">${e.category||''} · ${e.date||''}</div>
      </div>
      <strong style="font-family:'DM Mono',monospace;color:var(--danger);font-size:0.82rem;flex-shrink:0;">${fmt(e.amount||0)}</strong>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="editExpense(${i})"
          style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
          padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️ Edit</button>
        <button onclick="deleteExpenseItem(${i})"
          style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
          padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️ Del</button>
      </div>
    </div>`).join('');
}

async function addStaff(){
  const name=$('sf-name').value.trim(),email=$('sf-email').value.trim(),pwd=$('sf-pwd').value,role=$('sf-role').value;
  const assignedClass=($('sf-class')?.value||'').trim();
  const assignedSubjectsRaw=($('sf-subjects')?.value||'').trim();
  const assignedSubjects=assignedSubjectsRaw?assignedSubjectsRaw.split(',').map(s=>s.trim()).filter(Boolean):[];
  if(!name||!email||!pwd)return alert('Fill all fields.');if(pwd.length<4)return alert('Password min 4 chars.');
  if(role==='Class Teacher'&&!assignedClass)return alert('Assign a class for this Class Teacher (e.g. JSS 1A).');
  if((SD.staff||[]).find(s=>s.email===email))return alert('Email already registered.');
  const isPrem=SD.config.plan==='premium';
  if(!isPrem&&(SD.staff||[]).length>=3){openUpgradeModal();return;}
  if(!SD.staff)SD.staff=[];
  SD.staff.push({name,email,password:pwd,role,assignedClass:assignedClass||null,assignedSubjects});
  await SQ.push('staff',SD.staff);
  closeM('add-staff-modal');
  $('sf-name').value='';$('sf-email').value='';$('sf-pwd').value='';
  const sfc=$('sf-class'); if(sfc)sfc.value='';
  const sfs=$('sf-subjects'); if(sfs)sfs.value='';
  renderStaff();alert(`✅ ${name} added as ${role}${assignedClass?' ('+assignedClass+')':''}.`);
}

// Show/hide class and subject fields based on selected role
function onRoleChange(sel){
  const role=sel.value;
  const classRow=$('sf-class-row'); if(classRow) classRow.style.display=role==='Class Teacher'?'block':'none';
  const subjectRow=$('sf-subjects-row'); if(subjectRow) subjectRow.style.display=role==='Subject Teacher'?'block':'none';
}
async function addExpense(){
  const cat=$('exp-cat').value,desc=$('exp-desc').value.trim(),amt=parseFloat($('exp-amt').value);
  if(!desc||!amt)return alert('Fill description and amount.');
  if(!SD.expenses)SD.expenses=[];
  SD.expenses.unshift({category:cat,description:desc,amount:amt,date:new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('expenses',SD.expenses);closeM('add-expense-modal');
  $('exp-desc').value='';$('exp-amt').value='';renderExpenses();
}
// ═══════════════════════════════════════════════════════════════════════════
// EDIT & DELETE — COMPLETE CORRECTION SYSTEM FOR ALL DATA AREAS
// ═══════════════════════════════════════════════════════════════════════════

// ── STUDENT: Edit name / class / phone / fee ─────────────────────────────
function editStudent(idx){
  const s = SD.students[idx]; if(!s) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Student</div>
      <label style="font-size:0.8rem;font-weight:600;">Full Name</label>
      <input id="edit-s-name" value="${esc(s.name)}" placeholder="Full name">
      <label style="font-size:0.8rem;font-weight:600;">Phone</label>
      <input id="edit-s-phone" value="${esc(s.phone||'')}" placeholder="Phone">
      <label style="font-size:0.8rem;font-weight:600;">Class</label>
      <input id="edit-s-class" value="${esc(s.class||'')}" placeholder="e.g. Basic Two">
      <label style="font-size:0.8rem;font-weight:600;">Total Fee (₦)</label>
      <input id="edit-s-fee" type="number" value="${s.totalFee||''}" placeholder="e.g. 50000">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditStudent(${idx})">💾 Save Changes</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-student-modal')">Cancel</button>
      </div>
    </div>`;
  let modal = document.getElementById('edit-student-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'edit-student-modal';
    modal.className = 'modal';
    const box = document.createElement('div');
    box.className = 'mbox';
    box.innerHTML = '<button class="mclose" onclick="closeM(\'edit-student-modal\')">✕</button><div id="edit-student-modal-body"></div>';
    modal.appendChild(box);
    document.body.appendChild(modal);
  }
  document.getElementById('edit-student-modal-body').innerHTML = html;
  openM('edit-student-modal');
}

async function saveEditStudent(idx){
  const s = SD.students[idx]; if(!s) return;
  const oldName = s.name;
  const newName = document.getElementById('edit-s-name').value.trim();
  if(!newName) return alert('Name cannot be empty.');
  s.name  = newName;
  s.phone = document.getElementById('edit-s-phone').value.trim().replace(/\D/g,'');
  s.class = document.getElementById('edit-s-class').value.trim();
  s.totalFee = parseFloat(document.getElementById('edit-s-fee').value)||s.totalFee||50000;
  // Migrate attendance keys if name changed
  if(oldName !== newName && SD.attendance){
    Object.keys(SD.attendance).forEach(date=>{
      if(SD.attendance[date][oldName] !== undefined){
        SD.attendance[date][newName] = SD.attendance[date][oldName];
        delete SD.attendance[date][oldName];
      }
    });
    await SQ.push('attendance', SD.attendance);
    saveLocal('attendance', SD.attendance);
  }
  await SQ.push('students', SD.students);
  saveLocal('students', SD.students);
  closeM('edit-student-modal');
  renderStudentList();
  renderBanner();
  renderRevenue();
  toast('✅ Student updated!');
}

// ── PAYMENT: Delete a specific payment from history ──────────────────────
async function deletePayment(studentIdx, payIdx){
  const s = SD.students[studentIdx]; if(!s) return;
  const p = (s.paymentHistory||[])[payIdx];
  if(!p) return;
  if(!confirm(`Delete payment of ${fmt(p.amount)} on ${p.date}?`)) return;
  s.paid = Math.max(0, (s.paid||0) - (p.amount||0));
  s.paymentHistory.splice(payIdx, 1);
  await SQ.push('students', SD.students);
  saveLocal('students', SD.students);
  renderTab(studentIdx, 'fees');
  toast('🗑️ Payment deleted.');
}

// Edit a payment amount/date/method
function editPayment(studentIdx, payIdx){
  const s = SD.students[studentIdx]; if(!s) return;
  const p = (s.paymentHistory||[])[payIdx]; if(!p) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Payment</div>
      <label style="font-size:0.8rem;font-weight:600;">Amount (₦)</label>
      <input id="ep-amt" type="number" value="${p.amount||''}">
      <label style="font-size:0.8rem;font-weight:600;">Method</label>
      <select id="ep-method">
        ${['Bank Transfer','Cash','POS','Online'].map(m=>`<option ${m===p.method?'selected':''}>${m}</option>`).join('')}
      </select>
      <label style="font-size:0.8rem;font-weight:600;">Date</label>
      <input id="ep-date" type="date" value="${p.date||''}">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditPayment(${studentIdx},${payIdx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-payment-modal')">Cancel</button>
      </div>
    </div>`;
  let modal = document.getElementById('edit-payment-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'edit-payment-modal';
    modal.className = 'modal';
    const box = document.createElement('div');
    box.className = 'mbox';
    box.innerHTML = '<button class="mclose" onclick="closeM(\'edit-payment-modal\')">✕</button><div id="edit-payment-modal-body"></div>';
    modal.appendChild(box);
    document.body.appendChild(modal);
  }
  document.getElementById('edit-payment-modal-body').innerHTML = html;
  openM('edit-payment-modal');
}

async function saveEditPayment(studentIdx, payIdx){
  const s = SD.students[studentIdx]; if(!s) return;
  const p = (s.paymentHistory||[])[payIdx]; if(!p) return;
  const oldAmt = p.amount||0;
  const newAmt = parseFloat(document.getElementById('ep-amt').value)||0;
  if(!newAmt) return alert('Enter a valid amount.');
  p.amount = newAmt;
  p.method = document.getElementById('ep-method').value;
  p.date   = document.getElementById('ep-date').value;
  // Adjust running total
  s.paid = Math.max(0, (s.paid||0) - oldAmt + newAmt);
  await SQ.push('students', SD.students);
  saveLocal('students', SD.students);
  closeM('edit-payment-modal');
  renderTab(studentIdx, 'fees');
  toast('✅ Payment updated!');
}

// ── SCORES: Clear one student's scores for a term ────────────────────────
async function clearStudentScores(studentIdx, term){
  const s = SD.students[studentIdx]; if(!s) return;
  if(!confirm(`Clear ALL scores for ${s.name} — ${term}? This cannot be undone.`)) return;
  const sid = s.id || studentIdx;
  if(SD.scores[term] && SD.scores[term][sid]) delete SD.scores[term][sid];
  saveLocal('scores', SD.scores);
  await SQ.push('scores', SD.scores);
  renderTab(studentIdx, 'scores');
  toast('🗑️ Scores cleared.');
}

// Clear one subject score for a student + term
async function clearSubjectScore(studentIdx, term, sub){
  const s = SD.students[studentIdx]; if(!s) return;
  if(!confirm(`Clear ${sub} scores for ${s.name} (${term})?`)) return;
  const sid = s.id || studentIdx;
  if(SD.scores[term] && SD.scores[term][sid] && SD.scores[term][sid][sub])
    delete SD.scores[term][sid][sub];
  saveLocal('scores', SD.scores);
  await SQ.push('scores', SD.scores);
  renderTab(studentIdx, 'scores');
  toast('🗑️ Subject scores cleared.');
}

// ── ATTENDANCE: Correct a single day's mark ───────────────────────────────
async function correctAttendance(studentName, date, newStatus){
  if(!SD.attendance) SD.attendance={};
  if(!SD.attendance[date]) SD.attendance[date]={};
  if(newStatus === null || newStatus === ''){
    delete SD.attendance[date][studentName];
  } else {
    SD.attendance[date][studentName] = newStatus;
  }
  saveLocal('attendance', SD.attendance);
  await SQ.push('attendance', SD.attendance);
  toast(`✅ Attendance updated for ${studentName} on ${date}`);
}

// ── STAFF: Edit ───────────────────────────────────────────────────────────
function editStaff(idx){
  const s = (SD.staff||[])[idx]; if(!s) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Staff</div>
      <label style="font-size:0.8rem;font-weight:600;">Full Name</label>
      <input id="est-name" value="${esc(s.name||'')}">
      <label style="font-size:0.8rem;font-weight:600;">Email</label>
      <input id="est-email" value="${esc(s.email||'')}">
      <label style="font-size:0.8rem;font-weight:600;">Role</label>
      <select id="est-role">
        ${['teacher','admin','bursar','head_teacher'].map(r=>`<option value="${r}" ${s.role===r?'selected':''}>${r.replace('_',' ')}</option>`).join('')}
      </select>
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditStaff(${idx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-staff-modal')">Cancel</button>
      </div>
    </div>`;
  let modal = document.getElementById('edit-staff-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id='edit-staff-modal';modal.className='modal';
    const box = document.createElement('div');
    box.className='mbox';
    box.innerHTML='<button class="mclose" onclick="closeM(\'edit-staff-modal\')">✕</button><div id="edit-staff-modal-body"></div>';
    modal.appendChild(box);document.body.appendChild(modal);
  }
  document.getElementById('edit-staff-modal-body').innerHTML=html;
  openM('edit-staff-modal');
}

async function saveEditStaff(idx){
  const s=(SD.staff||[])[idx];if(!s)return;
  s.name  = document.getElementById('est-name').value.trim()||s.name;
  s.email = document.getElementById('est-email').value.trim()||s.email;
  s.role  = document.getElementById('est-role').value;
  await SQ.push('staff', SD.staff);
  saveLocal('staff', SD.staff);
  closeM('edit-staff-modal');
  if(typeof renderStaff==='function') renderStaff();
  toast('✅ Staff updated!');
}

async function deleteStaff(idx){
  const s=(SD.staff||[])[idx];if(!s)return;
  if(!confirm(`Remove ${s.name} from staff?`))return;
  SD.staff.splice(idx,1);
  await SQ.push('staff',SD.staff);
  saveLocal('staff',SD.staff);
  if(typeof renderStaff==='function') renderStaff();
  toast('🗑️ Staff removed.');
}

// ── EXPENSES: Edit ────────────────────────────────────────────────────────
function editExpense(idx){
  const e=(SD.expenses||[])[idx];if(!e)return;
  const cats=['Salaries','Maintenance','Supplies','Utilities','Events','Other'];
  const html=`
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Expense</div>
      <label style="font-size:0.8rem;font-weight:600;">Category</label>
      <select id="ee-cat">${cats.map(c=>`<option ${c===e.category?'selected':''}>${c}</option>`).join('')}</select>
      <label style="font-size:0.8rem;font-weight:600;">Description</label>
      <input id="ee-desc" value="${esc(e.description||'')}">
      <label style="font-size:0.8rem;font-weight:600;">Amount (₦)</label>
      <input id="ee-amt" type="number" value="${e.amount||''}">
      <label style="font-size:0.8rem;font-weight:600;">Date</label>
      <input id="ee-date" type="date" value="${e.date||''}">
      <div style="display:flex;gap:0.5rem;margin-top:0.4rem;">
        <button class="btn-brand" style="flex:1;" onclick="saveEditExpense(${idx})">💾 Save</button>
        <button class="btn-ghost" style="flex:1;" onclick="closeM('edit-expense-modal')">Cancel</button>
      </div>
    </div>`;
  let modal=document.getElementById('edit-expense-modal');
  if(!modal){
    modal=document.createElement('div');modal.id='edit-expense-modal';modal.className='modal';
    const box=document.createElement('div');box.className='mbox';
    box.innerHTML='<button class="mclose" onclick="closeM(\'edit-expense-modal\')">✕</button><div id="edit-expense-modal-body"></div>';
    modal.appendChild(box);document.body.appendChild(modal);
  }
  document.getElementById('edit-expense-modal-body').innerHTML=html;
  openM('edit-expense-modal');
}

async function saveEditExpense(idx){
  const e=(SD.expenses||[])[idx];if(!e)return;
  e.category    = document.getElementById('ee-cat').value;
  e.description = document.getElementById('ee-desc').value.trim()||e.description;
  e.amount      = parseFloat(document.getElementById('ee-amt').value)||e.amount;
  e.date        = document.getElementById('ee-date').value||e.date;
  await SQ.push('expenses',SD.expenses);
  saveLocal('expenses',SD.expenses);
  closeM('edit-expense-modal');
  if(typeof renderExpenses==='function') renderExpenses();
  toast('✅ Expense updated!');
}

async function deleteExpenseItem(idx){
  if(!confirm('Delete this expense?'))return;
  SD.expenses.splice(idx,1);
  await SQ.push('expenses',SD.expenses);
  saveLocal('expenses',SD.expenses);
  if(typeof renderExpenses==='function') renderExpenses();
  toast('🗑️ Expense deleted.');
}
function renderUpgradeModal(){
  // ✅ FIX: Renamed from openUpgradeModal to renderUpgradeModal — no more infinite recursion
  const cfg = SD.config||{};
  const count = (SD.students||[]).length;
  const tierMax = cfg.tierMax || getTier(cfg.studentCount||count).max;
  const tierName = cfg.tier || getTier(count).name;
  const tierPrice = cfg.tierPrice || getTier(count).price;
  const isPrem = cfg.plan==='premium';

  const nameEl = document.getElementById('up-plan-name');
  const tierEl = document.getElementById('up-tier-info');
  const stuEl  = document.getElementById('up-student-info');
  const tableEl = document.getElementById('up-tier-table');

  if(nameEl) nameEl.textContent = (isPrem ? '⭐ PREMIUM' : '📋 BASIC') + ' — ' + (tierName||'—');
  if(tierEl) tierEl.textContent = '₦' + Number(tierPrice||0).toLocaleString('en-NG') + '/term · Up to ' + (tierMax||'?') + ' students';
  if(stuEl)  stuEl.textContent  = 'Current students: ' + count + (count>tierMax ? ' ⚠️ OVER LIMIT' : ' ✅');

  if(tableEl){
    tableEl.innerHTML = TIERS.map(t=>{
      const current = count <= t.max && (TIERS.indexOf(t)===0 || count > TIERS[TIERS.indexOf(t)-1].max);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;margin-bottom:4px;background:${current?'#ecfdf5':'var(--s2)'};border:1px solid ${current?'#86efac':'var(--border)'};">
        <span>${current?'✅ ':''}<b>${t.name}</b></span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--money);">₦${Number(t.price).toLocaleString('en-NG')}/term</span>
      </div>`;
    }).join('');
  }
}

function openUpgradeModal(){
  // ✅ FIX: openUpgradeModal now just renders content then opens the modal — no recursion
  renderUpgradeModal();
  const modal = document.getElementById('upgrade-modal');
  if(modal) modal.classList.add('on');
}

async function refreshPlanFromFirestore(btn){
  // ✅ FIX: btn passed explicitly — no global event.target
  if(!btn){ btn = document.querySelector('[onclick*="refreshPlanFromFirestore"]'); }
  if(btn){ btn.textContent = '⏳ Checking...'; btn.disabled=true; }
  const sid = schoolId || SD.config?._schoolId || localStorage.getItem('p_activeSchoolId');
  if(!sid||!db){
    if(btn){ btn.textContent='❌ Not connected'; btn.disabled=false; }
    return;
  }
  try{
    const snap = await db.collection('schools').doc(sid).get();
    if(snap.exists){
      const cfg = snap.data().config||{};
      SD.config = {...SD.config, ...cfg};
      localStorage.setItem(`p_${sid}_config`, JSON.stringify(SD.config));
      checkTierStatus();
      renderUpgradeModal(); // ✅ just re-render, don't open again
      if(btn) btn.textContent = '✅ Plan refreshed!';
    } else {
      if(btn) btn.textContent = '❌ School not found';
    }
  } catch(e){
    if(btn) btn.textContent = '❌ Error — try again';
    console.error('refreshPlan:', e);
  }
  setTimeout(()=>{ if(btn){btn.textContent='🔄 Refresh Plan (after payment)';btn.disabled=false;} },3000);
}



// ── Auto-login on page load (Remember Me) ────────────────────────────────
(function autoLogin(){
  const raw = localStorage.getItem('p_auth') || sessionStorage.getItem('p_auth');
  if(!raw) return;
  try{
    const auth = JSON.parse(raw);
    if(!auth.schoolId) return;
    const lc = localStorage.getItem(`p_${auth.schoolId}_config`);
    const ls = localStorage.getItem(`p_${auth.schoolId}_staff`);
    if(!lc) return;
    schoolId = auth.schoolId;
    userRole = auth.role || 'Principal';
    loadSchoolIntoSD(auth.schoolId, {
      config: JSON.parse(lc),
      staff: ls ? JSON.parse(ls) : [],
      students: loadLocal('students',[]),
      expenses: loadLocal('expenses',[]),
      attendance: loadLocal('attendance',{}),
      sports: loadLocal('sports',{teams:{},custom:[]}),
      arts: loadLocal('arts',{gallery:[]}),
      music: loadLocal('music',{practiceLogs:[],instruments:[]}),
      health: loadLocal('health',[]),
      alumni: loadLocal('alumni',[]),
      socialPages: loadLocal('socialPages',[]),
      commsLog: loadLocal('commsLog',[]),
      opportunities: loadLocal('opportunities', defaultOpps())
    });
    startApp();
    setTimeout(() => SQ.silentPull(), 2000);
  } catch(e) { console.warn('Auto-login failed:', e); }
})();
