import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { FIREBASE_CONFIG, ADMIN_UID, DEFAULT_SETTINGS } from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'asia-south1');
const factoryResetCallable = httpsCallable(functions, 'factoryResetNonAdminData');
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
let currentUser = null;
let plans = [];
let users = [];
let memberships = new Map();
let keys = [];
let payments = [];
let currentAdmin = null;

function readyConfig() {
  return !Object.values(FIREBASE_CONFIG).some(v => String(v).startsWith('PASTE_')) && !String(ADMIN_UID).startsWith('PASTE_');
}
function esc(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(message, type='') { const el=$('toast'); el.textContent=message; el.className=`toast show ${type}`; clearTimeout(toast._t); toast._t=setTimeout(()=>el.className='toast',2800); }
function formatDate(value) { if(!value) return '—'; const d=new Date(value); return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function toLocalInput(value) { if(!value) return ''; const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function fromLocalInput(value) { return value ? new Date(value).toISOString() : null; }
function slug(value) { return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48); }
function randomPart(len=4) { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes=new Uint8Array(len); crypto.getRandomValues(bytes); return [...bytes].map(b=>chars[b%chars.length]).join(''); }
function newKey() { return `MEESHO-${randomPart(4)}-${randomPart(4)}-${randomPart(4)}`; }

function showApp(show) { $('login-screen').classList.toggle('hidden', show); $('app').classList.toggle('hidden', !show); }
function setLoginError(msg='') { $('login-error').textContent=msg; }
function setSection(section) {
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active', b.dataset.section===section));
  document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active', s.id===`section-${section}`));
  $('section-title').textContent = ({dashboard:'Dashboard',plans:'Membership Plans',users:'Users & Membership',keys:'Activation Keys',payments:'Payments',settings:'Settings'})[section] || 'Dashboard';
  if(section==='plans') renderPlans();
  if(section==='users') renderUsers();
  if(section==='keys') { renderKeySelectors(); renderKeys(); }
  if(section==='payments') { renderPlanSelectors(); renderPayments(); }
}

async function login() {
  if(!readyConfig()) { setLoginError('Firebase config is not filled. Update admin/firebase-config.js first.'); return; }
  setLoginError('Opening Google…');
  try { await signInWithPopup(auth, provider); } catch(e) { setLoginError(e?.message || 'Google login failed.'); }
}

async function initializeDatabase() {
  if(!currentUser || currentUser.uid !== ADMIN_UID || !currentAdmin) {
    throw new Error('Only the configured Firebase Admin UID can initialize the database.');
  }
  const now = new Date().toISOString();

  await setDoc(doc(db,'admins',ADMIN_UID), {
    uid:ADMIN_UID,
    email:currentUser.email||'',
    name:currentUser.displayName||'',
    role:'owner',
    updatedAt:now
  }, {merge:true});

  // Create default plans only when absent. Existing plan prices and settings are never overwritten.
  const defaults = [
    ['monthly',{name:'Monthly',active:true,price:399,offerPrice:299,durationDays:30,shippingEnabled:true,autofillEnabled:true,description:'Full access for 30 days.',createdAt:now,updatedAt:now}],
    ['yearly',{name:'Yearly',active:true,price:2999,offerPrice:1999,durationDays:365,shippingEnabled:true,autofillEnabled:true,description:'Full access for 365 days.',createdAt:now,updatedAt:now}],
    ['lifetime',{name:'Lifetime',active:true,price:5999,offerPrice:4999,durationDays:0,shippingEnabled:true,autofillEnabled:true,description:'Lifetime access with no expiry.',createdAt:now,updatedAt:now}]
  ];
  for(const [id,data] of defaults) {
    const ref = doc(db,'plans',id);
    const snap = await getDoc(ref);
    if(!snap.exists()) await setDoc(ref,data,{merge:false});
  }

  const settingsRef = doc(db,'settings','general');
  const settingsSnap = await getDoc(settingsRef);
  if(!settingsSnap.exists()) await setDoc(settingsRef,{...DEFAULT_SETTINGS,createdAt:now,updatedAt:now},{merge:false});

  const collectionSeeds = [
    ['users','_meta',{type:'collection-meta',label:'Users',description:'Google-authenticated extension users',createdAt:now,updatedAt:now}],
    ['memberships','_meta',{type:'collection-meta',label:'Memberships',description:'User memberships and expiry dates',createdAt:now,updatedAt:now}],
    ['productMemberships','_meta',{type:'collection-meta',label:'Product Memberships',description:'Separate Meesho and Flipkart entitlements',createdAt:now,updatedAt:now}],
    ['plans','_meta',{type:'collection-meta',label:'Plans',description:'Individual and combined plans',createdAt:now,updatedAt:now}],
    ['activationKeys','_meta',{type:'collection-meta',label:'Activation Keys',description:'Admin-generated one-time activation keys',createdAt:now,updatedAt:now}],
    ['devices','_meta',{type:'collection-meta',label:'Devices',description:'Legacy metadata only; device limits are not enforced',createdAt:now,updatedAt:now}],
    ['payments','_meta',{type:'collection-meta',label:'Payments',description:'UPI/manual payment records',createdAt:now,updatedAt:now}],
    ['logs','_meta',{type:'collection-meta',label:'Logs',description:'Admin activity and system audit logs',createdAt:now,updatedAt:now}],
    ['settings','_meta',{type:'collection-meta',label:'Settings',description:'Support, tutorial and master download links',createdAt:now,updatedAt:now}],
    ['combinedPlans','_meta',{type:'collection-meta',label:'Combined Plans',description:'Plan bundles including Meesho and Flipkart',createdAt:now,updatedAt:now}]
  ];
  for(const [name,id,data] of collectionSeeds) {
    const ref = doc(db,name,id);
    const snap = await getDoc(ref);
    if(!snap.exists()) await setDoc(ref,data,{merge:false});
  }

  await setDoc(doc(db,'system','collections'),{
    users:true, plans:true, memberships:true, productMemberships:true,
    activationKeys:true, devices:true, payments:true, settings:true,
    combinedPlans:true, logs:true, admins:true,
    initializedAt:now, initializedBy:currentUser.uid
  },{merge:true});

  await setDoc(doc(db,'system','meta'),{
    name:'MEESHO A+ LISTING AUTOMATION PRO',
    version:'3.16.0',
    model:'SHARED_ADMIN_PRODUCT_MEMBERSHIPS',
    initializedAt:now, initializedBy:currentUser.uid,
    database:'FIRESTORE', collectionsReady:true
  },{merge:true});

  toast('Firebase integration completed. Missing collections and defaults were created; existing prices and settings were preserved.','success');
  await loadAll();
}

async function loadPlans() { const snap=await getDocs(collection(db,'plans')); plans=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.id).localeCompare(String(b.id))); }
async function loadUsers() { const [u,m]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'memberships'))]); users=u.docs.filter(d=>d.id!=='_meta').map(d=>({uid:d.id,...d.data()})); memberships=new Map(m.docs.map(d=>[d.id,{uid:d.id,...d.data()}])); }
async function loadKeys() { const snap=await getDocs(collection(db,'activationKeys')); keys=snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); }
async function loadPayments() { const snap=await getDocs(collection(db,'payments')); payments=snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); }
async function loadSettings() { const s=await getDoc(doc(db,'settings','general')); const d=s.exists()?s.data():DEFAULT_SETTINGS; $('set-brand').value=d.brandName||''; $('set-support').value=d.supportName||''; $('set-phone').value=d.phone||''; $('set-whatsapp').value=d.whatsapp||''; $('set-email').value=d.email||''; $('set-upi').value=d.upiId||''; $('set-qr').value=d.qrUrl||''; $('set-maintenance').checked=Boolean(d.maintenanceMode); }
async function loadAll() { await Promise.all([loadPlans(),loadUsers(),loadKeys(),loadPayments(),loadSettings()]); updateStats(); renderPlans(); renderUsers(); renderKeySelectors(); renderKeys(); renderPlanSelectors(); renderPayments(); }

