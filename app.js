// ── Firebase ───────────────────────────────────────────────────────────────
const FB={apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",authDomain:"educationbloom-699ed.firebaseapp.com",projectId:"educationbloom-699ed",storageBucket:"educationbloom-699ed.firebasestorage.app",messagingSenderId:"33750392965",appId:"1:33750392965:web:2b3da887ede996ea8389ec"};
let db=null;
try{
  // If already initialized (e.g. hot reload), reuse existing app
  const fbApp=firebase.apps.length?firebase.app():firebase.initializeApp(FB);
  db=firebase.firestore(fbApp);
  console.log('✅ Firebase ready');
}catch(e){console.error('❌ Firebase init failed:',e.message);}

// ── State ──────────────────────────────────────────────────────────────────
let schoolId=null,userRole=null;
let SD={config:{},students:[],staff:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},music:{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]};
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
      // Show Online if internet is available — even if Firestore is unavailable
      el.className='sdot '+(netOk?this.q.length?'sd-sync':'sd-on':'sd-off');
      el.textContent=netOk?this.q.length?'● Syncing':'● Online':'● Offline';
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

function matchUser(staff,pwd){
  // Password-only match with trim on both sides
  const p=(pwd||'').trim();
  return staff.find(s=>(s.password||'').trim()===p)||null;
}

function loadSchoolIntoSD(sid,school){
  SD.config=school.config||{};
  SD.students=school.students||[];
  SD.staff=school.staff||[];
  SD.expenses=school.expenses||[];
  SD.attendance=school.attendance||{};
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

async function doLogin(){
  const sid=$('l-school').value.trim().toUpperCase();
  const pwd=$('l-pwd').value.trim();
  const err=$('l-err');err.style.display='none';
  const btn=$('l-btn');
  if(!sid||!pwd){err.textContent='Enter School ID and password.';err.style.display='block';return;}
  btn.textContent='Checking...';btn.disabled=true;

  // ── STEP 1: localStorage first — instant, works with zero network ──
  const lc=localStorage.getItem(`p_${sid}_config`);
  const ls=localStorage.getItem(`p_${sid}_staff`);
  if(lc&&ls){
    try{
      const staff=JSON.parse(ls);
      const user=matchUser(staff,pwd);
      if(user){
        console.log('✅ Login from localStorage cache (offline-first)');
        schoolId=sid;userRole=user.role;
        _saveAuth(sid,user.email||'');
        loadSchoolIntoSD(sid,{
          config:JSON.parse(lc),staff,
          students:loadLocal('students',[]),expenses:loadLocal('expenses',[]),
          attendance:loadLocal('attendance',{}),sports:loadLocal('sports',{teams:{},custom:[]}),
          arts:loadLocal('arts',{gallery:[]}),music:loadLocal('music',{practiceLogs:[],instruments:[]}),
          health:loadLocal('health',[]),alumni:loadLocal('alumni',[]),
          socialPages:loadLocal('socialPages',[]),commsLog:loadLocal('commsLog',[]),
          opportunities:loadLocal('opportunities',defaultOpps())
        });
        startApp();
        // Background: pull fresh data from Firestore silently — no waiting, no UI block
        setTimeout(()=>SQ.silentPull(),1500);
        btn.textContent='▶ Login';btn.disabled=false;
        return;
      } else {
        // Cache exists but password wrong — don't try network with a wrong password
        err.textContent='Wrong password. Use the exact password sent by your AariNAT agent.';
        err.style.display='block';btn.textContent='▶ Login';btn.disabled=false;return;
      }
    }catch(e){console.warn('localStorage parse error:',e);}
  }

  // ── STEP 2: No local cache — need network for first-time login ──
  if(!navigator.onLine){
    err.innerHTML='📶 <strong>No internet & no saved data.</strong><br>Connect to network for your first login. After that you can use the app offline.';
    err.style.display='block';btn.textContent='▶ Login';btn.disabled=false;return;
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
          if((rec.password||'').trim()===pwd){
            console.log('✅ Found in admin_approved_schools — bootstrapping school doc');
            school={
              config:{plan:'basic',fee:50000,schoolName:rec.schoolName||'',principalEmail:rec.principalEmail||'',whatsapp:rec.principalPhone||'',createdAt:new Date().toISOString()},
              staff:[{name:'Principal',email:(rec.principalEmail||sid.toLowerCase()+'@bloom.edu.ng').toLowerCase(),password:rec.password,role:'Principal',phone:rec.principalPhone||''}],
              students:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},
              music:{practiceLogs:[],instruments:[]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]
            };
            // Write to schools collection so future logins are instant
            try{await db.collection('schools').doc(sid).set(school,{merge:true});}catch(e2){}
          } else {
            err.textContent='Wrong password. Use the exact password sent by your AariNAT agent.';
            err.style.display='block';btn.textContent='▶ Login';btn.disabled=false;return;
          }
        }
      }catch(e){console.warn('admin_approved_schools check failed:', e.message);}
    }

    if(!school){
      err.textContent=`School ID "${sid}" not found. Double-check the ID (format: BLOOM-XXXXXX) sent by your AariNAT agent.`;
      err.style.display='block';btn.textContent='▶ Login';btn.disabled=false;return;
    }

    const user=matchUser(school.staff||[],pwd);
    if(!user){
      err.textContent='School found but password is incorrect. Use the exact password from your AariNAT agent.';
      err.style.display='block';btn.textContent='▶ Login';btn.disabled=false;return;
    }

    // ✅ First-time login success — cache everything locally
    schoolId=sid;userRole=user.role;
    _saveAuth(sid,user.email||'');
    loadSchoolIntoSD(sid,school);
    startApp();

  }catch(e){
    console.error('Login network error:', e);
    err.textContent='Connection error: '+(e?.message||'Check your internet and try again.');
    err.style.display='block';
  }
  btn.textContent='▶ Login';btn.disabled=false;
}

function _saveAuth(sid,email){
  const rememberMe=$('l-remember')?.checked!==false;
  const authData=JSON.stringify({schoolId:sid,email,role:userRole});
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

function logout(){if(!confirm('Clear session and reload?'))return;localStorage.removeItem('p_auth');sessionStorage.removeItem('p_auth');location.reload();}

function startApp(){
  // Called after a manual login attempt — refresh header and data
  $('login').style.display='none';$('app').style.display='block';
  const name=SD.config.schoolName||schoolId||'Educational Bloom';
  $('hdr-school').textContent=name;$('hdr-role').textContent=userRole;
  $('hdr-term').textContent=SD.config.currentTerm||'Term 1';
  const isPrem=SD.config.plan==='premium';
  $('planBadge').textContent=isPrem?'PREMIUM ✨':'BASIC';
  $('planBadge').className='plan-badge '+(isPrem?'plan-premium':'plan-basic');
  SQ.ping();renderBanner();go('revenue');
  setTimeout(()=>SQ.flush(),500);
  setTimeout(()=>SQ.silentPull(),2000);
}

// ── Navigation ─────────────────────────────────────────────────────────────
function go(tab){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b=>b.classList.remove('on'));
  $(`sec-${tab}`).classList.add('on');
  const btn=document.querySelector(`[data-t="${tab}"]`);if(btn)btn.classList.add('on');
  const fn={revenue:renderRevenue,students:renderStudentList,staff:renderStaff,sports:loadSports,arts:renderArts,music:renderMusic,health:renderHealth,alumni:renderAlumni,expenses:renderExpenses,finance:checkFinance,comms:renderComms,analytics:renderAnalytics,security:()=>{},support:renderSupport,settings:loadSettings,opps:renderOpps};
  if(fn[tab])fn[tab]();
}

// ── Banner ─────────────────────────────────────────────────────────────────
function renderBanner(){
  let out=0,cnt=0;
  (SD.students||[]).forEach(s=>{const o=(s.totalFee||0)-(s.paid||0);if(o>0){out+=o;cnt++;}});
  $('banner-amount').textContent=fmt(out);
  $('banner-sub').textContent=`${cnt} parent${cnt!==1?'s':''} overdue · ${SD.students.length} total students`;
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

    await SQ.push('students',SD.students);
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
  await SQ.push('students',SD.students);
  renderStudentList();renderBanner();renderRevenue();
  alert(`✅ Removed ${removed} entr${removed!==1?'ies':'y'} (junk + duplicates).\n\nIf any real student was removed, add them back manually with ➕ Add Student.`);
}
function renderStudentList(){
  const q=($('stu-search')?.value||'').toLowerCase();
  const cls=$('stu-class')?.value||'';
  const pay=$('stu-pay')?.value||'';
  let list=[...SD.students];
  if(q)list=list.filter(s=>s.name.toLowerCase().includes(q)||(s.phone||'').includes(q));
  if(cls)list=list.filter(s=>s.class===cls);
  if(pay==='paid')list=list.filter(s=>(s.totalFee||0)<=(s.paid||0));
  else if(pay==='owing')list=list.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  populateClassFilter();
  const c=$('students-list');
  if(!list.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No students match. Add a student or adjust filters.</p>';return;}
  c.innerHTML=list.map(s=>{
    const idx=SD.students.indexOf(s);
    const owe=(s.totalFee||0)-(s.paid||0);
    const pbc=owe<=0?'pb-paid':s.paid>0?'pb-part':'pb-owe';
    const pbt=owe<=0?'Paid':s.paid>0?'Partial':'Unpaid';
    return`<div class="stu-row" onclick="openProfile(${idx})"><div class="stu-av">${s.name.charAt(0).toUpperCase()}</div><div style="flex:1;min-width:0;"><div class="stu-name">${esc(s.name)}</div><div class="stu-meta">${esc(s.class||'—')} · ${s.phone||'—'}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;"><span class="pay-badge ${pbc}">${pbt}</span>${owe>0?`<span style="font-size:0.68rem;color:var(--danger);">${fmt(owe)}</span>`:''}</div></div>`;
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
  await SQ.push('students',SD.students);
  closeM('add-student-modal');
  $('ns-name').value='';$('ns-phone').value='';$('ns-class').value='';$('ns-fee').value='';
  renderStudentList();renderBanner();renderRevenue();
}

async function deleteStudent(idx){
  if(!confirm(`Delete ${SD.students[idx]?.name}?`))return;
  SD.students.splice(idx,1);await SQ.push('students',SD.students);
  closeM('student-modal');renderStudentList();renderBanner();
}

// ── Universal student import: CSV, TXT, JPG, PNG, JPEG, WEBP ─────────────
function handleCSV(e){
  const f=e.target.files[0];if(!f)return;
  const name=(f.name||'').toLowerCase();
  const type=(f.type||'').toLowerCase();
  const isImage=type.startsWith('image/')||/\.(jpg|jpeg|png|webp|bmp)$/.test(name);
  if(isImage){importStudentsFromImage(f);}
  else{importStudentsFromText(f);}
  e.target.value='';
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
    await SQ.push('students',SD.students);
    $('csv-fb').textContent=`✅ Imported ${count} student${count!==1?'s':''}.${isStructured?'':' Add phone/class in profiles.'}`;
    renderStudentList();renderBanner();renderRevenue();
  })().catch(()=>alert('Could not read file. Try saving it as UTF-8 CSV.'));
}

async function importStudentsFromImage(f){
  $('csv-fb').textContent='📸 Reading photo… loading OCR (first time ~30s)';
  const loadTesseract=()=>new Promise((resolve,reject)=>{
    if(window.Tesseract){resolve();return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload=resolve;s.onerror=reject;
    document.head.appendChild(s);
  });
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      await loadTesseract();
      const{data:{text}}=await Tesseract.recognize(ev.target.result,'eng',{
        logger:m=>{if(m.status==='recognizing text')$('csv-fb').textContent='📸 Reading photo… '+Math.round((m.progress||0)*100)+'%';}
      });
      const names=extractStudentNames(text);
      let count=0;
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
      await SQ.push('students',SD.students);
      $('csv-fb').textContent=`✅ Found ${count} student${count!==1?'s':''} from photo. Add phone/class in profiles.`;
      renderStudentList();renderBanner();renderRevenue();
    }catch(err){
      $('csv-fb').textContent='❌ Photo reading failed. Try a clearer image or use CSV.';
      console.error('OCR error:',err);
    }
  };
  reader.onerror=()=>alert('Could not read image.');
  reader.readAsDataURL(f);
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
}

