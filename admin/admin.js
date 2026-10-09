import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG, ADMIN_UID, DEFAULT_SETTINGS } from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
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
let backupReadyForReset = false;

const BACKUP_FORMAT = 'sohelenterprise-firestore-backup-v1';
const BACKUP_COLLECTIONS = [
  'admins','users','memberships','productMemberships','plans','activationKeys',
  'devices','payments','logs','settings','combinedPlans','system'
];

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
  await setDoc(doc(db,'admins',ADMIN_UID),{uid:ADMIN_UID,email:currentUser.email||'',name:currentUser.displayName||'',role:'owner',updatedAt:now},{merge:true});

  // Create missing plans only. Existing user-set prices, durations and active states are preserved.
  const defaults = [
    ['monthly',{name:'Monthly',productScope:'meesho',includedProducts:['meesho'],active:true,price:399,offerPrice:299,durationDays:30,shippingEnabled:true,autofillEnabled:true,description:'Meesho access for 30 days.',createdAt:now,updatedAt:now}],
    ['yearly',{name:'Yearly',productScope:'meesho',includedProducts:['meesho'],active:true,price:2999,offerPrice:1999,durationDays:365,shippingEnabled:true,autofillEnabled:true,description:'Meesho access for 365 days.',createdAt:now,updatedAt:now}],
    ['lifetime',{name:'Lifetime',productScope:'meesho',includedProducts:['meesho'],active:true,price:5999,offerPrice:4999,durationDays:0,shippingEnabled:true,autofillEnabled:true,description:'Meesho access with no expiry.',createdAt:now,updatedAt:now}],
    ['fk-monthly',{name:'Flipkart Monthly',productScope:'flipkart',includedProducts:['flipkart'],active:true,price:399,offerPrice:299,durationDays:30,shippingEnabled:true,autofillEnabled:true,description:'Flipkart access for 30 days.',createdAt:now,updatedAt:now}],
    ['fk-yearly',{name:'Flipkart Yearly',productScope:'flipkart',includedProducts:['flipkart'],active:true,price:2999,offerPrice:1999,durationDays:365,shippingEnabled:true,autofillEnabled:true,description:'Flipkart access for 365 days.',createdAt:now,updatedAt:now}],
    ['fk-lifetime',{name:'Flipkart Lifetime',productScope:'flipkart',includedProducts:['flipkart'],active:true,price:5999,offerPrice:4999,durationDays:0,shippingEnabled:true,autofillEnabled:true,description:'Flipkart access with no expiry.',createdAt:now,updatedAt:now}],
    ['combo-monthly',{name:'Meesho + Flipkart Monthly Auto Listing',productScope:'combined',includedProducts:['meesho','flipkart'],active:true,price:798,offerPrice:598,durationDays:30,shippingEnabled:true,autofillEnabled:true,priceCalculation:'SUM_OF_INCLUDED_PLANS',description:'Both products for 30 days.',createdAt:now,updatedAt:now}],
    ['combo-yearly',{name:'Meesho + Flipkart Yearly Auto Listing',productScope:'combined',includedProducts:['meesho','flipkart'],active:true,price:5998,offerPrice:3998,durationDays:365,shippingEnabled:true,autofillEnabled:true,priceCalculation:'SUM_OF_INCLUDED_PLANS',description:'Both products for 365 days.',createdAt:now,updatedAt:now}],
    ['combo-lifetime',{name:'Meesho + Flipkart Lifetime Auto Listing',productScope:'combined',includedProducts:['meesho','flipkart'],active:true,price:11998,offerPrice:9998,durationDays:0,shippingEnabled:true,autofillEnabled:true,priceCalculation:'SUM_OF_INCLUDED_PLANS',description:'Both products with no expiry.',createdAt:now,updatedAt:now}]
  ];
  for(const [id,data] of defaults) {
    const ref=doc(db,'plans',id); const snap=await getDoc(ref);
    if(!snap.exists()) await setDoc(ref,data,{merge:false});
    else {
      const old=snap.data()||{};
      const patch={};
      if(!old.productScope) patch.productScope=data.productScope;
      if(!Array.isArray(old.includedProducts)) patch.includedProducts=data.includedProducts;
      if(old.deviceLimit!==undefined) patch.deviceLimit=deleteField();
      if(Object.keys(patch).length) await updateDoc(ref,patch);
    }
  }

  const settingsRef=doc(db,'settings','general');
  if(!(await getDoc(settingsRef)).exists()) await setDoc(settingsRef,{...DEFAULT_SETTINGS,meeshoTutorialUrl:'',flipkartTutorialUrl:'',meeshoMasterDownloadUrl:'',flipkartMasterDownloadUrl:'',createdAt:now,updatedAt:now},{merge:false});

  const collectionSeeds=[
    ['users','Users','Google-authenticated extension users'],
    ['memberships','Memberships','Legacy Meesho membership records'],
    ['productMemberships','Product Memberships','Separate Meesho and Flipkart access entitlements'],
    ['plans','Plans','Individual and combined membership plans'],
    ['activationKeys','Activation Keys','Admin-generated one-time activation keys'],
    ['devices','Legacy Device Metadata','Device limits are not enforced'],
    ['payments','Payments','UPI/manual payment records'],
    ['logs','Logs','Admin activity and system audit logs'],
    ['settings','Settings','Support, tutorial and master download URLs'],
    ['combinedPlans','Combined Plans','Bundles containing both products']
  ];
  for(const [name,label,description] of collectionSeeds) {
    const ref=doc(db,name,'_meta');
    if(!(await getDoc(ref)).exists()) await setDoc(ref,{type:'collection-meta',label,description,createdAt:now,updatedAt:now},{merge:false});
  }
  const membershipSnap=await getDocs(collection(db,'memberships'));
  for(const member of membershipSnap.docs) if(member.id!=='_meta' && member.data()?.deviceLimit!==undefined) await updateDoc(member.ref,{deviceLimit:deleteField()});

  await setDoc(doc(db,'system','collections'),{users:true,plans:true,memberships:true,productMemberships:true,activationKeys:true,devices:true,payments:true,settings:true,combinedPlans:true,logs:true,admins:true,initializedAt:now,initializedBy:currentUser.uid},{merge:true});
  await setDoc(doc(db,'system','meta'),{name:'MEESHO A+ LISTING AUTOMATION PRO',version:'3.16.4',model:'SHARED_ADMIN_PRODUCT_MEMBERSHIPS',initializedAt:now,initializedBy:currentUser.uid,database:'FIRESTORE',collectionsReady:true},{merge:true});
  await syncCombinedPlanPrices();
  toast('Firebase integration completed. Missing collections were created; existing prices and settings were preserved.','success');
  await loadAll();
}