function updateStats() {
  const active=[...memberships.values()].filter(m=>String(m.status).toUpperCase()==='ACTIVE' && (Number(m.durationDays||0)===0 || !m.expiryDate || new Date(m.expiryDate).getTime()>Date.now())).length;
  const expired=[...memberships.values()].filter(m=>String(m.status).toUpperCase()==='EXPIRED' || (m.expiryDate && new Date(m.expiryDate).getTime()<=Date.now())).length;
  const avail=keys.filter(k=>String(k.status||'').toUpperCase()==='AVAILABLE').length;
  $('stat-users').textContent=users.length; $('stat-active').textContent=active; $('stat-plans').textContent=plans.length; $('stat-keys').textContent=avail; $('stat-payments').textContent=payments.length; $('stat-expired').textContent=expired;
}

function renderPlans() {
  const box=$('plans-list');
  box.innerHTML=plans.length?plans.map(p=>`<article class="plan-box"><div style="display:flex;justify-content:space-between;gap:8px"><div><div class="eyebrow">${esc(p.id)}</div><div class="plan-title">${esc(p.name||p.id)}</div><div class="plan-meta">${Number(p.durationDays||0)===0?'Lifetime':`${Number(p.durationDays||0)} days`} · ${Number(p.deviceLimit||3)} devices</div></div><span class="pill ${p.active?'ok':''}">${p.active?'ACTIVE':'INACTIVE'}</span></div><div class="plan-price">₹${Number(p.offerPrice||p.price||0).toLocaleString('en-IN')}</div><div class="plan-meta">Base ₹${Number(p.price||0).toLocaleString('en-IN')} · Autofill ✓ · Shipping ✓</div><div class="plan-actions"><button class="secondary" data-edit-plan="${esc(p.id)}">Edit</button><button class="ghost" data-delete-plan="${esc(p.id)}">Delete</button></div></article>`).join(''):'<div class="plan-empty">No plans yet. Click Initialize DB or create a plan.</div>';
}

