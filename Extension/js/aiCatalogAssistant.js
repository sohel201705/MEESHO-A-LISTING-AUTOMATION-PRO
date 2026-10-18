(function(){
'use strict';
const KEY='ai_provider_keys_v1', DEFAULTS='ai_seller_defaults_v1', ROT='ai_provider_rotation_v1';
let draft=null, pending=[], scanNow=null;
const $=id=>document.getElementById(id);
const get=k=>new Promise(r=>chrome.storage.local.get(k,r));
const set=o=>new Promise(r=>chrome.storage.local.set(o,r));
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const norm=v=>String(v||'').replace(/[＊*]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function say(m,t){if(!$('ai-status'))return;$('ai-status').textContent=m||'';$('ai-status').className='ai-status '+(t||'');}
function label(p){return p==='gemini'?'Google Gemini':p==='groq'?'Groq Cloud':'OpenAI-compatible API';}
function modelDefault(p){return p==='gemini'?'gemini-2.5-flash':p==='groq'?'qwen/qwen3.8-27b':'';}
function endpointDefault(p){return p==='compatible'?'https://api.x.ai/v1/chat/completions':'';}
async function keys(){const r=await get(KEY);return Array.isArray(r[KEY])?r[KEY]:[];}
async function persistKeys(v){await set({[KEY]:v});await renderKeys();}
async function renderKeys(){
 const host=$('ai-provider-key-list');if(!host)return;host.replaceChildren();const all=await keys();
 if(!all.length){host.appendChild(el('div','ai-empty','No API keys added. Add one or more keys below.'));return;}
 all.forEach(k=>{
  const row=el('div','ai-key-row'),meta=el('div','ai-key-meta'),controls=el('div','ai-key-controls');
  meta.appendChild(el('strong','',k.name||label(k.provider)));
  meta.appendChild(el('span','ai-muted',label(k.provider)+' · '+k.model));
  if(k.endpoint)meta.appendChild(el('span','ai-muted',k.endpoint));
  meta.appendChild(el('span','ai-muted','Saved key: ••••'+String(k.apiKey||'').slice(-4)));
  const lab=el('label','ai-toggle-label'),enabled=el('input');enabled.type='checkbox';enabled.checked=k.enabled!==false;enabled.setAttribute('aria-label','Enable '+(k.name||label(k.provider)));lab.appendChild(enabled);lab.appendChild(document.createTextNode(' Enabled'));controls.appendChild(lab);
  enabled.addEventListener('change',async()=>{const a=await keys();await persistKeys(a.map(x=>x.id===k.id?Object.assign({},x,{enabled:enabled.checked}):x));});
  const del=el('button','ai-small-btn ai-danger','Remove');del.type='button';del.addEventListener('click',async()=>{await persistKeys((await keys()).filter(x=>x.id!==k.id));say('API key removed.','success');});
  controls.appendChild(del);row.appendChild(meta);row.appendChild(controls);host.appendChild(row);
 });
}
function updateProviderForm(){
 const p=$('ai-provider-type').value,m=$('ai-key-model'),ep=$('ai-key-endpoint');
 if(!m.value.trim()||m.dataset.provider!==p)m.value=modelDefault(p);m.dataset.provider=p;
 $('ai-key-endpoint-wrap').style.display=p==='compatible'?'block':'none';
 if(p==='compatible'&&(!ep.value.trim()||ep.dataset.provider!==p))ep.value=endpointDefault(p);ep.dataset.provider=p;
 $('ai-provider-hint').textContent=p==='gemini'?'Gemini generateContent API.':p==='groq'?'Use a current Groq vision-capable model.':'Use an HTTPS OpenAI-compatible Chat Completions endpoint, e.g. xAI Grok.';
}
async function askPermission(endpoint){
 let pattern;try{const u=new URL(endpoint);if(u.protocol!=='https:')throw new Error('API endpoint must use HTTPS.');pattern=u.origin+'/*';}catch(e){throw new Error(e.message||'Enter a valid HTTPS endpoint.');}
 return await new Promise(resolve=>chrome.permissions.request({origins:[pattern]},resolve));
}
async function addKey(){
 const p=$('ai-provider-type').value,apiKey=$('ai-key-value').value.trim(),model=$('ai-key-model').value.trim()||modelDefault(p),endpoint=p==='compatible' ? $('ai-key-endpoint').value.trim() : '';
 if(!apiKey)return say('Enter an API key first.','error');if(!model)return say('Enter the model ID.','error');
 if(p==='compatible'){let ok=false;try{ok=await askPermission(endpoint);}catch(e){return say(e.message,'error');}if(!ok)return say('API-host permission denied; key was not saved.','error');}
 const item={id:'key_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),provider:p,name:$('ai-key-name').value.trim()||label(p)+' key',model,endpoint,apiKey,enabled:true};
 const all=await keys();all.push(item);await persistKeys(all);$('ai-key-value').value='';$('ai-key-name').value='';say('API key added. Multiple providers and keys are supported.','success');
}
async function loadDefaults(){
 const r=await get(DEFAULTS),d=r[DEFAULTS]||{},map={'ai-default-brand':'brand','ai-default-seller-name':'sellerName','ai-default-seller-address':'sellerAddress','ai-default-manufacturer-name':'manufacturerName','ai-default-manufacturer-address':'manufacturerAddress','ai-default-packer-name':'packerName','ai-default-packer-address':'packerAddress','ai-default-country':'countryOfOrigin','ai-default-support-phone':'supportPhone','ai-default-support-email':'supportEmail','ai-default-hsn':'hsn','ai-default-gst':'gst'};
 Object.keys(map).forEach(id=>{if($(id))$(id).value=d[map[id]]||'';});
}
async function saveDefaults(){
 const d={brand:$('ai-default-brand').value.trim(),sellerName:$('ai-default-seller-name').value.trim(),sellerAddress:$('ai-default-seller-address').value.trim(),manufacturerName:$('ai-default-manufacturer-name').value.trim(),manufacturerAddress:$('ai-default-manufacturer-address').value.trim(),packerName:$('ai-default-packer-name').value.trim(),packerAddress:$('ai-default-packer-address').value.trim(),countryOfOrigin:$('ai-default-country').value.trim(),supportPhone:$('ai-default-support-phone').value.trim(),supportEmail:$('ai-default-support-email').value.trim(),hsn:$('ai-default-hsn').value.trim(),gst:$('ai-default-gst').value.trim()};
 await set({[DEFAULTS]:d});say('Seller defaults saved in this Chrome profile.','success');
}

const readImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,mimeType:file.type||'image/jpeg',dataUrl:String(reader.result||'')});reader.onerror=()=>reject(new Error('Could not read image: '+file.name));reader.readAsDataURL(file);});
async function images(){
 const files=Array.from($('ai-product-images').files||[]);if(!files.length)throw new Error('Upload at least one product photo.');if(files.length>5)throw new Error('Upload no more than 5 photos.');
 for(const f of files){if(!['image/jpeg','image/png','image/webp','image/gif'].includes(f.type))throw new Error('Use JPG, PNG, WEBP or GIF: '+f.name);if(f.size>8*1024*1024)throw new Error(f.name+' is over 8 MB.');}
 const all=await Promise.all(files.map(readImage));const host=$('ai-image-list');host.replaceChildren();all.forEach(i=>host.appendChild(el('span','ai-image-chip',i.name)));return all;
}
function schema(scan){
 const fields=[],measurements=[];
 (scan.sections||[]).forEach(s=>(s.fields||[]).forEach(f=>{const a={identifier:f.identifier||f.id,label:f.label||f.identifier||f.id,mandatory:!!f.mandatory,inputType:f.inputType||'text',values:Array.isArray(f.values)?f.values:[],section:s.label||s.id||''};if(!a.identifier)return;(s.id==='product_size_data'?measurements:fields).push(a);}));
 return {fields,measurements};
}
function updateScanSummary(scan){
 const host=$('ai-scan-summary');if(!host)return;
 const fields=[];(scan.sections||[]).forEach(s=>(s.fields||[]).forEach(f=>fields.push(f)));
 const values=scan.capturedValues||{};
 const blank=fields.filter(f=>!String(values[f.identifier||f.id]||'').trim()).length;
 const required=fields.filter(f=>f.mandatory&&!String(values[f.identifier||f.id]||'').trim()).length;
 const sizes=(scan.sections||[]).find(s=>s.id==='variations');
 host.textContent='Scanned '+fields.length+' fields · '+blank+' blank · '+required+' mandatory blank'+(sizes&&sizes.data&&sizes.data.length?' · '+sizes.data.length+' size options':'')+'.';
}
async function scanCurrentCatalog(showMessage){
 const access=await chrome.runtime.sendMessage({type:'GET_ACCESS'});if(!access||!access.allowed)throw new Error('Active membership required.');
 const tabs=await new Promise(r=>chrome.tabs.query({active:true,currentWindow:true},t=>r(t||[]))),tab=tabs[0];
 if(!tab||!tab.url||!tab.url.includes('supplier.meesho.com'))throw new Error('Open Meesho Seller Panel and select the catalog first.');
 const scan=await new Promise((resolve,reject)=>chrome.tabs.sendMessage(tab.id,{type:'SCAN_FORM'},r=>{if(chrome.runtime.lastError)return reject(new Error('Could not scan the Meesho page. Refresh the page and retry.'));if(!r||r.error||!Array.isArray(r.sections))return reject(new Error((r&&r.error)||'No form schema detected. Select a catalog first.'));resolve(r);}));
 await set({last_scan_result:scan});scanNow=scan;updateScanSummary(scan);
 if(typeof renderStructuredForm==='function')renderStructuredForm(scan);
 if(showMessage)say('Catalog form scanned. Check blank and mandatory field counts above.','success');
 return scan;
}
function convertUnit(value,label,source){
 const n=Number(value);if(!Number.isFinite(n))return String(value);
 const s=norm(label);let v=n;
 if(source==='g'){if(/\bkg\b|kilogram/.test(s))v=n/1000;else if(/\bmg\b|milligram/.test(s))v=n*1000;}
 if(source==='cm'){if(/\bmm\b|millimeter|millimetre/.test(s))v=n*10;else if(/\bin\b|inch|inches/.test(s))v=n/2.54;else if(/\b(m|meter|metre)\b/.test(s))v=n/100;}
 return String(Number(v.toFixed(4)));
}
function preset(f,p,d){
 const x=norm(f.label+' '+f.identifier.replace(/_/g,' ')),garment=/(kurta|bust|shoulder|hip|waist|sleeve|inseam|garment|chest|dress size|size chart)/i.test(x);
 if(/brand( name)?/.test(x)&&d.brand)return d.brand;
 if(/(seller name|seller legal name|merchant name|seller company)/.test(x)&&d.sellerName)return d.sellerName;
 if(/(seller address|seller registered address|merchant address)/.test(x)&&d.sellerAddress)return d.sellerAddress;
 if(/(manufacturer name|manufactured by|manufacturer)/.test(x)&&!/address/.test(x)&&d.manufacturerName)return d.manufacturerName;
 if(/(manufacturer address|manufacturing address)/.test(x)&&d.manufacturerAddress)return d.manufacturerAddress;
 if(/(packer name|packed by|packer)/.test(x)&&!/address/.test(x)&&d.packerName)return d.packerName;
 if(/(packer address|packing address)/.test(x)&&d.packerAddress)return d.packerAddress;
 if(/(country of origin|origin country|made in)/.test(x)&&d.countryOfOrigin)return d.countryOfOrigin;
 if(/(customer care phone|support phone|customer care number|contact phone)/.test(x)&&d.supportPhone)return d.supportPhone;
 if(/(customer care email|support email|contact email)/.test(x)&&d.supportEmail)return d.supportEmail;
 if(/\bhsn\b|hsn code/i.test(x)&&d.hsn)return d.hsn;if(/\bgst\b|gst rate|gst percentage/i.test(x)&&d.gst)return d.gst;
 if(p.sellingPrice&&/(selling price|transfer price|price|mrp)/.test(x))return p.sellingPrice;
 if(p.material&&/(material|fabric type|material type)/.test(x))return p.material;if(p.color&&/(colour|color)/.test(x))return p.color;
 if(!garment&&p.productWeight&&/weight/.test(x)&&!/(package|packaging|shipping|gross)/.test(x))return convertUnit(p.productWeight,x,'g');
 if(!garment&&p.productLength&&/length/.test(x)&&!/(sleeve|kurta|garment|bottom|bust)/.test(x))return convertUnit(p.productLength,x,'cm');
 if(!garment&&p.productWidth&&/width/.test(x))return convertUnit(p.productWidth,x,'cm');if(!garment&&p.productHeight&&/height/.test(x))return convertUnit(p.productHeight,x,'cm');
 if(p.productFacts&&/(product details|additional details|product description|product information)/.test(x))return p.productFacts;
 return '';
}
function captured(scan,id){const v=(scan.capturedValues||{})[id];return v===undefined||v===null?'':String(v).trim();}
function promptFor(scan,p,d,s,imgs){
 const data={platform:'Meesho supplier catalog listing form',productInputs:p,sellerDefaults:d,scannedFields:s.fields.map(f=>({identifier:f.identifier,label:f.label,section:f.section,mandatory:f.mandatory,inputType:f.inputType,allowedValues:f.values})),currentFormValues:scan.capturedValues||{},uploadedImageNames:imgs.map(i=>i.name)};
 return ['You are an e-commerce product-listing assistant. Analyze the supplied product photos and scanned form schema.','Return ONLY valid JSON: {"values":{"existing_field_identifier":"string value"},"needsConfirmation":[{"identifier":"existing_field_identifier","reason":"short reason"}]}. No markdown.','Use only identifiers listed in scannedFields; never create new keys. Generate an accurate searchable title and description if these fields exist.','Never invent material, capacity, certification, compatibility, water resistance, dimensions, product weight, country of origin, brand, manufacturer, packer, HSN, GST or legal claims.','Use sellerDefaults only when the field label clearly matches. Do not substitute seller address for manufacturer or packer address.','For dropdowns choose an exact allowedValues option only; otherwise omit and request confirmation.','Do not modify existing non-empty currentFormValues. Unknown mandatory fields stay blank and need confirmation. Never estimate garment measurements or packaging weight from an image.','Schema and user data:',JSON.stringify(data)].join('\n');
}
function decodeImage(dataUrl){const m=String(dataUrl||'').match(/^data:([^;]+);base64,(.*)$/);if(!m)throw new Error('Could not decode photo.');return {mimeType:m[1],data:m[2]};}


