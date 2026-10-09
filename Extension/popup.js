
const API_BASE = 'https://codes-market.xyz';
let currentUser = null;
let selectedPlanId = null;

let currentProfileName = null;
let currentProfileMode = null;

let allScannedFieldIds = [];
let allAvailableSizes = [];
let MEASURE_FIELDS = [];
let currentSizes = [];
let __scanFieldValuesMap = {};
let currentScanResult = null;

const STANDARD_SIZE_CHART = {
  'XXS': { bust_size: '32', shoulder_size: '13', kurta_waist_size: '28', waist_size: '28', kurta_length_size: '40', length_size: '40', kurta_hip_size: '34', hip_size: '34', bottom_length_size: '36', bottom_waist_size: '26', bottom_hip_size: '34' },
  'XS': { bust_size: '34', shoulder_size: '14', kurta_waist_size: '30', waist_size: '30', kurta_length_size: '42', length_size: '42', kurta_hip_size: '36', hip_size: '36', bottom_length_size: '38', bottom_waist_size: '28', bottom_hip_size: '36' },
  'S': { bust_size: '36', shoulder_size: '14', kurta_waist_size: '32', waist_size: '32', kurta_length_size: '42', length_size: '42', kurta_hip_size: '38', hip_size: '38', bottom_length_size: '38', bottom_waist_size: '30', bottom_hip_size: '38' },
  'M': { bust_size: '38', shoulder_size: '15', kurta_waist_size: '34', waist_size: '34', kurta_length_size: '42', length_size: '42', kurta_hip_size: '40', hip_size: '40', bottom_length_size: '39', bottom_waist_size: '32', bottom_hip_size: '40' },
  'L': { bust_size: '40', shoulder_size: '15', kurta_waist_size: '36', waist_size: '36', kurta_length_size: '42', length_size: '42', kurta_hip_size: '42', hip_size: '42', bottom_length_size: '39', bottom_waist_size: '34', bottom_hip_size: '42' },
  'XL': { bust_size: '42', shoulder_size: '16', kurta_waist_size: '38', waist_size: '38', kurta_length_size: '42', length_size: '42', kurta_hip_size: '44', hip_size: '44', bottom_length_size: '40', bottom_waist_size: '36', bottom_hip_size: '44' },
  'XXL': { bust_size: '44', shoulder_size: '16', kurta_waist_size: '40', waist_size: '40', kurta_length_size: '42', length_size: '42', kurta_hip_size: '46', hip_size: '46', bottom_length_size: '40', bottom_waist_size: '38', bottom_hip_size: '46' },
  'XXXL': { bust_size: '46', shoulder_size: '17', kurta_waist_size: '42', waist_size: '42', kurta_length_size: '42', length_size: '42', kurta_hip_size: '48', hip_size: '48', bottom_length_size: '40', bottom_waist_size: '40', bottom_hip_size: '48' },
  '4XL': { bust_size: '48', shoulder_size: '17', kurta_waist_size: '44', waist_size: '44', kurta_length_size: '43', length_size: '43', kurta_hip_size: '50', hip_size: '50', bottom_length_size: '40', bottom_waist_size: '42', bottom_hip_size: '50' },
  '5XL': { bust_size: '50', shoulder_size: '18', kurta_waist_size: '46', waist_size: '46', kurta_length_size: '43', length_size: '43', kurta_hip_size: '52', hip_size: '52', bottom_length_size: '40', bottom_waist_size: '44', bottom_hip_size: '52' },
  '6XL': { bust_size: '52', shoulder_size: '18', kurta_waist_size: '48', waist_size: '48', kurta_length_size: '43', length_size: '43', kurta_hip_size: '54', hip_size: '54', bottom_length_size: '40', bottom_waist_size: '46', bottom_hip_size: '54' },
};

const PRICING_BROADCAST_IDS = ['meesho_price', 'product_mrp', 'only_wrong_return_price', 'inventory'];

const SIZE_KEY_MAP = {
  'kurta_length_size': 'kurta_length_size',
  'length_size': 'kurta_length_size',
  'size_length': 'kurta_length_size',
  'kurta_waist_size': 'kurta_waist_size',
  'waist_size': 'kurta_waist_size',
  'kurta_hip_size': 'kurta_hip_size',
  'hip_size': 'kurta_hip_size',
  'bust_size': 'bust_size',
  'shoulder_size': 'shoulder_size',
  'bottom_length_size': 'bottom_length_size',
  'bottom_waist_size': 'bottom_waist_size',
  'bottom_hip_size': 'bottom_hip_size'
};

function renderSizeCheckboxes(sizesArray, checkedSizes = []) {
  const container = document.getElementById('size-checkboxes');
  if (!container) return;
  if (!sizesArray || sizesArray.length === 0) {
    container.innerHTML = '<span style="color:#aaa;font-size:12px;margin-top:4px;">Scan form to load sizes...</span>';
    return;
  }
  container.innerHTML = '';
  sizesArray.forEach(sz => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    label.style.margin = '0';
    label.style.cursor = 'pointer';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = sz;
    cb.className = 'size-cb';
    if (checkedSizes.includes(sz)) cb.checked = true;

    cb.addEventListener('change', () => {
      const sel = Array.from(document.querySelectorAll('.size-cb:checked')).map(el => el.value);
      renderSizeMeasurements(sel.join(','));
    });

    label.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = sz;
    span.style.marginTop = '1px';
    label.appendChild(span);
    container.appendChild(label);
  });
}

function renderSizeMeasurements(sizesInput) {
  const sizes = (typeof sizesInput === 'string')
    ? sizesInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : sizesInput || [];

  const existingValues = {};
  currentSizes.forEach(sz => {
    MEASURE_FIELDS.forEach(f => {
      const el = document.getElementById(`${f.identifier || f.id}__${sz}`);
      if (el && el.value) existingValues[`${f.identifier || f.id}__${sz}`] = el.value;
    });
  });

  currentSizes = sizes;
  const section = document.getElementById('size-measure-section');
  const table = document.getElementById('size-measure-table');
  if (!section || !table) return;

  if (sizes.length === 0 || MEASURE_FIELDS.length === 0) {
    section.style.display = 'none';
    table.innerHTML = '';
    return;
  }
  section.style.display = 'block';

  let html = '';
  MEASURE_FIELDS.forEach(f => {
    const fid = f.identifier || f.id;
    if (f.values && f.values.length > 0) {
      html += `<datalist id="dl_measure_${fid}">`;
      f.values.forEach(v => { html += `<option value="${v}"></option>`; });
      html += `</datalist>`;
    }
  });

  html += `<div style="display:grid;grid-template-columns:38px repeat(${MEASURE_FIELDS.length},minmax(64px,1fr));gap:3px;margin-bottom:4px;">`;
  html += '<div></div>';
  MEASURE_FIELDS.forEach(f => {
    html += `<div style="text-align:center;font-size:10px;font-weight:600;color:#637381;">${f.label}</div>`;
  });
  html += '</div>';

  sizes.forEach(size => {
    html += `<div style="display:grid;grid-template-columns:38px repeat(${MEASURE_FIELDS.length},minmax(64px,1fr));gap:3px;margin-bottom:3px;">`;
    html += `<div style="font-size:11px;font-weight:700;color:#2563eb;padding-top:5px;">${size}</div>`;
    MEASURE_FIELDS.forEach(f => {
      const fid = f.identifier || f.id;
      const listAttr = (f.values && f.values.length > 0) ? `list="dl_measure_${fid}"` : '';
      html += `<input type="text" id="${fid}__${size}" placeholder="—" ${listAttr}
        style="width:100%;padding:4px 2px;border:1px solid #ddd;border-radius:4px;
               font-size:11px;text-align:center;box-sizing:border-box;" />`;
    });
    html += '</div>';
  });

  table.innerHTML = html;

  MEASURE_FIELDS.forEach(f => {
    const fid = f.identifier || f.id;
    if (f.values && f.values.length > 0) {
      __scanFieldValuesMap[fid] = f.values;
    }
  });

  sizes.forEach(sz => {
    const defaults = STANDARD_SIZE_CHART[sz] || {};
    MEASURE_FIELDS.forEach(f => {
      const fid = f.identifier || f.id;
      const key = `${fid}__${sz}`;
      const el = document.getElementById(key);
      if (!el) return;

      if (existingValues[key]) {
        el.value = existingValues[key];
      } else {
        let val = defaults[fid];
        if (!val) {
          const genericKey = SIZE_KEY_MAP[fid];
          if (genericKey) val = defaults[genericKey];
        }
        if (val) el.value = val;
      }
    });
  });
}