// FEES TAB
function buildFees(s,idx){
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
    ${(s.paymentHistory||[]).length?`<div style="margin-top:0.75rem;"><div style="font-weight:700;font-size:0.82rem;margin-bottom:0.4rem;">Payment History</div>${s.paymentHistory.slice(0,5).map(p=>`<div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.35rem 0;border-bottom:1px solid var(--border);"><span>${p.date} · ${p.method}</span><strong style="color:var(--money);">${fmt(p.amount)}</strong></div>`).join('')}</div>`:''}
    </div>`;
}

async function recordPayment(idx){
  const amt=parseFloat($('pay-amt')?.value);if(!amt||amt<=0)return alert('Enter valid amount.');
  SD.students[idx].paid=(SD.students[idx].paid||0)+amt;
  if(!SD.students[idx].paymentHistory)SD.students[idx].paymentHistory=[];
  SD.students[idx].paymentHistory.unshift({amount:amt,method:$('pay-method')?.value||'Cash',date:$('pay-date')?.value||new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('students',SD.students);
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
    <div class="card"><div class="ct">📅 Mark Today (${today})</div>
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
  const subs=SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
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

async function updateScore(idx,sub,type,val){
  if(!SD.students[idx].scores)SD.students[idx].scores={};
  if(!SD.students[idx].scores[sub])SD.students[idx].scores[sub]={ca:0,exam:0};
  SD.students[idx].scores[sub][type]=Math.min(type==='ca'?40:60,Math.max(0,parseFloat(val)||0));
}

async function saveScores(idx){await SQ.push('students',SD.students);alert('✅ Scores saved!');renderTab('scores');}

// REPORT CARD TAB
function buildReport(s){
  const subs=SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
  const sc=s.scores||{};const term=SD.config.currentTerm||'Term 1';const session=SD.config.session||'2025/2026';
  const sn=SD.config.schoolName||'Educational Bloom School';
  let total=0,n=0;
  const rows=subs.map(sub=>{const v=sc[sub]||{ca:0,exam:0};const t=(v.ca||0)+(v.exam||0);total+=t;n++;const{g,r}=gradeScore(t);return{sub,ca:v.ca||0,exam:v.exam||0,t,g,r};});
  const avg=n>0?Math.round(total/n):0;const og=gradeScore(avg);
  const cls=SD.students.filter(x=>x.class===s.class&&x.scores);
  const pos=cls.map(x=>{let t=0,nn=0;subs.forEach(sub=>{const v=x.scores?.[sub]||{};t+=(v.ca||0)+(v.exam||0);nn++;});return{name:x.name,avg:nn>0?Math.round(t/nn):0};}).sort((a,b)=>b.avg-a.avg).findIndex(x=>x.name===s.name)+1;
  return`<div class="rc" id="rc-out">
    <div class="rc-hdr"><div class="rc-school">${esc(sn)}</div><div style="font-size:0.75rem;color:var(--sub);">Session: ${esc(session)} · ${esc(term)}</div>
    <div style="font-size:0.82rem;margin-top:0.4rem;"><strong>Student:</strong> ${esc(s.name)} &nbsp;|&nbsp; <strong>Class:</strong> ${esc(s.class||'—')} &nbsp;|&nbsp; <strong>Position:</strong> ${pos>0?pos+'/'+cls.length:'—'}</div></div>
    <table class="rct"><thead><tr><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th><th>Remark</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><strong>${esc(r.sub)}</strong></td><td>${r.ca}</td><td>${r.exam}</td><td><strong>${r.t}</strong></td><td class="g${r.g}"><strong>${r.g}</strong></td><td style="font-size:0.72rem;">${r.r}</td></tr>`).join('')}
    </tbody></table>
    <div class="rc-foot"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;text-align:center;margin-bottom:0.5rem;">
      <div><strong>${n}</strong><div style="font-size:0.68rem;color:var(--sub);">Subjects</div></div>
      <div><strong>${total}</strong><div style="font-size:0.68rem;color:var(--sub);">Total Score</div></div>
      <div><strong class="g${og.g}">${avg}% (${og.g})</strong><div style="font-size:0.68rem;color:var(--sub);">Average</div></div>
    </div>
    <div style="font-size:0.8rem;"><strong>Remark:</strong> ${og.r}. ${avg>=70?'Keep up the excellent work!':avg>=50?'Good effort — work harder next term.':'More effort needed. Please study consistently.'}</div></div>
    <div style="display:flex;justify-content:space-between;margin-top:0.75rem;font-size:0.72rem;color:var(--sub);"><span>Class Teacher: ___________</span><span>Principal: ___________</span></div>
  </div>
  <div style="display:flex;gap:0.4rem;margin-top:0.65rem;">
    <button class="btn-brand" onclick="printRC()">🖨️ Print</button>
    <button class="btn-wa" onclick="sendRC(${activeIdx})">📲 Send via WhatsApp</button>
  </div>`;
}

function printRC(){
  const c=$('rc-out');if(!c)return;
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Card</title><style>body{font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;}th,td{padding:7px;border:1px solid #ccc;font-size:12px;}th{background:#4f46e5;color:white;}.rc-school{font-size:16px;font-weight:800;color:#4f46e5;text-align:center;}.gA{color:#166534;font-weight:700;}.gB{color:#065f46;font-weight:700;}.gC{color:#92400e;font-weight:700;}.gF{color:#dc2626;font-weight:700;}</style></head><body>${c.innerHTML}<script>window.onload=()=>window.print();<\/script></body></html>`);
  w.document.close();
}

function sendRC(idx){
  const s=SD.students[idx];const subs=SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
  const sc=s.scores||{};let lines=`📋 *REPORT CARD — ${SD.config.schoolName||'School'}*\n\n*Student:* ${s.name}\n*Class:* ${s.class||'—'}\n*Term:* ${SD.config.currentTerm||'Term 1'}\n\n*SCORES*\n`;
  subs.forEach(sub=>{const v=sc[sub]||{ca:0,exam:0};const t=(v.ca||0)+(v.exam||0);lines+=`${sub}: ${t}/100 (${gradeScore(t).g})\n`;});
  if(s.phone)window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(lines)}`,'_blank');
  else alert('No phone number for this student.');
}

// SWOT TAB
function buildSWOT(s,idx){
  const sw=s.swot||{};
  return`<div class="card"><div class="ct">🧠 SWOT Analysis</div>
    <label>💪 Strengths</label><textarea id="sw-s" rows="2" placeholder="e.g. Excellent in Mathematics, good team player">${esc(sw.strengths||'')}</textarea>
    <label>🔍 Weaknesses</label><textarea id="sw-w" rows="2" placeholder="e.g. Needs improvement in writing">${esc(sw.weaknesses||'')}</textarea>
    <label>🚀 Opportunities</label><textarea id="sw-o" rows="2" placeholder="e.g. Ready for STEM track, scholarship potential">${esc(sw.opportunities||'')}</textarea>
    <label>⚠️ Considerations</label><textarea id="sw-t" rows="2" placeholder="e.g. Financial constraints">${esc(sw.threats||'')}</textarea>
    <label>💰 Estimated Family Capacity</label><input type="text" id="sw-cap" value="${esc(sw.capacity||'')}" placeholder="e.g. ₦50,000–₦150,000/term">
    <button class="btn-brand" onclick="saveSWOT(${idx})">💾 Save SWOT</button></div>`;
}

async function saveSWOT(idx){
  SD.students[idx].swot={strengths:$('sw-s').value,weaknesses:$('sw-w').value,opportunities:$('sw-o').value,threats:$('sw-t').value,capacity:$('sw-cap').value};
  await SQ.push('students',SD.students);alert('✅ SWOT saved!');
}

// ── 3. STAFF ───────────────────────────────────────────────────────────────
function renderStaff(){
  const staff=SD.staff||[];const isPrem=SD.config.plan==='premium';const limit=isPrem?'∞':3;
  $('staff-count').textContent=`${staff.length}/${limit} used (${isPrem?'Premium':'Basic'})`;
  $('staff-list').innerHTML=staff.map((s,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
    <div><strong>${esc(s.name)}</strong> <span class="chip chip-ok" style="margin-left:4px;">${s.role}</span><div style="font-size:0.7rem;color:var(--sub);margin-top:2px;">${s.email}</div></div>
    ${s.role!=='Principal'?`<button class="btn-danger btn-sm" onclick="removeStaff(${i})">🗑️</button>`:'<span style="font-size:0.68rem;color:var(--sub);">Owner</span>'}
  </div>`).join('');
  const atLimit=!isPrem&&staff.length>=3;
  $('staff-upgrade').style.display=atLimit?'block':'none';
  $('add-staff-modal').querySelector('.btn-brand').style.display=atLimit?'none':'block';
}