async function loadPlans() { const snap=await getDocs(collection(db,'plans')); plans=snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.id).localeCompare(String(b.id))); }
async function loadUsers() { const [u,m,pm]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'memberships')),getDocs(collection(db,'productMemberships'))]); users=u.docs.filter(d=>d.id!=='_meta').map(d=>({uid:d.id,...d.data()})); memberships=new Map(m.docs.filter(d=>d.id!=='_meta').map(d=>[d.id,{uid:d.id,...d.data()}])); for(const d of pm.docs.filter(d=>d.id!=='_meta')){const old=memberships.get(d.id)||{uid:d.id}; memberships.set(d.id,{...old,uid:d.id,productMemberships:d.data()?.products||{},productMembershipRecord:d.data()});} }
async function loadKeys() { const snap=await getDocs(collection(db,'activationKeys')); keys=snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); }
async function loadPayments() { const snap=await getDocs(collection(db,'payments')); payments=snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); }
async function loadSettings() { const s=await getDoc(doc(db,'settings','general')); const d=s.exists()?s.data():DEFAULT_SETTINGS; $('set-brand').value=d.brandName||''; $('set-support').value=d.supportName||''; $('set-phone').value=d.phone||''; $('set-whatsapp').value=d.whatsapp||''; $('set-email').value=d.email||''; $('set-upi').value=d.upiId||''; $('set-qr').value=d.qrUrl||''; $('set-meesho-tutorial').value=d.meeshoTutorialUrl||''; $('set-flipkart-tutorial').value=d.flipkartTutorialUrl||''; $('set-meesho-download').value=d.meeshoMasterDownloadUrl||''; $('set-flipkart-download').value=d.flipkartMasterDownloadUrl||''; $('set-maintenance').checked=Boolean(d.maintenanceMode); }
async function loadAll() { await Promise.all([loadPlans(),loadUsers(),loadKeys(),loadPayments(),loadSettings()]); updateStats(); renderPlans(); renderUsers(); renderKeySelectors(); renderKeys(); renderPlanSelectors(); renderPayments(); }