async function post(url,opts){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),45000);
 try{return await fetch(url,Object.assign({},opts,{signal:c.signal}));}finally{clearTimeout(timer);}
}
async function gemini(k,prompt,imgs){
 const parts=[{text:prompt}];imgs.forEach(i=>{const x=decodeImage(i.dataUrl);parts.push({inline_data:{mime_type:x.mimeType,data:x.data}});});
 const r=await post('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(k.model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':k.apiKey},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',temperature:0.2}})});
 const raw=await r.text();let data={};try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok)throw new Error('Gemini '+r.status+': '+((data.error||{}).message||raw.slice(0,180)));
 const out=((((data.candidates||[])[0]||{}).content||{}).parts||[]).map(x=>x.text||'').join('\n').trim();if(!out)throw new Error('Gemini returned empty response.');return out;
}

async function compatible(k,prompt,imgs){
 const parts=[{type:'text',text:prompt}];imgs.forEach(i=>parts.push({type:'image_url',image_url:{url:i.dataUrl}}));
 let url=String(k.endpoint||(k.provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'')).trim();if(!/\/chat\/completions\/?$/i.test(url))url=url.replace(/\/$/,'')+'/chat/completions';
 const r=await post(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+k.apiKey},body:JSON.stringify({model:k.model,messages:[{role:'user',content:parts}],temperature:0.2,max_tokens:3500,response_format:{type:'json_object'}})});
 const raw=await r.text();let data={};try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok)throw new Error((k.provider==='groq'?'Groq ':'Provider ')+r.status+': '+((data.error||{}).message||raw.slice(0,180)));
 const message=((((data.choices||[])[0]||{}).message||{}).content);
 const out=Array.isArray(message)?message.map(x=>x.text||'').join('\n').trim():String(message||'').trim();if(!out)throw new Error('Provider returned empty response.');return out;
}

