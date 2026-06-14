// ── Firebase ───────────────────────────────────────────────────────────────
const FB={apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",authDomain:"educationbloom-699ed.firebaseapp.com",projectId:"educationbloom-699ed",storageBucket:"educationbloom-699ed.firebasestorage.app",messagingSenderId:"33750392965",appId:"1:33750392965:web:2b3da887ede996ea8389ec"};
let db=null;
try{
  const fbApp=firebase.apps.length?firebase.app():firebase.initializeApp(FB);
  db=firebase.firestore(fbApp);
  db.settings({experimentalForceLongPolling:true,merge:true});
  db.enablePersistence({synchronizeTabs:true})
    .then(()=>console.log('✅ Offline persistence enabled'))
    .catch(err=>{if(err.code!=='failed-precondition'&&err.code!=='unimplemented')console.warn('Persistence:',err.code);});
  console.log('✅ Firebase ready');
}catch(e){console.error('❌ Firebase init failed:',e.message);}

// ── Pricing Tiers ──────────────────────────────────────────────────────────
const TIERS=[
  {name:'Starter (1–50)',    max:50,   price:10000},
  {name:'Small (51–100)',    max:100,  price:20000},
  {name:'Medium (101–200)',  max:200,  price:35000},
  {name:'Large (201–350)',   max:350,  price:55000},
  {name:'Enterprise (351+)', max:99999,price:75000}
];
function getTier(count){return TIERS.find(t=>count<=t.max)||TIERS[TIERS.length-1];}

// ── Gemini Flash OCR ──────────────────────────────────────────────────────
// Simplified — no response_schema (not supported across all model versions)
const GEMINI_KEY=atob('QVEuQWI4Uk42SWE4WjVNNmNVMkh2WkV1NGMyRF9TdnVEZWlDOE16ZmgyYkY2X1lsM0UxVGc=');
const GEMINI_MODELS=['gemini-2.0-flash','gemini-2.0-flash-exp','gemini-1.5-flash','gemini-1.5-flash-latest'];
const GEMINI_PROMPT=`Extract every student name from this Nigerian school register photo.
Nigerian format: SURNAME FIRSTNAME (e.g. DADA Moses, GBELEKALE Aminat, KASALI Rasaq).
Rules:
- Image may be rotated any direction — read correctly regardless
- Ignore serial numbers, fee amounts, BALANCE, CLASS headers, dates, totals
- Include ALL names visible even if handwriting is unclear
- Common Nigerian surnames: Oliyide, Gbelekale, Ogunlade, Kasali, Alawode, Shonpe, Lawal, Dada, Idowu, Adebayo
Respond with ONLY a JSON object like: {"students":[{"surname":"DADA","firstname":"Moses","fullName":"Dada Moses"}]}`;

async function geminiOCR(base64,mime){
  for(const model of GEMINI_MODELS){
    try{
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
      const r=await fetch(url,{
        method:'POST',signal:AbortSignal.timeout(15000),
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contents:[{parts:[{inline_data:{mime_type:mime,data:base64}},{text:GEMINI_PROMPT}]}],
          generationConfig:{response_mime_type:'application/json'}
        })
      });
      const d=await r.json();
      if(d.error){console.warn(`Gemini ${model}:`,d.error.message);continue;}
      const raw=d.candidates?.[0]?.content?.parts?.[0]?.text||'{"students":[]}';
      const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const students=(parsed.students||[]).filter(s=>s.fullName&&s.fullName.length>3);
      if(students.length){console.log(`✅ Gemini OCR (${model}): ${students.length} names`);return students;}
    }catch(e){console.warn(`Gemini ${model} failed:`,e.message);}
  }
  throw new Error('All Gemini models failed');
}

// ── Claude Vision OCR ─────────────────────────────────────────────────────
const ANTHROPIC_KEY=''; // School fills this in via Settings tab
const OCR_MODEL='claude-haiku-4-5-20251001';
async function claudeVisionOCR(base64,mediaType){
  if(!ANTHROPIC_KEY)throw new Error('No Anthropic key configured');
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({
      model:OCR_MODEL,max_tokens:2000,
      system:`You are an OCR specialist for Nigerian handwritten school registers.
Extract ONLY student names. Rules:
- Image may be rotated any direction — read correctly regardless
- Nigerian surname often FIRST (e.g. DADA Aishat = fullName "Dada Aishat")
- Ignore serial numbers, dates, fee amounts, column headers
- Return ONLY valid JSON array: [{"surname":"DADA","firstname":"Aishat","fullName":"Dada Aishat"},...]
If no names found: []`,
      messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:mediaType,data:base64}},
        {type:'text',text:'Extract all student names from this school register photo.'}
      ]}]
    })
  });
  const data=await res.json();
  const raw=data.content?.[0]?.text||'[]';
  try{return JSON.parse(raw.replace(/```json|```/g,'').trim());}catch{return [];}
}

// ── AI Helper (Finance/Comms AI agents) ──────────────────────────────────
async function aitCall(system,messages){
  if(!ANTHROPIC_KEY)return 'Set your Anthropic API key in Settings → AI Key to use this feature.';
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:OCR_MODEL,max_tokens:1024,system,messages})
    });
    const d=await r.json();
    return d.content?.[0]?.text||'No response from AI.';
  }catch(e){return 'AI unavailable: '+e.message;}
}

// ── State ──────────────────────────────────────────────────────────────────
let schoolId=null,userRole=null,currentStaff=null;
let SD={config:{},students:[],staff:[],expenses:[],attendance:{},scores:{},affective:{},sports:{teams:{},custom:[]},arts:{gallery:[]},music:{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]};
let activeIdx=null,activeTab='fees',currentSport='football';
let _activeScoreTerm=null; // set by scorecardSetTerm for profile score view
let _ocrPending=[];
let _wizState={cls:'',term:'',step:1};
let _bulkWAIdx=0,_bulkWAStudents=[];
let _bulkRCIdx=0,_bulkRCStudents=[];
let _scannedQueue=[];

// ── Sync Queue — Offline-First ────────────────────────────────────────────
const SQ={
  q:JSON.parse(localStorage.getItem('p_sq')||'[]'),
  _syncing:false,
  _offlineSince:null,
  _probing:false,
  save(){localStorage.setItem('p_sq',JSON.stringify(this.q));},
  push(key,data){
    SD[key]=data;
    if(schoolId)localStorage.setItem(`p_${schoolId}_${key}`,JSON.stringify(data));
    this.q.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),key,data,tries:0});
    this.save();
    this.flush();
  },
  ping(){
    const el=$('sync');
    if(navigator.onLine){
      this._offlineSince=null;this._probing=false;
      if(el){el.className='sdot '+(this.q.length?'sd-sync':'sd-on');el.textContent=this.q.length?'● Syncing':'● Online';}
      if(db&&this.q.length)this.flush();
    } else {
      if(!this._probing){
        this._probing=true;
        if(el){el.className='sdot sd-sync';el.textContent='● Connecting...';}
        const ctrl=new AbortController();
        const tid=setTimeout(()=>ctrl.abort(),5000);
        fetch('https://clients3.google.com/generate_204',{method:'GET',mode:'no-cors',cache:'no-store',signal:ctrl.signal})
          .then(()=>{clearTimeout(tid);this._offlineSince=null;this._probing=false;this.ping();})
          .catch(()=>{clearTimeout(tid);this._probing=false;if(!this._offlineSince)this._offlineSince=Date.now();const s=(Date.now()-this._offlineSince)/1000;if(el&&s>5){el.className='sdot sd-off';el.textContent='● Offline';}});
      }
    }
  },
  async flush(){
    if(!db||!this.q.length||this._syncing)return;
    this._syncing=true;
    const items=[...this.q];
    for(const item of items){
      try{await db.collection('schools').doc(schoolId).set({[item.key]:item.data},{merge:true});this.q=this.q.filter(x=>x.id!==item.id);}
      catch(e){item.tries++;if(item.tries>5)this.q=this.q.filter(x=>x.id!==item.id);}
    }
    this._syncing=false;this.save();this.ping();
  },
  async silentPull(){
    if(!db||!schoolId)return;
    try{
      const doc=await db.collection('schools').doc(schoolId).get();
      if(!doc.exists)return;
      const d=doc.data();
      const pk=new Set(this.q.map(x=>x.key));
      Object.keys(d).forEach(k=>{if(!pk.has(k)){SD[k]=d[k];localStorage.setItem(`p_${schoolId}_${k}`,JSON.stringify(d[k]));}});
      if(typeof renderBanner==='function')renderBanner();
      if(typeof renderRevenue==='function'&&$('sec-revenue')?.classList.contains('on'))renderRevenue();
      console.log('✅ Silent pull complete');
    }catch(e){console.warn('Silent pull failed:',e.message);}
  }
};
window.addEventListener('online',()=>{SQ.ping();SQ.flush().then(()=>SQ.silentPull());});
window.addEventListener('offline',()=>SQ.ping());

// ── Helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const esc=s=>{if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;};
const fmt=n=>'₦'+Number(n||0).toLocaleString('en-NG');
const openM=id=>{const el=$(id);if(el)el.classList.add('on');};
const closeM=id=>{const el=$(id);if(el)el.classList.remove('on');};
window.onclick=e=>{if(e.target.classList.contains('modal'))e.target.classList.remove('on');};
document.onkeydown=e=>{if(e.key==='Escape')document.querySelectorAll('.modal').forEach(m=>m.classList.remove('on'));};
function loadLocal(key,def){if(!schoolId)return def;const v=localStorage.getItem(`p_${schoolId}_${key}`);if(v)try{return JSON.parse(v);}catch(e){}return def;}
function saveLocal(key,data){if(schoolId)localStorage.setItem(`p_${schoolId}_${key}`,JSON.stringify(data));}
function gradeScore(t){if(t>=70)return{g:'A',r:'Excellent'};if(t>=60)return{g:'B',r:'Good'};if(t>=50)return{g:'C',r:'Average'};if(t>=40)return{g:'D',r:'Below Average'};return{g:'F',r:'Fail'};}
function getGrade(tot){if(tot>=70)return{g:'A',r:'Excellent',col:'var(--money)'};if(tot>=60)return{g:'B',r:'Very Good',col:'#2563eb'};if(tot>=50)return{g:'C',r:'Good',col:'var(--warn)'};if(tot>=40)return{g:'D',r:'Fair',col:'orange'};return{g:'F',r:'Fail',col:'var(--danger)'};}
function toast(msg){let b=$('toast-box');if(!b){b=document.createElement('div');b.id='toast-box';b.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:8px 18px;border-radius:20px;font-size:0.8rem;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;transition:opacity 0.3s;opacity:0;';document.body.appendChild(b);}b.textContent=msg;b.style.opacity='1';clearTimeout(b._t);b._t=setTimeout(()=>{b.style.opacity='0';},2400);}
function toggleEye(inputId,btn){const inp=$(inputId);if(!inp)return;const show=inp.type==='password';inp.type=show?'text':'password';btn.textContent=show?'🙈':'👁️';}

// ── RBAC Helpers ──────────────────────────────────────────────────────────
function canSeeFees(){return['Principal','Bursar'].includes(userRole);}
function getAssignedClass(){return currentStaff?currentStaff.assignedClass:null;}
function applyRoleRestrictions(){
  const links=document.querySelectorAll('.nlink');
  links.forEach(l=>{
    const tab=l.dataset.t;
    if(userRole==='Class Teacher'||userRole==='Subject Teacher'){
      if(['revenue','staff','expenses','finance'].includes(tab))l.style.display='none';
    }
    if(userRole==='Bursar'){
      if(['sports','arts','music','health','alumni','opps','scorecard'].includes(tab))l.style.display='none';
    }
  });
}

// ── Login ──────────────────────────────────────────────────────────────────
function matchUser(staff,input){const v=(input||'').trim().toLowerCase();return staff.find(s=>(s.email||'').trim().toLowerCase()===v)||staff.find(s=>(s.password||'').trim().toLowerCase()===v)||null;}

function loadSchoolIntoSD(sid,school){
  SD.config=school.config||{};SD.students=school.students||[];SD.staff=school.staff||[];
  SD.expenses=school.expenses||[];SD.attendance=school.attendance||{};SD.scores=school.scores||{};
  SD.affective=school.affective||{};SD.sports=school.sports||{teams:{},custom:[]};
  SD.arts=school.arts||{gallery:[]};SD.music=school.music||{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]};
  SD.health=school.health||[];SD.alumni=school.alumni||[];SD.socialPages=school.socialPages||[];
  SD.commsLog=school.commsLog||[];SD.opportunities=school.opportunities||defaultOpps();
  Object.keys(SD).forEach(k=>localStorage.setItem(`p_${sid}_${k}`,JSON.stringify(SD[k])));
}

function showStaffLoginStep(){
  const ld=$('login');if(ld)ld.style.display='none';
  const sd=$('staff-login');if(!sd){console.error('❌ #staff-login not in HTML');return;}
  sd.style.display='flex';
  const ne=$('sl-school-name');if(ne)ne.textContent=SD.config?.schoolName||'Educational Bloom';
  slSetTab('principal');
}
function slSetTab(tab){
  const ip=tab==='principal';
  const pp=$('sl-panel-p'),ps=$('sl-panel-s'),tp=$('sl-tab-p'),ts=$('sl-tab-s');
  if(pp)pp.style.display=ip?'block':'none';if(ps)ps.style.display=ip?'none':'block';
  if(tp){tp.style.background=ip?'var(--brand)':'transparent';tp.style.color=ip?'#fff':'var(--sub)';tp.style.borderColor=ip?'var(--brand)':'var(--border)';}
  if(ts){ts.style.background=ip?'transparent':'var(--brand)';ts.style.color=ip?'var(--sub)':'#fff';ts.style.borderColor=ip?'var(--border)':'var(--brand)';}
}
function slForgotPassword(){
  const agent=SD.config?.agent;const phone=(agent?.phone||'2348145073941').replace(/\D/g,'');
  const msg='Hello, I am the Principal of '+(SD.config?.schoolName||'my school')+'. I cannot log into EduBloom — please send my password. School ID: '+(schoolId||'unknown');
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
}
function doPrincipalLogin(){
  const pwd=($('sl-p-pwd')?.value||'').trim();const errEl=$('sl-p-err');if(errEl)errEl.style.display='none';
  if(!pwd){if(errEl){errEl.textContent='Enter your school password.';errEl.style.display='block';}return;}
  const principal=(SD.staff||[]).find(s=>s.role==='Principal'&&(s.password||'')===pwd)||(SD.staff||[]).find(s=>(s.password||'')===pwd);
  if(!principal){if(errEl){errEl.textContent='Incorrect password. Default is bloom2026. Contact your agent if forgotten.';errEl.style.display='block';}return;}
  currentStaff=principal;userRole='Principal';
  localStorage.setItem('p_'+schoolId+'_staffSession',JSON.stringify({...principal,role:'Principal',schoolId}));
  _saveAuth(schoolId,principal.email||'');
  const div=$('staff-login');if(div)div.style.display='none';
  startApp();
}
function doStaffLogin(){
  const email=($('sl-email')?.value||'').trim().toLowerCase();const pwd=$('sl-pwd')?.value||'';
  const errEl=$('sl-s-err');if(errEl)errEl.style.display='none';
  if(!email||!pwd){if(errEl){errEl.textContent='Enter your email and password.';errEl.style.display='block';}return;}
  const staff=(SD.staff||[]).find(s=>(s.email||'').trim().toLowerCase()===email&&(s.password||'')===pwd);
  if(!staff){if(errEl){errEl.textContent='Not recognised. Ask your Principal to verify your staff record.';errEl.style.display='block';}return;}
  currentStaff=staff;userRole=staff.role||'Class Teacher';
  localStorage.setItem('p_'+schoolId+'_staffSession',JSON.stringify({...staff,schoolId}));
  _saveAuth(schoolId,email);
  const div=$('staff-login');if(div)div.style.display='none';
  startApp();
}

async function doLogin(){
  const sid=$('l-school').value.trim().toUpperCase();
  const err=$('l-err');err.style.display='none';
  const btn=$('l-btn');
  if(!sid){err.textContent='Enter your School ID (e.g. BLOOM-ABK0042).';err.style.display='block';return;}
  if(!sid.startsWith('BLOOM-')){err.textContent='School ID must start with BLOOM-';err.style.display='block';return;}
  btn.textContent='Checking...';btn.disabled=true;

  // Step 1: localStorage first — instant, works offline
  const lc=localStorage.getItem(`p_${sid}_config`),ls=localStorage.getItem(`p_${sid}_staff`);
  if(lc&&ls){
    try{
      const staff=JSON.parse(ls),config=JSON.parse(lc);
      schoolId=sid;_saveAuth(sid,'');
      loadSchoolIntoSD(sid,{config,staff,students:loadLocal('students',[]),expenses:loadLocal('expenses',[]),attendance:loadLocal('attendance',{}),sports:loadLocal('sports',{teams:{},custom:[]}),arts:loadLocal('arts',{gallery:[]}),music:loadLocal('music',{practiceLogs:[],instruments:[]}),health:loadLocal('health',[]),alumni:loadLocal('alumni',[]),socialPages:loadLocal('socialPages',[]),commsLog:loadLocal('commsLog',[]),scores:loadLocal('scores',{}),opportunities:loadLocal('opportunities',defaultOpps())});
      const cached=localStorage.getItem(`p_${sid}_staffSession`);
      if(cached){try{const sess=JSON.parse(cached);currentStaff=sess;userRole=sess.role||'Principal';startApp();btn.textContent='▶ Enter Portal';btn.disabled=false;return;}catch(e){}}
      if(SD.staff&&SD.staff.length>0){btn.textContent='▶ Enter Portal';btn.disabled=false;showStaffLoginStep();return;}
      userRole='Principal';currentStaff=null;startApp();
      setTimeout(()=>SQ.silentPull(),1500);
      btn.textContent='▶ Enter Portal';btn.disabled=false;return;
    }catch(e){console.warn('Cache error:',e);}
  }

  // Step 2: Network login
  btn.textContent='Connecting...';
  try{
    let school=null;
    if(db){try{const doc=await db.collection('schools').doc(sid).get();if(doc.exists){school=doc.data();console.log('✅ Found in Firestore');}}catch(e){console.warn('Firestore read:',e.message);}}
    if(!school&&db){
      try{
        const snap=await db.collection('admin_approved_schools').where('schoolId','==',sid).get();
        if(!snap.empty){
          const rec=snap.docs[0].data();
          school={config:{plan:'basic',fee:50000,schoolName:rec.schoolName||'',principalEmail:rec.principalEmail||'',whatsapp:rec.principalPhone||'',createdAt:new Date().toISOString()},staff:[{name:'Principal',email:(rec.principalEmail||sid.toLowerCase()+'@bloom.edu.ng').toLowerCase(),password:rec.password||'bloom2026',role:'Principal',phone:rec.principalPhone||''}],students:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},music:{practiceLogs:[],instruments:[]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]};
          try{await db.collection('schools').doc(sid).set(school,{merge:true});}catch(e2){}
        }
      }catch(e){console.warn('admin_approved_schools:',e.message);}
    }
    if(!school){err.textContent=`School ID "${sid}" not found. Check the ID from your AariNAT agent.`;err.style.display='block';btn.textContent='▶ Enter Portal';btn.disabled=false;return;}
    schoolId=sid;_saveAuth(sid,'');loadSchoolIntoSD(sid,school);
    const fs=localStorage.getItem(`p_${sid}_staffSession`);
    if(fs){try{const sess=JSON.parse(fs);currentStaff=sess;userRole=sess.role||'Principal';startApp();btn.textContent='▶ Enter Portal';btn.disabled=false;return;}catch(e){}}
    if(SD.staff&&SD.staff.length>0){btn.textContent='▶ Enter Portal';btn.disabled=false;showStaffLoginStep();return;}
    userRole='Principal';currentStaff=null;startApp();
  }catch(e){err.textContent='Connection error: '+(e?.message||'Check your internet and try again.');err.style.display='block';}
  btn.textContent='▶ Enter Portal';btn.disabled=false;
}