function updateStats() {
  const active=[...memberships.values()].filter(m=>String(m.status).toUpperCase()==='ACTIVE' && (Number(m.durationDays||0)===0 || !m.expiryDate || new Date(m.expiryDate).getTime()>Date.now())).length;
  const expired=[...memberships.values()].filter(m=>String(m.status).toUpperCase()==='EXPIRED' || (m.expiryDate && new Date(m.expiryDate).getTime()<=Date.now())).length;
  const avail=keys.filter(k=>String(k.status||'').toUpperCase()==='AVAILABLE').length;
  $('stat-users').textContent=users.length; $('stat-active').textContent=active; $('stat-plans').textContent=plans.length; $('stat-keys').textContent=avail; $('stat-payments').textContent=payments.length; $('stat-expired').textContent=expired;
}

function renderPlans() {
  const box=$('plans-list');
  const scopeLabel = p => ({meesho:'MEESHO ONLY',flipkart:'FLIPKART ONLY',combined:'MEESHO + FLIPKART'}[p.productScope] || 'MEESHO LEGACY');
  box.innerHTML=plans.length?plans.map(p=>`<article class="plan-box"><div style="display:flex;justify-content:space-between;gap:8px"><div><div class="eyebrow">${esc(scopeLabel(p))} · ${esc(p.id)}</div><div class="plan-title">${esc(p.name||p.id)}</div><div class="plan-meta">${Number(p.durationDays||0)===0?'Lifetime':`${Number(p.durationDays||0)} days`} · Unlimited devices</div></div><span class="pill ${p.active?'ok':''}">${p.active?'ACTIVE':'INACTIVE'}</span></div><div class="plan-price">₹${Number(p.offerPrice??p.price??0).toLocaleString('en-IN')}</div><div class="plan-meta">Base ₹${Number(p.price||0).toLocaleString('en-IN')} · ${esc((p.includedProducts||[]).join(' + ')||scopeLabel(p))}</div><div class="plan-actions"><button class="secondary" data-edit-plan="${esc(p.id)}">Edit</button><button class="ghost" data-delete-plan="${esc(p.id)}">Delete</button></div></article>`).join(''):'<div class="plan-empty">No plans yet. Click Initialize DB or create a plan.</div>';
}