async function addStaff(){
  const name=$('sf-name').value.trim(),email=$('sf-email').value.trim(),pwd=$('sf-pwd').value,role=$('sf-role').value;
  if(!name||!email||!pwd)return alert('Fill all fields.');if(pwd.length<4)return alert('Password min 4 chars.');
  if((SD.staff||[]).find(s=>s.email===email))return alert('Email already registered.');
  const isPrem=SD.config.plan==='premium';
  if(!isPrem&&(SD.staff||[]).length>=3){openM('upgrade-modal');return;}
  if(!SD.staff)SD.staff=[];
  SD.staff.push({name,email,password:pwd,role});
  await SQ.push('staff',SD.staff);
  closeM('add-staff-modal');$('sf-name').value='';$('sf-email').value='';$('sf-pwd').value='';
  renderStaff();alert(`✅ ${name} added as ${role}.`);
}

async function removeStaff(idx){
  if(!confirm(`Remove ${SD.staff[idx].name}?`))return;
  SD.staff.splice(idx,1);await SQ.push('staff',SD.staff);renderStaff();
}

// ── 4. SPORTS ─────────────────────────────────────────────────────────────
function loadSports(){
  renderCustomSports();renderTeamList();populatePlayerSelect();
}

function selectSport(key,el){
  currentSport=key;
  document.querySelectorAll('.sport-card').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  $('current-sport-label').textContent=el.querySelector('[style*="font-weight"]')?.textContent||key;
  renderTeamList();
}

function renderCustomSports(){
  const cs=SD.sports?.custom||[];
  const c=$('custom-sports-grid');
  if(!cs.length){c.innerHTML='';return;}
  c.innerHTML=cs.map((s,i)=>`<div class="sport-card" onclick="selectCustomSport('cs_${i}','${esc(s.name)}',this)"><div style="font-size:1.3rem;">${s.icon||'🏅'}</div><div style="font-weight:700;font-size:0.85rem;">${esc(s.name)}</div><div style="font-size:0.7rem;color:var(--sub);">${esc(s.desc||'')}</div><button class="btn-danger btn-sm" style="margin-top:0.4rem;" onclick="event.stopPropagation();deleteCustomSport(${i})">🗑️</button></div>`).join('');
}

function selectCustomSport(key,name,el){
  currentSport=key;document.querySelectorAll('.sport-card').forEach(c=>c.classList.remove('sel'));el.classList.add('sel');$('current-sport-label').textContent=name;renderTeamList();
}

async function addCustomSport(){
  const name=$('cs-name').value.trim(),icon=$('cs-icon').value.trim()||'🏅',desc=$('cs-desc').value.trim();
  if(!name)return alert('Enter sport name.');
  if(!SD.sports)SD.sports={teams:{},custom:[]};if(!SD.sports.custom)SD.sports.custom=[];
  SD.sports.custom.push({name,icon,desc});
  await SQ.push('sports',SD.sports);closeM('custom-sport-modal');
  $('cs-name').value='';$('cs-icon').value='';$('cs-desc').value='';renderCustomSports();
}

async function deleteCustomSport(idx){
  if(!confirm('Delete this sport?'))return;
  SD.sports.custom.splice(idx,1);await SQ.push('sports',SD.sports);renderCustomSports();
}

function renderTeamList(){
  const team=SD.sports?.teams?.[currentSport]||[];
  $('team-list').innerHTML=team.length===0?'<p style="color:var(--sub);font-size:0.8rem;text-align:center;padding:0.75rem;">No players in this team yet.</p>':team.map((p,i)=>`<div class="team-row"><div class="team-av">${p.name.charAt(0).toUpperCase()}</div><div style="flex:1;"><div style="font-weight:700;font-size:0.85rem;">${esc(p.name)}</div><div style="font-size:0.7rem;color:var(--sub);">${p.pos||'Player'} · #${p.num||'?'}</div></div><button class="btn-danger btn-sm" onclick="removePlayer(${i})">🗑️</button></div>`).join('');
}

function populatePlayerSelect(){
  const sel=$('player-sel');sel.innerHTML='<option value="">— Choose student —</option>';
  SD.students.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${s.name} (${s.class||'—'})`;sel.appendChild(o);});
}

async function addPlayer(){
  const idx=$('player-sel').value,pos=$('player-pos').value.trim(),num=$('player-num').value;
  if(!idx&&idx!==0)return alert('Select a student.');
  const s=SD.students[parseInt(idx)];if(!s)return;
  if(!SD.sports)SD.sports={teams:{},custom:[]};if(!SD.sports.teams)SD.sports.teams={};
  if(!SD.sports.teams[currentSport])SD.sports.teams[currentSport]=[];
  SD.sports.teams[currentSport].push({name:s.name,pos:pos||'Player',num:num||'?'});
  await SQ.push('sports',SD.sports);closeM('add-player-modal');renderTeamList();
}

async function removePlayer(idx){
  if(!confirm('Remove?'))return;
  SD.sports.teams[currentSport].splice(idx,1);await SQ.push('sports',SD.sports);renderTeamList();
}

function recordMatchResult(){
  const opp=prompt('Opponent school:');if(!opp)return;
  const us=parseInt(prompt('Our score:')||'0'),them=parseInt(prompt(`${opp} score:`)||'0');
  const res=us>them?'🏆 Win':us<them?'❌ Loss':'🤝 Draw';
  const d=new Date().toLocaleDateString('en-NG',{weekday:'short',day:'numeric',month:'short'});
  $('fixtures-list').insertAdjacentHTML('afterbegin',`<div class="fixture"><div style="font-size:0.72rem;color:var(--sub);">${d} · Result recorded</div><div style="font-weight:600;">Our School ${us}–${them} ${esc(opp)}</div><div style="font-size:0.78rem;color:var(--money);">${res} · ${$('current-sport-label').textContent}</div></div>`);
  alert(`✅ ${res} — Our School ${us}–${them} ${opp}`);
}

// ── 5. ARTS ────────────────────────────────────────────────────────────────
function renderArts(){
  const gallery=SD.arts?.gallery||[];
  const sel=$('art-stu-sel');sel.innerHTML='<option value="">— Choose student —</option>';
  SD.students.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${s.name} (${s.class||'—'})`;sel.appendChild(o);});
  let html=`<div class="art-card" onclick="openM('add-artwork-modal')"><div class="art-prev" style="background:#f1f5f9;color:var(--sub);font-size:2rem;">➕</div><div class="art-info"><div class="art-title">Add Artwork</div><div class="art-stu">Tap to add</div></div></div>`;
  gallery.slice().reverse().forEach((a,i)=>{
    const ic=a.medium==='Drawing'?'✏️':a.medium==='Painting'?'🎨':a.medium==='Sculpture'?'🗿':'🖼️';
    html+=`<div class="art-card" onclick="viewArtwork(${gallery.length-1-i})"><div class="art-prev">${ic}</div><div class="art-info"><div class="art-title">${esc(a.title)}</div><div class="art-stu">by ${esc(a.studentName)}</div></div></div>`;
  });
  $('art-gallery').innerHTML=html;
}

async function saveArtwork(){
  const si=$('art-stu-sel').value,title=$('art-title').value.trim(),medium=$('art-medium').value,desc=$('art-desc').value.trim();
  if(!si||!title)return alert('Select student and enter title.');
  const s=SD.students[parseInt(si)];if(!s)return;
  if(!SD.arts)SD.arts={gallery:[]};
  SD.arts.gallery.unshift({studentName:s.name,title,medium,desc,createdAt:new Date().toISOString()});
  await SQ.push('arts',SD.arts);closeM('add-artwork-modal');
  $('art-title').value='';$('art-desc').value='';renderArts();
}

function viewArtwork(idx){const a=SD.arts?.gallery?.[idx];if(!a)return;const desc=a.desc||'(No description)';alert('\uD83C\uDFA8 "'+a.title+'"\n\nArtist: '+a.studentName+'\nMedium: '+a.medium+'\n\n'+desc);}

function planExhibition(){
  const title=prompt('Exhibition title:');if(!title)return;
  const date=prompt('Planned date:');if(!date)return;
  alert(`✅ Exhibition planned: "${title}" on ${date}\n\nGo to Comms to notify parents.`);
}

// ── 6. MUSIC ───────────────────────────────────────────────────────────────
function renderMusic(){
  const logs=SD.music?.practiceLogs||[];
  $('practice-logs').innerHTML=logs.length===0?'<p style="color:var(--sub);font-size:0.8rem;text-align:center;padding:0.75rem;">No logs yet.</p>':logs.slice(0,5).map(l=>`<div class="plog"><div style="font-size:0.7rem;color:var(--sub);">${new Date(l.date).toLocaleDateString('en-NG')}</div><div style="font-weight:600;font-size:0.82rem;">${esc(l.studentName)} · ${esc(l.activity)}</div><div style="font-size:0.75rem;color:var(--sub);">${l.duration||''} ${l.notes?'— '+l.notes:''}</div></div>`).join('');
  const sel1=$('prac-stu'),sel2=$('lesson-stu');
  [sel1,sel2].forEach(sel=>{if(!sel)return;sel.innerHTML='<option value="">— Choose student —</option>';SD.students.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${s.name} (${s.class||'—'})`;sel.appendChild(o);});});
  renderInstrumentList();
}

function renderInstrumentList(){
  const inst=SD.music?.instruments||[];
  const c=$('instrument-list');if(!c)return;
  c.innerHTML=inst.length===0?'<p style="color:var(--sub);font-size:0.82rem;text-align:center;padding:0.75rem;">No instruments added.</p>':inst.map((x,i)=>`<div class="inst-row"><div><strong style="font-size:0.85rem;">${esc(x.name)}</strong></div><div style="display:flex;align-items:center;gap:0.5rem;"><span class="chip ${x.status==='available'?'chip-ok':'chip-warn'}">${x.status}</span><button class="btn-sm btn-ghost" style="color:var(--text);" onclick="toggleInstrument(${i})">${x.status==='available'?'Mark In Use':'Mark Available'}</button></div></div>`).join('');
}

async function toggleInstrument(idx){
  if(!SD.music)SD.music={practiceLogs:[],instruments:[]};
  SD.music.instruments[idx].status=SD.music.instruments[idx].status==='available'?'in use':'available';
  await SQ.push('music',SD.music);renderInstrumentList();
}

function addInstrument(){
  const name=prompt('Instrument name:');if(!name)return;
  if(!SD.music)SD.music={practiceLogs:[],instruments:[]};
  SD.music.instruments.push({name,status:'available'});
  SQ.push('music',SD.music);renderInstrumentList();
}

async function savePractice(){
  const si=$('prac-stu').value,act=$('prac-act').value.trim(),dur=$('prac-dur').value,notes=$('prac-notes').value.trim();
  if(!si||!act)return alert('Select student and enter activity.');
  const s=SD.students[parseInt(si)];if(!s)return;
  if(!SD.music)SD.music={practiceLogs:[],instruments:[]};
  if(!SD.music.practiceLogs)SD.music.practiceLogs=[];
  SD.music.practiceLogs.unshift({studentName:s.name,activity:act,duration:dur,notes,date:new Date().toISOString()});
  await SQ.push('music',SD.music);closeM('log-practice-modal');
  $('prac-act').value='';$('prac-notes').value='';renderMusic();
}

async function bookLesson(){
  const si=$('lesson-stu').value,dt=$('lesson-date').value,inst=$('lesson-inst').value,time=$('lesson-time').value;
  if(!si||!dt)return alert('Select student and date.');
  const s=SD.students[parseInt(si)];
  alert(`✅ Lesson booked!\n\nStudent: ${s.name}\nInstrument: ${inst}\nDate: ${dt}\nTime: ${time}`);
  closeM('book-lesson-modal');
}

// ── 7. HEALTH ─────────────────────────────────────────────────────────────
function renderHealth(){
  const incidents=SD.health||[];
  $('h-visits').textContent=incidents.length;
  $('h-open').textContent=incidents.filter(x=>!x.resolved).length;
  const sel=$('inc-stu');sel.innerHTML='<option value="">— Choose student —</option>';
  SD.students.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${s.name} (${s.class||'—'})`;sel.appendChild(o);});
  $('health-list').innerHTML=incidents.length===0?'<p style="text-align:center;color:var(--sub);padding:1.5rem;">No incidents logged yet.</p>':incidents.slice().reverse().map((inc,i)=>`<div class="incident-row"><div><div style="font-weight:700;font-size:0.85rem;">${esc(inc.studentName)}</div><div style="font-size:0.75rem;color:var(--sub);">${esc(inc.type)} · ${esc(inc.action)} · ${inc.date}</div></div><span class="chip ${inc.resolved?'chip-ok':'chip-bad'}">${inc.resolved?'Resolved':'Open'}</span></div>`).join('');
}