function getFormValues() {
  const values = {};
  allScannedFieldIds.forEach(id => {
    const el = document.getElementById(`f_${id}`);
    if (el) values[id] = el.value;
  });

  const selectedSizes = Array.from(document.querySelectorAll('.size-cb:checked')).map(el => el.value);
  if (selectedSizes.length > 0) values['_variation_sizes'] = selectedSizes.join(',');

  // Preserve every scanned field, including fields left blank.
  // This is required so export/import can reproduce the complete scanned form schema.
  allScannedFieldIds.forEach(id => {
    const key = id;
    if (!(key in values)) values[key] = '';
  });

  // Preserve every rendered size-table field, including blank cells.
  currentSizes.forEach(size => {
    MEASURE_FIELDS.forEach(f => {
      const fid = f.identifier || f.id;
      const key = `${fid}__${size}`;
      const el = document.getElementById(key);
      values[key] = el ? el.value.trim() : '';
    });
  });

  if (!('_variation_sizes' in values)) values['_variation_sizes'] = '';

  return values;
}

function validateFormValues(values) {
  const errors = [];
  const normV = (v) => (v || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  for (const [key, value] of Object.entries(values)) {
    if (!value || String(value).trim() === '') continue;

    const measureMatch = key.match(/^(.+)__([a-zA-Z0-9 .\-]+)$/);
    const identifier = measureMatch ? measureMatch[1] : key;
    const allowed = __scanFieldValuesMap[identifier];

    if (!allowed || allowed.length === 0) continue;

    const val = normV(String(value));
    const isValid = allowed.some(a => normV(a) === val) ||
                    allowed.some(a => normV(a).startsWith(val)) ||
                    allowed.some(a => normV(a).includes(val));

    if (!isValid) {

      const elId = measureMatch ? key : `f_${key}`;
      errors.push({ elId, identifier, value, allowed });
    }
  }
  return errors;
}

function resetForm(showNotification = true) {
  const container = document.getElementById('dynamic-sections-container');
  if (container) {
    container.innerHTML = '<div class="scan-placeholder" id="scan-placeholder">Click "Scan Meesho Form Fields" to load the form structure for this category.</div>';
  }
  allScannedFieldIds = [];
  allAvailableSizes = [];
  MEASURE_FIELDS = [];
  currentSizes = [];
  currentScanResult = null;

  chrome.storage.local.remove([
    'meesho_autofill_values',
    'last_scan_result'
  ], () => {
    if (showNotification) showStatus('Form data reset', 'success');
  });
}

function setFormValues(values) {
  if (!values) return;
  allScannedFieldIds.forEach(id => {
    const el = document.getElementById(`f_${id}`);
    if (el && values[id] !== undefined) el.value = values[id];
  });
  const variationSizeStr = values['_variation_sizes'] || '';
  const arr = variationSizeStr.split(',').map(s => s.trim()).filter(Boolean);
  if (allAvailableSizes.length > 0) renderSizeCheckboxes(allAvailableSizes, arr);
  else if (arr.length > 0) renderSizeCheckboxes(arr, arr);

  if (variationSizeStr) {
    renderSizeMeasurements(variationSizeStr);
    currentSizes.forEach(size => {
      MEASURE_FIELDS.forEach(f => {
        const fid = f.identifier || f.id;
        const key = `${fid}__${size}`;
        const el = document.getElementById(key);
        if (el && values[key] !== undefined) el.value = values[key];
      });
    });
  } else {
    renderSizeMeasurements('');
  }

  const errors = validateFormValues(values);
  const autofillBtn = document.getElementById('autofill-btn');
  if (autofillBtn) {
    autofillBtn.style.display = errors.length > 0 ? 'none' : 'block';
  }
}

function applyStaticValues(staticValuesObj) {
  for (const [id, values] of Object.entries(staticValuesObj)) {
    const el = document.getElementById('f_' + id);
    if (el && Array.isArray(values) && values.length > 0) {
      const listId = 'sys_dl_' + id;
      el.setAttribute('list', listId);
      let dl = document.getElementById(listId);
      if (!dl) {
        dl = document.createElement('datalist');
        dl.id = listId;
        el.parentNode.appendChild(dl);
      }
      dl.innerHTML = '';
      values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        dl.appendChild(opt);
      });
    }
  }
}

function renderStructuredForm(scanResult) {
  const container = document.getElementById('dynamic-sections-container');
  if (!container) return;

  container.innerHTML = '';
  currentScanResult = scanResult;
  allScannedFieldIds = [];
  allAvailableSizes = [];
  __scanFieldValuesMap = {};
  MEASURE_FIELDS = [];

  if (!scanResult || !scanResult.sections) {
    container.innerHTML = '<div class="scan-placeholder">No form structure found. Try scanning again.</div>';
    return;
  }

  scanResult.sections.forEach(section => {
    if (section.id === 'variations') {
      if (section.data && section.data.length > 0) {
        allAvailableSizes = section.data;
        renderSizeSection(container);
      }
    } else if (section.id === 'product_size_data') {
      if (section.fields && section.fields.length > 0) {
        MEASURE_FIELDS = section.fields;
        renderMeasurementSection(container);
      }

    } else if (section.fields && section.fields.length > 0) {
      renderFieldSection(container, section);
    }
  });

  if (scanResult.staticValues) applyStaticValues(scanResult.staticValues);

  // Restore values captured from the live Meesho page at scan time.
  // This means a form that was already filled remains filled in the profile.
  if (scanResult.capturedValues) {
    setTimeout(() => setFormValues(scanResult.capturedValues), 0);
  }

  chrome.storage.local.set({ last_scan_result: scanResult });
}

function renderFieldSection(container, section) {
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = section.label;
  container.appendChild(title);

  section.fields.forEach(f => {
    allScannedFieldIds.push(f.identifier);
    if (f.values && f.values.length > 0) {
      __scanFieldValuesMap[f.identifier] = f.values;
    }
    const row = document.createElement('div');
    row.className = 'field-row';

    const lbl = document.createElement('label');
    lbl.textContent = f.label + (f.mandatory ? ' *' : '');
    row.appendChild(lbl);

    let input;
    if (f.inputType === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = f.inputType === 'number' ? 'number' : 'text';
    }
    input.id = `f_${f.identifier}`;
    input.placeholder = `Enter ${f.label}`;

    if (f.values && f.values.length > 0) {
      const dlId = `dl_${f.identifier}`;
      input.setAttribute('list', dlId);
      const dl = document.createElement('datalist');
      dl.id = dlId;
      f.values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        dl.appendChild(opt);
      });
      row.appendChild(dl);
    }

    row.appendChild(input);
    container.appendChild(row);
  });
}

function renderSizeSection(container) {
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Size Selection';
  container.appendChild(title);

  const row = document.createElement('div');
  row.className = 'field-row';
  row.style.alignItems = 'flex-start';

  const lbl = document.createElement('label');
  lbl.textContent = 'Available Sizes';
  lbl.style.marginTop = '4px';
  row.appendChild(lbl);

  const cbContainer = document.createElement('div');
  cbContainer.id = 'size-checkboxes';
  cbContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:26px;';
  row.appendChild(cbContainer);

  container.appendChild(row);
  renderSizeCheckboxes(allAvailableSizes, []);
}