function _saveAuth(sid,email){
  const rem=$('l-remember')?.checked!==false;
  const data=JSON.stringify({schoolId:sid,email:email||'',role:userRole||'Principal'});
  if(rem){localStorage.setItem('p_auth',data);sessionStorage.removeItem('p_auth');}
  else{sessionStorage.setItem('p_auth',data);localStorage.removeItem('p_auth');}
}
function defaultOpps(){return[{id:'ubec',title:'UBEC School Development Grant',provider:'Universal Basic Education Commission',type:'grant',amount:'₦500k–₦2M',deadline:'2026-09-30',desc:'For primary school infrastructure improvements.'},{id:'ptdf',title:'PTDF Undergraduate Scholarship',provider:'PTDF',type:'scholarship',amount:'Full Tuition',deadline:'2026-08-31',desc:'For Nigerian citizens studying petroleum-related courses.'},{id:'nnpc',title:'NNPC/TOTAL Scholarship',provider:'NNPC/TOTAL',type:'scholarship',amount:'₦200,000/year',deadline:'2026-07-15',desc:'For 100-level STEM students.'},{id:'teach',title:'Teach For Nigeria Fellowship',provider:'Teach For Nigeria',type:'internship',amount:'Stipend + Training',deadline:'2026-06-30',desc:'Teaching fellowship for graduates in underserved schools.'}];}
function logout(){if(!confirm('Clear session and reload?'))return;localStorage.removeItem('p_auth');sessionStorage.removeItem('p_auth');if(schoolId)localStorage.removeItem(`p_${schoolId}_staffSession`);location.reload();}

function startApp(){
  $('login').style.display='none';
  const sl=$('staff-login');if(sl)sl.style.display='none';
  $('app').style.display='block';
  $('hdr-school').textContent=SD.config.schoolName||schoolId||'Educational Bloom';
  $('hdr-role').textContent=userRole+(currentStaff?.assignedClass?' · '+currentStaff.assignedClass:'');
  $('hdr-term').textContent=SD.config.currentTerm||'Term 1';
  const isPrem=SD.config.plan==='premium';
  $('planBadge').textContent=isPrem?'PREMIUM ✨':'BASIC';
  $('planBadge').className='plan-badge '+(isPrem?'plan-premium':'plan-basic');
  applyRoleRestrictions();
  renderBirthdays();
  const sub=$('banner-sub');
  if(sub){const cnt=(SD.students||[]).length;sub.textContent=cnt>0?`${cnt} student${cnt!==1?'s':''} enrolled`:'No students yet — add your first student';}
  SQ.ping();
  const firstTabs={Principal:'revenue',Bursar:'revenue','Class Teacher':'students','Subject Teacher':'scorecard'};
  go(firstTabs[userRole]||'revenue');
  setTimeout(()=>SQ.flush(),500);
  setTimeout(()=>SQ.silentPull(),2500);
  [1000,3500,7000].forEach(ms=>setTimeout(()=>{SQ.ping();if(SQ.q.length)SQ.flush();if(ms===7000)SQ.silentPull();},ms));
}

function go(tab){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b=>b.classList.remove('on'));
  const el=$(`sec-${tab}`);if(el)el.classList.add('on');
  const btn=document.querySelector(`[data-t="${tab}"]`);if(btn)btn.classList.add('on');
  const fn={revenue:renderRevenue,students:renderStudentList,staff:renderStaff,sports:loadSports,arts:renderArts,music:renderMusic,health:renderHealth,alumni:renderAlumni,expenses:renderExpenses,finance:checkFinance,comms:renderComms,analytics:renderAnalytics,support:renderSupport,settings:loadSettings,opps:renderOpps,scorecard:renderScorecard,aitools:()=>{if(typeof renderAITools==='function')renderAITools();}};
  if(fn[tab])fn[tab]();
}