function openPlanEditor(plan=null) {
  $('plan-editor').classList.remove('hidden');
  $('plan-editor-title').textContent=plan?'Edit Plan':'New Plan';
  $('plan-id').value=plan?.id||''; $('plan-id').disabled=Boolean(plan); $('plan-name').value=plan?.name||''; $('plan-scope').value=plan?.productScope||'meesho'; $('plan-price').value=plan?.price??''; $('plan-offer').value=plan?.offerPrice??''; $('plan-days').value=plan?.durationDays??30; $('plan-description').value=plan?.description||''; $('plan-active').checked=plan?.active!==false;
  $('plan-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function closePlanEditor(){ $('plan-editor').classList.add('hidden'); }

async function syncCombinedPlanPrices() {
  const snap = await getDocs(collection(db,'plans'));
  const all = snap.docs.filter(d=>d.id!=='_meta').map(d=>({id:d.id,...d.data()}));
  const effective = p => Number(p.offerPrice ?? p.price ?? 0);
  const combos = all.filter(p=>p.productScope==='combined');
  for (const combo of combos) {
    const me = all.find(p=>p.productScope==='meesho' && Number(p.durationDays||0)===Number(combo.durationDays||0));
    const fk = all.find(p=>p.productScope==='flipkart' && Number(p.durationDays||0)===Number(combo.durationDays||0));
    if (!me || !fk) continue;
    await setDoc(doc(db,'plans',combo.id),{
      includedProducts:['meesho','flipkart'],
      price:Number(me.price||0)+Number(fk.price||0),
      offerPrice:effective(me)+effective(fk),
      priceCalculation:'SUM_OF_INCLUDED_PLANS',
      updatedAt:new Date().toISOString()
    },{merge:true});
  }
}

async function savePlan(e){
  e.preventDefault();
  const id=slug($('plan-id').value); if(!id) return toast('Plan ID is required.','error');
  const productScope=$('plan-scope').value;
  const includedProducts=productScope==='combined'?['meesho','flipkart']:[productScope];
  const now=new Date().toISOString();
  const data={name:$('plan-name').value.trim()||id,productScope,includedProducts,price:Number($('plan-price').value||0),offerPrice:Number($('plan-offer').value||0),durationDays:Number($('plan-days').value||0),description:$('plan-description').value.trim(),active:$('plan-active').checked,autofillEnabled:true,shippingEnabled:true,updatedAt:now};
  await setDoc(doc(db,'plans',id),data,{merge:true});
  await syncCombinedPlanPrices();
  toast(productScope==='combined'?'Combined plan saved; price auto-calculated from both product plans.':'Plan saved.','success');
  closePlanEditor(); await loadAll(); setSection('plans');
}

function renderUsers(){
  const q=String($('user-search').value||'').toLowerCase().trim();
  const rows=users.filter(u=>`${u.name||''} ${u.email||''} ${u.uid||''}`.toLowerCase().includes(q)).sort((a,b)=>String(a.email||'').localeCompare(String(b.email||'')));
  $('users-table').innerHTML=rows.map(u=>{
    const m=memberships.get(u.uid)||{};
    const now=Date.now();
    const activeEntitlements=Object.entries(m.productMemberships||{}).filter(([,ent])=>{
      const st=String(ent?.status||'').toUpperCase();
      return st==='ACTIVE' && (!ent.expiryDate || new Date(ent.expiryDate).getTime()>now || Number(ent.durationDays||0)===0);
    });
    const legacyActive=String(m.status||'').toUpperCase()==='ACTIVE' && (!m.expiryDate || new Date(m.expiryDate).getTime()>now || Number(m.durationDays||0)===0);
    const active=legacyActive||activeEntitlements.length>0;
    const labels=activeEntitlements.map(([product,ent])=>`${product==='flipkart'?'Flipkart':'Meesho'}: ${ent.planName||ent.planId||'Active'}`);
    if(legacyActive && !labels.some(x=>x.startsWith('Meesho:'))) labels.unshift(`Meesho: ${m.planName||m.planId||'Active'}`);
    const planLabel=labels.join(' · ')||m.planName||m.planId||'—';
    const status=active?'active':String(m.status||'NOT_ACTIVATED').toLowerCase();
    const dates=[...(activeEntitlements.map(([,ent])=>ent)),...(legacyActive?[m]:[])];
    const expiry=dates.some(ent=>Number(ent.durationDays||0)===0)?'Lifetime':formatDate(dates.map(ent=>ent.expiryDate).filter(Boolean).sort().at(-1)||m.expiryDate);
    return `<tr><td><b>${esc(u.name||'Google User')}</b><br><span style="color:#6f86a4">${esc(u.email||u.uid)}</span></td><td>${esc(planLabel)}</td><td><span class="status ${active?'active':status}">${active?'ACTIVE':esc(status.toUpperCase())}</span></td><td>${esc(expiry)}</td><td><div class="row-actions"><button class="secondary" data-edit-member="${esc(u.uid)}">Manage</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="5">No users found.</td></tr>';
}

function renderPlanSelectors(){
  const options=plans.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`).join('');
  ['membership-plan','payment-plan'].forEach(id=>{const s=$(id); if(s)s.innerHTML=options||'<option value="">No plans</option>';});
}
function renderKeySelectors(){ const s=$('key-plan'); if(s) s.innerHTML=plans.filter(p=>p.active!==false).map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`).join('')||'<option value="">No active plans</option>'; }

function openMembershipEditor(uid){
  const u=users.find(x=>x.uid===uid); if(!u) return;
  const m=memberships.get(uid)||{}; $('membership-editor').classList.remove('hidden'); $('membership-uid').value=uid; $('membership-target').textContent=`${u.name||'Google User'} · ${u.email||uid}`; $('membership-plan').value=m.planId||plans[0]?.id||''; $('membership-status').value=String(m.status||'ACTIVE').toUpperCase(); $('membership-start').value=toLocalInput(m.startDate||new Date().toISOString()); $('membership-expiry').value=toLocalInput(m.expiryDate); $('membership-shipping').checked=true; $('membership-editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeMembershipEditor(){ $('membership-editor').classList.add('hidden'); }

async function saveMembership(e){
  e.preventDefault();
  const uid=$('membership-uid').value;
  const u=users.find(x=>x.uid===uid);
  const pid=$('membership-plan').value;
  const p=plans.find(x=>x.id===pid);
  if(!uid||!u||!p) return toast('Select a valid user and plan.','error');
  const now=new Date().toISOString();
  const days=Number(p.durationDays||0);
  const expiry=days===0?null:($('membership-expiry').value?fromLocalInput($('membership-expiry').value):new Date(Date.now()+days*86400000).toISOString());
  const status=$('membership-status').value;
  const includedProducts=p.includedProducts||(p.productScope==='combined'?['meesho','flipkart']:[p.productScope||'meesho']);
  const previous=memberships.get(uid)||{};
  const data={uid,email:u.email||'',planId:pid,planName:p.name||pid,productScope:p.productScope||'meesho',includedProducts,status,durationDays:days,shippingEnabled:true,autofillEnabled:true,startDate:fromLocalInput($('membership-start').value)||now,expiryDate:expiry,source:'ADMIN_PANEL',updatedAt:now,activatedAt:status==='ACTIVE'?now:(previous.activatedAt||null),activationKey:previous.activationKey||'ADMIN_PANEL'};

  const productRef=doc(db,'productMemberships',uid);
  const productSnap=await getDoc(productRef);
  const products={...(previous.productMemberships||{}),...(productSnap.exists()?(productSnap.data()?.products||{}):{})};
  for(const product of includedProducts) {
    const entitlementScope=includedProducts.length>1?'bundle':product;
    products[product]={uid,email:u.email||'',product,planId:pid,planName:p.name||pid,productScope:entitlementScope,includedProducts, status,durationDays:days,shippingEnabled:true,autofillEnabled:true,startDate:data.startDate,expiryDate:expiry,source:'ADMIN_PANEL',updatedAt:now,activatedAt:data.activatedAt,activationKey:data.activationKey};
  }
  // Keep a flat entitlement at the document root for the Flipkart extension while preserving both per-product records.
  const topProduct=products.flipkart?'flipkart':'meesho';
  const topEntitlement=products[topProduct]||{};
  await setDoc(productRef,{...topEntitlement,uid,email:u.email||'',products,product:topProduct,productScope:topEntitlement.productScope||topProduct,includedProducts:topEntitlement.includedProducts||[topProduct],activationKey:topEntitlement.activationKey||data.activationKey,lastActivationKey:data.activationKey,lastUpdatedBy:currentUser.uid,updatedAt:now},{merge:true});

  // Keep the legacy Meesho membership document in sync only when this plan includes Meesho.
  // Buying a Flipkart-only plan must never erase or replace an existing Meesho membership.
  if(includedProducts.includes('meesho')) {
    await setDoc(doc(db,'memberships',uid),data,{merge:true});
    await setDoc(doc(db,'users',uid),{lastMembershipPlan:pid,membershipStatus:status,membershipUpdatedAt:now},{merge:true});
  } else {
    await setDoc(doc(db,'users',uid),{uid,email:u.email||'',name:u.name||u.email||'',membershipUpdatedAt:now},{merge:true});
  }
  toast(includedProducts.length>1?'Combined membership saved for both extensions.':`${includedProducts[0]} membership saved without changing the other product.`,'success');
  closeMembershipEditor(); await loadAll(); setSection('users');
}

function renderKeys(){
  $('keys-list').innerHTML=keys.slice(0,200).map(k=>`<div class="key-item"><div class="key-code">${esc(k.id)}</div><span>${esc(k.planName||k.planId||'—')}</span><span>${esc(k.status||'—')}<br>${esc(k.assignedEmail||'Any email')}</span><div class="row-actions"><button class="secondary" data-copy-key="${esc(k.id)}">Copy</button><button class="ghost" data-delete-key="${esc(k.id)}">Delete</button></div></div>`).join('') || '<div class="plan-empty">No activation keys yet.</div>';
}

async function generateKeys(e){
  e.preventDefault(); const pid=$('key-plan').value; const p=plans.find(x=>x.id===pid); const count=Math.min(100,Math.max(1,Number($('key-count').value||1))); const email=$('key-email').value.trim().toLowerCase(); if(!p) return toast('Choose a plan.','error');
  const now=new Date(); const start=now.toISOString(); const expiry=Number(p.durationDays||0)===0?null:new Date(now.getTime()+Number(p.durationDays)*86400000).toISOString();
  for(let i=0;i<count;i++){let id=newKey(); while(keys.some(k=>k.id===id)) id=newKey(); await setDoc(doc(db,'activationKeys',id),{code:id,status:'AVAILABLE',planId:pid,planName:p.name||pid,productScope:p.productScope||'meesho',includedProducts:p.includedProducts||(p.productScope==='combined'?['meesho','flipkart']:['meesho']),durationDays:Number(p.durationDays||0),shippingEnabled:true,autofillEnabled:true,assignedEmail:email,startDate:start,expiryDate:expiry,createdAt:start,createdBy:currentUser.uid},{merge:false});}
  $('key-count').value=1; toast(`${count} activation key${count>1?'s':''} generated.`,'success'); await loadAll(); setSection('keys');
}

function renderPayments(){ $('payments-table').innerHTML=payments.slice(0,200).map(p=>`<tr><td>${formatDate(p.createdAt)}</td><td>${esc(p.email||p.uid||'—')}</td><td>${esc(p.planName||p.planId||'—')}</td><td>₹${Number(p.amount||0).toLocaleString('en-IN')}</td><td><span class="status ${String(p.status||'').toLowerCase()}">${esc(p.status||'—')}</span></td></tr>`).join('')||'<tr><td colspan="5">No payment records yet.</td></tr>'; }
async function savePayment(e){
  e.preventDefault(); const pid=$('payment-plan').value; const p=plans.find(x=>x.id===pid); const ref=doc(collection(db,'payments')); const now=new Date().toISOString(); const data={uid:$('payment-uid').value.trim(),email:$('payment-email').value.trim().toLowerCase(),planId:pid,planName:p?.name||pid,amount:Number($('payment-amount').value||0),transactionId:$('payment-txn').value.trim(),status:$('payment-status').value,createdAt:now,createdBy:currentUser.uid}; await setDoc(ref,data); toast('Payment saved.','success'); $('payment-form').reset(); await loadAll(); setSection('payments');
}
async function saveSettings(e){ e.preventDefault(); await setDoc(doc(db,'settings','general'),{brandName:$('set-brand').value.trim(),supportName:$('set-support').value.trim(),phone:$('set-phone').value.trim(),whatsapp:$('set-whatsapp').value.trim(),email:$('set-email').value.trim(),upiId:$('set-upi').value.trim(),qrUrl:$('set-qr').value.trim(),meeshoTutorialUrl:$('set-meesho-tutorial').value.trim(),flipkartTutorialUrl:$('set-flipkart-tutorial').value.trim(),meeshoMasterDownloadUrl:$('set-meesho-download').value.trim(),flipkartMasterDownloadUrl:$('set-flipkart-download').value.trim(),maintenanceMode:$('set-maintenance').checked,updatedAt:new Date().toISOString()},{merge:true}); toast('Settings saved.','success'); }

function requireAdminForDataTools() {
  if (!currentUser || currentUser.uid !== ADMIN_UID || !currentAdmin) {
    throw new Error('Only the configured Admin UID can use backup, restore, or reset.');
  }
}

function encodeBackupValue(value) {
  if (value && typeof value.toDate === 'function') {
    return { __sohelFirestoreType: 'timestamp', value: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(encodeBackupValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = encodeBackupValue(item);
    return out;
  }
  return value;
}

function decodeBackupValue(value) {
  if (Array.isArray(value)) return value.map(decodeBackupValue);
  if (value && typeof value === 'object') {
    if (value.__sohelFirestoreType === 'timestamp' && typeof value.value === 'string') {
      const date = new Date(value.value);
      if (Number.isNaN(date.getTime())) throw new Error('Backup contains an invalid timestamp.');
      return date;
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decodeBackupValue(item);
    return out;
  }
  return value;
}

function isKnownBackupPath(path) {
  const parts = String(path || '').split('/');
  if (parts.length < 2 || parts.length % 2 !== 0 || !BACKUP_COLLECTIONS.includes(parts[0])) return false;
  if (parts[0] === 'admins') return parts.length === 2;
  if (parts.length === 2) return true;
  if (parts[0] === 'users' && parts.length === 4 && parts[2] === 'flipkartProfiles') return true;
  if (parts[0] === 'devices' && parts.length === 4 && parts[2] === 'sessions') return true;
  return false;
}

async function collectAppDocuments() {
  const records = [];
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await getDocs(collection(db, name));
    for (const item of snap.docs) {
      records.push({ path: item.ref.path, data: encodeBackupValue(item.data()) });
      if (name === 'users') {
        const nested = await getDocs(collection(db, 'users', item.id, 'flipkartProfiles'));
        for (const child of nested.docs) records.push({ path: child.ref.path, data: encodeBackupValue(child.data()) });
      }
      if (name === 'devices') {
        const nested = await getDocs(collection(db, 'devices', item.id, 'sessions'));
        for (const child of nested.docs) records.push({ path: child.ref.path, data: encodeBackupValue(child.data()) });
      }
    }
  }
  records.sort((a,b) => a.path.localeCompare(b.path));
  return records;
}

function downloadJsonFile(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadLocalBackup() {
  requireAdminForDataTools();
  const records = await collectAppDocuments();
  const snapshot = {
    format: BACKUP_FORMAT,
    version: 1,
    projectId: FIREBASE_CONFIG.projectId,
    exportedAt: new Date().toISOString(),
    note: 'Local JSON backup of known app Firestore documents. Firebase Authentication account identities are not exportable from the browser Admin SDK-free panel.',
    collections: BACKUP_COLLECTIONS,
    documents: records
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJsonFile(`sohel-enterprise-firebase-backup-${stamp}.json`, snapshot);
  backupReadyForReset = true;
  $('factory-reset-button').disabled = $('factory-reset-confirm').value.trim() !== 'RESET ALL NON-ADMIN DATA';
  toast(`Backup downloaded: ${records.length} Firestore documents.`, 'success');
}

async function clearKnownAppDataPreservingAdmin() {
  const records = await collectAppDocuments();
  const removable = records
    .filter(record => record.path !== `admins/${ADMIN_UID}`)
    .sort((a,b) => b.path.split('/').length - a.path.split('/').length || a.path.localeCompare(b.path));
  for (let i=0; i<removable.length; i+=400) {
    const batch = writeBatch(db);
    for (const record of removable.slice(i, i+400)) batch.delete(doc(db, ...record.path.split('/')));
    await batch.commit();
  }
  return removable.length;
}

async function restoreLocalBackupFile(file) {
  requireAdminForDataTools();
  if (!file) return;
  const text = await file.text();
  const backup = JSON.parse(text);
  if (backup?.format !== BACKUP_FORMAT || backup?.version !== 1 || !Array.isArray(backup.documents)) {
    throw new Error('This is not a supported Sohel Enterprise JSON backup.');
  }
  if (backup.projectId !== FIREBASE_CONFIG.projectId) {
    throw new Error('This backup belongs to a different Firebase project. Nothing was changed.');
  }
  const nonAdminRecords = backup.documents.filter(item => !String(item?.path || '').startsWith('admins/'));
  const records = nonAdminRecords.filter(item =>
    item && typeof item.path === 'string' && isKnownBackupPath(item.path) &&
    item.data && typeof item.data === 'object' && !Array.isArray(item.data) &&
    !item.path.startsWith('admins/')
  );
  if (records.length !== nonAdminRecords.length) {
    throw new Error('Backup contains unsupported or invalid document data. Nothing was changed.');
  }
  const uniquePaths = new Set(records.map(item => item.path));
  if (uniquePaths.size !== records.length) {
    throw new Error('Backup contains duplicate document paths. Nothing was changed.');
  }
  if (!confirm(`Restore ${records.length} Firestore documents from this backup? Current known app data will be replaced. The current Admin record will be preserved. Download a backup of the current state first.`)) return;
  await clearKnownAppDataPreservingAdmin();
  const ordered = [...records].sort((a,b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  for (let i=0; i<ordered.length; i+=400) {
    const batch = writeBatch(db);
    for (const item of ordered.slice(i, i+400)) {
      batch.set(doc(db, ...item.path.split('/')), decodeBackupValue(item.data), { merge: false });
    }
    await batch.commit();
  }
  $('factory-reset-confirm').value = '';
  backupReadyForReset = false;
  $('factory-reset-button').disabled = true;
  toast('Backup restored. Admin record preserved. Reloading data…', 'success');
  await loadAll();
}

async function resetKnownAppData() {
  requireAdminForDataTools();
  if (!backupReadyForReset) throw new Error('Download a fresh backup first. Reset remains locked until backup export succeeds.');
  if ($('factory-reset-confirm').value.trim() !== 'RESET ALL NON-ADMIN DATA') {
    throw new Error('Type the exact confirmation phrase first.');
  }
  if (!confirm('This will clear known application Firestore data, plans, memberships, activation keys, settings, and user profile documents. The configured Admin record is preserved. Firebase Authentication sign-in accounts are NOT deleted because this free panel has no privileged server. Continue only if your downloaded backup is saved.')) return;
  $('factory-reset-button').disabled = true;
  toast('Factory reset started…');
  const count = await clearKnownAppDataPreservingAdmin();
  $('factory-reset-confirm').value = '';
  backupReadyForReset = false;
  await setDoc(doc(db, 'admins', ADMIN_UID), {
    uid: ADMIN_UID, email: currentUser.email || '', name: currentUser.displayName || '',
    role: 'owner', updatedAt: new Date().toISOString()
  }, { merge: true });
  toast(`Reset complete: ${count} known Firestore documents cleared. Authentication accounts remain. Click Initialize DB next.`, 'success');
  await loadAll();
  $('factory-reset-button').disabled = true;
}


$('google-login').addEventListener('click',login);
$('logout').addEventListener('click',()=>signOut(auth));
$('initialize-db').addEventListener('click',()=>initializeDatabase().catch(e=>toast(e?.message||'Initialization failed.','error')));
$('download-backup').addEventListener('click',()=>downloadLocalBackup().catch(e=>toast(e?.message||'Backup failed.','error')));
$('restore-backup-trigger').addEventListener('click',()=>$('backup-file-input').click());
$('backup-file-input').addEventListener('change',async e=>{
  try { await restoreLocalBackupFile(e.target.files?.[0]); }
  catch(err) { toast(err?.message||'Restore failed.','error'); }
  finally { e.target.value=''; }
});
$('factory-reset-confirm').addEventListener('input',e=>{
  $('factory-reset-button').disabled = !backupReadyForReset || e.target.value.trim() !== 'RESET ALL NON-ADMIN DATA';
});
$('factory-reset-button').addEventListener('click',()=>resetKnownAppData().catch(e=>toast(e?.message||'Factory reset failed.','error')));
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