async function callAI(prompt,imgs){
 const list=(await keys()).filter(k=>k.enabled!==false&&k.apiKey&&k.model);if(!list.length)throw new Error('Add and enable at least one API key in Settings.');
 const old=await get(ROT),start=Number(old[ROT]||0)%list.length,order=list.slice(start).concat(list.slice(0,start)),errors=[];
 for(let i=0;i<order.length;i++){
  const k=order[i];say('Trying '+label(k.provider)+' ('+(i+1)+'/'+order.length+')…');
  try{const text=k.provider==='gemini'?await gemini(k,prompt,imgs):await compatible(k,prompt,imgs);await set({[ROT]:(start+i+1)%list.length});return {text,name:k.name||label(k.provider)};}
  catch(e){errors.push(label(k.provider)+' '+(k.name||'key')+': '+String(e.message||e).slice(0,130));}
 }
 throw new Error('All enabled API keys failed. '+errors.join(' | '));
}
function parseJson(text){
 let s=String(text||'').trim(),f=String.fromCharCode(96);
 s=s.replace(new RegExp('^'+f+f+f+'(?:json)?\\\\s*','i'),'').replace(new RegExp('\\\\s*'+f+f+f+'$'),'');
 try{return JSON.parse(s);}catch(e){}
 const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch(e){}}
 throw new Error('AI response was not valid JSON. Try another model or API key.');
}
function allowed(value,field){return !field.values.length||field.values.some(o=>norm(o)===norm(value));}