// ── Tier Status & Banner ──────────────────────────────────────────────────
function checkTierStatus(){
  const count=(SD.students||[]).length;
  const cfg=SD.config||{};
  const tierMax=cfg.tierMax||getTier(cfg.studentCount||0).max;
  const tierName=cfg.tier||getTier(count).name;
  const sid=cfg._schoolId||schoolId||'';
  if(count!==(cfg._lastReportedCount||0)){
    cfg._lastReportedCount=count;
    SQ.push('config',cfg);
    if(db&&sid&&!cfg._demo){db.collection('schools').doc(sid).update({'config.studentCount':count,'config._lastReportedCount':count}).catch(()=>{});}
  }
  const over=count>tierMax;
  const banner=$('tier-alert-banner');
  if(!over){cfg.tierExceededAt=null;cfg.tierExceededNewTier=null;if(banner)banner.style.display='none';const lk=$('app-lockscreen');if(lk)lk.style.display='none';return;}
  if(!cfg.tierExceededAt){
    cfg.tierExceededAt=new Date().toISOString();
    cfg.tierExceededNewTier=getTier(count);
    SQ.push('config',cfg);
    if(db&&sid&&!cfg._demo){
      db.collection('schools').doc(sid).update({'config.tierExceededAt':cfg.tierExceededAt,'config.tierExceededNewTier':cfg.tierExceededNewTier,'config.studentCount':count}).catch(()=>{});
      // Notify admin dashboard
      db.collection('admin_alerts').add({type:'tier_exceeded',schoolId:sid,schoolName:cfg.schoolName||sid,oldTier:tierName,newTier:cfg.tierExceededNewTier.name,newPrice:cfg.tierExceededNewTier.price,studentCount:count,exceededAt:cfg.tierExceededAt,resolved:false}).catch(()=>{});
    }
  }
  const newTier=cfg.tierExceededNewTier||getTier(count);
  const lockAt=new Date(new Date(cfg.tierExceededAt).getTime()+3*24*60*60*1000);
  const msLeft=lockAt-new Date();
  const daysLeft=Math.ceil(msLeft/86400000);
  const isLocked=msLeft<=0;
  if(banner){
    banner.style.display='flex';
    banner.innerHTML=`<div style="flex:1;"><strong>⚠️ Student count (${count}) exceeded ${tierName} limit (${tierMax})</strong><br><span style="font-size:0.8rem;">Upgrade to <b>${newTier.name}</b> at <b>₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> — <b style="color:${daysLeft<=1?'#ff4444':'#fbbf24'};">${daysLeft>0?daysLeft+' day'+(daysLeft!==1?'s':'')+'left':'TODAY — pay now!'}</b></span></div><button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;flex-shrink:0;">📞 Contact Admin</button>`;
  }
  if(isLocked){
    let lk=$('app-lockscreen');
    if(!lk){lk=document.createElement('div');lk.id='app-lockscreen';lk.style.cssText='position:fixed;inset:0;background:#0f172a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;';lk.innerHTML=`<div style="font-size:3rem;margin-bottom:1rem;">🔒</div><div style="color:#f1f5f9;font-size:1.2rem;font-weight:800;margin-bottom:0.5rem;">App Locked</div><div style="color:#94a3b8;font-size:0.9rem;max-width:320px;margin-bottom:1.5rem;">Your school has <b style="color:#f8fafc;">${count} students</b> but your plan covers up to <b style="color:#f8fafc;">${tierMax}</b>.<br><br>Upgrade to <b style="color:#60a5fa;">${newTier.name}</b> at <b style="color:#4ade80;">₦${Number(newTier.price).toLocaleString('en-NG')}/term</b> to unlock.</div><button onclick="contactAdminForUpgrade()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:1rem;font-weight:700;cursor:pointer;">📞 Contact Agent to Unlock</button>`;document.body.appendChild(lk);}
    lk.style.display='flex';
  }
}
function contactAdminForUpgrade(){
  const cfg=SD.config||{};const count=(SD.students||[]).length;
  const newTier=cfg.tierExceededNewTier||getTier(count);const agent=cfg.agent||{};
  const phone=(agent.phone||'2348145073941').replace(/\D/g,'');
  const msg=`Hello, I need to upgrade my EduBloom plan.\n\nSchool: ${cfg.schoolName||'My School'}\nCurrent students: ${count}\nRequested tier: ${newTier.name} (₦${Number(newTier.price).toLocaleString('en-NG')}/term)\n\nPlease assist. Thank you.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'_blank');
}
function renderBanner(){
  let out=0,cnt=0;
  (SD.students||[]).forEach(s=>{const o=(s.totalFee||0)-(s.paid||0);if(o>0){out+=o;cnt++;}});
  const ae=$('banner-amount');if(ae)ae.textContent=fmt(out);
  const se=$('banner-sub');
  if(se){const tot=(SD.students||[]).length;se.textContent=tot===0?'No students yet — add your first student':`${cnt} parent${cnt!==1?'s':''} overdue · ${tot} total enrolled`;}
}

// ── Revenue ────────────────────────────────────────────────────────────────
function renderRevenue(){
  renderBanner();
  const s=SD.students||[];let exp=0,col=0;s.forEach(x=>{exp+=(x.totalFee||0);col+=(x.paid||0);});
  const pct=exp>0?Math.round((col/exp)*100):0;
  $('d-students').textContent=s.length;$('d-collected').textContent=fmt(col);
  $('d-outstanding').textContent=fmt(exp-col);$('d-rate').textContent=pct+'%';
  $('prog-pct').textContent=pct+'%';$('prog-fill').style.width=pct+'%';
  const overdue=s.filter(x=>(x.totalFee||0)-(x.paid||0)>0).sort((a,b)=>((b.totalFee||0)-(b.paid||0))-((a.totalFee||0)-(a.paid||0))).slice(0,6);
  $('overdue-list').innerHTML=overdue.length===0?'<p style="text-align:center;color:var(--sub);padding:1rem;">All fees collected! 🎉</p>':overdue.map(s=>{const idx=SD.students.indexOf(s);const owe=(s.totalFee||0)-(s.paid||0);return`<div class="stu-row"><div class="stu-av">${s.name.charAt(0).toUpperCase()}</div><div style="flex:1;"><div class="stu-name">${esc(s.name)}</div><div class="stu-meta">${esc(s.class||'—')} · Owes: <strong style="color:var(--danger);">${fmt(owe)}</strong></div></div><button class="btn-wa btn-sm" onclick="sendReminder(${idx})">📲</button></div>`;}).join('');
}
async function handleBulkPayment(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    const lines=ev.target.result.split(/\r?\n/).filter(x=>x.trim());
    let matched=0,skipped=0,noMatch=0;
    const nameScore=(a,b)=>{const wa=a.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(Boolean);const wb=b.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(Boolean);if(!wa.length||!wb.length)return 0;const shared=wa.filter(w=>w.length>1&&wb.includes(w)).length;let pb=0;wa.forEach(w=>{if(w.length>2&&wb.some(v=>v.startsWith(w)||w.startsWith(v)))pb+=0.5;});return(shared+pb)/Math.max(wa.length,wb.length);};
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',').map(c=>c.trim());if(cols.length<2||!cols[0]||!cols[1])continue;
      const csvName=cols[0];const amt=parseFloat(cols[1].replace(/[^0-9.]/g,''));if(isNaN(amt)||amt<=0)continue;
      const scored=SD.students.map((s,idx)=>({s,idx,score:nameScore(csvName,s.name)})).filter(x=>x.score>0.3).sort((a,b)=>b.score-a.score);
      if(!scored.length){noMatch++;continue;}
      const best=scored[0];const isAmb=scored.length>1&&scored[1].score>=best.score&&best.score>0.5;
      if(isAmb){skipped++;continue;}
      best.s.paid=(best.s.paid||0)+amt;if(!best.s.paymentHistory)best.s.paymentHistory=[];
      best.s.paymentHistory.unshift({amount:amt,method:'Bank Statement',date:new Date().toISOString().split('T')[0],by:'CSV Import'});matched++;
    }
    await SQ.push('students',SD.students);checkTierStatus();
    let msg=`✅ ${matched} matched and updated`;if(skipped)msg+=` · ⚠️ ${skipped} ambiguous`;if(noMatch)msg+=` · ❓ ${noMatch} not found`;
    const fb=$('bulk-feedback');if(fb)fb.textContent=msg;renderRevenue();
  };r.readAsText(f);
}
function sendReminder(idx){
  const s=SD.students[idx];const owe=(s.totalFee||0)-(s.paid||0);
  const sn=SD.config.schoolName||'School';
  const msg=`Dear Parent,\n\nThis is a friendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
  if(s.phone)window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
  else alert('No phone number for this student.');
}
function sendAllReminders(){
  const overdue=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  if(!overdue.length)return alert('No overdue students!');
  const withPhone=overdue.filter(s=>s.phone);
  if(withPhone.length>0){startBulkWA();return;}
  const sn=SD.config.schoolName||'School';
  const total=overdue.reduce((t,s)=>t+(s.totalFee||0)-(s.paid||0),0);
  const msg=`Dear Parents of ${sn},\n\n*${overdue.length} students* have outstanding fee balances this term.\nTotal outstanding: *${fmt(total)}*\n\nKindly ensure prompt payment.\n\n– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

// ── Students ───────────────────────────────────────────────────────────────
async function fixGarbledNames(){
  const before=SD.students.length;
  SD.students=SD.students.filter(s=>looksLikeValidName((s.name||'').trim()));
  const seen=new Set();
  SD.students=SD.students.filter(s=>{const key=(s.name||'').toLowerCase().replace(/[^a-z]/g,'');if(seen.has(key))return false;seen.add(key);return true;});
  const removed=before-SD.students.length;
  if(removed===0){alert('Nothing to clean — all names look valid ✅');return;}
  await SQ.push('students',SD.students);checkTierStatus();
  renderStudentList();renderBanner();renderRevenue();
  alert(`✅ Removed ${removed} entr${removed!==1?'ies':'y'} (junk + duplicates).\n\nIf any real student was removed, add them back with ➕ Add Student.`);
}
function renderStudentList(){
  const q=($('stu-search')?.value||'').toLowerCase();let cls=$('stu-class')?.value||'';const pay=$('stu-pay')?.value||'';let list=[...SD.students];
  const assignedCls=getAssignedClass();
  if(assignedCls&&(userRole==='Class Teacher'||userRole==='Subject Teacher')){cls=assignedCls;const cs=$('stu-class');if(cs){cs.value=assignedCls;cs.disabled=true;}}
  if(q)list=list.filter(s=>s.name.toLowerCase().includes(q)||(s.phone||'').includes(q));
  if(cls)list=list.filter(s=>s.class===cls);
  if(pay==='paid')list=list.filter(s=>(s.totalFee||0)<=(s.paid||0));else if(pay==='owing')list=list.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  populateClassFilter();
  const c=$('students-list');
  if(!list.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No students match.</p>';return;}
  c.innerHTML=list.map(s=>{
    const idx=SD.students.indexOf(s);const owe=(s.totalFee||0)-(s.paid||0);
    const pbc=owe<=0?'pb-paid':s.paid>0?'pb-part':'pb-owe';const pbt=owe<=0?'Paid':s.paid>0?'Partial':'Unpaid';
    const feeBadge=canSeeFees()?`<span class="pay-badge ${pbc}">${pbt}</span>${owe>0?`<span style="font-size:0.68rem;color:var(--danger);">${fmt(owe)}</span>`:'`'}`:'' ;
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
  const dob=$('ns-dob')?.value||'';
  if(!name||!phone)return alert('Name and phone are required.');
  SD.students.push({name,phone,class:cls,totalFee:fee,paid:0,scores:{},swot:{},dob});
  await SQ.push('students',SD.students);checkTierStatus();
  closeM('add-student-modal');
  $('ns-name').value='';$('ns-phone').value='';$('ns-class').value='';$('ns-fee').value='';if($('ns-dob'))$('ns-dob').value='';
  renderStudentList();renderBanner();renderRevenue();
}
async function deleteStudent(idx){
  if(!confirm(`Delete ${SD.students[idx]?.name}?`))return;
  SD.students.splice(idx,1);await SQ.push('students',SD.students);checkTierStatus();
  closeM('student-modal');renderStudentList();renderBanner();
}

// ── Name Validation (for OCR + text import) ───────────────────────────────
const UI_BLACKLIST=['educational bloom','school portal','kobomoba','github','send whatsapp','reminders to all','revenue','students','expenses','analytics','settings','support','finance','comms','alumni','health','music','arts','sports','staff','security','opportunities','outstanding','collection rate','overdue','unpaid','paid','partial','basic','premium','online','offline','syncing','principal','term ','session','exit','login','add student','import','fix names','upload','download','export','search','all classes','owes:','fee','fees','phone','class','name','loading','saving','please wait','tap to','click to'];
const VALID_PREFIXES=/^(evang\.?|hon\.?|snr\.?|ldr\.?|ven\.?|sup\.?|rev\.?|pastor|deacon|deaconess|bro\.?|sis\.?|mr\.?|mrs\.?|miss|dr\.?|prof\.?)\s/i;
function looksLikeValidName(str){
  const t=str.trim();if(!t||t.length<4)return false;
  if(!/[a-zA-Z]/.test(t))return false;
  if(/\d/.test(t))return false;
  const low=t.toLowerCase();if(UI_BLACKLIST.some(b=>low.includes(b)))return false;
  const words=t.split(/\s+/).filter(Boolean);if(words.length>6)return false;
  const alpha=t.replace(/[^a-zA-Z]/g,'');if(alpha.length<4)return false;
  if((t.match(/[^aeiouAEIOU\s.,'\-]{5,}/g)||[]).length>0)return false;
  if(!words.some(w=>w.replace(/[^a-zA-Z]/g,'').length>=3))return false;
  if(VALID_PREFIXES.test(t))return true;
  return words.some(w=>w.length>=3&&/^[A-Z]/.test(w)&&/[a-z]/.test(w));
}
function extractStudentNames(raw){
  const lines=raw.split(/\r?\n/);const candidates=[];
  lines.forEach(line=>{
    const t=line.trim();if(!t)return;
    if(t.includes(',')&&!/^\d+[.)\s]/.test(t)){const col=t.split(',')[0].replace(/"/g,'').trim();if(col)candidates.push(col);return;}
    const stripped=t.replace(/^\d+[.):\s]+/,'').replace(/^[-*•]\s*/,'').trim();
    if(stripped)candidates.push(stripped);
  });
  const seen=new Set();const result=[];
  candidates.forEach(raw=>{
    const n=raw.replace(/\s+/g,' ').trim();const key=n.toLowerCase().replace(/[^a-z]/g,'');
    if(!key||seen.has(key))return;
    if(looksLikeValidName(n)){seen.add(key);result.push(n);}
  });return result;
}

// ── Student Import: CSV / TXT ─────────────────────────────────────────────
function importStudentsFromText(f){
  const tryRead=(enc)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=ev=>res(ev.target.result);r.onerror=rej;r.readAsText(f,enc);});
  const isGarbled=str=>{const bad=(str.match(/[\uFFFD\u0080-\u009F\u00C2-\u00C3]/g)||[]).length;return bad>5||(bad/Math.max(str.length,1))>0.02;};
  const cleanName=n=>n.replace(/[^a-zA-Z\s'\-\.]/g,'').replace(/\s+/g,' ').trim();
  (async()=>{
    let raw=await tryRead('UTF-8');if(isGarbled(raw))raw=await tryRead('windows-1252');
    const lines=raw.split(/\r?\n/).filter(x=>x.trim());
    const isStructured=lines.length>1&&lines[0].toLowerCase().includes('name')&&lines[0].includes(',');
    let count=0;
    if(isStructured){
      for(let i=1;i<lines.length;i++){
        const c=lines[i].split(',').map(x=>x.trim());const nm=cleanName(c[0]||'');
        if(nm&&nm.length>1&&c[1]){SD.students.push({name:nm,phone:c[1].replace(/\D/g,''),class:c[2]||'',totalFee:parseFloat(c[3])||SD.config.fee||50000,paid:0,scores:{},swot:{}});count++;}
      }
    } else {
      const names=extractStudentNames(raw);
      const ek=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
      names.forEach(nm=>{const safe=cleanName(nm);const key=safe.toLowerCase().replace(/[^a-z]/g,'');if(safe.length>1&&!ek.has(key)){SD.students.push({name:safe,phone:'',class:'',totalFee:SD.config.fee||50000,paid:0,scores:{},swot:{}});ek.add(key);count++;}});
    }
    await SQ.push('students',SD.students);checkTierStatus();
    const fb=$('csv-fb');if(fb)fb.textContent=`✅ Imported ${count} student${count!==1?'s':''}.${isStructured?'':' Add phone/class in each profile.'}`;
    renderStudentList();renderBanner();renderRevenue();
  })().catch(()=>alert('Could not read file. Try saving as UTF-8 CSV.'));
}

// ── Student Import: Images (multi-page OCR cascade) ───────────────────────
function handleCSV(e){
  const files=Array.from(e.target.files||[]);if(!files.length)return;e.target.value='';
  const images=files.filter(f=>{const n=(f.name||'').toLowerCase(),t=(f.type||'').toLowerCase();return t.startsWith('image/')||/\.(jpg|jpeg|png|webp|bmp)$/.test(n);});
  const texts=files.filter(f=>!images.includes(f));
  texts.forEach(f=>importStudentsFromText(f));
  if(images.length)processImagesSequentially(images);
}
async function processImagesSequentially(files){
  const fbEl=$('csv-fb');_ocrPending=[];
  for(let i=0;i<files.length;i++){
    if(fbEl)fbEl.textContent=`📸 Reading page ${i+1} of ${files.length}...`;
    const names=await _readOnePage(files[i],i+1,files.length,fbEl);
    _ocrPending.push(...names);
  }
  if(!_ocrPending.length){if(fbEl)fbEl.textContent='❌ Could not read any names. Try clearer photos or CSV import.';return;}
  const ek=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
  _ocrPending=_ocrPending.filter(n=>{const key=(n.fullName||'').toLowerCase().replace(/[^a-z]/g,'');return key.length>1&&!ek.has(key);});
  if(fbEl)fbEl.textContent=`✅ Found ${_ocrPending.length} names from ${files.length} page${files.length>1?'s':''}. Review and confirm below.`;
  ocrShowReview(_ocrPending);
}
async function _readOnePage(file,pageNum,total,fbEl){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=async ev=>{
      const imgData=ev.target.result;const b64=imgData.split(',')[1];const mime=file.type||'image/jpeg';
      // 1. Try Gemini Flash first
      try{
        if(fbEl)fbEl.textContent=`📸 Page ${pageNum}/${total}: Gemini reading...`;
        const names=await geminiOCR(b64,mime);
        if(names&&names.length){resolve(names);return;}
      }catch(e){console.warn(`Page ${pageNum} Gemini failed:`,e.message);}
      // 2. Try OCR.space (free tier, handwriting mode)
      try{
        if(fbEl)fbEl.textContent=`📸 Page ${pageNum}/${total}: cloud OCR fallback...`;
        const arr=imgData.split(',');const mtype=arr[0].match(/:(.*?);/)[1];
        const bstr=atob(arr[1]);let bn=bstr.length;const u8=new Uint8Array(bn);while(bn--)u8[bn]=bstr.charCodeAt(bn);
        const blob=new Blob([u8],{type:mtype});const fd=new FormData();
        fd.append('file',blob,'page.jpg');fd.append('language','eng');fd.append('apikey','helloworld');fd.append('isHandwritten','true');fd.append('scale','true');fd.append('OCREngine','2');
        const resp=await fetch('https://api.ocr.space/parse/image',{method:'POST',body:fd});
        const result=await resp.json();const text=result.ParsedResults?.[0]?.ParsedText||'';
        if(text.trim()){const raw=extractStudentNames(text);if(raw.length){resolve(raw.map(n=>({surname:'',firstname:'',fullName:n})));return;}}
      }catch(e){console.warn(`Page ${pageNum} OCR.space failed:`,e.message);}
      // 3. Last resort: Tesseract offline
      try{
        if(fbEl)fbEl.textContent=`📸 Page ${pageNum}/${total}: offline OCR (may take 30s)...`;
        const loadTesseract=()=>new Promise((res,rej)=>{if(window.Tesseract){res();return;}const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
        await loadTesseract();
        const{data:{text}}=await Tesseract.recognize(imgData,'eng',{logger:m=>{if(m.status==='recognizing text'&&fbEl)fbEl.textContent=`📸 Page ${pageNum}/${total}: offline OCR ${Math.round((m.progress||0)*100)}%...`;}});
        if(text.trim()){const raw=extractStudentNames(text);if(raw.length){resolve(raw.map(n=>({surname:'',firstname:'',fullName:n})));return;}}
      }catch(e){console.warn(`Page ${pageNum} Tesseract failed:`,e.message);}
      resolve([]);
    };
    reader.onerror=()=>resolve([]);reader.readAsDataURL(file);
  });
}

// ── OCR Review Panel ──────────────────────────────────────────────────────
function ocrShowReview(names){
  const modal=$('ocr-review-modal');const list=$('ocr-review-list');const info=$('ocr-review-info');
  if(!modal||!list)return;
  if(info)info.textContent=`${names.length} names extracted. Tick each correct name, edit wrong ones, then tap Add Students.`;
  list.innerHTML=names.map((n,i)=>{
    const name=n.fullName||((n.surname||'')+' '+(n.firstname||'')).trim();
    return`<div class="ocr-row" id="ocr-row-${i}" style="display:flex;align-items:center;gap:6px;padding:6px 4px;border-bottom:1px solid var(--border);"><input type="checkbox" id="ocr-chk-${i}" checked onchange="ocrUpdateCount()" style="width:18px;height:18px;cursor:pointer;accent-color:var(--brand);flex-shrink:0;"><input type="text" id="ocr-name-${i}" value="${name.replace(/"/g,'&quot;')}" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:0.82rem;background:var(--bg);color:var(--text);min-width:0;"><input type="text" id="ocr-cls-${i}" placeholder="Class" style="width:72px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:0.78rem;background:var(--bg);color:var(--text);flex-shrink:0;"><button onclick="document.getElementById('ocr-row-${i}').remove();ocrUpdateCount()" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:4px 8px;cursor:pointer;color:#dc2626;font-size:0.78rem;flex-shrink:0;">✕</button></div>`;
  }).join('');
  ocrUpdateCount();modal.classList.add('on');
}
function ocrUpdateCount(){const checked=document.querySelectorAll('#ocr-review-list input[type=checkbox]:checked').length;const btn=$('ocr-confirm-btn');if(btn)btn.textContent=`✅ Add ${checked} Student${checked!==1?'s':''}`;}
function ocrSelectAll(val){document.querySelectorAll('#ocr-review-list input[type=checkbox]').forEach(c=>c.checked=val);ocrUpdateCount();}
function ocrSetClassAll(){const cls=($('ocr-class-all')?.value||'').trim();if(cls)document.querySelectorAll('[id^=ocr-cls-]').forEach(el=>el.value=cls);}
async function ocrConfirmImport(){
  const rows=document.querySelectorAll('#ocr-review-list .ocr-row');
  const ek=new Set(SD.students.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
  let added=0;const fee=SD.config?.fee||50000;
  rows.forEach((row)=>{
    const chk=row.querySelector('input[type=checkbox]');if(!chk||!chk.checked)return;
    const nameEl=row.querySelector('input[type=text]');const clsEl=row.querySelectorAll('input[type=text]')[1];
    const name=(nameEl?.value||'').trim();const cls=(clsEl?.value||'').trim();
    if(!name)return;const key=name.toLowerCase().replace(/[^a-z]/g,'');
    if(ek.has(key))return;
    SD.students.push({name,phone:'',class:cls,totalFee:fee,paid:0,scores:{},swot:{}});ek.add(key);added++;
  });
  if(!added){alert('No names selected.');return;}
  await SQ.push('students',SD.students);checkTierStatus();
  closeM('ocr-review-modal');renderStudentList();renderBanner();renderRevenue();
  const fb=$('csv-fb');if(fb)fb.textContent=`✅ ${added} student${added!==1?'s':''} added successfully.`;
}

// ── Student Profile ────────────────────────────────────────────────────────
function openProfile(idx){
  activeIdx=idx;activeTab='fees';_activeScoreTerm=null;
  const s=SD.students[idx];if(!s)return;
  $('prof-name').textContent=s.name;
  $('prof-meta').textContent=`${s.class||'—'} · ${s.phone||'—'}`;
  const bdayEl=$('prof-bday');if(bdayEl){if(s.dob){bdayEl.style.display='block';bdayEl.textContent=`🎂 DOB: ${s.dob}`;}else{bdayEl.style.display='none';}}
  document.querySelectorAll('.ptab').forEach(t=>t.classList.toggle('on',t.dataset.pt==='fees'));
  renderTab('fees');openM('student-modal');
}
function setTab(tab){activeTab=tab;document.querySelectorAll('.ptab').forEach(t=>t.classList.toggle('on',t.dataset.pt===tab));renderTab(tab);}
function renderTab(tab){
  const s=SD.students[activeIdx];if(!s)return;const c=$('profile-content');
  if(tab==='fees')c.innerHTML=buildFees(s,activeIdx);
  else if(tab==='attendance')c.innerHTML=buildAttendance(s);
  else if(tab==='scores')c.innerHTML=buildScores(s,activeIdx);
  else if(tab==='report')c.innerHTML=buildReport(s);
  else if(tab==='swot')c.innerHTML=buildSWOT(s,activeIdx);
}
function buildReport(s){const term=SD.config.currentTerm||'Term 1';return`<div class="card"><div class="ct">📋 Print Actions</div><button class="btn-brand" style="width:100%;" onclick="printReportCard(${activeIdx},'${term}')">🖨️ Print Report Card (${term})</button><button class="btn-ghost" style="width:100%;margin-top:0.4rem;" onclick="go('scorecard')">📋 View Full Broadsheet</button></div>`;}
function buildSWOT(s,idx){
  if(!s.swot)s.swot={s:'',w:'',o:'',t:''};
  return`<div class="card"><div class="ct">🧠 SWOT Assessment</div><label>Strengths</label><textarea id="swot-s" rows="2">${esc(s.swot.s)}</textarea><label>Weaknesses</label><textarea id="swot-w" rows="2">${esc(s.swot.w)}</textarea><label>Opportunities</label><textarea id="swot-o" rows="2">${esc(s.swot.o)}</textarea><label>Threats</label><textarea id="swot-t" rows="2">${esc(s.swot.t)}</textarea><button class="btn-brand" style="margin-top:0.5rem;" onclick="saveSWOT(${idx})">💾 Save Assessment</button></div>`;
}
async function saveSWOT(idx){const s=SD.students[idx];if(!s)return;s.swot={s:$('swot-s').value.trim(),w:$('swot-w').value.trim(),o:$('swot-o').value.trim(),t:$('swot-t').value.trim()};await SQ.push('students',SD.students);toast('Assessment saved!');}

// ── Fees Tab ───────────────────────────────────────────────────────────────
function buildFees(s,idx){
  if(!canSeeFees())return`<div class="card" style="text-align:center;padding:1.5rem;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div><div style="font-weight:700;font-size:0.88rem;">Fee data is private</div><div style="font-size:0.78rem;margin-top:0.3rem;">Only the Principal and Bursar can view fee information.</div></div>`;
  const owe=(s.totalFee||0)-(s.paid||0);const pct=s.totalFee?Math.min(100,Math.round(((s.paid||0)/s.totalFee)*100)):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;margin-bottom:0.65rem;"><div class="stat"><div class="sn" style="font-size:1rem;">${fmt(s.totalFee||0)}</div><div class="sl">Fee</div></div><div class="stat"><div class="sn" style="font-size:1rem;color:var(--money);">${fmt(s.paid||0)}</div><div class="sl">Paid</div></div><div class="stat"><div class="sn" style="font-size:1rem;color:var(--danger);">${fmt(owe)}</div><div class="sl">Owing</div></div></div><div class="prog-bg"><div class="prog-fill" style="width:${pct}%;"></div></div><div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% paid</div></div>
  <div class="card"><div class="ct">Record Payment</div><label>Amount (₦)</label><input type="number" id="pay-amt" placeholder="e.g. 25000"><label>Method</label><select id="pay-method"><option>Bank Transfer</option><option>Cash</option><option>POS</option><option>Online</option></select><label>Date</label><input type="date" id="pay-date" value="${new Date().toISOString().split('T')[0]}"><button class="btn-money" onclick="recordPayment(${idx})">💵 Record Payment</button>${owe>0?`<button class="btn-wa" style="margin-top:0.4rem;" onclick="sendReminder(${idx})">📲 Send WhatsApp Reminder</button>`:''}
  ${(s.paymentHistory||[]).length?`<div style="margin-top:0.75rem;"><div style="font-weight:700;font-size:0.82rem;margin-bottom:0.4rem;">Payment History</div>${(s.paymentHistory||[]).map((p,pi)=>`<div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0;border-bottom:1px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:0.8rem;font-weight:600;color:var(--money);">${fmt(p.amount)}</div><div style="font-size:0.7rem;color:var(--sub);">${p.date} · ${p.method}</div></div><button onclick="editPayment(${idx},${pi})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;white-space:nowrap;">✏️</button><button onclick="deletePayment(${idx},${pi})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;white-space:nowrap;">🗑️</button></div>`).join('')}</div>`:''}
  </div>`;
}
async function recordPayment(idx){
  const amt=parseFloat($('pay-amt')?.value);if(!amt||amt<=0)return alert('Enter a valid amount.');
  SD.students[idx].paid=(SD.students[idx].paid||0)+amt;
  if(!SD.students[idx].paymentHistory)SD.students[idx].paymentHistory=[];
  SD.students[idx].paymentHistory.unshift({amount:amt,method:$('pay-method')?.value||'Cash',date:$('pay-date')?.value||new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('students',SD.students);checkTierStatus();
  $('pay-amt').value='';renderTab('fees');renderBanner();renderRevenue();
  alert(`✅ ${fmt(amt)} recorded for ${SD.students[idx].name}`);
}

// ── Attendance Tab ─────────────────────────────────────────────────────────
function buildAttendance(s){
  const days=[];for(let i=0;i<14;i++){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
  const att=SD.attendance||{};const today=days[0];
  const present=days.filter(d=>att[d]?.[s.name]==='Present').length;
  const absent=days.filter(d=>att[d]?.[s.name]==='Absent').length;
  const late=days.filter(d=>att[d]?.[s.name]==='Late').length;
  const pct=days.length>0?Math.round((present/days.length)*100):0;
  return`<div class="card" style="margin-bottom:0.65rem;"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;"><div class="stat"><div class="sn" style="color:var(--money);">${present}</div><div class="sl">Present</div></div><div class="stat"><div class="sn" style="color:var(--danger);">${absent}</div><div class="sl">Absent</div></div><div class="stat"><div class="sn" style="color:var(--warn);">${late}</div><div class="sl">Late</div></div></div><div class="prog-bg" style="margin-top:0.65rem;"><div class="prog-fill" style="width:${pct}%;"></div></div><div style="text-align:right;font-size:0.7rem;color:var(--sub);margin-top:3px;">${pct}% attendance (last 14 days)</div></div>
  <div class="card"><div class="ct" style="display:flex;justify-content:space-between;align-items:center;"><span>📅 Mark Today (${today})</span><button onclick="checkMorningAbsentees()" style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.25);border-radius:7px;padding:3px 10px;font-size:0.7rem;color:#f87171;cursor:pointer;font-weight:700;">🛡️ Absence Alert</button></div>
  <div style="display:flex;gap:0.4rem;margin-bottom:0.75rem;"><button class="btn-money btn-sm" onclick="markAtt(${activeIdx},'${today}','Present')">✅ Present</button><button class="btn-danger btn-sm" onclick="markAtt(${activeIdx},'${today}','Absent')">❌ Absent</button><button style="background:var(--warn);color:white;width:auto;padding:0.32rem 0.7rem;font-size:0.73rem;display:inline-block;margin:0;border-radius:10px;font-weight:700;cursor:pointer;" onclick="markAtt(${activeIdx},'${today}','Late')">⏰ Late</button></div>
  <div>${days.map(d=>{const st=att[d]?.[s.name]||null;const cls=st==='Present'?'chip-ok':st==='Absent'?'chip-bad':st==='Late'?'chip-warn':'';return`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><span style="flex:1;">${d}</span>${st?`<span class="chip ${cls}" style="margin-right:5px;">${st}</span>`:'<span style="color:var(--sub);font-size:0.7rem;margin-right:5px;">—</span>'}<div style="display:flex;gap:3px;" onclick="event.stopPropagation()"><button onclick="correctAttendance('${esc(s.name)}','${d}','Present')" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Present'?'var(--money)':'var(--s2)'};color:${st==='Present'?'white':'var(--text)'};">✅</button><button onclick="correctAttendance('${esc(s.name)}','${d}','Absent')" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Absent'?'var(--danger)':'var(--s2)'};color:${st==='Absent'?'white':'var(--text)'};">❌</button><button onclick="correctAttendance('${esc(s.name)}','${d}','Late')" style="border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.68rem;background:${st==='Late'?'var(--warn)':'var(--s2)'};color:${st==='Late'?'white':'var(--text)'};">⏰</button></div></div>`;}).join('')}</div></div>`;
}
async function markAtt(idx,date,status){const s=SD.students[idx];if(!s)return;if(!SD.attendance)SD.attendance={};if(!SD.attendance[date])SD.attendance[date]={};SD.attendance[date][s.name]=status;await SQ.push('attendance',SD.attendance);renderTab('attendance');}
async function correctAttendance(studentName,date,newStatus){if(!SD.attendance)SD.attendance={};if(!SD.attendance[date])SD.attendance[date]={};if(!newStatus)delete SD.attendance[date][studentName];else SD.attendance[date][studentName]=newStatus;saveLocal('attendance',SD.attendance);await SQ.push('attendance',SD.attendance);toast(`Attendance updated for ${studentName}`);}

// ── Scores Tab — Full Term-Based CA1/CA2/CA3 System ───────────────────────
function scorecardSetTerm(term,idx){
  _activeScoreTerm=term;
  const c=$('profile-content');if(c&&activeIdx===idx)c.innerHTML=buildScores(SD.students[idx],idx);
}
function buildScores(s,idx){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const terms=['Term 1','Term 2','Term 3'];const curTerm=_activeScoreTerm||SD.config.currentTerm||'Term 1';
  const sid=s.id||idx;
  const gradeRow=(tot)=>{const{g,col}=getGrade(tot);return`<span style="font-weight:700;color:${col};font-size:0.8rem;">${g}</span>`;};
  const termTabs=terms.map(t=>`<button onclick="scorecardSetTerm('${t}',${idx})" style="padding:4px 10px;font-size:0.75rem;border-radius:20px;border:1px solid var(--border);background:${t===curTerm?'var(--brand)':'var(--s2)'};color:${t===curTerm?'white':'var(--text)'};cursor:pointer;margin:0 2px;">${t}</button>`).join('');
  const termData=(SD.scores[curTerm]||{})[sid]||{};
  let totalSum=0,subCount=0;
  const rows=subs.map(sub=>{
    const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
    const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);const tot=caT+(v.exam||0);
    if(tot>0){totalSum+=tot;subCount++;}
    return`<tr><td style="font-weight:600;font-size:0.76rem;">${esc(sub)}</td><td><input type="number" min="0" max="10" value="${v.ca1||''}" placeholder="0" onchange="updateScore(${idx},'${curTerm}','${sub.replace(/'/g,"\\'")}','ca1',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td><td><input type="number" min="0" max="10" value="${v.ca2||''}" placeholder="0" onchange="updateScore(${idx},'${curTerm}','${sub.replace(/'/g,"\\'")}','ca2',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td><td><input type="number" min="0" max="10" value="${v.ca3||''}" placeholder="0" onchange="updateScore(${idx},'${curTerm}','${sub.replace(/'/g,"\\'")}','ca3',this.value)" style="margin:0;width:38px;font-size:0.75rem;text-align:center;padding:3px;"></td><td style="font-weight:700;font-size:0.8rem;color:var(--sub);">${caT||''}</td><td><input type="number" min="0" max="70" value="${v.exam||''}" placeholder="0" onchange="updateScore(${idx},'${curTerm}','${sub.replace(/'/g,"\\'")}','exam',this.value)" style="margin:0;width:42px;font-size:0.75rem;text-align:center;padding:3px;"></td><td style="font-weight:800;font-size:0.85rem;color:${tot>=70?'var(--money)':tot>=50?'var(--text)':'var(--danger)'};">${tot||''}</td><td>${tot>0?gradeRow(tot):''}</td></tr>`;
  }).join('');
  const avg=subCount?Math.round(totalSum/subCount):0;
  const aff=((SD.affective||{})[sid]||{})[curTerm]||{};
  const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];
  const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const ratingStars=(trait,val,type)=>[5,4,3,2,1].map(n=>`<label style="cursor:pointer;font-size:1.1rem;color:${(val||0)>=n?'#f59e0b':'var(--border)'};" onclick="updateAffective(${idx},'${curTerm}','${type}_${trait}',${n})">★</label>`).join('');
  const affRows=affTraits.map(t=>`<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['aff_'+t]||0),'aff')}</td></tr>`).join('');
  const psyRows=psyTraits.map(t=>`<tr><td style="font-size:0.8rem;">${t}</td><td>${ratingStars(t,(aff['psy_'+t]||0),'psy')}</td></tr>`).join('');
  return`<div class="card" style="padding:0.75rem 0.5rem;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.4rem;"><div class="ct" style="margin:0;">📚 Scores</div><div>${termTabs}</div></div>
  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table class="stbl" style="font-size:0.78rem;min-width:480px;"><thead><tr><th>Subject</th><th style="font-size:0.7rem;">1st<br>CA/10</th><th style="font-size:0.7rem;">2nd<br>CA/10</th><th style="font-size:0.7rem;">3rd<br>CA/10</th><th style="font-size:0.7rem;">CA<br>Total</th><th style="font-size:0.7rem;">Exam<br>/70</th><th style="font-size:0.7rem;">Total<br>/100</th><th>Grd</th></tr></thead><tbody>${rows}</tbody>${subCount>0?`<tfoot><tr style="background:var(--s2);"><td colspan="6" style="font-weight:700;font-size:0.8rem;">Average</td><td style="font-weight:800;color:var(--brand);">${avg}</td><td>${gradeRow(avg)}</td></tr></tfoot>`:''}</table></div>
  <button class="btn-brand" style="margin-top:0.5rem;width:100%;" onclick="saveScores(${idx})">💾 Save Scores</button>
  <button class="btn-ghost" style="color:var(--danger);font-size:0.76rem;margin-top:0.3rem;width:100%;" onclick="clearStudentScores(${idx},'${curTerm}')">🗑️ Clear All ${curTerm} Scores</button>
  <div class="ct" style="margin-top:1rem;">🌟 Behavioural Assessment (${curTerm})</div>
  <p style="font-size:0.72rem;color:var(--sub);margin-bottom:0.5rem;">Rate each trait ★★★★★ (5=Excellent, 1=Needs Work)</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;"><div><div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">AFFECTIVE DOMAIN</div><table class="stbl" style="font-size:0.78rem;">${affRows}</table></div><div><div style="font-size:0.72rem;font-weight:700;color:var(--sub);margin-bottom:0.3rem;">PSYCHOMOTOR SKILLS</div><table class="stbl" style="font-size:0.78rem;">${psyRows}</table></div></div>
  <button class="btn-ghost" style="margin-top:0.5rem;width:100%;" onclick="printReportCard(${idx},'${curTerm}')">🖨️ Print Report Card</button></div>`;
}
async function updateScore(idx,term,sub,field,val){
  const sid=SD.students[idx]?.id||idx;
  if(!SD.scores[term])SD.scores[term]={};if(!SD.scores[term][sid])SD.scores[term][sid]={};if(!SD.scores[term][sid][sub])SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
  SD.scores[term][sid][sub][field]=parseInt(val)||0;
}
function updateAffective(idx,term,key,val){
  const sid=SD.students[idx]?.id||idx;
  if(!SD.affective[sid])SD.affective[sid]={};if(!SD.affective[sid][term])SD.affective[sid][term]={};
  SD.affective[sid][term][key]=val;saveLocal('affective',SD.affective);SQ.push('affective',SD.affective);
}
function saveScores(idx){saveLocal('scores',SD.scores);SQ.push('scores',SD.scores);toast('✅ Scores saved!');}

