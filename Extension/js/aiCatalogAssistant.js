(function(){
'use strict';
const KEY='ai_provider_keys_v1', DEFAULTS='ai_seller_defaults_v1', ROT='ai_provider_rotation_v1', PROFILE_DB='ai_seller_profiles_v1', PROFILE_OWNER='ai_seller_profile_owner_v1';
let draft=null, pending=[], scanNow=null, researchNow={seed:'',results:[],error:''},currentTitleMeasurements=[];
let workflowBundle=null,workflowBundlePromise=null,activePhotoConflicts=[],productIdentityScore=0,productIdentityStatus='UNASSESSED';
const MASTER_RESOURCE_PATH='resources/MASTER_TEMPLATE_PRO_MAX_V26.md';
const REFERENCE_RESOURCE_PATH='resources/COMPLETE_REFERENCE_JSON.json';
let profileCache=null, titleChoices=[], activeTitleFieldId='', currentTitleProduct=null, currentTitleFields=[], currentTitleStats=null, currentTitleNeeds=[], chatHistory=[];
let draftEditMode=false,draftBeforeEdit=null,draftEditedFields=new Set();
const $=id=>document.getElementById(id);
const STORAGE_MIRROR_PREFIX='__meesho_a_plus_listing_local_v1__:';
const STORAGE_MIRROR_DB='meesho_a_plus_listing_settings_v1';
let mirrorDbPromise=null;
function readStorageMirror(key){
  try {
    const raw=globalThis.localStorage?.getItem(STORAGE_MIRROR_PREFIX+key);
    if(!raw)return {found:false};
    const parsed=JSON.parse(raw);
    if(!parsed||parsed.__meeshoStorageMirror!==1)return {found:false};
    return {found:true,deleted:parsed.deleted===true,value:parsed.value};
  } catch (_) { return {found:false}; }
}
function openStorageMirrorDb(){
  if(mirrorDbPromise)return mirrorDbPromise;
  mirrorDbPromise=new Promise((resolve,reject)=>{
    try{
      if(!globalThis.indexedDB)throw new Error('IndexedDB unavailable');
      const request=globalThis.indexedDB.open(STORAGE_MIRROR_DB,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv',{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open local settings database'));
      request.onblocked=()=>reject(new Error('Local settings database is blocked'));
    }catch(error){reject(error);}
  });
  mirrorDbPromise=mirrorDbPromise.catch(error=>{mirrorDbPromise=null;throw error;});
  return mirrorDbPromise;
}
async function readIndexedMirror(key){
  try{
    const db=await openStorageMirrorDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('kv','readonly'),request=tx.objectStore('kv').get(String(key));
      request.onsuccess=()=>{
        const record=request.result?.record;
        resolve(record&&record.__meeshoStorageMirror===1?{found:true,deleted:record.deleted===true,value:record.value}:{found:false});
      };
      request.onerror=()=>reject(request.error||new Error('Could not read local setting'));
    });
  }catch(_){return {found:false};}
}
async function readAnyMirror(key){
  const local=readStorageMirror(key);
  if(local.found)return local;
  const indexed=await readIndexedMirror(key);
  if(indexed.found){
    try{globalThis.localStorage?.setItem(STORAGE_MIRROR_PREFIX+key,JSON.stringify({__meeshoStorageMirror:1,...(indexed.deleted?{deleted:true}:{value:indexed.value}),updatedAt:Date.now()}));}catch(_){}
  }
  return indexed;
}
async function writeIndexedRecords(records){
  try{
    if(!records.length)return false;
    const db=await openStorageMirrorDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv');
      records.forEach(record=>store.put(record));
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Could not write local settings'));
      tx.onabort=()=>reject(tx.error||new Error('Local settings write was aborted'));
    });
    return true;
  }catch(_){return false;}
}
async function writeStorageMirror(values){
  const records=[];let localSaved=false;
  for(const [key,value] of Object.entries(values||{})){
    const record={__meeshoStorageMirror:1,value,updatedAt:Date.now()};
    records.push({key:String(key),record});
    try{const ls=globalThis.localStorage;if(ls){ls.setItem(STORAGE_MIRROR_PREFIX+key,JSON.stringify(record));localSaved=true;}}catch(_){}
  }
  return (await writeIndexedRecords(records))||localSaved;
}
async function writeStorageTombstones(keys){
  const records=[];let localSaved=false;
  for(const key of keys){
    const record={__meeshoStorageMirror:1,deleted:true,updatedAt:Date.now()};
    records.push({key:String(key),record});
    try{const ls=globalThis.localStorage;if(ls){ls.setItem(STORAGE_MIRROR_PREFIX+key,JSON.stringify(record));localSaved=true;}}catch(_){}
  }
  return (await writeIndexedRecords(records))||localSaved;
}
function extensionStorageCall(method,args,timeoutMs=1600){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error('Extension storage callback timed out')),timeoutMs);
    try{
      const browserApi=globalThis.browser,chromeApi=globalThis.chrome;
      const runtime=browserApi?.runtime||chromeApi?.runtime;
      if(runtime?.sendMessage){
        const op=method==='get'?'get':method==='set'?'set':method==='remove'?'remove':null;
        if(op){
          const payload=args?.[0];
          const bridgeDone=value=>{
            let lastError=null;try{lastError=runtime.lastError||null;}catch(_){}
            if(lastError)return finish(new Error(lastError.message||'Storage bridge error'));
            if(value?.ok){finish(null,op==='get'?(value.data||{}):value);return;}
          };
          try{
            const returned=runtime.sendMessage({type:'LOCAL_STORAGE_BRIDGE',op,payload},bridgeDone);
            if(returned&&typeof returned.then==='function')returned.then(bridgeDone,()=>{});
          }catch(_){}
        }
      }
      const api=(browserApi?.storage?.local?browserApi:chromeApi);
      const area=api?.storage?.local;
      if(!area||typeof area[method]!=='function')throw new Error('Extension local storage API unavailable');
      const callback=value=>{
        let lastError=null;try{lastError=(api?.runtime||chromeApi?.runtime)?.lastError||null;}catch(_){}
        finish(lastError?new Error(lastError.message||'Extension storage error'):null,value);
      };
      let returned;
      if(api===browserApi&&typeof browserApi?.storage?.local?.get==='function'){
        try{returned=area[method](...args);}catch(firstError){
          try{returned=area[method](...args,callback);}catch(_){finish(firstError);return;}
        }
      }else{
        try{returned=area[method](...args,callback);}catch(callbackError){
          try{returned=area[method](...args);}catch(_){finish(callbackError);return;}
        }
      }
      if(returned&&typeof returned.then==='function')returned.then(value=>finish(null,value),error=>finish(error));
      else if(returned&&typeof returned==='object'&&method==='get')finish(null,returned);
    }catch(error){finish(error);}
  });
}
function requestedStorageKeys(keys){
  if(typeof keys==='string')return [keys];
  if(Array.isArray(keys))return keys.map(String);
  if(keys&&typeof keys==='object')return Object.keys(keys);
  return [];
}
async function listIndexedMirrors(){
  try{
    const db=await openStorageMirrorDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('kv','readonly'),request=tx.objectStore('kv').getAll();
      request.onsuccess=()=>resolve((request.result||[]).filter(x=>x&&x.record&&x.record.__meeshoStorageMirror===1));
      request.onerror=()=>reject(request.error||new Error('Could not list local settings'));
    });
  }catch(_){return [];}
}
const get=async keys=>{
  const wanted=requestedStorageKeys(keys),mirrors={};
  for(const key of wanted)mirrors[key]=await readAnyMirror(key);
  if(wanted.length&&wanted.every(key=>mirrors[key].found)){
    const cached={};
    for(const key of wanted){
      const mirror=mirrors[key];
      if(mirror.deleted){if(keys&&typeof keys==='object'&&!Array.isArray(keys)&&Object.prototype.hasOwnProperty.call(keys,key))cached[key]=keys[key];}
      else cached[key]=mirror.value;
    }
    return cached;
  }
  let result={};
  try{result=await extensionStorageCall('get',[keys])||{};}catch(_){result={};}
  for(const key of wanted){
    const mirror=mirrors[key]||await readAnyMirror(key);
    if(mirror.found){if(mirror.deleted)delete result[key];else result[key]=mirror.value;}
    else if(Object.prototype.hasOwnProperty.call(result,key))await writeStorageMirror({[key]:result[key]});
    else if(keys&&typeof keys==='object'&&!Array.isArray(keys)&&Object.prototype.hasOwnProperty.call(keys,key)){
      result[key]=keys[key];await writeStorageMirror({[key]:keys[key]});
    }
  }
  if(keys==null){
    const all={};
    try{
      const ls=globalThis.localStorage;
      if(ls)for(let i=0;i<ls.length;i++){
        const storageKey=ls.key(i);
        if(!storageKey?.startsWith(STORAGE_MIRROR_PREFIX))continue;
        const key=storageKey.slice(STORAGE_MIRROR_PREFIX.length),mirror=readStorageMirror(key);
        if(mirror.found)all[key]=mirror;
      }
    }catch(_){}
    for(const entry of await listIndexedMirrors())if(!all[entry.key])all[entry.key]={found:true,deleted:entry.record.deleted===true,value:entry.record.value};
    for(const [key,mirror] of Object.entries(all)){if(mirror.deleted)delete result[key];else result[key]=mirror.value;}
  }
  return result;
};
const set=async values=>{
  const object=values&&typeof values==='object'?values:{};
  const mirrorSaved=await writeStorageMirror(object);
  let extensionSaved=false;
  try{await extensionStorageCall('set',[object]);extensionSaved=true;}catch(_){}
  if(!mirrorSaved&&!extensionSaved)throw new Error('Could not save settings in this browser. Enable extension storage/site data for this extension and try again.');
};
const removeStorage=async keys=>{
  const list=(Array.isArray(keys)?keys:[keys]).filter(Boolean).map(String);
  const mirrorSaved=await writeStorageTombstones(list);
  let extensionRemoved=false;
  try{await extensionStorageCall('remove',[list]);extensionRemoved=true;}catch(_){}
  if(!mirrorSaved&&!extensionRemoved)throw new Error('Could not remove the saved setting in this browser.');
};