function showPreview(fields,values,needs,stats){
 const root=$('ai-preview');root.replaceChildren();root.style.display='block';
 root.appendChild(el('div','ai-preview-title','AI Draft Preview'));
 root.appendChild(el('div','ai-muted','AI values: '+stats.ai+' · Defaults: '+stats.preset+' · Dropdown mismatches: '+stats.bad+' · Needs confirmation: '+needs.length));
 const list=el('div','ai-preview-list');
 fields.forEach(f=>{const v=values[f.identifier],row=el('div','ai-preview-item');row.appendChild(el('span','ai-preview-label',f.label+(f.mandatory?' *':'')));row.appendChild(el('span','ai-preview-value'+(v?'':' ai-blank'),v?String(v):'Not filled'));list.appendChild(row);});
 root.appendChild(list);
 if(needs.length){const box=el('div','ai-needs-box');box.appendChild(el('strong','','Needs confirmation — '+needs.length));const ul=el('ul'),seen=new Set();needs.forEach(n=>{if(!n||!n.identifier)return;const k=n.identifier+'|'+(n.reason||'');if(seen.has(k))return;seen.add(k);ul.appendChild(el('li','',n.identifier+': '+(n.reason||'Check manually.')));});box.appendChild(ul);root.appendChild(box);}
 root.appendChild(el('p','ai-muted','Review the draft. Unverified legal details and product measurements remain blank.'));
}
async function generate(){
 try{
  const scan=await scanCurrentCatalog(false);const s=schema(scan);if(!s.fields.length)throw new Error('No form fields found. Scan the selected catalog first.');
  const p={productName:$('ai-product-name').value.trim(),material:$('ai-product-material').value.trim(),color:$('ai-product-color').value.trim(),productWeight:$('ai-product-weight').value.trim(),productLength:$('ai-product-length').value.trim(),productWidth:$('ai-product-width').value.trim(),productHeight:$('ai-product-height').value.trim(),sellingPrice:$('ai-product-price').value.trim(),productFacts:$('ai-product-facts').value.trim()};
  const dres=await get(DEFAULTS),d=dres[DEFAULTS]||{},imgs=await images(),answer=await callAI(promptFor(scan,p,d,s,imgs)),parsed=parseJson(answer.text),proposed=parsed&&parsed.values&&typeof parsed.values==='object'?parsed.values:{};
  const values=Object.assign({},scan.capturedValues||{}),needs=Array.isArray(parsed.needsConfirmation)?parsed.needsConfirmation.slice(0,80):[];
  let ai=0,presetCount=0,bad=0;
  s.fields.forEach(f=>{
   const old=captured(scan,f.identifier);if(old){values[f.identifier]=old;return;}
   const fixed=preset(f,p,d);
   if(fixed){if(allowed(fixed,f)){values[f.identifier]=String(fixed);presetCount++;}else{needs.push({identifier:f.identifier,reason:'Saved/user-entered value does not exactly match the allowed dropdown options.'});bad++;}return;}
   const v=proposed[f.identifier];if(v!==undefined&&v!==null&&String(v).trim()){if(!allowed(String(v),f)){needs.push({identifier:f.identifier,reason:'AI value is not an exact permitted dropdown option.'});bad++;return;}values[f.identifier]=String(v).trim();ai++;}
  });
  s.measurements.forEach(f=>{if(f.mandatory)needs.push({identifier:f.identifier,reason:'Actual per-size measurement is required; do not estimate from a photo.'});});
  s.fields.forEach(f=>{if(f.mandatory&&!String(values[f.identifier]||'').trim()&&!needs.some(n=>n&&n.identifier===f.identifier))needs.push({identifier:f.identifier,reason:'Required field is blank because its value is not verified.'});});
  draft=values;pending=needs;showPreview(s.fields,values,needs,{ai:ai,preset:presetCount,bad:bad});
  $('ai-autofill-btn').disabled=!Object.values(values).some(v=>String(v||'').trim());
  say('Draft ready using '+answer.name+'. Review it before autofill.',needs.length?'warning':'success');
 }catch(e){say(e.message||'AI generation failed.','error');}
}
async function autofill(){
 try{
  if(!draft||!scanNow)throw new Error('Generate a draft first.');
  const gate=await chrome.runtime.sendMessage({type:'GET_ACCESS'});if(!gate||!gate.allowed)throw new Error('Active membership required.');
  const tabs=await new Promise(r=>chrome.tabs.query({active:true,currentWindow:true},t=>r(t||[]))),tab=tabs[0];
  if(!tab||!tab.url||!tab.url.includes('supplier.meesho.com'))throw new Error('Open the selected Meesho catalog tab again.');
  if(pending.length&&!confirm('Some fields need confirmation. Continue autofill and leave unknown fields untouched?'))return;
  await set({meesho_autofill_values:draft});
  const result=await new Promise((resolve,reject)=>chrome.tabs.sendMessage(tab.id,{type:'AUTOFILL',values:draft},r=>{if(chrome.runtime.lastError)return reject(new Error('Could not connect to Meesho. Refresh the page and retry.'));if(!r||r.success===false)return reject(new Error((r&&(r.message||r.error))||'Autofill failed.'));resolve(r);}));
  say('Autofill completed: '+Number(result.filled||0)+' field(s). Review Meesho before saving/submitting.','success');
 }catch(e){say(e.message||'Autofill failed.','error');}
}
function init(){
 if(!$('ai-catalog-assistant'))return;
 $('ai-scan-current-btn').addEventListener('click',async()=>{try{say('Scanning current catalog form…');await scanCurrentCatalog(true);}catch(e){say(e.message||'Scan failed.','error');}});
 $('ai-provider-type').addEventListener('change',updateProviderForm);
 $('ai-add-key-btn').addEventListener('click',addKey);
 $('ai-save-defaults-btn').addEventListener('click',saveDefaults);
 $('ai-generate-btn').addEventListener('click',generate);
 $('ai-autofill-btn').addEventListener('click',autofill);
 $('ai-product-images').addEventListener('change',()=>{
  const host=$('ai-image-list');host.replaceChildren();const files=Array.from($('ai-product-images').files||[]);
  files.forEach(f=>host.appendChild(el('span','ai-image-chip',f.name)));say(files.length?files.length+' photo(s) selected.':'');
 });
 loadDefaults();renderKeys();updateProviderForm();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();