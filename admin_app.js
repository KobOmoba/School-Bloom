// ── Firebase ───────────────────────────────────────────────────────────────
const FB={apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",authDomain:"educationbloom-699ed.firebaseapp.com",projectId:"educationbloom-699ed",storageBucket:"educationbloom-699ed.firebasestorage.app",messagingSenderId:"33750392965",appId:"1:33750392965:web:2b3da887ede996ea8389ec"};
let db=null;
try{firebase.initializeApp(FB);db=firebase.firestore();}catch(e){console.warn('FB:',e);}

// ── State ──────────────────────────────────────────────────────────────────
let pendingUnsub=null;
let approvalData=null;

// ── Sync Queue ─────────────────────────────────────────────────────────────
const SQ={
  q:JSON.parse(localStorage.getItem('ad_sq')||'[]'),
  save(){localStorage.setItem('ad_sq',JSON.stringify(this.q));},
  push(op){this.q.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),op,tries:0});this.save();this.run();},
  ping(){
    const ok=navigator.onLine&&!!db;
    const el=document.getElementById('sync');
    if(el){el.className='sdot '+(ok?this.q.length?'sdot-sync':'sdot-on':'sdot-off');el.textContent=ok?this.q.length?'● Syncing':'● Online':'● Offline';}
    if(ok&&this.q.length)this.run();
  },
  async run(){
    if(!db||!navigator.onLine||!this.q.length)return;
    const items=[...this.q];
    for(const item of items){
      try{
        await this.exec(item.op);
        this.q=this.q.filter(x=>x.id!==item.id);
      } catch(e){
        console.error('SQ exec failed:',item.op?.t, e?.message||e);
        item.tries=(item.tries||0)+1;
        if(item.tries>3){
          console.warn('Dropping op after 3 retries:',item.op?.t);
          this.q=this.q.filter(x=>x.id!==item.id);
        }
      }
    }
    this.save();this.ping();
  },
  async exec(op){
    const t=op.t;
    if(t==='updateDeal')     await db.collection('admin_deals').doc(op.id).update(op.d);
    else if(t==='addSchoolRecord') await db.collection('admin_approved_schools').add(op.d);
    else if(t==='createSchool')    await db.collection('schools').doc(op.id).set(op.d,{merge:true});
    else if(t==='addLedger')       await db.collection('admin_ledger').add(op.d);
    else if(t==='updateCAC')       await db.collection('admin_cac').doc('progress').set(op.d,{merge:true});
    else if(t==='addAgent')        await db.collection('admin_agents').add(op.d);
    else if(t==='logActivity')     await db.collection('admin_activity').add(op.d);
    else if(t==='saveSettings')    await db.collection('admin_settings').doc('main').set(op.d,{merge:true});
    else if(t==='addOpp')          await db.collection('admin_opportunities').add(op.d);
    else if(t==='deleteOpp')       await db.collection('admin_opportunities').doc(op.id).delete();
    else if(t==='updateLedger')    await db.collection('admin_ledger').doc(op.id).update(op.d);
  }
};
window.addEventListener('online',()=>{SQ.ping();SQ.run();});
window.addEventListener('offline',()=>SQ.ping());
// Manual force-flush for debugging
window._flushSQ = ()=>SQ.run();;

// ── Helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const esc=s=>{if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;};
const fmt=n=>'₦'+Number(n||0).toLocaleString('en-NG');
const openM=id=>$(id).classList.add('on');
const closeM=id=>$(id).classList.remove('on');
window.onclick=e=>{if(e.target.classList.contains('modal'))e.target.classList.remove('on');};
document.onkeydown=e=>{if(e.key==='Escape')document.querySelectorAll('.modal').forEach(m=>m.classList.remove('on'));};
function genId(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='BLOOM-';for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)];return s;}

async function log(msg){
  const local=JSON.parse(localStorage.getItem('ad_act')||'[]');
  local.unshift({message:msg,timestamp:new Date().toISOString()});
  localStorage.setItem('ad_act',JSON.stringify(local.slice(0,60)));
  SQ.push({t:'logActivity',d:{message:msg,timestamp:new Date()}});
  renderActivity();
}

