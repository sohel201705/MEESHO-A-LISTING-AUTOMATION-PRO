
(function () {
  if (window.__meeshoAutofillLoaded) return;
  window.__meeshoAutofillLoaded = true;

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }

  setInterval(() => {
    if (!isContextValid()) location.reload();
  }, 2000);

  let __capturedProductFields = null;
  let __capturedCatalogContext = {};
  let __fieldSourceMap = {};
  let __fieldSectionMap = {};
  let __labelCache = new Map();
  let __apiAllowedValues = {};
  window.addEventListener('__mfpd', e => { __capturedProductFields = e.detail; });
  // The main-world interceptor already observes the catalog/draft APIs. Capture
  // the selected catalog IDs/context from its event instead of asking the user.
  window.addEventListener('mls:catalog-image', e => {
    const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : {};
    const next = Object.assign({}, __capturedCatalogContext);
    ['sscatId','catalogId','categoryId','categoryName','subCategoryName','catalogType'].forEach(key => {
      const value = detail[key];
      if (value !== undefined && value !== null && String(value).trim()) next[key] = String(value).slice(0, 500);
    });
    __capturedCatalogContext = next;
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function norm(text) {
    return (text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function setReactInputValue(input, value) {
    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function realClick(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function callReactOnClick(startEl) {
    const HANDLER_KEYS = ['onClick', 'onMouseDown', 'onPointerDown'];

    function makeSyntheticEvent(domNode) {
      return {
        preventDefault: () => { },
        stopPropagation: () => { },
        isPropagationStopped: () => false,
        isDefaultPrevented: () => false,
        persist: () => { },
        target: startEl,
        currentTarget: domNode,
        type: 'click',
        bubbles: true,
        cancelable: true,
        nativeEvent: { isTrusted: true, target: startEl, type: 'click' },
        timeStamp: Date.now(),
      };
    }

    let domNode = startEl;
    for (let domDepth = 0; domDepth < 8; domDepth++) {
      if (!domNode || domNode === document.body) break;

      const fiberKey = Object.keys(domNode).find(
        k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );

      if (fiberKey) {
        let fiber = domNode[fiberKey];
        for (let fiberDepth = 0; fiberDepth < 20; fiberDepth++) {
          if (!fiber) break;
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props) {
            for (const handlerKey of HANDLER_KEYS) {
              if (typeof props[handlerKey] === 'function') {
                try {
                  props[handlerKey](makeSyntheticEvent(domNode));
                  return true;
                } catch (e) {}
              }
            }
          }
          const nextFiber = fiber.return;
          if (nextFiber && nextFiber.stateNode instanceof HTMLElement &&
            nextFiber.stateNode !== domNode) {
            break;
          }
          fiber = nextFiber;
        }
      }
      domNode = domNode.parentElement;
    }
    return false;
  }

  async function closeOpenDropdown() {
    const portal = document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root, [role="listbox"], [role="menu"]');
    if (!portal) return;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    for (let i = 0; i < 10; i++) {
      if (!document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root, [role="listbox"], [role="menu"]')) break;
      await sleep(10);
    }
  }

  function findVisibleSizeMenu() {
    const selectors = '[role="listbox"], ul[role="menu"], [role="menu"], .MuiPopover-root, .MuiModal-root, .MuiDialog-root';
    const candidates = Array.from(document.querySelectorAll(selectors)).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    candidates.sort((a,b) => {
      const count = el => el.querySelectorAll('li, p, [role="option"], [role="menuitem"], button').length;
      return count(b)-count(a);
    });
    return candidates[0] || null;
  }

  function clickSizeRow(row) {
    if (!row || !row.isConnected) return 'none';
    // If the option has a real checkbox, click that control exactly once.
    // This avoids double-toggling a controlled checkbox through both React and mouse events.
    const checkbox = row.matches && row.matches('input[type="checkbox"]')
      ? row : row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      if (!checkbox.checked) checkbox.click();
      return checkbox.checked ? 'checkbox-selected' : 'checkbox-failed';
    }
    const svg = row.querySelector('svg');
    const target = svg || row;
    if (callReactOnClick(target)) return svg ? 'react-svg' : 'react-row';
    realClick(target);
    return svg ? 'native-svg' : 'native-row';
  }

  function elementIsVisible(el) {
    if(!el||!el.isConnected)return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  }

  function findVisibleSizeOption(target) {
    const wanted=norm(target);
    if(!wanted)return null;
    const selectors='input[type="checkbox"], [role="checkbox"], label, li, [role="option"], [role="menuitem"], button, p, span, div, [data-value]';
    // Search the currently open Meesho dropdown first so a matching label elsewhere
    // on the page is never mistaken for the real selectable option.
    const openMenu=findVisibleSizeMenu();
    const searchRoot=openMenu||document;
    const elements=Array.from(searchRoot.querySelectorAll(selectors)).filter(elementIsVisible);
    // Prefer a real checkbox whose nearby row says exactly "Free Size".
    const checkboxes=elements.filter(el=>el.matches('input[type="checkbox"],[role="checkbox"]'));
    const checkboxRows=[];
    checkboxes.forEach(box=>{
      let parent=box;
      for(let depth=0;depth<7&&parent;depth++,parent=parent.parentElement){
        if(!elementIsVisible(parent))continue;
        const txt=norm(parent.textContent);
        if(txt===wanted||((txt.startsWith(wanted+' ')||txt.startsWith(wanted+'\\n'))&&txt.length<=wanted.length+24)){
          checkboxRows.push({box,row:parent,exact:txt===wanted,area:parent.getBoundingClientRect().width*parent.getBoundingClientRect().height,textLength:txt.length});
          break;
        }
      }
    });
    checkboxRows.sort((a,b)=>(Number(b.exact)-Number(a.exact))||a.textLength-b.textLength||a.area-b.area);
    if(checkboxRows.length)return {row:checkboxRows[0].row,checkbox:checkboxRows[0].box};
    // Some Meesho versions render checkbox controls without a useful label ancestor.
    const exact=elements.filter(el=>{
      if(el.matches('input[type="checkbox"]'))return false;
      const txt=norm(el.textContent);
      return txt===wanted||norm(el.getAttribute('data-value')||'')===wanted;
    }).sort((a,b)=>{
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      const childCount=a.querySelectorAll('*').length-b.querySelectorAll('*').length;
      if(childCount)return childCount;
      return ar.width*ar.height-br.width*br.height;
    });
    for(const item of exact){
      let parent=item;
      for(let depth=0;depth<5&&parent;depth++,parent=parent.parentElement){
        const box=parent.matches&&parent.matches('input[type="checkbox"]')?parent:parent.querySelector&&parent.querySelector('input[type="checkbox"],[role="checkbox"]');
        if(box&&elementIsVisible(box))return {row:parent,checkbox:box};
        if(parent.matches&&parent.matches('[role="option"],[role="menuitem"],label,li,button'))break;
      }
      return {row:item,checkbox:null};
    }
    // Last-resort contains match is allowed only if the text is a close match, never a random first option.
    const contains=elements.filter(el=>{
      if(el.querySelectorAll('*').length>4)return false;
      const t=norm(el.textContent);
      return t===wanted||t.startsWith(wanted+' ');
    }).sort((a,b)=>a.textContent.length-b.textContent.length);
    return contains.length?{row:contains[0],checkbox:null}:null;
  }

  function waitForSizeOption(target,timeoutMs=950) {
    return new Promise(resolve=>{
      const began=Date.now();
      const tick=()=>{
        const found=findVisibleSizeOption(target);
        if(found){resolve(found);return;}
        if(Date.now()-began>=timeoutMs){resolve(null);return;}
        setTimeout(tick,25);
      };
      tick();
    });
  }

  function findSizeApplyButton(optionRow) {
    const visibleApply=()=>Array.from(document.querySelectorAll('button,[role="button"]')).filter(elementIsVisible)
      .filter(btn=>/^apply$/i.test(norm(btn.textContent)));
    let parent=optionRow;
    for(let depth=0;depth<8&&parent;depth++,parent=parent.parentElement){
      if(parent.querySelectorAll&&parent.querySelectorAll('input[type="checkbox"]').length){
        const local=visibleApply().find(btn=>parent.contains(btn));
        if(local)return local;
      }
    }
    return visibleApply()[0]||null;
  }

  async function selectSizeDropdown(triggerEl, sizesStr, failed = []) {
    const wantedSizes=String(sizesStr||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!wantedSizes.length)return false;
    await closeOpenDropdown();
    const handled=callReactOnClick(triggerEl);
    if(!handled){
      realClick(triggerEl);
      const input=triggerEl&&triggerEl.querySelector('input');
      if(input)realClick(input);
    }
    const selected=[];
    let lastRow=null;
    for(const target of wantedSizes){
      const found=await waitForSizeOption(target,950);
      if(!found){
        failed.push('Size option not found on the selected Meesho catalog: '+target);
        continue;
      }
      lastRow=found.row;
      if(found.checkbox){
        if(!found.checkbox.checked)found.checkbox.click();
        // Controlled React checkboxes may update on the next paint.
        const began=Date.now();
        while(!found.checkbox.checked&&Date.now()-began<220)await sleep(20);
        if(!found.checkbox.checked){
          // Try the associated label/row once only, then verify state.
          const label=found.checkbox.closest('label')||found.row;
          if(label&&label!==found.checkbox)realClick(label);
          const retryStart=Date.now();
          while(!found.checkbox.checked&&Date.now()-retryStart<180)await sleep(20);
        }
        if(!found.checkbox.checked){
          failed.push('Meesho did not register the size checkbox: '+target);
          continue;
        }
      }else{
        const result=clickSizeRow(found.row);
        if(result==='checkbox-failed'||result==='none'){
          failed.push('Could not click Meesho size option: '+target);
          continue;
        }
      }
      selected.push(target);
    }
    if(!selected.length){failed.push('No size options were selected.');return false;}
    const applyBtn=findSizeApplyButton(lastRow);
    if(applyBtn){
      applyBtn.scrollIntoView({behavior:'auto',block:'center'});
      // Native click is closer to a user's real click and avoids double-firing React handlers.
      realClick(applyBtn);
      const began=Date.now();
      while(Date.now()-began<800){
        await sleep(25);
        const stillVisible=elementIsVisible(applyBtn);
        const triggerText=norm(String(triggerEl&&triggerEl.textContent||'')+' '+String(triggerEl&&triggerEl.querySelector('input')?.value||''));
        if(!stillVisible||!findVisibleSizeOption(wantedSizes[0]))break;
        if(wantedSizes.every(size=>triggerText.includes(norm(size))))break;
      }
      const openMenus=Array.from(document.querySelectorAll('.MuiPopover-root,.MuiModal-root,.MuiDialog-root,[role="listbox"],[role="menu"]')).filter(elementIsVisible);
      const triggerText=norm(String(triggerEl&&triggerEl.textContent||'')+' '+String(triggerEl&&triggerEl.querySelector('input')?.value||''));
      const menuStillContainsSize=!!findVisibleSizeOption(wantedSizes[0]);
      if(!elementIsVisible(applyBtn)||!menuStillContainsSize||wantedSizes.every(size=>triggerText.includes(norm(size))))return true;
      // The first click may have landed while the panel was animating; retry only if Apply is still visible.
      if(elementIsVisible(applyBtn)){
        realClick(applyBtn);
        const retry=Date.now();
        while(Date.now()-retry<500&&elementIsVisible(applyBtn))await sleep(25);
        if(!elementIsVisible(applyBtn))return true;
      }
      failed.push('Size checkbox selected, but Meesho did not apply the selection. Please check the size field before saving.');
      return false;
    }
    const triggerText=norm(String(triggerEl&&triggerEl.textContent||'')+' '+String(triggerEl&&triggerEl.querySelector('input')?.value||''));
    if(wantedSizes.every(size=>triggerText.includes(norm(size))))return true;
    // If the UI uses a single-select variant with no Apply button, let React commit it.
    const menus=Array.from(document.querySelectorAll('.MuiPopover-root,.MuiModal-root,.MuiDialog-root,[role="listbox"],[role="menu"]')).filter(elementIsVisible);
    if(!menus.length)return true;
    failed.push('Size checkbox selected but Apply was not found; leave the menu open and press Apply manually.');
    return false;
  }

  function waitForDropdownSearchBox(existingSet, timeoutMs = 2000) {
    return new Promise(resolve => {
      function check() {
        const inputs = document.querySelectorAll('input[placeholder="Search"], input[placeholder="search"]');
        for (const inp of inputs) {
          if (!existingSet.has(inp) && inp.offsetParent !== null) {
            let container = inp.parentElement;
            for (let i = 0; i < 6; i++) {
              if (!container) break;
              const items = container.querySelectorAll('li, [class*="item"], [class*="option"]');
              if (items.length > 0) { resolve({ searchBox: inp, container }); return; }
              container = container.parentElement;
            }
            resolve({ searchBox: inp, container: inp.parentElement });
            return;
          }
        }
      }

      check();
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  const SIZE_TABLE_ORDER = [
    'meesho_price', 'only_wrong_return_price', 'product_mrp', 'inventory', 'supplier_sku_id',
  ];
  const SIZE_TABLE_FIELDS = new Set(SIZE_TABLE_ORDER);

  const LABEL_MAP = {
    product_name: ['product name'],
    supplier_product_id: ['style code', 'product id', 'style code/ product id', 'style code/product id', 'supplier product id'],
    color: ['color'],
    fabric: ['fabric'],
    fit_shape: ['fit/ shape', 'fit/shape', 'fit shape'],
    waist_rise: ['waist rise'],
    waist_closure: ['waist closure'],
    neck: ['neck'],
    sleeve_length: ['sleeve length'],
    stitch_type: ['stitch type'],
    pattern: ['pattern'],
    print_or_pattern_type: ['print or pattern type', 'print or pattern'],
    length: ['length'],
    occasion: ['occasion'],
    combo_of: ['combo of'],
    multipack: ['net quantity', 'net quantity (n)'],
    generic_name: ['generic name'],
    add_ons: ['add ons', 'add-on', 'add-ons'],
    country_of_origin: ['country of origin'],
    manufacturer_name: ['manufacturer name'],
    manufacturer_address: ['manufacturer address'],
    manufacturer_pincode: ['manufacturer pincode'],
    packer_name: ['packer name'],
    packer_address: ['packer address'],
    packer_pincode: ['packer pincode'],
    importer_name: ['importer name'],
    importer_address: ['importer address'],
    importer_pincode: ['importer pincode'],
    supplier_gst_percent: ['gst', 'gst rate', 'gst percentage'],
    hsn_code: ['hsn code', 'hsn'],
    product_weight_in_gms: ['net weight', 'product weight in gms'],
    size: ['size', 'select size', 'select sizes', 'available sizes'],
    brand: ['brand'],
    ornamentation: ['ornamentation'],
    sleeve_styling: ['sleeve styling'],
    description: ['description'],
    meesho_price: ['meesho price', 'selling price'],
    product_mrp: ['mrp', 'maximum retail price'],
    only_wrong_return_price: ['wrong/defective returns price', 'wrong return price'],
    inventory: ['inventory', 'stock quantity'],
    supplier_sku_id: ['sku id', 'supplier sku id'],
    capacity_in_l: ['capacity in l', 'capacity'],
    product_breadth: ['product breadth', 'breadth'],
    product_height: ['product height'],
    product_length: ['product length'],
    product_unit: ['product unit', 'dimension unit'],
    product_weight: ['product weight'],
    product_weight_unit: ['product weight unit', 'weight unit'],
    type: ['type', 'bottle type'],
    volume_unit: ['volume unit'],
    leak_proof: ['leak proof', 'leakproof'],
    material: ['material', 'fabric'],
    generic_name: ['generic name'],
    multipack: ['net quantity', 'net quantity (n)', 'multipack'],
    color: ['color', 'colour'],
    country_of_origin: ['country of origin', 'origin country'],
    manufacturer_name: ['manufacturer name'],
    manufacturer_address: ['manufacturer address'],
    manufacturer_pincode: ['manufacturer pincode', 'manufacturer pin code'],
    packer_name: ['packer name'],
    packer_address: ['packer address'],
    packer_pincode: ['packer pincode', 'packer pin code'],
    importer_name: ['importer name'],
    importer_address: ['importer address'],
    importer_pincode: ['importer pincode', 'importer pin code'],
    bis_isi_number: ['bis/isi certification number', 'bis isi certification number', 'bis/isi number', 'bis isi number'],
    bis_isi_certification_number: ['bis/isi certification number', 'bis isi certification number'],
    cm_l_number: ['cm/l number', 'cml number', 'cm l number'],
    cml_number: ['cm/l number', 'cml number', 'cm l number'],
    bust_size: ['bust size'],
    shoulder_size: ['shoulder size'],
    waist_size: ['waist size'],
    size_length: ['size length'],
    hip_size: ['hip size'],
  };

  function toCamel(str) {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  function classifyInput(input) {
    if (!input) return null;
    if (input.tagName === 'SELECT') return { inputEl: input, triggerEl: input, type: 'select' };
    const isReadonly = input.hasAttribute('readonly') || input.readOnly;
    if (isReadonly && input.type === 'text') {
      return { inputEl: input, triggerEl: input.parentElement, type: 'mui' };
    }
    return { inputEl: input, triggerEl: input, type: 'input' };
  }

  function findLabelTextNode(keyword) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const matches = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = norm(node.textContent);
      if (!t || t.length < 2 || t.length > 50) continue;
      const parent = node.parentElement;
      if (!parent || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'BUTTON'].includes(parent.tagName)) continue;
      if (t === keyword || t.startsWith(keyword + ' ')) matches.push({ node, len: t.length });
    }
    matches.sort((a, b) => a.len - b.len);
    return matches.length ? matches[0].node : null;
  }

  function findFieldFromTextNode(textNode) {
    let container = textNode.parentElement;
    for (let depth = 0; depth < 8; depth++) {
      if (!container) break;
      const nativeSelect = container.querySelector('select');
      if (nativeSelect) return { inputEl: nativeSelect, triggerEl: nativeSelect, type: 'select' };
      const input = container.querySelector('input:not([type="hidden"]), textarea');
      if (input) return classifyInput(input);
      container = container.parentElement;
    }
    return null;
  }

  function findField(identifier) {
    const candidates = [identifier, toCamel(identifier)];
    for (const id of candidates) {
      const el = document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        return classifyInput(el);
      }
    }
    const keywords = LABEL_MAP[identifier] || [identifier.replace(/_/g, ' ')];
    for (const kw of keywords) {
      const cached = __labelCache.get(norm(kw));
      if (cached) return cached;
    }
    for (const kw of keywords) {
      const textNode = findLabelTextNode(kw);
      if (!textNode) continue;
      const field = findFieldFromTextNode(textNode);
      if (field) return field;
    }
    return null;
  }

  function findVariationSizeField() {
    let otherAttrAnchor = null;
    const anchorWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let an;
    while ((an = anchorWalker.nextNode())) {
      if (norm(an.textContent) === 'other attributes') { otherAttrAnchor = an; break; }
    }

    const candidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === otherAttrAnchor) break;
      const t = norm(node.textContent);
      if (!t || t.length < 2 || t.length > 50) continue;
      const parent = node.parentElement;
      if (!parent || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'BUTTON'].includes(parent.tagName)) continue;
      if (/^(size|select size|select sizes|choose size|choose sizes|available size|available sizes|size selection|variation size|variation sizes)$/.test(t) || t.startsWith('size ')) candidates.push({ node, len: t.length });
    }
    candidates.sort((a, b) => a.len - b.len);
    for (const c of candidates) {
      const field = findFieldFromTextNode(c.node);
      if (field) return field;
    }
    return null;
  }

  function buildLabelCache() {
    __labelCache.clear();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = norm(node.textContent);
      if (!t || t.length < 2 || t.length > 50) continue;
      const parent = node.parentElement;
      if (!parent || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'BUTTON'].includes(parent.tagName)) continue;

      const field = findFieldFromTextNode(node);
      if (field) {
        __labelCache.set(t, field);
      }
    }
  }

  async function selectMuiDropdown(triggerEl, inputEl, value) {
    await closeOpenDropdown();

    realClick(triggerEl);
    const targetText = norm(value);
    let opt = null;

    for (let i = 0; i < 12; i++) {
      await sleep(25);
      const portal = document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root');
      if (portal) {
        const items = Array.from(portal.querySelectorAll('li, [role="option"]'));
        opt = items.find(el => norm(el.textContent) === targetText) ||
          items.find(el => norm(el.textContent).startsWith(targetText)) ||
          items.find(el => norm(el.textContent).includes(targetText));
        if (opt) break;
      }
    }

    if (!opt) {
      const searchBox = document.querySelector('.MuiPopover-root input, .MuiModal-root input, .MuiDialog-root input');
      if (searchBox) {
        searchBox.focus();
        setReactInputValue(searchBox, value);
        await sleep(150);
        const portal = document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root');
        if (portal) {
          const items = Array.from(portal.querySelectorAll('li, [role="option"]'));
          opt = items.find(el => norm(el.textContent) === targetText) ||
            items.find(el => norm(el.textContent).startsWith(targetText)) ||
            items.find(el => norm(el.textContent).includes(targetText));
          // Never choose the first tax/dropdown option simply because search failed.
          // A guessed dropdown pick can silently assign the wrong HSN/GST value.
        }
      }
    }

    if (opt) {
      realClick(opt);
      for (let i = 0; i < 15; i++) {
        if (!document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root')) break;
        await sleep(25);
      }
      return true;
    }

    await closeOpenDropdown();
    return false;
  }

  async function fillFieldDirect(field, value, identifier, failed = []) {
    if (!value || String(value).trim() === '') return false;
    try {

      if (field.type === 'mui') {
        return await selectMuiDropdown(field.triggerEl, field.inputEl, value);
      }
      if (field.type === 'select') {
        const options = Array.from(field.triggerEl.options);
        const match = options.find(o => norm(o.text) === norm(value)) ||
          options.find(o => norm(o.text).includes(norm(value)));

        if (!match) {
          failed.push(`${identifier} ("${value}") not in dropdown`);
          return false;
        }
        field.triggerEl.value = match.value;
        field.triggerEl.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      setReactInputValue(field.triggerEl, value);
      return true;
    } catch (err) {
      failed.push(`${identifier} error`);
      return false;
    }
  }

  async function fillSizeTableField(identifier, value, failed = []) {
    const allEls = document.querySelectorAll(`[id="${CSS.escape(identifier)}"]`);
    if (allEls.length === 0) {
      failed.push(`${identifier} not found`);
      return false;
    }
    let anyFilled = false;
    for (const el of allEls) {
      const f = classifyInput(el);
      if (!f) continue;
      if (!anyFilled) el.scrollIntoView({ behavior: 'auto', block: 'center' });

      let finalVal = value;
      if (identifier === 'supplier_sku_id') {
        const rowSize = findSizeForElement(el);
        if (rowSize) finalVal = `${value}-${rowSize.replace(/[^A-Z0-9]+/gi, "")}`;
      }

      const ok = await fillFieldDirect(f, finalVal, identifier, failed);
      if (ok) anyFilled = true;
      if (f.type === 'mui') await sleep(50);
    }
    if (!anyFilled) failed.push(`${identifier} (all rows)`);
    return anyFilled;
  }

  function findSizeTableRowsOrdered() {
    const rows = [];
    for (const priceInput of document.querySelectorAll('[id="meesho_price"]')) {
      let el = priceInput.parentElement;
      for (let i = 0; i < 12; i++) {
        if (!el || el === document.body) break;
        const sizeLabel = el.querySelector('p.MuiTypography-body1');
        if (sizeLabel) {
          const size = sizeLabel.textContent.trim().toUpperCase();
          if (size) rows.push({ size, el });
          break;
        }
        el = el.parentElement;
      }
    }
    return rows;
  }

  function findSizeForElement(el) {
    let curr = el;
    for (let i = 0; i < 12; i++) {
      if (!curr || curr === document.body) break;
      const sizeLabel = curr.querySelector('p.MuiTypography-body1');
      if (sizeLabel) {
        const size = sizeLabel.textContent.trim().toUpperCase();
        if (size && size.length < 10) return size;
      }

      let sib = curr.previousElementSibling;
      while (sib) {
        const sLbl = sib.querySelector('p.MuiTypography-body1');
        if (sLbl) {
          const sz = sLbl.textContent.trim().toUpperCase();
          if (sz && sz.length < 10) return sz;
        }
        sib = sib.previousElementSibling;
      }
      curr = curr.parentElement;
    }
    return '';
  }

  function detectMeasureOrder(rowEl, measureIds) {
    const found = [];
    for (const id of measureIds) {
      const input = rowEl.querySelector(`[id="${CSS.escape(id)}"]`);
      if (input) {
        const rect = input.getBoundingClientRect();
        found.push({ id, left: rect.left });
      }
    }
    found.sort((a, b) => a.left - b.left);
    return found.map(f => f.id);
  }

  async function fillSizeMeasurements(sizeMeasures, failed = []) {
    if (Object.keys(sizeMeasures).length === 0) return { filled: 0, stopped: false };
    const orderedRows = findSizeTableRowsOrdered();
    let filled = 0;

    const allMeasureIds = new Set();
    for (const measures of Object.values(sizeMeasures)) {
      for (const key of Object.keys(measures)) allMeasureIds.add(key);
    }

    for (const { size, el: rowEl } of orderedRows) {
      const measures = sizeMeasures[size];
      if (!measures) continue;

      const measureOrder = detectMeasureOrder(rowEl, allMeasureIds);

      for (const field of measureOrder) {
        const value = measures[field];
        if (!value) continue;
        const input = rowEl.querySelector(`[id="${CSS.escape(field)}"]`);
        if (!input) continue;
        const f = classifyInput(input);
        if (!f) continue;

        const ok = await fillFieldDirect(f, value, field, failed);
        if (ok) {
          filled++;
        } else {
          failed.push(`${field} for ${size} ("${value}")`);
          await closeOpenDropdown();
          return { filled, stopped: true };
        }
      }
    }
    return { filled, stopped: false };
  }

  async function autofill(values) {
    let filled = 0;
    const failed = [];
    const progressTotal=Math.max(1,Object.entries(values||{}).filter(([key,value])=>key!=='_variation_sizes'&&String(value||'').trim()!=='').length);
    let progressDone=0;
    const reportAutofillProgress=(label)=>{
      progressDone=Math.min(progressTotal,progressDone+1);
      const percent=Math.min(99,4+Math.round((progressDone/progressTotal)*94));
      try{chrome.runtime.sendMessage({type:'AUTOFILL_PROGRESS',percent,label:String(label||'Filling field')+' ('+progressDone+'/'+progressTotal+')'},()=>{void chrome.runtime.lastError;});}catch(e){}
    };
    try{chrome.runtime.sendMessage({type:'AUTOFILL_PROGRESS',percent:3,label:'Starting on the active Meesho page'});}catch(e){}

    __apiAllowedValues = {};
    __fieldSectionMap = {};
    if (__capturedProductFields) {
      const api = __capturedProductFields;
      const sectionKeys = ['product_details_data', 'product_size_data', 'product_data', 'other_data'];
      for (const sectionKey of sectionKeys) {
        for (const f of (api[sectionKey] || [])) {
          if (!f.identifier) continue;
          __fieldSectionMap[f.identifier] = sectionKey;
          if (Array.isArray(f.values) && f.values.length > 0) {
            __apiAllowedValues[f.identifier] = f.values;
          }
        }
      }
    }

    buildLabelCache();

    const sizeMeasures = {};
    const regularValues = {};
    for (const [key, val] of Object.entries(values)) {
      const m = key.match(/^(.+)__([a-zA-Z0-9 .\-]+)$/);
      if (m) {
        const [, field, size] = m;
        const upperSize = size.toUpperCase();
        if (!sizeMeasures[upperSize]) sizeMeasures[upperSize] = {};
        sizeMeasures[upperSize][field] = val;
      } else {
        regularValues[key] = val;
      }
    }

    const PHASE0_IDS = ['supplier_gst_percent', 'hsn_code', 'product_weight_in_gms', 'product_name', 'description', 'product_description', 'supplier_product_id'];

    for (const id of PHASE0_IDS) {
      const value = regularValues[id];
      if (!value || String(value).trim() === '') continue;

      reportAutofillProgress('Filling '+id);
      const field = findField(id);
      if (!field) { failed.push(id + ' not found on the Meesho page'); continue; }

      if (field.type === 'mui') {
        field.triggerEl.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(30);
        const ok = await fillFieldDirect(field, value, id, failed);
        if (ok) {
          filled++;
        } else {
          await closeOpenDropdown();
          buildLabelCache();
        }
        await sleep(50);
      } else {
        const ok = await fillFieldDirect(field, value, id, failed);
        if (ok) {
          filled++;
        } else {
          buildLabelCache();
        }
      }
    }

    const variationSizes = regularValues['_variation_sizes'];
    if (variationSizes && String(variationSizes).trim()) {
      const vField = findVariationSizeField();
      if (vField) {
        vField.triggerEl.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(30);
        const ok = await selectSizeDropdown(vField.triggerEl, variationSizes, failed);
        reportAutofillProgress('Selecting size '+variationSizes);
        if (ok) filled++;
        await closeOpenDropdown();
        await sleep(50);
      } else {
        failed.push('Selected size(s) could not be matched to a Meesho size selector.');
      }
    }

    for (let i = 0; i < 40; i++) {
      if (document.getElementById('meesho_price')) break;
      await sleep(50);
    }
    await sleep(50);

    buildLabelCache();

    for (const id of SIZE_TABLE_ORDER) {
      const value = regularValues[id];
      if (!value || String(value).trim() === '') continue;

      const ok = await fillSizeTableField(id, value, failed);
      reportAutofillProgress('Filling size field '+id);
      if (ok) {
        filled++;
      } else {
        buildLabelCache();
      }
    }

    if (Object.keys(sizeMeasures).length > 0) {
      const measureResult = await fillSizeMeasurements(sizeMeasures, failed);
      const measureCount=Object.values(sizeMeasures).reduce((total,items)=>total+Object.keys(items||{}).length,0);
      for(let i=0;i<measureCount;i++)reportAutofillProgress('Filling per-size measurement');
      filled += measureResult.filled;
      if (measureResult.stopped) {
        buildLabelCache();
      }
    }

    const SKIP = new Set([...PHASE0_IDS, ...SIZE_TABLE_ORDER]);
    const phase3Queue = [];
    const phase4Queue = [];
    for (const [id, value] of Object.entries(regularValues)) {
      if (!value || String(value).trim() === '') continue;
      if (id === '_variation_sizes') continue;
      if (SKIP.has(id)) continue;

      const field = findField(id);
      if (!field) { failed.push(id + ' not found on the Meesho page'); reportAutofillProgress('Field not found: '+id); continue; }

      if (__fieldSectionMap[id] === 'other_data') {
        phase4Queue.push({ id, value, field });
      } else {

        phase3Queue.push({ id, value, field });
      }
    }

    const sortAttr = (a, b) => {
      const prioA = __fieldSourceMap[a.id] || 3;
      const prioB = __fieldSourceMap[b.id] || 3;
      if (prioA !== prioB) return prioA - prioB;
      const yA = a.field && a.field.triggerEl ? (window.scrollY + a.field.triggerEl.getBoundingClientRect().top) : 0;
      const yB = b.field && b.field.triggerEl ? (window.scrollY + b.field.triggerEl.getBoundingClientRect().top) : 0;
      return yA - yB;
    };
    phase3Queue.sort(sortAttr);
    phase4Queue.sort(sortAttr);

    const fillAttrQueue = async (queue) => {
      for (const { id, value, field } of queue) {
        if (field.type === 'mui') {
          field.triggerEl.scrollIntoView({ behavior: 'auto', block: 'center' });
          await sleep(30);
          const ok = await fillFieldDirect(field, value, id, failed);
          if (ok) {
            filled++;
          } else {
            await closeOpenDropdown();
            buildLabelCache();
          }
          await sleep(50);
        } else {
          const ok = await fillFieldDirect(field, value, id, failed);
          if (ok) filled++;
          else buildLabelCache();
        }
        reportAutofillProgress('Filling '+id);
      }
      return true;
    };

    await fillAttrQueue(phase3Queue);
    await fillAttrQueue(phase4Queue);
    try{chrome.runtime.sendMessage({type:'AUTOFILL_PROGRESS',percent:99,label:'All autofill tasks processed; reviewing results'});}catch(e){}
    return { filled, failed, stopped: failed.length > 0 };
  }

  function findLabelForInput(input) {
    const aria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
    if (aria && !aria.startsWith('r')) {
      const lblEl = document.getElementById(aria);
      if (lblEl) return lblEl.textContent.replace(/\*/g, '').trim();
      if (aria.length < 60) return aria.replace(/\*/g, '').trim();
    }

    if (input.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) return lbl.textContent.replace(/\*/g, '').trim();
    }

    let el = input.parentElement;
    for (let depth = 0; depth < 10; depth++) {
      if (!el || el === document.body) break;
      for (const child of el.children) {
        if (child.contains(input)) continue;
        const tag = child.tagName;
        if (['LABEL', 'P', 'SPAN', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag) && !child.closest('button')) {
          const t = child.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
          if (t && t.length >= 2 && t.length <= 60 && !/^\d+$/.test(t) && !/^\d+\/\d+$/.test(t)) return t;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function scanFormFields() {
    if (!__capturedProductFields) {
      const el = document.getElementById('__mfpd_data');
      if (el && el.textContent) {
        try { __capturedProductFields = JSON.parse(el.textContent); } catch (e) { }
      }
    }

    const seenIds = new Set();
    const result = {
      sections: [
        { id: 'product_details_data', label: 'Product Details', fields: [] },
        { id: 'variations', label: 'Sizes', data: [] },
        { id: 'product_size_data', label: 'Measurements', fields: [] },
        { id: 'product_data', label: 'Attributes', fields: [] },
        { id: 'other_data', label: 'Other Attributes', fields: [] }
      ],
      hasApiData: !!__capturedProductFields,
      staticValues: {},
      capturedValues: {}
    };

    // Read the value that is already present in the live Meesho form.
    // This is intentionally independent of the API schema so pre-filled fields
    // are captured during Scan instead of being lost when the extension opens.
    function readLiveValue(identifier) {
      if (!identifier) return { found: false, value: '' };
      const candidates = [identifier, toCamel(identifier)];
      for (const id of candidates) {
        const el = document.getElementById(id) || document.querySelector(`[name=\"${CSS.escape(id)}\"]`);
        if (!el) continue;
        if (el.tagName === 'SELECT') {
          const opt = el.options?.[el.selectedIndex];
          return { found: true, value: opt ? (opt.textContent || opt.value || '').trim() : '' };
        }
        if (el.type === 'checkbox' || el.type === 'radio') {
          return { found: true, value: el.checked ? (el.value || 'true') : '' };
        }
        return { found: true, value: String(el.value ?? '').trim() };
      }

      const field = findField(identifier);
      if (field?.inputEl) {
        const el = field.inputEl;
        if (el.tagName === 'SELECT') {
          const opt = el.options?.[el.selectedIndex];
          return { found: true, value: opt ? (opt.textContent || opt.value || '').trim() : '' };
        }
        return { found: true, value: String(el.value ?? '').trim() };
      }
      return { found: false, value: '' };
    }

    const getSection = (id) => result.sections.find(s => s.id === id);

    function mapApiField(f, sectionId) {

      if (!f || !f.identifier) return null;
      if (String(f.identifier).toLowerCase() === 'size' && sectionId === 'product_details_data') {
        seenIds.add(f.identifier);
        return null;
      }
      __fieldSourceMap[f.identifier] = 1;
      __fieldSectionMap[f.identifier] = sectionId;
      seenIds.add(f.identifier);
      return {
        identifier: f.identifier,
        label: f.name,
        inputType: String(f.type || 'text').toLowerCase(),
        values: Array.isArray(f.values) ? f.values : [],
        mandatory: !!f.mandatory
      };
    }

    const PRICING_IDS = ['meesho_price', 'product_mrp', 'only_wrong_return_price', 'inventory', 'supplier_sku_id'];

    if (__capturedProductFields) {
      const api = __capturedProductFields;

      if (Array.isArray(api.product_details_data)) {
        const sec = getSection('product_details_data');
        api.product_details_data.forEach(f => {
          const mapped = mapApiField(f, 'product_details_data');
          if (mapped) sec.fields.push(mapped);
        });
      }

      if (Array.isArray(api.variations)) {
        getSection('variations').data = api.variations.map(v => v.variation_name).filter(Boolean);
      }

      if (Array.isArray(api.product_size_data)) {
        const sec = getSection('product_size_data');
        api.product_size_data.forEach(f => {

          if (PRICING_IDS.includes(f.identifier) && f.values && f.values.length) {
            result.staticValues[f.identifier] = f.values;
          }
          const mapped = mapApiField(f, 'product_size_data');
          if (mapped) sec.fields.push(mapped);
        });
      }

      if (Array.isArray(api.product_data)) {
        const sec = getSection('product_data');
        api.product_data.forEach(f => {
          const mapped = mapApiField(f, 'product_data');
          if (mapped) sec.fields.push(mapped);
        });
      }

      if (Array.isArray(api.other_data)) {
        const sec = getSection('other_data');
        api.other_data.forEach(f => {
          const mapped = mapApiField(f, 'other_data');
          if (mapped) sec.fields.push(mapped);
        });
      }
    }

    // Capture the current value for every field that the scan discovered,
    // including values that were already filled before the scan started.
    result.sections.forEach(sec => {
      (sec.fields || []).forEach(f => {
        const live = readLiveValue(f.identifier);
        if (live.found) result.capturedValues[f.identifier] = live.value;
      });
    });

    // Capture the currently selected size/variation from the live page.
    try {
      const sizeField = findVariationSizeField();
      if (sizeField?.inputEl) {
        const v = String(sizeField.inputEl.value ?? '').trim();
        if (v) result.capturedValues['_variation_sizes'] = v;
      }
    } catch (_) {}

    const allInputs = [
      ...document.querySelectorAll('input[readonly]'),
      ...document.querySelectorAll(
        'input:not([readonly]):not([type=hidden]):not([placeholder="Search"]):not([placeholder="search"]):not([type=submit]):not([type=button])'
      ),
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('select'),
    ];

    const NOISE_LABELS = [
      'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL', '7XL', '8XL', '9XL', '10XL', 'FREE SIZE',
      'DELETE', 'ADD', 'EDIT', 'COPY', 'UPLOAD', 'CHANGE', 'IMAGE', 'GUIDELINE'
    ];

    const attrSection = getSection('product_data');
    const detailSection = getSection('product_details_data');

    for (const input of allInputs) {
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const id = input.id || input.name;
      if (!id || seenIds.has(id)) continue;
      if (/search|filter|query|variant|variation/i.test(id)) continue;

      const labelArea = findLabelForInput(input);
      if (!labelArea || labelArea.length < 2 || labelArea.length > 60) continue;
      if (/discount|search/i.test(labelArea)) continue;

      const normLabel = norm(labelArea);
      if (normLabel === 'description' || normLabel === 'product description') continue;
      if (NOISE_LABELS.includes(normLabel.toUpperCase()) || normLabel.includes('delete')) continue;

      const isReadonly = input.hasAttribute('readonly');
      const fieldObj = {
        identifier: id,
        label: labelArea.replace(/\*/g, '').trim(),
        inputType: isReadonly ? 'dropdown' : (input.tagName === 'TEXTAREA' ? 'textarea' : (input.tagName === 'SELECT' ? 'select' : (input.type || 'text'))),
        values: [],
        mandatory: false,
        _top: window.scrollY + rect.top
      };

      // Preserve a value that was already typed/selected on the Meesho page.
      if (input.tagName === 'SELECT') {
        const opt = input.options?.[input.selectedIndex];
        result.capturedValues[id] = opt ? (opt.textContent || opt.value || '').trim() : '';
      } else if (input.type === 'checkbox' || input.type === 'radio') {
        result.capturedValues[id] = input.checked ? (input.value || 'true') : '';
      } else {
        result.capturedValues[id] = String(input.value ?? '').trim();
      }

      if (/size/i.test(id) || /size/i.test(normLabel)) {
        if (getSection('variations').data.length > 0) {
          seenIds.add(id);
          continue;
        }
        detailSection.fields.push(fieldObj);
      } else if (/qty|weight|gst|hsn|name|description|style|id/i.test(id) || /qty|weight|gst|hsn|name|description|style|id/i.test(normLabel)) {
        detailSection.fields.push(fieldObj);
      } else if (PRICING_IDS.includes(id) || /price|mrp|inventory/i.test(id) || /price|mrp|inventory/i.test(normLabel)) {

      } else {
        attrSection.fields.push(fieldObj);
      }
      seenIds.add(id);
      __fieldSourceMap[id] = 3;
    }

    result.sections.forEach(sec => {
      if (sec.fields) {
        sec.fields.sort((a, b) => (a._top || 0) - (b._top || 0));
        sec.fields.forEach(f => delete f._top);
      }
    });

    // Expose only small, non-sensitive catalog/page context so the popup can
    // infer the already-selected Meesho catalog from its real form structure.
    function readCatalogContextValue(source, depth = 0, out = {}) {
      if (depth > 6 || source == null || typeof source !== 'object') return out;
      const keys = Array.isArray(source) ? source.entries() : Object.entries(source);
      for (const [rawKey, value] of keys) {
        const key = String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (typeof value === 'string' || typeof value === 'number') {
          const text = String(value).trim();
          if (text && text.length <= 100) {
            if (['categoryname','catalogcategoryname','primarycategoryname'].includes(key) && !out.categoryName) out.categoryName = text;
            if (['subcategoryname','subsubCategoryName'.toLowerCase(),'subsubcategoryname','sscatname','catalogsubcategoryname'].includes(key) && !out.subCategoryName) out.subCategoryName = text;
            if (['catalogtype','producttype','productfamily'].includes(key) && !out.catalogType) out.catalogType = text;
          }
        } else if (value && typeof value === 'object') {
          readCatalogContextValue(value, depth + 1, out);
        }
      }
      return out;
    }
    const headingTexts = Array.from(document.querySelectorAll(
      'h1, h2, h3, [class*="breadcrumb" i] a, [aria-label*="breadcrumb" i] a'
    )).filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).map(node => String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(text => text && text.length <= 100).filter((text, index, list) => list.indexOf(text) === index).slice(0, 12);
    try {
      window.dispatchEvent(new CustomEvent('mls:request-catalog-context'));
    } catch (_) {}
    let locationIds = {};
    try {
      const params = new URLSearchParams(window.location.search);
      locationIds = {
        sscatId: params.get('sscat_id') || params.get('sscatId') || params.get('sub_sub_category_id') || '',
        categoryId: params.get('category_id') || params.get('categoryId') || '',
        catalogId: params.get('catalog_id') || params.get('catalogId') || ''
      };
    } catch (_) {}
    result.catalogContext = Object.assign({
      pageTitle: String(document.title || '').slice(0, 120),
      pagePath: String(window.location.pathname || '').slice(0, 200),
      headings: headingTexts,
      categoryName: '',
      subCategoryName: '',
      catalogType: '',
      ids: locationIds
    }, readCatalogContextValue(__capturedProductFields), __capturedCatalogContext);
    result.catalogContext.ids = Object.assign({}, locationIds, {
      sscatId: __capturedCatalogContext.sscatId || locationIds.sscatId || ''
    });

    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SCAN_FORM') {
      try {
        sendResponse(scanFormFields());
      } catch (err) {
        sendResponse({ success: false, fields: [], hasApiData: false, error: err.message });
      }
      return true;
    }
    if (message.type === 'AUTOFILL') {
      autofill(message.values).then(({ filled, failed, stopped }) => {
        let finalMsg = filled > 0 ? `Filled ${filled} field(s).` : 'Nothing filled.';
        if (failed.length > 0) finalMsg += ` Failed: ${failed.join(', ')}.`;
        if (stopped) finalMsg += ' [STOPPED DUE TO FAILURE]';

        sendResponse({
          success: true, filled, failed, stopped,
          message: finalMsg
        });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    if (message.type === 'OPEN_SIDE_PANEL') {
      openSidePanel();
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'DEBUG_SCAN') {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const labels = new Set();
      let node;
      while ((node = walker.nextNode())) {
        const t = norm(node.textContent);
        const p = node.parentElement;
        if (t && t.length > 1 && t.length < 50 && /[a-z]/.test(t) && p &&
          !['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE'].includes(p.tagName)) {
          labels.add(t);
        }
      }
      sendResponse({ fields: Array.from(labels) });
      return true;
    }
  });

  function showToast(msg, color = '#4caf50') {
    let t = document.getElementById('meesho-af-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'meesho-af-toast';
      Object.assign(t.style, {
        position: 'fixed', bottom: '80px', right: '24px', zIndex: '2147483647',
        borderRadius: '8px', padding: '10px 16px', fontSize: '13px',
        fontWeight: '500', maxWidth: '320px', color: 'white',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)', whiteSpace: 'pre-line',
      });
      document.body.appendChild(t);
    }
    t.style.background = color;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 7000);
  }

  function setPillVisible(visible) {
    const pill = document.getElementById('meesho-af-btn');
    if (pill) pill.style.display = visible ? 'inline-flex' : 'none';
  }

  function openSidePanel(view) {
    if (!isContextValid()) {

      return;
    }
    const requestedView = view || 'profilesLanding';

    let panel = document.getElementById('meesho-af-panel');

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'meesho-af-panel';
      Object.assign(panel.style, {
        position: 'fixed', top: '0', right: '-430px', width: '420px',
        height: '100vh', zIndex: '2147483646',
        boxShadow: '-18px 0 46px rgba(0,0,0,0.42), -1px 0 0 rgba(72,163,255,0.2)',
        borderRadius: '18px 0 0 18px',
        transition: 'right 0.28s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden', background: '#0b1220',
      });
      const iframe = document.createElement('iframe');
      let src = chrome.runtime.getURL('popup.html') + '?panel=1';
      if (view) src += '&view=' + encodeURIComponent(view);
      iframe.src = src;
      Object.assign(iframe.style, { width: '100%', height: '100%', border: 'none', display: 'block', background: '#0b1220' });

      iframe.addEventListener('load', () => {
        try {
          const frameDoc = iframe.contentDocument;
          if (frameDoc && frameDoc.body && frameDoc.body.textContent.includes('This page has been blocked by Chrome')) {
            panel.dataset.frameBlocked = 'true';
          }
        } catch (_) {}
      });

      iframe.addEventListener('error', () => {
        panel.dataset.frameBlocked = 'true';
      });

      panel.appendChild(iframe);
      document.body.appendChild(panel);
      requestAnimationFrame(() => requestAnimationFrame(() => { panel.style.right = '0'; }));
      setPillVisible(false);
      return;
    }

    panel.style.right = '0';
    setPillVisible(false);

    const iframe = panel.querySelector('iframe');
    try { iframe?.contentWindow?.postMessage({ type: '__meesho_af_set_view', view: requestedView }, '*'); } catch (_) {}
  }

  window.addEventListener('__meesho_af_open_panel', (e) => {
    openSidePanel(e?.detail?.view);
  });

  window.addEventListener('message', e => {
    const panel = document.getElementById('meesho-af-panel');
    const iframe = panel?.querySelector('iframe');
    if (e.source !== iframe?.contentWindow) return;
    if (e.data && e.data.type === '__meesho_af_close_panel') {
      const panel = document.getElementById('meesho-af-panel');
      if (panel) panel.style.right = '-430px';
      setPillVisible(true);
    }
  });

  function isCatalogAddPage() {
    return location.href.includes('catalogs/single/add');
  }

  function injectQuickButton() {
    if (!isCatalogAddPage()) return;
    if (document.getElementById('meesho-af-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'meesho-af-btn';
    btn.setAttribute('aria-label', 'MEESHO A+ LISTING AUTOMATION PRO');
    btn.type = 'button';
    btn.innerHTML = `
      <span class="maf-pro-logo" style="display:inline-flex; align-items:center; justify-content:center;
                   width:32px; height:32px; border-radius:12px;
                   background:linear-gradient(135deg,#22c55e,#48a3ff); margin-right:9px;
                   box-shadow:0 8px 18px rgba(34,197,94,0.28);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 10.2 8.5 6l3.5 4.2L15.5 6 19 10.2V18H5v-7.8Z" fill="#fff"/>
          <path d="M7 20h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="maf-pro-copy" style="display:flex; flex-direction:column; align-items:flex-start; line-height:1.05;">
        <span style="font-size:10px; letter-spacing:0.9px; opacity:.72;">PREMIUM TOOL</span>
        <span data-maf-label style="font-size:12px; font-weight:900; letter-spacing:0; white-space:nowrap;">
          <span style="color:#48a3ff;">MEESHO A+</span> <span style="color:#fff;">LISTING AUTOMATION PRO</span>
        </span>
      </span>
    `;
    let savedPos = null;
    try { savedPos = JSON.parse(localStorage.getItem('meesho_af_launcher_pos') || 'null'); } catch (_) {}
    Object.assign(btn.style, {

      position: 'fixed',
      top: savedPos?.top ? `${savedPos.top}px` : '92px',
      left: savedPos?.left ? `${savedPos.left}px` : 'auto',
      right: savedPos?.left ? 'auto' : '22px',
      bottom: 'auto',
      zIndex: '2147483647',
      background: 'linear-gradient(135deg, #0b1220 0%, #101a2e 52%, #12203a 100%)',
      color: '#fff', border: '1px solid rgba(72,163,255,0.45)', borderRadius: '16px',
      padding: '9px 14px 9px 10px', fontSize: '13px', fontWeight: '800',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
      userSelect: 'none', touchAction: 'none',
      minWidth: '300px',
      maxWidth: '380px',
      boxShadow: '0 16px 38px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.05) inset',
      transition: 'transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      animation: 'mafLauncherPulse 2.4s ease-in-out infinite'
    });

    if (!document.getElementById('maf-launcher-style')) {
      const style = document.createElement('style');
      style.id = 'maf-launcher-style';
      style.textContent = `
        @keyframes mafLauncherPulse {
          0%, 100% { filter: drop-shadow(0 0 0 rgba(72,163,255,0)); }
          50% { filter: drop-shadow(0 0 10px rgba(72,163,255,0.32)); }
        }
        #meesho-af-btn::after {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: 17px;
          pointer-events: none;
          background: linear-gradient(115deg, transparent 0%, rgba(72,163,255,0.55) 46%, transparent 62%);
          opacity: 0;
          transition: opacity 180ms ease;
        }
        #meesho-af-btn:hover::after {
          opacity: 0.22;
        }
        #meesho-af-btn[data-checking="1"] .maf-pro-logo {
          animation: mafLogoSpin 900ms linear infinite;
        }
        @media (max-width: 560px) {
          #meesho-af-btn {
            min-width: 48px !important;
            padding-right: 10px !important;
          }
          #meesho-af-btn .maf-pro-copy {
            display: none !important;
          }
          #meesho-af-btn .maf-pro-logo {
            margin-right: 0 !important;
          }
        }
        @keyframes mafLogoSpin { to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }

    function setLauncherChecking(isChecking) {
      const label = btn.querySelector('[data-maf-label]');
      btn.dataset.checking = isChecking ? '1' : '0';
      if (label) {
        if (isChecking) {
          label.textContent = 'Checking plan...';
        } else {
          label.innerHTML = '<span style="color:#48a3ff;">MEESHO A+</span> <span style="color:#fff;">LISTING AUTOMATION PRO</span>';
        }
      }
    }

    let drag = null;
    let wasDragged = false;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = btn.getBoundingClientRect();
      drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top,
      };
      wasDragged = false;
      btn.setPointerCapture?.(e.pointerId);
    });

    btn.addEventListener('pointermove', (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) wasDragged = true;
      if (!wasDragged) return;
      const nextLeft = clamp(drag.left + dx, 8, window.innerWidth - btn.offsetWidth - 8);
      const nextTop = clamp(drag.top + dy, 8, window.innerHeight - btn.offsetHeight - 8);
      btn.style.left = `${nextLeft}px`;
      btn.style.top = `${nextTop}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    });

    btn.addEventListener('pointerup', (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      btn.releasePointerCapture?.(e.pointerId);
      if (wasDragged) {
        const rect = btn.getBoundingClientRect();
        try {
          localStorage.setItem('meesho_af_launcher_pos', JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
        } catch (_) {}
      }
      drag = null;
      if (wasDragged) setTimeout(() => { wasDragged = false; }, 0);
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.borderColor = 'rgba(34,197,94,0.72)';
      btn.style.boxShadow = '0 18px 44px rgba(0,0,0,0.4), 0 0 20px rgba(72,163,255,0.18)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.borderColor = 'rgba(72,163,255,0.45)';
      btn.style.boxShadow = '0 16px 38px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.05) inset';
    });

    btn.addEventListener('click', (e) => {
      if (wasDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      setLauncherChecking(true);
      openSidePanel();
      setTimeout(() => setLauncherChecking(false), 1600);
    });
    document.body.appendChild(btn);
  }

  function checkAndInject() {
    if (!isContextValid()) return;
    injectQuickButton();
  }

  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      if (!isCatalogAddPage()) {
        document.getElementById('meesho-af-btn')?.remove();
        document.getElementById('meesho-af-panel')?.remove();
      }
      _lastUrl = location.href;
      setTimeout(checkAndInject, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

  setTimeout(checkAndInject, 2000);
})();
