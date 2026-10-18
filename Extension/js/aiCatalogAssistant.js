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
 return await new Promise(resolve=>chrome.permissions.contains({origins:[pattern]},ok=>{if(ok)return resolve(true);chrome.permissions.request({origins:[pattern]},resolve);}));
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
 if(!garment&&p.productWeight&&/weight/.test(x)&&!/(package|packaging|shipping|gross)/.test(x))return p.productWeight;
 if(!garment&&p.productLength&&/length/.test(x)&&!/(sleeve|kurta|garment|bottom|bust)/.test(x))return p.productLength;
 if(!garment&&p.productWidth&&/width/.test(x))return p.productWidth;if(!garment&&p.productHeight&&/height/.test(x))return p.productHeight;
 if(p.productFacts&&/(product details|additional details|product description|product information)/.test(x))return p.productFacts;
 return '';
}
function captured(scan,id){const v=(scan.capturedValues||{})[id];return v===undefined||v===null?'':String(v).trim();}
function promptFor(scan,p,d,s,imgs){
 const data={platform:'Meesho supplier catalog listing form',productInputs:p,sellerDefaults:d,scannedFields:s.fields.map(f=>({identifier:f.identifier,label:f.label,section:f.section,mandatory:f.mandatory,inputType:f.inputType,allowedValues:f.values})),currentFormValues:scan.capturedValues||{},uploadedImageNames:imgs.map(i=>i.name)};
 return ['You are an e-commerce product-listing assistant. Analyze the supplied product photos and scanned form schema.','Return ONLY valid JSON: {"values":{"existing_field_identifier":"string value"},"needsConfirmation":[{"identifier":"existing_field_identifier","reason":"short reason"}]}. No markdown.','Use only identifiers listed in scannedFields; never create new keys. Generate an accurate searchable title and description if these fields exist.','Never invent material, capacity, certification, compatibility, water resistance, dimensions, product weight, country of origin, brand, manufacturer, packer, HSN, GST or legal claims.','Use sellerDefaults only when the field label clearly matches. Do not substitute seller address for manufacturer or packer address.','For dropdowns choose an exact allowedValues option only; otherwise omit and request confirmation.','Do not modify existing non-empty currentFormValues. Unknown mandatory fields stay blank and need confirmation. Never estimate garment measurements or packaging weight from an image.','Schema and user data:',JSON.stringify(data)].join('\n');
}
function decodeImage(dataUrl){const m=String(dataUrl||'').match(/^data:([^;]+);base64,(.*)$/);if(!m)throw new Error('Could not decode photo.');return {mimeType:m[1],data:m[2]};}

// test?marker