const SEARCH_ORIGINS=['https://www.google.com/*','https://html.duckduckgo.com/*','https://www.bing.com/*'];
function requestGoogleSearchPermission(){return new Promise(resolve=>{try{chrome.permissions.request({origins:SEARCH_ORIGINS},granted=>resolve(Boolean(granted)));}catch(e){resolve(false);}});}
function stripImageFilenameArtifacts(value){
 return String(value||'')
  .replace(/\b([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif|bmp|avif)\b/gi,(match,stem)=>{
   if(/^\d+$/.test(stem))return stem;
   if(/[_-]/.test(stem)||/^(?:img|dscn?|screenshot|photo|image|productimg|productimage|file)[_-]?\d*$/i.test(stem))return ' ';
   return stem;
  })
  .replace(/\b(?:img|dsc|dscn|screenshot|photo|image)[_-]?\d+\b/gi,' ')
  .replace(/\s+/g,' ').trim();
}
function cleanSearchSeed(value){return stripImageFilenameArtifacts(value).replace(/\b(feature showcase|showcase|product image|main image|image|photo|copy|final|edited)\b/gi,' ').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,160);}
function validExternalUrl(raw){try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))return '';if(/(^|\.)google\.[a-z.]+$/i.test(u.hostname)||/(^|\.)bing\.com$/i.test(u.hostname)||/(^|\.)duckduckgo\.com$/i.test(u.hostname)||/googleusercontent|accounts\.google|support\.google/i.test(u.hostname))return '';return u.href;}catch(e){return '';}}
function unwrapSearchResultUrl(raw,baseUrl){
 try{
  let u=new URL(String(raw||''),baseUrl||'https://www.google.com/');
  const host=u.hostname.toLowerCase();
  if(/(^|\.)google\.[a-z.]+$/i.test(host)&&u.pathname==='/url'){
   const target=u.searchParams.get('q')||u.searchParams.get('url')||u.searchParams.get('adurl');
   if(target)u=new URL(target);
  }else if(/(^|\.)duckduckgo\.com$/i.test(host)&&/^\/l\/?$/.test(u.pathname)){
   const target=u.searchParams.get('uddg')||u.searchParams.get('url');
   if(target)u=new URL(target);
  }else if(/(^|\.)bing\.com$/i.test(host)&&/^\/ck\/a\/?$/i.test(u.pathname)){
   const encoded=u.searchParams.get('u')||'';
   if(/^a\d/i.test(encoded)){
    try{const decoded=atob(encoded.replace(/^a\d/i,''));if(/^https?:\/\//i.test(decoded))u=new URL(decoded);}catch(e){}
   }
  }
  return validExternalUrl(u.href);
 }catch(e){return '';}
}
function parseGoogleResults(html,baseUrl){
 const doc=new DOMParser().parseFromString(String(html||''),'text/html'),items=[],seen=new Set(),engineBase=baseUrl||'https://www.google.com/';
 const add=(anchor,heading)=>{
  if(!anchor)return;
  const title=String(heading&&heading.textContent||anchor.textContent||anchor.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
  if(!title||title.length<3)return;
  const href=unwrapSearchResultUrl(anchor.getAttribute('href')||anchor.href,engineBase);
  if(!href||seen.has(href))return;
  const card=(heading&&heading.closest('.MjjYud, .g, .b_algo, .result, .results_links, li'))||
   anchor.closest('.MjjYud, .g, .b_algo, .result, .results_links, li, article')||
   heading&&heading.parentElement&&heading.parentElement.parentElement||anchor.parentElement&&anchor.parentElement.parentElement;
  let snippet=String(card&&card.querySelector('.VwiC3b, .aCOpRe, .IsZvec, [data-sncf], .st, .b_caption p, .result__snippet, .snippet, p')?.textContent||'').replace(/\s+/g,' ').trim();
  if(!snippet&&card)snippet=String(card.textContent||'').replace(title,' ').replace(/\s+/g,' ').trim();
  if(/^(?:images|videos|news|maps|shopping|settings|tools|feedback|next|previous|more results)$/i.test(title))return;
  seen.add(href);items.push({title,url:href,snippet:snippet.slice(0,700),domain:new URL(href).hostname});
 };
 Array.from(doc.querySelectorAll('h3, h2')).forEach(heading=>{
  const anchor=heading.closest('a')||heading.parentElement&&heading.parentElement.querySelector('a[href]');
  add(anchor,heading);
 });
 // Search engines frequently change heading markup; fall back to known result anchors.
 if(items.length<3){
  const selectors=['a.result__a','.b_algo h2 a','a[data-testid="result-title-a"]','.MjjYud a[href]','.g a[href]','a[href*="uddg="]','a[href*="/url?q="]','a[href*="/ck/a?"]'];
  const targeted=new Set();
  selectors.forEach(selector=>{try{doc.querySelectorAll(selector).forEach(anchor=>{if(!targeted.has(anchor)){targeted.add(anchor);add(anchor,anchor.querySelector('h3,h2')||anchor);}});}catch(e){}});
 }
 // Last-resort extraction is constrained to external links with substantial text and a result-like container.
 if(items.length<3){
  Array.from(doc.querySelectorAll('a[href]')).forEach(anchor=>{
   if(items.length>=12)return;
   const title=String(anchor.textContent||'').replace(/\s+/g,' ').trim();
   if(title.length<18||title.length>220||anchor.querySelector('img,svg'))return;
   const card=anchor.closest('.MjjYud, .g, .b_algo, .result, .results_links, li, article');
   if(!card&&anchor.querySelectorAll('*').length>8)return;
   add(anchor,anchor);
  });
 }
 return items.slice(0,8);
}
async function searchGoogle(query){
 const q=encodeURIComponent(query),engines=[
  {name:'Google',url:'https://www.google.com/search?q='+q+'&num=10&hl=en&gl=in',base:'https://www.google.com/'},
  {name:'DuckDuckGo',url:'https://html.duckduckgo.com/html/?q='+q+'&kl=in-en',base:'https://html.duckduckgo.com/'},
  {name:'Bing',url:'https://www.bing.com/search?q='+q+'&count=10&setlang=en-IN',base:'https://www.bing.com/'}
 ],failures=[];
 for(const engine of engines){try{
  const res=await post(engine.url,{method:'GET',credentials:'omit',headers:{'Accept':'text/html,application/xhtml+xml'}});
  if(!res.ok)throw new Error(engine.name+' Search HTTP '+res.status);
  const html=await res.text();if(/unusual traffic|not a robot|captcha|consent\.google|verify you are human/i.test(html.slice(0,30000)))throw new Error(engine.name+' returned a consent or anti-bot page.');
  const results=parseGoogleResults(html,engine.base);if(!results.length)throw new Error(engine.name+' results could not be parsed.');
  results.forEach(r=>{r.searchProvider=engine.name;});if(engine.name!=='Google')liveLog('WEB SEARCH FALLBACK · '+engine.name+' returned '+results.length+' result(s).','info');return results;
 }catch(e){failures.push(String(e.message||e));}}
 throw new Error('Search providers returned no parseable results. '+failures.join(' | '));
}
function normalizePrimaryColor(value){
 const raw=String(value||'').replace(/[|/;,]+/g,' ').replace(/\s+/g,' ').trim();
 if(!raw)return '';
 const rules=[
  [/\blight\s+blue\b/i,'Light Blue'],[/\bsky\s+blue\b/i,'Sky Blue'],[/\bbaby\s+blue\b/i,'Light Blue'],[/\bnavy\s+blue\b/i,'Navy Blue'],[/\bdark\s+blue\b/i,'Dark Blue'],
  [/\blight\s+green\b/i,'Light Green'],[/\bdark\s+green\b/i,'Dark Green'],[/\bforest\s+green\b/i,'Forest Green'],[/\bsea\s+green\b/i,'Sea Green'],
  [/\bblue\b/i,'Blue'],[/\bgreen\b/i,'Green'],[/\bred\b/i,'Red'],[/\bpink\b/i,'Pink'],[/\bpurple\b/i,'Purple'],[/\bviolet\b/i,'Violet'],
  [/\bblack\b/i,'Black'],[/\bwhite\b/i,'White'],[/\bgrey\b/i,'Grey'],[/\bgray\b/i,'Grey'],[/\bsilver\b/i,'Silver'],[/\bgold(?:en)?\b/i,'Gold'],
  [/\bbeige\b/i,'Beige'],[/\bbrown\b/i,'Brown'],[/\borange\b/i,'Orange'],[/\byellow\b/i,'Yellow'],[/\bcream\b/i,'Cream'],[/\bmaroon\b/i,'Maroon'],[/\bteal\b/i,'Teal'],[/\btransparent\b/i,'Transparent']
 ];
 let best=null;
 for(const [pattern,label] of rules){const match=pattern.exec(raw);if(match&&(!best||match.index<best.index||(match.index===best.index&&match[0].length>best.length)))best={index:match.index,length:match[0].length,label};}
 return best?best.label:raw.split(/\s+(?:and|with|plus)\s+|[,/|;]/i)[0].trim().split(/\s+/).slice(0,2).join(' ');
}
function scoreProductIdentity(p,identified,sellerNameProvided){
 if(!identified)return 0;
 let score=0;
 const confidence=String(identified.confidence||'low').toLowerCase();
 score+=confidence==='high'?15:confidence==='medium'?10:0;
 const name=String(p&&p.productName||identified.productName||'').trim();
 const generic=/^(product|item|water bottle|bottle|plastic bottle|container|accessory|unknown)$/i.test(name);
 if(name&&!generic)score+=sellerNameProvided?20:18;
 if(String(identified.productType||p&&p.productType||'').trim().length>=5)score+=15;
 if(String(p&&p.productTypeEvidence||'').trim().length>=15)score+=10;
 if(String(p&&p.material||'').trim())score+=10;
 if(String(p&&p.color||'').trim())score+=5;
 if(capacityInMl(p&&p.productCapacity||'')!==null)score+=5;
 if(String(identified.brandIfLegible||'').trim())score+=10;
 if(String(identified.modelIfLegible||'').trim())score+=10;
 if(Array.isArray(identified.visibleText)&&identified.visibleText.length)score+=5;
 if(Array.isArray(identified.searchTerms)&&identified.searchTerms.length>=2)score+=5;
 if(String(p&&p.productFacts||'').trim())score+=5;
 return Math.min(100,score);
}
function productIdentityBand(score){
 return score>=95?'VERIFIED':score>=85?'STRONG':score>=70?'POSSIBLE — APPROVAL':'BLOCKED — INPUT REQUIRED';
}

function categoryResearchTerms(p,scan,catalog){
 const ctx=safeMeeshoCatalogContext(scan&&scan.catalogContext||{}),categoryBits=[ctx.subCategoryName,ctx.categoryName,ctx.catalogType,ctx.breadcrumb,catalog&&catalog.name,catalog&&catalog.type,p&&p.productType].filter(Boolean);
 const fields=schema(scan||{}).fields.filter(f=>!/(product.?name|title|style.?code|sku|product.?id|filename|seller|price|inventory|mrp)/i.test(String(f.identifier||'')+' '+String(f.label||'')));
 const fieldBits=fields.map(f=>String(f.label||'')+' '+captured(scan||{},f.identifier)).filter(Boolean);
 return cleanSearchSeed([p&&p.productName||'',p&&p.productTypeEvidence||'',p&&p.productType||'',p&&p.material||'',p&&p.color||'',p&&p.productCapacity||'',p&&p.imageResearchTerms||'',p&&p.productFacts||'',...categoryBits,...fieldBits].join(' ')).slice(0,220);
}
function taxResearchTerms(catalog,p){const key=String(catalog&&catalog.key||p&&p.productCategory||'general');if(key==='kitchen')return 'plastic tableware kitchenware food storage containers tariff classification HSN GST rate India';if(key==='bottles')return 'drinking bottles drinkware vacuum flask material tariff classification HSN GST rate India';if(key==='apparel')return 'garments clothing textile material tariff classification HSN GST rate India';if(key==='furniture')return 'chairs tables furniture material tariff classification HSN GST rate India';if(key==='electronics')return 'electrical electronic accessories product classification HSN GST rate India';return 'product category material use tariff classification HSN code GST goods rate India';}
async function researchProduct(p,imgs,allowed,scan,catalog){
 const seed=categoryResearchTerms(p,scan,catalog)||cleanSearchSeed([catalog&&catalog.name,catalog&&catalog.type,p&&p.productType].filter(Boolean).join(' ')),classificationTerms=taxResearchTerms(catalog,p);
 const research={seed,queries:[],results:[],error:'',searchedAt:new Date().toISOString(),researchMode:'category-and-image-context'};
 if(!allowed){research.error='Web Search permission was not granted.';return research;}if(!seed){research.error='No usable selected Meesho category or product attributes were available for research.';return research;}
 const queries=[seed+' product specifications material capacity net weight length breadth height manufacturer India',seed+' product dimensions length breadth width height cm net weight grams similar product India','site:cbic-gst.gov.in OR site:taxinformation.cbic.gov.in '+classificationTerms+' official goods tax notification','site:content.dgft.gov.in OR site:commerce.gov.in '+classificationTerms+' Indian tariff schedule official classification'];research.queries=queries;
 const outcomes=await Promise.all(queries.map(async(q,index)=>{setProgress(32,'Web research · checking product specifications and official HSN/GST');liveLog('WEB SEARCH · category-based query '+(index+1)+'/'+queries.length+': '+q,'info');try{const rows=await searchGoogle(q);liveLog('WEB SEARCH · '+rows.length+' result(s) for query '+(index+1)+' via '+(rows[0]?.searchProvider||'search provider')+'.','ok');return {query:q,rows,error:''};}catch(e){const message=String(e.message||e);liveLog('WEB SEARCH · query '+(index+1)+' failed: '+redactSecrets(e,null),'warn');return {query:q,rows:[],error:message};}}));
 const all=[];outcomes.forEach(outcome=>{if(outcome.error)research.error=research.error?research.error+' | '+outcome.error:outcome.error;outcome.rows.forEach(row=>{if(!all.some(x=>x.url===row.url))all.push(Object.assign({query:outcome.query},row));});});
 setProgress(44,'Category research complete · evaluating official tax evidence');research.results=all.slice(0,24);if(!research.results.length&&!research.error)research.error='No usable web search results were found.';return research;
}

function attachOfficialTaxReferences(research,p,imgs,scan,catalog){
 const sourceRows=Array.isArray(research&&research.results)?research.results:[];
 const seen=new Set();
 const official=sourceRows.filter(row=>{
  let host='';try{host=new URL(row.url||'').hostname;}catch(e){}
  if(!OFFICIAL_TAX_HOST.test(host)||!row.url||seen.has(row.url))return false;
  seen.add(row.url);return true;
 }).map(row=>Object.assign({},row,{
  kind:/\b(gst|tax|rate|slab|notification)\b/i.test(String(row.title||'')+' '+String(row.snippet||''))?'gst':'hsn',
  sourceType:'live-official-search-result'
 }));
 research.officialTaxReferences=official;
 // No hard-coded tax value may be produced from the category/material alone. AI-proposed
 // values are accepted only after exact official-source matching; otherwise targeted
 // Government searches run and the mandatory tax gate remains blocked.
 research.automaticTaxClassification=null;
 research.taxClassificationStatus=official.length?'official-sources-found-candidate-still-requires-exact-match':'no-live-official-source-found';
 if(!official.length)liveLog('TAX HARD LOCK · no live official tax results were captured. HSN/GST will remain unresolved unless targeted official-source verification succeeds.','warn');
 return research;
}
async function enrichTaxEvidence(proposed,evidence,research,fields,p,scan,catalog){
 const targets=(fields||[]).filter(field=>isTaxField(field));
 const tasks=[];
 for(const field of targets){
  const isHsn=/\bhsn\b/.test(norm(String(field.identifier||'').replace(/_/g,' ')+' '+field.label));
  if(research&&research.automaticTaxClassification)continue;
  const candidate=String(proposed[field.identifier]||'').trim();
  if(!candidate)continue;
  const existingSources=[...(research.results||[]),...(research.officialTaxReferences||[])];
  if(existingSources.some(row=>officialTaxEvidence(field,candidate,{url:row.url},research)))continue;
  const code=isHsn?candidate.replace(/\D/g,''):candidate.match(/\d+(?:\.\d+)?/)?candidate.match(/\d+(?:\.\d+)?/)[0]+'%':'';
  if(!code)continue;
  const category=categoryResearchTerms(p,scan,catalog)||String(catalog&&catalog.name||'product category');
  const query=isHsn
   ?'site:content.dgft.gov.in OR site:commerce.gov.in "'+code+'" tariff classification '+category+' India'
   :'site:taxinformation.cbic.gov.in OR site:cbic-gst.gov.in "'+code+'" GST rate '+taxResearchTerms(catalog,p)+' India';
  tasks.push({field,candidate,query});
 }
 const outcomes=await Promise.all(tasks.map(async task=>{
  try{
   liveLog('OFFICIAL TAX RESEARCH · checking candidate '+task.candidate+' against official Government sources.','info');
   const rows=await searchGoogle(task.query);
   rows.forEach(row=>Object.assign(row,{query:task.query,validationCandidate:task.candidate}));
   return {task,rows};
  }catch(e){
   liveLog('OFFICIAL TAX RESEARCH · targeted lookup failed: '+redactSecrets(e,null),'warn');
   return {task,rows:[]};
  }
 }));
 outcomes.forEach(({task,rows})=>{
  rows.forEach(row=>{if(!research.results.some(existing=>existing.url===row.url))research.results.push(row);});
  const found=[...rows,...(research.officialTaxReferences||[])].some(row=>officialTaxEvidence(task.field,task.candidate,{url:row.url},research));
  liveLog(found?'OFFICIAL TAX RESEARCH · matching government result found for '+task.candidate+'.':'OFFICIAL TAX RESEARCH · no exact official match found for '+task.candidate+'; candidate stays unverified.',''+(found?'ok':'warn'));
 });
}

const OFFICIAL_TAX_HOST=/(^|\.)(cbic\.gov\.in|cbic-gst\.gov\.in|gst\.gov\.in|commerce\.gov\.in|dgft\.gov\.in|egazette\.gov\.in)$/i;
function isTaxField(field){
 const x=norm(String(field.identifier||'').replace(/_/g,' ')+' '+field.label);
 return /\bhsn\b/.test(x)||(/\bgst\b/.test(x)&&!/(gstin|gst number|registration)/.test(x));
}
function officialTaxEvidence(field,candidate,evidence,research){
 const x=norm(String(field.identifier||'').replace(/_/g,' ')+' '+field.label),isHsn=/\bhsn\b/.test(x);
 let sourceUrl='';
 if(typeof evidence==='string')sourceUrl=evidence;
 else if(evidence&&typeof evidence==='object')sourceUrl=String(evidence.url||evidence.sourceUrl||'');
 const row=[...(research.results||[]),...(research.officialTaxReferences||[])].find(r=>r.url===sourceUrl);
 if(!row)return null;
 let host='';try{host=new URL(row.url).hostname;}catch(e){}
 if(!OFFICIAL_TAX_HOST.test(host))return null;
 const sourceText=String(row.title+' '+row.snippet),lower=sourceText.toLowerCase();
 if(isHsn){
  const digits=String(candidate||'').replace(/\D/g,'');
  if(!/^\d{4}(?:\d{2})?(?:\d{2})?$/.test(digits))return null;
  if(!/(hsn|tariff|classification|commodity|heading|customs|gst)/i.test(lower))return null;
  // Google snippets sometimes place the tariff heading and exact code far apart.
  // The result must still be official and directly mention both a classification context and this code.
  if(!sourceText.replace(/[^0-9]/g,'').includes(digits))return null;
 }else{
  const n=String(candidate||'').match(/\d+(?:\.\d+)?/);if(!n)return null;
  const compact=lower.replace(/[\s,]/g,'');
  if(!/(gst|tax|rate|slab)/i.test(lower)||!compact.includes(String(Number(n[0]))+'%'))return null;
 }
 return row;
}
function hashText(text){
 let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(16).toUpperCase().padStart(8,'0');
}
function slugCode(text,maxLen){
 return String(text||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,maxLen).replace(/-+$/g,'')||'PRODUCT';
}
async function productCodes(title,p){
 const stableTitle=cleanSearchSeed(title)||'PRODUCT';
 const identity=[stableTitle,p.material||'',p.color||'',p.productFacts||'',p.packQuantity||'1'].join('|').toLowerCase().replace(/\s+/g,' ').trim();
 const h=hashText(identity),storageKey='ai_generated_product_codes_v1',res=await get(storageKey),map=res[storageKey]||{};
 if(map[h]&&map[h].styleCode&&map[h].skuCode)return map[h];
 const core=slugCode(stableTitle,16),short=slugCode(stableTitle,10);
 const codes={styleCode:'SE-'+core+'-'+h.slice(0,6),skuCode:'SE-'+short+'-'+h.slice(2,10),identityHash:h};
 map[h]=codes;const entries=Object.entries(map).slice(-250);await set({[storageKey]:Object.fromEntries(entries)});
 return codes;
}
function generatedCodeForField(field,codes){
 const x=norm(String(field.identifier||'').replace(/_/g,' ')+' '+field.label);
 if(/supplier product id|supplier_product_id|style code|style id|product id/.test(x))return codes.styleCode;
 if(/supplier sku id|supplier_sku_id|\bsku id\b|stock keeping unit/.test(x))return codes.skuCode;
 return '';
}
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const norm=v=>String(v||'').replace(/[＊*]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function liveLog(message,level='info'){
 const host=$('ai-live-log');if(!host)return;
 const line=document.createElement('span');line.className='live-line ai-live-line-'+level;
 const dt=new Date(),stamp=[dt.getHours(),dt.getMinutes(),dt.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
 line.textContent='['+stamp+'] ['+String(level||'info').toUpperCase()+'] '+String(message||'');
 host.appendChild(line);
 while(host.children.length>100)host.removeChild(host.firstElementChild);
 host.scrollTop=host.scrollHeight;
 const state=$('ai-live-state');if(state)state.textContent=level==='error'?'ERROR':level==='warn'?'ATTENTION':level==='ok'?'COMPLETE':'RUNNING';
}
function clearLiveLog(){
 resetWorkflowSteps();
 const host=$('ai-live-log');if(host)host.textContent='';
 const state=$('ai-live-state');if(state)state.textContent='READY';
 setProgress(0,'Ready · waiting for input');
}
function setProgress(percent,label){
 const n=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));
 const fill=$('ai-progress-fill'),num=$('ai-progress-percent'),stage=$('ai-progress-stage'),caption=$('ai-progress-caption');
 if(fill)fill.style.width=n+'%';if(num)num.textContent=n+'%';
 if(stage)stage.textContent=label||'Processing';
 if(caption)caption.textContent=n===100?'Completed · review draft and confirm remaining fields.':('Stage '+(label||'Processing')+' · '+n+'% complete');
}
function say(m,t){
 if($('ai-status')){$('ai-status').textContent=m||'';$('ai-status').className='ai-status '+(t||'');}
 const level=t==='error'?'error':(t==='warning'?'warn':(t==='success'?'ok':'info'));
 if(m)liveLog(m,level);
}
const PROVIDERS={
 gemini:{label:'Google Gemini',endpoint:'',model:'gemini-3.8-flash',kind:'native',hint:'Google AI Studio has a free tier for eligible models/accounts; quotas change.'},
 groq:{label:'Groq Cloud',endpoint:'https://api.groq.com/openai/v1/chat/completions',model:'qwen/qwen3.8-27b',kind:'compatible',hint:'Fast vision model: qwen/qwen3.8-27b. Free plan limits apply; image inputs are supported.'},
 openrouter:{label:'OpenRouter',endpoint:'https://openrouter.ai/api/v1/chat/completions',model:'qwen/qwen3.8-27b:free',kind:'compatible',hint:'Suggested free vision model: qwen/qwen3.8-27b:free. Free model availability and daily limits can change.'},
 xai:{label:'xAI Grok',endpoint:'https://api.x.ai/v1/chat/completions',model:'',kind:'compatible',hint:'Requires an xAI API key and supported vision model; normally paid.'},
 together:{label:'Together AI',endpoint:'https://api.together.xyz/v1/chat/completions',model:'',kind:'compatible',hint:'Enter a vision-capable model ID available to your Together account; credits/pricing vary.'},
 fireworks:{label:'Fireworks AI',endpoint:'https://api.fireworks.ai/inference/v1/chat/completions',model:'',kind:'compatible',hint:'Enter a supported vision model ID; free credits/promotions vary.'},
 mistral:{label:'Mistral AI',endpoint:'https://api.mistral.ai/v1/chat/completions',model:'',kind:'compatible',hint:'Enter a vision-capable model ID supported by your Mistral account; availability/pricing vary.'},
 huggingface:{label:'Hugging Face Router',endpoint:'https://router.huggingface.co/v1/chat/completions',model:'',kind:'compatible',hint:'Use a compatible vision model and provider token available to your account; free credits/rates vary.'},
 freellmapi:{label:'FreeLLMAPI Local Router',endpoint:'http://127.0.0.1:31415/v1/chat/completions',model:'auto',kind:'compatible',hint:'Uses your own local FreeLLMAPI router. Auto-tests port 31415 first, then 3001. For product photos, configure a vision-capable fallback model; free quotas and provider limits can change.'},
 custom:{label:'Custom OpenAI-Compatible',endpoint:'',model:'',kind:'compatible',hint:'Enter an HTTPS endpoint, or HTTP only for localhost/127.0.0.1, and a compatible vision model ID.'}
};
function label(p){return (PROVIDERS[p]&&PROVIDERS[p].label)||'OpenAI-compatible API';}
function modelDefault(p){return (PROVIDERS[p]&&PROVIDERS[p].model)||'';}
function modelChoices(p){
 if(p==='gemini')return [
  {id:'gemini-3.8-flash',label:'Gemini 3.8 Flash · vision'},
  {id:'gemini-3.6-flash',label:'Gemini 3.6 Flash · vision'},
  {id:'gemini-3.5-flash-lite',label:'Gemini 3.5 Flash-Lite · vision'},
  {id:'gemini-3.1-flash-lite',label:'Gemini 3.1 Flash-Lite · vision'}
 ];
 if(p==='groq')return [{id:'qwen/qwen3.8-27b',label:'Qwen 3.8 27B · vision'}];
 if(p==='openrouter')return [{id:'qwen/qwen3.8-27b:free',label:'Qwen 3.8 27B · free vision model'}];
 return [];
}
function endpointDefault(p){return (PROVIDERS[p]&&PROVIDERS[p].endpoint)||(p==='compatible'?'https://api.x.ai/v1/chat/completions':'');}
function isNativeProvider(p){return p==='gemini';}
function usesEndpoint(p){return !isNativeProvider(p);}
function syncProviderCards(){
 const active=$('ai-provider-type')?.value||'gemini';
 document.querySelectorAll('#ai-provider-cards [data-api-provider]').forEach(card=>{
  const selected=card.getAttribute('data-api-provider')===active;
  card.classList.toggle('active',selected);card.setAttribute('aria-pressed',selected?'true':'false');
 });
}
function chooseApiProvider(provider){
 if(!PROVIDERS[provider])return;
 const select=$('ai-provider-type');if(!select)return;
 select.value=provider;updateProviderForm();syncProviderCards();
 const form=$('ai-key-model');if(form)form.focus({preventScroll:true});
}

function safeKeyName(k){
 const name=String(k&&k.name||'').trim(),key=String(k&&k.apiKey||'');
 if(!name||name===key||name.length>42||/^(AIzaSy|gsk_|xai-|sk-)/i.test(name))return label(k&&k.provider)+' key';
 return name;
}
function classifyProviderFailure(error){
 const message=String(error&&error.message||error||'Unknown provider error');
 if(/\b429\b|quota|resource_exhausted|rate.?limit|too many requests|billing/i.test(message))return 'quota';
 if(/\b401\b|\b403\b|unauthorized|invalid api.?key|permission denied|forbidden/i.test(message))return 'auth';
 if(/\b404\b|model.*not found|not found.*model/i.test(message))return 'model';
 if(/\b5\d\d\b|temporarily unavailable|service unavailable|internal server error/i.test(message))return 'server';
 return 'other';
}
function explainProviderFailure(provider,error,hasAlternative){
 const kind=classifyProviderFailure(error),prefix=label(provider)+' ';
 if(kind==='quota')return prefix+'quota/rate limit (429). '+(hasAlternative?'Skipping this key and trying the next enabled provider/key.':'No other enabled key/provider is available; add or enable another key/provider, or wait for this provider quota to reset. The extension cannot restore provider quota.');
 if(kind==='auth')return prefix+'authentication/permission error. Check the API key, model access and provider permissions.';
 if(kind==='model')return prefix+'model/endpoint not found. Check the model ID and endpoint for this provider.';
 if(kind==='server')return prefix+'provider server error. It will be skipped for this request.';
 return prefix+redactSecrets(error,null);
}
function redactSecrets(message,k){
 let out=String(message&&message.message||message||'Unknown error');
 const key=String(k&&k.apiKey||'');if(key)out=out.split(key).join('[API key redacted]');
 return out.replace(/\b(?:AIzaSy[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,})\b/g,'[API key redacted]').slice(0,180);
}
async function keys(){
 const r=await get(KEY);let list=Array.isArray(r[KEY])?r[KEY]:[],changed=false;
 // Recover common provider-selection mistakes from earlier extension versions:
 // Groq keys start with gsk_; Google AI Studio keys commonly start with AIzaSy.
 list=list.map(k=>{
  if(!k||typeof k!=='object')return k;
  const apiKey=String(k.apiKey||''),endpoint=String(k.endpoint||'');
  if(k.provider!=='groq'&&/^gsk_/i.test(apiKey)){
   changed=true;
   return Object.assign({},k,{provider:'groq',model:String(k.model||'').startsWith('qwen/')?'qwen/qwen3.8-27b':modelDefault('groq'),endpoint:'',name:(k.name===apiKey||String(k.name||'').length>42)?'Groq Cloud key':k.name});
  }
  if(k.provider!=='gemini'&&/^AIzaSy/i.test(apiKey)){
   changed=true;
   return Object.assign({},k,{provider:'gemini',model:modelDefault('gemini'),endpoint:'',name:(k.name===apiKey||String(k.name||'').length>42)?'Google Gemini key':k.name});
  }
  if(k.provider==='groq'&&!k.model){changed=true;return Object.assign({},k,{model:modelDefault('groq'),endpoint:''});}
  if(k.provider==='gemini'&&!k.model){changed=true;return Object.assign({},k,{model:modelDefault('gemini'),endpoint:''});}
  return k;
 });
 if(changed)await set({[KEY]:list});
 return list;
}
async function persistKeys(v){await set({[KEY]:v});await renderKeys();}
async function renderKeys(){
 const host=$('ai-provider-key-list');if(!host)return;host.replaceChildren();const all=await keys();
 if(!all.length){host.appendChild(el('div','ai-empty','No API keys added. Add one or more keys below.'));return;}
 all.forEach(k=>{
  const row=el('div','ai-key-row'),meta=el('div','ai-key-meta'),controls=el('div','ai-key-controls');
  meta.appendChild(el('strong','',safeKeyName(k)));
  meta.appendChild(el('span','ai-muted',label(k.provider)+' · '+k.model));
  if(k.endpoint)meta.appendChild(el('span','ai-muted',k.endpoint));
  meta.appendChild(el('span','ai-muted','Saved key: ••••'+String(k.apiKey||'').slice(-4)));
  const lab=el('label','ai-toggle-label'),enabled=el('input');enabled.type='checkbox';enabled.checked=k.enabled!==false;enabled.setAttribute('aria-label','Enable '+safeKeyName(k));lab.appendChild(enabled);lab.appendChild(document.createTextNode(' Enabled'));controls.appendChild(lab);
  enabled.addEventListener('change',async()=>{const a=await keys();await persistKeys(a.map(x=>x.id===k.id?Object.assign({},x,{enabled:enabled.checked}):x));});
  const del=el('button','ai-small-btn ai-danger','Remove');del.type='button';del.addEventListener('click',async()=>{await persistKeys((await keys()).filter(x=>x.id!==k.id));say('API key removed.','success');});
  controls.appendChild(del);row.appendChild(meta);row.appendChild(controls);host.appendChild(row);
 });
}
function updateModelChoices(p){
 const list=$('ai-model-options');if(!list)return;list.replaceChildren();
 modelChoices(p).forEach(item=>{const opt=el('option');opt.value=item.id;opt.label=item.label;list.appendChild(opt);});
}
function updateProviderForm(){
 const p=$('ai-provider-type').value,m=$('ai-key-model'),ep=$('ai-key-endpoint');
 if(!m.value.trim()||m.dataset.provider!==p)m.value=modelDefault(p);
 m.dataset.provider=p;
 $('ai-key-endpoint-wrap').style.display=usesEndpoint(p)?'block':'none';
 if(usesEndpoint(p)&&(!ep.value.trim()||ep.dataset.provider!==p))ep.value=endpointDefault(p);
 ep.dataset.provider=p;
 updateModelChoices(p);
 $('ai-provider-hint').textContent=(PROVIDERS[p]?.hint||'Use a supported vision model and a reachable OpenAI-compatible endpoint.')+
  ' Use your own key. This provider may be paid; the extension cannot promise free quotas.';
}
async function askPermission(endpoint){
 let pattern;try{
  const u=new URL(endpoint);
  const localHost=['localhost','127.0.0.1','[::1]','::1'].includes(u.hostname);
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&localHost))throw new Error('Use HTTPS for remote APIs; HTTP is allowed only for localhost or 127.0.0.1.');
  // Chrome host permission patterns do not need an explicit port. Keep HTTP limited to loopback.
  const host=u.hostname==='::1'?'[::1]':u.hostname;
  pattern=u.protocol+'//'+host+'/*';
 }catch(e){throw new Error(e.message||'Enter a valid HTTPS or localhost HTTP endpoint.');}
 return await new Promise(resolve=>chrome.permissions.request({origins:[pattern]},resolve));
}
function makeKey(p,model,endpoint,apiKey,name){
 return {id:'key_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),provider:p,name:name||label(p)+' key',model,endpoint,apiKey,enabled:true};
}
async function checkProviderPermission(p,endpoint){
 if(isNativeProvider(p))return true;
 return await askPermission(endpoint||endpointDefault(p));
}
function connectionTestCandidates(provider,endpoint){
 const url=new URL(endpoint);
 let path=url.pathname;
 while(path.endsWith('/'))path=path.slice(0,-1);
 if(!path.toLowerCase().endsWith('/chat/completions'))url.pathname=path+'/chat/completions';
 const candidates=[url.toString()];
 const isLoopback=['localhost','127.0.0.1'].includes(url.hostname);
 if(provider==='freellmapi'&&url.protocol==='http:'&&isLoopback){
  for(const port of [url.port,'31415','3001']){
   if(!port)continue;
   const candidate=new URL(url.toString());candidate.port=port;
   candidates.push(candidate.toString());
  }
 }
 return [...new Set(candidates)];
}
async function testApiConnection(){
 const button=$('ai-test-api-btn'),provider=$('ai-provider-type').value;
 const apiKey=$('ai-key-value').value.trim();
 const model=$('ai-key-model').value.trim()||modelDefault(provider);
 const rawEndpoint=$('ai-key-endpoint').value.trim()||endpointDefault(provider);
 if(isNativeProvider(provider))return say('Choose an OpenAI-compatible provider to test its endpoint.','warning');
 if(!apiKey)return say('Enter your own provider / FreeLLMAPI API key before testing.','error');
 if(!model)return say('Enter a model ID first.','error');
 if(!rawEndpoint)return say('Enter the API endpoint first.','error');
 let candidates;
 try{candidates=connectionTestCandidates(provider,rawEndpoint);}catch(e){return say('Endpoint is not valid: '+(e.message||'check the URL'),'error');}
 let permission=false;
 try{permission=await askPermission(candidates[0]);}catch(e){return say(e.message||'Could not request API-host permission.','error');}
 if(!permission)return say('API-host permission denied; connection was not tested.','error');
 if(button){button.disabled=true;button.textContent='Testing…';}
 const testImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ioAAAAASUVORK5CYII=';
 let lastError='';
 try{
  for(const endpoint of candidates){
   try{
    const content=[{type:'text',text:provider==='freellmapi'?'Inspect the attached tiny test image and reply with the words: connection ok.':'Reply with the words: connection ok.'}];
    if(provider==='freellmapi')content.push({type:'image_url',image_url:{url:testImage}});
    const response=await post(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model,messages:[{role:'user',content}],temperature:0,max_tokens:32})},12000);
    const raw=await response.text();let data={};try{data=JSON.parse(raw);}catch(_){}
    if(!response.ok)throw new Error('HTTP '+response.status+': '+((data.error||{}).message||raw.slice(0,180)));
    const message=((((data.choices||[])[0]||{}).message||{}).content);
    const reply=Array.isArray(message)?message.map(x=>x.text||'').join(' ').trim():String(message||'').trim();
    if(!reply)throw new Error('The endpoint responded, but returned no chat content.');
    $('ai-key-endpoint').value=endpoint;$('ai-key-endpoint').dataset.provider=provider;
    return say((provider==='freellmapi'?'FreeLLMAPI connected; chat + image-input test passed at ':'API connection test passed at ')+endpoint+(provider==='freellmapi'?' · model '+model:''),'success');
   }catch(e){lastError=String(e&&e.message||e||'Unknown connection error');}
  }
  if(provider==='freellmapi'&&/no_vision_model|vision model|vision-capable/i.test(lastError)){
   throw new Error('The local router responded, but no vision-capable model is available. Enable a vision model in FreeLLMAPI fallback settings, then test again. Details: '+lastError);
  }
  throw new Error('Connection test failed. Check that FreeLLMAPI is running, the local API key is correct, and the endpoint/port is reachable. Details: '+lastError);
 }catch(e){say(e.message||'Connection test failed.','error');}
 finally{if(button){button.disabled=false;button.textContent='Test Connection';}}
}
async function addKey(){
 const selectedProvider=$('ai-provider-type').value,apiKey=$('ai-key-value').value.trim();
 if(!apiKey)return say('Enter an API key first.','error');
 let p=selectedProvider;
 if(/^gsk_/i.test(apiKey))p='groq';else if(/^AIzaSy/i.test(apiKey))p='gemini';
 if(p!==selectedProvider){$('ai-provider-type').value=p;updateProviderForm();say('Detected key format; provider switched to '+label(p)+'.','warning');}
 const model=$('ai-key-model').value.trim()||modelDefault(p),endpoint=usesEndpoint(p)?($('ai-key-endpoint').value.trim()||endpointDefault(p)):'';
 if(!model)return say('Enter the model ID.','error');
 let ok=false;try{ok=await checkProviderPermission(p,endpoint);}catch(e){return say(e.message,'error');}
 if(!ok)return say('API-host permission denied; key was not saved.','error');
 const item=makeKey(p,model,endpoint,apiKey,$('ai-key-name').value.trim()||label(p)+' key');
 const all=await keys();if(all.some(k=>k.provider===p&&k.apiKey===apiKey))return say('This provider key is already saved.','warning');
 all.push(item);await persistKeys(all);$('ai-key-value').value='';$('ai-key-name').value='';say('API key added. Multiple providers and keys are supported.','success');
}
async function addBulkKeys(){
 const p=$('ai-provider-type').value,model=$('ai-key-model').value.trim()||modelDefault(p),endpoint=usesEndpoint(p)?($('ai-key-endpoint').value.trim()||endpointDefault(p)):'';
 const raw=$('ai-key-bulk').value;
 const entries=raw.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map((line,index)=>{
  const split=line.indexOf('|');
  if(split<0)return {name:'',apiKey:line};
  return {name:line.slice(0,split).trim(),apiKey:line.slice(split+1).trim()};
 }).filter(item=>item.apiKey);
 if(!entries.length)return say('Paste one API key per line in the bulk box first.','error');
 if(!model)return say('Enter the model ID for this provider.','error');
 let ok=false;try{ok=await checkProviderPermission(p,endpoint);}catch(e){return say(e.message,'error');}
 if(!ok)return say('API-host permission denied; no keys were added.','error');
 const all=await keys();let added=0,duplicates=0;
 entries.forEach((entry,index)=>{
  if(all.some(k=>k.provider===p&&k.apiKey===entry.apiKey)){duplicates++;return;}
  const name=entry.name||((label(p))+' key '+(all.filter(k=>k.provider===p).length+1));
  all.push(makeKey(p,model,endpoint,entry.apiKey,name));added++;
 });
 if(added)await persistKeys(all);
 $('ai-key-bulk').value='';
 say('Bulk add complete: '+added+' added'+(duplicates?', '+duplicates+' duplicate(s) skipped':'')+'.',added?'success':'warning');
}
const DEFAULT_FIELD_MAP={
 'ai-default-brand':'brand','ai-default-seller-name':'sellerName','ai-default-seller-address':'sellerAddress',
 'ai-default-manufacturer-name':'manufacturerName','ai-default-manufacturer-address':'manufacturerAddress',
 'ai-default-manufacturer-pincode':'manufacturerPincode','ai-default-packer-name':'packerName',
 'ai-default-packer-address':'packerAddress','ai-default-packer-pincode':'packerPincode',
 'ai-default-country':'countryOfOrigin','ai-default-importer-name':'importerName',
 'ai-default-importer-address':'importerAddress','ai-default-importer-pincode':'importerPincode',
 'ai-default-support-phone':'supportPhone','ai-default-support-email':'supportEmail','ai-default-hsn':'hsn','ai-default-gst':'gst'
};
const OVERRIDE_FIELD_MAP={
 'ai-override-brand':'brand','ai-override-country':'countryOfOrigin',
 'ai-override-manufacturer-name':'manufacturerName','ai-override-manufacturer-address':'manufacturerAddress','ai-override-manufacturer-pincode':'manufacturerPincode',
 'ai-override-packer-name':'packerName','ai-override-packer-address':'packerAddress','ai-override-packer-pincode':'packerPincode',
 'ai-override-importer-name':'importerName','ai-override-importer-address':'importerAddress','ai-override-importer-pincode':'importerPincode'
};
function readMappedFields(map){
 const obj={};Object.entries(map).forEach(([id,key])=>{if($(id))obj[key]=String($(id).value||'').trim();});return obj;
}
function fillMappedFields(map,obj){
 Object.entries(map).forEach(([id,key])=>{if($(id))$(id).value=String((obj&&obj[key])||'');});
}
function makeProfileId(){return 'seller-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);}
function currentSellerIdentity(){
 return typeof sellerIdentity==='function'?sellerIdentity():'';
}
function scopedSellerKey(base){
 const identity=currentSellerIdentity();
 const token=(identity||'legacy').replace(/[^a-z0-9_-]/g,'_').slice(0,120);
 return base+'__'+token;
}
function profileDbKey(){return scopedSellerKey(PROFILE_DB);}
function defaultsStoreKey(){return scopedSellerKey(DEFAULTS);}
async function readProfileStore(){
 const identity=currentSellerIdentity(),ownerKey=PROFILE_OWNER;
 const dbKey=profileDbKey(),r=await get([dbKey,PROFILE_DB,ownerKey]);
 let db=r[dbKey];
 if(!db){
  const owner=String(r[ownerKey]||'');
  if(owner&&identity&&owner!==identity)db={activeId:'',profiles:[]};
  else db=r[PROFILE_DB];
 }
 if(!db||!Array.isArray(db.profiles))db={activeId:'',profiles:[]};
 return db;
}
function selectedProfile(db=profileCache){
 if(!db||!Array.isArray(db.profiles))return null;
 return db.profiles.find(p=>p.id===((db&&db.activeId)||$('ai-profile-select')?.value))||db.profiles[0]||null;
}
function renderProfileSelector(db){
 const select=$('ai-profile-select');if(!select)return;
 select.replaceChildren();
 (db.profiles||[]).forEach(p=>{const opt=el('option');opt.value=p.id;opt.textContent=p.name||'Seller Profile';select.appendChild(opt);});
 const active=db.activeId||((db.profiles[0]||{}).id)||'';
 if(active)select.value=active;
}
function fillOverrideEditor(profile,category){
 const override=((profile||{}).categoryOverrides||{})[category]||{};
 fillMappedFields(OVERRIDE_FIELD_MAP,override);
}
async function loadSelectedProfile(){
 const db=await readProfileStore();profileCache=db;
 const id=$('ai-profile-select')&&$('ai-profile-select').value;
 const profile=db.profiles.find(p=>p.id===id)||db.profiles[0];
 if(!profile)return;
 db.activeId=profile.id;profileCache=db;
 $('ai-profile-name').value=profile.name||'Seller Profile';
 fillMappedFields(DEFAULT_FIELD_MAP,profile.defaults||{});
 fillOverrideEditor(profile,$('ai-profile-category').value||'general');
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:profile.defaults||{}});
 say('Loaded seller profile: '+(profile.name||'Seller Profile')+'.','success');
}
async function loadCategoryOverride(){
 const db=profileCache||await readProfileStore(),profile=db.profiles.find(p=>p.id===$('ai-profile-select').value)||db.profiles[0];
 fillOverrideEditor(profile,$('ai-profile-category').value||'general');
}
async function loadDefaults(){
 const identity=currentSellerIdentity(),owner=String((await get(PROFILE_OWNER))[PROFILE_OWNER]||'');
 const legacyAllowed=!(owner&&identity&&owner!==identity);
 const keys=[defaultsStoreKey(),profileDbKey(),DEFAULTS,PROFILE_DB,PROFILE_OWNER];
 const r=await get(keys);
 const legacy=r[defaultsStoreKey()]||((legacyAllowed)?r[DEFAULTS]||{}:{});
 let db=r[profileDbKey()]||((legacyAllowed)?r[PROFILE_DB]:null);
 if(!db||!Array.isArray(db.profiles)||!db.profiles.length){
  db={activeId:'profile-default',profiles:[{id:'profile-default',name:legacy.sellerName||'Default Seller Profile',defaults:legacy,categoryOverrides:{}}]};
 }else{
  db.profiles=db.profiles.map(p=>Object.assign({id:makeProfileId(),name:'Seller Profile',defaults:{},categoryOverrides:{}},p));
  if(!db.profiles.some(p=>p.id===db.activeId))db.activeId=db.profiles[0].id;
 }
 profileCache=db;renderProfileSelector(db);
 const active=selectedProfile(db);
 if(active){$('ai-profile-name').value=active.name||'Default Seller Profile';fillMappedFields(DEFAULT_FIELD_MAP,active.defaults||legacy);}
 else{$('ai-profile-name').value='Main Seller Profile';fillMappedFields(DEFAULT_FIELD_MAP,{});}
 fillOverrideEditor(active,$('ai-profile-category').value||'general');
 if(identity){
  const migratedLegacy=!owner&&(Boolean(r[DEFAULTS])||Boolean(r[PROFILE_DB]));
  const scopedValues={[profileDbKey()]:db,[defaultsStoreKey()]:(active&&active.defaults)||legacy};
  if(migratedLegacy)scopedValues[PROFILE_OWNER]=identity;
  await set(scopedValues);
 }
}
async function persistActiveProfileDefaults(d,successMessage){
 const db=profileCache||await readProfileStore(),profile=db.profiles.find(p=>p.id===$('ai-profile-select').value)||db.profiles[0];
 if(!profile)throw new Error('Create a seller profile first.');
 profile.name=String($('ai-profile-name').value||'').trim()||'Seller Profile';
 profile.defaults=d;db.activeId=profile.id;profileCache=db;
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:d});
 renderProfileSelector(db);if($('ai-profile-select'))$('ai-profile-select').value=profile.id;
 if(successMessage)say(successMessage,'success');
}
async function saveDefaults(){
 const d=readMappedFields(DEFAULT_FIELD_MAP);
 await persistActiveProfileDefaults(d,'Seller defaults saved to the active local profile.');
}
async function saveProfile(){
 const d=readMappedFields(DEFAULT_FIELD_MAP),db=profileCache||await readProfileStore();
 let profile=db.profiles.find(p=>p.id===$('ai-profile-select').value)||db.profiles[0];
 if(!profile){profile={id:makeProfileId(),name:'Seller Profile',defaults:{},categoryOverrides:{}};db.profiles.push(profile);}
 profile.name=String($('ai-profile-name').value||'').trim()||'Seller Profile';
 profile.defaults=d;profile.categoryOverrides=profile.categoryOverrides||{};db.activeId=profile.id;profileCache=db;
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:d});
 renderProfileSelector(db);$('ai-profile-select').value=profile.id;
 say('Profile "'+profile.name+'" saved locally with base seller/legal details.','success');
}
async function createProfile(){
 const current=readMappedFields(DEFAULT_FIELD_MAP),db=profileCache||await readProfileStore();
 const profile={id:makeProfileId(),name:'New Seller Profile',defaults:current,categoryOverrides:{}};
 db.profiles.push(profile);db.activeId=profile.id;profileCache=db;
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:current});
 renderProfileSelector(db);$('ai-profile-select').value=profile.id;$('ai-profile-name').value=profile.name;
 fillMappedFields(DEFAULT_FIELD_MAP,current);fillOverrideEditor(profile,$('ai-profile-category').value||'general');
 say('New profile created. Edit the base details, then Save / Update Profile.','success');
}
async function deleteProfile(){
 const db=profileCache||await readProfileStore(),id=$('ai-profile-select').value;
 if(db.profiles.length<=1){say('Keep at least one seller profile. You can clear or replace its details instead.','warning');return;}
 const profile=db.profiles.find(p=>p.id===id);if(!profile)return;
 if(!confirm('Delete profile "'+(profile.name||'Seller Profile')+'" and its category overrides from this Chrome profile?'))return;
 db.profiles=db.profiles.filter(p=>p.id!==id);db.activeId=db.profiles[0].id;profileCache=db;
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:db.profiles[0].defaults||{}});
 renderProfileSelector(db);$('ai-profile-select').value=db.activeId;await loadSelectedProfile();
 say('Seller profile deleted.','success');
}
async function saveCategoryOverride(){
 const category=$('ai-profile-category').value||'general',db=profileCache||await readProfileStore();
 const profile=db.profiles.find(p=>p.id===$('ai-profile-select').value)||db.profiles[0];
 if(!profile)throw new Error('Create a seller profile first.');
 // Save edited base fields alongside the override to prevent unsaved work being lost.
 profile.name=String($('ai-profile-name').value||'').trim()||profile.name||'Seller Profile';
 profile.defaults=readMappedFields(DEFAULT_FIELD_MAP);
 profile.categoryOverrides=profile.categoryOverrides||{};
 const override=readMappedFields(OVERRIDE_FIELD_MAP);
 if(Object.values(override).some(v=>String(v||'').trim()))profile.categoryOverrides[category]=override;
 else delete profile.categoryOverrides[category];
 db.activeId=profile.id;profileCache=db;
 await set({[profileDbKey()]:db,[defaultsStoreKey()]:profile.defaults});
 renderProfileSelector(db);$('ai-profile-select').value=profile.id;$('ai-profile-name').value=profile.name;
 say('Saved category-specific overrides for '+($('ai-profile-category').selectedOptions[0]?.textContent||category)+'. Blank override fields use the profile base details.','success');
}
async function getActiveDefaultsForCategory(category){
 const db=profileCache||await readProfileStore(),profile=db.profiles.find(p=>p.id===((db.activeId)||$('ai-profile-select')?.value))||db.profiles[0];
 const stored=await get(defaultsStoreKey()),base=Object.assign({},stored[defaultsStoreKey()]||{},profile&&profile.defaults||{});
 const override=(profile&&profile.categoryOverrides&&profile.categoryOverrides[category])||{};
 Object.entries(override).forEach(([key,value])=>{if(String(value||'').trim())base[key]=String(value).trim();});
 return base;
}
const readImage=async file=>{
 const readAsDataUrl=blob=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||''));
  reader.onerror=()=>reject(new Error('Could not read image: '+file.name));
  reader.readAsDataURL(blob);
 });
 // Optimize only the in-memory AI copy. The seller's original upload is never modified.
 // Free/local vision routers may reject large image payloads (HTTP 413), so use a compact 1024px JPEG.
 try{
  if(typeof createImageBitmap==='function'){
   const bitmap=await createImageBitmap(file);
   const maxEdge=1024,scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
   if(scale<1||file.size>180*1024){
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx){bitmap.close();throw new Error('Canvas unavailable');}
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.68));
    if(blob&&(blob.size<file.size||scale<1)){
     liveLog('IMAGE OPTIMIZATION · '+file.name+' → '+canvas.width+'×'+canvas.height+', '+Math.round(blob.size/1024)+' KB JPEG for the AI request.','info');
     return {name:file.name,mimeType:blob.type||'image/jpeg',dataUrl:await readAsDataUrl(blob)};
    }
   }else bitmap.close();
  }
 }catch(e){liveLog('IMAGE OPTIMIZATION · '+file.name+' could not be compressed; using the original for this attempt.','warn');}
 return {name:file.name,mimeType:file.type||'image/jpeg',dataUrl:await readAsDataUrl(file)};
};
async function images(){
 const files=Array.from($('ai-product-images').files||[]);if(!files.length)throw new Error('Upload at least one product photo.');if(files.length>10)throw new Error('Upload no more than 10 photos of the same product at once.');
 for(const f of files){if(!['image/jpeg','image/png','image/webp'].includes(f.type))throw new Error('Use JPG, PNG, WEBP or GIF: '+f.name);if(f.size>8*1024*1024)throw new Error(f.name+' is over 8 MB.');}
 liveLog('Loading '+files.length+' photos for one product.','info');
 const all=await Promise.all(files.map(readImage));const host=$('ai-image-list');host.replaceChildren();all.forEach((i,n)=>host.appendChild(el('span','ai-image-chip',(n+1)+'. '+i.name)));
 liveLog('Image set ready: '+all.length+' photo(s).','ok');return all;
}
function isGarmentMeasurement(f){
 const x=norm((f.label||'')+' '+String(f.identifier||'').replace(/_/g,' '));
 return /\b(bust|shoulder|hip|waist|sleeve|inseam|garment|kurta|chest|dress size|bottom|size length|armhole|thigh|outseam|rise)\b/i.test(x);
}
function schema(scan){
 const fields=[],measurements=[];
 (scan.sections||[]).forEach(s=>(s.fields||[]).forEach(f=>{
  const a={identifier:f.identifier||f.id,label:f.label||f.identifier||f.id,mandatory:!!f.mandatory,inputType:f.inputType||'text',values:Array.isArray(f.values)?f.values:[],section:s.label||s.id||''};
  if(!a.identifier)return;
  // Keep actual garment-size chart measurements separate; still expose net weight,
  // catalog pricing and other product-level fields in the AI field schema.
  if(s.id==='product_size_data'&&isGarmentMeasurement(a))measurements.push(a);else fields.push(a);
 }));
 return {fields,measurements};
}
function variationNames(scan){
 const section=(scan&&scan.sections||[]).find(s=>s.id==='variations');
 return Array.isArray(section&&section.data)?section.data.map(x=>String(x||'').trim()).filter(Boolean):[];
}
function selectedVariationSizes(){
 const host=$('ai-variation-sizes');
 const selected=host?Array.from(host.querySelectorAll('input.ai-variation-size-cb:checked')).map(x=>x.value):[];
 if(selected.length)return selected;
 const names=variationNames(scanNow);
 return names.length===1&&norm(names[0])==='free size'?[names[0]]:[];
}
function syncLegacySizeCheckboxes(){
 const selected=selectedVariationSizes();
 const legacy=Array.from(document.querySelectorAll('.size-cb'));
 if(legacy.length){
  legacy.forEach(cb=>{cb.checked=selected.some(v=>norm(v)===norm(cb.value));});
  if(typeof renderSizeMeasurements==='function')renderSizeMeasurements(selected.join(','));
 }
}
function renderAiVariationSizes(scan){
 const host=$('ai-variation-sizes');if(!host)return;
 const prior=Array.from(host.querySelectorAll('input.ai-variation-size-cb:checked')).map(x=>x.value);
 const legacy=Array.from(document.querySelectorAll('.size-cb:checked')).map(x=>x.value);
 const sizes=variationNames(scan),remembered=prior.length?prior:legacy;
 host.replaceChildren();
 if(!sizes.length){host.appendChild(el('span','ai-muted','No size options detected on the selected catalog.'));return;}
 let selected=remembered.filter(x=>sizes.some(sz=>norm(sz)===norm(x)));
 if(!selected.length&&sizes.length===1&&norm(sizes[0])==='free size')selected=[sizes[0]];
 sizes.forEach(size=>{
  const label=el('label','ai-size-option'),cb=el('input');
  cb.type='checkbox';cb.className='ai-variation-size-cb';cb.value=size;cb.checked=selected.some(x=>norm(x)===norm(size));
  cb.addEventListener('change',syncLegacySizeCheckboxes);
  label.appendChild(cb);label.appendChild(document.createTextNode(size));host.appendChild(label);
 });
 syncLegacySizeCheckboxes();
}