async function logIncident(){
  const si=$('inc-stu').value,type=$('inc-type').value.trim(),action=$('inc-action').value,notes=$('inc-notes').value.trim();
  if(!si||!type)return alert('Select student and enter incident type.');
  const s=SD.students[parseInt(si)];if(!s)return;
  if(!SD.health)SD.health=[];
  SD.health.unshift({studentName:s.name,type,action,notes,date:new Date().toLocaleDateString('en-NG'),resolved:false});
  await SQ.push('health',SD.health);closeM('log-incident-modal');
  $('inc-type').value='';$('inc-notes').value='';renderHealth();
}

// ── 8. ALUMNI ─────────────────────────────────────────────────────────────
function renderAlumni(){
  const alumni=SD.alumni||[];
  $('al-count').textContent=alumni.length;
  $('al-donations').textContent=fmt(alumni.reduce((t,a)=>t+(a.donation||0),0));
  $('alumni-list').innerHTML=alumni.length===0?'<p style="text-align:center;color:var(--sub);padding:1.5rem;">No alumni added yet.</p>':alumni.map((a,i)=>`<div class="alumni-row"><div><div style="font-weight:700;font-size:0.85rem;">${esc(a.name)}</div><div style="font-size:0.75rem;color:var(--sub);">${a.year||'—'} · ${esc(a.job||'—')}</div></div><button class="btn-wa btn-sm" onclick="callAlumni('${a.phone||''}')">📲</button></div>`).join('');
}

async function addAlumni(){
  const name=$('al-name').value.trim(),year=$('al-year').value,phone=$('al-phone').value.trim().replace(/\D/g,''),job=$('al-job').value.trim();
  if(!name)return alert('Enter name.');
  if(!SD.alumni)SD.alumni=[];
  SD.alumni.unshift({name,year,phone,job,addedAt:new Date().toISOString()});
  await SQ.push('alumni',SD.alumni);closeM('add-alumni-modal');
  $('al-name').value='';$('al-year').value='';$('al-phone').value='';$('al-job').value='';renderAlumni();
}

function callAlumni(phone){if(!phone)return alert('No phone for this alumni.');window.open(`https://wa.me/${phone.replace(/\D/g,'')}`,'_blank');}