function renderMeasurementSection(container) {
  const section = document.createElement('div');
  section.id = 'size-measure-section';
  section.style.cssText = 'display:none;margin-bottom:2px;';

  const title = document.createElement('div');
  title.className = 'section-title';
  title.style.marginTop = '6px';
  title.innerHTML = 'Size Table <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#bbb;">— per row</span>';
  section.appendChild(title);

  const copyRow = document.createElement('label');
  copyRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0 6px;font-size:11px;color:#1c252e;cursor:pointer;user-select:none;';
  const copyCb = document.createElement('input');
  copyCb.type = 'checkbox';
  copyCb.id = 'size-copy-prices-cb';
  copyCb.style.cursor = 'pointer';
  copyCb.checked = true;
  const copyLbl = document.createElement('span');
  copyLbl.textContent = 'Copy price details to all sizes';
  copyRow.appendChild(copyCb);
  copyRow.appendChild(copyLbl);
  section.appendChild(copyRow);

  const table = document.createElement('div');
  table.id = 'size-measure-table';

  table.style.cssText = 'overflow-x:auto;';
  section.appendChild(table);

  container.appendChild(section);

  table.addEventListener('input', (e) => {
    if (!copyCb.checked) return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    const m = (t.id || '').match(/^(.+)__([^_]+)$/);
    if (!m) return;
    const fid = m[1];
    if (!PRICING_BROADCAST_IDS.includes(fid)) return;
    const value = t.value;
    currentSizes.forEach(sz => {
      const peer = document.getElementById(`${fid}__${sz}`);
      if (peer && peer !== t) peer.value = value;
    });
  });

  copyCb.addEventListener('change', () => {

    if (copyCb.checked && currentSizes.length > 1) {
      const firstSize = currentSizes[0];
      PRICING_BROADCAST_IDS.forEach(fid => {
        const source = document.getElementById(`${fid}__${firstSize}`);
        if (!source || !source.value) return;
        currentSizes.forEach(sz => {
          if (sz === firstSize) return;
          const peer = document.getElementById(`${fid}__${sz}`);
          if (peer) peer.value = source.value;
        });
      });
    }
  });
}

function showView(viewId) {
  const isPremiumView = viewId === 'fill' || viewId === 'profilesLanding';
  if (currentUser && isPremiumView && !hasAutofillAccess(currentUser)) {
    viewId = 'pricing';
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');

  const headerUser = document.getElementById('header-user');
  if (headerUser) {
    if (viewId === 'fill' && currentUser) {
      headerUser.textContent = `👤 ${currentUser.full_name}`;
    } else {
      headerUser.textContent = '';
    }
  }
}

function setPricingLogoutVisible(visible) {
  ['pricing-logout-btn', 'acc-logout-btn-pricing'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = visible ? '' : 'none';
  });
}

function showAuthStatus(message, type = 'info') {
  const statusMsg = document.getElementById('statusMsg');
  if (statusMsg) {
    statusMsg.textContent = message;
    statusMsg.style.color = type === 'error' ? '#fb7185' : type === 'success' ? '#4ade80' : '#60a5fa';
  }
  if (type === 'error') showStatus(message, 'error');
}

function showDeviceLocked(email = '') {
  const emailEl = document.getElementById('device-lock-email');
  if (emailEl) emailEl.textContent = email || 'Google account detected';
  showView('deviceLocked');
}

function buildUserState(user, membership = null, plan = null, reason = '') {
  const status = String(membership?.status || '').toUpperCase();
  const durationDays = Number(membership?.durationDays || plan?.durationDays || 0);
  const lifetime = durationDays === 0 || String(membership?.planId || '').toLowerCase() === 'lifetime';
  const expiry = membership?.expiryDate || null;
  const nowActive = status === 'ACTIVE' && (lifetime || (expiry && new Date(expiry).getTime() > Date.now()));
  const common = {
    active: nowActive,
    status: nowActive ? 'active' : (reason || 'not_found'),
    planType: membership?.planId || '',
    planLabel: membership?.planName || plan?.name || '',
    expiresAt: expiry
  };
  return {
    ...user,
    full_name: user?.full_name || user?.name || user?.displayName || user?.email || 'Google User',
    email: user?.email || '',
    uid: user?.uid || '',
    membershipStatus: nowActive ? 'ACTIVE' : (status || (reason === 'expired' ? 'EXPIRED' : 'NOT_ACTIVATED')),
    subscription_status: nowActive ? 'active' : (reason || 'not_activated'),
    subscription_reason: reason || '',
    planId: membership?.planId || '',
    planLabel: membership?.planName || plan?.name || '',
    durationDays,
    expiryDate: expiry,
    shippingEnabled: nowActive,
    products: {
      fill: { ...common },
      ship: { ...common }
    }
  };
}

function getProductSubscription(user, scope) {
  const expiry = user?.expiryDate || null;
  const active = hasMembershipAccess(user);
  return {
    active,
    status: active ? 'active' : (user?.membershipStatus === 'EXPIRED' ? 'expired' : 'not_found'),
    planType: user?.planId || '',
    planLabel: user?.planLabel || '',
    expiresAt: expiry
  };
}

function hasMembershipAccess(user, now = new Date()) {
  if (!user) return false;
  const status = String(user.membershipStatus || user.subscription_status || '').toLowerCase();
  if (status !== 'active') return false;
  const duration = Number(user.durationDays || 0);
  const expiry = user.expiryDate ? new Date(user.expiryDate).getTime() : 0;
  return duration === 0 || !expiry || expiry > now.getTime();
}

function hasProductAccess(user, scope, now = new Date()) {
  // Unified membership: one active plan enables both Autofill and Shipping Optimizer.
  return hasMembershipAccess(user, now);
}

function hasAutofillAccess(user, now = new Date()) {
  return hasProductAccess(user, 'fill', now);
}

function routeAfterAuth(user) {
  currentUser = user || null;
  setPricingLogoutVisible(!!currentUser);
  if (hasAutofillAccess(currentUser)) {
    enterLandingView();
    return;
  }
  loadPlans();
  updateAccountUI();
  showView('pricing');
}

async function checkAuth() {
  showView('checking');
  showAuthStatus('Checking Google account and membership…');
  try {
    const access = await chrome.runtime.sendMessage({ type: 'CHECK_MEMBERSHIP' });
    if (access?.user) currentUser = access.user;
    if (access?.allowed && access?.user) {
      updateAccountUI();
      routeAfterAuth(access.user);
      return;
    }

    if (access?.reason === 'device_locked') {
      showDeviceLocked(access?.user?.email || 'Google account');
      return;
    }

    if (access?.user) {
      updateAccountUI();
      setPricingLogoutVisible(true);
      loadPlans();
      showView('pricing');
      showAuthStatus(
        access?.reason === 'expired' ? 'Your membership has expired.' : 'Activate a membership to continue.',
        access?.reason === 'network' ? 'error' : 'info'
      );
    } else {
      setPricingLogoutVisible(false);
      showView('login');
      showAuthStatus(access?.error || 'Sign in with Google to continue.');
    }
  } catch (e) {
    setPricingLogoutVisible(false);
    showView('login');
    showAuthStatus(e.message || 'Authentication check failed.', 'error');
  }
}

async function signInWithGoogle() {
  const googleBtn = document.getElementById('googleSignInBtn');
  if (googleBtn) googleBtn.disabled = true;
  showAuthStatus('Opening Google sign-in…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_LOGIN' });
    if (result?.allowed && result?.user) {
      currentUser = result.user;
      showAuthStatus('Login successful.', 'success');
      routeAfterAuth(currentUser);
      return;
    }

    if (result?.user) {
      currentUser = result.user;
      updateAccountUI();
    }
    loadPlans();
    if (result?.reason === 'device_locked') showDeviceLocked(currentUser?.email || 'Google account');
    else showView('pricing');
    showAuthStatus(result?.error || 'Membership is not active.', result?.reason === 'error' ? 'error' : 'info');
  } catch (err) {
    showAuthStatus(err.message || 'Google login failed.', 'error');
  } finally {
    if (googleBtn) googleBtn.disabled = false;
  }
}

async function login() { return signInWithGoogle(); }
async function signup() { return signInWithGoogle(); }

const USER_SCOPED_LOCAL_KEYS = ['meesho_profiles','meesho_last_selected_profile','meesho_autofill_values','last_scan_result','shipping_user_info'];
async function clearUserScopedLocalCache() {
  await chrome.storage.local.remove(USER_SCOPED_LOCAL_KEYS);
  _profilesSyncedOnce = false;
}

async function logout() {
  await clearAuthState(true);
  location.reload();
}