function updateScanSummary(scan){
 const host=$('ai-scan-summary');if(!host)return;
 const fields=[];(scan.sections||[]).forEach(s=>(s.fields||[]).forEach(f=>fields.push(f)));
 const values=scan.capturedValues||{};
 const blank=fields.filter(f=>!String(values[f.identifier||f.id]||'').trim()).length;
 const required=fields.filter(f=>f.mandatory&&!String(values[f.identifier||f.id]||'').trim()).length;
 const sizes=(scan.sections||[]).find(s=>s.id==='variations');
 const detected=detectMeeshoCatalog(scan);
 const confidence=detected.confidence==='low'?'form/photo confirmation may help':detected.confidence+' confidence';
 host.textContent='Auto-detected from selected Meesho catalog: '+detected.name+' · '+confidence+' · '+fields.length+' fields · '+blank+' blank · '+required+' mandatory blank'+(sizes&&sizes.data&&sizes.data.length?' · '+sizes.data.length+' size options':'')+'.';
 renderAiVariationSizes(scan);
}
async function scanCurrentCatalog(showMessage){
 const access=await chrome.runtime.sendMessage({type:'GET_ACCESS'});if(!access||!access.allowed)throw new Error('Active membership required.');
 const tabs=await new Promise(r=>chrome.tabs.query({active:true,currentWindow:true},t=>r(t||[]))),tab=tabs[0];
 if(!tab||!tab.url||!tab.url.includes('supplier.meesho.com'))throw new Error('Open Meesho Seller Panel and select the catalog first.');
 const scan=await new Promise((resolve,reject)=>chrome.tabs.sendMessage(tab.id,{type:'SCAN_FORM'},r=>{if(chrome.runtime.lastError)return reject(new Error('Could not scan the Meesho page. Refresh the page and retry.'));if(!r||r.error||!Array.isArray(r.sections))return reject(new Error((r&&r.error)||'No form schema detected. Select a catalog first.'));resolve(r);}));
 await set({last_scan_result:scan});scanNow=scan;updateScanSummary(scan);
 if(typeof renderStructuredForm==='function')renderStructuredForm(scan);
 syncLegacySizeCheckboxes();
 if(showMessage)say('Catalog form scanned. Review product fields and selected size variants above.','success');
 return scan;
}
function convertUnit(value,label,source){
 const n=Number(value);if(!Number.isFinite(n))return String(value);
 const s=norm(label);let v=n;
 if(source==='g'){if(/\bkg\b|kilogram/.test(s))v=n/1000;else if(/\bmg\b|milligram/.test(s))v=n*1000;}
 if(source==='cm'){if(/\bmm\b|millimeter|millimetre/.test(s))v=n*10;else if(/\bin\b|inch|inches/.test(s))v=n/2.54;else if(/\b(m|meter|metre)\b/.test(s))v=n/100;}
 return String(Number(v.toFixed(4)));
}
function capacityInMl(value){
 const m=String(value||'').trim().match(/(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i);
 if(!m)return null;const n=Number(m[1]);if(!Number.isFinite(n)||n<=0)return null;
 return /^m/i.test(m[2])?n:n*1000;
}
function exactUnitOption(field,candidates){
 const options=Array.isArray(field.values)?field.values:[];
 for(const candidate of candidates){
  const hit=options.find(o=>norm(o)===norm(candidate));
  if(hit!==undefined)return String(hit);
 }
 return options.length?'':String(candidates[0]||'');
}
function exactPackQuantityOption(field,count){
 const n=Math.max(1,Math.floor(Number(count)||1)),options=Array.isArray(field.values)?field.values:[];
 const aliases=new Set([
  norm('Pack Of '+n),norm('Pack of '+n+' Pieces'),norm('Pack of '+n+' Pcs'),
  norm('Pack of '+n+' piece'),norm('Set of '+n),norm(n+' Pieces'),norm(n+' Pcs'),norm(String(n))
 ]);
 const match=options.find(option=>aliases.has(norm(option)));
 if(match!==undefined)return String(match);
 return options.length?'':'Pack Of '+n;
}
function exactCapacityOption(field,ml,label){
 const options=Array.isArray(field.values)?field.values:[];
 const x=norm(label),isLitres=/capacity_in_l|capacity in l|\b(in l|litre|liter)\b/.test(x),isMl=/\bml\b|milliliter|millilitre/.test(x);
 for(const option of options){
  const optionMl=capacityInMl(option);
  if(optionMl!==null&&Math.abs(optionMl-ml)<0.01)return String(option);
  const number=String(option||'').trim().match(/^\d+(?:\.\d+)?$/);
  if(number&&isLitres&&Math.abs(Number(number[0])*1000-ml)<0.01)return String(option);
  if(number&&isMl&&Math.abs(Number(number[0])-ml)<0.01)return String(option);
 }
 if(!options.length){
  if(isLitres)return String(Number((ml/1000).toFixed(4)));
  if(isMl)return String(Number(ml.toFixed(4)));
 }
 return '';
}

function fieldText(f){return norm(String(f.identifier||'').replace(/_/g,' ')+' '+String(f.label||''));}
function isPhysicalMeasureField(f){
 const x=fieldText(f);
 if(/\b(bust|shoulder|hip|waist|sleeve|inseam|garment|kurta|chest|dress size|bottom|size chart|armhole|thigh|outseam|rise)\b/.test(x))return false;
 if(/\b(weight unit|volume unit|product unit|dimension unit)\b/.test(x))return false;
 return /\b(product weight|net weight|gross weight|package weight|shipping weight|product height|product length|product breadth|product width|product depth|package height|package length|package breadth|package width|item dimensions|product dimensions)\b/.test(x)||
  /\b(product_weight_in_gms|product_weight|product_height|product_length|product_breadth|product_width|product_depth)\b/.test(String(f.identifier||''));
}
function sourceSupportsExactMeasure(field,candidate,research){
 const label=fieldText(field),value=String(candidate||'').trim(),unit=/weight/.test(label)?'(?:g|gm|gms|gram|grams|kg|kilogram)':'(?:mm|cm|in|inch|inches|m|meter|meters|metre|metres)';
 const n=value.match(/\d+(?:\.\d+)?/);if(!n)return false;
 return (research.results||[]).some(r=>{
  const text=(r.title+' '+r.snippet).replace(/,/g,' ');
  const escaped=n[0].replace('.','\\.');
  const regex=new RegExp('(?:^|\\D)'+escaped+'\\s*'+unit+'\\b','i');
  return regex.test(text);
 });
}

function measurementUnitToCm(value,unit){
 const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;
 const u=norm(unit);
 if(/\bmm\b|millimet/.test(u))return n/10;
 if(/\binch|inches|\bin\b/.test(u))return n*2.54;
 if(/\bm\b|meter|metre/.test(u)&&!/\bcm\b/.test(u))return n*100;
 return n;
}
function medianNumber(values){
 const nums=values.map(Number).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);if(!nums.length)return null;
 const mid=Math.floor(nums.length/2);return nums.length%2?nums[mid]:(nums[mid-1]+nums[mid])/2;
}
function measureDimensionKind(field){
 const x=fieldText(field);
 if(/\b(product|item|package|parcel|shipping|gross|net|product_weight|weight_in_gms)\b/.test(x)&&/\bweight\b|weight_in_gms/.test(x))return 'weight';
 if(/\b(product|item|package|parcel|dimension|product_length|length)\b/.test(x)&&/\b(length|len)\b/.test(x))return 'length';
 if(/\b(product|item|package|dimension|product_breadth|breadth|width)\b/.test(x)&&/\b(breadth|width)\b/.test(x))return 'breadth';
 if(/\b(product|item|package|dimension|product_height|height)\b/.test(x)&&/\b(height)\b/.test(x))return 'height';
 return '';
}
function buildMeasurementEstimates(research,fields,scan){
 const results=Array.isArray(research&&research.results)?research.results:[],domains=new Set(),observed={length:[],breadth:[],height:[],weight:[]};
 const add=(kind,value,unit,row)=>{
  const domain=String(row.domain||(()=>{try{return new URL(row.url).hostname;}catch(e){return 'unknown';}})());
  if(!value||!Number.isFinite(Number(value))||Number(value)<=0)return;
  observed[kind].push({value:Number(value),unit,domain,url:row.url||'',title:row.title||'',snippet:row.snippet||''});domains.add(domain);
 };
 results.forEach(row=>{
  const text=String(row.title||'')+' '+String(row.snippet||'');
  const triplet=/(\d+(?:\.\d+)?)\s*(?:[x×*])\s*(\d+(?:\.\d+)?)\s*(?:[x×*])\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|mm|millimeters?|millimetres?|inches?|in\b)/i.exec(text);
  if(triplet){
   const unit=triplet[4],values=[measurementUnitToCm(triplet[1],unit),measurementUnitToCm(triplet[2],unit),measurementUnitToCm(triplet[3],unit)];
   ['length','breadth','height'].forEach((kind,i)=>{if(values[i]&&values[i]<=300)add(kind,values[i],'cm',row);});
  }
  const labels=[
   ['length',/(?:product\s*)?(?:length|len)\s*[:= -]?\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|mm|millimeters?|millimetres?|inches?|in\b)/i],
   ['breadth',/(?:product\s*)?(?:breadth|width)\s*[:= -]?\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|mm|millimeters?|millimetres?|inches?|in\b)/i],
   ['height',/(?:product\s*)?height\s*[:= -]?\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|mm|millimeters?|millimetres?|inches?|in\b)/i]
  ];
  labels.forEach(([kind,re])=>{const m=re.exec(text);if(m){const value=measurementUnitToCm(m[1],m[2]);if(value&&value<=300)add(kind,value,'cm',row);}});
  const wm=/(?:net|product|item|gross|package|shipping)?\s*weight\s*[:= -]?\s*(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|g|gm|gms|grams?)\b/i.exec(text);
  if(wm){const n=Number(wm[1])*(/^k/i.test(wm[2])?1000:1);if(n>0&&n<=500000)add('weight',n,'g',row);}
 });
 // Use at most one observation per domain and measurement kind to reduce duplicated listings.
 const unique={};Object.keys(observed).forEach(kind=>{
  const perDomain=new Map();observed[kind].forEach(item=>{if(!perDomain.has(item.domain))perDomain.set(item.domain,item);});
  unique[kind]=Array.from(perDomain.values());
 });
 const dimensionUnitField=(fields||[]).find(f=>/\b(product unit|dimension unit|measurement unit)\b/.test(fieldText(f)));
 const weightUnitField=(fields||[]).find(f=>/\b(product weight unit|weight unit)\b/.test(fieldText(f)));
 const captured=scan&&scan.capturedValues||{};
 const rawDimUnit=dimensionUnitField?String(captured[dimensionUnitField.identifier]||'cm').toLowerCase():'cm';
 const rawWeightUnit=weightUnitField?String(captured[weightUnitField.identifier]||'g').toLowerCase():'g';
 const targetDimUnit=/inch|\bin\b/.test(rawDimUnit)?'in':/\bmm\b/.test(rawDimUnit)?'mm':'cm';
 const targetWeightUnit=/^k|kilogram/.test(rawWeightUnit)?'kg':'g';
 const estimates={};
 (fields||[]).forEach(field=>{
  if(!isPhysicalMeasureField(field))return;
  const kind=measureDimensionKind(field);if(!kind||!unique[kind]||!unique[kind].length)return;
  const central=medianNumber(unique[kind].map(x=>x.value));if(!central)return;
  let value=central,unit=kind==='weight'?'g':'cm';
  if(kind==='weight'&&targetWeightUnit==='kg'){value=central/1000;unit='kg';}
  else if(kind!=='weight'&&targetDimUnit==='in'){value=central/2.54;unit='in';}
  else if(kind!=='weight'&&targetDimUnit==='mm'){value=central*10;unit='mm';}
  estimates[field.identifier]={
   value:String(Number(value.toFixed(2))),unit,kind,estimated:true,
   sourceCount:unique[kind].length,confidence:unique[kind].length>=3?'medium':unique[kind].length>=2?'low':'low',
   sourceUrls:unique[kind].slice(0,5).map(x=>x.url).filter(Boolean),
   reason:'Estimated from similar category products; not an exact measurement of the uploaded item.'
  };
 });
 return estimates;
}