// ── Scorecard / Broadsheet ─────────────────────────────────────────────────
function calcStudentTermStats(sid,term,subs){
  const td=(SD.scores[term]||{})[sid]||{};let total=0,count=0;const perSub={};
  subs.forEach(sub=>{const v=td[sub]||{ca1:0,ca2:0,ca3:0,exam:0};const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);const tot=caT+(v.exam||0);perSub[sub]={caT,exam:v.exam||0,tot};if(tot>0){total+=tot;count++;}});
  return{perSub,total,count,avg:count?Math.round(total/count):0};
}
function calcCumulative(sid,subs){
  const terms=['Term 1','Term 2','Term 3'];const cumSub={};
  subs.forEach(sub=>{let tSum=0,tCount=0;terms.forEach(term=>{const td=(SD.scores[term]||{})[sid]||{};const v=td[sub]||{};const tot=(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);if(tot>0){tSum+=tot;tCount++;}});cumSub[sub]=tCount?Math.round(tSum/tCount):0;});
  const totals=Object.values(cumSub).filter(v=>v>0);return{cumSub,avg:totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0};
}
function renderScorecard(){
  const el=document.getElementById('scorecard-content');if(!el)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const activeClass=el.dataset.cls||(classes[0]||'');const activeView=el.dataset.view||'Term 1';
  if(!activeClass){el.innerHTML='<div class="card"><div class="ct">📋 Scorecard / Broadsheet</div><p style="color:var(--sub);">No classes found. Add students and assign classes first.</p></div>';return;}
  const classButtons=classes.map(c=>`<button onclick="scorecardSwitchClass('${esc(c)}')" style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);cursor:pointer;background:${c===activeClass?'var(--brand)':'var(--s2)'};color:${c===activeClass?'white':'var(--text)'};">${esc(c)}</button>`).join('');
  const viewTabs=['Term 1','Term 2','Term 3','Cumulative'].map(v=>`<button onclick="scorecardSwitchView('${v}')" style="padding:5px 12px;border-radius:20px;font-size:0.78rem;border:1px solid var(--border);cursor:pointer;background:${v===activeView?'var(--brand)':'var(--s2)'};color:${v===activeView?'white':'var(--text)'};">${v==='Cumulative'?'📊 Cumulative':v}</button>`).join('');
  const classStudents=SD.students.filter(s=>s.class===activeClass);
  if(!classStudents.length){el.innerHTML=`<div class="card"><div class="ct">📋 Scorecard</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1rem;">${classButtons}</div><p style="color:var(--sub);">No students in this class yet.</p></div>`;return;}
  const isCum=activeView==='Cumulative';
  const studentStats=classStudents.map(s=>{const sid=s.id||SD.students.indexOf(s);if(isCum){const{cumSub,avg}=calcCumulative(sid,subs);return{s,sid,perSub:cumSub,avg};}const{perSub,avg}=calcStudentTermStats(sid,activeView,subs);return{s,sid,perSub,avg};});
  const ranked=[...studentStats].sort((a,b)=>b.avg-a.avg);const posMap={};ranked.forEach((r,i)=>posMap[r.sid]=i+1);
  const subBest={};subs.forEach(sub=>{let best=null,bestScore=0;studentStats.forEach(({s,sid,perSub})=>{const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);if(v>bestScore){bestScore=v;best=s.name;}});if(bestScore>0)subBest[sub]={name:best,score:bestScore};});
  const subHeaders=subs.map(sub=>`<th style="font-size:0.6rem;writing-mode:vertical-lr;transform:rotate(180deg);padding:3px;min-width:26px;">${esc(sub)}</th>`).join('');
  const rows=studentStats.sort((a,b)=>posMap[a.sid]-posMap[b.sid]).map(({s,sid,perSub,avg})=>{
    const pos=posMap[sid];const{g,col}=getGrade(avg);const medal=pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':'';
    const subCells=subs.map(sub=>{const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);const{col:sc}=getGrade(v||0);return`<td style="text-align:center;font-size:0.74rem;font-weight:700;color:${v>0?sc:'var(--border)'};padding:3px 2px;">${v||'–'}</td>`;}).join('');
    return`<tr><td style="text-align:center;font-weight:700;font-size:0.72rem;color:${col};">${medal}${pos}</td><td style="font-size:0.74rem;font-weight:600;white-space:nowrap;min-width:110px;">${esc(s.name)}</td>${subCells}<td style="text-align:center;font-weight:800;font-size:0.82rem;color:${col};">${avg||'–'}</td><td style="text-align:center;"><span style="font-weight:700;font-size:0.74rem;color:${col};">${avg>0?g:'–'}</span></td></tr>`;
  }).join('');
  const top3=ranked.filter(r=>r.avg>0).slice(0,3);
  const honoursCards=top3.map((r,i)=>{const medals=['🥇','🥈','🥉'];const labels=['Best Student','2nd','3rd'];const{col}=getGrade(r.avg);return`<div style="background:var(--s2);border-radius:10px;padding:0.5rem 0.7rem;border:1px solid var(--border);flex:1;min-width:90px;text-align:center;"><div style="font-size:1.3rem;">${medals[i]}</div><div style="font-size:0.68rem;color:var(--sub);">${labels[i]}</div><div style="font-weight:800;font-size:0.8rem;">${esc(r.s.name)}</div><div style="font-weight:700;font-size:0.76rem;color:${col};">Avg: ${r.avg}</div></div>`;}).join('');
  el.dataset.cls=activeClass;el.dataset.view=activeView;
  el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;"><div class="ct">📋 Scorecard / Broadsheet</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.5rem;">${classButtons}</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.7rem;">${viewTabs}</div>${top3.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.7rem;">${honoursCards}</div>`:''}<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;"><table class="stbl" style="font-size:0.74rem;min-width:600px;border-collapse:collapse;"><thead><tr style="background:var(--s1);"><th style="font-size:0.68rem;min-width:28px;">#</th><th style="font-size:0.68rem;text-align:left;min-width:110px;">Name</th>${subHeaders}<th style="font-size:0.68rem;min-width:36px;">Avg</th><th style="font-size:0.68rem;min-width:28px;">Grd</th></tr></thead><tbody>${rows}</tbody></table></div>${Object.keys(subBest).length?`<div class="ct" style="margin-top:0.9rem;">🏆 Subject Champions</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:0.3rem;">${Object.entries(subBest).map(([sub,{name,score}])=>`<div style="background:var(--s2);border-radius:7px;padding:3px 8px;font-size:0.7rem;border:1px solid var(--border);"><span style="color:var(--sub);">${esc(sub)}:</span> <strong>${esc(name)}</strong> (${score})</div>`).join('')}</div>`:''}<div style="display:flex;gap:0.5rem;margin-top:0.7rem;flex-wrap:wrap;"><button class="btn-ghost" onclick="printBroadsheet('${esc(activeClass)}','${activeView}')">🖨️ Print Broadsheet</button><button class="btn-ghost" onclick="printAllReportCards('${esc(activeClass)}','${activeView==='Cumulative'?'Term 3':activeView}')">🖨️ Print All Cards</button><button class="btn-ghost" style="background:var(--s2);" onclick="renderBulkScoreGrid('${esc(activeClass)}','${SD.config.currentTerm||'Term 1'}',0)">✏️ Bulk Score Entry</button><button class="btn-brand" onclick="_wizState={cls:'${esc(activeClass)}',term:SD.config.currentTerm||'Term 1',step:1};renderWizard()">🧙 End-of-Term Wizard</button></div></div>`;
}
function scorecardSwitchClass(cls){const el=document.getElementById('scorecard-content');if(!el)return;el.dataset.cls=cls;renderScorecard();}
function scorecardSwitchView(view){const el=document.getElementById('scorecard-content');if(!el)return;el.dataset.view=view;renderScorecard();}

// ── Bulk Score Entry ───────────────────────────────────────────────────────
function renderBulkScoreGrid(cls,term,subIdx){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const sub=subs[subIdx]||subs[0];const classStudents=SD.students.filter(s=>s.class===cls);
  const el=document.getElementById('scorecard-content');if(!el)return;
  const subTabs=subs.map((s,i)=>`<button onclick="renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${i})" style="padding:4px 9px;border-radius:16px;font-size:0.72rem;white-space:nowrap;border:1px solid var(--border);cursor:pointer;background:${i===subIdx?'var(--brand)':'var(--s2)'};color:${i===subIdx?'white':'var(--text)'};">${esc(s)}</button>`).join('');
  const rows=classStudents.map((s,i)=>{
    const sid=s.id||SD.students.indexOf(s);const v=((SD.scores[term]||{})[sid]||{})[sub]||{ca1:0,ca2:0,ca3:0,exam:0};
    const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);const tot=caT+(v.exam||0);const{g,col}=getGrade(tot);
    return`<tr id="bsg-row-${i}"><td style="font-size:0.76rem;font-weight:600;padding:5px 6px;white-space:nowrap;">${esc(s.name)}</td><td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca1||''}" tabindex="${i*4+1}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${sub.replace(/'/g,"\\'")}',${i},'ca1',this.value)" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid var(--border);border-radius:6px;" id="bsg-${i}-0"></td><td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca2||''}" tabindex="${i*4+2}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${sub.replace(/'/g,"\\'")}',${i},'ca2',this.value)" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid var(--border);border-radius:6px;" id="bsg-${i}-1"></td><td style="padding:2px;"><input type="number" min="0" max="10" value="${v.ca3||''}" tabindex="${i*4+3}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${sub.replace(/'/g,"\\'")}',${i},'ca3',this.value)" style="width:44px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid var(--border);border-radius:6px;" id="bsg-${i}-2"></td><td style="padding:2px;"><input type="number" min="0" max="70" value="${v.exam||''}" tabindex="${i*4+4}" placeholder="0" onchange="bsgUpdate('${esc(cls)}','${esc(term)}','${sub.replace(/'/g,"\\'")}',${i},'exam',this.value)" style="width:48px;text-align:center;margin:0;font-size:0.8rem;padding:4px 2px;border:1px solid var(--border);border-radius:6px;" id="bsg-${i}-3"></td><td style="text-align:center;font-weight:700;font-size:0.82rem;color:${tot>0?'var(--text)':'var(--border)'};">${tot||'–'}</td><td style="text-align:center;"><span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span></td></tr>`;
  }).join('');
  const entered=classStudents.filter(s=>{const sid=s.id||SD.students.indexOf(s);const v=((SD.scores[term]||{})[sid]||{})[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;}).length;
  el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;"><div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem;"><button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="renderScorecard()">← Broadsheet</button><div class="ct" style="margin:0;flex:1;">✏️ Bulk Score Entry — ${esc(cls)} · ${term}</div><button class="btn-brand" style="padding:5px 12px;font-size:0.78rem;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}')">💾 Save All</button></div><p style="font-size:0.74rem;color:var(--sub);margin-bottom:0.5rem;">📌 <strong>${esc(sub)}</strong> · ${entered}/${classStudents.length} students entered · Tab/Enter to move</p><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;overflow-x:auto;padding-bottom:4px;">${subTabs}</div><div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px;"><table class="stbl" style="font-size:0.78rem;min-width:380px;"><thead><tr style="background:var(--s1);"><th style="text-align:left;min-width:110px;">Student</th><th style="min-width:50px;font-size:0.7rem;">1st CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:50px;font-size:0.7rem;">2nd CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:50px;font-size:0.7rem;">3rd CA<br><span style="color:var(--sub)">/10</span></th><th style="min-width:54px;font-size:0.7rem;">Exam<br><span style="color:var(--sub)">/70</span></th><th style="min-width:40px;font-size:0.7rem;">Total<br><span style="color:var(--sub)">/100</span></th><th style="min-width:32px;font-size:0.7rem;">Grd</th></tr></thead><tbody>${rows}</tbody></table></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem;flex-wrap:wrap;gap:0.4rem;">${subIdx>0?`<button class="btn-ghost" style="font-size:0.76rem;padding:5px 12px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx-1})">← ${esc(subs[subIdx-1]||'')}</button>`:'<div></div>'}${subIdx<subs.length-1?`<button class="btn-brand" style="font-size:0.76rem;padding:5px 12px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderBulkScoreGrid('${esc(cls)}','${esc(term)}',${subIdx+1})">${esc(subs[subIdx+1]||'')} →</button>`:`<button class="btn-brand" style="font-size:0.76rem;padding:5px 14px;" onclick="bsgSaveAll('${esc(cls)}','${esc(term)}');renderScorecard()">✅ Done — View Broadsheet</button>`}</div></div>`;
  setTimeout(()=>{for(let i=0;i<classStudents.length;i++){const el=document.getElementById(`bsg-${i}-3`);if(el&&!el.value){el.focus();break;}}},100);
}
function bsgUpdate(cls,term,sub,rowIdx,field,val){
  const cs=SD.students.filter(s=>s.class===cls);const s=cs[rowIdx];if(!s)return;
  const sid=s.id||SD.students.indexOf(s);
  if(!SD.scores[term])SD.scores[term]={};if(!SD.scores[term][sid])SD.scores[term][sid]={};if(!SD.scores[term][sid][sub])SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
  SD.scores[term][sid][sub][field]=parseInt(val)||0;
  const v=SD.scores[term][sid][sub];const tot=(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);
  const row=document.getElementById('bsg-row-'+rowIdx);
  if(row){const cells=row.querySelectorAll('td');const{g,col}=getGrade(tot);if(cells[5])cells[5].textContent=tot||'–';if(cells[6])cells[6].innerHTML=`<span style="font-weight:700;font-size:0.76rem;color:${col};">${tot>0?g:'–'}</span>`;}
}
function bsgNav(e,row,col,total){if(e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();const nx=document.getElementById(`bsg-${row+1}-${col}`);if(nx)nx.focus();}else if(e.key==='ArrowUp'){e.preventDefault();const pv=document.getElementById(`bsg-${row-1}-${col}`);if(pv)pv.focus();}}
function bsgSaveAll(cls,term){saveLocal('scores',SD.scores);SQ.push('scores',SD.scores);toast('✅ Scores saved!');}