async function clearAuthState(includeUserCache = true) {
  await chrome.runtime.sendMessage({ type: 'FIREBASE_LOGOUT' });
  if (includeUserCache) await clearUserScopedLocalCache();
  currentUser = null;
}

async function getFirebaseToken() {
  const r = await chrome.runtime.sendMessage({ type: 'GET_FIREBASE_TOKEN' });
  return r?.token || null;
}

const APP_NAME = 'MEESHO A+ LISTING AUTOMATION PRO';
const BRAND_NAME = 'Sohel Enterprise';
const SUPPORT_NAME = 'Sohel Rana';
let SUPPORT_WHATSAPP = '919064827025';
let SUPPORT_PHONE = '9064827025';
let SUPPORT_EMAIL = 'sohelenterpriseofficial@gmail.com';
let PLAN_CATALOG = [];

async function fetchFirebaseDoc(collectionName, docId) {
  const token = await getFirebaseToken();
  if (!token) return null;
  try {
    const res = await fetch(`${FIREBASE_BASE_URL()}/${collectionName}/${encodeURIComponent(docId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = await res.json();
    const out = {};
    for (const [k, v] of Object.entries(d.fields || {})) {
      out[k] = v.nullValue !== undefined ? null : v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? '';
    }
    return out;
  } catch (_) {
    return null;
  }
}

function FIREBASE_BASE_URL() {
  return 'https://firestore.googleapis.com/v1/projects/meesho-a-plus-listing-b5ea0/databases/(default)/documents';
}

async function loadPlanCatalogFromFirebase() {
  const ids = ['monthly', 'yearly', 'lifetime', 'combo-monthly', 'combo-yearly', 'combo-lifetime'];
  const rows = [];

  for (const id of ids) {
    const p = await fetchFirebaseDoc('plans', id);
    if (!p || p.active === false) continue;
    const scope = p.productScope || 'meesho'; // Treat pre-existing legacy plans as Meesho plans.
    if (!['meesho', 'combined'].includes(scope)) continue;
    const price = Math.max(0, Number(p.offerPrice || 0) || 0);
    const basePrice = Math.max(0, Number(p.price ?? 0) || 0);
    const displayPrice = price > 0 ? price : basePrice;
    if (displayPrice <= 0) continue;

    const durationDays = Math.max(0, Number(p.durationDays ?? 0) || 0);
    const included = Array.isArray(p.includedProducts) && p.includedProducts.length
      ? p.includedProducts
      : (scope === 'combined' ? ['meesho','flipkart'] : ['meesho']);
    rows.push({
      id,
      product: included.length > 1 ? 'MEESHO + FLIPKART' : 'MEESHO A+',
      title: p.name || id,
      desc: included.length > 1
        ? (durationDays === 0 ? 'Both extensions included with no expiry.' : `Meesho + Flipkart access for ${durationDays} days.`)
        : (durationDays === 0 ? 'Lifetime access with no expiry.' : `Meesho listing access for ${durationDays} days.`),
      includedProducts: included,
      price: displayPrice,
      basePrice,
      offerPrice: price || basePrice,
      durationDays,
      period: durationDays === 0 ? 'lifetime' : durationDays === 365 ? 'year' : 'month',
      accent: scope === 'combined' ? '#a855f7' : id === 'lifetime' ? '#f59e0b' : id === 'yearly' ? '#22c55e' : '#48a3ff',
      best: scope === 'combined' || id === 'yearly',
      shippingEnabled: true,
    });
  }

  PLAN_CATALOG = rows;
  return rows;
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadSupportSettings() {
  const settings = await fetchFirebaseDoc('settings', 'general');
  if (settings) {
    SUPPORT_WHATSAPP = String(settings.whatsapp || SUPPORT_WHATSAPP).replace(/\D/g, '');
    SUPPORT_PHONE = String(settings.phone || SUPPORT_PHONE).replace(/\D/g, '');
    SUPPORT_EMAIL = settings.email || SUPPORT_EMAIL;
    document.querySelectorAll('.support-footer__label').forEach(el => {
      el.textContent = `NEED HELP? · ${settings.supportName || SUPPORT_NAME} · ${settings.brandName || BRAND_NAME}`;
    });
  }
  document.querySelectorAll('.support-footer').forEach(footer => {
    const links = footer.querySelectorAll('.support-footer__link');
    if (links[0]) {
      links[0].textContent = `📱 ${SUPPORT_PHONE}`;
      links[0].href = `tel:+91${SUPPORT_PHONE}`;
    }
    if (links[1]) {
      links[1].href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`Hi ${SUPPORT_NAME}, I need help with ${APP_NAME}.`)}`;
    }
    if (links[2]) links[2].href = `mailto:${SUPPORT_EMAIL}`;
  });
}

function planWhatsAppMessage(plan) {
  const gmail = currentUser?.email || '';
  const duration = plan.durationDays === 0 ? 'Lifetime / Unlimited' : `${plan.durationDays} days`;
  return [
    `Hi ${SUPPORT_NAME},`,
    '',
    `I want to purchase ${plan.title} for ${APP_NAME}.`,
    `Gmail: ${gmail}`,
    `Plan: ${plan.title}`,
    `Price: ₹${plan.price}`,
    `Duration: ${duration}`,
    `Included Products: ${Array.isArray(plan.includedProducts) ? plan.includedProducts.join(' + ') : 'meesho'}`,
    `Shipping Optimizer: Included with this plan`,
    '',
    'Please send me the payment details.'
  ].join('\n');
}