function clearNeedsForField(needs,identifier){
 if(!Array.isArray(needs))return;
 for(let i=needs.length-1;i>=0;i--)if(needs[i]&&needs[i].identifier===identifier)needs.splice(i,1);
}
function parseMoney(value){
 const cleaned=String(value??'').replace(/[₹,\s]/g,'').replace(/[^0-9.-]/g,'');
 const n=Number(cleaned);return Number.isFinite(n)?n:null;
}
function formatMoney(value){
 const n=Number(value);if(!Number.isFinite(n))return '';
 return String(Number(n.toFixed(2)));
}
function calculateWrongReturnPrice(sellingPrice){
 const n=parseMoney(sellingPrice);
 return n!==null&&n>5?formatMoney(n-5):'';
}
function updatePricePreview(){
 const price=$('ai-product-price'),target=$('ai-product-return-price');
 if(!price||!target)return;
 target.value=calculateWrongReturnPrice(price.value);
 target.placeholder=String(price.value||'').trim()?'Calculated automatically':'Enter selling price first';
 if(String(price.value||'').trim()&&parseMoney(price.value)<=5)target.title='Selling price must be more than ₹5 to subtract ₹5 safely.';
 else target.title='Always calculated as selling price minus ₹5.';
}

function preset(f,p,d){
 const x=norm(f.label+' '+String(f.identifier||'').replace(/_/g,' ')),garment=/(bust|shoulder|hip|waist|sleeve|inseam|garment|kurta|chest|dress size|bottom|size chart|size length|armhole|thigh|outseam|rise)/i.test(x),explicitDimension=/(product|item|package|parcel|shipping|dimension|\bcm\b|\bmm\b|\binches?\b|\bmeters?\b|\bmetres?\b)/i.test(x);
 if(p.productName&&/(product name|product_name)/.test(x))return p.productName;
 if(/brand( name)?/.test(x)&&d.brand)return d.brand;
 if(/(seller name|seller legal name|merchant name|seller company)/.test(x)&&d.sellerName)return d.sellerName;
 if(/(seller address|seller registered address|merchant address)/.test(x)&&d.sellerAddress)return d.sellerAddress;
 if(/(manufacturer( name)?|manufactured by)/.test(x)&&!/(address|pincode|pin code|postal code|zip|date)/.test(x)&&d.manufacturerName)return d.manufacturerName;
 if(/manufacturer pincode|manufacturer pin code|manufacturer postal code/.test(x)&&d.manufacturerPincode)return d.manufacturerPincode;
 if(/(packer( name)?|packed by)/.test(x)&&!/(address|pincode|pin code|postal code|zip|date)/.test(x)&&d.packerName)return d.packerName;
 if(/(packer address|packing address)/.test(x)&&!/(pincode|pin code|postal code|zip)/.test(x)&&d.packerAddress)return d.packerAddress;
 if(/packer pincode|packer pin code|packer postal code/.test(x)&&d.packerPincode)return d.packerPincode;
 if(/importer( name)?/.test(x)&&!/(address|pincode|pin code|postal code|zip)/.test(x)&&d.importerName)return d.importerName;
 if(/importer address/.test(x)&&d.importerAddress)return d.importerAddress;
 if(/importer pincode|importer pin code|importer postal code/.test(x)&&d.importerPincode)return d.importerPincode;
 if(/(country of origin|origin country|made in)/.test(x)&&d.countryOfOrigin)return d.countryOfOrigin;
 if(/(customer care phone|support phone|customer care number|contact phone)/.test(x)&&d.supportPhone)return d.supportPhone;
 if(/(customer care email|support email|contact email)/.test(x)&&d.supportEmail)return d.supportEmail;
 if(/\bhsn\b|hsn code/i.test(x)&&d.hsn)return d.hsn;if(/\bgst\b|gst rate|gst percentage/i.test(x)&&d.gst)return d.gst;
 if(/(wrong|defective|return)/.test(x)&&/price/.test(x)&&p.sellingPrice)return p.wrongReturnPrice||'';
 if(/\bmrp\b|maximum retail price/.test(x)&&p.productMrp)return p.productMrp;
 if(/\b(net quantity|multipack|pack quantity|pack of|number of pieces|pieces per pack)\b/.test(x)&&p.packQuantity){
  const count=Math.max(1,Math.floor(Number(p.packQuantity)||1));
  const option=exactPackQuantityOption(f,count);
  if(option)return option;
 }
 if(/\binventory\b|stock quantity/.test(x))return String(p.inventory===undefined||p.inventory===null||p.inventory===''?100:p.inventory);
 if(p.sellingPrice&&/(meesho price|selling price|transfer price|meesho_price|selling_price)/.test(x)&&!/(\bmrp\b|wrong|defective|return)/.test(x))return p.sellingPrice;
 const capMl=capacityInMl(p.productCapacity);if(capMl!==null&&/(capacity|volume)/.test(x)){const option=exactCapacityOption(f,capMl,x);if(option)return option;}
 if(/\bweight unit\b/.test(x)&&p.productWeight){const unit=exactUnitOption(f,['g','gm','gms','gram','grams','Grams','Gms']);if(unit)return unit;}
 if(/\bvolume unit\b/.test(x)&&capMl!==null){const unit=exactUnitOption(f,capMl>=1000?['L','l','Liter','Liters','Litre','Litres']:['ml','mL','ML','Milliliter','Millilitre']);if(unit)return unit;}
 if(/\bproduct unit\b/.test(x)&&(p.productLength||p.productWidth||p.productHeight)){const unit=exactUnitOption(f,['cm','CM','Cm','centimeter','centimeters','centimetre','centimetres']);if(unit)return unit;}
 if(p.material&&/(material|fabric type|material type)/.test(x))return p.material;if(p.color&&/(colour|color)/.test(x))return p.color;
 if(!/\b(weight unit|volume unit|product unit|dimension unit)\b/.test(x)&&!garment&&p.productWeight&&/weight/.test(x)&&!/(package|packaging|shipping|gross)/.test(x))return convertUnit(p.productWeight,x,'g');
 if(!garment&&explicitDimension&&p.productLength&&/\blength\b/.test(x))return convertUnit(p.productLength,x,'cm');
 if(!garment&&explicitDimension&&p.productWidth&&/\bwidth\b/.test(x))return convertUnit(p.productWidth,x,'cm');
 if(!garment&&explicitDimension&&p.productHeight&&/\bheight\b/.test(x))return convertUnit(p.productHeight,x,'cm');
 if(p.productFacts&&/(product details|additional details|product description|product information)/.test(x))return p.productFacts;
 return '';
}
function captured(scan,id){const v=(scan.capturedValues||{})[id];return v===undefined||v===null?'':String(v).trim();}
function safeMeeshoCatalogContext(context={}){
 return {
  pageTitle:String(context.pageTitle||'').slice(0,120),
  headings:Array.isArray(context.headings)?context.headings.map(x=>String(x||'').slice(0,100)).slice(0,12):[],
  breadcrumb:String(context.breadcrumb||'').slice(0,180),
  categoryName:String(context.categoryName||'').slice(0,100),
  subCategoryName:String(context.subCategoryName||'').slice(0,100),
  catalogType:String(context.catalogType||'').slice(0,100),
  detectedCategory:String(context.detectedCategory||'').slice(0,100),
  productType:String(context.productType||'').slice(0,100),
  confidence:String(context.confidence||'').slice(0,16)
 };
}
function detectMeeshoCatalog(scan){
 const sections=Array.isArray(scan&&scan.sections)?scan.sections:[];
 const fields=sections.flatMap(sec=>(sec.fields||[]).map(f=>({id:String(f.identifier||f.id||''),label:String(f.label||f.name||''),values:Array.isArray(f.values)?f.values:[]})));
 const labelText=fields.map(f=>f.id.replace(/_/g,' ')+' '+f.label).join(' | ');
 const selectedValues=Object.entries(scan&&scan.capturedValues||{}).filter(([,v])=>String(v||'').trim()).map(([k,v])=>k.replace(/_/g,' ')+' '+String(v)).join(' | ');
 const context=scan&&scan.catalogContext||{};
 const contextText=[context.pageTitle,...(context.headings||[]),context.breadcrumb,context.categoryName,context.subCategoryName,context.catalogType].filter(Boolean).join(' | ');
 const enteredText=[stripImageFilenameArtifacts($('ai-product-name')?.value),$('ai-product-facts')?.value,$('ai-product-material')?.value].filter(Boolean).join(' | ');
  const allText=norm([contextText,labelText,selectedValues,enteredText].join(' | '));
 const fieldText=norm(labelText),visibleText=norm(contextText+' '+selectedValues+' '+enteredText);
 const rules=[
  {key:'bottles',name:'Bottles & Drinkware',type:'Bottle / Drinkware',signals:[
   {r:/\b(water bottle|bottle|flask|sipper|thermos|drinkware|vacuum flask|water jug)\b/i,w:8,label:true},
   {r:/\b(capacity in l|capacity|volume unit|leak proof|bpa free|lid type|insulation)\b/i,w:3,label:true}
  ]},
  {key:'apparel',name:'Apparel / Clothing',type:'Garment / Clothing',signals:[
   {r:/\b(kurti|kurta|saree|sari|dupatta|shirt|t-shirt|jeans|dress|leggings|blouse|garment|apparel|ethnic wear)\b/i,w:8,label:false},
   {r:/\b(sleeve length|neck type|neckline|fabric|pattern|fit type|bust|waist|hip|size chart|garment length)\b/i,w:4,label:true}
  ]},
  {key:'kitchen',name:'Kitchen / Lunch Boxes',type:'Kitchenware / Food Storage',signals:[
   {r:/\b(lunch box|lunchbox|tiffin|food container|food storage|compartment|cutlery|microwave safe|lunch bag|kitchenware)\b/i,w:8,label:false},
   {r:/\b(number of containers|no of containers|microwave safe|leak proof|set of containers)\b/i,w:4,label:true}
  ]},
  {key:'furniture',name:'Furniture / Chairs & Tables',type:'Furniture',signals:[
   {r:/\b(plastic chair|dining chair|chair|stool|table|desk|sofa|furniture|dining set|folding chair)\b/i,w:8,label:false},
   {r:/\b(seating capacity|arm rest|seat height|load capacity|foldable)\b/i,w:4,label:true}
  ]},
  {key:'baby',name:'Baby & Kids',type:'Baby / Kids Product',signals:[
   {r:/\b(baby|infant|toddler|kids|kid's|newborn|stroller|feeding bottle|baby chair|baby diaper|toy)\b/i,w:8,label:false},
   {r:/\b(age group|age range|recommended age|child safety)\b/i,w:3,label:true}
  ]},
  {key:'electronics',name:'Electronics / Accessories',type:'Electronics / Accessory',signals:[
   {r:/\b(electronic|usb|bluetooth|charger|cable|power bank|adapter|battery|led|watt|voltage|earphone|headphone|speaker)\b/i,w:7,label:false},
   {r:/\b(power source|charging time|battery capacity|connectivity|warranty)\b/i,w:3,label:true}
  ]},
  {key:'home',name:'Home & Household',type:'Home / Household Product',signals:[
   {r:/\b(bedsheet|bed sheet|pillow|cushion|curtain|doormat|rug|towel|storage basket|home decor|wall decor)\b/i,w:7,label:false},
   {r:/\b(thread count|fabric|wash care|room type|set contents)\b/i,w:2,label:true}
  ]}
 ];
 const ranked=rules.map(rule=>{
  let score=0;const evidence=[];
  rule.signals.forEach(sig=>{
   const haystack=sig.label?fieldText+' '+visibleText:allText;
   if(sig.r.test(haystack)){score+=sig.w;evidence.push(sig.r.source.replace(/\\b/g,'').replace(/[()\\?]/g,'').split('|').slice(0,3).join('/'));}
  });
  // Actual Meesho field design is stronger evidence than a generic product word in page chrome.
  if(rule.key==='bottles'&&/\b(capacity in l|volume unit)\b/i.test(fieldText))score+=4;
  if(rule.key==='apparel'&&/\b(sleeve length|neck type|bust|garment length|size chart)\b/i.test(fieldText))score+=4;
  if(rule.key==='kitchen'&&/\b(number of containers|microwave safe|no of containers)\b/i.test(fieldText))score+=4;
  if(rule.key==='furniture'&&/\b(seating capacity|seat height|arm rest)\b/i.test(fieldText))score+=3;
  return Object.assign({},rule,{score,evidence});
 }).sort((a,b)=>b.score-a.score);
 const winner=ranked[0],runner=ranked[1];
 const enough=winner&&winner.score>=7&&winner.score-(runner?runner.score:0)>=2;
 if(!enough)return {key:'general',name:'Selected Meesho Catalog · General Type',type:'Product type from selected form',confidence:'low',score:winner?winner.score:0,evidence:winner?winner.evidence:[],context:safeMeeshoCatalogContext(context)};
 return {key:winner.key,name:winner.name,type:winner.type,confidence:winner.score>=11?'high':'medium',score:winner.score,evidence:winner.evidence,context:safeMeeshoCatalogContext(context)};
}

NaN
function decodeImage(dataUrl){const m=String(dataUrl||'').match(/^data:([^;]+);base64,(.*)$/);if(!m)throw new Error('Could not decode photo.');return {mimeType:m[1],data:m[2]};}


async function post(url,opts,timeoutMs=45000){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);
 try{return await fetch(url,Object.assign({},opts,{signal:c.signal}));}finally{clearTimeout(timer);}
}
async function gemini(k,prompt,imgs=[]){
 if(!Array.isArray(imgs))throw new Error('Image list is missing. Please choose product photos again.');
 const parts=[{text:prompt}];imgs.forEach(i=>{const x=decodeImage(i.dataUrl);parts.push({inline_data:{mime_type:x.mimeType,data:x.data}});});
 const r=await post('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(k.model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':k.apiKey},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',temperature:0.2}})});
 const raw=await r.text();let data={};try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok)throw new Error('Gemini '+r.status+': '+((data.error||{}).message||raw.slice(0,180)));
 const out=((((data.candidates||[])[0]||{}).content||{}).parts||[]).map(x=>x.text||'').join('\n').trim();if(!out)throw new Error('Gemini returned empty response.');return out;
}

async function compatible(k,prompt,imgs=[]){
 if(!Array.isArray(imgs))throw new Error('Image list is missing. Please choose product photos again.');
 const parts=[{type:'text',text:prompt}];imgs.forEach(i=>parts.push({type:'image_url',image_url:{url:i.dataUrl}}));
 const originalUrl=String(k.endpoint||(k.provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'')).trim();
 if(!originalUrl)throw new Error('Enter the HTTPS API endpoint for '+label(k.provider)+'.');
 let url=originalUrl;
 if(!/\/chat\/completions\/?$/i.test(url))url=url.replace(/\/$/,'')+'/chat/completions';
 const endpoints=k.provider==='freellmapi'?connectionTestCandidates(k.provider,url):[url];
 const requestOptions={method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+k.apiKey},body:JSON.stringify({model:k.model,messages:[{role:'user',content:parts}],temperature:0.2,max_tokens:3500,response_format:{type:'json_object'}})};
 let r=null,raw='',data={},lastError='';const routeErrors=[];
 for(let i=0;i<endpoints.length;i++){
  const candidate=endpoints[i];
  let response;
  try{response=await post(candidate,requestOptions);}
  catch(e){
   lastError=String(e&&e.message||e||'Unknown connection error');routeErrors.push(candidate+': '+lastError);
   if(k.provider==='freellmapi'&&i<endpoints.length-1)continue;
   throw new Error(k.provider==='freellmapi'?'FreeLLMAPI local endpoints failed: '+routeErrors.join(' | '):lastError);
  }
  const responseText=await response.text();let responseData={};try{responseData=JSON.parse(responseText);}catch(_){}
  if(!response.ok){
   const details='HTTP '+response.status+': '+((responseData.error||{}).message||responseText.slice(0,180));
   routeErrors.push(candidate+': '+details);lastError=details;
   const canFallback=k.provider==='freellmapi'&&i<endpoints.length-1&&(response.status===404||response.status>=500||/no_vision_model|no vision/i.test(details));
   if(canFallback)continue;
   throw new Error((k.provider==='freellmapi'?'FreeLLMAPI ':'Provider ')+details);
  }
  r=response;raw=responseText;data=responseData;url=candidate;break;
 }
 if(!r)throw new Error('FreeLLMAPI local endpoints failed: '+(routeErrors.join(' | ')||lastError||'No endpoint responded.'));
 if(k.provider==='freellmapi'&&url!==originalUrl){
  try{const all=await keys();await set({[KEY]:all.map(x=>x.id===k.id?Object.assign({},x,{endpoint:url}):x)});k.endpoint=url;}catch(_){}
 }
 const message=((((data.choices||[])[0]||{}).message||{}).content);
 const out=Array.isArray(message)?message.map(x=>x.text||'').join('\\n').trim():String(message||'').trim();
 if(!out)throw new Error('Provider returned empty response.');
 return out;
}