// ── Login ──────────────────────────────────────────────────────────────────
async function doLogin(){
  const pwd=$('l-pwd').value;
  const btn=$('l-btn');btn.textContent='Checking...';btn.disabled=true;
  let stored='aarinat2024';
  try{const doc=await db.collection('admin_settings').doc('main').get();if(doc.exists&&doc.data().adminPassword)stored=doc.data().adminPassword;}catch(e){}
  if(pwd!==stored){const e=$('l-err');e.textContent='Wrong password. Default is: aarinat2024';e.style.display='block';btn.textContent='🔓 Enter';btn.disabled=false;return;}
  localStorage.setItem('ad_auth','1');
  $('login-screen').style.display='none';
  $('main-app').style.display='block';
  SQ.ping();
  await initAdmin();
}

function logout(){if(!confirm('Logout?'))return;localStorage.removeItem('ad_auth');if(pendingUnsub)pendingUnsub();location.reload();}

// ── Navigation ─────────────────────────────────────────────────────────────
function go(tab){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));
  $(`sec-${tab}`).classList.add('on');
  const btn=document.querySelector(`[data-t="${tab}"]`);if(btn)btn.classList.add('on');
  if(tab==='dashboard') renderDashboard();
  if(tab==='approved')  renderApproved();
  if(tab==='agents')    renderAgents();
  if(tab==='ledger')    renderLedger();
  if(tab==='opps')      renderOpps();
  if(tab==='settings')  loadSettings();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function initAdmin(){
  // seed if empty
  try{
    const ag=await db.collection('admin_agents').get();
    if(ag.empty){
      await db.collection('admin_agents').add({name:'John Doe',phone:'2348012345678',commission:20,joinedAt:new Date()});
      await db.collection('admin_agents').add({name:'Grace Okonkwo',phone:'2348098765432',commission:20,joinedAt:new Date()});
    }
    const sd=await db.collection('admin_settings').doc('main').get();
    if(!sd.exists)await db.collection('admin_settings').doc('main').set({adminPassword:'aarinat2024',defaultSchoolPassword:'bloom2026',autoCAC:'full',whatsappTemplate:'*Welcome to Educational Bloom!* 🎉\n\nYour school has been activated.\n\n*School ID:* {{schoolId}}\n*Password:* {{password}}\n*Portal:* https://kobomoba.github.io/bloom-portal/\n\nLog in and start recovering your fees.\n– AariNAT Admin'});
    const cac=await db.collection('admin_cac').doc('progress').get();
    if(!cac.exists)await db.collection('admin_cac').doc('progress').set({raised:0});
    // demo pending deal
    const deals=await db.collection('admin_deals').get();
    if(deals.empty){
      await db.collection('admin_deals').add({timestamp:new Date(),status:'pending',agent:{id:'demo',name:'John Doe',phone:'2348012345678',commission:20},school:{name:'Demo Academy',phone:'2348011112222',email:'admin@demo.edu.ng',studentCount:75},tier:{name:'Small (51–100)',price:20000},terms:1,notes:'Demo deal — approve to test the full activation flow'});
    }
  }catch(e){console.warn('seed:',e);}
  await renderDashboard();
  startPendingListener();
  go('dashboard');
}

// ── Real-time pending listener ─────────────────────────────────────────────
function startPendingListener(){
  if(!db)return;
  if(pendingUnsub)pendingUnsub();
  pendingUnsub=db.collection('admin_deals').where('status','==','pending').onSnapshot(snap=>{
    const deals=snap.docs.map(d=>({id:d.id,...d.data()}));
    $('pending-badge').textContent=deals.length;
    $('d-pending').textContent=deals.length;
    renderPendingList(deals);
  },err=>console.warn('listener:',err));
}