async function openWhatsAppForPlan(plan) {
  if (!plan) return;
  await loadSupportSettings();
  const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(planWhatsAppMessage(plan))}`;
  const result = await chrome.runtime.sendMessage({ type: 'OPEN_WHATSAPP', url });
  if (!result?.ok) showStatus(result?.error || 'Could not open WhatsApp.', 'error');
}

function renderPlanCards(container, plans) {
  if (!container) return;
  if (!Array.isArray(plans) || plans.length === 0) {
    container.innerHTML = '<div class="plan-empty">Membership pricing is not published yet.</div>';
    return;
  }

  container.innerHTML = plans.map(plan => {
    const accent = plan.accent || '#48a3ff';
    const suffix = plan.period === 'lifetime' ? 'lifetime' : plan.period === 'year' ? 'yr' : 'mo';
    const best = plan.best ? '<div class="best-value-tag">Recommended</div>' : '';
    return `
      <div class="plan-card ${plan.best ? 'selected' : ''}" style="animation:none; border-color:${plan.best ? accent : '#2b4264'};">
        ${best}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="min-width:0;">
            <div style="font-size:10px;color:${accent};font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${escHtml(plan.product)}</div>
            <div class="plan-name">${escHtml(plan.title)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.35;">${escHtml(plan.desc)}</div>
          </div>
          <div class="plan-price" style="color:${accent};text-align:right;white-space:nowrap;">₹${plan.price}<span>/${suffix}</span></div>
        </div>
        <button type="button" class="select-plan-btn" data-plan-id="${escHtml(plan.id)}" style="margin-top:12px;width:100%;display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:10px;background:${plan.best ? 'linear-gradient(135deg,#22c55e,#16a34a)' : '#12203a'};border:1px solid ${plan.best ? '#22c55e' : '#2b4264'};color:#fff;font-size:12px;font-weight:900;cursor:pointer;">
          Buy ${escHtml(plan.title)} via WhatsApp
        </button>
      </div>
    `;
  }).join('');
}

function renderExpiredUpgradePlans() {
  const card = document.getElementById('expired-upgrade-card');
  if (card) card.style.display = 'none';
}

async function loadPlans() {
  const container = document.getElementById('plans-container');
  if (!container) return;
  const plans = await loadPlanCatalogFromFirebase();
  renderPlanCards(container, plans);
  renderExpiredUpgradePlans();
  await loadSupportSettings();
}

async function activateWithCode() {
  const input = document.getElementById('activation-code');
  const btn = document.getElementById('activate-membership-btn');
  const code = String(input?.value || '').trim().toUpperCase();
  if (!code) {
    showActivationStatus('Enter your activation code.', 'error');
    return;
  }
  if (btn) btn.disabled = true;
  showActivationStatus('Verifying activation code…', 'info');

  try {
    const result = await chrome.runtime.sendMessage({ type: 'ACTIVATE_MEMBERSHIP', code });
    if (!result?.ok) {
      showActivationStatus(result?.error || 'Activation failed.', 'error');
      return;
    }

    currentUser = result.access?.user || currentUser;
    updateAccountUI();
    showActivationStatus('Membership activated successfully.', 'success');
    setTimeout(() => routeAfterAuth(currentUser), 500);
  } catch (e) {
    showActivationStatus(e?.message || 'Activation failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showActivationStatus(message, type = 'info') {
  const el = document.getElementById('activation-status');
  if (!el) return;
  el.textContent = message || '';
  el.dataset.type = type;
}


function formatSubscriptionDate(value) {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms) || ms <= 0) return '';
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function productStatusView(product = {}) {
  const status = String(product.status || '').trim().toLowerCase();
  if (status === 'not_included') return { label: 'Not included', tone: 'neutral', metaLabel: 'Plan access' };
  if (status === 'revoked') return { label: 'Revoked', tone: 'blocked', metaLabel: 'Access ended' };
  if (status === 'suspended') return { label: 'Suspended', tone: 'blocked', metaLabel: 'Access blocked' };
  if (status === 'expired') return { label: 'Expired', tone: 'blocked', metaLabel: 'Expired on' };
  if (status === 'active') return { label: 'Active', tone: 'active', metaLabel: 'Valid till' };
  return { label: 'Not active', tone: 'neutral', metaLabel: 'Activate membership' };
}

function renderProductSubscription(prefix, idPart, product) {
  const card = document.getElementById(`${prefix}-${idPart}-card`);
  const statusEl = document.getElementById(`${prefix}-${idPart}-status`);
  const expiryEl = document.getElementById(`${prefix}-${idPart}-expiry`);
  if (!card || !statusEl || !expiryEl) return;

  const view = productStatusView(product);
  card.dataset.tone = view.tone;
  statusEl.textContent = view.label;
  statusEl.style.color = view.tone === 'active' ? '#86efac' : view.tone === 'blocked' ? '#fecaca' : '#cbd5e1';

  const expiryText = formatSubscriptionDate(product?.expiresAt);
  const lifetime = String(product?.planType || '').toLowerCase() === 'lifetime';
  if (lifetime) {
    expiryEl.textContent = 'Lifetime · No expiry';
  } else if (expiryText) {
    expiryEl.textContent = `${view.metaLabel}: ${expiryText}`;
  } else {
    expiryEl.textContent = view.tone === 'blocked' ? 'No valid expiry recorded' : view.metaLabel;
  }
}

function updateAccountUI() {
  if (!currentUser) return;

  const name = currentUser.full_name || currentUser.name || currentUser.email || 'Google User';
  const email = currentUser.email || '—';
  const active = hasAutofillAccess(currentUser);
  const shippingActive = hasProductAccess(currentUser, 'ship');
  const status = String(currentUser.membershipStatus || '').toUpperCase();
  const expiry = currentUser.expiryDate || null;
  const lifetime = Number(currentUser.durationDays || 0) === 0 || String(currentUser.planId || '').toLowerCase() === 'lifetime';

  document.getElementById('acc-name')?.replaceChildren(document.createTextNode(name));
  document.getElementById('acc-email-val')?.replaceChildren(document.createTextNode(email));

  renderProductSubscription('acc', 'autofill', currentUser.products?.fill || { status: active ? 'active' : String(currentUser.subscription_reason || 'not_found'), expiresAt: expiry, planType: currentUser.planId });
  renderProductSubscription('acc', 'shipping', currentUser.products?.ship || { status: shippingActive ? 'active' : (active ? 'not_included' : String(currentUser.subscription_reason || 'not_found')), expiresAt: expiry, planType: currentUser.planId });
  renderProductSubscription('pricing', 'autofill', currentUser.products?.fill || { status: active ? 'active' : String(currentUser.subscription_reason || 'not_found'), expiresAt: expiry, planType: currentUser.planId });
  renderProductSubscription('pricing', 'shipping', currentUser.products?.ship || { status: shippingActive ? 'active' : (active ? 'not_included' : String(currentUser.subscription_reason || 'not_found')), expiresAt: expiry, planType: currentUser.planId });

  const statusEl = document.getElementById('acc-plan-status');
  if (statusEl) {
    statusEl.textContent = active ? 'Membership Active' : status === 'EXPIRED' ? 'Membership Expired' : status === 'SUSPENDED' ? 'Membership Suspended' : status === 'REVOKED' ? 'Membership Revoked' : 'Membership Not Activated';
    statusEl.style.color = active ? '#22c55e' : '#f87171';
  }
  const expiryEl = document.getElementById('acc-expiry');
  if (expiryEl) {
    const expiryText = formatSubscriptionDate(expiry);
    expiryEl.textContent = lifetime
      ? 'Lifetime · No expiry'
      : (expiryText ? `Expires on: ${expiryText}` : 'Activate a membership to continue');
  }

  const pricingCard = document.getElementById('pricing-license-card');
  const eyebrow = document.getElementById('pricing-license-eyebrow');
  const title = document.getElementById('pricing-license-title');
  const note = document.getElementById('pricing-license-note');
  const badge = document.getElementById('pricing-license-badge');
  const nameEl = document.getElementById('pricing-license-name');
  const emailEl = document.getElementById('pricing-license-email');
  const expiryLabel = document.getElementById('pricing-license-expiry-label');
  const expiryText = document.getElementById('pricing-license-expiry');

  if (pricingCard) pricingCard.style.display = 'block';
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;

  if (active) {
    if (eyebrow) eyebrow.textContent = 'Membership active';
    if (title) title.textContent = `Your ${currentUser.planLabel || 'premium'} access is active`;
    if (note) note.textContent = shippingActive ? 'Autofill and Shipping Optimizer are included.' : 'Autofill is active. Shipping Optimizer is not included in this plan.';
    if (badge) { badge.textContent = 'ACTIVE'; badge.style.color = '#bbf7d0'; badge.style.background = 'rgba(22,101,52,.18)'; badge.style.borderColor = 'rgba(34,197,94,.35)'; }
    if (expiryLabel) expiryLabel.textContent = lifetime ? 'Membership' : 'Valid till';
    if (expiryText) expiryText.textContent = lifetime ? 'Lifetime · No expiry' : (formatSubscriptionDate(expiry) || 'Activation date not recorded');
  } else if (status === 'EXPIRED') {
    if (eyebrow) eyebrow.textContent = 'Membership expired';
    if (title) title.textContent = 'Your premium access has ended';
    if (note) note.textContent = 'Choose a plan below or enter a new activation code.';
    if (badge) { badge.textContent = 'EXPIRED'; badge.style.color = '#fecaca'; badge.style.background = 'rgba(127,29,29,.22)'; badge.style.borderColor = 'rgba(248,113,113,.34)'; }
    if (expiryLabel) expiryLabel.textContent = 'Expired on';
    if (expiryText) expiryText.textContent = formatSubscriptionDate(expiry) || 'Expiry not recorded';
  } else if (status === 'SUSPENDED') {
    if (eyebrow) eyebrow.textContent = 'Membership suspended';
    if (title) title.textContent = 'Your premium access is suspended';
    if (note) note.textContent = 'Contact Sohel Enterprise to restore access.';
    if (badge) { badge.textContent = 'SUSPENDED'; badge.style.color = '#fde68a'; badge.style.background = 'rgba(120,53,15,.22)'; badge.style.borderColor = 'rgba(251,191,36,.34)'; }
    if (expiryLabel) expiryLabel.textContent = 'Status';
    if (expiryText) expiryText.textContent = 'Contact support';
  } else if (status === 'REVOKED') {
    if (eyebrow) eyebrow.textContent = 'Membership revoked';
    if (title) title.textContent = 'Your premium access was revoked';
    if (note) note.textContent = 'Contact Sohel Enterprise to restore access.';
    if (badge) { badge.textContent = 'REVOKED'; badge.style.color = '#fecaca'; badge.style.background = 'rgba(127,29,29,.22)'; badge.style.borderColor = 'rgba(248,113,113,.34)'; }
    if (expiryLabel) expiryLabel.textContent = 'Status';
    if (expiryText) expiryText.textContent = 'Contact support';
  } else {
    if (eyebrow) eyebrow.textContent = 'Membership required';
    if (title) title.textContent = 'Activate your premium access';
    if (note) note.textContent = 'Choose a plan below or enter the activation code sent by Sohel Enterprise.';
    if (badge) { badge.textContent = 'NOT ACTIVATED'; badge.style.color = '#bfdbfe'; badge.style.background = 'rgba(37,99,235,.18)'; badge.style.borderColor = 'rgba(96,165,250,.34)'; }
    if (expiryLabel) expiryLabel.textContent = 'Status';
    if (expiryText) expiryText.textContent = 'No membership yet';
  }

  const upgradeCard = document.getElementById('expired-upgrade-card');
  if (upgradeCard) upgradeCard.style.display = 'none';
}

function showStatus(msg, type = 'success') {
  const s = document.getElementById('status');
  s.textContent = msg;
  s.className = 'status ' + type;
  setTimeout(() => { s.className = 'status'; }, 3500);
}

function getActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) { cb(null); return; }
    cb(tabs[0]);
  });
}

const MEESHO_ADD_CATALOG_URL = 'https://supplier.meesho.com/panel/v3/new/catalogs/single/add';

function isPanelMode() {
  return new URLSearchParams(location.search).get('panel') === '1';
}

function sendOpenSidePanel(tabId, cb) {
  const send = () => {
    chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDE_PANEL' }, () => {
      if (!chrome.runtime.lastError) {
        cb(true);
        return;
      }

      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            cb(false);
            return;
          }
          chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDE_PANEL' }, () => {
            cb(!chrome.runtime.lastError);
          });
        }
      );
    });
  };
  send();
}

function waitForTabReady(tabId, cb) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
    cb();
  };
  const listener = (updatedTabId, changeInfo) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
  };
  chrome.tabs.onUpdated.addListener(listener);
  setTimeout(finish, 4500);
}

function openMeeshoPanelFromPopup() {
  const btn = document.getElementById('btn-open-meesho-panel');
  const originalText = btn?.querySelector('span:last-child')?.textContent || 'Open Meesho Panel';
  const setBusy = (busy, text = originalText) => {
    if (!btn) return;
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.78' : '1';
    const label = btn.querySelector('span:last-child');
    if (label) label.textContent = text;
  };
  const finish = (ok, msg) => {
    setBusy(false);
    showStatus(msg, ok ? 'success' : 'error');
    if (ok && !isPanelMode()) setTimeout(() => window.close(), 300);
  };

  setBusy(true, 'Opening...');

  getActiveTab(tab => {
    const openOnTab = tabId => {
      waitForTabReady(tabId, () => {
        sendOpenSidePanel(tabId, ok => {
          finish(ok, ok ? 'Meesho panel opened' : 'Open the Meesho add page, then try again');
        });
      });
    };

    if (!tab?.id || !tab.url || !tab.url.includes('supplier.meesho.com')) {
      chrome.tabs.create({ url: MEESHO_ADD_CATALOG_URL, active: true }, createdTab => {
        if (chrome.runtime.lastError || !createdTab?.id) {
          finish(false, 'Could not open Meesho page');
          return;
        }
        openOnTab(createdTab.id);
      });
      return;
    }

    if (!tab.url.includes('catalogs/single/add')) {
      chrome.tabs.update(tab.id, { url: MEESHO_ADD_CATALOG_URL, active: true }, updatedTab => {
        if (chrome.runtime.lastError || !updatedTab?.id) {
          finish(false, 'Could not open Meesho add page');
          return;
        }
        openOnTab(updatedTab.id);
      });
      return;
    }

    sendOpenSidePanel(tab.id, ok => {
      finish(ok, ok ? 'Meesho panel opened' : 'Refresh the Meesho page, then try again');
    });
  });
}


document.addEventListener('click', async event => {
  const btn = event.target.closest('.select-plan-btn');
  if (!btn) return;
  const plan = PLAN_CATALOG.find(x => x.id === btn.dataset.planId);
  if (!plan) return;
  try {
    await openWhatsAppForPlan(plan);
  } catch (e) {
    showStatus(e?.message || 'Could not open WhatsApp.', 'error');
  }
});

document.addEventListener('DOMContentLoaded', () => {

  chrome.storage.local.get('meesho_profiles', res => {
    const profiles = res.meesho_profiles;
    if (!profiles || typeof profiles !== 'object') return;
    let changed = false;
    for (const [name, p] of Object.entries(profiles)) {
      if (!p || typeof p !== 'object') continue;
      if ('last_scan_result' in p || 'sub_sub_category_id' in p) {
        profiles[name] = { values: p.values || {} };
        changed = true;
      }
    }
    if (changed) chrome.storage.local.set({ meesho_profiles: profiles });
  });

  checkAuth();

  chrome.storage.local.get(['last_scan_result', 'meesho_autofill_values'], (res) => {
    if (res.last_scan_result) {
      renderStructuredForm(res.last_scan_result);
      if (res.meesho_autofill_values) {

        setTimeout(() => setFormValues(res.meesho_autofill_values), 100);
      }
    }
  });
});

document.getElementById('scan-btn')?.addEventListener('click', async () => {
  const gate = await chrome.runtime.sendMessage({type:'GET_ACCESS'}); if(!gate?.allowed){showView('pricing');showStatus('Active membership required.','error');return;}
  const scanStatus = document.getElementById('scan-status');
  if (scanStatus) scanStatus.innerHTML = '<span style="color:#2563eb;">Scanning platform...</span>';

  resetForm(false);

  getActiveTab(tab => {
    if (!tab || !tab.url) {
      if (scanStatus) scanStatus.innerHTML = '<span style="color:#e74c3c;">⚠️ Extension error - no active tab.</span>';
      return;
    }

    if (!tab.url.includes('supplier.meesho.com')) {
      if (scanStatus) scanStatus.textContent = '⚠️ Open the Meesho portal first.';
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FORM' }, response => {
      if (chrome.runtime.lastError) {
        if (scanStatus) scanStatus.textContent = '⚠️ Page not ready — refresh the Meesho page (F5) and try again.';
        return;
      }
      if (!response) {
        if (scanStatus) scanStatus.textContent = '⚠️ No response from page. Refresh and try again.';
        return;
      }
      if (response.error) {
        if (scanStatus) scanStatus.textContent = `⚠️ Scan error: ${response.error}`;
        return;
      }

      renderStructuredForm(response);
      if (scanStatus) scanStatus.innerHTML = `<span style="color:#2ecc71;">Scan complete!</span>`;
    });
  });
});

document.getElementById('reset-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (confirm('Are you sure you want to clear all form data?')) {
    resetForm(true);
  }
});

document.getElementById('save-btn')?.addEventListener('click', () => {
  const values = getFormValues();
  const errors = validateFormValues(values);

  document.querySelectorAll('.validation-error').forEach(el => {
    el.style.border = '';
    el.classList.remove('validation-error');
  });
  document.querySelectorAll('.validation-error-msg').forEach(el => el.remove());

  const autofillBtn = document.getElementById('autofill-btn');
  if (errors.length > 0) {
    if (autofillBtn) autofillBtn.style.display = 'none';
    errors.forEach(err => {
      const el = document.getElementById(err.elId);
      if (el) {
        el.style.border = '2px solid #e74c3c';
        el.classList.add('validation-error');
      }
    });
    showStatus(`⚠ ${errors.length} field(s) invalid. Fix highlighted fields.`, 'error');
  } else {
    if (autofillBtn) autofillBtn.style.display = 'block';
  }

  const isValid = errors.length === 0;
  chrome.storage.local.set({
    meesho_autofill_values: values,
    meesho_autofill_valid: isValid
  });

  if (currentProfileName) {
    chrome.storage.local.get(['meesho_profiles'], result => {
      const profiles = result.meesho_profiles || {};
      const newProfile = {
        values,
        scan_result: currentScanResult || null
      };
      profiles[currentProfileName] = newProfile;
      chrome.storage.local.set({
        meesho_profiles: profiles,

        meesho_last_selected_profile: currentProfileName
      }, () => {

        pushProfileToBackend(currentProfileName, newProfile);
        if (errors.length === 0) {
          const savedName = currentProfileName;
          enterLandingView();
          showStatus(`Profile "${savedName}" saved! ✓`);
        }
      });
    });
  } else if (errors.length === 0) {
    showStatus('Values saved! ✓ All values valid.');
  }
});

document.getElementById('autofill-btn')?.addEventListener('click', async () => {
  const gate = await chrome.runtime.sendMessage({type:'GET_ACCESS'}); if(!gate?.allowed){showView('pricing');showStatus('Active membership required.','error');return;}
  const values = getFormValues();
  chrome.storage.local.set({ meesho_autofill_values: values }, () => {
    getActiveTab(tab => {
      if (!tab) { showStatus('No active tab found', 'error'); return; }
      if (!tab.url || !tab.url.includes('supplier.meesho.com')) {
        showStatus('Please open the Meesho supplier portal first', 'error');
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', values }, response => {
        if (chrome.runtime.lastError) {
          showStatus('Could not reach page. Try refreshing.', 'error');
          return;
        }
        if (response && response.success) {
          showStatus(`Filled ${response.filled} field(s) successfully!`);
        } else {
          showStatus(response?.message || 'Could not fill form', 'error');
        }
      });
    });
  });
});

const AUTOFILL_PLATFORM = 'meesho';

let _profilesSyncedOnce = false;

async function authHeaders() { const token = await getFirebaseToken(); return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' } : null; }

async function syncProfilesFromBackend(force = false) {
  if (!force && _profilesSyncedOnce) return;
  const headers = await authHeaders();
  if (!headers) return;
  try {
    const listResp = await fetch(
      `${API_BASE}/api/autofill/profiles?platform=${AUTOFILL_PLATFORM}`,
      { headers }
    );
    if (!listResp.ok) return;
    const { profiles: serverList = [] } = await listResp.json();

    const local = (await chrome.storage.local.get(['meesho_profiles']))
      .meesho_profiles || {};

    const serverNames = new Set(serverList.map(p => p.name));
    const localOnly = {};
    for (const [name, p] of Object.entries(local)) {
      if (!serverNames.has(name) && p && p.values) {
        localOnly[name] = { values: p.values || {} };
      }
    }
    let finalList = serverList;
    if (Object.keys(localOnly).length) {
      const syncResp = await fetch(
        `${API_BASE}/api/autofill/profiles/sync?platform=${AUTOFILL_PLATFORM}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ profiles: localOnly }),
        }
      );
      if (syncResp.ok) {
        const data = await syncResp.json();
        if (Array.isArray(data.profiles)) finalList = data.profiles;
      }
    }

    const merged = {};
    for (const p of finalList) {
      const localProfile = local[p.name] || {};
      merged[p.name] = {
        values: p.values || localProfile.values || {},
        scan_result: localProfile.scan_result || localProfile.last_scan_result || p.scan_result || null,
      };
    }
    await chrome.storage.local.set({ meesho_profiles: merged });
    _profilesSyncedOnce = true;
    populateProfileDropdown();
  } catch (_) {

  }
}