function mergeImageBatchResponses(texts){
 const combined={values:{},needsConfirmation:[],evidence:{}},seenNeeds=new Set(),conflicts=new Set();
 texts.forEach((text,index)=>{
  const obj=parseJson(text);
  if(!obj||typeof obj!=='object'||!obj.values||typeof obj.values!=='object'){
   throw new Error('Image batch '+(index+1)+' did not return a field-value JSON object.');
  }
  Object.entries(obj.values).forEach(([key,value])=>{
   if(value===undefined||value===null||!String(value).trim())return;
   if(combined.values[key]===undefined||!String(combined.values[key]).trim())combined.values[key]=value;
   else if(norm(combined.values[key])!==norm(value)){
    const conflict=key+'|'+String(combined.values[key])+'|'+String(value);
    if(!conflicts.has(key)){
     conflicts.add(key);
     combined.needsConfirmation.push({identifier:key,reason:'Photo batches disagreed on this value ("'+String(combined.values[key])+'" vs "'+String(value)+'"). Review all product photos and confirm before publishing.'});
    }
   }
  });
  (Array.isArray(obj.needsConfirmation)?obj.needsConfirmation:[]).forEach(n=>{
   if(!n||!n.identifier)return;const k=n.identifier+'|'+String(n.reason||'');if(seenNeeds.has(k))return;seenNeeds.add(k);combined.needsConfirmation.push(n);
  });
  if(obj.evidence&&typeof obj.evidence==='object'){
   Object.entries(obj.evidence).forEach(([key,value])=>{
    if(combined.evidence[key]===undefined&&value)combined.evidence[key]=value;
    else if(value&&combined.evidence[key]&&JSON.stringify(value)!==JSON.stringify(combined.evidence[key])){
     combined.needsConfirmation.push({identifier:key,reason:'Photo batches returned different evidence sources. Confirm the official source and exact field value.'});
    }
   });
  }
 });
 return JSON.stringify(combined);
}
function imageFactComparable(field,a,b){
 const left=String(a||'').trim(),right=String(b||'').trim();
 if(!left||!right)return false;
 if(field==='colorIfClear'){
  const family=value=>{
   const color=normalizePrimaryColor(value).toLowerCase();
   if(/\bblue\b/.test(color))return 'blue';
   if(/\bgreen\b/.test(color))return 'green';
   if(/\bred\b/.test(color))return 'red';
   if(/\bpink\b/.test(color))return 'pink';
   if(/\bpurple\b|\bviolet\b/.test(color))return 'purple';
   if(/\bblack\b/.test(color))return 'black';
   if(/\bwhite\b/.test(color))return 'white';
   if(/\bgrey\b|\bgray\b/.test(color))return 'grey';
   if(/\bbrown\b/.test(color))return 'brown';
   if(/\bbeige\b|\bcream\b/.test(color))return 'neutral-light';
   if(/\bsilver\b/.test(color))return 'silver';
   if(/\bgold\b/.test(color))return 'gold';
   if(/\borange\b/.test(color))return 'orange';
   if(/\byellow\b/.test(color))return 'yellow';
   if(/\bmaroon\b/.test(color))return 'maroon';
   if(/\bteal\b/.test(color))return 'teal';
   if(/\btransparent\b/.test(color))return 'transparent';
   return color;
  };
  return family(left)===family(right);
 }
 if(field==='capacityIfPrinted'){
  const leftMl=capacityInMl(left),rightMl=capacityInMl(right);
  if(leftMl!==null&&rightMl!==null)return Math.abs(leftMl-rightMl)<0.01;
 }
 const clean=value=>norm(value).replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(token=>token.length>1&&!['the','and','with','for','from','product','actual','main'].includes(token));
 const ta=new Set(clean(left)),tb=new Set(clean(right));
 if(!ta.size||!tb.size)return norm(left)===norm(right);
 const common=Array.from(ta).filter(token=>tb.has(token));
 if(field==='productName'||field==='productType'){
  const core=['bottle','flask','tumbler','jug','dispenser','lunch','box','tiffin','chair','table','kurti','shirt','dress','wiper','mop','bag','phone','charger'];
  const coreOverlap=common.some(token=>core.includes(token));
  const jaccard=common.length/new Set([...ta,...tb]).size;
  return jaccard>=0.45||(coreOverlap&&jaccard>=0.3);
 }
 if(field==='materialIfClear'){
  return norm(left)===norm(right)||(common.length/Math.max(ta.size,tb.size))>=0.8;
 }
 return norm(left)===norm(right);
}
function mergeProductIdentificationBatches(texts){
 const batches=texts.map((text,index)=>{const obj=parseJson(text);if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Photo identification batch '+(index+1)+' did not return a JSON object.');return obj;});
 const result={productName:'',productType:'',brandIfLegible:'',modelIfLegible:'',colorIfClear:'',materialIfClear:'',capacityIfPrinted:'',visibleText:[],searchTerms:[],confidence:'low',visionConflicts:[]};
 const fields=['productName','productType','brandIfLegible','modelIfLegible','colorIfClear','materialIfClear','capacityIfPrinted'];
 fields.forEach(field=>{
  const candidates=batches.map((obj,index)=>({value:String(obj[field]||'').trim(),index,confidence:String(obj.confidence||'low').toLowerCase()})).filter(x=>x.value);
  if(!candidates.length)return;
  const groups=[];
  candidates.forEach(candidate=>{
   const match=groups.find(row=>imageFactComparable(field,row.value,candidate.value));
   if(match){
    match.count++;if(candidate.confidence==='high')match.high++;
    if(candidate.value.length>match.value.length&&candidate.confidence!=='low')match.value=candidate.value;
    match.variants.push(candidate.value);
   }else groups.push({value:candidate.value,count:1,high:candidate.confidence==='high'?1:0,variants:[candidate.value]});
  });
  const sorted=groups.sort((a,b)=>b.count-a.count||b.high-a.high||b.value.length-a.value.length);
  result[field]=sorted[0].value;
  if(sorted.length>1&&sorted[0].count<sorted[1].count+Math.max(1,Math.floor(candidates.length/3))){
   result.visionConflicts.push({field,values:sorted.slice(0,3).map(x=>x.value),reason:'Product-photo batches disagree on a material identity/variant field. Confirm the exact item before applying.'});
  }
 });
 const union=field=>Array.from(new Set(batches.flatMap(obj=>Array.isArray(obj[field])?obj[field]:[]).map(x=>String(x||'').trim()).filter(Boolean))).slice(0,20);
 result.visibleText=union('visibleText');result.searchTerms=union('searchTerms');
 batches.flatMap(obj=>Array.isArray(obj.visionConflicts)?obj.visionConflicts:[]).forEach(conflict=>{
  if(conflict&&conflict.field&&!result.visionConflicts.some(x=>x.field===conflict.field&&JSON.stringify(x.values||[])===JSON.stringify(conflict.values||[])))result.visionConflicts.push(conflict);
 });
 result.confidence=batches.some(obj=>String(obj.confidence||'').toLowerCase()==='high')?'high':batches.some(obj=>String(obj.confidence||'').toLowerCase()==='medium')?'medium':'low';
 return JSON.stringify(result);
}
async function callAI(prompt,imgs=[],progressBase=45,progressSpan=26,mergeMode='fields'){
 if(!Array.isArray(imgs)||!imgs.length)throw new Error('Product photos are missing. Upload at least one photo and try again.');
 if(imgs.length>10)throw new Error('Too many photos. Select up to 10 photos of this one product.');
 const list=(await keys()).filter(k=>k.enabled!==false&&k.apiKey&&k.model);if(!list.length)throw new Error('Add and enable at least one API key in Settings.');
 const old=await get(ROT),start=Number(old[ROT]||0)%list.length,order=list.slice(start).concat(list.slice(0,start)),errors=[];
 for(let i=0;i<order.length;i++){
   // Local routers can have strict per-candidate image/context limits; send one compact image per request.
   const k=order[i],batchSize=k.provider==='freellmapi'?1:((k.provider==='groq'||(k.provider==='openrouter'&&/qwen\/qwen3\.8-27b/i.test(k.model)))?3:5),batches=[];
  for(let p=0;p<imgs.length;p+=batchSize)batches.push(imgs.slice(p,p+batchSize));
  try{
   const texts=[];
   for(let b=0;b<batches.length;b++){
    const message='Analyzing photo batch '+(b+1)+'/'+batches.length+' via '+label(k.provider)+' ('+batches[b].length+' photo(s)).';
    say(message);
    setProgress(progressBase+Math.round(progressSpan*(b/batches.length)),message);
    const text=isNativeProvider(k.provider)?await gemini(k,prompt,batches[b]):await compatible(k,prompt,batches[b]);
    texts.push(text);
    setProgress(progressBase+Math.round(progressSpan*((b+1)/batches.length)),message+' complete');
   }
   const resultText=texts.length===1?texts[0]:(mergeMode==='identity'?mergeProductIdentificationBatches(texts):mergeImageBatchResponses(texts));
   await set({[ROT]:(start+i+1)%list.length});
   liveLog('All '+imgs.length+' photos were sent in '+batches.length+' batch(es) using '+label(k.provider)+'.','ok');
   return {text:resultText,name:safeKeyName(k),provider:k.provider,imagesUsed:imgs.length,imageBatches:batches.length};
  }
  catch(e){
   const explanation=explainProviderFailure(k.provider,e,i<order.length-1);
   errors.push(safeKeyName(k)+' — '+explanation);
   liveLog(explanation,'warn');
   await set({[ROT]:(start+i+1)%list.length});
  }
 }
 const quotaOnly=errors.length>0&&errors.every(e=>/quota\/rate limit \(429\)/i.test(e));
 throw new Error((quotaOnly?'Provider quota exhausted. ':'All enabled API keys failed. ')+errors.join(' | '));
}

async function callTextAI(prompt){
 const list=(await keys()).filter(k=>k.enabled!==false&&k.apiKey&&k.model);
 if(!list.length)throw new Error('Add and enable an API key in Settings before using AI Listing Chat.');
 const old=await get(ROT),start=Number(old[ROT]||0)%list.length,order=list.slice(start).concat(list.slice(0,start)),errors=[];
 for(let i=0;i<order.length;i++){
  const k=order[i];say('AI Listing Chat · trying '+label(k.provider)+' ('+(i+1)+'/'+order.length+')…');
  try{
   const text=isNativeProvider(k.provider)?await gemini(k,prompt,[]):await compatible(k,prompt,[]);
   await set({[ROT]:(start+i+1)%list.length});
   return {text,name:safeKeyName(k),provider:k.provider};
  }catch(e){
   const explanation=explainProviderFailure(k.provider,e,i<order.length-1);
   errors.push(safeKeyName(k)+' — '+explanation);
   liveLog('CHAT · '+explanation,'warn');
   await set({[ROT]:(start+i+1)%list.length});
  }
 }
 throw new Error('AI Listing Chat providers failed. '+errors.join(' | '));
}
function addChatBubble(role,message){
 const root=$('ai-chat-messages');if(!root)return;
 const bubble=el('div','ai-chat-bubble '+(role==='user'?'ai-chat-user':'ai-chat-assistant'),message);
 root.appendChild(bubble);
 while(root.children.length>24)root.removeChild(root.firstElementChild);
 root.scrollTop=root.scrollHeight;
}
function chatContext(){
 const titleChoice=titleChoices.find(x=>x.recommended)||titleChoices[0];
 const values={};
 if(draft)Object.entries(draft).forEach(([key,value])=>{
  if(!String(value||'').trim())return;
  if(/api.?key|password|token/i.test(key))return;
  values[key]=String(value).slice(0,500);
 });
 return {
  title:(titleChoice&&titleChoice.title)||($('ai-product-name')&&$('ai-product-name').value)||'',
  titleOptions:titleChoices.map(x=>({title:x.title,recommended:x.recommended,reason:x.reason})),
  productInputs:{
   material:$('ai-product-material')?.value||'',color:$('ai-product-color')?.value||'',
   capacity:$('ai-product-capacity')?.value||'',weight:$('ai-product-weight')?.value||'',
   sellingPrice:$('ai-product-price')?.value||'',mrp:$('ai-product-mrp')?.value||'',
   inventory:$('ai-product-inventory')?.value||'100',packQuantity:$('ai-product-pack-quantity')?.value||'1'
  },
  filledFields:Object.keys(values).length,values:Object.fromEntries(Object.entries(values).slice(0,35)),
  unresolved:(currentTitleNeeds||[]).slice(0,18),
  research:(researchNow.results||[]).slice(0,5).map(r=>({title:r.title,domain:r.domain,snippet:r.snippet,url:r.url}))
 };
}
async function sendChatMessage(){
 const input=$('ai-chat-input'),btn=$('ai-chat-send');
 const message=String(input&&input.value||'').trim();
 if(!message)return;
 if(message.length>1200)throw new Error('Keep each message under 1,200 characters.');
 chatHistory.push({role:'user',content:message});chatHistory=chatHistory.slice(-10);
 addChatBubble('user',message);input.value='';if(btn)btn.disabled=true;
 liveLog('AI LISTING CHAT · preparing answer from the active listing context.','info');
 try{
  const context=chatContext();
  const history=chatHistory.slice(-8).map(x=>({role:x.role,content:x.content}));
  const prompt=[
   'You are the helpful AI Listing Chat inside MEESHO A+ LISTING AUTOMATION PRO for Indian e-commerce sellers.',
   'Reply in Bengali when the user writes Bengali; preserve English for product titles, listing fields and search terms when appropriate. Be clear, practical, and concise.',
   'Answer only the user query using the product/form context. You may explain missing fields, compare title options, suggest honest title/description improvements, or propose next steps. Never claim you changed the actual Meesho page; only the Autofill button does that.',
   'Do not invent HSN/GST, legal identity, dimensions, pack contents, certification, product performance, or policy facts. Flag unknown facts and explain what evidence is needed.',
   'If the user asks to change a title, suggest an option and tell them to choose it from the title cards above; do not claim the draft changed.',
   'Return only valid JSON: {"reply":"your answer here"}.',
   'Current listing context:',JSON.stringify(context),
   'Recent conversation:',JSON.stringify(history)
  ].join('\n');
  const result=await callTextAI(prompt),obj=parseJson(result.text);
  const reply=String(obj.reply||obj.answer||obj.message||'I could not compose a reply. Please try again.').trim().slice(0,4500);
  chatHistory.push({role:'assistant',content:reply});chatHistory=chatHistory.slice(-10);
  addChatBubble('assistant',reply);
  liveLog('AI LISTING CHAT · response received from '+result.name+'.','ok');
  say('AI Listing Chat replied.','success');
 }catch(e){
  const msg=redactSecrets(e,null);addChatBubble('assistant','Could not answer: '+msg);
  liveLog('AI LISTING CHAT · '+msg,'error');say(msg,'error');
 }finally{if(btn)btn.disabled=false;}
}

function parseJson(text){
 let s=String(text||'').trim(),f=String.fromCharCode(96);
 s=s.replace(new RegExp('^'+f+f+f+'(?:json)?\\\\s*','i'),'').replace(new RegExp('\\\\s*'+f+f+f+'$'),'');
 try{return JSON.parse(s);}catch(e){}
 const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch(e){}}
 throw new Error('AI response was not valid JSON. Try another model or API key.');
}
function allowed(value,field){return !field.values.length||field.values.some(o=>norm(o)===norm(value));}

function renderResearchSources(research){
 const host=$('ai-research-sources');if(!host)return;host.replaceChildren();
 host.style.display='block';
 const google=research&&Array.isArray(research.results)?research.results:[];
 const tax=research&&Array.isArray(research.officialTaxReferences)?research.officialTaxReferences:[];
 const sources=[...tax,...google];
 host.appendChild(el('div','ai-preview-title',sources.length?'Research & Official Tax References':'Google Research'));
 if(!sources.length){
  host.appendChild(el('p','ai-muted',research&&research.error?'Research unavailable: '+research.error:'No Google results were captured. Required HSN/GST values must be resolved before autofill.'));
  return;
 }
 host.appendChild(el('p','ai-muted','Search seed: '+(research.seed||'Not available')+' · '+google.length+' Google result(s) · '+tax.length+' official tax reference(s).'));
 const list=el('div','ai-research-list');
 sources.slice(0,8).forEach(r=>{
  const row=el('div','ai-research-source'),a=el('a','',r.title||r.domain);
  a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=(r.title||r.domain);
  row.appendChild(a);row.appendChild(el('div','ai-muted',r.domain+' · '+(r.snippet||'No snippet returned.')));
  list.appendChild(row);
 });
 host.appendChild(list);
}
function renderTaxApplicationSummary(values,fields,research){
 const host=$('ai-tax-summary');if(!host)return;
 host.replaceChildren();
 const heading=el('strong','','Automatic HSN / GST Research');
 heading.style.cssText='display:block;font-size:11px;margin-bottom:4px;color:#bfdbfe;';
 host.appendChild(heading);
 const taxFields=(fields||[]).filter(f=>isTaxField(f));
 if(!taxFields.length){
  host.appendChild(el('div','ai-muted','The selected Meesho form has no HSN/GST fields to fill.'));
  return;
 }
 const rows=taxFields.map(field=>{
  const label=String(field.label||field.identifier||'Tax field'),value=String(values&&values[field.identifier]||'').trim();
  const src=value?[...(research&&research.results||[]),...(research&&research.officialTaxReferences||[])].map(row=>officialTaxEvidence(field,value,{url:row.url},research)).find(Boolean):null;
  return {field,label,value,src};
 });
 rows.forEach(row=>{
  const line=el('div','ai-tax-summary-line');
  const text=el('span','',row.label+': '+(row.value||'Not matched yet'));
  text.style.cssText='font-size:10px;overflow-wrap:anywhere;';
  line.appendChild(text);
  const status=el('span','',row.src?' · RESEARCHED & ADDED TO DRAFT':row.value?' · Review classification':' · Research pending');
  status.style.cssText='font-size:9px;font-weight:800;color:'+(row.src?'#86efac':row.value?'#fcd34d':'#fca5a5')+';';
  line.appendChild(status);host.appendChild(line);
  if(row.src){
   const link=el('a','ai-tax-source-link','Open official source');
   link.href=row.src.url;link.target='_blank';link.rel='noopener noreferrer';
   link.style.cssText='display:inline-block;font-size:9px;color:#93c5fd;text-decoration:underline;margin:2px 0 5px;';
   host.appendChild(link);
  }
 });
 if(rows.some(row=>!row.src)){
  const note=el('div','ai-tax-summary-note','Only values supported by a matching official source are auto-applied. If no exact match is available, the field stays flagged for review instead of inventing a code.');
  note.style.cssText='font-size:9px;line-height:1.4;color:#cbd5e1;margin-top:5px;';
  host.appendChild(note);
 }else{
  const note=el('div','ai-tax-summary-note','Tax values are ready in the Draft. Press “Autofill on Meesho Tab” to send them to the selected Meesho form.');
  note.style.cssText='font-size:9px;line-height:1.4;color:#cbd5e1;margin-top:5px;';
  host.appendChild(note);
 }
}
function dropdownEquivalent(value,field){
 const wanted=String(value||'').trim();if(!wanted)return '';
 if(!field||!Array.isArray(field.values)||!field.values.length)return wanted;
 const exact=field.values.find(option=>norm(option)===norm(wanted));
 if(exact!==undefined)return String(exact);
 const compact=value=>norm(value).replace(/[^a-z0-9]+/g,'');
 const equivalent=field.values.find(option=>compact(option)===compact(wanted));
 return equivalent===undefined?'':String(equivalent);
}
function setDraftControlStyle(control){
 control.style.width='100%';control.style.boxSizing='border-box';control.style.minWidth='0';
 control.style.padding='6px';control.style.borderRadius='5px';control.style.font='10px/1.45 system-ui';
 control.style.background='#081323';control.style.color='#e5efff';control.style.border='1px solid #315375';
 control.style.whiteSpace='normal';control.style.overflowWrap='anywhere';
}
function makeDraftControl(field,value){
 let control;
 if(Array.isArray(field.values)&&field.values.length){
  control=el('select','ai-draft-field-control');
  const mapped=dropdownEquivalent(value,field);
  if(value&&!mapped){
   const option=el('option','',String(value)+' · current value, not in dropdown');
   option.value=String(value);option.dataset.unmatched='true';control.appendChild(option);
  }else{
   const option=el('option','','Choose an exact Meesho option…');option.value='';control.appendChild(option);
  }
  field.values.forEach(item=>{const option=el('option','',String(item));option.value=String(item);control.appendChild(option);});
  control.value=mapped||String(value||'');
 }else if(isDescriptionField(field)||String(value||'').length>90){
  control=el('textarea','ai-draft-field-control');control.rows=isDescriptionField(field)?5:3;control.value=String(value||'');
 }else{
  control=el('input','ai-draft-field-control');
  const ftype=String(field.inputType||'').toLowerCase();
  control.type=ftype==='number'||isPhysicalMeasureField(field)||/(price|mrp|inventory|stock|capacity|quantity|weight|length|breadth|width|height)/i.test(field.label+' '+field.identifier)?'number':'text';
  if(control.type==='number'){control.step='any';control.min='0';}
  control.value=String(value||'');
 }
 setDraftControlStyle(control);
 control.setAttribute('aria-label',String(field.label||field.identifier||'Draft field'));
 control.addEventListener('input',()=>updateDraftValue(field,control.value));
 control.addEventListener('change',()=>updateDraftValue(field,control.value));
 return control;
}
function updateDraftValue(field,value){
 if(!draft)return;
 draft[field.identifier]=String(value??'').trim();
 draftEditedFields.add(field.identifier);
 if(isProductNameField(field)&&currentTitleProduct)currentTitleProduct.productName=draft[field.identifier];
 const button=$('ai-autofill-btn');
 if(button){
  const missingTax=currentTitleFields.filter(f=>f.mandatory&&isTaxField(f)&&!String(draft[f.identifier]||'').trim());
  button.disabled=!Object.values(draft).some(v=>String(v||'').trim());
  button.title=missingTax.length?'HSN/GST is required. Enter verified tax values in Edit Draft, save, then retry Autofill.':'';
 }
}
function showPreview(fields,values,needs,stats,research){
 const root=$('ai-preview');if(!root)return;root.replaceChildren();root.style.display='block';
 const top=el('div','ai-preview-toolbar'),heading=el('div','ai-preview-title','AI Draft Preview');
 top.appendChild(heading);
 const actions=el('div','ai-preview-actions');
 if(draftEditMode){
  const save=el('button','ai-secondary-btn ai-small-btn','Save Changes');save.type='button';save.addEventListener('click',()=>{commitDraftEdits();});
  const cancel=el('button','ai-secondary-btn ai-small-btn','Cancel');cancel.type='button';cancel.addEventListener('click',()=>{if(draftBeforeEdit)draft=Object.assign({},draftBeforeEdit);draftEditMode=false;draftBeforeEdit=null;showPreview(currentTitleFields,draft,currentTitleNeeds,currentTitleStats,researchNow);setDraftButtonAvailability();});
  actions.append(save,cancel);
 }else{
  const edit=el('button','ai-secondary-btn ai-small-btn','Edit Draft');edit.type='button';edit.addEventListener('click',()=>{draftBeforeEdit=Object.assign({},draft||values||{});draftEditMode=true;showPreview(currentTitleFields, draft||values, currentTitleNeeds, currentTitleStats, researchNow);});
  actions.appendChild(edit);
 }
 top.appendChild(actions);root.appendChild(top);
 const info=stats||{ai:0,preset:0,generated:0,bad:0};
 root.appendChild(el('div','ai-muted','AI values: '+info.ai+' · Defaults: '+info.preset+' · Generated codes: '+info.generated+' · Dropdown mismatches: '+info.bad+' · Needs confirmation: '+(needs||[]).length));
 if(research&&research.seed)root.appendChild(el('div','ai-muted','Category research seed: '+research.seed));
 const estimateCount=Object.keys(research&&research.measurementEstimates||{}).filter(id=>String(values[id]||'').trim()).length;
 if(estimateCount)root.appendChild(el('div','ai-draft-estimate-summary',estimateCount+' field(s) contain ESTIMATED measurements from similar products. Edit them before applying if your item differs.'));
 if(draftEditMode)root.appendChild(el('div','ai-draft-edit-hint','Edit values below. Dropdown fields use Meesho’s actual options. Click Save Changes before Autofill; your saved Draft values take priority.'));
 const list=el('div','ai-preview-list');
 (fields||[]).forEach(field=>{
  const value=values[field.identifier],row=el('div','ai-preview-item');
  row.appendChild(el('span','ai-preview-label',field.label+(field.mandatory?' *':'')));
  const valueBox=el('div','ai-preview-value'+(value?'':' ai-blank'));
  if(draftEditMode){
   const control=makeDraftControl(field,value);
   valueBox.appendChild(control);
  }else{
   valueBox.appendChild(el('span','',value?String(value):'Not filled'));
  }
  const estimate=research&&research.measurementEstimates&&research.measurementEstimates[field.identifier];
  if(estimate&&value){
   const details=el('small','ai-draft-field-status','ESTIMATED · '+estimate.sourceCount+' source(s) · '+(estimate.reason||'similar-product reference'));
   valueBox.appendChild(details);
   if(Array.isArray(estimate.sourceUrls)&&estimate.sourceUrls.length){
    const source=el('a','ai-draft-field-source','View measurement source');source.href=estimate.sourceUrls[0];source.target='_blank';source.rel='noopener noreferrer';valueBox.appendChild(source);
   }
  }
  row.appendChild(valueBox);list.appendChild(row);
 });
 root.appendChild(list);
 const sizes=selectedVariationSizes();if(sizes.length)root.appendChild(el('p','ai-muted','Size variants to select on Meesho: '+sizes.join(', ')));
 if(needs&&needs.length){
  const box=el('div','ai-needs-box');box.appendChild(el('strong','','Needs review — '+needs.length));
  const ul=el('ul'),seen=new Set();needs.forEach(n=>{if(!n||!n.identifier)return;const k=n.identifier+'|'+(n.reason||'');if(seen.has(k))return;seen.add(k);ul.appendChild(el('li','',n.identifier+': '+(n.reason||'Check manually.')));});
  box.appendChild(ul);root.appendChild(box);
 }
 root.appendChild(el('p','ai-muted',draftEditMode?'Unsaved edits are held in this Draft. Save Changes to validate the title and update generated codes.':'Use Edit Draft to correct any field. Autofill sends the saved Draft values rather than re-generating them.'));
}
function setDraftButtonAvailability(){
 const button=$('ai-autofill-btn');if(!button)return;
 const missingTax=(currentTitleFields||[]).filter(f=>isTaxField(f)&&!String(draft&&draft[f.identifier]||'').trim());
 button.disabled=!Object.values(draft||{}).some(v=>String(v||'').trim());
 button.title=missingTax.length?'HSN/GST is required. Enter verified tax values in Edit Draft, save, then retry Autofill.':'';
}
async function commitDraftEdits(){
 if(!draft||!currentTitleFields.length)return;
 const titleField=currentTitleFields.find(isProductNameField);
 const manualTitle=titleField?String(draft[titleField.identifier]||'').trim():'';
 if(titleField&&(manualTitle.length<201||manualTitle.length>250)){
  say('Product Title must be between 201 and 250 characters. Current length: '+manualTitle.length+'. Edit it and Save Changes again.','warning');return;
 }
 if(titleField){
  draft[titleField.identifier]=stripImageFilenameArtifacts(manualTitle);
  if(currentTitleProduct)currentTitleProduct.productName=draft[titleField.identifier];
  if($('ai-product-name'))$('ai-product-name').value=draft[titleField.identifier];
  const recommendedIndex=Math.max(0,titleChoices.findIndex(x=>x.recommended));
  if(titleChoices[recommendedIndex]){titleChoices[recommendedIndex].title=draft[titleField.identifier];titleChoices[recommendedIndex].reason='Manually edited in Draft · '+draft[titleField.identifier].length+'/250 characters';}
 }
 (currentTitleFields||[]).forEach(field=>{
  const val=String(draft[field.identifier]||'').trim(),label=fieldText(field);
  if(/\bmaterial\b/.test(label)&&val&&currentTitleProduct)currentTitleProduct.material=val;
  if(/\bcolor\b/.test(label)&&val&&currentTitleProduct)currentTitleProduct.color=val;
  if(/\b(capacity|volume)\b/.test(label)&&val&&currentTitleProduct)currentTitleProduct.productCapacity=val;
 });
 try{
  const codes=await productCodes(currentTitleProduct&&currentTitleProduct.productName||manualTitle,currentTitleProduct||{});
  currentTitleFields.forEach(field=>{
   if(draftEditedFields.has(field.identifier))return;
   const newCode=generatedCodeForField(field,codes);
   if(newCode&&allowed(newCode,field))draft[field.identifier]=newCode;
  });
 }catch(e){liveLog('DRAFT SAVE · Style Code/SKU refresh was unavailable: '+redactSecrets(e,null),'warn');}
 const nextNeeds=[];
 (currentTitleNeeds||[]).forEach(item=>{
  const field=currentTitleFields.find(f=>f.identifier===item.identifier);if(!field){nextNeeds.push(item);return;}
  const val=String(draft[field.identifier]||'').trim();
  if(!val){nextNeeds.push(item);return;}
  if(isTaxField(field)){
   const refs=[...(researchNow.results||[]),...(researchNow.officialTaxReferences||[])];
   const verified=refs.some(row=>officialTaxEvidence(field,val,{url:row.url},researchNow));
   if(!verified)nextNeeds.push({identifier:field.identifier,reason:'Seller-edited tax value; confirm its exact HSN/GST rate against an official source before submitting.'});
   return;
  }
  if(field.values.length&&!allowed(val,field)){nextNeeds.push({identifier:field.identifier,reason:'Value does not match an exact Meesho dropdown option. Choose one from Edit Draft.'});return;}
  if(isPhysicalMeasureField(field)&&researchNow.measurementEstimates&&researchNow.measurementEstimates[field.identifier])return;
  // A completed editable value resolves the previous blank/unavailable-value notice.
 });
 currentTitleNeeds=nextNeeds;pending=nextNeeds;
 renderTaxApplicationSummary(draft,currentTitleFields,researchNow);
 draftEditMode=false;draftBeforeEdit=null;
 renderTitleOptions();showPreview(currentTitleFields,draft,currentTitleNeeds,currentTitleStats,researchNow);setDraftButtonAvailability();
 say('Draft changes saved. The saved values will be used for Autofill.','success');
}

function isDescriptionField(f){
 return /description/.test(norm(String(f.identifier||'').replace(/_/g,' ')+' '+String(f.label||'')));
}
function stripBrandPlaceholders(value){
 const placeholders=/^(?:not\s+branded|non[\s-]*branded|unbranded|no\s+brand|brand\s+(?:unknown|not\s+specified|not\s+available|not\s+provided|n\/?a)|unknown\s+brand|n\/?a|na|not\s+applicable|not\s+provided|not\s+specified|unknown)$/i;
 let raw=stripImageFilenameArtifacts(String(value||'')).replace(/\bN\s*\/\s*A\b/ig,' ');
 const parts=raw.split(/\s*\/\s*/).map(x=>x.trim()).filter(x=>x&&!placeholders.test(x));
 let text=parts.join(' / ');
 text=text.replace(/\b(?:not\s+branded|non[\s-]*branded|unbranded|no\s+brand|brand\s+(?:unknown|not\s+specified|not\s+available|not\s+provided)|unknown\s+brand)\b/ig,' ');
 return text.replace(/\s*\/\s*/g,' / ').replace(/(?:\s*\/\s*){2,}/g,' / ').replace(/^\s*\/\s*|\s*\/\s*$/g,'').replace(/\s+/g,' ').trim();
}
function cleanTitle(title){return stripBrandPlaceholders(stripImageFilenameArtifacts(title)).replace(/\s+/g,' ').replace(/^\s*\/+\s*|\s*\/+\s*$/g,'').trim().slice(0,250).trim();}
function titleExpansionPhrases(p,index){
 const text=norm([p&&p.productCategory,p&&p.productType,p&&p.productName].filter(Boolean).join(' '));
 if(/\b(kitchen|lunch|tiffin|food storage|food container)\b/.test(text))return ['Suitable for packed meals at school, office, travel and picnics','Useful for organizing rice, snacks, fruits and side dishes during everyday meal planning','A practical option for daily lunch preparation, carrying meals and convenient on-the-go dining','Designed around everyday food storage needs for home meals, work lunches and short outings','For regular meal packing routines, helping keep different food items arranged for carrying and serving'];
 if(/\b(bottle|drinkware|flask|hydration)\b/.test(text))return ['Suitable for carrying drinking water at home, school, work and during travel','A practical everyday hydration accessory for desk use, commuting and outdoor routines','Made for daily water carrying needs across home, office, school and travel settings','Useful for everyday hydration routines and convenient access to drinking water while out','For regular water carrying during workdays, study, exercise and general travel'];
 if(/\b(apparel|clothing|garment|kurti|kurta|shirt|dress|saree)\b/.test(text))return ['Suitable for everyday styling, casual outings, regular errands and suitable social occasions','A versatile wardrobe option to pair with suitable bottoms, footwear and accessories','Designed for personal styling across daily routines, outings and season-appropriate occasions','An apparel choice for building coordinated looks with wardrobe basics and accessories','Useful for everyday outfit planning and styling according to the occasion and personal preference'];
 if(/\b(furniture|chair|table|stool|desk|sofa)\b/.test(text))return ['Useful for everyday home settings, dining areas, work spaces and practical household routines','Consider the listed measurements and intended placement when choosing a suitable space','A practical household furnishing option for arranging spaces around daily needs','Suitable for relevant home or work areas according to room layout and size requirements','For everyday utility at home or in work areas, subject to the actual measurements and setup'];
 if(/\b(electronic|charger|cable|usb|led|adapter|speaker|headphone)\b/.test(text))return ['Confirm device compatibility, connection type and supported specifications before purchase','Useful for compatible everyday device setups at home, office, study or travel','Check the connector, power requirements and product specifications for intended devices','A practical accessory for compatible electronics and routine personal or work use','Review the device requirements and listed details to confirm a suitable match'];
 return ['Suitable for relevant everyday tasks at home, work or while travelling, according to its intended use','Review the photos and verified specifications to choose the correct option for your requirements','A practical choice for regular use when the product details match your intended application','Consider the actual product dimensions, included components and listed features before choosing','Use the verified product details to confirm suitability for your routine and intended purpose'];
}
function buildTitleChoices(raw,baseTitle,p,d){
 const choices=[],seen=new Set(),strategies=['SEO keyword-first','Feature-led title','Use-case-led title','Structured buyer-friendly title'],packCount=Math.max(1,Math.floor(Number(p&&p.packQuantity)||1)),packSegment=' / Pack of '+packCount,minBody=201-packSegment.length,maxBody=250-packSegment.length;
 const brand=String(d&&d.brand||'').trim(),capacity=String(p&&p.productCapacity||'').trim(),material=String(p&&p.material||'').trim(),color=String(p&&p.color||'').trim(),variants=titleExpansionPhrases(p,0);
 const add=(title,reason,recommended,optionIndex)=>{
  let body=stripBrandPlaceholders(stripImageFilenameArtifacts(String(title||''))).replace(/\s+/g,' ').trim();if(!body)return;
  body=body.replace(/(?:\s*\/\s*)?(?:pack|set)\s+of\s+\d+(?:\s+(?:pieces?|pcs?))?/ig,' ').replace(/\s*\/\s*/g,' / ').replace(/(?:\s*\/\s*)+$/,'').replace(/\s+/g,' ').trim();
  body=body.replace(/\b(?:title|option)\s*[#-]?\s*\d+\b/ig,' ').replace(/\s*\/\s*/g,' / ').replace(/(?:\s*\/\s*)+$/,'').replace(/\s+/g,' ').trim();
  if(!body)body=stripImageFilenameArtifacts(baseTitle)||String(p&&p.productType||'Product');
  const phraseList=titleExpansionPhrases(p,Number(optionIndex)||0);let phraseIndex=((Number(optionIndex)||0)%phraseList.length+phraseList.length)%phraseList.length,attempts=0;
  while(body.length<minBody&&attempts<phraseList.length*2){
   const phrase=phraseList[phraseIndex%phraseList.length];phraseIndex++;attempts++;if(norm(body).includes(norm(phrase)))continue;
   const separator=body?' / ':'',remaining=maxBody-body.length-separator.length;if(remaining<=4)break;
   let segment=phrase;if(segment.length>remaining){segment=segment.slice(0,remaining);const cut=segment.lastIndexOf(' ');if(cut>Math.min(18,remaining-8))segment=segment.slice(0,cut);segment=segment.replace(/[ /]+$/,'').trim();}
   if(segment)body=(body+separator+segment).trim();
  }
  if(body.length>maxBody){let shortened=body.slice(0,maxBody),space=shortened.lastIndexOf(' ');if(space>maxBody-32)shortened=shortened.slice(0,space);body=shortened.replace(/[ /]+$/,'').trim();}
  if(body.length<minBody){const fallback='Suitable for practical everyday use according to verified product specifications',separator=body?' / ':'',room=maxBody-body.length-separator.length;if(room>0)body=(body+separator+fallback.slice(0,room)).replace(/[ /]+$/,'').trim();}
  const clean=cleanTitle(body+packSegment);if(clean.length<201||clean.length>250)return;
  const key=norm(clean);if(seen.has(key))return;seen.add(key);choices.push({title:clean,reason:String(reason||'Original title generated from product photos, category and verified details.'),strategy:strategies[Math.min(choices.length,3)],recommended:Boolean(recommended)});
 };
 (Array.isArray(raw)?raw:[]).forEach((x,i)=>{if(typeof x==='string')add(x,'Original AI-generated SEO title based on photos and verified attributes.',false,i);else if(x&&typeof x==='object')add(x.title||x.value||'',x.reason||x.rationale||'Original AI-generated SEO title based on photos and verified attributes.',x.recommended===true||String(x.recommended).toLowerCase()==='true',i);});
 const base=stripImageFilenameArtifacts(baseTitle)||String(p&&p.productType||'Product');
 add(base,'Product category and image-based identification with relevant search context.',false,0);
 add([base,brand,material,color,capacity].filter(Boolean).join(' / '),'Product type followed by known brand and confirmed attributes.',false,1);
 add([base,color,capacity,material].filter(Boolean).join(' / '),'Alternative ordering focused on product type and verified variant details.',false,2);
 add([base,material,color,brand].filter(Boolean).join(' / '),'Alternative SEO phrasing using only known attributes.',false,3);
 let attempt=4;while(choices.length<4&&attempt<24){add([base,brand,material,color,capacity,variants[attempt%variants.length]].filter(Boolean).join(' / '),'Category-specific descriptive wording without unsupported technical claims.',false,attempt);attempt++;}
 if(choices.length>4)choices.length=4;let rec=choices.findIndex(x=>x.recommended);if(rec<0)rec=0;choices.forEach((x,i)=>x.recommended=i===rec);return choices;
}

function renderTitleOptions(){
 const root=$('ai-title-options');if(!root)return;root.replaceChildren();
 if(!titleChoices.length){root.style.display='none';return;}
 root.style.display='block';
 root.appendChild(el('div','ai-title-options-heading','Choose a Product Title'));
 root.appendChild(el('div','ai-title-options-subtitle','4 original SEO title options · each 201–250 characters. Created from photos, selected category and verified facts. Image filenames and external listing titles are excluded.'));
 titleChoices.forEach((choice,index)=>{
  const label=el('label','ai-title-choice'),radio=el('input');
  radio.type='radio';radio.name='ai-selected-title';radio.value=String(index);radio.checked=choice.recommended;
  radio.addEventListener('change',()=>{if(radio.checked)applyTitleChoice(index);});
  const body=el('div','ai-title-choice-body'),main=el('div','ai-title-choice-main',choice.title);
  if(choice.recommended)main.appendChild(el('span','ai-recommended-tag','RECOMMENDED'));
  body.appendChild(main);
  const strategy=el('div','ai-title-choice-strategy',choice.strategy||['SEO keyword-first','Feature-led title','Use-case-led title','Structured buyer-friendly title'][index%4]);strategy.style.cssText='font-size:10px;font-weight:800;color:#60a5fa;margin:2px 0;';body.appendChild(strategy);body.appendChild(el('div','ai-title-choice-meta',choice.reason||''));
  body.appendChild(el('div','ai-title-choice-count',choice.title.length+'/250 characters'));
  label.appendChild(radio);label.appendChild(body);root.appendChild(label);
 });
}
async function applyTitleChoice(index){
 const choice=titleChoices[index];if(!choice||!draft)return;
 setProgress(88,'Applying selected title and regenerating SKU / Style Code');
 if(currentTitleProduct)currentTitleProduct.productName=choice.title;
 if($('ai-product-name'))$('ai-product-name').value=choice.title;
 if(activeTitleFieldId)draft[activeTitleFieldId]=choice.title;
 try{
  const codes=await productCodes(choice.title,currentTitleProduct||{});
  currentTitleFields.forEach(f=>{
   if(draftEditedFields.has(f.identifier))return;
   const value=generatedCodeForField(f,codes);
   if(value&&allowed(value,f))draft[f.identifier]=value;
  });
  titleChoices.forEach((x,i)=>{x.recommended=i===index;});
  renderTitleOptions();
  showPreview(currentTitleFields,draft,currentTitleNeeds,currentTitleStats,researchNow);
  setDraftButtonAvailability();
  setProgress(90,'Selected title applied · SKU / Style Code refreshed');
  say('Selected title option '+(index+1)+': '+choice.title,'success');
 }catch(e){
  setProgress(88,'Title selected · code refresh needs review');
  say('Title selected. Review SKU/Style Code manually: '+redactSecrets(e,null),'warning');
 }
}
function normalizeDescription(text){
 let value=String(text||'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(value.length>1000){
  let cut=value.slice(0,1000),lastSpace=cut.lastIndexOf(' ');
  if(lastSpace>920)cut=cut.slice(0,lastSpace);
  value=cut.replace(/[.,;:\s]+$/,'').trim();
 }
 return value;
}
async function refineDescriptionToBudget(raw,title,p,imgs){
 let value=normalizeDescription(raw);
 if(value.length>=950)return value;
 liveLog('DESCRIPTION · expanding to the requested 950–1000 character target using only verified facts.','info');
 setProgress(80,'Refining the product description to 950–1000 characters');
 const prompt=[
  'Write a professional Indian e-commerce product description in JSON: {"description":"..."}. Aim for 950–1000 characters including spaces and never exceed 1000.',
  'Keep the description natural, specific to the product title and only grounded in the provided draft, confirmed seller inputs, and research snippets. Do not invent certifications, material grades, leak proofing, hot/cold retention, included accessories, measurements, package contents, warranty, brand claims or origin.',
  'Do not repeat filler. When technical facts are sparse, write useful neutral buying guidance and explain that shoppers should check the exact capacity/color/product images and supplied specifications.',
  'Product title: '+String(title||''),
  'Confirmed seller details: '+JSON.stringify({material:p.material||'',color:p.color||'',capacity:p.productCapacity||'',packQuantity:p.packQuantity||'1',weight:p.productWeight||'',length:p.productLength||'',width:p.productWidth||'',height:p.productHeight||'',facts:p.productFacts||''}),
  'Google research snippets: '+JSON.stringify((researchNow.results||[]).slice(0,6).map(r=>({title:r.title,domain:r.domain,snippet:r.snippet}))),
  'Current description to improve: '+value,
  'Return only JSON, no markdown.'
 ].join('\n');
 try{
  const response=await callAI(prompt,(imgs||[]).slice(0,3),80,6),obj=parseJson(response.text);
  const candidate=normalizeDescription(obj.description||(obj.values&&obj.values.description)||'');
  if(candidate.length>value.length)value=candidate;
 }catch(e){liveLog('DESCRIPTION · refinement request failed; keeping the current safe text.','warn');}
 value=normalizeDescription(value);
 if(value.length<950)liveLog('DESCRIPTION · '+value.length+'/1000 characters. The model could not safely expand further without inventing unsupported product facts.','warn');
 else liveLog('DESCRIPTION · ready at '+value.length+'/1000 characters.','ok');
 return value;
}

function isProductNameField(f){return /product_name/.test(String(f.identifier||''))||/^product name$/.test(norm(f.label));}

const WORKFLOW_STEP_STATES={
 waiting:{label:'WAITING',color:'#64748b',bg:'#0b1728'},
 running:{label:'RUNNING',color:'#60a5fa',bg:'#102b49'},
 done:{label:'DONE',color:'#86efac',bg:'#102d26'},
 blocked:{label:'NEEDS REVIEW',color:'#fbbf24',bg:'#33260d'},
 error:{label:'ERROR',color:'#fca5a5',bg:'#35191e'}
};
function setWorkflowStep(name,state,detail){
 const row=document.querySelector('[data-workflow-step="'+name+'"]');if(!row)return;
 const mode=WORKFLOW_STEP_STATES[state]||WORKFLOW_STEP_STATES.waiting;
 row.style.setProperty('border-color',mode.color,'important');
 row.style.setProperty('background',mode.bg,'important');
 const status=row.querySelector('[data-step-status]'),note=row.querySelector('[data-step-detail]');
 if(status){status.textContent=mode.label;status.style.color=mode.color;}
 if(note)note.textContent=String(detail||'');
}
function resetWorkflowSteps(){
 ['authority','photos','research','mapping','apply'].forEach(name=>setWorkflowStep(name,'waiting','Waiting for this stage.'));
}
function extractMasterDigest(masterText){
 const markers=[
  ['CRITICAL AUTHORITY RULE:',850],['HARD-LOCK PRINCIPLE:',420],
  ['A. HARD-LOCK AUTHORITY MODEL',760],['D. RAW SCHEMA IMMUTABILITY LOCK',900],
  ['E. OPTION VOCABULARY HARD LOCK',650],['F. PLATFORM + PROFILE LOCK',520],
  ['G. PRODUCT IDENTITY HARD LOCK',720],['O. MINIMAL-DIFF AUTO-REPAIR LOCK',700],
  ['R. BLANK-FIELD FAIL-SAFE LOCK',700],['U. VALUE SYNCHRONIZATION LOCK',540],
  ['V. IMPORTABILITY DOUBLE-PASS LOCK',660],['X. BLOCKED STATE LOCK',480]
 ];
 return markers.map(([marker,limit])=>{const i=masterText.indexOf(marker);return i<0?'':masterText.slice(i,i+limit).trim();}).filter(Boolean).join('\n\n').slice(0,10000);
}
async function ensureWorkflowBundle(){
 if(workflowBundle)return workflowBundle;
 if(workflowBundlePromise)return workflowBundlePromise;
 workflowBundlePromise=(async()=>{
  const [masterResponse,referenceResponse]=await Promise.all([
   fetch(chrome.runtime.getURL(MASTER_RESOURCE_PATH)),
   fetch(chrome.runtime.getURL(REFERENCE_RESOURCE_PATH))
  ]);
  if(!masterResponse.ok)throw new Error('Bundled Master Template could not be read. Reload the extension files and retry.');
  if(!referenceResponse.ok)throw new Error('Bundled Complete Reference JSON could not be read. Reload the extension files and retry.');
  const [masterText,reference]=await Promise.all([masterResponse.text(),referenceResponse.json()]);
  if(!masterText.includes('V26.1 HARD LOCK')||!masterText.includes('READ → VERIFY → PLAN → PATCH MINIMALLY → VALIDATE → SEAL'))
   throw new Error('Bundled Master Template failed its integrity check; listing generation was stopped.');
  if(!reference||!reference.profiles||!Object.keys(reference.profiles).length)
   throw new Error('Bundled Reference JSON does not contain the expected profile map; listing generation was stopped.');
  const masterDigest=extractMasterDigest(masterText);
  if(!masterDigest)throw new Error('Master Template authority sections could not be extracted.');
  return {masterText,reference,masterDigest,masterFingerprint:hashText(masterText),referenceFingerprint:hashText(JSON.stringify(reference)),masterChars:masterText.length,referenceProfiles:Object.keys(reference.profiles).length};
 })();
 try{workflowBundle=await workflowBundlePromise;return workflowBundle;}
 catch(e){workflowBundlePromise=null;workflowBundle=null;throw e;}
}
function referenceTokenSet(value){
 return new Set(norm(String(value||'').replace(/_/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ')).split(/\s+/).filter(t=>t.length>=2||/^(hsn|gst|sku)$/.test(t)));
}
function referenceSimilarity(a,b){
 const ta=referenceTokenSet(a),tb=referenceTokenSet(b);let overlap=0;
 ta.forEach(token=>{if(tb.has(token))overlap+=/^(hsn|gst|sku|color|colour|material|weight|height|length|breadth|width|capacity|description|quantity|price|mrp|model)$/.test(token)?3:1;});
 const aa=norm(a).replace(/_/g,' '),bb=norm(b).replace(/_/g,' ');
 if(aa&&bb&&(aa.includes(bb)||bb.includes(aa)))overlap+=4;
 return overlap;
}
function chooseReferenceProfile(p,catalog,bundle){
 if(!bundle||!bundle.reference||!bundle.reference.profiles)return null;
 const text=norm([p&&p.productName,p&&p.productType,p&&p.productFacts,p&&p.productTypeEvidence,catalog&&catalog.name,catalog&&catalog.key].join(' '));
 const profiles=bundle.reference.profiles;let name='';
 if(/\b(lunch box|lunchbox|tiffin|food container)\b/.test(text)||catalog&&catalog.key==='kitchen')name='lunch box';
 else if(/\b(wiper|mop|squeegee|floor cleaner)\b/.test(text))name='wiper';
 else if(/\b(water dispenser|electric dispenser|dispenser machine)\b/.test(text))name='Electric Water';
 else if(/\b(water bottle|sipper bottle|drinking bottle|vacuum flask|thermos|water flask)\b/.test(text)){
  const capacity=capacityInMl(p&&p.productCapacity||'');
  name=/\b1\s*l\b|\b1l\b|\bone litre\b|\bone liter\b/.test(text)||capacity!==null&&capacity>=950?'WATER BATAL 1L':'WATER BATAL';
 }
 return name&&profiles[name]?{name,profile:profiles[name]}:null;
}
function buildReferencePlacementGuide(scan,p,catalog,bundle){
 if(!bundle)return {status:'unavailable',rule:'Do not infer facts or fields from a missing reference.'};
 const chosen=chooseReferenceProfile(p,catalog,bundle);
 if(!chosen)return {status:'loaded-no-exact-profile-match',availableProfiles:Object.keys(bundle.reference.profiles),rule:'Use reference JSON only for representation; do not import its example values.'};
 const profile=chosen.profile;
 const entries=Array.isArray(profile.fields)&&profile.fields.length?profile.fields.map(f=>({
  key:String(f.key||''),label:String(f.label||f.key||''),type:String(f.type||''),group:String(f.group||''),section:String(f.section||''),sectionKey:String(f.sectionKey||''),requirement:String(f.requirement||''),rowKey:String(f.rowKey||''),order:f.order
 })):Object.keys(profile.values||{}).map((key,index)=>({
  key,label:key.split('__').pop().replace(/_/g,' '),type:'value-key-only',group:'',section:key.split('__')[0]||'',sectionKey:key.split('__')[0]||'',requirement:'reference pattern only',rowKey:'',order:index
 }));
 const current=schema(scan||{}).fields,mapping=[];
 current.forEach(field=>{
  const target=String(field.identifier||'').replace(/_/g,' ')+' '+String(field.label||'');
  const hits=entries.map(entry=>({entry,score:referenceSimilarity(target,entry.key+' '+entry.label+' '+entry.group+' '+entry.section)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,2);
  if(hits.length)mapping.push({targetIdentifier:field.identifier,targetLabel:field.label,referenceCandidates:hits.map(hit=>({
   key:hit.entry.key,label:hit.entry.label,type:hit.entry.type,section:hit.entry.section,sectionKey:hit.entry.sectionKey,requirement:hit.entry.requirement,matchScore:hit.score
  }))});
 });
 mapping.sort((a,b)=>Math.max(...b.referenceCandidates.map(x=>x.matchScore))-Math.max(...a.referenceCandidates.map(x=>x.matchScore)));
 return {status:'loaded-reference-only',selectedProfile:chosen.name,profileHasDetailedFields:Array.isArray(profile.fields)&&profile.fields.length>0,
  referenceFieldCount:entries.length,referenceContainers:Object.keys(profile.tabBackups||{}),currentMeeshoScannedFieldCount:current.length,
  semanticKeyMatches:mapping.slice(0,28),strictRule:'Reference field keys/sections/types guide placement only. Exclude all reference profile values and option lists. Current scanned Meesho schema controls identifiers, types, required status and allowed options.'};
}

async function identifyProductFromPhotos(imgs,providedFacts,catalog,context){
 const prompt=[
  'Identify the actual product type and clearly visible attributes from the supplied product photos. Use the already-selected Meesho category as primary context.',
  'Return ONLY valid JSON: {"productName":"short product type, not a marketplace listing title","productType":"","brandIfLegible":"","modelIfLegible":"","colorIfClear":"one dominant primary product color only, e.g. Light Blue","materialIfClear":"","capacityIfPrinted":"","visibleText":[],"searchTerms":[],"visionConflicts":[],"confidence":"high|medium|low"}.',
  'Inspect every supplied product photo, not just the first view. Identify the one dominant product color from the item itself, ignoring backgrounds, collage borders and small accents. If different photos appear to show different variants or materially conflicting product facts, report the conflict rather than merging variants. Return one color name only. Do not copy marketplace titles or use image filenames as facts. Do not invent brand, model, capacity, material or features. The searchTerms must describe visible product identity/use/construction and be useful for exact-product web research.',
  'Selected Meesho category/type:',JSON.stringify({name:catalog&&catalog.name||'',type:catalog&&catalog.type||'',key:catalog&&catalog.key||'',context:context||{}}),
  'Seller-provided confirmed facts:',String(providedFacts||'none supplied')
 ].join('\n');
 return parseJson((await callAI(prompt,imgs,17,12,'identity')).text);
}

function promptFor(scan,p,d,s,research){
 const bundle=workflowBundle;
 const data={
  platform:'Meesho supplier catalog listing form',
  selectedMeeshoCatalog:safeMeeshoCatalogContext(scan.catalogContext||{}),
  autoDetectedCatalog:detectMeeshoCatalog(scan),
  productInputs:p,
  sellerDefaults:d,
  scannedFields:s.fields.map(f=>({identifier:f.identifier,label:f.label,section:f.section,mandatory:f.mandatory,inputType:f.inputType,allowedValues:f.values})),
  currentFormValues:scan.capturedValues||{},
  categoryResearchSeed:research.seed||'',
  webResearchResults:(research.results||[]).map(r=>({title:r.title,url:r.url,domain:r.domain,snippet:r.snippet,query:r.query,searchProvider:r.searchProvider})),
  officialGovernmentTaxReferences:(research.officialTaxReferences||[]).map(r=>({title:r.title,url:r.url,domain:r.domain,snippet:r.snippet})),
  measurementEstimates:research.measurementEstimates||{},
  preverifiedTaxClassification:research.automaticTaxClassification||null,
  masterTemplateAuthority:bundle?{file:MASTER_RESOURCE_PATH,version:'V26.1 HARD LOCK',fingerprint:bundle.masterFingerprint,characters:bundle.masterChars,referenceFile:REFERENCE_RESOURCE_PATH,referenceFingerprint:bundle.referenceFingerprint,referenceProfiles:bundle.referenceProfiles,excerpts:bundle.masterDigest}:null,
  completeReferencePlacementGuide:buildReferencePlacementGuide(scan,p,detectMeeshoCatalog(scan),bundle)
 };
 return [
  'You are an evidence-first Indian e-commerce catalog listing assistant. Inspect attached product photos, selected Meesho category, user inputs, scanned form schema and research evidence before drafting values.',
  'Return ONLY valid JSON: {"values":{"existing_field_identifier":"string value"},"titleOptions":[{"title":"original SEO title between 201 and 250 characters inclusive","reason":"brief reason","recommended":true}],"needsConfirmation":[{"identifier":"existing_field_identifier","reason":"short reason"}],"evidence":{"hsn_code":{"url":"exact URL from webResearchResults or officialGovernmentTaxReferences"},"supplier_gst_percent":{"url":"exact URL from webResearchResults or officialGovernmentTaxReferences"}}}. Provide 4 unique titleOptions whenever a product title field exists. Exactly one recommended=true. Do not return markdown.',
  'EXECUTION AUTHORITY: Follow the bundled Master Template PRO MAX V26/V26.1 hard-lock excerpts in masterTemplateAuthority. Perform READ → VERIFY → PLAN → MAP/PATCH MINIMALLY → VALIDATE → APPLY. Do not claim completion while a required/legal/source gate is blocked.',
  'REFERENCE JSON AUTHORITY: completeReferencePlacementGuide is placement/representation guidance only. Never copy its example field values, seller values, product facts, options or profile facts into this product. Current scanned Meesho fields, identifiers, types and allowed options are the only schema authority. Cross-platform keys may guide semantic mapping only; never create or rename Meesho fields.',
  'The seller already selected the Meesho category. Inspect all uploaded product photos first, then use visual identity clues in web research, then map evidence to only the scanned Meesho fields, validate allowed options and mandatory fields, and wait for the seller to click Autofill to apply. Never skip research/mapping audit stages or claim a field was researched when it was not.',
  'TITLE CREATION RULE: Create original titles yourself from product photos, selected Meesho category, verified material/color/size/features and seller-entered pack quantity. Never copy, paraphrase or imitate another website title as a title template. Web result titles may help identify similar products and specifications, but must never be copied or used as a title template.',
  'Every title must be at least 201 and no more than 250 characters, counting spaces and punctuation. Return four intentionally different approaches in this order: (1) SEO keyword-first using natural high-intent product search terms; (2) feature-led highlighting one or two verified differentiators; (3) use-case-led focused on relevant everyday use; (4) clean structured buyer-friendly title emphasizing product type and confirmed attributes. Use clearly different openings and wording, not four near-duplicates or the same attribute sequence. No keyword stuffing, repetitive phrases, invented claims, image filenames or extensions such as .png, .jpg, .jpeg, .webp or .gif. IMPORTANT: Never put listing placeholders or internal metadata into customer-facing titles: do not write Not Branded, Non Branded, Unbranded, No Brand, Unknown, N/A, None, or Brand Not Specified. If the brand is not verified, omit the brand entirely. Use only slash-separated factual segments and exactly one recommended=true.',
  'Pack quantity is the seller-entered number of sale units/pieces in a pack, not the number of photos. Use the exact pack count in title, description and matching Net Quantity / Multipack form field, obeying exact dropdown values. Never infer multi-pack count from multiple images or angles.',
  'Try every scanned field. Prefer official/verified source facts, photo evidence, seller inputs and matching seller defaults. Never create field identifiers.',
  'For description fields, target 950–1000 characters including spaces; never exceed 1000. Include only known product details, sensible usage context, and care guidance when supported. Never pad with filler. Do not claim food-grade, insulation, hot/cold retention, leak-proof, BPA-free, certification, compatibility or special construction unless verified.',
  'Use source titles/snippets only as evidence to identify exact or similar products and their specifications, not as title text to copy. Cite only URLs present in webResearchResults or officialGovernmentTaxReferences.',
  'HSN CODE AND GST RATE ARE REQUIRED PRIORITIES. Classify from selected category, photo-derived attributes, material and use—not an external listing title. Use current official Government of India/CBIC evidence. If preverifiedTaxClassification exists, use it only when its category/material basis fits this product. Otherwise provide a candidate only when official evidence supports it; the extension will run targeted official-source searches for candidate HSN/GST values. Keep tax fields unresolved only after targeted official searches fail.',
  'For dimensions and weight, prefer exact-model specifications. If no exact match exists after research, use reasonable estimates from relevant similar products in the same category/construction and mark them ESTIMATED, preferably using a median across distinct source domains. Never label an estimate as exact. If no reliable similar-product measurement is found, leave that field unresolved.',
  'Style Code/Product ID and SKU can be generated from product type and known attributes using uppercase letters/numbers/hyphens; the extension may apply stable codes after this draft.',
  'A seller-entered selling price may only populate explicit selling/transfer price fields; never copy it into MRP, wrong/defective return price or other price fields. Do not invent prices, MRP, inventory or sales quantities.',
  'Dropdown values must exactly match allowedValues. Do not approximate dropdown size/capacity. If no exact allowed option exists, leave blank and explain why.',
  'Do not modify existing non-empty form values. Do not use seller address as manufacturer/packer address or mark importer not required without evidence.',
  'Research evidence:',JSON.stringify(data)
 ].join('\n');
}

async function generate(googleAllowed){
 try{
  clearLiveLog();resetWorkflowSteps();activePhotoConflicts=[];productIdentityScore=0;productIdentityStatus='UNASSESSED';
  setWorkflowStep('authority','running','Loading the bundled Master Template and complete reference JSON.');
  workflowBundle=await ensureWorkflowBundle();
  liveLog('MASTER AUTHORITY · bundled template verified · fingerprint '+workflowBundle.masterFingerprint+' · reference profiles '+workflowBundle.referenceProfiles+'.','ok');
  setWorkflowStep('authority','done','Master V26.1 verified; '+workflowBundle.referenceProfiles+' reference profiles loaded without importing example values.');
  liveLog('PIPELINE START · image analysis → web research → reference-guided field mapping → validation → manual Apply','info');
  setProgress(2,'Scanning Meesho catalog fields');
  say('Scanning the selected Meesho catalog…');
  const scan=await scanCurrentCatalog(false),s=schema(scan);
  if(!s.fields.length)throw new Error('No form fields found. Select the catalog and scan again.');
  let detectedCatalog=detectMeeshoCatalog(scan);
  let category=detectedCatalog.key||'general';
  scan.catalogContext=Object.assign({},scan.catalogContext||{},{detectedCategory:detectedCatalog.name,detectedCategoryKey:category,productType:detectedCatalog.type,confidence:detectedCatalog.confidence});
  liveLog('CATALOG SCAN · '+s.fields.length+' mapped fields; '+s.measurements.length+' per-size measurement fields.','ok');
  liveLog('AUTO CATEGORY · '+detectedCatalog.name+' · '+detectedCatalog.confidence+' confidence'+(detectedCatalog.evidence.length?' · signals: '+detectedCatalog.evidence.slice(0,3).join(', '):'')+'.','ok');
  setProgress(9,'Catalog scanned · '+detectedCatalog.name);
  updateScanSummary(scan);

  const inventoryInput=$('ai-product-inventory');
  if(inventoryInput&&!String(inventoryInput.value||'').trim())inventoryInput.value='100';
  const p={
   productName:stripImageFilenameArtifacts($('ai-product-name').value).trim(),material:$('ai-product-material').value.trim(),
   color:normalizePrimaryColor($('ai-product-color').value),productWeight:$('ai-product-weight').value.trim(),
   packQuantity:$('ai-product-pack-quantity')?String(Math.max(1,Math.floor(Number($('ai-product-pack-quantity').value)||1))):'1',
   productLength:$('ai-product-length').value.trim(),productWidth:$('ai-product-width').value.trim(),
   productHeight:$('ai-product-height').value.trim(),productCapacity:$('ai-product-capacity')?$('ai-product-capacity').value.trim():'',
   sellingPrice:$('ai-product-price').value.trim(),productMrp:$('ai-product-mrp')?$('ai-product-mrp').value.trim():'',
   inventory:inventoryInput&&String(inventoryInput.value||'').trim()?String(Math.max(0,Math.floor(Number(inventoryInput.value)||0))):'100',
   productCategory:category,
   productType:detectedCatalog.type,
   productFacts:$('ai-product-facts').value.trim()
  };
  if(inventoryInput)inventoryInput.value=p.inventory;
  if(p.sellingPrice){
   const enteredSelling=parseMoney(p.sellingPrice);
   if(enteredSelling===null||enteredSelling<=5)throw new Error('Meesho selling price must be greater than ₹5 so Wrong/Defective Returns Price can always be set to selling price minus ₹5.');
  }
  if(p.productMrp){
   const enteredMrp=parseMoney(p.productMrp);
   if(enteredMrp===null||enteredMrp<=0)throw new Error('Enter a valid positive MRP copied from the product/package; MRP will not be invented.');
  }
  p.wrongReturnPrice=calculateWrongReturnPrice(p.sellingPrice);
  updatePricePreview();
  if(p.sellingPrice&&p.wrongReturnPrice)liveLog('PRICE RULE · Meesho Price ₹'+p.sellingPrice+' → Wrong/Defective Returns Price ₹'+p.wrongReturnPrice+' (₹5 less).','ok');
  else if(p.sellingPrice)liveLog('PRICE RULE · Selling price must be greater than ₹5 to calculate a non-negative returns price.','warn');
  else liveLog('PRICE RULE · Selling Price not entered; price fields stay blank until supplied.','warn');
  liveLog('INVENTORY · '+p.inventory+' unit(s) selected'+(inventoryInput?' (editable; default 100).':'.'),'info');
  if(p.productMrp)liveLog('MRP · Using the seller-entered MRP ₹'+p.productMrp+'.','info');
  else liveLog('MRP · No verified MRP entered; will not invent one.','warn');

  setProgress(13,'Loading seller profile and matching '+detectedCatalog.name+' defaults');
  let d=await getActiveDefaultsForCategory(category);
  liveLog('SELLER PROFILE · '+(($('ai-profile-name')&&$('ai-profile-name').value)||'Active profile')+' · automatic catalog override: '+category+'.','ok');
  const imgs=await images();
  let identified=null;
  let sellerProductNameProvided=Boolean(String(p.productName||'').trim());
  setWorkflowStep('photos','running','Analyzing '+imgs.length+' uploaded photo(s) individually across AI batches.');
  if(p.productName&&imgs.some(img=>norm(cleanSearchSeed(img.name))===norm(cleanSearchSeed(p.productName)))){
   p.productName='';$('ai-product-name').value='';sellerProductNameProvided=false;liveLog('FILENAME GUARD · removed an image filename reused as a product name.','info');
  }
  setProgress(18,'Photos ready · identify product type and visual search clues');
  try{
   setProgress(19,'Reading product photos and selected catalog attributes');
   say('Analyzing product photos for category-specific research clues…');
   liveLog('VISION IDENTIFICATION · extracting visible attributes for targeted research; file names are excluded.','info');
   identified=await identifyProductFromPhotos(imgs,p.productFacts,detectedCatalog,safeMeeshoCatalogContext(scan.catalogContext||{}));
   activePhotoConflicts=Array.isArray(identified.visionConflicts)?identified.visionConflicts:[];
   setWorkflowStep('photos','done',imgs.length+' photo(s) analysed before research; visual identity clues captured.');
   liveLog('PHOTO ANALYSIS · '+imgs.length+' of '+imgs.length+' supplied image(s) analysed before web search.','ok');
   (identified.visionConflicts||[]).forEach(conflict=>liveLog('PHOTO CONFLICT · '+conflict.field+': '+conflict.values.join(' vs ')+'. Confirm this product/variant before applying.','warn'));
   const candidate=stripImageFilenameArtifacts(String(identified.productName||identified.productType||identified.title||'')).trim();
   const confidence=String(identified.confidence||'medium').toLowerCase();
   if(!p.productName&&candidate.length>=3&&confidence!=='low'){
    p.productName=candidate;$('ai-product-name').value=candidate;
    liveLog('VISION IDENTIFICATION · identified the product type from photos.','ok');
   }else if(!p.productName){
    const ctx=safeMeeshoCatalogContext(scan.catalogContext||{});
    p.productName=stripImageFilenameArtifacts(ctx.subCategoryName||ctx.categoryName||detectedCatalog.type||detectedCatalog.name||'Product');$('ai-product-name').value=p.productName;
    liveLog('VISION IDENTIFICATION · low confidence; using selected Meesho catalog as product-type fallback, not image filenames.','warn');
   }else{
    liveLog('VISION IDENTIFICATION · seller product name retained; photo clues will improve research and matching.','info');
   }
   const brand=String(identified.brandIfLegible||'').trim(),model=String(identified.modelIfLegible||'').trim();
   if(brand||model)liveLog('VISION IDENTIFICATION · readable brand/model clues detected; these are research hints until corroborated.','info');
   const color=normalizePrimaryColor(identified.colorIfClear||'');
   if(!p.color&&color){p.color=color;const colorInput=$('ai-product-color');if(colorInput)colorInput.value=color;liveLog('PRIMARY COLOR · photo analysis selected '+color+' as the single dominant product color.','ok');}
   else if(p.color){p.color=normalizePrimaryColor(p.color);const colorInput=$('ai-product-color');if(colorInput)colorInput.value=p.color;}
   const material=String(identified.materialIfClear||'').trim();if(!p.material&&material)p.material=material;
   const cap=String(identified.capacityIfPrinted||'').trim();if(!p.productCapacity&&capacityInMl(cap)!==null)p.productCapacity=cap;
   const visualTerms=[
    identified.productType,identified.brandIfLegible,identified.modelIfLegible,
    identified.colorIfClear,identified.materialIfClear,identified.capacityIfPrinted,
    ...(Array.isArray(identified.searchTerms)?identified.searchTerms:[]),
    ...(Array.isArray(identified.visibleText)?identified.visibleText:[])
   ].map(x=>String(x||'').trim()).filter(Boolean);
   p.productTypeEvidence=stripImageFilenameArtifacts(visualTerms.join(' ')).slice(0,500);
   p.imageResearchTerms=p.productTypeEvidence;
   const visible=Array.isArray(identified.visibleText)?identified.visibleText.map(x=>String(x||'').trim()).filter(Boolean).slice(0,8):[];
   const facts=[String(p.productFacts||'').trim(),p.productTypeEvidence?'Photo-derived research clues (verify against sources): '+p.productTypeEvidence:'',visible.length?'Readable product text from photos (verify): '+visible.join('; '):''].filter(Boolean);
   p.productFacts=facts.join(' | ').slice(0,1000);
   productIdentityScore=scoreProductIdentity(p,identified,sellerProductNameProvided);
   productIdentityStatus=productIdentityBand(productIdentityScore);
   p.productIdentityScore=productIdentityScore;p.productIdentityStatus=productIdentityStatus;
   liveLog('PRODUCT IDENTITY LOCK · '+productIdentityScore+'/100 · '+productIdentityStatus+'. Exact external facts stay blocked below 70; scores 70–84 require seller approval.',''+(productIdentityScore<70?'warn':'info'));
   setWorkflowStep('photos',productIdentityScore<70?'blocked':'done',imgs.length+' photo(s) analysed · identity '+productIdentityScore+'/100 ('+productIdentityStatus+').');
   if(identified.searchTerms&&identified.searchTerms.length)liveLog('VISION IDENTIFICATION · '+identified.searchTerms.length+' visual search term(s) will be used to find similar products, not to copy their titles.','ok');
  }catch(e){
   productIdentityScore=0;productIdentityStatus='BLOCKED — INPUT REQUIRED';
   setWorkflowStep('photos','blocked','AI photo identity analysis failed; exact-product identity is not established.');
   const ctx=safeMeeshoCatalogContext(scan.catalogContext||{});
   if(!p.productName){p.productName=stripImageFilenameArtifacts(ctx.subCategoryName||ctx.categoryName||detectedCatalog.type||detectedCatalog.name||'Product');$('ai-product-name').value=p.productName;}
   liveLog('VISION IDENTIFICATION · photo clue extraction failed; only the selected form/category remains. Research must not treat category fallback as exact product evidence. Details: '+redactSecrets(e,null),'warn');
  }
  if(!p.productCapacity){
   const capMatch=String(p.productFacts+' '+p.productName).match(/\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i);
   if(capMatch)p.productCapacity=capMatch[1]+' '+capMatch[2];
  }
  // If schema-only evidence is ambiguous, refine from the photo-identified title or image filename.
  if(detectedCatalog.confidence==='low'){
   const visionRefined=detectMeeshoCatalog(scan);
   if(visionRefined.key!=='general'&&visionRefined.confidence!=='low'){
    detectedCatalog=visionRefined;category=visionRefined.key;
    p.productCategory=category;p.productType=visionRefined.type;
    scan.catalogContext=Object.assign({},scan.catalogContext||{},{detectedCategory:visionRefined.name,detectedCategoryKey:category,productType:visionRefined.type,confidence:visionRefined.confidence});
    d=await getActiveDefaultsForCategory(category);
    liveLog('AUTO CATEGORY REFINED · '+visionRefined.name+' using product title/image hints plus the selected catalog schema.','ok');
    updateScanSummary(scan);
   }
  }
  setWorkflowStep('research','running','Searching using photo-derived product name, color, material, capacity and selected Meesho form.');
  setProgress(31,'Searching product specifications and official tax sources');
  say('Researching category-based product specifications and official tax sources…');
  liveLog('WEB RESEARCH · queries are based on selected category, form attributes and photo context—not an external listing title.','info');
  researchNow=await researchProduct(p,imgs,googleAllowed,scan,detectedCatalog);
  researchNow.photoAnalysis={imagesAnalysed:imgs.length,productName:p.productName,productType:p.productTypeEvidence||p.productType,color:p.color||'',material:p.material||'',capacity:p.productCapacity||'',confidence:identified&&identified.confidence||'unknown',identityScore:productIdentityScore,identityStatus:productIdentityStatus,conflicts:identified&&identified.visionConflicts||[]};
  attachOfficialTaxReferences(researchNow,p,imgs,scan,detectedCatalog);
  researchNow.measurementEstimates=buildMeasurementEstimates(researchNow,s.fields,scan);
  if(researchNow.automaticTaxClassification)liveLog('OFFICIAL TAX RULE · '+researchNow.automaticTaxClassification.productType+' · HSN '+researchNow.automaticTaxClassification.hsn+' · GST '+researchNow.automaticTaxClassification.gst+'. Official Government of India and CBIC references attached.','ok');
  renderResearchSources(researchNow);
  liveLog('WEB RESEARCH · '+researchNow.results.length+' result(s) captured from '+new Set(researchNow.results.map(r=>r.domain)).size+' domain(s).','ok');
  if(researchNow.results.length){setWorkflowStep('research','done',researchNow.results.length+' web result(s) plus '+(researchNow.officialTaxReferences||[]).length+' official tax reference(s) recorded.');}
  else{setWorkflowStep('research','blocked','No web results captured. Check Search permission/network; do not treat photo-only guesses as researched facts.');}
  if(researchNow.error)liveLog('WEB RESEARCH · '+researchNow.error,'warn');
  setProgress(45,'Analyzing product photos in batches');
  say('Analyzing all photos and matching values to the scanned field schema…');
  setWorkflowStep('mapping','running','Matching evidence to the current Meesho form; Reference JSON is used only for semantic key/placement hints.');
  const answer=await callAI(promptFor(scan,p,d,s,researchNow),imgs,46,25);
  const parsed=parseJson(answer.text),proposed=parsed&&parsed.values&&typeof parsed.values==='object'?parsed.values:{},evidence=parsed&&parsed.evidence&&typeof parsed.evidence==='object'?parsed.evidence:{};
  if(!p.color){
   const colorField=s.fields.find(f=>/\bcolor\b/.test(norm(fieldText(f))));
   const modelColor=normalizePrimaryColor(colorField&&proposed[colorField.identifier]||'');
   const titleColor=normalizePrimaryColor((Array.isArray(parsed.titleOptions)?parsed.titleOptions:[]).map(x=>x&&x.title||'').join(' ')+' '+p.productName);
   const detectedPrimary=modelColor||titleColor;
   if(detectedPrimary){p.color=detectedPrimary;const colorInput=$('ai-product-color');if(colorInput)colorInput.value=detectedPrimary;liveLog('PRIMARY COLOR · selected '+detectedPrimary+' as the single dominant product color.','ok');}
  }
  if(productIdentityScore>=70)await enrichTaxEvidence(proposed,evidence,researchNow,s.fields,p,scan,detectedCatalog);
  else liveLog('IDENTITY HARD LOCK · targeted exact-product HSN/GST candidate checks are not accepted below 70/100. Improve product identity evidence and re-run analysis.','warn');
  const values=Object.assign({},scan.capturedValues||{}),needs=Array.isArray(parsed.needsConfirmation)?parsed.needsConfirmation.slice(0,80):[];
  if(productIdentityScore<70)needs.push({identifier:'product_identity',reason:'Identity score '+productIdentityScore+'/100 is below the Master Template minimum. Add a specific product name, clear product photos or verified product details, then regenerate before applying.'});
  else if(productIdentityScore<85)needs.push({identifier:'product_identity_approval',reason:'Identity score '+productIdentityScore+'/100 is in the POSSIBLE — APPROVAL range. Verify that the photos, color, capacity and product name all describe the same item before applying.'});
  (identified&&Array.isArray(identified.visionConflicts)?identified.visionConflicts:[]).forEach(conflict=>needs.push({identifier:'photo_identity_'+String(conflict.field||'conflict'),reason:'Photo analysis conflict for '+String(conflict.field||'product identity')+': '+(conflict.values||[]).join(' vs ')+'. Confirm that all photos show the same product variant before applying.'}));
  // Meesho's default GST "0" is a placeholder, not a researched product tax rate.
  // Remove only obvious placeholder values so the AI/research result can replace them.
  s.fields.forEach(f=>{
   if(!isTaxField(f))return;
   const oldTax=captured(scan,f.identifier);
   if(['0','0%','--','select','not selected'].includes(norm(oldTax)))delete values[f.identifier];
  });
  let ai=0,presetCount=0,bad=0,generated=0;
  const titleField=s.fields.find(isProductNameField);
  activeTitleFieldId=titleField?titleField.identifier:'';
  const titleContext=safeMeeshoCatalogContext(scan.catalogContext||{});
  const baseSuggestedTitle=stripImageFilenameArtifacts(p.productName||(titleField&&String(proposed[titleField.identifier]||'').trim())||titleContext.subCategoryName||titleContext.categoryName||detectedCatalog.type||detectedCatalog.name||'Product');
  titleChoices=buildTitleChoices(parsed.titleOptions,baseSuggestedTitle,p,d);
  draftEditMode=false;draftBeforeEdit=null;draftEditedFields=new Set();
  const recommendedTitle=(titleChoices.find(x=>x.recommended)||titleChoices[0]||{}).title||baseSuggestedTitle;
  const draftTitle=cleanTitle(recommendedTitle||baseSuggestedTitle);
  p.productName=draftTitle||p.productName;
  if(p.productName&&$('ai-product-name'))$('ai-product-name').value=p.productName;
  currentTitleProduct=Object.assign({},p);
  if(!p.productCapacity){
   const capMatch=String(p.productFacts+' '+draftTitle).match(/\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i);
   if(capMatch)p.productCapacity=capMatch[1]+' '+capMatch[2];
  }
  p.wrongReturnPrice=calculateWrongReturnPrice(p.sellingPrice);
  if(p.sellingPrice&&!p.wrongReturnPrice)needs.push({identifier:'only_wrong_return_price',reason:'Enter a selling price greater than ₹5; the returns price is always calculated as selling price minus ₹5.'});
  if(p.sellingPrice&&p.productMrp&&parseMoney(p.productMrp)<parseMoney(p.sellingPrice))needs.push({identifier:'product_mrp',reason:'Entered MRP is lower than the selling price. Verify the printed MRP and price before submitting.'});
  const codes=draftTitle?await productCodes(draftTitle,p):{styleCode:'',skuCode:''};
  setProgress(73,'Mapping verified facts, pricing, profile details and generated codes');
  liveLog('VALUE MAPPING · applying title-based SKU/Style Code, seller defaults and explicit pricing rules.','info');
  s.fields.forEach(f=>{
   const old=captured(scan,f.identifier);
   if(isTaxField(f)&&productIdentityScore<70){needs.push({identifier:f.identifier,reason:'HSN/GST exact classification is blocked because product identity is below 70/100. No category-only tax guess is allowed.'});return;}
   const fixed=isTaxField(f)?'':preset(f,p,d);
   const isPriceOrInventory=/(meesho_price|only_wrong_return_price|product_mrp|inventory)/.test(String(f.identifier||''))||/(meesho price|wrong|defective|return price|\bmrp\b|inventory|stock quantity)/.test(norm(f.label));
   // Respect already-entered Meesho values unless the seller explicitly supplied the new pricing value.
   if(old&&!isPriceOrInventory&&!isDescriptionField(f)&&!isTaxField(f)){values[f.identifier]=old;return;}
   if(old&&isPriceOrInventory&&!fixed){values[f.identifier]=old;return;}
   if(fixed){const fixedOption=dropdownEquivalent(fixed,f);if(fixedOption&&allowed(fixedOption,f)){values[f.identifier]=String(fixedOption);presetCount++;}else{needs.push({identifier:f.identifier,reason:'Seller-entered price/default does not exactly match the allowed dropdown options.'});bad++;}return;}
   if(isPriceOrInventory){
    if(old){values[f.identifier]=old;return;}
    if(f.mandatory&&!needs.some(n=>n&&n.identifier===f.identifier)){
     const reason=/mrp|maximum retail/.test(norm(f.label))?'MRP needs the actual printed/verified value.':/(wrong|defective|return)/.test(norm(f.label))?'Enter a selling price greater than ₹5 so the returns price can be calculated as selling price minus ₹5.':'Enter or confirm the price/stock value.';
     needs.push({identifier:f.identifier,reason});
    }
    return;
   }
   const generatedValue=generatedCodeForField(f,codes);
   if(generatedValue){
    if(allowed(generatedValue,f)){values[f.identifier]=generatedValue;generated++;}
    else{needs.push({identifier:f.identifier,reason:'Generated Style Code/SKU does not match this field’s allowed options; check the field manually.'});bad++;}
    return;
   }
   // Evidence-backed deterministic mapping for an explicitly identified vacuum flask.
   if(isTaxField(f)&&researchNow.automaticTaxClassification){
    const isHsn=/\bhsn\b/.test(norm(String(f.identifier||'').replace(/_/g,' ')+' '+f.label));
    const candidate=isHsn?researchNow.automaticTaxClassification.hsn:researchNow.automaticTaxClassification.gst;
    const sourceUrl=isHsn?researchNow.automaticTaxClassification.hsnSourceUrl:researchNow.automaticTaxClassification.gstSourceUrl;
    let allowedCandidate=candidate;
    if(f.values.length){
     const n=value=>Number((String(value).match(/\d+(?:\.\d+)?/)||[])[0]);
     allowedCandidate=f.values.find(option=>isHsn
      ?String(option).replace(/\D/g,'')===String(candidate).replace(/\D/g,'')
      :n(option)===n(candidate))||'';
    }
    const src=allowedCandidate?officialTaxEvidence(f,allowedCandidate,{url:sourceUrl},researchNow):null;
    if(src){
     values[f.identifier]=String(allowedCandidate).trim();ai++;
     clearNeedsForField(needs,f.identifier);
     liveLog('OFFICIAL TAX FIELD · researched and applied to Draft: '+f.label+' = '+allowedCandidate+' · '+src.url,'ok');
    }else{
     needs.push({identifier:f.identifier,reason:'The official preverified classification did not match this field’s permitted options. Autofill will be blocked until this mandatory tax field is resolved.'});
    }
    return;
   }
   const v=proposed[f.identifier];if(v===undefined||v===null||!String(v).trim())return;
   const mappedValue=dropdownEquivalent(String(v),f);
   if(!mappedValue||!allowed(mappedValue,f)){needs.push({identifier:f.identifier,reason:'AI value is not an exact permitted dropdown option. Choose the matching Meesho option in Edit Draft.'});bad++;return;}
   if(isPhysicalMeasureField(f)&&!sourceSupportsExactMeasure(f,mappedValue,researchNow)){
    const estimate=researchNow.measurementEstimates&&researchNow.measurementEstimates[f.identifier];
    if(estimate&&estimate.value){values[f.identifier]=String(estimate.value);ai++;clearNeedsForField(needs,f.identifier);liveLog('MEASUREMENT ESTIMATE · applied to Draft: '+f.label+' = '+estimate.value+' '+(estimate.unit||'')+' · '+(estimate.sourceCount||1)+' related source(s); editable in Draft.','warn');return;}
    needs.push({identifier:f.identifier,reason:'Research checked same-category measurement sources but found no usable exact value or supported estimate. This field remains unresolved.'});return;
   }
   if(isTaxField(f)){
    const src=officialTaxEvidence(f,mappedValue,evidence[f.identifier],researchNow);
    if(!src){
     needs.push({identifier:f.identifier,reason:'AI suggested candidate "'+String(v)+'", but Google results did not contain a directly matching official CBIC/GST source for this exact code/rate. It was not filled. Verify the product classification before use.'});
     return;
    }
    values[f.identifier]=String(mappedValue).trim();ai++;
    clearNeedsForField(needs,f.identifier);
    liveLog('OFFICIAL TAX FIELD · exact Government evidence matched and applied to Draft: '+f.label+' = '+mappedValue+' · '+src.url,'ok');
    return;
   }
   values[f.identifier]=String(mappedValue).trim();ai++;
  });
  Object.entries(researchNow.measurementEstimates||{}).forEach(([identifier,estimate])=>{
   if(!estimate||!estimate.value||String(values[identifier]||'').trim())return;
   values[identifier]=String(estimate.value);clearNeedsForField(needs,identifier);
   liveLog('MEASUREMENT ESTIMATE · applied to Draft: '+identifier+' = '+estimate.value+' '+(estimate.unit||'')+' from '+(estimate.sourceCount||1)+' similar-product source(s); clearly marked ESTIMATED and editable.','warn');
  });
  const estimates=Object.values(researchNow.measurementEstimates||{});
  const hasDimensionEstimate=estimates.some(x=>x&&x.kind!=='weight');
  const hasWeightEstimate=estimates.some(x=>x&&x.kind==='weight');
  const autoUnit=(field,unit)=>{
   if(!field||String(values[field.identifier]||captured(scan,field.identifier)||'').trim())return;
   const option=dropdownEquivalent(unit,field);
   if(option&&allowed(option,field))values[field.identifier]=option;
  };
  if(hasDimensionEstimate)autoUnit(s.fields.find(f=>/\b(product unit|dimension unit|measurement unit)\b/.test(fieldText(f))),'cm');
  if(hasWeightEstimate)autoUnit(s.fields.find(f=>/\b(product weight unit|weight unit)\b/.test(fieldText(f))),'G');
  setProgress(77,'Preparing a 950–1000 character description');
  const descriptionField=s.fields.find(isDescriptionField);
  if(descriptionField){
   const before=String(values[descriptionField.identifier]||proposed[descriptionField.identifier]||captured(scan,descriptionField.identifier)||'');
   if(before){
    const description=await refineDescriptionToBudget(before,draftTitle,p,imgs);
    values[descriptionField.identifier]=description;
    liveLog('DESCRIPTION FIELD · '+description.length+'/1000 characters prepared for '+descriptionField.label+'.','ok');
   }else{
    needs.push({identifier:descriptionField.identifier,reason:'AI did not return a supported description. Review the available product facts and retry.'});
    liveLog('DESCRIPTION FIELD · no description returned by the model.','warn');
   }
  }
  if(p.productCapacity){
   const capacityFields=s.fields.filter(f=>/(capacity|volume)/i.test(f.label+' '+String(f.identifier||'').replace(/_/g,' ')));
   capacityFields.forEach(f=>{
    if(captured(scan,f.identifier))return;
    const label=norm(f.label+' '+f.identifier),ml=capacityInMl(p.productCapacity);if(ml===null)return;
    const candidate=exactCapacityOption(f,ml,label);
    if(candidate&&allowed(candidate,f))values[f.identifier]=candidate;
    else if(f.values.length&&!needs.some(n=>n&&n.identifier===f.identifier))needs.push({identifier:f.identifier,reason:'Product capacity '+(ml>=1000?(ml/1000)+' L':ml+' ml')+' has no semantically exact matching dropdown option. Select the correct option manually; none was guessed.'});
   });
  }
  setProgress(90,'Checking mandatory fields, dropdown options and size variants');
  s.measurements.forEach(f=>{if(f.mandatory&&!needs.some(n=>n&&n.identifier===f.identifier))needs.push({identifier:f.identifier,reason:'Actual per-size measurement is required; do not estimate from a photo.'});});
  s.fields.forEach(f=>{
   if(f.mandatory&&!String(values[f.identifier]||'').trim()&&!needs.some(n=>n&&n.identifier===f.identifier))
    needs.push({identifier:f.identifier,reason:'Required field is blank because a verified value was not found.'});
  });
  const unresolvedTaxFields=s.fields.filter(f=>isTaxField(f)&&(!String(values[f.identifier]||'').trim()||![...(researchNow.results||[]),...(researchNow.officialTaxReferences||[])].some(row=>officialTaxEvidence(f,String(values[f.identifier]||'').trim(),{url:row.url},researchNow))));
  unresolvedTaxFields.forEach(f=>{
   if(!needs.some(n=>n&&n.identifier===f.identifier))needs.push({identifier:f.identifier,reason:'Mandatory tax field unresolved. Add/confirm an official classification source before Autofill; the extension will not submit a blank or fabricated HSN/GST value.'});
  });
  draft=values;pending=needs;
  currentTitleProduct=Object.assign({},p);currentTitleFields=s.fields;currentTitleMeasurements=s.measurements||[];currentTitleStats={ai,preset:presetCount,generated,bad};currentTitleNeeds=needs;
  renderTitleOptions();
  liveLog('DRAFT READY · AI '+ai+', defaults '+presetCount+', generated codes '+generated+', dropdown mismatches '+bad+', confirmation items '+needs.length+'.','ok');
  renderTaxApplicationSummary(values,s.fields,researchNow);
  showPreview(s.fields,values,needs,{ai,preset:presetCount,generated,bad},researchNow);
  const autofillButton=$('ai-autofill-btn');
  if(autofillButton){autofillButton.disabled=!Object.values(values).some(v=>String(v||'').trim());autofillButton.title=unresolvedTaxFields.length?'HSN/GST values are unresolved. Click for guidance or edit the tax fields in Draft.':'';}
  const photoConflictNeeds=(identified&&identified.visionConflicts||[]).length;
  const mappingBlocked=unresolvedTaxFields.length>0||photoConflictNeeds>0||productIdentityScore<70;
  setWorkflowStep('mapping',mappingBlocked?'blocked':'done',Object.keys(values).filter(k=>String(values[k]||'').trim()).length+' mapped value(s); identity '+productIdentityScore+'/100 ('+productIdentityStatus+'); '+needs.length+' review item(s); '+unresolvedTaxFields.length+' unresolved tax field(s); '+photoConflictNeeds+' photo conflict(s).');
  setWorkflowStep('apply',mappingBlocked?'blocked':'waiting',unresolvedTaxFields.length?'Review source-verified HSN/GST in Draft before applying.':photoConflictNeeds?'Conflicting photo identity must be resolved; do not apply this draft.':productIdentityScore<70?'Product identity score is below the Master Template minimum.':'Ready after seller review of the draft.');
  if(unresolvedTaxFields.length)liveLog('TAX REVIEW REQUIRED · HSN/GST remain mandatory. Autofill stays clickable, but listing fill is paused until verified values are supplied.','warn');
  const imageNote=answer.imageBatches>1?' All '+imgs.length+' photos were analyzed in '+answer.imageBatches+' batches.':'';
  const researchNote=researchNow.results.length?' Category-based web research added.':(' Web research unavailable: '+(researchNow.error||'no results')+'.');
  setProgress(100,'Draft complete · choose a title and review unresolved fields');
  say('Draft ready using '+answer.name+'.'+imageNote+researchNote+' Review fields before autofill.',needs.length||researchNow.error?'warning':'success');
 }catch(e){const message=redactSecrets(e,null);setWorkflowStep(workflowBundle?'mapping':'authority','error',message);setWorkflowStep('apply','blocked','Workflow failed before safe application. Check the message and retry.');liveLog('PIPELINE ERROR · '+message,'error');say(message,'error');}
}
async function autofill(){
 try{
  if(!draft||!scanNow)throw new Error('Generate a draft first.');
  if(activePhotoConflicts.length){
   setWorkflowStep('apply','blocked','The uploaded photos appear to contain conflicting product/variant facts.');
   say('Autofill paused because the photo analysis detected conflicting product details: '+activePhotoConflicts.map(x=>x.field||'identity').join(', ')+'. Use photos of one exact variant, then analyze again. This prevents the wrong color or stock/variant from being applied.','warning');
   return;
  }
  const gate=await chrome.runtime.sendMessage({type:'GET_ACCESS'});
  if(!gate||!gate.allowed)throw new Error('Active membership required.');
  const tabs=await new Promise(resolve=>chrome.tabs.query({active:true,currentWindow:true},t=>resolve(t||[])));
  const tab=tabs[0];
  if(!tab||!tab.url||!tab.url.includes('supplier.meesho.com'))throw new Error('Open the selected Meesho Seller Panel tab, select the catalog, then click Autofill again.');
  setProgress(1,'Preparing a verified field-by-field fill');
  const sizes=variationNames(scanNow),selected=selectedVariationSizes();
  if(sizes.length&&!selected.length)throw new Error('Select a size variant above. Free Size is selected automatically when it is the only catalog option.');
  const payload=Object.assign({},draft);
  const fields=(scanNow.sections||[]).flatMap(section=>section.fields||[]);
  if(productIdentityScore<70){
   liveLog('IDENTITY REVIEW · score '+productIdentityScore+'/100. Exact-product external claims and unsupported tax guesses are excluded; safe mapped fields can still be filled.','warn');
  }

  // Seller-edited Draft controls have precedence over the generated map.
  document.querySelectorAll('#dynamic-sections-container [id^="f_"]').forEach(input=>{
   const identifier=input.id.slice(2),value=String(input.value||'').trim();
   if(value&&draftEditedFields.has(identifier))payload[identifier]=value;
  });
  document.querySelectorAll('#size-measure-table input[id*="__"]').forEach(input=>{
   const value=String(input.value||'').trim();if(value)payload[input.id]=value;
  });
  if(selected.length)payload._variation_sizes=selected.join(',');

  // HSN/GST stay mandatory, but an unverified AI guess must not disable every
  // other field. Keep a seller-confirmed/current Meesho value; otherwise omit
  // that tax value from this pass and report it clearly for manual resolution.
  const unresolvedTax=[];
  fields.filter(isTaxField).forEach(field=>{
   const identifier=field.identifier,value=String(payload[identifier]||'').trim(),current=captured(scanNow,identifier);
   if(!value){
    unresolvedTax.push(field.label||identifier);
    delete payload[identifier];
    return;
   }
   const hasOfficialSource=[...(researchNow.results||[]),...(researchNow.officialTaxReferences||[])]
    .some(row=>officialTaxEvidence(field,value,{url:row.url},researchNow));
   const isPlaceholder=['0','0%','--','select','not selected'].includes(norm(value));
   const explicitlyEdited=draftEditedFields.has(identifier)&&!isPlaceholder;
   const unchangedCurrent=current&&norm(current)===norm(value)&&!isPlaceholder;
   if(!hasOfficialSource&&!explicitlyEdited&&!unchangedCurrent){
    unresolvedTax.push(field.label||identifier);
    delete payload[identifier];
    liveLog('TAX SAFETY · omitted unverified '+(field.label||identifier)+' from this fill; resolve it in Draft using an official source or enter the seller-confirmed value.','warn');
   }
  });

  const missingRequired=(currentTitleFields||[]).filter(field=>field.mandatory&&!isTaxField(field)&&!String(payload[field.identifier]||'').trim());
  const measureSizes=selected.length?selected:variationNames(scanNow);
  const missingMeasurements=(currentTitleMeasurements||[]).filter(field=>field.mandatory&&measureSizes.some(size=>!String(payload[String(field.identifier)+'__'+String(size)]||'').trim()));
  if(missingRequired.length)liveLog('REQUIRED REVIEW · '+missingRequired.length+' required field(s) remain blank. Safe values will still be filled; these must be completed before catalog submission.','warn');
  if(missingMeasurements.length)liveLog('MEASUREMENT REVIEW · '+missingMeasurements.length+' per-size measurement(s) remain blank. The available verified fields will still be filled.','warn');

  const sendCount=Object.entries(payload).filter(([key,value])=>key!=='_variation_sizes'&&String(value||'').trim()).length;
  if(!sendCount&&!payload._variation_sizes)throw new Error('No usable Draft values are ready. Generate or edit the Draft, then retry Autofill.');

  setWorkflowStep('apply','running','Sending '+sendCount+' mapped values to the active Meesho tab; unverified tax guesses are excluded.');
  await set({meesho_autofill_values:payload});
  setProgress(3,'Autofill · connecting to the active Meesho tab');
  say('Applying '+sendCount+' mapped value(s)'+(selected.length?' and size '+selected.join(', '):'')+' to Meesho…');
  const result=await new Promise((resolve,reject)=>{
   chrome.tabs.sendMessage(tab.id,{type:'AUTOFILL',values:payload},response=>{
    if(chrome.runtime.lastError)return reject(new Error('Could not connect to the Meesho page. Refresh the Seller Panel tab after reloading this extension, then scan again.'));
    if(!response)return reject(new Error('Meesho did not respond to Autofill. Refresh the catalog tab and run Scan Meesho Form Fields again.'));
    resolve(response);
   });
  });
  if(result.success===false)throw new Error('Meesho rejected the autofill request: '+String(result.error||'unknown content-script error'));
  const filled=Number(result.filled||0),failed=Array.isArray(result.failed)?result.failed:[];
  const reviewCount=unresolvedTax.length+missingRequired.length+missingMeasurements.length;
  if(filled===0){
   setWorkflowStep('apply','error','No field was verified as filled. See the failure list.');
   setProgress(0,'Autofill failed · review field mapping');
   const details=failed.slice(0,6).join('; ');
   say('Autofill reached Meesho but filled 0 fields. '+(details||result.message||'No visible form controls matched the scanned field mapping.')+' Refresh the selected catalog and scan again.','error');
   return;
  }
  if(failed.length||reviewCount){
   const parts=[];
   if(failed.length)parts.push(failed.length+' field/control issue(s): '+failed.slice(0,5).join('; ')+(failed.length>5?'…':''));
   if(unresolvedTax.length)parts.push('HSN/GST needs resolution: '+unresolvedTax.join(', '));
   if(missingRequired.length)parts.push('required fields blank: '+missingRequired.slice(0,6).map(f=>f.label||f.identifier).join(', '));
   if(missingMeasurements.length)parts.push('per-size measurements blank: '+missingMeasurements.slice(0,5).map(f=>f.label||f.identifier).join(', '));
   setWorkflowStep('apply','blocked',filled+' field(s) filled; '+(failed.length+reviewCount)+' review item(s) remain.');
   setProgress(86,'Partial autofill · review highlighted fields');
   say('Partial autofill: '+filled+' field(s) were verified on Meesho. '+parts.join(' | ')+'. Review the listed fields before saving the catalog.','warning');
   return;
  }
  setWorkflowStep('apply','done',filled+' field(s) were filled and confirmed by the Meesho page. Check the visible form before saving.');
  setProgress(100,'Autofill complete · verify Meesho before saving');
  say('Autofill complete: '+filled+' field(s) were verified on Meesho. Selected size(s): '+(selected.join(', ')||'none')+'. Review the visible fields before saving/submitting.','success');
 }catch(e){
  const message=String(e&&e.message||'Autofill failed.');
  setWorkflowStep('apply','error',message);
  liveLog('AUTOFILL ERROR · '+redactSecrets(e,null),'error');
  say(message,'error');
 }
}
const AI_PAGE_META={
 listing:{label:'LISTING STUDIO',counter:'01 / 05'},
 profile:{label:'SELLER PROFILE',counter:'02 / 05'},
 api:{label:'API CONNECTIONS',counter:'03 / 05'},
 chat:{label:'AI LISTING CHAT',counter:'04 / 05'},
 activity:{label:'ACTIVITY CENTER',counter:'05 / 05'}
};
function switchAiDashboardPage(page){
 if(!AI_PAGE_META[page])page='listing';
 document.querySelectorAll('#ai-catalog-assistant [data-ai-page]').forEach(button=>{
  const active=button.getAttribute('data-ai-page')===page;
  button.classList.toggle('active',active);
  button.setAttribute('aria-current',active?'page':'false');
 });
 document.querySelectorAll('#ai-catalog-assistant [data-ai-page-panel]').forEach(panel=>{
  panel.classList.toggle('active',panel.getAttribute('data-ai-page-panel')===page);
 });
 const label=$('ai-page-overline'),counter=$('ai-page-counter');
 if(label)label.textContent=AI_PAGE_META[page].label;
 if(counter)counter.textContent=AI_PAGE_META[page].counter;
 // The legacy Meesho form lives outside the AI card; show it only in Listing Studio.
 const root=$('tab-fill');
 if(root){
  const legacyScan=root.querySelector(':scope > .scan-section');
  const step=root.querySelector(':scope > .step-label');
  const fields=$('dynamic-sections-container'),footer=$('fill-footer');
  [legacyScan,step,fields,footer].forEach(node=>{if(node)node.style.display=page==='listing'?'':'none';});
 }
 liveLog('WORKSPACE NAVIGATION · '+AI_PAGE_META[page].label+' opened.','info');
}

function init(){
 if(!$('ai-catalog-assistant'))return;
 document.querySelectorAll('#ai-catalog-assistant [data-ai-page]').forEach(button=>{
  button.addEventListener('click',()=>switchAiDashboardPage(button.getAttribute('data-ai-page')));
 });
 switchAiDashboardPage('listing');
 $('ai-scan-current-btn').addEventListener('click',async()=>{try{setProgress(2,'Scanning Meesho fields');say('Scanning current catalog form…');await scanCurrentCatalog(true);setProgress(12,'Catalog scan complete');}catch(e){say(e.message||'Scan failed.','error');}});
 $('ai-provider-type').addEventListener('change',()=>{updateProviderForm();syncProviderCards();});
 document.querySelectorAll('#ai-provider-cards [data-api-provider]').forEach(card=>{
  card.addEventListener('click',()=>chooseApiProvider(card.getAttribute('data-api-provider')));
 });
 $('ai-add-key-btn').addEventListener('click',addKey);
  $('ai-test-api-btn')?.addEventListener('click',testApiConnection);
 $('ai-add-bulk-keys-btn').addEventListener('click',addBulkKeys);
 $('ai-save-defaults-btn').addEventListener('click',saveDefaults);
 $('ai-profile-select').addEventListener('change',async()=>{try{await loadSelectedProfile();}catch(e){say(e.message||'Could not load seller profile.','error');}});
 $('ai-profile-new').addEventListener('click',async()=>{try{await createProfile();}catch(e){say(e.message||'Could not create profile.','error');}});
 $('ai-profile-save').addEventListener('click',async()=>{try{await saveProfile();}catch(e){say(e.message||'Could not save profile.','error');}});
 $('ai-profile-delete').addEventListener('click',async()=>{try{await deleteProfile();}catch(e){say(e.message||'Could not delete profile.','error');}});
 $('ai-profile-category').addEventListener('change',loadCategoryOverride);
 $('ai-profile-save-override').addEventListener('click',async()=>{try{await saveCategoryOverride();}catch(e){say(e.message||'Could not save category override.','error');}});
 $('ai-generate-btn').addEventListener('click',async()=>{
  const btn=$('ai-generate-btn');btn.disabled=true;
  try{
   setProgress(1,'Starting listing workflow');
   const googleAllowed=await requestGoogleSearchPermission();
   await generate(googleAllowed);
  }catch(e){say(e.message||'Catalog research failed.','error');}
  finally{btn.disabled=false;}
 });
 $('ai-autofill-btn').addEventListener('click',autofill);
 $('ai-product-price').addEventListener('input',updatePricePreview);
 $('ai-product-images').addEventListener('change',()=>{
  const host=$('ai-image-list');host.replaceChildren();const files=Array.from($('ai-product-images').files||[]);
  files.forEach((f,i)=>host.appendChild(el('span','ai-image-chip',(i+1)+'. '+f.name)));
  say(files.length?files.length+' photo(s) selected for one product. Limit: 10.':'');
 });
 $('ai-chat-send').addEventListener('click',()=>sendChatMessage());
 $('ai-chat-input').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendChatMessage();}
 });
 chrome.runtime.onMessage.addListener(message=>{
  if(message&&message.type==='AUTOFILL_PROGRESS'){
   const n=Number(message.percent);
   setProgress(Number.isFinite(n)?Math.max(0,Math.min(99,n)):0,'Autofill · '+String(message.label||'Filling Meesho fields'));
   liveLog('AUTOFILL · '+String(message.label||'Processing fields'),'info');
  }
 });
 window.addEventListener('seller-profile-saved',()=>loadDefaults().then(()=>liveLog('SELLER PROFILE · saved profile loaded into the workspace.','ok')).catch(e=>say(e.message||'Could not refresh seller profile.','error')));
 updatePricePreview();loadDefaults().catch(e=>say(e.message||'Could not load seller profile.','error'));renderKeys();updateProviderForm();syncProviderCards();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();