function sendFundraisingAppeal(){
  const sn=SD.config.schoolName||'our School';
  const msg=`📢 *Alumni Fundraising Appeal*\n\nDear Alumni of ${sn},\n\nWe are reaching out to our valued alumni to request support for improving school facilities.\n\nEvery contribution makes a difference for current students.\n\nKindly contact us to discuss how you can contribute.\n\nWith gratitude,\nSchool Management`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

// ── 9. EXPENSES ────────────────────────────────────────────────────────────
function renderExpenses(){
  const exp=SD.expenses||[];let total=0;exp.forEach(e=>total+=e.amount||0);
  $('exp-total').textContent=fmt(total);
  $('exp-list').innerHTML=exp.length===0?'<p style="text-align:center;color:var(--sub);padding:2rem;">No expenses logged yet.</p>':exp.map((e,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);"><div><div style="font-weight:600;font-size:0.85rem;">${esc(e.description)}</div><div style="font-size:0.7rem;color:var(--sub);">${esc(e.category)} · ${e.date}</div></div><div style="display:flex;align-items:center;gap:0.5rem;"><span style="font-weight:700;font-family:'DM Mono',monospace;">${fmt(e.amount)}</span><button class="btn-danger btn-sm" onclick="deleteExpense(${i})">🗑️</button></div></div>`).join('');
}

async function addExpense(){
  const cat=$('exp-cat').value,desc=$('exp-desc').value.trim(),amt=parseFloat($('exp-amt').value);
  if(!desc||!amt)return alert('Fill description and amount.');
  if(!SD.expenses)SD.expenses=[];
  SD.expenses.unshift({category:cat,description:desc,amount:amt,date:new Date().toISOString().split('T')[0],by:userRole});
  await SQ.push('expenses',SD.expenses);closeM('add-expense-modal');
  $('exp-desc').value='';$('exp-amt').value='';renderExpenses();
}

async function deleteExpense(idx){if(!confirm('Delete?'))return;SD.expenses.splice(idx,1);await SQ.push('expenses',SD.expenses);renderExpenses();}

// ── 10. FINANCE AI ─────────────────────────────────────────────────────────
function checkFinance(){
  const fr=SD.financialRecords;
  if(fr&&fr.recordCount>0){$('finance-empty').style.display='none';showFinanceAnalysis(fr);}
  else{$('finance-empty').style.display='block';$('finance-analysis').style.display='none';}
}

function handleFinanceUpload(e){
  const f=e.target.files[0];if(!f)return;
  const btn=$('finance-empty').querySelector('.btn-brand');btn.textContent='⏳ Reading...';btn.disabled=true;
  const r=new FileReader();
  r.onload=async ev=>{
    const lines=ev.target.result.split(/\r?\n/).filter(l=>l.trim());
    const records=lines.slice(1).map(l=>{const c=l.split(',').map(x=>x.replace(/"/g,'').trim());return{date:c[0]||'',desc:c[1]||'',amount:parseFloat(c[2])||0,type:(c[3]||'expense').toLowerCase()};}).filter(r=>r.desc&&!isNaN(r.amount));
    const income=records.filter(r=>r.type==='income'||r.amount>0).reduce((s,r)=>s+Math.abs(r.amount),0);
    const expenses=records.filter(r=>r.type==='expense'||r.amount<0).reduce((s,r)=>s+Math.abs(r.amount),0);
    const large=records.filter(r=>Math.abs(r.amount)>500000).length;
    const fr={fileName:f.name,recordCount:records.length,totalIncome:income,totalExpenses:expenses,largeTransactions:large,uploadedAt:new Date().toISOString()};
    SD.financialRecords=fr;localStorage.setItem(`p_${schoolId}_financialRecords`,JSON.stringify(fr));
    await SQ.push('financialRecords',fr);
    showFinanceAnalysis(fr);
    btn.textContent='📤 Upload Financial Data CSV';btn.disabled=false;e.target.value='';
  };
  r.onerror=()=>{alert('File read failed. Please try again.');btn.textContent='📤 Upload Financial Data CSV';btn.disabled=false;};
  r.readAsText(f);
}

function showFinanceAnalysis(fr){
  $('finance-empty').style.display='none';$('finance-analysis').style.display='block';
  $('ai-projection').textContent=fmt(Math.round(fr.totalIncome*1.08));
  $('ai-anomalies').textContent=fr.largeTransactions.toString();
  const net=fr.totalIncome-fr.totalExpenses;
  $('ai-recommendation').innerHTML=`<strong>💡 AI Insight:</strong><br>${net>=0?`Revenue exceeds expenses by ${fmt(net)}. Consider setting aside 10% (${fmt(Math.round(net*0.1))}) as a school reserve before term ends.`:`Expenses exceed income by ${fmt(Math.abs(net))}. Review staff salary ratio and utilities — those are typically the two largest controllable costs in Nigerian private schools.`}`;
}

async function askFinanceAI(){
  const q=$('ai-question').value.trim();if(!q)return;
  const area=$('ai-chat-area');
  area.innerHTML+=`<div style="background:var(--s2);border-radius:9px;padding:0.6rem;margin-bottom:0.4rem;font-size:0.82rem;"><strong>You:</strong> ${esc(q)}</div>`;
  area.innerHTML+=`<div id="ai-typing" style="color:var(--sub);font-size:0.8rem;padding:0.4rem;">🤖 Thinking...</div>`;
  $('ai-question').value='';
  try{
    const fr=SD.financialRecords||{};
    const context=`School financial data: Income ₦${fr.totalIncome||0}, Expenses ₦${fr.totalExpenses||0}, Records: ${fr.recordCount||0}. Current students: ${SD.students.length}, Collected: ₦${SD.students.reduce((t,s)=>t+(s.paid||0),0)}, Outstanding: ₦${SD.students.reduce((t,s)=>t+((s.totalFee||0)-(s.paid||0)),0)}.`;
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:400,messages:[{role:'user',content:`You are a financial advisor for a Nigerian private school. Be practical and concise. Context: ${context}\n\nQuestion: ${q}`}]})});
    const data=await res.json();
    const reply=data.content?.[0]?.text||'Unable to get response.';
    document.getElementById('ai-typing')?.remove();
    area.innerHTML+=`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:0.6rem;margin-bottom:0.4rem;font-size:0.82rem;"><strong>🤖 AI:</strong> ${esc(reply)}</div>`;
  }catch(e){document.getElementById('ai-typing')?.remove();area.innerHTML+=`<div style="color:var(--sub);font-size:0.78rem;padding:0.4rem;">Finance AI requires internet. Connect and try again.</div>`;}
}

// ── 11. COMMS ─────────────────────────────────────────────────────────────
function renderComms(){
  const pages=SD.socialPages||[];
  $('social-pages').innerHTML=pages.length===0?'<p style="font-size:0.8rem;color:var(--sub);text-align:center;padding:0.75rem;">No pages added yet.</p>':pages.map((p,i)=>{
    const icons={facebook:'📘',instagram:'📸',twitter:'🐦',youtube:'📺',tiktok:'🎵',whatsapp:'💬',telegram:'✈️'};
    return`<div class="social-item"><div><span style="font-size:1.2rem;margin-right:6px;">${icons[p.platform]||'🌐'}</span><strong style="font-size:0.85rem;">${esc(p.name)}</strong><div style="font-size:0.7rem;color:var(--sub);">${p.platform}</div></div><div style="display:flex;gap:0.35rem;"><button class="btn-brand btn-sm" onclick="window.open('${esc(p.url||'#')}','_blank')">🔗</button><button class="btn-danger btn-sm" onclick="removeSocialPage(${i})">🗑️</button></div></div>`;
  }).join('');
}

async function addSocialPage(){
  const plat=$('soc-platform').value,name=$('soc-name').value.trim(),url=$('soc-url').value.trim();
  if(!plat||!name)return alert('Select platform and enter page name.');
  if(!SD.socialPages)SD.socialPages=[];
  SD.socialPages.push({platform:plat,name,url:url||'#',addedAt:new Date().toISOString()});
  await SQ.push('socialPages',SD.socialPages);
  $('soc-platform').value='';$('soc-name').value='';$('soc-url').value='';renderComms();
}

async function removeSocialPage(idx){if(!confirm('Remove?'))return;SD.socialPages.splice(idx,1);await SQ.push('socialPages',SD.socialPages);renderComms();}

function logComm(type,preview){
  if(!SD.commsLog)SD.commsLog=[];
  SD.commsLog.unshift({type,preview,sentAt:new Date().toISOString(),sentBy:userRole});
  SQ.push('commsLog',SD.commsLog);
}

function broadcastFeeReminder(){
  const overdue=SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0);
  const sn=SD.config.schoolName||'School';
  const msg=`Dear Parent,\n\n*${sn}* would like to remind you that outstanding term fees are now due.\n\nKindly ensure prompt payment to avoid disruption to your ward's education.\n\nThank you.\n– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
  logComm('Fee Reminder',`Broadcast to ${overdue.length} overdue parents`);
}

function broadcastEvent(){
  const ev=prompt('Event name (e.g. Inter-house Sports Day):');if(!ev)return;
  const date=prompt('Date of event (e.g. Saturday 24 May 2026):');if(!date)return;
  const sn=SD.config.schoolName||'School';
  const msg=`Dear Parent,\n\n*${sn}* cordially invites you to:\n\n📅 *${ev}*\n🗓️ Date: ${date}\n📍 Venue: School Premises\n\nYour presence and support is warmly welcomed.\n\n– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
  logComm('Event Notice',`${ev} — ${date}`);
}

function broadcastAnnouncement(){
  const subj=prompt('Announcement subject:');if(!subj)return;
  const body=prompt('Message:');if(!body)return;
  const sn=SD.config.schoolName||'School';
  const msg=`📢 *Announcement from ${sn}*\n\n*${subj}*\n\n${body}\n\n– ${sn}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
  logComm('Announcement',subj);
}

function viewMessageHistory(){
  const logs=SD.commsLog||[];
  const c=$('comms-history-list');
  c.innerHTML=logs.length===0?'<p style="text-align:center;color:var(--sub);padding:2rem;">No messages sent yet.</p>':logs.slice(0,30).map(l=>`<div class="comm-log"><div style="display:flex;justify-content:space-between;"><strong style="font-size:0.85rem;">${esc(l.type)}</strong><span style="font-size:0.7rem;color:var(--sub);">${new Date(l.sentAt).toLocaleDateString('en-NG')}</span></div><div style="font-size:0.78rem;color:var(--sub);margin-top:2px;">${esc(l.preview||'')}</div></div>`).join('');
  openM('comms-history-modal');
}

// ── 12. ANALYTICS ─────────────────────────────────────────────────────────
function renderAnalytics(){
  const s=SD.students||[];const exp=SD.expenses||[];
  const totalFee=s.reduce((t,x)=>t+(x.totalFee||0),0);
  const totalCol=s.reduce((t,x)=>t+(x.paid||0),0);
  const totalExp=exp.reduce((t,e)=>t+(e.amount||0),0);
  const paid=s.filter(x=>(x.totalFee||0)<=(x.paid||0)).length;
  const partial=s.filter(x=>x.paid>0&&(x.totalFee||0)>(x.paid||0)).length;
  const unpaid=s.filter(x=>!x.paid||x.paid===0).length;
  const byClass={};s.forEach(x=>{const c=x.class||'Unknown';byClass[c]=(byClass[c]||0)+1;});
  const byExpCat={};exp.forEach(e=>{const c=e.category||'Other';byExpCat[c]=(byExpCat[c]||(0))+(e.amount||0);});
  $('analytics-content').innerHTML=`
    <div class="stats"><div class="stat"><div class="sn" style="color:var(--money);">${paid}</div><div class="sl">Fully Paid</div></div>
    <div class="stat"><div class="sn" style="color:var(--warn);">${partial}</div><div class="sl">Partial</div></div>
    <div class="stat"><div class="sn" style="color:var(--danger);">${unpaid}</div><div class="sl">Unpaid</div></div>
    <div class="stat"><div class="sn">${s.length}</div><div class="sl">Total</div></div></div>
    <div class="card"><div class="ct">💰 Financial Summary</div>
    ${[['Expected',totalFee,''],['Collected',totalCol,'var(--money)'],['Outstanding',totalFee-totalCol,'var(--danger)'],['Expenses',totalExp,'var(--warn)'],['Net Balance',totalCol-totalExp,totalCol-totalExp>=0?'var(--money)':'var(--danger)']].map(([label,val,col])=>`<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;"><span>${label}</span><strong${col?` style="color:${col};"`:''} style="font-family:'DM Mono',monospace;">${fmt(val)}</strong></div>`).join('')}</div>
    <div class="card"><div class="ct">🎓 Students by Class</div>
    ${Object.entries(byClass).sort((a,b)=>b[1]-a[1]).map(([cls,cnt])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.82rem;"><span>${esc(cls)}</span><div style="display:flex;align-items:center;gap:0.5rem;"><div style="width:${Math.round((cnt/s.length)*80)}px;height:8px;background:var(--brand);border-radius:4px;"></div><span style="font-weight:700;">${cnt}</span></div></div>`).join('')}</div>
    <div class="card"><div class="ct">📉 Expenses by Category</div>
    ${Object.entries(byExpCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.82rem;"><span>${esc(cat)}</span><strong style="font-family:'DM Mono',monospace;">${fmt(amt)}</strong></div>`).join('')}</div>
    <button class="btn-brand" onclick="exportCSV()">📥 Export Students CSV</button>`;
}

function exportCSV(){
  const rows=[['Name','Class','Phone','Total Fee','Paid','Outstanding'],...SD.students.map(s=>[s.name,s.class||'',s.phone||'',s.totalFee||0,s.paid||0,(s.totalFee||0)-(s.paid||0)])];
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'}));a.download=`students-${new Date().toISOString().split('T')[0]}.csv`;a.click();
}

// ── 13. SECURITY ──────────────────────────────────────────────────────────
function securitySearch(){
  const q=($('sec-search')?.value||'').toLowerCase().trim();
  const c=$('security-results');
  if(!q){c.innerHTML='';return;}
  const matches=SD.students.filter(s=>s.name.toLowerCase().includes(q)||(s.phone||'').includes(q)||(s.class||'').toLowerCase().includes(q));
  if(!matches.length){c.innerHTML='<p style="color:var(--sub);font-size:0.85rem;padding:0.5rem;">No student found.</p>';return;}
  c.innerHTML=matches.map(s=>`<div class="sec-result"><div style="font-weight:700;font-size:0.9rem;">${esc(s.name)}</div>
    <div style="font-size:0.75rem;color:var(--sub);margin-top:3px;">Class: ${esc(s.class||'—')} · Guardian: ${s.phone||'—'}</div>
    ${s.swot?.threats&&s.swot.threats.toLowerCase().includes('allerg')?`<div class="allergy-alert">⚠️ ALLERGY ALERT: ${esc(s.swot.threats)}</div>`:''}
  </div>`).join('');
}

// ── 14. SUPPORT ───────────────────────────────────────────────────────────
function renderSupport(){
  const agent=SD.config.agent;
  if(agent&&agent.name){
    $('agent-contact').innerHTML=`<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;"><div style="width:48px;height:48px;background:var(--brand);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:1.1rem;flex-shrink:0;">${agent.name.charAt(0).toUpperCase()}</div><div><div style="font-weight:700;font-size:1rem;">${esc(agent.name)}</div><div style="font-size:0.78rem;color:var(--sub);">Your assigned agent</div></div></div>
      <div style="display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0;border-bottom:1px solid var(--border);"><span style="font-size:1.2rem;">📱</span><div style="flex:1;"><div style="font-size:0.65rem;color:var(--sub);text-transform:uppercase;">WhatsApp</div><div style="font-weight:600;">${agent.phone||'—'}</div></div><button class="btn-wa btn-sm" onclick="window.open('https://wa.me/${(agent.phone||'').replace(/\\D/g,'')}?text=Hello ${encodeURIComponent(agent.name)}, I need help with my Educational Bloom portal.','_blank')">📞 Call</button></div>`;
  }
}

// ── 15. SETTINGS ──────────────────────────────────────────────────────────
function loadSettings(){
  const c=SD.config||{};
  $('set-name').value=c.schoolName||'';$('set-phone').value=c.whatsapp||'';$('set-email').value=c.principalEmail||'';
  $('set-fee').value=c.fee||50000;$('set-term').value=c.currentTerm||'Term 1';$('set-session').value=c.session||'2025/2026';
  $('set-subjects').value=(c.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education']).join(', ');
  const isPrem=c.plan==='premium';
  $('settings-plan').textContent=isPrem?'Premium ✨':'Basic';
  $('settings-staff-limit').textContent=isPrem?'Unlimited':'3';
  $('settings-ai').textContent=isPrem?'Full Advisor':'Basic';
}

async function saveSettings(){
  const subs=$('set-subjects').value.split(',').map(s=>s.trim()).filter(Boolean);
  const newEmail=$('set-email').value.trim().toLowerCase();
  const newPwd=$('set-pwd')?.value.trim()||'';
  SD.config={...SD.config,schoolName:$('set-name').value.trim(),whatsapp:$('set-phone').value.trim(),principalEmail:newEmail,fee:parseFloat($('set-fee').value)||50000,currentTerm:$('set-term').value,session:$('set-session').value,subjects:subs};
  await SQ.push('config',SD.config);
  // If email or password updated, sync to staff record for Principal
  if(newEmail||newPwd){
    const staff=SD.staff||[];
    const principal=staff.find(s=>s.role==='Principal');
    if(principal){
      if(newEmail) principal.email=newEmail;
      if(newPwd){
        if(newPwd.length<4){alert('Password must be at least 4 characters.');return;}
        principal.password=newPwd;
        // Update saved auth so Remember Me still works
        const auth=JSON.parse(localStorage.getItem('p_auth')||sessionStorage.getItem('p_auth')||'{}');
        auth.email=newEmail||auth.email;
        const stored=localStorage.getItem('p_auth')?localStorage:sessionStorage;
        stored.setItem('p_auth',JSON.stringify(auth));
        if($('set-pwd'))$('set-pwd').value=''; // clear password field after save
      }
      await SQ.push('staff',staff);
    }
  }
  $('hdr-school').textContent=SD.config.schoolName||schoolId;$('hdr-term').textContent=SD.config.currentTerm;
  renderBanner();alert('✅ Settings saved!');
}

// ── 16. OPPORTUNITIES ─────────────────────────────────────────────────────
function renderOpps(){
  const isPrem=SD.config.plan==='premium';
  const cat=$('opp-cat')?.value||'';const dl=$('opp-deadline')?.value||'';
  let opps=[...SD.opportunities];
  if(cat)opps=opps.filter(o=>o.type===cat);
  if(dl){const cut=new Date();cut.setDate(cut.getDate()+parseInt(dl));opps=opps.filter(o=>new Date(o.deadline)<=cut);}
  $('opp-premium-cta').style.display=isPrem?'none':'block';
  const c=$('opps-list');
  if(!opps.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No opportunities match your filters.</p>';return;}
  const badgeCls={scholarship:'ob-s',grant:'ob-g',internship:'ob-i',competition:'ob-c'};
  c.innerHTML=opps.map(o=>{
    const dl=Math.ceil((new Date(o.deadline)-new Date())/(1000*60*60*24));
    const dlCls=dl<=7?'dl-urgent':dl<=30?'dl-soon':'dl-ok';
    const dlTxt=dl<=0?'Closed':`${dl}d left`;
    const locked=!isPrem;
    return`<div class="opp-card ${locked?'locked':''}" onclick="${isPrem?`viewOpp('${o.id}')`:''}" style="${locked?'cursor:default;':''}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.4rem;">
        <div style="font-weight:700;font-size:0.88rem;flex:1;margin-right:0.5rem;">${esc(o.title)}</div>
        <span class="opp-badge ${badgeCls[o.type]||'ob-s'}">${o.type}</span>
      </div>
      <div style="font-size:0.75rem;color:var(--sub);margin-bottom:0.35rem;">${esc(o.provider)}</div>
      <div style="display:flex;gap:0.4rem;align-items:center;">
        <span class="${dlCls}">⏰ ${dlTxt}</span>
        ${o.amount?`<span style="font-weight:700;color:var(--money);font-size:0.78rem;">💰 ${esc(o.amount)}</span>`:''}
      </div>
      ${isPrem?`<div style="font-size:0.78rem;color:var(--sub);margin-top:0.4rem;">${esc(o.desc||'')}</div><div style="margin-top:0.5rem;"><button class="btn-brand btn-sm" onclick="event.stopPropagation();alert('Apply at: ${esc(o.url||'See provider website')}')">📝 Apply Now</button></div>`:'<div style="font-size:0.73rem;color:var(--sub);margin-top:0.35rem;">✨ Upgrade to Premium to see details and apply</div>'}
    </div>`;
  }).join('');
}

function viewOpp(id){const o=SD.opportunities.find(x=>x.id===id);if(!o)return;alert(`${o.title}\n\nProvider: ${o.provider}\nDeadline: ${o.deadline}\nValue: ${o.amount||'—'}\n\n${o.desc||''}\n\nApply at: ${o.url||'See provider website'}`);}


// ── Class Attendance Screen ─────────────────────────────────────────────
// Replaces the per-student attendance tab with a class-wide roll call view.

function openClassAttendance(){
  // Show modal, populate class picker, render
  openM('class-att-modal');
  const sel = $('ca-class-sel');
  const classes = [...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— Select Class —</option>' +
    classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('ca-date').value = new Date().toISOString().split('T')[0];
  $('ca-list').innerHTML = '<p style="color:var(--sub);font-size:0.82rem;text-align:center;padding:1.5rem;">Select a class above.</p>';
  $('ca-summary').textContent = '';
}

function renderClassRoll(){
  const cls = $('ca-class-sel').value;
  const date = $('ca-date').value;
  if(!cls||!date){ $('ca-list').innerHTML='<p style="color:var(--sub);text-align:center;padding:1rem;">Pick a class and date.</p>'; return; }
  const students = SD.students.filter(s=>s.class===cls);
  if(!students.length){ $('ca-list').innerHTML='<p style="color:var(--sub);text-align:center;padding:1rem;">No students in this class.</p>'; return; }
  const att = SD.attendance[date]||{};
  const present = students.filter(s=>att[s.name]==='Present').length;
  $('ca-summary').textContent = `${present}/${students.length} Present`;

  $('ca-list').innerHTML = students.map((s,i)=>{
    const status = att[s.name]||'';
    const pCls = status==='Present'?'ca-btn-active-p':'';
    const aCls = status==='Absent'?'ca-btn-active-a':'';
    const lCls = status==='Late'?'ca-btn-active-l':'';
    return `<div class="ca-row" id="ca-row-${i}">
      <div class="ca-name">${esc(s.name)}</div>
      <div class="ca-btns">
        <button class="ca-btn ca-p ${pCls}" onclick="markClassAtt(${SD.students.indexOf(s)},'${date}','Present',${i})">✅</button>
        <button class="ca-btn ca-a ${aCls}" onclick="markClassAtt(${SD.students.indexOf(s)},'${date}','Absent',${i})">❌</button>
        <button class="ca-btn ca-l ${lCls}" onclick="markClassAtt(${SD.students.indexOf(s)},'${date}','Late',${i})">⏰</button>
      </div>
    </div>`;
  }).join('');
}

async function markClassAtt(stuIdx, date, status, rowIdx){
  const s = SD.students[stuIdx]; if(!s) return;
  if(!SD.attendance[date]) SD.attendance[date]={};
  SD.attendance[date][s.name] = status;
  // Update just this row's buttons (no full re-render needed — stays fast)
  const row = document.getElementById('ca-row-'+rowIdx);
  if(row){
    row.querySelectorAll('.ca-btn').forEach(b=>{
      b.classList.remove('ca-btn-active-p','ca-btn-active-a','ca-btn-active-l');
    });
    const cls = status==='Present'?'ca-btn-active-p':status==='Absent'?'ca-btn-active-a':'ca-btn-active-l';
    const idx = ['Present','Absent','Late'].indexOf(status);
    const btns = row.querySelectorAll('.ca-btn');
    if(btns[idx]) btns[idx].classList.add(cls);
  }
  // Update summary
  const clsName = $('ca-class-sel').value;
  const students = SD.students.filter(s=>s.class===clsName);
  const att = SD.attendance[date]||{};
  const present = students.filter(s=>att[s.name]==='Present').length;
  $('ca-summary').textContent = `${present}/${students.length} Present`;
  // Debounced save — batch writes to avoid 40 individual Firestore calls
  clearTimeout(window._attSaveTimer);
  window._attSaveTimer = setTimeout(()=>SQ.push('attendance',SD.attendance), 1200);
}

async function markAllPresent(){
  const cls = $('ca-class-sel').value; const date = $('ca-date').value;
  if(!cls||!date) return;
  if(!SD.attendance[date]) SD.attendance[date]={};
  SD.students.filter(s=>s.class===cls).forEach(s=>{ SD.attendance[date][s.name]='Present'; });
  await SQ.push('attendance',SD.attendance);
  renderClassRoll();
}

async function markAllAbsent(){
  const cls = $('ca-class-sel').value; const date = $('ca-date').value;
  if(!cls||!date) return;
  if(!confirm(`Mark ALL students in ${cls} as Absent on ${date}?`)) return;
  if(!SD.attendance[date]) SD.attendance[date]={};
  SD.students.filter(s=>s.class===cls).forEach(s=>{ SD.attendance[date][s.name]='Absent'; });
  await SQ.push('attendance',SD.attendance);
  renderClassRoll();
}

function notifyAbsentParents(){
  const cls = $('ca-class-sel').value; const date = $('ca-date').value;
  if(!cls||!date) return;
  const att = SD.attendance[date]||{};
  const absent = SD.students.filter(s=>s.class===cls&&att[s.name]==='Absent'&&s.phone);
  if(!absent.length){ alert('No absent students with phone numbers for this class/date.'); return; }
  // Use same guided bulk sequence, but for absence notifications
  _waBulkQueue = absent.map(s=>({...s, _isAbsence:true, _date:date}));
  _waBulkIdx = 0;
  openM('bulk-wa-modal');
  // Temporarily override the render to show absence message
  _waBulkIsAbsence = true;
  renderBulkWAStep();
}
let _waBulkIsAbsence = false;

async function saveClassAttendance(){
  await SQ.push('attendance',SD.attendance);
  closeM('class-att-modal');
  alert('✅ Attendance saved for ' + ($('ca-class-sel').value||'class') + ' on ' + $('ca-date').value);
}

// ── Subject Score Entry Screen ──────────────────────────────────────────
// Enter scores for all students in a class for one subject at once.

function openSubjectScores(){
  openM('subj-scores-modal');
  const classes = [...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs = SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
  $('ss-class-sel').innerHTML = '<option value="">— Select Class —</option>' +
    classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('ss-subj-sel').innerHTML = subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  $('ss-list').innerHTML = '<p style="color:var(--sub);font-size:0.82rem;text-align:center;padding:1.5rem;">Select a class and subject above.</p>';
}

function renderSubjectScoreList(){
  const cls = $('ss-class-sel').value;
  const sub = $('ss-subj-sel').value;
  const term = SD.config.currentTerm||'Term 1';
  if(!cls||!sub){ $('ss-list').innerHTML='<p style="color:var(--sub);text-align:center;padding:1rem;">Pick a class and subject.</p>'; return; }
  const students = SD.students.filter(s=>s.class===cls);
  if(!students.length){ $('ss-list').innerHTML='<p style="color:var(--sub);text-align:center;padding:1rem;">No students in this class.</p>'; return; }
  $('ss-list').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 70px 70px 60px;gap:4px;padding:0.4rem 0;border-bottom:2px solid var(--border);font-size:0.72rem;font-weight:700;color:var(--sub);">
      <span>Student</span><span style="text-align:center;">CA/40</span><span style="text-align:center;">Exam/60</span><span style="text-align:center;">Total</span>
    </div>
    ${students.map((s,i)=>{
      const stuIdx = SD.students.indexOf(s);
      const v = (s.scores||{})[sub]||{ca:'',exam:''};
      const tot = ((v.ca||0)*1)+((v.exam||0)*1);
      const g = tot>0?gradeScore(tot).g:'—';
      const gCls = tot>0?'g'+g:'';
      return `<div class="ss-row" id="ss-row-${i}">
        <div style="font-size:0.8rem;font-weight:600;padding-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
        <input type="number" min="0" max="40" value="${v.ca||''}" placeholder="CA"
          class="ss-inp" id="ss-ca-${i}" inputmode="numeric" enterkeyhint="next"
          oninput="updateSSTotal(${stuIdx},'${esc(sub)}','ca',this.value,${i})"
          style="text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;">
        <input type="number" min="0" max="60" value="${v.exam||''}" placeholder="Exam"
          class="ss-inp" id="ss-ex-${i}" inputmode="numeric" enterkeyhint="next"
          oninput="updateSSTotal(${stuIdx},'${esc(sub)}','exam',this.value,${i})"
          style="text-align:center;margin:0;padding:0.35rem 0.2rem;font-size:0.82rem;">
        <div id="ss-tot-${i}" class="ss-tot ${gCls}" style="text-align:center;font-weight:700;font-size:0.85rem;padding-top:6px;">${tot||'—'}</div>
      </div>`;
    }).join('')}`;
}

function updateSSTotal(stuIdx,sub,type,val,rowIdx){
  const s = SD.students[stuIdx]; if(!s) return;
  if(!s.scores) s.scores={};
  if(!s.scores[sub]) s.scores[sub]={ca:0,exam:0};
  const num = Math.min(type==='ca'?40:60, Math.max(0,parseFloat(val)||0));
  s.scores[sub][type] = num;
  const tot = (s.scores[sub].ca||0)+(s.scores[sub].exam||0);
  const el = document.getElementById('ss-tot-'+rowIdx);
  if(el){
    const g = gradeScore(tot);
    el.textContent = tot||'—';
    el.className = 'ss-tot g'+g.g;
  }
  clearTimeout(window._scoreSaveTimer);
  window._scoreSaveTimer = setTimeout(()=>SQ.push('students',SD.students), 2000);
}

async function saveSubjectScores(){
  await SQ.push('students',SD.students);
  const sub = $('ss-subj-sel').value;
  const cls = $('ss-class-sel').value;
  closeM('subj-scores-modal');
  alert(`✅ ${sub} scores saved for ${cls}!`);
}

// ── Bulk WhatsApp Sequence ───────────────────────────────────────────────
// Opens messages one at a time for each overdue parent.
// Teacher taps "Send" in WhatsApp, returns, taps "Next" — 60 parents done
// in 60 taps with no navigation, vs 180 taps before.

let _waBulkQueue = [];
let _waBulkIdx = 0;

function startBulkWA(){
  const overdue = SD.students.filter(s=>(s.totalFee||0)-(s.paid||0)>0&&s.phone);
  if(!overdue.length) return alert('No overdue students with phone numbers.');
  _waBulkQueue = overdue;
  _waBulkIdx = 0;
  openM('bulk-wa-modal');
  renderBulkWAStep();
}

function renderBulkWAStep(){
  const total = _waBulkQueue.length;
  if(_waBulkIdx >= total){ closeBulkWA(); return; }
  const s = _waBulkQueue[_waBulkIdx];
  const sn = SD.config.schoolName||'School';
  let msg, oweDisplay;
  if(_waBulkIsAbsence){
    const dt = s._date||new Date().toISOString().split('T')[0];
    msg = `Dear Parent,\n\nThis is to inform you that *${s.name}* was marked *ABSENT* today (${dt}) at *${sn}*.\n\nKindly ensure your ward attends school or contact us if there is a valid reason.\n\nThank you.\n– ${sn}`;
    oweDisplay = '📍 Absent today';
  } else {
    const owe = (s.totalFee||0)-(s.paid||0);
    msg = `Dear Parent,\n\nThis is a friendly reminder from *${sn}*.\n\n*${s.name}* has an outstanding fee balance of *${fmt(owe)}* this term.\n\nKindly make payment at your earliest convenience.\n\nThank you.\n– ${sn}`;
    oweDisplay = fmt(owe);
  }
  $('bwa-progress').textContent = `${_waBulkIdx+1} of ${total}`;
  $('bwa-pct').style.width = Math.round((_waBulkIdx/total)*100)+'%';
  $('bwa-name').textContent = s.name;
  $('bwa-owe').textContent = oweDisplay;
  $('bwa-phone').textContent = s.phone;
  $('bwa-open-btn').onclick = ()=>{
    window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
  };
}

function nextBulkWA(){
  _waBulkIdx++;
  renderBulkWAStep();
}

function closeBulkWA(){
  closeM('bulk-wa-modal');
  const done = Math.min(_waBulkIdx, _waBulkQueue.length);
  const type = _waBulkIsAbsence?'Absence Notifications':'Fee Reminders';
  logComm('Bulk WhatsApp '+type,`Sent to ${done} parents`);
  if(done>0) alert(`✅ Done! ${done} message${done!==1?'s':''} sent.`);
  _waBulkQueue=[];_waBulkIdx=0;_waBulkIsAbsence=false;
}

// ── Bulk Report Card Send ────────────────────────────────────────────────
let _rcBulkQueue = [];
let _rcBulkIdx = 0;

function startBulkReportCards(){
  const cls = prompt('Enter class name to send report cards (e.g. JSS1):');
  if(!cls) return;
  const students = SD.students.filter(s=>s.class===cls&&s.phone);
  if(!students.length) return alert(`No students with phone numbers found in "${cls}".`);
  _rcBulkQueue = students;
  _rcBulkIdx = 0;
  openM('bulk-rc-modal');
  renderBulkRCStep();
}

function renderBulkRCStep(){
  const total = _rcBulkQueue.length;
  if(_rcBulkIdx >= total){ closeBulkRC(); return; }
  const s = _rcBulkQueue[_rcBulkIdx];
  const subs = SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
  const sc = s.scores||{};
  let lines = `📋 *REPORT CARD — ${SD.config.schoolName||'School'}*\n\n*Student:* ${s.name}\n*Class:* ${s.class||'—'}\n*Term:* ${SD.config.currentTerm||'Term 1'}\n\n`;
  let total2=0,n=0;
  subs.forEach(sub=>{const v=sc[sub]||{ca:0,exam:0};const t=(v.ca||0)+(v.exam||0);total2+=t;n++;lines+=`${sub}: ${t}/100 (${gradeScore(t).g})\n`;});
  const avg=n>0?Math.round(total2/n):0;
  lines+=`\n*Average: ${avg}% (${gradeScore(avg).g})*`;
  $('brc-progress').textContent=`${_rcBulkIdx+1} of ${total}`;
  $('brc-pct').style.width=Math.round((_rcBulkIdx/total)*100)+'%';
  $('brc-name').textContent=s.name;
  $('brc-phone').textContent=s.phone;
  $('brc-open-btn').onclick=()=>{
    window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent(lines)}`,'_blank');
  };
}

function nextBulkRC(){ _rcBulkIdx++; renderBulkRCStep(); }

function closeBulkRC(){
  closeM('bulk-rc-modal');
  const done=Math.min(_rcBulkIdx,_rcBulkQueue.length);
  if(done>0) alert(`✅ Done! ${done} report card${done!==1?'s':''} sent.`);
  _rcBulkQueue=[];_rcBulkIdx=0;
}


// ── Score Sheet OCR ─────────────────────────────────────────────────────
// Teacher picks subject + class, uploads photo of score sheet.
// OCR reads the table, fuzzy-matches student names, fills CA + Exam scores.

function openScoreOCR(){
  openM('score-ocr-modal');
  const classes=[...new Set(SD.students.map(s=>s.class).filter(Boolean))].sort();
  const subs=SD.config.subjects||['English','Mathematics','Basic Science','Social Studies','Civic Education'];
  $('socr-class').innerHTML='<option value="">— Select Class —</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('socr-subj').innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  $('socr-status').textContent='';
  $('socr-preview').innerHTML='';
  $('socr-save-btn').style.display='none';
  $('socr-img-input').value='';
  window._socrParsed=[];
}

function socrPickPhoto(){
  $('socr-img-input').click();
}

async function socrHandleImage(e){
  const f=e.target.files[0]; if(!f)return;
  const cls=$('socr-class').value;
  const sub=$('socr-subj').value;
  if(!cls||!sub){alert('Select class and subject first.');e.target.value='';return;}
  
  $('socr-status').innerHTML='<span style="color:var(--sub);">📸 Loading OCR engine… (first time ~30s)</span>';
  $('socr-preview').innerHTML='';
  $('socr-save-btn').style.display='none';

  // Load Tesseract
  await new Promise((resolve,reject)=>{
    if(window.Tesseract){resolve();return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });

  // Read image
  const imgData=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=ev=>res(ev.target.result);
    r.onerror=rej;
    r.readAsDataURL(f);
  });

  $('socr-status').innerHTML='<span style="color:var(--sub);">📸 Reading score sheet… 0%</span>';
  
  try{
    const {data:{text}}=await Tesseract.recognize(imgData,'eng',{
      logger:m=>{
        if(m.status==='recognizing text')
          $('socr-status').innerHTML=`<span style="color:var(--sub);">📸 Reading… ${Math.round((m.progress||0)*100)}%</span>`;
      }
    });

    $('socr-status').innerHTML='<span style="color:var(--sub);">🔍 Matching names to student list…</span>';
    
    const results=parseScoreSheet(text, cls, sub);
    window._socrParsed=results;
    renderSocrPreview(results, sub);

  }catch(err){
    $('socr-status').innerHTML='<span style="color:var(--danger);">❌ Could not read image. Try better lighting or a flatter photo.</span>';
    console.error('Score OCR error:',err);
  }
  e.target.value='';
}

function parseScoreSheet(raw, cls, sub){
  // Get students in this class for name matching
  const classStudents=SD.students.filter(s=>s.class===cls);
  
  // Name similarity score (word overlap, same as bulk payment matcher)
  const nameSim=(a,b)=>{
    const wa=a.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(w=>w.length>1);
    const wb=b.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(w=>w.length>1);
    if(!wa.length||!wb.length)return 0;
    const shared=wa.filter(w=>wb.includes(w)).length;
    let prefix=0;
    wa.forEach(w=>{if(w.length>2&&wb.some(v=>v.startsWith(w)||w.startsWith(v)))prefix+=0.4;});
    return(shared+prefix)/Math.max(wa.length,wb.length);
  };

  const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const results=[];
  const matched=new Set();

  lines.forEach(line=>{
    // Extract all numbers from this line
    const nums=line.match(/\b\d{1,3}\b/g);
    if(!nums||nums.length<1)return;

    // Extract the text part (remove numbers, punctuation, S/N)
    const textPart=line
      .replace(/^\s*\d+[\.\):\s]+/,'')   // strip leading S/N like "1." or "1)"
      .replace(/\b\d{1,3}\b/g,' ')       // remove numbers
      .replace(/[\/\\|%\-_=]/g,' ')      // remove table chars
      .replace(/\s+/g,' ')
      .trim();

    if(textPart.length<3)return;

    // Find best matching student in this class
    let best=null, bestScore=0;
    classStudents.forEach(s=>{
      const score=nameSim(textPart, s.name);
      if(score>bestScore){bestScore=score;best=s;}
    });

    if(!best||bestScore<0.3)return;
    if(matched.has(best.name))return; // don't double-match
    matched.add(best.name);

    const stuIdx=SD.students.indexOf(best);

    // Parse scores from numbers found
    // Strategy: find numbers ≤40 (likely CA) and ≤60 (likely Exam)
    // Filter out obvious non-scores (S/N like 1,2,3 at start)
    const scores=nums.map(Number).filter(n=>n<=100&&n>=0);
    
    let ca=null, exam=null;
    // Try to identify CA (≤40) and Exam (≤60)
    // Look for two numbers where first≤40 and second≤60
    for(let i=0;i<scores.length-1;i++){
      if(scores[i]<=40&&scores[i+1]<=60){
        ca=scores[i]; exam=scores[i+1]; break;
      }
    }
    // If only one number found and ≤100, treat as total — infer if possible
    if(ca===null&&exam===null&&scores.length>=1){
      const total=scores.find(n=>n<=100);
      if(total!==undefined){
        // Can't split — flag for manual review
        results.push({stuIdx,name:best.name,ca:null,exam:null,total,raw:line,
          status:'review', note:'Only total found — enter CA/Exam manually'});
        return;
      }
    }
    if(ca===null&&exam===null)return;

    results.push({stuIdx,name:best.name,ca,exam,
      total:(ca||0)+(exam||0),raw:line,status:'ok',sim:Math.round(bestScore*100)});
  });

  return results;
}

function renderSocrPreview(results, sub){
  const ok=results.filter(r=>r.status==='ok');
  const review=results.filter(r=>r.status==='review');
  const total=ok.length+review.length;

  $('socr-status').innerHTML=`<strong style="color:var(--money);">✅ ${ok.length} matched</strong>`+
    (review.length?` · <span style="color:var(--warn);">⚠️ ${review.length} need review</span>`:'')+
    (total===0?'<span style="color:var(--danger);">No scores detected. Try a clearer photo or enter manually.</span>':'');

  if(!total){$('socr-save-btn').style.display='none';return;}

  $('socr-preview').innerHTML=`
    <div style="font-size:0.72rem;color:var(--sub);margin-bottom:0.5rem;">Review before saving — tap any field to edit:</div>
    <div style="display:grid;grid-template-columns:1fr 55px 55px 50px;gap:3px;padding:0.3rem 0;border-bottom:2px solid var(--border);font-size:0.68rem;font-weight:700;color:var(--sub);">
      <span>Student</span><span style="text-align:center;">CA/40</span><span style="text-align:center;">Exam/60</span><span style="text-align:center;">Total</span>
    </div>
    ${results.map((r,i)=>{
      const rowCls=r.status==='review'?'background:#fffbeb;':'';
      return`<div style="display:grid;grid-template-columns:1fr 55px 55px 50px;gap:3px;padding:0.3rem 0;border-bottom:1px solid var(--border);align-items:center;${rowCls}">
        <div style="font-size:0.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(r.name)}${r.status==='review'?'<span style="color:var(--warn);font-size:0.65rem;"> ⚠️</span>':''}
        </div>
        <input type="number" min="0" max="40" value="${r.ca!==null?r.ca:''}" inputmode="numeric"
          placeholder="CA" id="socr-ca-${i}"
          oninput="socrUpdateTotal(${i})"
          style="text-align:center;margin:0;padding:0.3rem 0.15rem;font-size:0.8rem;border:1px solid var(--border);border-radius:6px;${r.ca===null?'border-color:var(--warn);':''}">
        <input type="number" min="0" max="60" value="${r.exam!==null?r.exam:''}" inputmode="numeric"
          placeholder="Exam" id="socr-ex-${i}"
          oninput="socrUpdateTotal(${i})"
          style="text-align:center;margin:0;padding:0.3rem 0.15rem;font-size:0.8rem;border:1px solid var(--border);border-radius:6px;${r.exam===null?'border-color:var(--warn);':''}">
        <div id="socr-tot-${i}" style="text-align:center;font-weight:700;font-size:0.82rem;color:${(r.ca||0)+(r.exam||0)>=70?'var(--money)':'var(--text)'};">
          ${r.ca!==null&&r.exam!==null?(r.ca+r.exam):'—'}
        </div>
      </div>`;
    }).join('')}`;

  $('socr-save-btn').style.display='block';
}

function socrUpdateTotal(i){
  const ca=parseFloat(document.getElementById('socr-ca-'+i)?.value)||0;
  const ex=parseFloat(document.getElementById('socr-ex-'+i)?.value)||0;
  const tot=ca+ex;
  const el=document.getElementById('socr-tot-'+i);
  if(el){ el.textContent=tot||'—'; el.style.color=tot>=70?'var(--money)':'var(--text)'; }
}

async function socrSaveScores(){
  const sub=$('socr-subj').value;
  const results=window._socrParsed||[];
  if(!results.length)return;

  let saved=0;
  results.forEach((r,i)=>{
    const ca=parseFloat(document.getElementById('socr-ca-'+i)?.value);
    const ex=parseFloat(document.getElementById('socr-ex-'+i)?.value);
    if(isNaN(ca)&&isNaN(ex))return;
    const s=SD.students[r.stuIdx]; if(!s)return;
    if(!s.scores)s.scores={};
    s.scores[sub]={
      ca:Math.min(40,Math.max(0,isNaN(ca)?0:ca)),
      exam:Math.min(60,Math.max(0,isNaN(ex)?0:ex))
    };
    saved++;
  });

  await SQ.push('students',SD.students);
  closeM('score-ocr-modal');
  alert(`✅ ${sub} scores saved for ${saved} student${saved!==1?'s':''}!\n\nGo to Students → open any profile → Scores tab to verify.`);
}

// ── Boot — No Login, Direct Access ────────────────────────────────────────
// App opens straight to dashboard. No login barrier.
// Data loads from localStorage (offline) or Firestore (online) automatically.
document.addEventListener('DOMContentLoaded',()=>{
  // Try to restore a previous session from localStorage
  const saved=localStorage.getItem('p_auth')||sessionStorage.getItem('p_auth');
  if(saved){
    try{
      const auth=JSON.parse(saved);
      schoolId=auth.schoolId;userRole=auth.role||'Principal';
    }catch(e){}
  }

  // If no schoolId yet, use a default so the app still works
  if(!schoolId){
    schoolId='LOCAL';
    userRole='Principal';
  }

  // Load all data from localStorage instantly
  SD.config=loadLocal('config',{schoolName:'Educational Bloom',plan:'basic',fee:50000,currentTerm:'Term 1',session:'2025/2026'});
  SD.students=loadLocal('students',[]);
  SD.staff=loadLocal('staff',[{name:'Principal',email:'',password:'',role:'Principal',phone:''}]);
  SD.expenses=loadLocal('expenses',[]);
  SD.attendance=loadLocal('attendance',{});
  SD.sports=loadLocal('sports',{teams:{},custom:[]});
  SD.arts=loadLocal('arts',{gallery:[]});
  SD.music=loadLocal('music',{practiceLogs:[],instruments:[{name:'Keyboard',status:'available'},{name:'Guitar',status:'available'},{name:'Talking Drum',status:'available'}]});
  SD.health=loadLocal('health',[]);
  SD.alumni=loadLocal('alumni',[]);
  SD.socialPages=loadLocal('socialPages',[]);
  SD.commsLog=loadLocal('commsLog',[]);
  SD.opportunities=loadLocal('opportunities',defaultOpps());
  SD.financialRecords=loadLocal('financialRecords',null);

  // Show app immediately — no login screen
  $('login').style.display='none';
  $('app').style.display='block';
  $('hdr-school').textContent=SD.config.schoolName||'Educational Bloom';
  $('hdr-role').textContent=userRole;
  $('hdr-term').textContent=SD.config.currentTerm||'Term 1';
  const isPrem=SD.config.plan==='premium';
  $('planBadge').textContent=isPrem?'PREMIUM ✨':'BASIC';
  $('planBadge').className='plan-badge '+(isPrem?'plan-premium':'plan-basic');
  SQ.ping(); // now schoolId is set — correct Online/Offline status
  renderBanner();go('revenue');

  // Background: push queued writes + pull fresh data silently
  setTimeout(()=>SQ.flush(),500);
  setTimeout(()=>SQ.silentPull(),2000);
});