async function pushProfileToBackend(name, profile) {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    await fetch(
      `${API_BASE}/api/autofill/profiles/${encodeURIComponent(name)}?platform=${AUTOFILL_PLATFORM}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          values: profile.values || {},
        }),
      }
    );
  } catch (_) {}
}

async function deleteProfileOnBackend(name) {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    await fetch(
      `${API_BASE}/api/autofill/profiles/${encodeURIComponent(name)}?platform=${AUTOFILL_PLATFORM}`,
      {
        method: 'DELETE',
        headers,
      }
    );
  } catch (_) {}
}

function enterLandingView() {
  if (!currentUser || !hasAutofillAccess(currentUser)) {
    loadPlans();
    setPricingLogoutVisible(!!currentUser);
    updateAccountUI();
    showView('pricing');
    return;
  }

  currentProfileName = null;
  currentProfileMode = null;
  setProfileContextBar();
  populateProfileDropdown();
  showView('profilesLanding');
  updateAccountUI();

  syncProfilesFromBackend();
}

function setProfileSelection(name) {
  const hidden = document.getElementById('profile-select');
  const label = document.getElementById('profile-dropdown-label');
  const actions = document.getElementById('profile-actions');
  if (hidden) hidden.value = name || '';
  if (label) {
    label.textContent = name || 'Select a profile...';
    label.style.color = name ? '#e2e8f0' : '#94a3b8';
  }
  if (actions) actions.style.display = name ? 'flex' : 'none';
  chrome.storage.local.set({ meesho_last_selected_profile: name || null });
}

function closeProfileDropdownMenu() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

function populateProfileDropdown() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (!menu) return;
  chrome.storage.local.get(['meesho_profiles', 'meesho_last_selected_profile'], result => {
    const profiles = result.meesho_profiles || {};
    const names = Object.keys(profiles);
    const lastSelected = result.meesho_last_selected_profile;

    menu.innerHTML = '';
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No profiles yet';
      empty.style.cssText = 'padding:12px 14px; font-size:12px; color:#637381; text-align:center;';
      menu.appendChild(empty);
    } else {
      names.forEach(n => {
        const item = document.createElement('div');
        item.dataset.name = n;
        item.textContent = n;
        item.style.cssText = 'padding:10px 14px; font-size:13px; color:#e2e8f0; cursor:pointer; border-bottom:1px solid rgba(148,163,184,0.16);';
        item.addEventListener('mouseenter', () => { item.style.background = '#12203a'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
        item.addEventListener('click', () => {
          setProfileSelection(n);
          closeProfileDropdownMenu();
        });
        menu.appendChild(item);
      });
      menu.lastChild.style.borderBottom = 'none';
    }

    if (lastSelected && profiles[lastSelected]) {
      setProfileSelection(lastSelected);
    } else {
      setProfileSelection('');
    }
  });
}

function setProfileContextBar() {
  const bar = document.getElementById('profile-context-bar');
  const modeLabel = document.getElementById('profile-context-mode');
  const nameLabel = document.getElementById('profile-context-name');
  if (!bar) return;

  bar.style.display = 'flex';
  if (currentProfileName) {
    modeLabel.textContent = currentProfileMode === 'recording' ? 'Recording:' : 'Editing:';
    nameLabel.textContent = ' ' + currentProfileName;
  } else {
    modeLabel.textContent = 'Back to Profiles';
    nameLabel.textContent = '';
  }

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.textContent = currentProfileName ? '💾 Save Profile' : '💾 Save Values';
  }
}

function enterRecordingMode(name) {
  currentProfileName = name;
  currentProfileMode = 'recording';

  resetForm(false);
  setProfileContextBar();
  showView('fill');
}

function enterEditMode(name) {
  chrome.storage.local.get(['meesho_profiles'], result => {
    const profiles = result.meesho_profiles || {};
    const profile = profiles[name];
    if (!profile) { showStatus('Profile not found', 'error'); return; }

    const values = profile.values || profile;
    const savedScanResult = profile.scan_result || profile.last_scan_result || null;

    getActiveTab(tab => {
      if (!tab || !tab.url || !tab.url.includes('supplier.meesho.com')) {
        showStatus('Open a Meesho catalog page to edit this profile', 'error');
        return;
      }
      if (!tab.url.includes('catalogs/single/add')) {
        showStatus('Open the Meesho "Add Catalog" page first, then retry edit', 'error');
        return;
      }

      const renderAndLoad = (scanResult) => {
        if (!scanResult) {
          showStatus('Saved form structure is missing. Scan the Meesho form again, then save this profile.', 'error');
          return;
        }

        currentProfileName = name;
        currentProfileMode = 'editing';
        renderStructuredForm(scanResult);
        setProfileContextBar();
        showView('fill');
        setTimeout(() => {
          setFormValues(values);
          showStatus(`Editing profile "${name}"`);
        }, 50);
      };

      if (savedScanResult) {
        renderAndLoad(savedScanResult);
      } else {
        chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FORM' }, scanResult => {
          if (chrome.runtime.lastError || !scanResult) {
            showStatus('Could not reach page. Refresh and try again.', 'error');
            return;
          }
          renderAndLoad(scanResult);
        });
      }
    });
  });
}

document.getElementById('btn-record-new-profile')?.addEventListener('click', () => {
  const name = (prompt('Profile name?') || '').trim();
  if (!name) return;
  chrome.storage.local.get(['meesho_profiles'], result => {
    const profiles = result.meesho_profiles || {};
    if (profiles[name]) {
      if (!confirm(`Profile "${name}" already exists. Overwrite when you save?`)) return;

      enterEditMode(name);
      return;
    }
    enterRecordingMode(name);
  });
});

document.getElementById('profile-dropdown-trigger')?.addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('profile-dropdown-menu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('click', e => {
  const dd = document.getElementById('profile-dropdown');
  if (dd && !dd.contains(e.target)) closeProfileDropdownMenu();
});

document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
  const name = document.getElementById('profile-select')?.value;
  if (!name) return;
  enterEditMode(name);
});

document.getElementById('btn-run-profile')?.addEventListener('click', () => {
  const name = document.getElementById('profile-select')?.value;
  if (!name) return;
  chrome.storage.local.get(['meesho_profiles'], result => {
    const profiles = result.meesho_profiles || {};
    const profile = profiles[name];
    if (!profile) { showStatus('Profile not found', 'error'); return; }
    const values = profile.values || profile;

    chrome.storage.local.set({ meesho_autofill_values: values });

    getActiveTab(tab => {
      if (!tab || !tab.url || !tab.url.includes('supplier.meesho.com')) {
        showStatus('Please open the Meesho supplier portal first', 'error');
        return;
      }
      if (!tab.url.includes('catalogs/single/add')) {
        showStatus('Open the Meesho "Add Catalog" page to run this profile', 'error');
        return;
      }

      if (new URLSearchParams(location.search).get('panel') === '1') {
        window.parent.postMessage({ type: '__meesho_af_close_panel' }, '*');
      }
      chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', values }, () => {

        void chrome.runtime.lastError;
      });
    });
  });
});

document.getElementById('btn-delete-profile')?.addEventListener('click', () => {
  const name = document.getElementById('profile-select')?.value;
  if (!name) return;
  if (!confirm(`Delete profile "${name}"?`)) return;
  chrome.storage.local.get(['meesho_profiles', 'meesho_last_selected_profile'], result => {
    const profiles = result.meesho_profiles || {};
    delete profiles[name];
    const patch = { meesho_profiles: profiles };
    if (result.meesho_last_selected_profile === name) patch.meesho_last_selected_profile = null;
    chrome.storage.local.set(patch, () => {
      deleteProfileOnBackend(name);
      showStatus(`Profile "${name}" deleted`);
      populateProfileDropdown();
    });
  });
});

document.getElementById('btn-back-to-landing')?.addEventListener('click', () => {
  enterLandingView();
});

document.getElementById('btn-landing-import')?.addEventListener('click', () => {
  document.getElementById('landing-import-file-input')?.click();
});

document.getElementById('btn-open-meesho-panel')?.addEventListener('click', openMeeshoPanelFromPopup);

document.getElementById('btn-landing-export')?.addEventListener('click', () => {
  chrome.storage.local.get('meesho_profiles', result => {
    const profiles = result.meesho_profiles || {};
    if (Object.keys(profiles).length === 0) {
      showStatus('No profiles to export!', 'error');
      return;
    }

    const lean = {};
    for (const [name, p] of Object.entries(profiles)) {
      lean[name] = {
        values: p.values || (p.last_scan_result ? {} : p),
        scan_result: p.scan_result || p.last_scan_result || null,
      };
    }
    const blob = new Blob([JSON.stringify(lean, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `meesho_profiles_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Profiles exported!');
  });
});