function renderPendingList(deals){
  const c=$('pending-list');
  if(!deals.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">✅ No pending deals.</p>';return;}
  c.innerHTML=deals.map(d=>{
    const comm=Math.round((d.tier?.price||0)*((d.agent?.commission||20)/100)*(d.terms||1));
    return`<div class="deal pend">
      <span class="chip cp">PENDING</span>
      <div class="dn">${esc(d.school?.name)}</div>
      <div class="dm">Agent: ${esc(d.agent?.name)} · ${d.school?.studentCount||0} students</div>
      <div class="dm">📱 ${esc(d.school?.phone)}</div>
      <div class="dm" style="color:var(--text);font-weight:600;">${fmt(d.tier?.price)}/term · Your commission: ${fmt(comm)}</div>
      ${d.notes?`<div class="dm" style="font-style:italic;margin-top:4px;">"${esc(d.notes)}"</div>`:''}
      <div class="dact">
        <button class="btn-g btn-sm" onclick="openApproveModal('${d.id}')">✅ Approve</button>
        <button class="btn-d btn-sm" onclick="rejectDeal('${d.id}','${esc(d.school?.name)}')">❌ Reject</button>
      </div>
    </div>`;
  }).join('');
}

// ── Approve ────────────────────────────────────────────────────────────────
async function openApproveModal(dealId){
  let deal;
  try{const doc=await db.collection('admin_deals').doc(dealId).get();if(!doc.exists)return alert('Deal not found.');deal=doc.data();}
  catch(e){alert('Connection error.');return;}
  const sd=await db.collection('admin_settings').doc('main').get().catch(()=>null);
  const defPwd=sd?.exists?(sd.data().defaultSchoolPassword||'bloom2026'):'bloom2026';
  const schoolId=genId();
  $('ap-preview').innerHTML=`<div style="background:#080f1a;padding:0.75rem;border-radius:8px;font-size:0.85rem;">
    <div><b>School:</b> ${esc(deal.school?.name)}</div>
    <div><b>Phone:</b> ${esc(deal.school?.phone)}</div>
    <div><b>Students:</b> ${deal.school?.studentCount||0}</div>
    <div><b>Tier:</b> ${esc(deal.tier?.name)} · ${fmt(deal.tier?.price)}/term</div>
    <div><b>Agent:</b> ${esc(deal.agent?.name)}</div>
  </div>`;
  $('ap-id').textContent=schoolId;
  $('ap-pwd').textContent=defPwd;
  approvalData={id:dealId,deal,schoolId,password:defPwd};
  openM('approve-modal');
}

async function confirmApproval(){
  if(!approvalData)return;
  const{id,deal,schoolId,password}=approvalData;
  const commission=Math.round((deal.tier?.price||0)*((deal.agent?.commission||20)/100)*(deal.terms||1));

  // 1. Mark deal approved
  SQ.push({t:'updateDeal',id,d:{status:'approved',schoolId,approvedAt:new Date()}});
  // 2. Add to approved schools list
  SQ.push({t:'addSchoolRecord',d:{schoolId,schoolName:deal.school?.name,principalPhone:deal.school?.phone,principalEmail:deal.school?.email||'',password,tier:deal.tier?.name,tierPrice:deal.tier?.price,agentName:deal.agent?.name,agentPhone:deal.agent?.phone,approvedAt:new Date(),termsPaid:deal.terms||1}});
  // 3. Create actual school account — DIRECT write so portal login works immediately
  const schoolDoc = {
    config:{
      plan:'basic',fee:50000,
      schoolName:deal.school?.name||'',
      principalEmail:deal.school?.email||'',
      whatsapp:deal.school?.phone||'',
      studentCount:deal.school?.studentCount||0,
      tier:deal.tier?.name||'',
      tierPrice:deal.tier?.price||0,
      createdAt:new Date().toISOString(),
      trialStart:new Date().toISOString(),
      // Agent contact — surfaces in school portal Support tab
      agent:{
        name:deal.agent?.name||'',
        phone:deal.agent?.phone||'',
        agentId:deal.agent?.id||''
      }
    },
    staff:[{name:'Principal',email:deal.school?.email||(schoolId.toLowerCase()+'@bloom.edu.ng'),password,role:'Principal',phone:deal.school?.phone||''}],
    students:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},
    music:{practiceLogs:[],instruments:[]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]
  };
  try {
    await db.collection('schools').doc(schoolId).set(schoolDoc,{merge:true});
    console.log('✅ School created in Firestore:', schoolId);
  } catch(e) {
    console.warn('Direct write failed, queuing fallback:', e);
    SQ.push({t:'createSchool',id:schoolId,d:schoolDoc});
  }
  // 4. Commission ledger entry
  SQ.push({t:'addLedger',d:{dealId:id,schoolId,agent:deal.agent?.name,agentPhone:deal.agent?.phone,amount:commission,paid:false,date:new Date()}});
  // 5. CAC allocation
  try{
    const sd=await db.collection('admin_settings').doc('main').get();
    const autoCAC=sd.exists?(sd.data().autoCAC||'full'):'full';
    const cacDoc=await db.collection('admin_cac').doc('progress').get();
    let raised=cacDoc.exists?(cacDoc.data().raised||0):0;
    if(autoCAC==='full')raised+=commission;
    else if(autoCAC==='half')raised+=Math.round(commission/2);
    SQ.push({t:'updateCAC',d:{raised,updatedAt:new Date()}});
    updateCACDisplay(raised);
    // 6. WhatsApp credentials
    const tpl=sd.exists?(sd.data().whatsappTemplate||''):'';
    const msg=tpl.replace(/{{schoolId}}/g,schoolId).replace(/{{password}}/g,password);
    window.open(`https://wa.me/${(deal.school?.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
  }catch(e){console.warn('CAC/WA:',e);}

  await log(`✅ Approved: ${deal.school?.name} → ${schoolId} · ${fmt(commission)} commission`);
  closeM('approve-modal');
  approvalData=null;
  renderDashboard();
  renderApproved();
}

// Repair: re-creates the school Firestore document for already-approved schools
// Use this for schools approved before the direct-write fix
async function repairSchool(schoolId) {
  if(!schoolId) schoolId = prompt('Enter School ID to repair (e.g. BLOOM-CYW96U):');
  if(!schoolId) return;
  schoolId = schoolId.trim().toUpperCase();
  try {
    // Find the school record
    const snap = await db.collection('admin_approved_schools').where('schoolId','==',schoolId).get();
    if(snap.empty) { alert('School ID not found in approved schools list.'); return; }
    const s = snap.docs[0].data();
    const schoolDoc = {
      config:{plan:'basic',fee:50000,schoolName:s.schoolName||'',principalEmail:s.principalEmail||'',whatsapp:s.principalPhone||'',createdAt:new Date().toISOString()},
      staff:[{name:'Principal',email:s.principalEmail||(schoolId.toLowerCase()+'@bloom.edu.ng'),password:s.password,role:'Principal',phone:s.principalPhone||''}],
      students:[],expenses:[],attendance:{},sports:{teams:{},custom:[]},arts:{gallery:[]},
      music:{practiceLogs:[],instruments:[]},health:[],alumni:[],socialPages:[],commsLog:[],opportunities:[]
    };
    await db.collection('schools').doc(schoolId).set(schoolDoc,{merge:true});
    alert('✅ School account repaired!\n\nSchool ID: '+schoolId+'\nPassword: '+s.password+'\n\nThe school can now login to the portal.');
    log('🔧 Repaired school account: '+schoolId);
  } catch(e) {
    alert('Repair failed: '+(e.message||e)+'\n\nCheck your internet connection.');
  }
}

async function rejectDeal(dealId,schoolName){
  if(!confirm(`Reject deal for "${schoolName}"?`))return;
  SQ.push({t:'updateDeal',id:dealId,d:{status:'rejected',rejectedAt:new Date()}});
  await log(`❌ Rejected: ${schoolName}`);
  renderDashboard();
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard(){
  try{
    const[appr,agents,ledger,cac]=await Promise.all([
      db.collection('admin_approved_schools').get(),
      db.collection('admin_agents').get(),
      db.collection('admin_ledger').get(),
      db.collection('admin_cac').doc('progress').get()
    ]);
    $('d-approved').textContent=appr.size;
    $('d-agents').textContent=agents.size;
    let total=0;ledger.forEach(d=>total+=d.data().amount||0);
    $('d-commission').textContent=fmt(total);
    const raised=cac.exists?(cac.data().raised||0):0;
    updateCACDisplay(raised);
  }catch(e){console.warn('dashboard:',e);}
  renderActivity();
}

async function renderActivity(){
  const c=$('activity-feed');if(!c)return;
  let logs=[];
  try{logs=(await db.collection('admin_activity').orderBy('timestamp','desc').limit(10).get()).docs.map(d=>d.data());}
  catch(e){logs=JSON.parse(localStorage.getItem('ad_act')||'[]');}
  if(!logs.length){c.innerHTML='<em style="color:var(--sub);">No activity yet.</em>';return;}
  c.innerHTML=logs.map(l=>{
    const t=l.timestamp?.toDate?l.timestamp.toDate():new Date(l.timestamp);
    return`<div style="padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.82rem;"><span style="font-size:0.7rem;color:var(--sub);">${t.toLocaleString('en-NG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span><br>${esc(l.message)}</div>`;
  }).join('');
}

// ── CAC ────────────────────────────────────────────────────────────────────
function updateCACDisplay(raised){
  const pct=Math.min(100,Math.round((raised/250000)*100));
  $('cac-fill').style.width=pct+'%';
  $('cac-raised').textContent=fmt(raised);
  $('cac-left').textContent=fmt(Math.max(0,250000-raised));
}

async function addCAC(){
  const amt=parseFloat($('cac-amt').value);
  const note=$('cac-note').value.trim()||'Manual contribution';
  if(!amt||amt<=0)return alert('Enter a valid amount.');
  let raised=0;
  try{const doc=await db.collection('admin_cac').doc('progress').get();raised=doc.exists?(doc.data().raised||0):0;}catch(e){}
  raised+=amt;
  SQ.push({t:'updateCAC',d:{raised,updatedAt:new Date()}});
  $('cac-amt').value='';$('cac-note').value='';
  updateCACDisplay(raised);
  log(`💰 CAC +${fmt(amt)} — ${note}`);
}

// ── Approved ───────────────────────────────────────────────────────────────
async function renderApproved(){
  let schools=[];
  try{schools=(await db.collection('admin_approved_schools').get()).docs.map(d=>({_id:d.id,...d.data()}));}catch(e){}
  const q=($('search-approved')?.value||'').toLowerCase();
  if(q)schools=schools.filter(s=>(s.schoolName||'').toLowerCase().includes(q)||(s.schoolId||'').toLowerCase().includes(q));
  const c=$('approved-list');
  if(!schools.length){c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No approved schools.</p>';return;}
  c.innerHTML=schools.map(s=>`<div class="deal appr">
    <span class="chip ca">ACTIVE</span>
    <div class="dn">${esc(s.schoolName)}</div>
    <div class="dm">ID: <span style="font-family:'JetBrains Mono',monospace;color:#60a5fa;">${s.schoolId}</span> · ${esc(s.tier)}</div>
    <div class="dm">📱 ${esc(s.principalPhone)} · Agent: ${esc(s.agentName)}</div>
    <div class="dm" style="color:var(--text);">🔑 ${esc(s.password)}</div>
    <div class="dact">
      <button class="btn-w btn-sm" onclick="resend('${s.schoolId}')">📤 Resend</button>
      <button class="btn-ghost btn-sm" style="color:white;" onclick="copyC('${s.schoolId}')">📋 Copy</button>
    </div>
  </div>`).join('');
}

async function resend(schoolId){
  try{
    const snap=await db.collection('admin_approved_schools').where('schoolId','==',schoolId).get();
    if(snap.empty)return alert('Not found.');
    const s=snap.docs[0].data();
    const sd=await db.collection('admin_settings').doc('main').get().catch(()=>null);
    const tpl=sd?.exists?(sd.data().whatsappTemplate||''):'School ID: {{schoolId}}\nPassword: {{password}}';
    const msg=tpl.replace(/{{schoolId}}/g,schoolId).replace(/{{password}}/g,s.password);
    window.open(`https://wa.me/${(s.principalPhone||'').replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
  }catch(e){alert('Failed.');}
}

async function copyC(schoolId){
  try{
    const snap=await db.collection('admin_approved_schools').where('schoolId','==',schoolId).get();
    if(snap.empty)return;
    const s=snap.docs[0].data();
    const txt=`School ID: ${s.schoolId}\nPassword: ${s.password}\nPortal: https://kobomoba.github.io/bloom-portal/`;
    navigator.clipboard.writeText(txt).then(()=>alert('✅ Copied!')).catch(()=>prompt('Copy:',txt));
  }catch(e){}
}

// ── Agents ─────────────────────────────────────────────────────────────────
// Local cache so the list renders instantly without waiting for Firestore
let _agentsCache = JSON.parse(localStorage.getItem('ad_agents_cache')||'[]');

function saveAgentsCache(agents){
  _agentsCache = agents;
  localStorage.setItem('ad_agents_cache', JSON.stringify(agents));
}

function renderAgentsFromData(agents, ledger, deals){
  const c=$('agents-list');
  c.innerHTML=agents.length===0
    ?'<p style="text-align:center;color:var(--sub);padding:2rem;">No agents registered. Add your first agent above.</p>'
    :agents.map(a=>{
      const earned=ledger.filter(l=>l.agent===a.name).reduce((s,l)=>s+(l.amount||0),0);
      const paid=ledger.filter(l=>l.agent===a.name&&l.paid).reduce((s,l)=>s+(l.amount||0),0);
      return`<div class="deal" style="border-left:3px solid var(--brand);">
        <div class="dn">${esc(a.name)}</div>
        <div class="dm">📱 ${a.phone} · Commission rate: ${a.commission||20}%</div>
        <div class="dm" style="color:var(--text);">Earned: ${fmt(earned)} · Paid out: ${fmt(paid)}</div>
      </div>`;
    }).join('');
  $('agent-perf-body').innerHTML=agents.map(a=>{
    const d=deals.filter(x=>x.agent?.name===a.name).length;
    const comm=ledger.filter(l=>l.agent===a.name).reduce((s,l)=>s+(l.amount||0),0);
    return`<tr>
      <td>${esc(a.name)}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${a.phone}</td>
      <td>${d}</td>
      <td style="color:var(--money);font-weight:700;">${fmt(comm)}</td>
      <td><span class="chip ca" style="position:static;">Active</span></td>
    </tr>`;
  }).join('');
}

async function renderAgents(){
  // Render cached data immediately so UI is never blank
  if(_agentsCache.length) renderAgentsFromData(_agentsCache, [], []);

  // Then fetch fresh data from Firestore in background
  let agents=[],ledger=[],deals=[];
  try{
    agents=(await db.collection('admin_agents').get()).docs.map(d=>({id:d.id,...d.data()}));
    ledger=(await db.collection('admin_ledger').get()).docs.map(d=>d.data());
    deals=(await db.collection('admin_deals').get()).docs.map(d=>d.data());
    saveAgentsCache(agents);
    renderAgentsFromData(agents, ledger, deals);
  }catch(e){ console.warn('renderAgents Firestore failed, showing cache'); }
}

function normalizePhone(raw){
  let p = raw.trim().replace(/\D/g,'');
  if(p.startsWith('0') && p.length === 11) return '234' + p.slice(1);
  if(p.startsWith('234') && p.length === 13) return p;
  if(p.length === 10) return '234' + p;
  return p;
}

async function saveAgent(){
  const name=$('ag-name').value.trim();
  const phone=normalizePhone($('ag-phone').value);
  const rate=parseFloat($('ag-rate').value)||20;
  if(!name||!phone||phone.length<10)return alert('Name and valid phone required (e.g. 08012345678 or 2348012345678).');

  const btn=$('add-agent-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  const agentData={name,phone,commission:rate,joinedAt:new Date()};

  // Write directly to Firestore when online — do NOT go through queue
  // The queue causes a race condition: renderAgents() reads Firestore before
  // the queue has flushed, so the new agent never appears.
  let saved=false;
  if(db&&navigator.onLine){
    try{
      const docRef=await db.collection('admin_agents').add(agentData);
      // Update local cache immediately with the new Firestore doc id
      const updatedCache=[..._agentsCache,{id:docRef.id,...agentData}];
      saveAgentsCache(updatedCache);
      saved=true;
    }catch(e){ console.warn('Direct write failed, falling back to queue:', e); }
  }

  // Fallback to queue if offline or direct write failed
  if(!saved){
    SQ.push({t:'addAgent',d:agentData});
    // Still update local cache so it shows in the list immediately
    const updatedCache=[..._agentsCache,{id:'pending_'+Date.now(),...agentData}];
    saveAgentsCache(updatedCache);
  }

  closeM('add-agent-modal');
  $('ag-name').value='';$('ag-phone').value='';$('ag-rate').value='20';
  if(btn){btn.textContent='💾 Add Agent';btn.disabled=false;}

  // Render from updated cache immediately — no Firestore wait
  renderAgentsFromData(_agentsCache,[],[]);

  // Then refresh fully from Firestore in background to get accurate earnings
  renderAgents();
  renderDashboard();
  log(`👤 Added agent: ${name} (${phone})`);
}

// ── Ledger ─────────────────────────────────────────────────────────────────
async function renderLedger(){
  let entries=[];
  try{entries=(await db.collection('admin_ledger').orderBy('date','desc').get()).docs.map(d=>({_id:d.id,...d.data()}));}catch(e){}
  $('ledger-body').innerHTML=entries.length===0?'<tr><td colspan="6" style="text-align:center;color:var(--sub);padding:2rem;">No entries yet.</td></tr>':entries.map(e=>{
    const dt=e.date?.toDate?e.date.toDate():new Date();
    return`<tr>
      <td style="font-size:0.75rem;">${dt.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'2-digit'})}</td>
      <td>${esc(e.agent)}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;">${e.schoolId||'—'}</td>
      <td style="color:var(--money);font-weight:700;">${fmt(e.amount)}</td>
      <td><span class="chip ${e.paid?'ca':'cp'}" style="position:static;">${e.paid?'Paid':'Pending'}</span></td>
      <td>${e.paid?'<span style="font-size:0.72rem;color:var(--sub);">Done</span>':`<button class="btn-g btn-sm" onclick="markPaid('${e._id}','${esc(e.agent)}',${e.amount||0})">✅ Pay</button>`}</td>
    </tr>`;
  }).join('');
}

async function markPaid(id,agent,amount){
  if(!confirm(`Mark ${fmt(amount)} to ${agent} as paid?`))return;
  SQ.push({t:'updateLedger',id,d:{paid:true,paidAt:new Date()}});
  log(`💸 Commission paid: ${fmt(amount)} → ${agent}`);
  await new Promise(r=>setTimeout(r,600));
  renderLedger();
}

function exportLedger(){
  db.collection('admin_ledger').orderBy('date','desc').get().then(snap=>{
    const rows=snap.docs.map(d=>d.data());
    if(!rows.length)return alert('No data.');
    const csv=[['Date','Agent','School','Amount','Status'],...rows.map(r=>{const dt=r.date?.toDate?r.date.toDate():new Date();return[dt.toLocaleDateString('en-NG'),r.agent,r.schoolId,r.amount,r.paid?'Paid':'Pending'];})].map(r=>r.join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`ledger-${new Date().toISOString().split('T')[0]}.csv`;a.click();
    log('📥 Ledger exported');
  }).catch(()=>alert('Export failed.'));
}

// ── Opportunities ──────────────────────────────────────────────────────────
async function renderOpps(){
  let opps=[];
  try{opps=(await db.collection('admin_opportunities').get()).docs.map(d=>({id:d.id,...d.data()}));}catch(e){}
  $('opp-body').innerHTML=opps.length===0?'<tr><td colspan="5" style="text-align:center;color:var(--sub);padding:2rem;">No opportunities added yet.</td></tr>':opps.map(o=>`<tr>
    <td>${esc(o.title)}</td><td>${esc(o.provider)}</td>
    <td><span class="chip ca" style="position:static;">${o.type}</span></td>
    <td style="font-size:0.75rem;">${o.deadline||'—'}</td>
    <td><button class="btn-d btn-sm" onclick="deleteOpp('${o.id}')">🗑️</button></td>
  </tr>`).join('');
}

async function saveOpp(){
  const title=$('opp-title').value.trim();
  const provider=$('opp-provider').value.trim();
  const deadline=$('opp-deadline').value;
  if(!title||!provider||!deadline)return alert('Title, provider and deadline required.');
  SQ.push({t:'addOpp',d:{title,provider,type:$('opp-type').value,amount:$('opp-amount').value,deadline,eligibility:$('opp-elig').value,url:$('opp-url').value,createdAt:new Date()}});
  closeM('add-opp-modal');
  ['opp-title','opp-provider','opp-amount','opp-url','opp-elig'].forEach(id=>$(id).value='');
  $('opp-deadline').value='';
  await new Promise(r=>setTimeout(r,500));
  renderOpps();
  log(`🔍 Added opportunity: ${title}`);
}

async function deleteOpp(id){
  if(!confirm('Delete?'))return;
  SQ.push({t:'deleteOpp',id});
  await new Promise(r=>setTimeout(r,400));
  renderOpps();
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings(){
  try{
    const doc=await db.collection('admin_settings').doc('main').get();
    if(doc.exists){
      const d=doc.data();
      $('s-adminpwd').value=d.adminPassword||'';
      $('s-schoolpwd').value=d.defaultSchoolPassword||'bloom2026';
      $('s-cac').value=d.autoCAC||'full';
      if(d.whatsappTemplate)$('s-tpl').value=d.whatsappTemplate;
    }
  }catch(e){}
}

async function saveSettings(){
  const pwd=$('s-adminpwd').value.trim();
  if(pwd&&pwd.length<4)return alert('Admin password must be at least 4 characters.');
  SQ.push({t:'saveSettings',d:{...(pwd?{adminPassword:pwd}:{}),defaultSchoolPassword:$('s-schoolpwd').value,autoCAC:$('s-cac').value,whatsappTemplate:$('s-tpl').value,updatedAt:new Date()}});
  alert('✅ Settings saved!');
  log('⚙️ Settings updated');
}

async function exportAll(){
  try{
    const[agents,deals,schools,ledger,opps,cac]=await Promise.all([
      db.collection('admin_agents').get().then(s=>s.docs.map(d=>d.data())),
      db.collection('admin_deals').get().then(s=>s.docs.map(d=>d.data())),
      db.collection('admin_approved_schools').get().then(s=>s.docs.map(d=>d.data())),
      db.collection('admin_ledger').get().then(s=>s.docs.map(d=>d.data())),
      db.collection('admin_opportunities').get().then(s=>s.docs.map(d=>d.data())),
      db.collection('admin_cac').doc('progress').get().then(d=>d.data())
    ]);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify({agents,deals,schools,ledger,opps,cac,at:new Date()},null,2)],{type:'application/json'}));
    a.download=`aarinat-backup-${new Date().toISOString().split('T')[0]}.json`;a.click();
    log('📥 Full backup exported');
  }catch(e){alert('Export failed. Check connection.');}
}

async function clearAll(){
  if(!confirm('Delete ALL data?'))return;
  if(prompt('Type DELETE to confirm:')!=='DELETE')return alert('Cancelled.');
  for(const col of['admin_agents','admin_deals','admin_approved_schools','admin_ledger','admin_opportunities','admin_activity']){
    const s=await db.collection(col).get();const b=db.batch();s.docs.forEach(d=>b.delete(d.ref));await b.commit();
  }
  await db.collection('admin_settings').doc('main').delete().catch(()=>{});
  await db.collection('admin_cac').doc('progress').delete().catch(()=>{});
  localStorage.removeItem('ad_sq');localStorage.removeItem('ad_act');
  alert('Cleared.');location.reload();
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  SQ.ping();
  if(localStorage.getItem('ad_auth')==='1'){
    $('login-screen').style.display='none';
    $('main-app').style.display='block';
    initAdmin();
  }
});
