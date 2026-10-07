
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
  let __fieldSourceMap = {};
  let __fieldSectionMap = {};
  let __labelCache = new Map();
  let __apiAllowedValues = {};
  window.addEventListener('__mfpd', e => { __capturedProductFields = e.detail; });

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
    const portal = document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root');
    if (!portal) return;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    for (let i = 0; i < 10; i++) {
      if (!document.querySelector('.MuiPopover-root, .MuiModal-root, .MuiDialog-root')) break;
      await sleep(10);
    }
  }

  function findVisibleSizeMenu() {
    for (const el of document.querySelectorAll('ul[role="menu"]')) {
      if (el.getBoundingClientRect().width > 0) return el;
    }
    return null;
  }

  function clickSizeRow(row) {
    if (!row || !row.isConnected) return 'none';

    const svg = row.querySelector('svg');
    const target = svg || row;

    if (callReactOnClick(target)) return svg ? 'react-svg' : 'react-row';

    realClick(target);
    return svg ? 'native-svg' : 'native-row';
  }

  async function selectSizeDropdown(triggerEl, sizesStr, failed = []) {
    await closeOpenDropdown();

    const wantedSizes = sizesStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (wantedSizes.length === 0) return false;

    const existingMenus = new Set(document.querySelectorAll('ul[role="menu"]'));

    const reactSuccess = callReactOnClick(triggerEl);
    if (!reactSuccess) {
      realClick(triggerEl);
      const inp = triggerEl.querySelector('input');
      if (inp) realClick(inp);
    }

    let menu = await new Promise(resolve => {
      function check() {
        for (const el of document.querySelectorAll('ul[role="menu"]')) {
          if (!existingMenus.has(el) && el.getBoundingClientRect().width > 0) { resolve(el); return; }
        }
      }
      check();
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, 5000);
    });

    if (!menu) menu = findVisibleSizeMenu();

    if (!menu) {
      failed.push('Remove Exiting Size Selection');
      return false;
    }

    const clicked = [];
    for (const sizeTarget of wantedSizes) {
      const activeMenu = menu.isConnected ? menu : findVisibleSizeMenu();
      if (!activeMenu) break;

      const allP = Array.from(activeMenu.querySelectorAll('p'));
      const pEl = allP.find(p => norm(p.textContent) === norm(sizeTarget)) ||
        allP.find(p => norm(p.textContent).startsWith(norm(sizeTarget))) ||
        allP.find(p => norm(p.textContent).includes(norm(sizeTarget)));

      if (!pEl) {
        failed.push(`Size: ${sizeTarget}`);
        continue;
      }

      const row = pEl.parentElement;
      clickSizeRow(row);
      await sleep(100);
      clicked.push(sizeTarget);
    }

    if (clicked.length === 0) {
      await closeOpenDropdown();
      return false;
    }

    let applyBtn = null;
    const finalMenu = menu.isConnected ? menu : findVisibleSizeMenu();
    if (finalMenu) {
      applyBtn = Array.from(finalMenu.querySelectorAll('button')).find(btn => btn.textContent.trim().startsWith('Apply'));
    }
    if (!applyBtn) {
      applyBtn = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.trim().startsWith('Apply') && btn.getBoundingClientRect().width > 0);
    }

    if (!applyBtn) {
      failed.push('Size Selection Menu (Apply Button)');
      await closeOpenDropdown();
      return false;
    }

    await sleep(150);
    const applyTarget = applyBtn.querySelector('span.MuiTypography-root') || applyBtn;

    callReactOnClick(applyTarget);
    await sleep(100);

    if (applyTarget.isConnected) {
      realClick(applyTarget);
    }

    await sleep(400);

    if (applyBtn.isConnected && applyBtn.getBoundingClientRect().width > 0) {
      const t = applyBtn.querySelector('span.MuiTypography-root') || applyBtn;
      callReactOnClick(t);
      await sleep(200);
      if (t.isConnected) realClick(t);
    }
    return true;
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
    supplier_product_id: ['style code', 'product id'],
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
    supplier_gst_percent: ['gst'],
    hsn_code: ['hsn code', 'hsn'],
    product_weight_in_gms: ['net weight'],
    size: ['size'],
    brand: ['brand'],
    ornamentation: ['ornamentation'],
    sleeve_styling: ['sleeve styling'],
    description: ['description'],
    meesho_price: ['meesho price'],
    product_mrp: ['mrp'],
    only_wrong_return_price: ['wrong/defective returns price', 'wrong return price'],
    inventory: ['inventory'],
    supplier_sku_id: ['sku id'],
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
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
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
      if (t === 'size' || t.startsWith('size ')) candidates.push({ node, len: t.length });
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
            items[0];
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
        if (rowSize) finalVal = `${value}-${rowSize}`;
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

      const field = findField(id);
      if (!field) continue;

      if (field.type === 'mui') {
        field.triggerEl.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(30);
        const ok = await fillFieldDirect(field, value, id, failed);
        if (ok) {
          filled++;
        } else {
          await closeOpenDropdown();
          return { filled, failed, stopped: true };
        }
        await sleep(50);
      } else {
        const ok = await fillFieldDirect(field, value, id, failed);
        if (ok) {
          filled++;
        } else {
          return { filled, failed, stopped: true };
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
        if (ok) filled++;
        await closeOpenDropdown();
        await sleep(50);
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
      if (ok) {
        filled++;
      } else {
        return { filled, failed, stopped: true };
      }
    }

    if (Object.keys(sizeMeasures).length > 0) {
      const measureResult = await fillSizeMeasurements(sizeMeasures, failed);
      filled += measureResult.filled;
      if (measureResult.stopped) {
        return { filled, failed, stopped: true };
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
      if (!field) continue;

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
            return false;
          }
          await sleep(50);
        } else {
          const ok = await fillFieldDirect(field, value, id, failed);
          if (ok) filled++;
          else return false;
        }
      }
      return true;
    };

    if (!(await fillAttrQueue(phase3Queue))) return { filled, failed, stopped: true };
    if (!(await fillAttrQueue(phase4Queue))) return { filled, failed, stopped: true };

    return { filled, failed, stopped: false };
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

      if (f.identifier.toLowerCase() === 'size' && sectionId === 'product_details_data') {
        seenIds.add(f.identifier);
        return null;
      }
      __fieldSourceMap[f.identifier] = 1;
      __fieldSectionMap[f.identifier] = sectionId;
      seenIds.add(f.identifier);
      return {
        identifier: f.identifier,
        label: f.name,
        inputType: f.type.toLowerCase(),
        values: f.values || [],
        mandatory: !!f.mandatory
      };
    }

    const PRICING_IDS = ['meesho_price', 'product_mrp', 'only_wrong_return_price', 'inventory', 'supplier_sku_id'];

    if (__capturedProductFields) {
      const api = __capturedProductFields;

      if (api.product_details_data) {
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

      if (api.product_data) {
        const sec = getSection('product_data');
        api.product_data.forEach(f => {
          const mapped = mapApiField(f, 'product_data');
          if (mapped) sec.fields.push(mapped);
        });
      }

      if (api.other_data) {
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
          success: true, filled, stopped,
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

(() => {
  // Legacy optimizer is retained only for compatibility with older builds.
  // The subscription-aware implementation lives in js/shippingOptimizer.js.
  return;
  if (window.__meeshoIntegratedShippingOptimizer) return;
  if (window.__meeshoLowerShippingLoaded) return;
  window.__meeshoLowerShippingLoaded = true;

  const BOX_ID = "mls-lower-shipping-box";
  const OPTIONS_ID = "mls-options";
  const STATUS_ID = "mls-status";
  const CREDITS_ID = "mls-credits";
  const TARGET_SELECTOR = '[data-testid="bankSettlementContainer"]';
  const MAX_PRODUCTS = 100;
  const PAGE_SIZE = 20;
  const API_BASE = "https://codes-market.xyz";

  let shippingOptions = null;
  let draftInfo = null;
  let currentMeeshoPrice = null;
  let appliedShipping = null;
  let currentShippingValue = null;
  let creditsBalance = null;
  let creditsFetchInFlight = false;

  function normalizeCatalogDraft(detail = null) {
    const draft = detail && typeof detail === 'object' ? detail : {};
    const sscatId =
      draft.sscatId ??
      draft.sscat_id ??
      draft.sub_sub_category_id ??
      draft.subSubCategoryId ??
      draft.categoryId ??
      draft.category_id ??
      null;
    const supplierId =
      draft.supplierId ??
      draft.supplier_id ??
      draft.supplierID ??
      null;

    return {
      ...draft,
      sscatId: sscatId == null ? '' : String(sscatId),
      supplierId: supplierId == null ? '' : String(supplierId)
    };
  }

  async function getAuthToken() {
    try { const r=await chrome.runtime.sendMessage({type:'GET_FIREBASE_TOKEN'}); return r?.token||null; } catch (_) { return null; }
  }

  function openLowerShippingPricing() { window.dispatchEvent(new CustomEvent('__meesho_af_open_panel',{detail:{view:'pricing'}})); }

  function renderCreditsBadge() { const el=document.getElementById(CREDITS_ID); if(!el)return; el.textContent='AUTOFILL + SHIPPING ACTIVE'; el.classList.add('mls-credits--active'); }

  async function fetchCreditsBalance() { creditsBalance=0; renderCreditsBadge(); }

  async function consumeCredit() { return {ok:true,balance:0,status:'membership'}; }

  function setStatusOutOfCredits(statusEl) {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Subscription required — open plans';
    Object.assign(link.style, {
      color: '#dc2626', textDecoration: 'underline', fontWeight: '600', cursor: 'pointer'
    });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openLowerShippingPricing();
    });
    statusEl.appendChild(link);
  }

  function setStatusSignIn(statusEl) {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Shipping Optimizer is included with your active plan';
    Object.assign(link.style, {
      color: '#2563eb', textDecoration: 'underline', fontWeight: '600', cursor: 'pointer'
    });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('__meesho_af_open_panel', { detail: { view: 'login' } }));
    });
    statusEl.appendChild(link);
  }

  function applyShippingToBreakdown() {
    if (appliedShipping === null || currentMeeshoPrice == null) return;
    const container = document.querySelector(TARGET_SELECTOR);
    if (!container) return;

    const target = String(appliedShipping);

    const shippingP = [...container.querySelectorAll("p")].find(
      (p) =>
        p.textContent.includes("Shipping") &&
        p.textContent.includes("added separately")
    );
    if (!shippingP) return;

    if (shippingP.dataset.mlsApplied !== target) {
      shippingP.innerHTML = `Shipping&nbsp;(added separately)&nbsp;₹${appliedShipping}`;
      shippingP.dataset.mlsApplied = target;
    }

    const card = shippingP.parentElement;
    const h4 = card && card.querySelector("h4");
    if (h4 && h4.dataset.mlsApplied !== target) {
      h4.textContent = `₹${currentMeeshoPrice + appliedShipping}`;
      h4.dataset.mlsApplied = target;
    }
  }

  function getIdentifierFromUrl() {
    const m = location.pathname.match(/\/cataloging\/([^/]+)\//);
    return m ? m[1] : null;
  }

  function parseRupees(text) {
    const num = parseFloat(String(text || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function readBreakdown(container) {
    const out = { meeshoPrice: null, shipping: null };
    container.querySelectorAll("p").forEach((p) => {
      const txt = p.textContent.trim();
      if (txt.startsWith("Shipping")) out.shipping = parseRupees(txt);
      if (txt.startsWith("Meesho price")) {
        const sib = p.nextElementSibling;
        if (sib) out.meeshoPrice = parseRupees(sib.textContent);
      }
    });
    return out;
  }

  function renderOptions(box) {
    const list = box.querySelector(`#${OPTIONS_ID}`);
    const status = box.querySelector(`#${STATUS_ID}`);
    if (!list) return;

    if (!shippingOptions) {
      list.innerHTML = `<div class="mls-empty">Loading…</div>`;
      return;
    }
    if (shippingOptions.length === 0) {
      list.innerHTML = `<div class="mls-empty">No lookalike products found.</div>`;
      return;
    }

    list.innerHTML = shippingOptions
      .map(
        (o) => `
        <div class="mls-layout mls-layout--lower">
          <div class="mls-layout__label">Shipping</div>
          <div class="mls-layout__value">₹${o.shippingChargesAdjustment}</div>
          <button type="button" class="mls-btn"
                  data-amount="${o.shippingChargesAdjustment}"
                  data-pid="${o.hero_pid}">Apply</button>
        </div>`
      )
      .join("");

    list.querySelectorAll("button.mls-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const amount = btn.dataset.amount;
        const pid = parseInt(btn.dataset.pid, 10);
        if (!draftInfo || !draftInfo.sscatId || !draftInfo.supplierId) {
          setStatus(status, "Draft info not ready.", 'error');
          return;
        }
        if (!currentMeeshoPrice) {
          setStatus(status, "Meesho price not detected.", 'error');
          return;
        }

        btn.disabled = true;
        setStatus(status, "Checking subscription…");
        const credit = await consumeCredit();
        if (!credit.ok) {
          btn.disabled = false;
          if (credit.reason === 'insufficient')          setStatusOutOfCredits(status);
          else if (credit.reason === 'unauthenticated')  setStatusOutOfCredits(status);
          else                                           setStatus(status, "Subscription check failed — try again", 'error');

          if (status?.scrollIntoView) status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }

        setStatus(status, `Applying ₹${amount}…`);

        appliedShipping = parseInt(amount, 10);
        applyShippingToBreakdown();

        window.dispatchEvent(
          new CustomEvent("mls:set-pid", { detail: { pid } })
        );

        const requestId = `${Date.now()}-${Math.random()}`;
        const saveResultId = `${requestId}-save`;
        const onSaveResult = (ev) => {
          if (!ev.detail || ev.detail.requestId !== saveResultId) return;
          window.removeEventListener("mls:save-draft-result", onSaveResult);
        };
        window.addEventListener("mls:save-draft-result", onSaveResult);

        window.dispatchEvent(
          new CustomEvent("mls:save-draft", {
            detail: {
              requestId: saveResultId,
              identifier: getIdentifierFromUrl(),
              supplierId: draftInfo.supplierId,
            },
          })
        );

        const onResult = (ev) => {
          if (!ev.detail || ev.detail.requestId !== requestId) return;
          window.removeEventListener("mls:transfer-price-result", onResult);
          btn.disabled = false;
          if (ev.detail.ok) {
            setStatus(status, `Applied shipping ₹${amount}.`, 'success');
          } else {
            setStatus(status, `Failed (status ${ev.detail.status || "?"}).`, 'error');
          }
        };
        window.addEventListener("mls:transfer-price-result", onResult);

        window.dispatchEvent(
          new CustomEvent("mls:transfer-price", {
            detail: {
              requestId,
              identifier: getIdentifierFromUrl(),
              supplierId: draftInfo.supplierId,
              body: {
                sscat_id: draftInfo.sscatId,
                gst_percentage: 0,
                price: currentMeeshoPrice,
                supplier_id: draftInfo.supplierId,
                duplicate_pid: pid,
                gst_type: "GSTIN",
              },
            },
          })
        );
      });
    });
  }

  function buildBox(shipping) {
    const wrap = document.createElement("div");
    wrap.id = BOX_ID;

    wrap.innerHTML = `
      <div class="mls-header">
        <h5>Apply Lower Shipping</h5>
        <span id="${CREDITS_ID}" class="mls-credits">…</span>
      </div>
      <div class="mls-layout">
        <div class="mls-layout__label">Current shipping</div>
        <div class="mls-layout__value">₹${shipping}</div>
      </div>
      <p id="${STATUS_ID}" class="mls-status"></p>
      <div id="${OPTIONS_ID}"></div>
    `;
    renderOptions(wrap);
    renderCreditsBadge();
    fetchCreditsBalance();
    return wrap;
  }

  function findBankSettlementCard() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() !== 'Bank Settlement Breakdown') continue;
      let card = node.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!card) break;
        const hasMeesho = [...card.querySelectorAll('p')]
          .some(p => p.textContent.trim().startsWith('Meesho price'));
        if (hasMeesho) return card;
        card = card.parentElement;
      }
    }
    const matches = document.querySelectorAll(TARGET_SELECTOR);
    return matches[matches.length - 1] || null;
  }

  function inject() {
    const card = findBankSettlementCard();
    if (!card) return;
    const { meeshoPrice, shipping } = readBreakdown(card);
    if (shipping === null) return;
    currentMeeshoPrice = meeshoPrice;
    if (currentShippingValue === null) currentShippingValue = shipping;
    if (appliedShipping === null) appliedShipping = shipping;

    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = buildBox(shipping);
      card.insertAdjacentElement('afterend', box);
    } else if (box.previousElementSibling !== card) {

      card.insertAdjacentElement('afterend', box);
    }
    applyShippingToBreakdown();
  }

  window.addEventListener("mls:shipping-charges", (e) => {
    const sc = e && e.detail && e.detail.shipping_charges;
    if (sc == null || currentMeeshoPrice == null) return;
    appliedShipping = Number(sc);
    applyShippingToBreakdown();
  });

  inject();
  new MutationObserver(() => {
    inject();
    const card = findBankSettlementCard();
    if (card) {
      const { meeshoPrice } = readBreakdown(card);
      if (meeshoPrice !== null) currentMeeshoPrice = meeshoPrice;
    }
    applyShippingToBreakdown();
  }).observe(document.body, { childList: true, subtree: true });

  let lastSearchedUrl = null;
  window.addEventListener("mls:catalog-image", (e) => {
    const detail = normalizeCatalogDraft(e.detail || {});
    draftInfo = detail;
    const imageUrl = detail.imageUrl;
    if (!imageUrl || imageUrl === lastSearchedUrl) return;
    lastSearchedUrl = imageUrl;

    const vsId = `vs-${Date.now()}-${Math.random()}`;
    const onVisual = (vev) => {
      if (!vev.detail || vev.detail.requestId !== vsId) return;
      window.removeEventListener("mls:visual-search-result", onVisual);
      const response = vev.detail;

      const relativeUrl =
        response &&
        response.data &&
        response.data.images &&
        response.data.images[0] &&
        response.data.images[0].relative_url;
      if (!relativeUrl) return;

      const seen = new Map();
      let totalFetched = 0;

      function fetchPage(page, offset, cursor) {
        const psId = `ps-${Date.now()}-${Math.random()}`;
        const onProduct = (pev) => {
          if (!pev.detail || pev.detail.requestId !== psId) return;
          window.removeEventListener("mls:product-search-result", onProduct);
          const r2 = pev.detail;
          const data = r2 && r2.data;
          const catalogs = (data && data.catalogs) || [];
          totalFetched += catalogs.length;

          for (const c of catalogs) {
            let total = null;
            try {
              const meta =
                c && c.app_event_data && c.app_event_data.price_metadata;
              if (meta) {
                const decoded = JSON.parse(atob(meta));
                const sc = Number(decoded.shippingCharge) || 0;
                const adj = Number(decoded.shippingChargesAdjustment) || 0;
                total = sc + adj;
              }
            } catch (_) {}
            if (total === null) continue;
            if (!seen.has(total)) {
              seen.set(total, {
                hero_pid: c && c.hero_pid,
                shippingChargesAdjustment: total,
              });
            }
          }

          const rows = [...seen.values()].sort(
            (a, b) => a.shippingChargesAdjustment - b.shippingChargesAdjustment
          );
          shippingOptions = rows;
          const existing = document.getElementById(BOX_ID);
          if (existing) renderOptions(existing);

          const nextCursor =
            (data && (data.cursor || data.next_cursor)) || null;
          const moreLikely = catalogs.length === PAGE_SIZE || !!nextCursor;
          if (totalFetched < MAX_PRODUCTS && catalogs.length > 0 && moreLikely) {
            fetchPage(page + 1, offset + PAGE_SIZE, nextCursor);
          }
        };
        window.addEventListener("mls:product-search-result", onProduct);
        window.dispatchEvent(
          new CustomEvent("mls:product-search", {
            detail: {
              requestId: psId,
              imageUrl: relativeUrl,
              page,
              offset,
              limit: PAGE_SIZE,
              cursor,
            },
          })
        );
      }

      fetchPage(1, 0, null);
    };
    window.addEventListener("mls:visual-search-result", onVisual);
    window.dispatchEvent(
      new CustomEvent("mls:visual-search", {
        detail: { requestId: vsId, imageUrl },
      })
    );
  });
})();