document.getElementById('landing-import-file-input')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (typeof imported !== 'object') throw new Error('Invalid format');
      chrome.storage.local.get('meesho_profiles', result => {
        const merged = { ...(result.meesho_profiles || {}), ...imported };
        chrome.storage.local.set({ meesho_profiles: merged }, async () => {
          showStatus(`Imported ${Object.keys(imported).length} profiles!`);

          const headers = await authHeaders();
          if (headers) {
            try {
              await fetch(
                `${API_BASE}/api/autofill/profiles/sync?platform=${AUTOFILL_PLATFORM}`,
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ profiles: imported }),
                }
              );
            } catch (_) {}
          }
          populateProfileDropdown();
          e.target.value = '';
        });
      });
    } catch (_) {
      showStatus('Failed to import: Invalid JSON file', 'error');
    }
  };
  reader.readAsText(file);
});

if (new URLSearchParams(location.search).get('panel') === '1') {
  document.body.classList.add('panel-mode');
  const openPanelBtn = document.getElementById('btn-open-meesho-panel');
  if (openPanelBtn) openPanelBtn.style.display = 'none';
  document.getElementById('btn-close-panel')?.addEventListener('click', () => {
    window.parent.postMessage({ type: '__meesho_af_close_panel' }, '*');
  });
}