function openPlanEditor(plan=null) {
  $('plan-editor').classList.remove('hidden');
  $('plan-editor-title').textContent=plan?'Edit Plan':'New Plan';
  $('plan-id').value=plan?.id||''; $('plan-id').disabled=Boolean(plan); $('plan-name').value=plan?.name||''; $('plan-price').value=plan?.price??''; $('plan-offer').value=plan?.offerPrice??''; $('plan-days').value=plan?.durationDays??30; $('plan-devices').value=plan?.deviceLimit??3; $('plan-description').value=plan?.description||''; $('plan-active').checked=plan?.active!==false;
  $('plan-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function closePlanEditor(){ $('plan-editor').classList.add('hidden'); }

async function savePlan(e){
  e.preventDefault();
  const id=slug($('plan-id').value); if(!id) return toast('Plan ID is required.','error');
  const now=new Date().toISOString();
  const data={name:$('plan-name').value.trim()||id,price:Number($('plan-price').value||0),offerPrice:Number($('plan-offer').value||0),durationDays:Number($('plan-days').value||0),deviceLimit:Math.max(1,Number($('plan-devices').value||3)),description:$('plan-description').value.trim(),active:$('plan-active').checked,autofillEnabled:true,shippingEnabled:true,updatedAt:now};
  await setDoc(doc(db,'plans',id),data,{merge:true}); toast('Plan saved.','success'); closePlanEditor(); await loadAll(); setSection('plans');
}

function renderUsers(){
  const q=String($('user-search').value||'').toLowerCase().trim();
  const rows=users.filter(u=>`${u.name||''} ${u.email||''} ${u.uid||''}`.toLowerCase().includes(q)).sort((a,b)=>String(a.email||'').localeCompare(String(b.email||'')));
  $('users-table').innerHTML=rows.map(u=>{const m=memberships.get(u.uid)||{}; const status=String(m.status||'NOT_ACTIVATED').toLowerCase(); const active=status==='active'&&(!m.expiryDate||new Date(m.expiryDate).getTime()>Date.now()||Number(m.durationDays||0)===0); return `<tr><td><b>${esc(u.name||'Google User')}</b><br><span style="color:#6f86a4">${esc(u.email||u.uid)}</span></td><td>${esc(m.planName||m.planId||'—')}</td><td><span class="status ${active?'active':status}">${active?'ACTIVE':esc(status.toUpperCase())}</span></td><td>${Number(m.durationDays||0)===0&&m.planId?'Lifetime':formatDate(m.expiryDate)}</td><td><div class="row-actions"><button class="secondary" data-edit-member="${esc(u.uid)}">Manage</button></div></td></tr>`}).join('') || '<tr><td colspan="5">No users found.</td></tr>';
}

function renderPlanSelectors(){
  const options=plans.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`).join('');
  ['membership-plan','payment-plan'].forEach(id=>{const s=$(id); if(s)s.innerHTML=options||'<option value="">No plans</option>';});
}
function renderKeySelectors(){ const s=$('key-plan'); if(s) s.innerHTML=plans.filter(p=>p.active!==false).map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`).join('')||'<option value="">No active plans</option>'; }

function openMembershipEditor(uid){
  const u=users.find(x=>x.uid===uid); if(!u) return;
  const m=memberships.get(uid)||{}; $('membership-editor').classList.remove('hidden'); $('membership-uid').value=uid; $('membership-target').textContent=`${u.name||'Google User'} · ${u.email||uid}`; $('membership-plan').value=m.planId||plans[0]?.id||''; $('membership-status').value=String(m.status||'ACTIVE').toUpperCase(); $('membership-start').value=toLocalInput(m.startDate||new Date().toISOString()); $('membership-expiry').value=toLocalInput(m.expiryDate); const p=plans.find(x=>x.id===(m.planId||plans[0]?.id)); $('membership-devices').value=m.deviceLimit||p?.deviceLimit||3; $('membership-shipping').checked=true; $('membership-editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeMembershipEditor(){ $('membership-editor').classList.add('hidden'); }

async function saveMembership(e){
  e.preventDefault(); const uid=$('membership-uid').value; const u=users.find(x=>x.uid===uid); const pid=$('membership-plan').value; const p=plans.find(x=>x.id===pid); if(!uid||!u||!p) return toast('Select a valid user and plan.','error');
  const now=new Date().toISOString(); const days=Number(p.durationDays||0); const expiry=days===0?null:($('membership-expiry').value?fromLocalInput($('membership-expiry').value):new Date(Date.now()+days*86400000).toISOString());
  const status=$('membership-status').value; const data={uid,email:u.email||'',planId:pid,planName:p.name||pid,status,durationDays:days,deviceLimit:Math.max(1,Number($('membership-devices').value||p.deviceLimit||3)),shippingEnabled:true,autofillEnabled:true,startDate:fromLocalInput($('membership-start').value)||now,expiryDate:expiry,source:'ADMIN_PANEL',updatedAt:now,activatedAt:status==='ACTIVE'?now:(memberships.get(uid)?.activatedAt||null),activationKey:memberships.get(uid)?.activationKey||'ADMIN_PANEL'};
  await setDoc(doc(db,'memberships',uid),data,{merge:true});
  await setDoc(doc(db,'users',uid),{lastMembershipPlan:pid,membershipStatus:status,membershipUpdatedAt:now},{merge:true});
  toast('Membership saved.','success'); closeMembershipEditor(); await loadAll(); setSection('users');
}

function renderKeys(){
  $('keys-list').innerHTML=keys.slice(0,200).map(k=>`<div class="key-item"><div class="key-code">${esc(k.id)}</div><span>${esc(k.planName||k.planId||'—')}</span><span>${esc(k.status||'—')}<br>${esc(k.assignedEmail||'Any email')}</span><div class="row-actions"><button class="secondary" data-copy-key="${esc(k.id)}">Copy</button><button class="ghost" data-delete-key="${esc(k.id)}">Delete</button></div></div>`).join('') || '<div class="plan-empty">No activation keys yet.</div>';
}

async function generateKeys(e){
  e.preventDefault(); const pid=$('key-plan').value; const p=plans.find(x=>x.id===pid); const count=Math.min(100,Math.max(1,Number($('key-count').value||1))); const email=$('key-email').value.trim().toLowerCase(); if(!p) return toast('Choose a plan.','error');
  const now=new Date(); const start=now.toISOString(); const expiry=Number(p.durationDays||0)===0?null:new Date(now.getTime()+Number(p.durationDays)*86400000).toISOString();
  for(let i=0;i<count;i++){let id=newKey(); while(keys.some(k=>k.id===id)) id=newKey(); await setDoc(doc(db,'activationKeys',id),{code:id,status:'AVAILABLE',planId:pid,planName:p.name||pid,durationDays:Number(p.durationDays||0),deviceLimit:Number(p.deviceLimit||3),shippingEnabled:true,autofillEnabled:true,assignedEmail:email,startDate:start,expiryDate:expiry,createdAt:start,createdBy:currentUser.uid},{merge:false});}
  $('key-count').value=1; toast(`${count} activation key${count>1?'s':''} generated.`,'success'); await loadAll(); setSection('keys');
}

function renderPayments(){ $('payments-table').innerHTML=payments.slice(0,200).map(p=>`<tr><td>${formatDate(p.createdAt)}</td><td>${esc(p.email||p.uid||'—')}</td><td>${esc(p.planName||p.planId||'—')}</td><td>₹${Number(p.amount||0).toLocaleString('en-IN')}</td><td><span class="status ${String(p.status||'').toLowerCase()}">${esc(p.status||'—')}</span></td></tr>`).join('')||'<tr><td colspan="5">No payment records yet.</td></tr>'; }
async function savePayment(e){
  e.preventDefault(); const pid=$('payment-plan').value; const p=plans.find(x=>x.id===pid); const ref=doc(collection(db,'payments')); const now=new Date().toISOString(); const data={uid:$('payment-uid').value.trim(),email:$('payment-email').value.trim().toLowerCase(),planId:pid,planName:p?.name||pid,amount:Number($('payment-amount').value||0),transactionId:$('payment-txn').value.trim(),status:$('payment-status').value,createdAt:now,createdBy:currentUser.uid}; await setDoc(ref,data); toast('Payment saved.','success'); $('payment-form').reset(); await loadAll(); setSection('payments');
}
async function saveSettings(e){ e.preventDefault(); await setDoc(doc(db,'settings','general'),{brandName:$('set-brand').value.trim(),supportName:$('set-support').value.trim(),phone:$('set-phone').value.trim(),whatsapp:$('set-whatsapp').value.trim(),email:$('set-email').value.trim(),upiId:$('set-upi').value.trim(),qrUrl:$('set-qr').value.trim(),maintenanceMode:$('set-maintenance').checked,updatedAt:new Date().toISOString()},{merge:true}); toast('Settings saved.','success'); }

$('google-login').addEventListener('click',login);
$('logout').addEventListener('click',()=>signOut(auth));
$('initialize-db').addEventListener('click',()=>initializeDatabase().catch(e=>toast(e?.message||'Initialization failed.','error')));
$('factory-reset-confirm').addEventListener('input',e=>{
  $('factory-reset-button').disabled = e.target.value.trim() !== 'RESET ALL NON-ADMIN DATA';
});
$('factory-reset-button').addEventListener('click',async()=>{
  if(!currentUser || currentUser.uid !== ADMIN_UID || !currentAdmin) return toast('Admin access required.','error');
  const confirmation = $('factory-reset-confirm').value.trim();
  if(confirmation !== 'RESET ALL NON-ADMIN DATA') return toast('Type the exact confirmation phrase first.','error');
  const ok = confirm('Factory reset will back up Firestore data and Auth user metadata, then delete all Firestore documents and Firebase Auth users except the configured Admin UID. Continue?');
  if(!ok) return;
  const button = $('factory-reset-button');
  button.disabled = true;
  try {
    toast('Factory reset started. Creating backup first…');
    const result = await factoryResetCallable({confirmText:confirmation});
    const backupPath = result?.data?.backupPath || 'Cloud Storage backup created';
    $('factory-reset-confirm').value = '';
    toast('Reset complete. Admin UID preserved. Next click Initialize DB to rebuild collections. Backup: '+backupPath,'success');
    await loadAll().catch(()=>{});
  } catch(e) {
    toast(e?.message || 'Factory reset failed. No reset success was reported.','error');
  } finally {
    button.disabled = $('factory-reset-confirm').value.trim() !== 'RESET ALL NON-ADMIN DATA';
  }
});
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>setSection(b.dataset.section)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>setSection(b.dataset.goto)));
$('new-plan').addEventListener('click',()=>openPlanEditor()); $('cancel-plan').addEventListener('click',closePlanEditor); $('plan-form').addEventListener('submit',e=>savePlan(e).catch(err=>toast(err?.message||'Could not save plan.','error')));
$('cancel-membership').addEventListener('click',closeMembershipEditor); $('membership-form').addEventListener('submit',e=>saveMembership(e).catch(err=>toast(err?.message||'Could not save membership.','error')));
$('key-form').addEventListener('submit',e=>generateKeys(e).catch(err=>toast(err?.message||'Could not generate key.','error'))); $('refresh-keys').addEventListener('click',()=>loadAll().catch(err=>toast(err?.message||'Refresh failed.','error')));
$('payment-form').addEventListener('submit',e=>savePayment(e).catch(err=>toast(err?.message||'Could not save payment.','error'))); $('refresh-payments').addEventListener('click',()=>loadAll().catch(err=>toast(err?.message||'Refresh failed.','error'))); $('settings-form').addEventListener('submit',e=>saveSettings(e).catch(err=>toast(err?.message||'Could not save settings.','error')));
$('user-search').addEventListener('input',renderUsers);
$('plans-list').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-plan]'); const del=e.target.closest('[data-delete-plan]'); if(edit){openPlanEditor(plans.find(p=>p.id===edit.dataset.editPlan));} if(del){if(!confirm(`Delete plan ${del.dataset.deletePlan}?`))return; await deleteDoc(doc(db,'plans',del.dataset.deletePlan)); toast('Plan deleted.','success'); await loadAll();}});
$('users-table').addEventListener('click',e=>{const b=e.target.closest('[data-edit-member]'); if(b) openMembershipEditor(b.dataset.editMember);});
$('keys-list').addEventListener('click',async e=>{const c=e.target.closest('[data-copy-key]'); const d=e.target.closest('[data-delete-key]'); if(c){await navigator.clipboard.writeText(c.dataset.copyKey); toast('Key copied.','success');} if(d){if(!confirm(`Delete key ${d.dataset.deleteKey}?`))return; await deleteDoc(doc(db,'activationKeys',d.dataset.deleteKey)); toast('Key deleted.','success'); await loadAll();}});

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){currentAdmin=null;showApp(false); $('connection-state').className='pill'; $('connection-state').textContent='Signed out'; return;}
  if(user.uid !== ADMIN_UID) {
    currentAdmin = null;
    showApp(false);
    setLoginError('Access denied. This Google account is not the configured Admin UID.');
    await signOut(auth);
    return;
  }

  try {
    let adminSnap = await getDoc(doc(db,'admins',ADMIN_UID));
    if(!adminSnap.exists()) {
      await setDoc(doc(db,'admins',ADMIN_UID), {
        uid:ADMIN_UID, email:user.email||'', name:user.displayName||'',
        role:'owner', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
      }, {merge:false});
      adminSnap = await getDoc(doc(db,'admins',ADMIN_UID));
    }
    if(!adminSnap.exists() || String(adminSnap.data()?.role||'').toLowerCase()!=='owner') {
      throw new Error('Admin record is missing or does not have role = owner.');
    }
    currentAdmin = {uid:ADMIN_UID, ...adminSnap.data()};
    showApp(true);
    $('admin-user').textContent=`${user.displayName||'Admin'} · ${user.email||user.uid}`;
    $('connection-state').className='pill ok';
    $('connection-state').textContent='Firebase connected';
    setLoginError('');
    try { await loadAll(); }
    catch(e) { toast(e?.message||'Could not load Firestore data. Deploy the approved rules and use Initialize DB.','error'); }
  } catch(e) {
    currentAdmin=null;
    showApp(false);
    setLoginError(e?.message || 'Could not initialize Admin access. Check Firestore Rules.');
    await signOut(auth);
  }
});

if(!readyConfig()) setLoginError('Setup required: fill admin/firebase-config.js before using the panel.');