// ── Print Report Card ──────────────────────────────────────────────────────
function printReportCard(idx,term){
  const s=SD.students[idx];if(!s)return;const sid=s.id||idx;
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const termData=(SD.scores[term]||{})[sid]||{};const aff=((SD.affective||{})[sid]||{})[term]||{};const cfg=SD.config;
  const classStudents=SD.students.filter(st=>st.class===s.class);
  const allAvgs=classStudents.map(st=>{const stid=st.id||SD.students.indexOf(st);const{avg}=calcStudentTermStats(stid,term,subs);return{name:st.name,avg};}).sort((a,b)=>b.avg-a.avg);
  const myPos=(allAvgs.findIndex(r=>r.name===s.name)+1)||'–';
  const rows=subs.map(sub=>{const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);const tot=caT+(v.exam||0);const{g}=getGrade(tot);const subRanked=classStudents.map(st=>{const stid=st.id||SD.students.indexOf(st);const sv=((SD.scores[term]||{})[stid]||{})[sub]||{};const stot=(sv.ca1||0)+(sv.ca2||0)+(sv.ca3||0)+(sv.exam||0);return{name:st.name,tot:stot};}).sort((a,b)=>b.tot-a.tot);const sPos=(subRanked.findIndex(r=>r.name===s.name)+1)||'–';return`<tr><td>${sub}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td><td>${caT||''}</td><td>${v.exam||''}</td><td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td><td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;}).join('');
  const totals=subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);const avg=totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
  const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';
  const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
  const affRows=affTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['aff_'+t]||0)}</td></tr>`).join('');const psyRows=psyTraits.map(t=>`<tr><td>${t}</td><td>${stars(aff['psy_'+t]||0)}</td></tr>`).join('');
  const w=window.open('','_blank','width=800,height=1100');if(!w)return alert('Please allow popups to print.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Card</title><style>body{font-family:Arial,sans-serif;margin:0;padding:18px;color:#111;font-size:11.5px;}.hdr{text-align:center;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px;}.hdr h1{font-size:17px;margin:3px 0;}.hdr h2{font-size:12px;margin:2px 0;color:#555;}.ig{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:10px;}.sm{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0;}.sb{border:1px solid #ccc;border-radius:4px;padding:5px;text-align:center;}.sv{font-size:15px;font-weight:800;color:#2563eb;}table{width:100%;border-collapse:collapse;margin-bottom:10px;}th,td{border:1px solid #bbb;padding:3px 5px;}th{background:#f0f0f0;font-size:10.5px;}.rg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;}.rb{border:1px solid #ccc;border-radius:4px;padding:6px;min-height:45px;}@media print{button{display:none;}}</style></head><body><div class="hdr"><h1>${esc(cfg.schoolName||'School')}</h1><h2>Report Card — ${term} | ${cfg.session||''}</h2></div><div class="ig"><div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div><div><b>Term:</b> ${term}</div><div><b>Position:</b> ${myPos} of ${classStudents.length}</div></div><div class="sm"><div class="sb"><div class="sv">${avg||'–'}</div>Average</div><div class="sb"><div class="sv">${avg>0?getGrade(avg).g:'–'}</div>Grade</div><div class="sb"><div class="sv">${myPos}</div>Position</div><div class="sb"><div class="sv">${classStudents.length}</div>In Class</div></div><table><thead><tr><th>Subject</th><th>1st CA</th><th>2nd CA</th><th>3rd CA</th><th>CA/30</th><th>Exam/70</th><th>Total/100</th><th>Grade</th><th>Pos.</th></tr></thead><tbody>${rows}</tbody></table><div class="rg"><div><b>AFFECTIVE DOMAIN</b><table><thead><tr><th>Trait</th><th>Rating</th></tr></thead><tbody>${affRows}</tbody></table></div><div><b>PSYCHOMOTOR SKILLS</b><table><thead><tr><th>Skill</th><th>Rating</th></tr></thead><tbody>${psyRows}</tbody></table></div></div><div class="rg" style="margin-top:6px;"><div class="rb"><b>Class Teacher's Remark:</b><br><br>____________________</div><div class="rb"><b>Principal's Comment:</b><br><br>____________________</div></div><div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;"><div>Teacher's Signature: ______________</div><div>Principal's Signature: ______________</div><div>Next Term Begins: ______________</div></div><div style="text-align:center;margin-top:10px;"><button onclick="window.print()" style="padding:7px 18px;cursor:pointer;">🖨️ Print / Save PDF</button></div></body></html>`);w.document.close();
}
function printBroadsheet(cls,view){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const isCum=view==='Cumulative';const classStudents=SD.students.filter(s=>s.class===cls);
  const stats=classStudents.map(s=>{const sid=s.id||SD.students.indexOf(s);if(isCum){const{cumSub,avg}=calcCumulative(sid,subs);return{s,perSub:cumSub,avg};}const{perSub,avg}=calcStudentTermStats(sid,view,subs);return{s,perSub,avg};}).sort((a,b)=>b.avg-a.avg);
  const thCells=subs.map(s=>`<th style="writing-mode:vertical-lr;transform:rotate(180deg);font-size:9px;padding:2px;">${s}</th>`).join('');
  const rows=stats.map(({s,perSub,avg},i)=>{const cells=subs.map(sub=>{const v=isCum?perSub[sub]:(perSub[sub]?.tot||0);return`<td style="text-align:center;font-size:9.5px;">${v||'–'}</td>`;}).join('');const{g}=getGrade(avg);return`<tr><td>${i+1}</td><td style="white-space:nowrap;font-size:10px;">${esc(s.name)}</td>${cells}<td style="font-weight:700;">${avg||'–'}</td><td>${avg>0?g:''}</td></tr>`;}).join('');
  const w=window.open('','_blank','width=1100,height=800');if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Broadsheet</title><style>body{font-family:Arial;font-size:10px;padding:12px;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #999;padding:2px 4px;}th{background:#f0f0f0;font-weight:700;}@media print{button{display:none;}}</style></head><body><h2 style="text-align:center;margin-bottom:3px;">${esc(SD.config.schoolName||'School')} — Broadsheet</h2><h3 style="text-align:center;margin-bottom:8px;">${esc(cls)} | ${view==='Cumulative'?'Cumulative (All Terms)':view}</h3><table><thead><tr><th>#</th><th>Student Name</th>${thCells}<th>Avg</th><th>Grd</th></tr></thead><tbody>${rows}</tbody></table><button onclick="window.print()" style="margin-top:8px;padding:5px 14px;cursor:pointer;">🖨️ Print</button></body></html>`);w.document.close();
}
function printAllReportCards(cls,term){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','National Values Education','French Language','Home Economics','Business Studies','Religious Studies'];
  const classStudents=SD.students.filter(s=>s.class===cls);if(!classStudents.length){toast('No students in this class.');return;}
  const cfg=SD.config;const allAvgs=classStudents.map(s=>{const sid=s.id||SD.students.indexOf(s);const{avg}=calcStudentTermStats(sid,term,subs);return{name:s.name,avg};}).sort((a,b)=>b.avg-a.avg);
  const cards=classStudents.map(s=>{
    const sid=s.id||SD.students.indexOf(s);const termData=(SD.scores[term]||{})[sid]||{};const aff=((SD.affective||{})[sid]||{})[term]||{};
    const myPos=(allAvgs.findIndex(r=>r.name===s.name)+1)||'–';
    const rows=subs.map(sub=>{const v=termData[sub]||{ca1:0,ca2:0,ca3:0,exam:0};const caT=(v.ca1||0)+(v.ca2||0)+(v.ca3||0);const tot=caT+(v.exam||0);const{g}=getGrade(tot);const subRanked=classStudents.map(st=>{const stid=st.id||SD.students.indexOf(st);const sv=((SD.scores[term]||{})[stid]||{})[sub]||{};return{name:st.name,tot:(sv.ca1||0)+(sv.ca2||0)+(sv.ca3||0)+(sv.exam||0)};}).sort((a,b)=>b.tot-a.tot);const sPos=(subRanked.findIndex(r=>r.name===s.name)+1)||'–';return`<tr><td>${sub}</td><td>${v.ca1||''}</td><td>${v.ca2||''}</td><td>${v.ca3||''}</td><td>${caT||''}</td><td>${v.exam||''}</td><td style="font-weight:700;color:${tot>=70?'green':tot>=50?'#333':'red'};">${tot||''}</td><td style="font-weight:700;">${tot>0?g:''}</td><td>${tot>0?sPos:''}</td></tr>`;}).join('');
    const totals=subs.map(sub=>{const v=termData[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0);}).filter(v=>v>0);const avg=totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length):0;
    const stars=n=>['','★','★★','★★★','★★★★','★★★★★'][n]||'–';const affTraits=['Punctuality','Neatness','Attentiveness','Honesty','Politeness','Relationship with others'];const psyTraits=['Handwriting','Sports Ability','Drawing & Craft','Class Participation'];
    return`<div style="page-break-after:always;padding:18px;font-family:Arial,sans-serif;font-size:11.5px;color:#111;max-width:720px;margin:0 auto;"><div style="text-align:center;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:10px;"><h1 style="font-size:17px;margin:3px 0;">${esc(cfg.schoolName||'School')}</h1><h2 style="font-size:12px;margin:2px 0;color:#555;">Student Report Card — ${term}</h2></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px;"><div><b>Student:</b> ${esc(s.name)}</div><div><b>Class:</b> ${esc(s.class||'')}</div><div><b>Term:</b> ${term}</div><div><b>Position:</b> ${myPos} of ${classStudents.length}</div></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0;text-align:center;"><div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg||'–'}</div>Average</div><div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${avg>0?getGrade(avg).g:'–'}</div>Grade</div><div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${myPos}</div>Position</div><div style="border:1px solid #ccc;border-radius:4px;padding:5px;"><div style="font-size:15px;font-weight:800;color:#2563eb;">${classStudents.length}</div>In Class</div></div><table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:8px;"><thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:3px 4px;text-align:left;">Subject</th><th style="border:1px solid #bbb;padding:3px 2px;">1st CA</th><th style="border:1px solid #bbb;padding:3px 2px;">2nd CA</th><th style="border:1px solid #bbb;padding:3px 2px;">3rd CA</th><th style="border:1px solid #bbb;padding:3px 2px;">CA/30</th><th style="border:1px solid #bbb;padding:3px 2px;">Exam/70</th><th style="border:1px solid #bbb;padding:3px 2px;font-weight:700;">Total/100</th><th style="border:1px solid #bbb;padding:3px 2px;">Grade</th><th style="border:1px solid #bbb;padding:3px 2px;">Pos.</th></tr></thead><tbody>${rows}</tbody></table><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"><div><b>AFFECTIVE DOMAIN</b><table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;">Trait</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead><tbody>${affTraits.map(t=>`<tr><td style="border:1px solid #bbb;padding:2px 4px;">${t}</td><td style="border:1px solid #bbb;padding:2px 4px;">${stars(aff['aff_'+t]||0)}</td></tr>`).join('')}</tbody></table></div><div><b>PSYCHOMOTOR SKILLS</b><table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f0f0f0;"><th style="border:1px solid #bbb;padding:2px 4px;">Skill</th><th style="border:1px solid #bbb;padding:2px 4px;">Rating</th></tr></thead><tbody>${psyTraits.map(t=>`<tr><td style="border:1px solid #bbb;padding:2px 4px;">${t}</td><td style="border:1px solid #bbb;padding:2px 4px;">${stars(aff['psy_'+t]||0)}</td></tr>`).join('')}</tbody></table></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;"><div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Class Teacher's Remark:</b><br><br>____________________</div><div style="border:1px solid #ccc;border-radius:4px;padding:6px;min-height:40px;"><b>Principal's Comment:</b><br><br>____________________</div></div><div style="display:flex;justify-content:space-between;font-size:10px;margin-top:6px;flex-wrap:wrap;gap:4px;"><div>Teacher's Signature: ______________</div><div>Principal's Signature: ______________</div><div>Next Term Begins: ______________</div></div></div>`;
  }).join('\n');
  const w=window.open('','_blank','width=820,height=900');if(!w)return alert('Please allow popups.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Cards – ${esc(cls)} – ${term}</title><style>body{margin:0;padding:10px;background:#f5f5f5;}table td,table th{border:1px solid #bbb;padding:3px 4px;}@media print{body{background:none;padding:0;}.no-print{display:none;}}</style></head><body><div class="no-print" style="position:sticky;top:0;background:#1e293b;color:white;padding:10px 16px;display:flex;align-items:center;gap:12px;z-index:999;font-family:sans-serif;"><span style="font-weight:700;">📋 ${classStudents.length} Report Cards — ${esc(cls)} · ${term}</span><button onclick="window.print()" style="padding:6px 18px;background:#22c55e;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;">🖨️ Print All / Save PDF</button></div>${cards}</body></html>`);w.document.close();
}

// ── End-of-Term Wizard ─────────────────────────────────────────────────────
function renderWizard(){
  const el=document.getElementById('scorecard-content');if(!el)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  const{cls,term,step}=_wizState;
  if(step===1){
    const classOpts=classes.map(c=>`<option value="${esc(c)}" ${c===cls?'selected':''}>${esc(c)}</option>`).join('');
    el.innerHTML=`<div class="card" style="padding:1rem 0.75rem;max-width:440px;margin:0 auto;"><div style="text-align:center;margin-bottom:1rem;"><div style="font-size:2rem;">📋</div><div style="font-weight:800;font-size:1.05rem;">End-of-Term Wizard</div><p style="color:var(--sub);font-size:0.8rem;margin-top:4px;">Close out the term in 3 steps — score entry, review rankings, print all cards.</p></div><div style="display:flex;flex-direction:column;gap:0.6rem;"><div><label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Class</label><select id="wiz-class" style="width:100%;font-size:0.9rem;">${classOpts}</select></div><div><label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:3px;">Term to close</label><select id="wiz-term" style="width:100%;font-size:0.9rem;"><option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option><option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option><option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option></select></div><button class="btn-brand" style="margin-top:0.4rem;padding:0.65rem;" onclick="wizNext1()">Let's go → Step 1: Enter Scores</button><button class="btn-ghost" style="font-size:0.78rem;" onclick="renderScorecard()">← Back to Broadsheet</button></div></div>`;return;
  }
  if(step===2){
    const classStudents=SD.students.filter(s=>s.class===cls);const totalSubs=subs.length;
    const subsDone=subs.filter(sub=>classStudents.some(s=>{const sid=s.id||SD.students.indexOf(s);const v=((SD.scores[term]||{})[sid]||{})[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;})).length;
    const pct=Math.round(subsDone/totalSubs*100);
    const subChips=subs.map((sub,i)=>{const done=classStudents.some(s=>{const sid=s.id||SD.students.indexOf(s);const v=((SD.scores[term]||{})[sid]||{})[sub]||{};return(v.ca1||0)+(v.ca2||0)+(v.ca3||0)+(v.exam||0)>0;});return`<div onclick="wizOpenSubject(${i})" style="padding:3px 8px;border-radius:12px;font-size:0.7rem;cursor:pointer;border:1px solid ${done?'var(--money)':'var(--border)'};background:${done?'rgba(16,185,129,0.08)':'var(--s2)'};color:${done?'var(--money)':'var(--text)'};">${done?'✅':'○'} ${esc(sub)}</div>`;}).join('');
    el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;"><div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;"><button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=1;renderWizard()">← Back</button><div class="ct" style="margin:0;flex:1;">Step 1: Enter Scores — ${esc(cls)} · ${term}</div><button class="btn-brand" style="padding:5px 12px;font-size:0.78rem;" onclick="wizStep3()">Next: Review Rankings →</button></div><div style="background:var(--s2);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.65rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><span style="font-size:0.78rem;font-weight:700;">${subsDone}/${totalSubs} subjects entered</span><span style="font-size:0.76rem;color:var(--brand);font-weight:700;">${pct}%</span></div><div style="background:var(--border);border-radius:6px;height:7px;"><div style="background:var(--brand);width:${pct}%;height:7px;border-radius:6px;"></div></div></div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:0.65rem;">${subChips}</div><p style="font-size:0.74rem;color:var(--sub);">Tap a subject above to open its score entry grid. Green = scores entered.</p><button class="btn-brand" style="flex:1;font-size:0.8rem;width:100%;" onclick="wizOpenSubject(0)">✏️ Start with ${esc(subs[0])}</button></div>`;return;
  }
  if(step===3){
    const classStudents=SD.students.filter(s=>s.class===cls);
    const stats=classStudents.map(s=>{const sid=s.id||SD.students.indexOf(s);const{avg,count}=calcStudentTermStats(sid,term,subs);return{s,avg,count};}).sort((a,b)=>b.avg-a.avg);
    const entered=stats.filter(r=>r.count>0).length;
    const honours=stats.filter(r=>r.avg>0).slice(0,3).map((r,i)=>{const medals=['🥇','🥈','🥉'];const{col}=getGrade(r.avg);return`<div style="background:var(--s2);border-radius:10px;padding:0.6rem 0.75rem;text-align:center;flex:1;min-width:100px;border:1px solid var(--border);"><div style="font-size:1.5rem;">${medals[i]}</div><div style="font-weight:800;font-size:0.82rem;">${esc(r.s.name)}</div><div style="font-size:0.76rem;color:${col};font-weight:700;">Avg: ${r.avg}</div></div>`;}).join('');
    const rankRows=stats.map((r,i)=>{const{g,col}=getGrade(r.avg);const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';return`<tr><td style="text-align:center;font-weight:700;color:${col};">${medal}${i+1}</td><td style="font-size:0.78rem;font-weight:600;">${esc(r.s.name)}</td><td style="text-align:center;font-weight:800;color:${col};">${r.avg||'–'}</td><td style="text-align:center;"><span style="font-weight:700;color:${col};">${r.avg>0?g:'–'}</span></td></tr>`;}).join('');
    el.innerHTML=`<div class="card" style="padding:0.75rem 0.5rem;"><div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap;"><button class="btn-ghost" style="padding:4px 10px;font-size:0.76rem;" onclick="_wizState.step=2;renderWizard()">← Back to Scores</button><div class="ct" style="margin:0;flex:1;">Step 2: Rankings — ${esc(cls)} · ${term}</div></div><p style="font-size:0.76rem;color:var(--sub);margin-bottom:0.65rem;">${entered}/${classStudents.length} students have scores entered</p>${honours?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.75rem;">${honours}</div>`:''}<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:0.65rem;"><table class="stbl" style="font-size:0.78rem;"><thead><tr style="background:var(--s1);"><th style="width:36px;">#</th><th style="text-align:left;">Student</th><th>Average</th><th>Grade</th></tr></thead><tbody>${rankRows}</tbody></table></div><div style="display:flex;gap:0.5rem;flex-wrap:wrap;"><button class="btn-ghost" style="flex:1;" onclick="_wizState.step=2;renderWizard()">← Fix Scores</button><button class="btn-brand" style="flex:2;font-size:0.88rem;padding:0.65rem;" onclick="wizPrintAll()">🖨️ Print All ${classStudents.length} Report Cards →</button></div></div>`;
  }
}
function wizNext1(){_wizState.cls=document.getElementById('wiz-class')?.value||'';_wizState.term=document.getElementById('wiz-term')?.value||'Term 1';_wizState.step=2;renderWizard();}
function wizOpenSubject(subIdx){const{cls,term}=_wizState;renderBulkScoreGrid(cls,term,subIdx);setTimeout(()=>{document.querySelectorAll('#scorecard-content button').forEach(b=>{if(b.textContent.includes('← Broadsheet')){b.textContent='← Back to Wizard';b.onclick=()=>{_wizState.step=2;renderWizard();};}});},80);}
function wizStep3(){_wizState.step=3;renderWizard();}
function wizPrintAll(){printAllReportCards(_wizState.cls,_wizState.term);}
function clearStudentScores(studentIdx,term){const s=SD.students[studentIdx];if(!s)return;if(!confirm(`Clear ALL scores for ${s.name} — ${term}?`))return;const sid=s.id||studentIdx;if(SD.scores[term]&&SD.scores[term][sid])delete SD.scores[term][sid];saveLocal('scores',SD.scores);SQ.push('scores',SD.scores);renderTab('scores');toast('🗑️ Scores cleared.');}

// ── Edit & Delete System ───────────────────────────────────────────────────
function editStudent(idx){
  const s=SD.students[idx];if(!s)return;
  const html=`<div style="display:flex;flex-direction:column;gap:0.5rem;"><div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Student</div><label>Full Name</label><input id="edit-s-name" value="${esc(s.name)}"><label>Phone</label><input id="edit-s-phone" value="${esc(s.phone||'')}"><label>Class</label><input id="edit-s-class" value="${esc(s.class||'')}"><label>Total Fee (₦)</label><input id="edit-s-fee" type="number" value="${s.totalFee||''}"><div style="display:flex;gap:0.5rem;margin-top:0.4rem;"><button class="btn-brand" style="flex:1;" onclick="saveEditStudent(${idx})">💾 Save</button><button class="btn-ghost" style="flex:1;" onclick="closeM('edit-student-modal')">Cancel</button></div></div>`;
  let m=$('edit-student-modal');if(!m){m=document.createElement('div');m.id='edit-student-modal';m.className='modal';const b=document.createElement('div');b.className='mbox';b.innerHTML='<button class="mclose" onclick="closeM(\'edit-student-modal\')">✕</button><div id="edit-student-modal-body"></div>';m.appendChild(b);document.body.appendChild(m);}
  $('edit-student-modal-body').innerHTML=html;openM('edit-student-modal');
}
async function saveEditStudent(idx){
  const s=SD.students[idx];if(!s)return;const old=s.name;const n=$('edit-s-name').value.trim();if(!n)return alert('Name cannot be empty.');
  s.name=n;s.phone=$('edit-s-phone').value.trim().replace(/\D/g,'');s.class=$('edit-s-class').value.trim();s.totalFee=parseFloat($('edit-s-fee').value)||s.totalFee||50000;
  if(old!==n&&SD.attendance){Object.keys(SD.attendance).forEach(date=>{if(SD.attendance[date][old]!==undefined){SD.attendance[date][n]=SD.attendance[date][old];delete SD.attendance[date][old];}});await SQ.push('attendance',SD.attendance);saveLocal('attendance',SD.attendance);}
  await SQ.push('students',SD.students);saveLocal('students',SD.students);closeM('edit-student-modal');renderStudentList();renderBanner();renderRevenue();toast('✅ Student updated!');
}
async function deletePayment(studentIdx,payIdx){
  const s=SD.students[studentIdx];if(!s)return;const p=(s.paymentHistory||[])[payIdx];if(!p)return;
  if(!confirm(`Delete payment of ${fmt(p.amount)} on ${p.date}?`))return;
  s.paid=Math.max(0,(s.paid||0)-(p.amount||0));s.paymentHistory.splice(payIdx,1);
  await SQ.push('students',SD.students);saveLocal('students',SD.students);renderTab('fees');toast('🗑️ Payment deleted.');
}
function editPayment(studentIdx,payIdx){
  const s=SD.students[studentIdx];if(!s)return;const p=(s.paymentHistory||[])[payIdx];if(!p)return;
  const html=`<div style="display:flex;flex-direction:column;gap:0.5rem;"><div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Payment</div><label>Amount (₦)</label><input id="ep-amt" type="number" value="${p.amount||''}"><label>Method</label><select id="ep-method">${['Bank Transfer','Cash','POS','Online'].map(m=>`<option ${m===p.method?'selected':''}>${m}</option>`).join('')}</select><label>Date</label><input id="ep-date" type="date" value="${p.date||''}"><div style="display:flex;gap:0.5rem;margin-top:0.4rem;"><button class="btn-brand" style="flex:1;" onclick="saveEditPayment(${studentIdx},${payIdx})">💾 Save</button><button class="btn-ghost" style="flex:1;" onclick="closeM('edit-payment-modal')">Cancel</button></div></div>`;
  let m=$('edit-payment-modal');if(!m){m=document.createElement('div');m.id='edit-payment-modal';m.className='modal';const b=document.createElement('div');b.className='mbox';b.innerHTML='<button class="mclose" onclick="closeM(\'edit-payment-modal\')">✕</button><div id="edit-payment-modal-body"></div>';m.appendChild(b);document.body.appendChild(m);}
  $('edit-payment-modal-body').innerHTML=html;openM('edit-payment-modal');
}
async function saveEditPayment(studentIdx,payIdx){
  const s=SD.students[studentIdx];if(!s)return;const p=(s.paymentHistory||[])[payIdx];if(!p)return;
  const oldAmt=p.amount||0;const newAmt=parseFloat($('ep-amt').value)||0;if(!newAmt)return alert('Enter a valid amount.');
  p.amount=newAmt;p.method=$('ep-method').value;p.date=$('ep-date').value;s.paid=Math.max(0,(s.paid||0)-oldAmt+newAmt);
  await SQ.push('students',SD.students);saveLocal('students',SD.students);closeM('edit-payment-modal');renderTab('fees');toast('✅ Payment updated!');
}
function editStaff(idx){
  const s=(SD.staff||[])[idx];if(!s)return;
  const html=`<div style="display:flex;flex-direction:column;gap:0.5rem;"><div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Staff</div><label>Full Name</label><input id="est-name" value="${esc(s.name||'')}"><label>Email</label><input id="est-email" value="${esc(s.email||'')}"><label>Role</label><select id="est-role">${['Principal','Bursar','Class Teacher','Subject Teacher'].map(r=>`<option value="${r}" ${s.role===r?'selected':''}>${r}</option>`).join('')}</select><div style="display:flex;gap:0.5rem;margin-top:0.4rem;"><button class="btn-brand" style="flex:1;" onclick="saveEditStaff(${idx})">💾 Save</button><button class="btn-ghost" style="flex:1;" onclick="closeM('edit-staff-modal')">Cancel</button></div></div>`;
  let m=$('edit-staff-modal');if(!m){m=document.createElement('div');m.id='edit-staff-modal';m.className='modal';const b=document.createElement('div');b.className='mbox';b.innerHTML='<button class="mclose" onclick="closeM(\'edit-staff-modal\')">✕</button><div id="edit-staff-modal-body"></div>';m.appendChild(b);document.body.appendChild(m);}
  $('edit-staff-modal-body').innerHTML=html;openM('edit-staff-modal');
}
async function saveEditStaff(idx){const s=(SD.staff||[])[idx];if(!s)return;s.name=$('est-name').value.trim()||s.name;s.email=$('est-email').value.trim()||s.email;s.role=$('est-role').value;await SQ.push('staff',SD.staff);saveLocal('staff',SD.staff);closeM('edit-staff-modal');if(typeof renderStaff==='function')renderStaff();toast('✅ Staff updated!');}
async function deleteStaff(idx){const s=(SD.staff||[])[idx];if(!s)return;if(!confirm(`Remove ${s.name} from staff?`))return;SD.staff.splice(idx,1);await SQ.push('staff',SD.staff);saveLocal('staff',SD.staff);renderStaff();toast('🗑️ Staff removed.');}
function editExpense(idx){
  const e=(SD.expenses||[])[idx];if(!e)return;
  const cats=['Staff Salaries','Utilities (NEPA/Generator)','Building Maintenance','Teaching Materials','Government Fees','Cleaning & Security','Transport','Examination Fees','Other'];
  const html=`<div style="display:flex;flex-direction:column;gap:0.5rem;"><div class="ct" style="margin:0 0 0.4rem;">✏️ Edit Expense</div><label>Category</label><select id="ee-cat">${cats.map(c=>`<option ${c===e.category?'selected':''}>${c}</option>`).join('')}</select><label>Description</label><input id="ee-desc" value="${esc(e.description||'')}"><label>Amount (₦)</label><input id="ee-amt" type="number" value="${e.amount||''}"><label>Date</label><input id="ee-date" type="date" value="${e.date||''}"><div style="display:flex;gap:0.5rem;margin-top:0.4rem;"><button class="btn-brand" style="flex:1;" onclick="saveEditExpense(${idx})">💾 Save</button><button class="btn-ghost" style="flex:1;" onclick="closeM('edit-expense-modal')">Cancel</button></div></div>`;
  let m=$('edit-expense-modal');if(!m){m=document.createElement('div');m.id='edit-expense-modal';m.className='modal';const b=document.createElement('div');b.className='mbox';b.innerHTML='<button class="mclose" onclick="closeM(\'edit-expense-modal\')">✕</button><div id="edit-expense-modal-body"></div>';m.appendChild(b);document.body.appendChild(m);}
  $('edit-expense-modal-body').innerHTML=html;openM('edit-expense-modal');
}
async function saveEditExpense(idx){const e=(SD.expenses||[])[idx];if(!e)return;e.category=$('ee-cat').value;e.description=$('ee-desc').value.trim()||e.description;e.amount=parseFloat($('ee-amt').value)||e.amount;e.date=$('ee-date').value||e.date;await SQ.push('expenses',SD.expenses);saveLocal('expenses',SD.expenses);closeM('edit-expense-modal');renderExpenses();toast('✅ Expense updated!');}
async function deleteExpenseItem(idx){if(!confirm('Delete this expense?'))return;SD.expenses.splice(idx,1);await SQ.push('expenses',SD.expenses);saveLocal('expenses',SD.expenses);renderExpenses();toast('🗑️ Expense deleted.');}

// ── Upgrade Modal ──────────────────────────────────────────────────────────
function renderUpgradeModal(){
  const cfg=SD.config||{};const count=(SD.students||[]).length;
  const tMax=cfg.tierMax||getTier(count).max;const tName=cfg.tier||getTier(count).name;const tPrice=cfg.tierPrice||getTier(count).price;const isPrem=cfg.plan==='premium';
  const ne=$('up-plan-name');const te=$('up-tier-info');const se=$('up-student-info');const tb=$('up-tier-table');
  if(ne)ne.textContent=(isPrem?'⭐ PREMIUM':'📋 BASIC')+' — '+(tName||'—');
  if(te)te.textContent='₦'+Number(tPrice||0).toLocaleString('en-NG')+'/term · Up to '+(tMax||'?')+' students';
  if(se)se.textContent='Current students: '+count+(count>tMax?' ⚠️ OVER LIMIT':' ✅');
  if(tb){tb.innerHTML=TIERS.map(t=>{const current=count<=t.max&&(TIERS.indexOf(t)===0||count>TIERS[TIERS.indexOf(t)-1].max);return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;margin-bottom:4px;background:${current?'#ecfdf5':'var(--s2)'};border:1px solid ${current?'#86efac':'var(--border)'};"><span>${current?'✅ ':''}<b>${t.name}</b></span><span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--money);">₦${Number(t.price).toLocaleString('en-NG')}/term</span></div>`;}).join('');}
}
function openUpgradeModal(){renderUpgradeModal();const m=$('upgrade-modal');if(m)m.classList.add('on');}
async function refreshPlanFromFirestore(btn){
  if(!btn)btn=document.querySelector('[onclick*="refreshPlanFromFirestore"]');
  if(btn){btn.textContent='⏳ Checking...';btn.disabled=true;}
  const sid=schoolId||SD.config?._schoolId;if(!sid||!db){if(btn){btn.textContent='❌ Not connected';btn.disabled=false;}return;}
  try{
    const snap=await db.collection('schools').doc(sid).get();
    if(snap.exists){const cfg=snap.data().config||{};SD.config={...SD.config,...cfg};localStorage.setItem(`p_${sid}_config`,JSON.stringify(SD.config));checkTierStatus();renderUpgradeModal();if(btn)btn.textContent='✅ Plan refreshed!';}
    else{if(btn)btn.textContent='❌ School not found';}
  }catch(e){if(btn)btn.textContent='❌ Error — try again';console.error('refreshPlan:',e);}
  setTimeout(()=>{if(btn){btn.textContent='🔄 Refresh Plan (after payment)';btn.disabled=false;}},3000);
}

// ── Birthday Widget ────────────────────────────────────────────────────────
function renderBirthdays(){
  const w=$('birthday-widget');if(!w)return;
  const today=new Date().toISOString().slice(5,10);
  const celebrants=SD.students.filter(s=>s.dob&&s.dob.slice(5,10)===today);
  if(!celebrants.length){w.style.display='none';return;}
  w.style.cssText='background:linear-gradient(135deg,#fdf2f8,#fce7f3);border:1px solid #fbcfe8;border-radius:12px;padding:0.75rem 1rem;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;';
  w.innerHTML=`<div style="font-size:0.8rem;color:#9d174d;line-height:1.4;">🎉 <b>Celebrating Today:</b> ${celebrants.map(c=>`<b>${esc(c.name)}</b> (${esc(c.class||'—')})`).join(', ')}</div><button onclick="sendBulkBirthdayWishes()" style="background:#ec4899;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;">🎂 Wish Parent</button>`;
}
function sendBulkBirthdayWishes(){
  const today=new Date().toISOString().slice(5,10);const celebrants=SD.students.filter(s=>s.dob&&s.dob.slice(5,10)===today);const sn=SD.config.schoolName||'School';
  celebrants.forEach(c=>{if(c.phone){const msg=`Dear Parent,\n\nWe celebrate *${c.name}* on their birthday today! We wish them long life and great success.\n\nBest regards,\n*${sn}*`;window.open(`https://wa.me/${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');}});
}

// ── Staff ──────────────────────────────────────────────────────────────────
function renderStaff(){
  const staff=SD.staff||[];const isPrem=SD.config.plan==='premium';const limit=isPrem?'∞':3;
  if($('staff-count'))$('staff-count').textContent=`${staff.length}/${limit} (${isPrem?'Premium':'Basic'})`;
  const el=$('staff-list');if(!el)return;
  if(!staff.length){el.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No staff added yet.</p>';return;}
  el.innerHTML=staff.map((s,i)=>`<div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0;border-bottom:1px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.88rem;">${esc(s.name)}</div><div style="font-size:0.72rem;color:var(--sub);">${s.email||''} · ${(s.role||'').replace('_',' ')}</div></div><div style="display:flex;gap:5px;flex-shrink:0;"><button onclick="editStaff(${i})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#2563eb;">✏️</button>${s.role!=='Principal'?`<button onclick="deleteStaff(${i})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 11px;cursor:pointer;font-size:0.78rem;color:#dc2626;">🗑️</button>`:''}</div></div>`).join('');
  if($('staff-upgrade'))$('staff-upgrade').style.display=(!isPrem&&staff.length>=3)?'block':'none';
}
async function addStaff(){
  const name=$('sf-name').value.trim(),email=$('sf-email').value.trim(),pwd=$('sf-pwd').value,role=$('sf-role').value;
  const assignedClass=($('sf-class')?.value||'').trim();const assignedSubjects=($('sf-subjects')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!name||!email||!pwd)return alert('Fill all fields.');if(pwd.length<4)return alert('Password min 4 chars.');
  if(role==='Class Teacher'&&!assignedClass)return alert('Assign a class for this Class Teacher.');
  if((SD.staff||[]).find(s=>s.email===email))return alert('Email already registered.');
  if(!SD.config.plan==='premium'&&(SD.staff||[]).length>=3){openUpgradeModal();return;}
  if(!SD.staff)SD.staff=[];
  SD.staff.push({name,email,password:pwd,role,assignedClass:assignedClass||null,assignedSubjects});
  await SQ.push('staff',SD.staff);closeM('add-staff-modal');$('sf-name').value='';$('sf-email').value='';$('sf-pwd').value='';if($('sf-class'))$('sf-class').value='';if($('sf-subjects'))$('sf-subjects').value='';renderStaff();alert(`✅ ${name} added as ${role}.`);
}
function onRoleChange(sel){const role=sel.value;const cr=$('sf-class-row');if(cr)cr.style.display=role==='Class Teacher'?'block':'none';const sr=$('sf-subjects-row');if(sr)sr.style.display=role==='Subject Teacher'?'block':'none';}

// ── Expenses ───────────────────────────────────────────────────────────────
function renderExpenses(){
  const exp=SD.expenses||[];let total=0;exp.forEach(e=>total+=e.amount||0);
  if($('exp-total'))$('exp-total').textContent=fmt(total);const el=$('exp-list');if(!el)return;
  if(!exp.length){el.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No expenses logged yet.</p>';return;}
  el.innerHTML=exp.map((e,i)=>`<div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:0.82rem;font-weight:600;">${esc(e.description||'')}</div><div style="font-size:0.7rem;color:var(--sub);">${e.category||''} · ${e.date||''}</div></div><strong style="font-family:'JetBrains Mono',monospace;color:var(--danger);font-size:0.82rem;flex-shrink:0;">${fmt(e.amount||0)}</strong><div style="display:flex;gap:5px;flex-shrink:0;"><button onclick="editExpense(${i})" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#2563eb;">✏️</button><button onclick="deleteExpenseItem(${i})" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;color:#dc2626;">🗑️</button></div></div>`).join('');
}
async function addExpense(){
  const cat=$('exp-cat').value,desc=$('exp-desc').value.trim(),amt=parseFloat($('exp-amt').value);
  if(!desc||!amt)return alert('Fill description and amount.');if(!SD.expenses)SD.expenses=[];
  SD.expenses.unshift({category:cat,description:desc,amount:amt,date:new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('expenses',SD.expenses);closeM('add-expense-modal');$('exp-desc').value='';$('exp-amt').value='';renderExpenses();
}

// ── Sports ─────────────────────────────────────────────────────────────────
function loadSports(){
  const lbl=$('current-sport-label');if(lbl)lbl.textContent=currentSport;
  const grid=$('custom-sports-grid');
  if(grid){const custom=SD.sports.custom||[];grid.innerHTML=custom.map(s=>`<div class="sport-card ${s.id===currentSport?'sel':''}" onclick="selectSport('${s.id}',this)"><div style="font-size:1.3rem;">${esc(s.icon||'🏆')}</div><div style="font-weight:700;font-size:0.85rem;">${esc(s.name)}</div></div>`).join('');}
  const sel=$('player-sel');if(sel)sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${s.id||s.name}">${esc(s.name)}</option>`).join('');
  renderTeamList();
}
function selectSport(sportId,btnEl){
  currentSport=sportId;document.querySelectorAll('.sport-card').forEach(c=>c.classList.remove('sel'));if(btnEl)btnEl.classList.add('sel');
  const lbl=$('current-sport-label');if(lbl){const c=(SD.sports.custom||[]).find(s=>s.id===sportId);lbl.textContent=c?c.name:sportId.toUpperCase();}
  renderTeamList();
}
async function addCustomSport(){
  const name=$('cs-name').value.trim(),icon=$('cs-icon').value.trim();if(!name)return alert('Sport name required.');
  if(!SD.sports.custom)SD.sports.custom=[];const id=name.toLowerCase().replace(/[^a-z0-9]/g,'');
  SD.sports.custom.push({id,name,icon,desc:$('cs-desc')?.value||''});
  await SQ.push('sports',SD.sports);saveLocal('sports',SD.sports);closeM('custom-sport-modal');if($('cs-name'))$('cs-name').value='';if($('cs-icon'))$('cs-icon').value='';loadSports();
}
function renderTeamList(){
  const listEl=$('team-list');if(!listEl)return;const players=(SD.sports.teams||{})[currentSport]||[];
  if(!players.length){listEl.innerHTML='<p style="color:var(--sub);font-size:0.8rem;text-align:center;">No players in team yet.</p>';return;}
  listEl.innerHTML=players.map((p,idx)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);"><div><span style="font-weight:700;color:var(--brand);margin-right:5px;">#${p.num||'—'}</span><span style="font-weight:600;">${esc(p.name)}</span><span style="font-size:0.72rem;color:var(--sub);margin-left:5px;">(${esc(p.pos||'')})</span></div><button onclick="removePlayer(${idx})" style="background:none;border:none;color:var(--danger);cursor:pointer;">✕</button></div>`).join('');
}
async function addPlayer(){
  const sVal=$('player-sel').value,pos=$('player-pos').value.trim(),num=$('player-num').value.trim();if(!sVal)return alert('Select student.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal);if(!s)return;
  if(!SD.sports.teams)SD.sports.teams={};if(!SD.sports.teams[currentSport])SD.sports.teams[currentSport]=[];
  SD.sports.teams[currentSport].push({id:s.id||s.name,name:s.name,pos,num});
  await SQ.push('sports',SD.sports);saveLocal('sports',SD.sports);closeM('add-player-modal');if($('player-pos'))$('player-pos').value='';if($('player-num'))$('player-num').value='';renderTeamList();
}
async function removePlayer(idx){if(!confirm('Remove player?'))return;SD.sports.teams[currentSport].splice(idx,1);await SQ.push('sports',SD.sports);saveLocal('sports',SD.sports);renderTeamList();}
function recordMatchResult(){const res=prompt('Match result / score:');if(res)toast('Match logged: '+res);}

// ── Arts ───────────────────────────────────────────────────────────────────
function renderArts(){
  const gallery=$('art-gallery');if(!gallery)return;const art=SD.arts?.gallery||[];
  let html=`<div class="art-card" onclick="openM('add-artwork-modal')"><div class="art-prev" style="background:#f1f5f9;color:var(--sub);font-size:2rem;display:flex;align-items:center;justify-content:center;">➕</div><div class="art-info"><div class="art-title">Add Artwork</div></div></div>`;
  html+=art.map((item,idx)=>`<div class="art-card"><div class="art-prev" style="background:#e2e8f0;font-size:1.5rem;display:flex;align-items:center;justify-content:center;">🎨</div><div class="art-info"><div class="art-title" style="font-weight:700;">${esc(item.title)}</div><div style="font-size:0.75rem;color:var(--sub);">${esc(item.studentName)} (${esc(item.medium)})</div><button onclick="deleteArtwork(${idx})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.75rem;">🗑️ Remove</button></div></div>`).join('');
  gallery.innerHTML=html;
  const sel=$('art-stu-sel');if(sel)sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${s.id||s.name}">${esc(s.name)}</option>`).join('');
}
async function saveArtwork(){
  const sVal=$('art-stu-sel').value,title=$('art-title').value.trim(),medium=$('art-medium').value;if(!sVal||!title)return alert('Select student and enter title.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal);if(!s)return;if(!SD.arts)SD.arts={gallery:[]};
  SD.arts.gallery.push({studentId:s.id||s.name,studentName:s.name,title,medium,desc:$('art-desc')?.value||''});
  await SQ.push('arts',SD.arts);saveLocal('arts',SD.arts);closeM('add-artwork-modal');if($('art-title'))$('art-title').value='';renderArts();
}
async function deleteArtwork(idx){if(!confirm('Remove artwork?'))return;SD.arts.gallery.splice(idx,1);await SQ.push('arts',SD.arts);saveLocal('arts',SD.arts);renderArts();}
function planExhibition(){const desc=prompt('Exhibition title:');if(desc)toast('Exhibition planned: '+desc);}

// ── Music ──────────────────────────────────────────────────────────────────
function renderMusic(){
  const logsEl=$('practice-logs');
  if(logsEl){const logs=SD.music?.practiceLogs||[];logsEl.innerHTML=!logs.length?'<p style="color:var(--sub);font-size:0.8rem;text-align:center;">No practices logged yet.</p>':logs.map(l=>`<div style="padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><span style="font-weight:700;">${esc(l.studentName)}</span> — ${esc(l.activity)} (${esc(l.duration)})<div style="color:var(--sub);font-size:0.7rem;">${esc(l.notes||'')}</div></div>`).join('');}
  ['prac-stu','lesson-stu'].forEach(id=>{const el=$(id);if(el)el.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${s.id||s.name}">${esc(s.name)}</option>`).join('');});
  renderInstruments();
}
function renderInstruments(){
  const listEl=$('instrument-list');if(!listEl)return;const inst=SD.music?.instruments||[];
  listEl.innerHTML=inst.map((item,idx)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><div><b>${esc(item.name)}</b> — <span style="color:${item.status==='available'?'var(--money)':'var(--danger)'};">${item.status}</span></div><button onclick="toggleInstrumentStatus(${idx})" style="background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:2px 8px;cursor:pointer;">🔄</button></div>`).join('');
}
async function savePractice(){
  const sVal=$('prac-stu').value,act=$('prac-act').value.trim(),dur=$('prac-dur').value;if(!sVal||!act)return alert('Select student and enter activity.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal);if(!s)return;if(!SD.music)SD.music={practiceLogs:[],instruments:[]};
  SD.music.practiceLogs.unshift({studentId:s.id||s.name,studentName:s.name,activity:act,duration:dur,notes:$('prac-notes')?.value||''});
  await SQ.push('music',SD.music);saveLocal('music',SD.music);closeM('log-practice-modal');if($('prac-act'))$('prac-act').value='';renderMusic();
}
async function bookLesson(){const sVal=$('lesson-stu').value,inst=$('lesson-inst').value,date=$('lesson-date').value;if(!sVal||!date)return alert('Select student and date.');const s=SD.students.find(x=>(x.id||x.name)===sVal);if(!s)return;alert(`Lesson booked for ${s.name} on ${inst} — ${date}`);closeM('book-lesson-modal');}
async function addInstrument(){const name=prompt('Instrument name:');if(!name)return;if(!SD.music.instruments)SD.music.instruments=[];SD.music.instruments.push({name,status:'available'});await SQ.push('music',SD.music);saveLocal('music',SD.music);renderInstruments();}
async function toggleInstrumentStatus(idx){const item=SD.music.instruments[idx];if(!item)return;item.status=item.status==='available'?'borrowed':'available';await SQ.push('music',SD.music);saveLocal('music',SD.music);renderInstruments();}

// ── Health / Incidents ─────────────────────────────────────────────────────
function renderHealth(){
  const records=SD.health||[];const ve=$('h-visits'),oe=$('h-open'),le=$('health-list');
  if(ve)ve.textContent=records.length;if(oe)oe.textContent=records.filter(r=>r.status==='open').length;if(!le)return;
  le.innerHTML=!records.length?'<p style="text-align:center;color:var(--sub);padding:1.5rem;">No incidents logged yet.</p>':records.map((r,idx)=>`<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><div style="font-weight:700;">${esc(r.studentName)} — ${esc(r.type)}</div><div style="font-size:0.72rem;color:var(--sub);">${esc(r.action||'')} · ${r.date||''}</div><div style="margin-top:2px;">${esc(r.notes||'')}</div><button class="btn-ghost btn-sm" style="color:var(--danger);padding:2px 6px;margin-top:3px;" onclick="deleteIncident(${idx})">🗑️</button></div>`).join('');
  const sel=$('inc-stu');if(sel)sel.innerHTML='<option value="">— Choose student —</option>'+SD.students.map(s=>`<option value="${s.id||s.name}">${esc(s.name)}</option>`).join('');
}
async function logIncident(){
  const sVal=$('inc-stu').value,type=$('inc-type').value.trim(),action=$('inc-action').value;if(!sVal||!type)return alert('Select student and enter incident type.');
  const s=SD.students.find(x=>(x.id||x.name)===sVal);if(!s)return;if(!SD.health)SD.health=[];
  SD.health.unshift({studentId:s.id||s.name,studentName:s.name,type,action,notes:$('inc-notes')?.value||'',status:'open',date:new Date().toISOString().split('T')[0]});
  await SQ.push('health',SD.health);saveLocal('health',SD.health);closeM('log-incident-modal');if($('inc-type'))$('inc-type').value='';renderHealth();
}
async function deleteIncident(idx){if(!confirm('Remove this record?'))return;SD.health.splice(idx,1);await SQ.push('health',SD.health);saveLocal('health',SD.health);renderHealth();}

// ── Alumni ─────────────────────────────────────────────────────────────────
function renderAlumni(){
  const records=SD.alumni||[];const ce=$('al-count'),de=$('al-donations'),le=$('alumni-list');
  if(ce)ce.textContent=records.length;let totalDon=0;records.forEach(r=>totalDon+=(r.donations||0));if(de)de.textContent=fmt(totalDon);if(!le)return;
  le.innerHTML=!records.length?'<p style="text-align:center;color:var(--sub);padding:1.5rem;">No alumni registered yet.</p>':records.map((r,idx)=>`<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><div style="font-weight:700;">${esc(r.name)} (${esc(String(r.year))})</div><div style="font-size:0.72rem;color:var(--sub);">${esc(r.job||'—')}</div><div style="margin-top:2px;">📱 ${r.phone||'—'} · Contributions: <b>${fmt(r.donations||0)}</b></div><div style="display:flex;gap:5px;margin-top:4px;"><button class="btn-ghost btn-sm" style="color:var(--brand);" onclick="recordAlumniDonation(${idx})">💰 Log Contribution</button><button class="btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteAlumni(${idx})">🗑️</button></div></div>`).join('');
}
async function addAlumni(){
  const name=$('al-name').value.trim(),year=parseInt($('al-year').value),phone=$('al-phone').value.trim(),job=$('al-job').value.trim();if(!name||!year)return alert('Name and graduation year required.');
  if(!SD.alumni)SD.alumni=[];SD.alumni.push({name,year,phone,job,donations:0});
  await SQ.push('alumni',SD.alumni);saveLocal('alumni',SD.alumni);closeM('add-alumni-modal');$('al-name').value='';$('al-year').value='';$('al-phone').value='';$('al-job').value='';renderAlumni();
}
async function recordAlumniDonation(idx){const amt=parseFloat(prompt('Contribution amount (₦):'));if(!amt||amt<=0)return;SD.alumni[idx].donations=(SD.alumni[idx].donations||0)+amt;await SQ.push('alumni',SD.alumni);saveLocal('alumni',SD.alumni);renderAlumni();toast(`₦${amt.toLocaleString('en-NG')} logged!`);}
async function deleteAlumni(idx){if(!confirm('Remove this alumni?'))return;SD.alumni.splice(idx,1);await SQ.push('alumni',SD.alumni);saveLocal('alumni',SD.alumni);renderAlumni();}
function sendFundraisingAppeal(){const records=SD.alumni||[];const sn=SD.config.schoolName||'School';const msg=`Hello! This is *${sn}* reaching out to our esteemed alumni for support of our school development programs. Contributions of any amount are welcome and appreciated.`;records.forEach(r=>{if(r.phone)window.open(`https://wa.me/${r.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');});}

// ── Finance AI ─────────────────────────────────────────────────────────────
function checkFinance(){
  const hasData=(SD.expenses||[]).length>0||(SD.students||[]).some(s=>s.paid>0);
  if(hasData){if($('finance-empty'))$('finance-empty').style.display='none';if($('finance-analysis'))$('finance-analysis').style.display='block';runLiveFinanceSummary();}
  else{if($('finance-empty'))$('finance-empty').style.display='block';if($('finance-analysis'))$('finance-analysis').style.display='none';}
}
function runLiveFinanceSummary(){
  const s=SD.students||[];const exp=s.reduce((a,x)=>a+(x.totalFee||0),0),col=s.reduce((a,x)=>a+(x.paid||0),0);
  if($('ai-projection'))$('ai-projection').textContent=fmt(exp);
  if($('ai-anomalies'))$('ai-anomalies').textContent=(SD.expenses||[]).filter(e=>e.amount>100000).length;
  const recEl=$('ai-recommendation');
  if(recEl){const pct=exp>0?(col/exp*100):0;recEl.innerHTML=pct<50?`⚠️ <b>Budget Warning:</b> Fee collection is at <b>${Math.round(pct)}%</b>. Recovering outstanding balances should be a priority this term.`:`✅ <b>Good Progress:</b> Fee collection is at <b>${Math.round(pct)}%</b>. Keep following up on overdue parents.`;}
}
function handleFinanceUpload(event){if(event.target.files[0]){alert('Statement imported. Running analysis...');checkFinance();}}
async function askFinanceAI(){
  const qInput=$('ai-question'),q=qInput?.value.trim();if(!q)return;
  const chatArea=$('ai-chat-area');
  if(chatArea){const uMsg=document.createElement('div');uMsg.style.cssText='background:var(--s2);padding:8px;border-radius:8px;margin-bottom:5px;font-size:0.8rem;';uMsg.innerHTML=`<b>You:</b> ${esc(q)}`;chatArea.appendChild(uMsg);}
  if(qInput)qInput.value='';
  const s=SD.students||[];const col=s.reduce((a,x)=>a+(x.paid||0),0);const exp=s.reduce((a,x)=>a+(x.totalFee||0),0);const expenses=SD.expenses||[];const totalExp=expenses.reduce((a,e)=>a+(e.amount||0),0);
  const context=`School: ${SD.config.schoolName||'Unknown'}, ${s.length} students, Fees collected: ₦${col.toLocaleString('en-NG')} of ₦${exp.toLocaleString('en-NG')} total, Expenses: ₦${totalExp.toLocaleString('en-NG')}, Plan: ${SD.config.plan||'basic'}`;
  const reply=await aitCall(`You are EduBloom's Finance Advisor for Nigerian private schools. Current school data: ${context}. Give practical, specific advice.`,[{role:'user',content:q}]);
  if(chatArea){const bMsg=document.createElement('div');bMsg.style.cssText='background:rgba(124,58,237,0.08);border-left:3px solid var(--brand);padding:8px;border-radius:4px;margin-bottom:5px;font-size:0.8rem;';bMsg.innerHTML=`<b>Aari AI:</b> ${reply}`;chatArea.appendChild(bMsg);chatArea.scrollTop=chatArea.scrollHeight;}
}

// ── Communications ─────────────────────────────────────────────────────────
function renderComms(){
  const pagesEl=$('social-pages');
  if(pagesEl){const pages=SD.socialPages||[];pagesEl.innerHTML=!pages.length?'<p style="font-size:0.8rem;color:var(--sub);text-align:center;">No social pages linked yet.</p>':pages.map((p,idx)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><div><b>${esc(p.platform.toUpperCase())}:</b> ${esc(p.name)}</div><button onclick="removeSocialPage(${idx})" style="background:none;border:none;color:var(--danger);cursor:pointer;">✕</button></div>`).join('');}
  renderCommsHistory();
}
async function addSocialPage(){
  const platform=$('soc-platform').value,name=$('soc-name').value.trim(),url=$('soc-url').value.trim();if(!platform||!name)return alert('Platform and name required.');
  if(!SD.socialPages)SD.socialPages=[];SD.socialPages.push({platform,name,url});
  await SQ.push('socialPages',SD.socialPages);saveLocal('socialPages',SD.socialPages);if($('soc-name'))$('soc-name').value='';if($('soc-url'))$('soc-url').value='';renderComms();
}
async function removeSocialPage(idx){if(!confirm('Remove?'))return;SD.socialPages.splice(idx,1);await SQ.push('socialPages',SD.socialPages);saveLocal('socialPages',SD.socialPages);renderComms();}
function broadcastFeeReminder(){const count=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0).length;if(confirm(`Send fee reminders to ${count} outstanding accounts?`))sendAllReminders();}
function broadcastAnnouncement(){const ann=prompt('Announcement text:');if(ann){logComm('Announcement',ann);toast('Announcement logged.');}}
async function logComm(type,desc){if(!SD.commsLog)SD.commsLog=[];SD.commsLog.unshift({type,desc,date:new Date().toISOString().replace('T',' ').slice(0,16)});await SQ.push('commsLog',SD.commsLog);saveLocal('commsLog',SD.commsLog);renderCommsHistory();}
function renderCommsHistory(){const listEl=$('comms-history-list');if(!listEl)return;const logs=SD.commsLog||[];listEl.innerHTML=!logs.length?'<p style="text-align:center;color:var(--sub);padding:2rem;">No communications logged yet.</p>':logs.map(l=>`<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><div style="font-weight:700;color:var(--brand);">${esc(l.type)}</div><div style="color:var(--sub);font-size:0.7rem;">${l.date}</div><div style="margin-top:2px;">${esc(l.desc)}</div></div>`).join('');}

// ── Security Search ────────────────────────────────────────────────────────
function securitySearch(){
  const q=($('sec-search')?.value||'').toLowerCase();const resultsEl=$('security-results');if(!resultsEl)return;
  if(!q){resultsEl.innerHTML='';return;}
  const matches=SD.students.filter(s=>s.name.toLowerCase().includes(q)||(s.phone&&s.phone.includes(q)));
  if(!matches.length){resultsEl.innerHTML='<p style="color:var(--danger);font-size:0.8rem;">❌ No matching student found.</p>';return;}
  resultsEl.innerHTML=matches.map(s=>`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:0.6rem;margin-top:0.4rem;"><div style="display:flex;justify-content:space-between;align-items:center;"><b style="font-size:0.85rem;">${esc(s.name)}</b><span class="chip chip-ok" style="font-size:0.7rem;">Active ✓</span></div><div style="font-size:0.78rem;color:var(--sub);margin-top:3px;"><b>Class:</b> ${esc(s.class||'—')} · <b>Parent Phone:</b> ${s.phone||'—'}</div></div>`).join('');
}

// ── Analytics ──────────────────────────────────────────────────────────────
function renderAnalytics(){
  const el=$('analytics-content');if(!el)return;
  const s=SD.students||[];const exp=s.reduce((a,x)=>a+(x.totalFee||0),0),col=s.reduce((a,x)=>a+(x.paid||0),0);
  const totalExpenses=(SD.expenses||[]).reduce((a,x)=>a+(x.amount||0),0);const net=col-totalExpenses;
  el.innerHTML=`<div class="card"><div class="ct">📊 Term Overview</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem;"><div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);"><div style="font-size:0.68rem;color:var(--sub);">Net Liquid</div><b style="font-size:1rem;color:${net>=0?'var(--money)':'var(--danger)'};">${fmt(net)}</b></div><div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);"><div style="font-size:0.68rem;color:var(--sub);">Outstanding Fees</div><b style="font-size:1rem;color:var(--danger);">${fmt(exp-col)}</b></div><div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);"><div style="font-size:0.68rem;color:var(--sub);">Total Enrolled</div><b style="font-size:1rem;">${s.length}</b></div><div style="background:var(--s2);padding:0.6rem;border-radius:8px;border:1px solid var(--border);"><div style="font-size:0.68rem;color:var(--sub);">Collection Rate</div><b style="font-size:1rem;color:var(--money);">${exp>0?Math.round((col/exp)*100):0}%</b></div></div><div style="font-size:0.76rem;color:var(--sub);">Net = fees collected (${fmt(col)}) minus expenses logged (${fmt(totalExpenses)}). Track expenses consistently for accurate insights.</div></div>`;
}

// ── Opportunities ──────────────────────────────────────────────────────────
function renderOpps(){
  const cat=$('opp-cat')?.value||'';const listEl=$('opps-list');if(!listEl)return;
  let list=[...(SD.opportunities||defaultOpps())];if(cat)list=list.filter(o=>o.type===cat);
  listEl.innerHTML=list.map(o=>`<div style="padding:0.6rem;background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:0.5rem;font-size:0.78rem;"><div style="display:flex;justify-content:space-between;align-items:start;"><b style="font-size:0.85rem;color:var(--brand);">${esc(o.title)}</b><span class="chip chip-ok" style="font-size:0.68rem;">${(o.type||'').toUpperCase()}</span></div><div style="font-size:0.72rem;color:var(--sub);margin:2px 0;">Provider: ${esc(o.provider)} · Amount: <b>${esc(o.amount||'—')}</b></div><p style="margin:4px 0;line-height:1.45;">${esc(o.desc||'')}</p><div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:0.72px;"><span style="color:var(--danger);font-weight:700;font-size:0.72rem;">Deadline: ${o.deadline||'—'}</span><button onclick="applyToOpp('${o.id}')" style="background:var(--brand);color:white;border:none;border-radius:4px;padding:2px 8px;font-size:0.72rem;cursor:pointer;">Apply</button></div></div>`).join('');
}
function applyToOpp(id){alert(`Preparing application for opportunity: ${id}.\n\nVisit the provider website to complete your application.`);}

// ── Settings ───────────────────────────────────────────────────────────────
function loadSettings(){
  const cfg=SD.config||{};
  if($('set-name'))$('set-name').value=cfg.schoolName||'';if($('set-phone'))$('set-phone').value=cfg.whatsapp||'';if($('set-email'))$('set-email').value=cfg.principalEmail||'';if($('set-fee'))$('set-fee').value=cfg.fee||50000;if($('set-term'))$('set-term').value=cfg.currentTerm||'Term 1';if($('set-session'))$('set-session').value=cfg.session||'2025/2026';
  if($('settings-plan'))$('settings-plan').textContent=cfg.plan==='premium'?'PREMIUM ✨':'BASIC';if($('settings-staff-limit'))$('settings-staff-limit').textContent=cfg.plan==='premium'?'Unlimited':'3';if($('settings-ai'))$('settings-ai').textContent=cfg.plan==='premium'?'Full AI Suite':'Basic Analysis';
  if($('set-api-key'))$('set-api-key').value=cfg.anthropicKey||'';
  updateLogoBadges(cfg.logo);renderSubjectChips();
}
function renderSubjectChips(){
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  const container=$('subj-chips');if(!container)return;
  container.innerHTML=subs.map((s,idx)=>`<span class="subj-chip">${esc(s)}<button type="button" onclick="removeSubject(${idx})" style="background:none;border:none;color:var(--danger);font-size:1rem;cursor:pointer;padding:0;margin-left:4px;">×</button></span>`).join('');
  const area=$('set-subjects');if(area)area.value=subs.join('\n');
}
function addSubjectFromInput(){const inp=$('new-subj-inp'),val=inp?.value.trim();if(!val)return;if(!SD.config.subjects)SD.config.subjects=[];if(!SD.config.subjects.includes(val)){SD.config.subjects.push(val);renderSubjectChips();}if(inp)inp.value='';}
function removeSubject(idx){if(SD.config.subjects){SD.config.subjects.splice(idx,1);renderSubjectChips();}}
function loadPresetSubjects(type){const presets={primary:['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','Home Economics'],jss:['English Language','Mathematics','Basic Science & Technology','Social Studies','Civic Education','Cultural & Creative Arts','Computer Science','Physical & Health Education','Agricultural Science','Business Studies','Religious Studies','French Language'],sss:['English Language','Mathematics','Biology','Chemistry','Physics','Civic Education','Geography','Economics','Agricultural Science','Further Mathematics','Computer Studies']};SD.config.subjects=presets[type]||presets.primary;renderSubjectChips();}
async function saveSettings(){
  const newName=$('set-name').value.trim();if(!newName)return alert('School name is required.');
  SD.config.schoolName=newName;SD.config.whatsapp=$('set-phone').value.trim();SD.config.principalEmail=$('set-email').value.trim();SD.config.fee=parseFloat($('set-fee').value)||50000;SD.config.currentTerm=$('set-term').value;SD.config.session=$('set-session').value.trim();
  const apiKey=$('set-api-key')?.value.trim();if(apiKey)SD.config.anthropicKey=apiKey;
  const pwd=$('set-pwd').value.trim();if(pwd){const pr=(SD.staff||[]).find(s=>s.role==='Principal');if(pr)pr.password=pwd;if($('set-pwd'))$('set-pwd').value='';}
  const textSubs=$('set-subjects')?.value.split('\n').map(s=>s.trim()).filter(Boolean);if(textSubs&&textSubs.length&&!SD.config.subjects?.length)SD.config.subjects=textSubs;
  await SQ.push('config',SD.config);saveLocal('config',SD.config);
  if($('hdr-school'))$('hdr-school').textContent=newName;if($('hdr-term'))$('hdr-term').textContent=SD.config.currentTerm;
  alert('✅ Settings saved!');
}
function handleLogoBadgeTap(){if(userRole==='Principal')$('logo-file-input')?.click();else alert('Only the Principal can change the school logo.');}
function handleLogoUpload(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async(e)=>{SD.config.logo=e.target.result;await SQ.push('config',SD.config);saveLocal('config',SD.config);updateLogoBadges(e.target.result);alert('✅ School logo updated.');};reader.readAsDataURL(file);}
function removeLogo(){if(userRole!=='Principal')return alert('Only the Principal can remove the logo.');if(confirm('Remove school logo?')){SD.config.logo=null;SQ.push('config',SD.config);saveLocal('config',SD.config);updateLogoBadges(null);toast('Logo removed.');}}
function updateLogoBadges(logoUrl){
  const initial=SD.config.schoolName?SD.config.schoolName.charAt(0).toUpperCase():'S';
  ['school-logo-badge','settings-logo-preview'].forEach(id=>{const el=$(id);if(el){el.style.backgroundImage=logoUrl?`url(${logoUrl})`:'none';const span=el.querySelector('span');if(span)span.style.display=logoUrl?'none':'inline';}});
  const nameEl=$('settings-logo-name');if(nameEl)nameEl.textContent=logoUrl?'School logo uploaded':'No logo uploaded';
}

// ── Support ────────────────────────────────────────────────────────────────
function renderSupport(){
  const contactEl=$('agent-contact');if(!contactEl)return;
  const agent=SD.config?.agent||{name:'AariNAT Support',phone:'2348145073941'};
  contactEl.innerHTML=`<div style="display:flex;align-items:center;gap:0.75rem;padding:0.4rem 0;"><div style="font-size:2.5rem;">🛡️</div><div style="flex:1;"><div style="font-size:0.68rem;color:var(--sub);text-transform:uppercase;">Your EduBloom Agent</div><div style="font-weight:700;font-size:0.9rem;">${esc(agent.name)}</div><div style="font-size:0.76rem;color:var(--sub);">${esc(agent.phone||'')}</div></div><button class="btn-wa btn-sm" onclick="window.open('https://wa.me/${(agent.phone||'2348145073941').replace(/\D/g,'')}?text=${encodeURIComponent('Hello '+agent.name+', I need help with Educational Bloom.')}','_blank')">📲 Chat</button></div>`;
}

// ── Class Attendance Modal ─────────────────────────────────────────────────
function openClassAttendance(){populateClassAttendanceSelectors();openM('class-att-modal');}
function populateClassAttendanceSelectors(){
  const sel=$('ca-class-sel');if(!sel)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  sel.innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const dateInput=$('ca-date');if(dateInput&&!dateInput.value)dateInput.value=new Date().toISOString().split('T')[0];
  renderClassRoll();
}
function renderClassRoll(){
  const cls=$('ca-class-sel')?.value,date=$('ca-date')?.value,listEl=$('ca-list');if(!cls||!date||!listEl)return;
  const classStudents=SD.students.filter(s=>s.class===cls);if(!classStudents.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1rem;">No students in this class.</p>';return;}
  const att=SD.attendance[date]||{};let present=0,absent=0,late=0;
  listEl.innerHTML=classStudents.map(s=>{
    const status=att[s.name]||'Present';if(status==='Present')present++;else if(status==='Absent')absent++;else if(status==='Late')late++;
    const ap=status==='Present'?'ca-btn-active-p':'';const aa=status==='Absent'?'ca-btn-active-a':'';const al=status==='Late'?'ca-btn-active-l':'';
    return`<div class="ca-row"><div class="ca-name">${esc(s.name)}</div><div class="ca-btns"><button class="ca-btn ${ap}" onclick="setRollStatus('${esc(s.name)}','Present',this)">✅</button><button class="ca-btn ${aa}" onclick="setRollStatus('${esc(s.name)}','Absent',this)">✕</button><button class="ca-btn ${al}" onclick="setRollStatus('${esc(s.name)}','Late',this)">⏰</button></div></div>`;
  }).join('');
  if($('ca-summary'))$('ca-summary').textContent=`Present: ${present} · Absent: ${absent} · Late: ${late}`;
}
function setRollStatus(name,status,btnEl){
  const row=btnEl.closest('.ca-row');if(!row)return;
  row.querySelectorAll('.ca-btn').forEach(b=>b.classList.remove('ca-btn-active-p','ca-btn-active-a','ca-btn-active-l'));
  if(status==='Present')btnEl.classList.add('ca-btn-active-p');else if(status==='Absent')btnEl.classList.add('ca-btn-active-a');else if(status==='Late')btnEl.classList.add('ca-btn-active-l');
  updateRollSummary();
}
function updateRollSummary(){let p=0,a=0,l=0;document.querySelectorAll('.ca-row').forEach(row=>{const btns=row.querySelectorAll('.ca-btn');if(btns[0]?.classList.contains('ca-btn-active-p'))p++;else if(btns[1]?.classList.contains('ca-btn-active-a'))a++;else if(btns[2]?.classList.contains('ca-btn-active-l'))l++;});if($('ca-summary'))$('ca-summary').textContent=`Present: ${p} · Absent: ${a} · Late: ${l}`;}
function markAllPresent(){document.querySelectorAll('.ca-row').forEach(row=>row.querySelectorAll('.ca-btn')[0]?.click());}
function markAllAbsent(){document.querySelectorAll('.ca-row').forEach(row=>row.querySelectorAll('.ca-btn')[1]?.click());}
async function saveClassAttendance(){
  const date=$('ca-date')?.value;if(!date)return;if(!SD.attendance[date])SD.attendance[date]={};
  document.querySelectorAll('.ca-row').forEach(row=>{
    const name=row.querySelector('.ca-name')?.textContent;const btns=row.querySelectorAll('.ca-btn');if(!name)return;
    let status='Present';if(btns[1]?.classList.contains('ca-btn-active-a'))status='Absent';else if(btns[2]?.classList.contains('ca-btn-active-l'))status='Late';
    SD.attendance[date][name]=status;
  });
  await SQ.push('attendance',SD.attendance);saveLocal('attendance',SD.attendance);alert('✅ Attendance saved!');closeM('class-att-modal');
}
function notifyAbsentParents(){
  const date=$('ca-date')?.value,cls=$('ca-class-sel')?.value;if(!date||!cls)return;
  const att=SD.attendance[date]||{};const absentees=SD.students.filter(s=>s.class===cls&&att[s.name]==='Absent');
  if(!absentees.length)return alert('No absentees to notify for this class.');
  absentees.forEach(s=>{if(s.phone){const msg=`Dear Parent,\n\nYour child *${s.name}* was marked absent from school today (${date}).\n\nKindly confirm with school administration.\n\n– ${SD.config.schoolName||'School'}`;window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');}});
}
function checkMorningAbsentees(){
  const date=new Date().toISOString().split('T')[0];const att=SD.attendance[date]||{};
  const absentNames=Object.keys(att).filter(name=>att[name]==='Absent');
  if(!absentNames.length)return alert('No students marked absent today.');
  if(confirm(`Send absence notifications to parents of ${absentNames.length} absent student${absentNames.length!==1?'s':''}?`)){absentNames.forEach(name=>{const s=SD.students.find(x=>x.name===name);if(s&&s.phone){const msg=`Dear Parent, your child *${s.name}* was marked absent today (${date}). Please confirm.`;window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');}});}
}

// ── Subject Scores Modal ───────────────────────────────────────────────────
function openSubjectScores(){populateSubjectScoresSelectors();openM('subj-scores-modal');}
function populateSubjectScoresSelectors(){
  const clsSel=$('ss-class-sel'),subjSel=$('ss-subj-sel');if(!clsSel||!subjSel)return;
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  clsSel.innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const subs=SD.config.subjects||['English Language','Mathematics','Basic Science & Technology'];
  subjSel.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  renderSubjectScoreList();
}
function renderSubjectScoreList(){
  const cls=$('ss-class-sel')?.value,sub=$('ss-subj-sel')?.value,listEl=$('ss-list');if(!cls||!sub||!listEl)return;
  const classStudents=SD.students.filter(s=>s.class===cls);if(!classStudents.length){listEl.innerHTML='<p style="text-align:center;color:var(--sub);padding:1rem;">No students in this class.</p>';return;}
  const term=SD.config.currentTerm||'Term 1';const termScores=SD.scores[term]||{};
  listEl.innerHTML=`<div style="display:grid;grid-template-columns:1fr 70px 70px 70px 60px;gap:4px;padding:0.3rem 0;border-bottom:2px solid var(--border);font-size:0.75rem;font-weight:700;"><div>Student</div><div style="text-align:center;">CA1/10</div><div style="text-align:center;">CA2/10</div><div style="text-align:center;">CA3/10</div><div style="text-align:center;">Exam/70</div></div>`+classStudents.map(s=>{const sid=s.id||SD.students.indexOf(s);const v=(termScores[sid]||{})[sub]||{ca1:0,ca2:0,ca3:0,exam:0};return`<div class="ss-row" data-sid="${sid}" style="display:grid;grid-template-columns:1fr 70px 70px 70px 60px;gap:4px;padding:0.3rem 0;border-bottom:1px solid var(--border);align-items:center;"><div style="font-weight:600;font-size:0.8rem;">${esc(s.name)}</div><div><input type="number" min="0" max="10" class="ss-inp" value="${v.ca1||''}" placeholder="0" style="width:100%;text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;border:1px solid var(--border);border-radius:6px;" data-f="ca1"></div><div><input type="number" min="0" max="10" class="ss-inp" value="${v.ca2||''}" placeholder="0" style="width:100%;text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;border:1px solid var(--border);border-radius:6px;" data-f="ca2"></div><div><input type="number" min="0" max="10" class="ss-inp" value="${v.ca3||''}" placeholder="0" style="width:100%;text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;border:1px solid var(--border);border-radius:6px;" data-f="ca3"></div><div><input type="number" min="0" max="70" class="ss-inp" value="${v.exam||''}" placeholder="0" style="width:100%;text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;border:1px solid var(--border);border-radius:6px;" data-f="exam"></div></div>`;}).join('');
}
async function saveSubjectScores(){
  const cls=$('ss-class-sel')?.value,sub=$('ss-subj-sel')?.value,term=SD.config.currentTerm||'Term 1',listEl=$('ss-list');if(!cls||!sub||!listEl)return;
  if(!SD.scores[term])SD.scores[term]={};
  listEl.querySelectorAll('.ss-row[data-sid]').forEach(row=>{
    const sid=row.getAttribute('data-sid');const inps=row.querySelectorAll('.ss-inp');
    if(!SD.scores[term][sid])SD.scores[term][sid]={};
    if(!SD.scores[term][sid][sub])SD.scores[term][sid][sub]={ca1:0,ca2:0,ca3:0,exam:0};
    inps.forEach(inp=>{const f=inp.dataset.f;if(f)SD.scores[term][sid][sub][f]=parseInt(inp.value)||0;});
  });
  await SQ.push('scores',SD.scores);saveLocal('scores',SD.scores);alert('✅ Scores saved!');closeM('subj-scores-modal');renderScorecard();
}

// ── Bulk WhatsApp Sequences ────────────────────────────────────────────────
function startBulkWA(){_bulkWAStudents=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0&&s.phone);if(!_bulkWAStudents.length)return alert('No overdue students with phone numbers found.');_bulkWAIdx=0;openM('bulk-wa-modal');renderBulkWA();}
function renderBulkWA(){
  if(_bulkWAIdx>=_bulkWAStudents.length){closeBulkWA();return;}
  const s=_bulkWAStudents[_bulkWAIdx];const owe=(s.totalFee||0)-(s.paid||0);
  if($('bwa-progress'))$('bwa-progress').textContent=`${_bulkWAIdx+1} of ${_bulkWAStudents.length}`;
  if($('bwa-pct'))$('bwa-pct').style.width=`${((_bulkWAIdx+1)/_bulkWAStudents.length)*100}%`;
  if($('bwa-name'))$('bwa-name').textContent=s.name;if($('bwa-owe'))$('bwa-owe').textContent=fmt(owe);if($('bwa-phone'))$('bwa-phone').textContent=s.phone;
  const sn=SD.config.schoolName||'School';const msg=`Dear Parent,\n\nFriendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
  const btn=$('bwa-open-btn');if(btn)btn.onclick=()=>window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
}
function nextBulkWA(){_bulkWAIdx++;if(_bulkWAIdx>=_bulkWAStudents.length){alert('All reminders sent! ✅');closeBulkWA();}else renderBulkWA();}
function closeBulkWA(){closeM('bulk-wa-modal');}
function startBulkReportCards(){_bulkRCStudents=SD.students.filter(s=>s.phone);if(!_bulkRCStudents.length)return alert('No students with phone numbers found.');_bulkRCIdx=0;openM('bulk-rc-modal');renderBulkRC();}
function renderBulkRC(){
  if(_bulkRCIdx>=_bulkRCStudents.length){closeBulkRC();return;}
  const s=_bulkRCStudents[_bulkRCIdx];
  if($('brc-progress'))$('brc-progress').textContent=`${_bulkRCIdx+1} of ${_bulkRCStudents.length}`;
  if($('brc-pct'))$('brc-pct').style.width=`${((_bulkRCIdx+1)/_bulkRCStudents.length)*100}%`;
  if($('brc-name'))$('brc-name').textContent=s.name;if($('brc-phone'))$('brc-phone').textContent=s.phone;
  const sn=SD.config.schoolName||'School';const term=SD.config.currentTerm||'Term 1';
  const msg=`Dear Parent,\n\nThe report card for *${s.name}* (${s.class||''}) for *${term}* is now ready.\n\nContact the school to collect it.\n\n– ${sn}`;
  const btn=$('brc-open-btn');if(btn)btn.onclick=()=>window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
}
function nextBulkRC(){_bulkRCIdx++;if(_bulkRCIdx>=_bulkRCStudents.length){alert('All notifications sent! ✅');closeBulkRC();}else renderBulkRC();}
function closeBulkRC(){closeM('bulk-rc-modal');}

// ── Demo Mode ──────────────────────────────────────────────────────────────
function loadDemo(){
  const demoStudents=[
    {id:'d1',name:'Adaeze Okonkwo',class:'JSS 2',phone:'08012345601',totalFee:50000,paid:25000,gender:'F'},
    {id:'d2',name:'Emeka Eze',class:'JSS 2',phone:'08012345602',totalFee:50000,paid:50000,gender:'M'},
    {id:'d3',name:'Fatima Bello',class:'JSS 2',phone:'08012345603',totalFee:50000,paid:0,gender:'F'},
    {id:'d4',name:'Chukwudi Obi',class:'JSS 2',phone:'08012345604',totalFee:50000,paid:50000,gender:'M'},
    {id:'d5',name:'Ngozi Nwosu',class:'JSS 2',phone:'08012345605',totalFee:50000,paid:30000,gender:'F'},
    {id:'d6',name:'Babatunde Adewale',class:'JSS 2',phone:'08012345606',totalFee:50000,paid:50000,gender:'M'},
    {id:'d7',name:'Chiamaka Udo',class:'JSS 2',phone:'08012345607',totalFee:50000,paid:50000,gender:'F'},
    {id:'d8',name:'Yusuf Suleiman',class:'JSS 2',phone:'08012345608',totalFee:50000,paid:0,gender:'M'},
    {id:'d9',name:'Blessing Nwobi',class:'JSS 2',phone:'08012345609',totalFee:50000,paid:50000,gender:'F'},
    {id:'d10',name:'Tunde Afolabi',class:'JSS 2',phone:'08012345610',totalFee:50000,paid:25000,gender:'M'}
  ];
  // Scores in correct term-keyed format for broadsheet compatibility
  const demoScores={'Term 2':{d1:{'Mathematics':{ca1:18,ca2:16,ca3:17,exam:62},'English Language':{ca1:17,ca2:18,ca3:16,exam:65},'Basic Science & Technology':{ca1:16,ca2:17,ca3:15,exam:60}},d2:{'Mathematics':{ca1:20,ca2:19,ca3:18,exam:75},'English Language':{ca1:16,ca2:17,ca3:15,exam:60},'Basic Science & Technology':{ca1:18,ca2:17,ca3:19,exam:70}},d3:{'Mathematics':{ca1:12,ca2:14,ca3:11,exam:45},'English Language':{ca1:13,ca2:12,ca3:14,exam:48},'Basic Science & Technology':{ca1:14,ca2:13,ca3:12,exam:50}},d4:{'Mathematics':{ca1:19,ca2:20,ca3:20,exam:78},'English Language':{ca1:18,ca2:19,ca3:17,exam:70},'Basic Science & Technology':{ca1:20,ca2:19,ca3:18,exam:75}},d5:{'Mathematics':{ca1:15,ca2:16,ca3:14,exam:55},'English Language':{ca1:15,ca2:16,ca3:14,exam:58},'Basic Science & Technology':{ca1:15,ca2:14,ca3:16,exam:56}},d6:{'Mathematics':{ca1:18,ca2:17,ca3:19,exam:68},'English Language':{ca1:19,ca2:18,ca3:20,exam:72},'Basic Science & Technology':{ca1:17,ca2:18,ca3:16,exam:65}},d7:{'Mathematics':{ca1:20,ca2:20,ca3:19,exam:80},'English Language':{ca1:20,ca2:19,ca3:18,exam:78},'Basic Science & Technology':{ca1:19,ca2:20,ca3:18,exam:76}},d8:{'Mathematics':{ca1:10,ca2:11,ca3:12,exam:40},'English Language':{ca1:11,ca2:10,ca3:12,exam:42},'Basic Science & Technology':{ca1:12,ca2:11,ca3:10,exam:44}},d9:{'Mathematics':{ca1:16,ca2:15,ca3:17,exam:60},'English Language':{ca1:17,ca2:16,ca3:15,exam:63},'Basic Science & Technology':{ca1:16,ca2:15,ca3:17,exam:62}},d10:{'Mathematics':{ca1:14,ca2:13,ca3:15,exam:52},'English Language':{ca1:14,ca2:15,ca3:13,exam:54},'Basic Science & Technology':{ca1:13,ca2:14,ca3:12,exam:53}}}};
  SD.config={schoolName:'Sunshine Academy',plan:'premium',fee:50000,currentTerm:'Term 2',tier:'Small (51–100)',tierPrice:20000,tierMax:100,studentCount:10,whatsapp:'2348145073941',agent:{name:'Demo Agent',phone:'2348145073941'},_schoolId:'DEMO-SCHOOL',_demo:true};
  SD.students=demoStudents;SD.staff=[{name:'Mrs. Adaora Obi',email:'demo@sunshine.edu.ng',password:'demo',role:'Principal',phone:'08012345600'}];
  SD.scores=demoScores;SD.attendance={'2026-05-19':Object.fromEntries(demoStudents.map(s=>[s.name,s.id!=='d3'&&s.id!=='d8'?'Present':'Absent'])),'2026-05-20':Object.fromEntries(demoStudents.map(s=>[s.name,'Present']))};
  SD.expenses=[{id:'e1',description:'Chalk & markers',amount:5000,date:'2026-05-10',category:'Teaching Materials'},{id:'e2',description:'Generator fuel',amount:15000,date:'2026-05-15',category:'Utilities (NEPA/Generator)'}];
  SD.sports={teams:{},custom:[]};SD.arts={gallery:[]};SD.music={practiceLogs:[],instruments:[]};SD.health=[];SD.alumni=[];SD.socialPages=[];SD.commsLog=[];SD.opportunities=defaultOpps();
  schoolId='DEMO-SCHOOL';userRole='Principal';currentStaff=null;
  const demoBanner=$('demo-banner');if(demoBanner)demoBanner.style.display='flex';
  startApp();console.log('🎬 Demo mode loaded');
}

// ── Auto-Login on Page Load ────────────────────────────────────────────────
(function autoLogin(){
  const raw=localStorage.getItem('p_auth')||sessionStorage.getItem('p_auth');if(!raw)return;
  try{
    const auth=JSON.parse(raw);if(!auth.schoolId)return;
    const lc=localStorage.getItem(`p_${auth.schoolId}_config`);const ls=localStorage.getItem(`p_${auth.schoolId}_staff`);if(!lc)return;
    schoolId=auth.schoolId;userRole=auth.role||'Principal';
    loadSchoolIntoSD(auth.schoolId,{config:JSON.parse(lc),staff:ls?JSON.parse(ls):[],students:loadLocal('students',[]),expenses:loadLocal('expenses',[]),attendance:loadLocal('attendance',{}),sports:loadLocal('sports',{teams:{},custom:[]}),arts:loadLocal('arts',{gallery:[]}),music:loadLocal('music',{practiceLogs:[],instruments:[]}),health:loadLocal('health',[]),alumni:loadLocal('alumni',[]),socialPages:loadLocal('socialPages',[]),commsLog:loadLocal('commsLog',[]),scores:loadLocal('scores',{}),opportunities:loadLocal('opportunities',defaultOpps())});
    startApp();setTimeout(()=>SQ.silentPull(),2000);
  }catch(e){console.warn('Auto-login failed:',e);}
})();