async function tryRouteToRequestedView(viewId) {
  if (!viewId) return;

  if (viewId === 'lowerShippingPricing') {
    showView('pricing');
    loadPlans();
    setPricingLogoutVisible(!!currentUser);
  } else if (viewId === 'profilesLanding') {
    if (!currentUser) {
      await checkAuth();
      return;
    }
    enterLandingView();
  } else if (viewId === 'signup') {
    showView('login');
  } else if (['login', 'pricing', 'fill'].includes(viewId)) {
    if (viewId === 'fill' && currentUser && !hasAutofillAccess(currentUser)) {
      showView('pricing');
      return;
    }
    if (viewId === 'pricing') setPricingLogoutVisible(!!currentUser);
    showView(viewId);
  }
}

const _requestedView = new URLSearchParams(location.search).get('view');
if (_requestedView) {
  setTimeout(() => tryRouteToRequestedView(_requestedView), 600);
}

window.addEventListener('message', (e) => {
  if (e?.data?.type === '__meesho_af_set_view') {
    tryRouteToRequestedView(e.data.view);
  }
});

document.getElementById('googleSignInBtn')?.addEventListener('click', signInWithGoogle);
document.getElementById('activate-membership-btn')?.addEventListener('click', activateWithCode);
document.getElementById('activation-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); activateWithCode(); } });

function submitOnEnter(inputIds, btnId) {
  inputIds.forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById(btnId)?.click();
      }
    });
  });
}
document.getElementById('acc-logout-btn')?.addEventListener('click', logout);
document.getElementById('acc-logout-btn-pricing')?.addEventListener('click', logout);
document.getElementById('pricing-logout-btn')?.addEventListener('click', logout);
document.getElementById('device-lock-logout-btn')?.addEventListener('click', logout);

document.getElementById('btn-ls-back-to-fill')?.addEventListener('click', () => showView('fill'));




// V3.6 — user-initiated clipboard paste helper.
// Reads the clipboard only after the customer explicitly clicks PASTE.
const pasteActivationBtn = document.getElementById('paste-activation-btn');
const activationCodeInput = document.getElementById('activation-code');

if (pasteActivationBtn && activationCodeInput) {
  pasteActivationBtn.addEventListener('click', async () => {
    const original = pasteActivationBtn.textContent;
    pasteActivationBtn.disabled = true;
    pasteActivationBtn.textContent = 'PASTE…';

    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('Clipboard access is not available.');
      }

      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        throw new Error('Clipboard is empty.');
      }

      activationCodeInput.value = text.toUpperCase();
      activationCodeInput.dispatchEvent(new Event('input', { bubbles: true }));
      activationCodeInput.focus();

      const status = document.getElementById('activation-status');
      if (status) {
        status.dataset.type = 'success';
        status.textContent = 'Activation key pasted from clipboard.';
      }
    } catch (error) {
      console.warn('[Activation Paste]', error);

      const status = document.getElementById('activation-status');
      if (status) {
        status.dataset.type = 'error';
        status.textContent = 'Paste failed. Copy the key and try again.';
      }
    } finally {
      setTimeout(() => {
        pasteActivationBtn.disabled = false;
        pasteActivationBtn.textContent = original;
      }, 650);
    }
  });
}

