(() => {
  if (window.__meeshoIntegratedShippingOptimizer) return;
  window.__meeshoIntegratedShippingOptimizer = true;

  const BOX_ID = 'mls-lower-shipping-box';
  const STATUS_ID = 'mls-status';
  const RESULTS_ID = 'mls-optimizer-results';
  const PLAN_ID = 'mls-plan-status';
  const TARGET_SELECTOR = '[data-testid="bankSettlementContainer"]';
  const SHIPPING_USER_KEY = 'shipping_user_info';
  const PRODUCT_NAME = 'MEESHO A+ LISTING AUTOMATION PRO';
  const SOURCE_MODE_CURRENT = 'current';
  const SOURCE_MODE_MANUAL = 'manual';

  let currentShipping = null;
  let currentMeeshoPrice = null;
  let draftInfo = null;
  let currentCatalogSignature = '';
  let sourceMode = SOURCE_MODE_CURRENT;
  let manualSourceFile = null;
  let sourceResolveState = 'none';
  let shouldStop = false;
  let running = false;
  let results = [];
  let currentPreviewUrl = '';
  let currentPreviewObjectUrl = null;
  let resultsCollapsed = false;
  let appliedResult = null;
  let optimizerGeneration = 0;
  let currentProgress = {
    attempt: 0,
    total: 0,
    phase: 'ready',
    best: null,
    noPidCount: 0,
    verifiedCount: 0,
    viableCount: 0,
    strategy: 'Ready'
  };

  function parseExpiry(value) {
    const raw = String(value || '').trim();
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        23,
        59,
        59,
        999
      );
    }
    return new Date(raw);
  }

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

  function mergeCatalogDraft(current = null, incoming = null) {
    const base = normalizeCatalogDraft(current);
    const next = normalizeCatalogDraft(incoming);
    return {
      ...base,
      ...next,
      imageUrl: next.imageUrl || base.imageUrl || '',
      fileRefId: next.fileRefId || next.file_ref_id || base.fileRefId || base.file_ref_id || '',
      file_ref_id: next.file_ref_id || next.fileRefId || base.file_ref_id || base.fileRefId || '',
      sscatId: next.sscatId || base.sscatId || '',
      supplierId: next.supplierId || base.supplierId || '',
      uploadedBy: next.uploadedBy || base.uploadedBy || '',
      duplicatePid: next.duplicatePid || base.duplicatePid || ''
    };
  }

  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function toPositiveNumber(value) {
    const num = toFiniteNumber(value);
    return num != null && num > 0 ? num : null;
  }

  function lowestPositive(...values) {
    let lowest = null;
    for (const value of values) {
      const num = toPositiveNumber(value);
      if (num == null) continue;
      if (lowest == null || num < lowest) lowest = num;
    }
    return lowest;
  }

  function catalogSignature(detail = null) {
    const draft = normalizeCatalogDraft(detail);
    return [
      draft.fileRefId ?? draft.file_ref_id ?? '',
      draft.imageUrl ?? '',
      draft.sscatId ?? '',
      draft.supplierId ?? ''
    ].join('|');
  }

  function getTargetShippingValue() {
    return toFiniteNumber(document.getElementById('mls-target-shipping')?.value);
  }

  function getCurrentShippingValue() {
    return toPositiveNumber(currentShipping);
  }

  function isBestWithinCurrent(bestValue = currentProgress.best) {
    const best = toPositiveNumber(bestValue);
    const current = getCurrentShippingValue();
    return best != null && current != null && best < current;
  }

  function isTargetReached(bestValue = currentProgress.best) {
    const best = toPositiveNumber(bestValue);
    const target = getTargetShippingValue();
    return best != null && target != null && best <= target;
  }

  function clearAutoStartQueue() {
    // Optimization is intentionally manual-only.
  }

  function resetOptimizerState({ clearPreview = sourceMode !== SOURCE_MODE_MANUAL } = {}) {
    optimizerGeneration += 1;
    shouldStop = true;
    results = [];
    resultsCollapsed = false;
    appliedResult = null;
    sourceResolveState = 'none';
    currentProgress = {
      attempt: 0,
      total: 0,
      phase: 'ready',
      best: null,
      noPidCount: 0,
      verifiedCount: 0,
      viableCount: 0,
      strategy: 'Ready'
    };

    if (clearPreview) {
      if (currentPreviewObjectUrl) {
        try {
          URL.revokeObjectURL(currentPreviewObjectUrl);
        } catch (_) {}
      }
      currentPreviewObjectUrl = null;
      currentPreviewUrl = '';
      const fileNameEl = document.getElementById('mls-file-name');
      if (fileNameEl) fileNameEl.textContent = 'Waiting for Meesho image';
      const sourceState = document.getElementById('mls-source-state');
      if (sourceState) {
        sourceState.textContent = 'AUTO';
        sourceState.classList.remove('mls-source-row__state--manual', 'mls-source-row__state--empty');
      }
    }

    updateProgress({
      attempt: 0,
      total: 0,
      phase: 'ready',
      best: null,
      noPidCount: 0,
      verifiedCount: 0,
      viableCount: 0,
      strategy: 'Ready',
      previewDataUrl: clearPreview ? '' : currentPreviewUrl
    });
    renderResults();
    clearAutoStartQueue();
  }

  function hasActiveAccess(value) {
    const expiry = parseExpiry(value);
    return !Number.isNaN(expiry.getTime()) && expiry >= new Date();
  }

  function decodeJwtPayload(token) {
    try {
      const encoded = token.split('.')[1];
      if (!encoded) return null;
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(Array.from(atob(padded), char =>
        `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
      ).join('')));
    } catch (_) {
      return null;
    }
  }

  async function getMachineId() {
    const stored = await chrome.storage.local.get('machine_id');
    if (stored.machine_id) return stored.machine_id;
    const machineId = `PC-${Math.random().toString(36).slice(2, 11)}-${Date.now()}`;
    await chrome.storage.local.set({ machine_id: machineId });
    return machineId;
  }

  function profileFromPayload(payload = {}) {
    const meta = payload.user_metadata || {};
    return {
      full_name: meta.full_name || meta.name || payload.full_name || payload.name || payload.email || 'Google User',
      email: payload.email || meta.email || '',
      mobile_number: meta.phone || meta.mobile || payload.phone || '',
      shipping_plan_expired: '',
      autofill_plan_expired: '',
      is_trial: false
    };
  }

  function formatPlanExpiry(value) {
    const date = parseExpiry(value);
    if (Number.isNaN(date.getTime())) return 'Not found';

    const day = String(date.getDate());
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    const suffix = hour >= 12 ? 'pm' : 'am';
    hour %= 12;
    if (hour === 0) hour = 12;

    return `${day} ${month} ${year}, ${String(hour).padStart(2, '0')}:${minute} ${suffix}`;
  }

  function subscriptionExpiry(data = {}) {
    return (
      data.expiryDate ||
      data.membershipExpiryDate ||
      data.shipping_plan_expired ||
      data.autofill_plan_expired ||
      data.trial_expires_at ||
      data.trialExpiresAt ||
      ''
    );
  }

  function normalizeShippingSubscriptionData(data = {}, payload = {}) {
    const fallback = profileFromPayload(payload);
    const source = data.user || data.profile || data;
    const expiry = subscriptionExpiry(source) || subscriptionExpiry(data);
    const active =
      data.isSubscribed === true ||
      data.active === true ||
      data.status === 'active' ||
      hasActiveAccess(expiry);

    const normalizedExpiry = expiry || '';

    return {
      full_name: source.full_name || source.name || source.display_name || fallback.full_name,
      email: source.email || fallback.email,
      mobile_number: source.mobile_number || source.mobile || source.phone || fallback.mobile_number,
      shipping_plan_expired: normalizedExpiry,
      autofill_plan_expired: normalizedExpiry,
      subscription_status: source.subscription_status || data.subscription_status || (active ? 'active' : 'inactive'),
      is_trial: source.is_trial === true || data.is_trial === true || data.trial === true,
      trial_started_at: source.trial_started_at || data.trial_started_at || null,
      trial_expires_at: source.trial_expires_at || data.trial_expires_at || null
    };
  }

  async function checkSubscription() {
    try {
      const access = await chrome.runtime.sendMessage({ type: 'GET_ACCESS' });
      if (access?.allowed) return { allowed:true, trial:false, user:access.user };
      return { allowed:false, reason:access?.reason || 'unauthenticated', user:access?.user || null };
    } catch (_) { return { allowed:false, reason:'network', user:null }; }
  }

  function renderPlanStatus(state) {
    const badge = document.getElementById(PLAN_ID);
    const accessBadge = document.getElementById('mls-plan-access-badge');
    const activeCard = document.getElementById('mls-plan-access-active');
    const lockedCard = document.getElementById('mls-plan-access-locked');
    const workspace = document.querySelector(`#${BOX_ID} .mls-workspace`);
    const nameEl = document.getElementById('mls-plan-access-name');
    const emailEl = document.getElementById('mls-plan-access-email');
    const statusEl = document.getElementById('mls-plan-access-status');
    const expiryLabelEl = document.getElementById('mls-plan-access-expiry-label');
    const expiryEl = document.getElementById('mls-plan-access-expiry');
    const lockedTitleEl = document.getElementById('mls-plan-access-locked-title');
    const lockedTextEl = document.getElementById('mls-plan-access-locked-text');
    const whatsappLink = document.getElementById('mls-plan-access-whatsapp');

    if (!badge) return;

    if (!state) {
      badge.textContent = 'Checking plan...';
      badge.className = 'mls-credits';
      if (accessBadge) accessBadge.textContent = 'Checking...';
      if (activeCard) activeCard.hidden = true;
      if (lockedCard) lockedCard.hidden = true;
      if (workspace) workspace.hidden = true;
      return;
    }

    const user = state.user || {};
    const isAllowed = state.allowed === true;
    const isTrial = isAllowed && state.trial === true;
    const expiryValue = user.shipping_plan_expired || user.autofill_plan_expired || user.trial_expires_at || '';
    const expiryText = formatPlanExpiry(expiryValue);

    if (isAllowed) {
      badge.textContent = isTrial ? 'Free trial' : 'Premium plan';
      badge.className = 'mls-credits mls-credits--active';
      if (accessBadge) {
        accessBadge.textContent = isTrial ? 'Free trial active' : 'Active';
        accessBadge.className = isTrial
          ? 'mls-plan-access__badge mls-plan-access__badge--trial'
          : 'mls-plan-access__badge mls-plan-access__badge--active';
      }
      if (activeCard) activeCard.hidden = false;
      if (lockedCard) lockedCard.hidden = true;
      if (workspace) workspace.hidden = false;
      if (nameEl) nameEl.textContent = user.full_name || user.name || user.email || '—';
      if (emailEl) emailEl.textContent = user.email || '—';
      if (statusEl) statusEl.textContent = isTrial ? 'Free trial' : 'Active';
      if (expiryLabelEl) expiryLabelEl.textContent = isTrial ? 'Trial ends' : 'Expires on';
      if (expiryEl) expiryEl.textContent = expiryText;
      if (lockedTitleEl) lockedTitleEl.textContent = '';
      if (lockedTextEl) lockedTextEl.textContent = '';
      if (whatsappLink) whatsappLink.hidden = true;
      return;
    }

    const lockedReason = state.reason === 'device_locked'
      ? 'Device locked'
      : state.reason === 'revoked'
        ? 'License revoked'
        : state.reason === 'unauthenticated'
          ? 'Sign in required'
        : state.reason === 'network'
          ? 'Verification pending'
          : 'License expired';
    const lockedMessage = state.reason === 'device_locked'
        ? 'This license is already tied to another PC. Contact support to reset it.'
        : state.reason === 'revoked'
          ? 'This product has been revoked by admin. Contact support to restore access.'
          : state.reason === 'unauthenticated'
            ? 'Sign in from the extension to verify your subscription.'
          : state.reason === 'network'
            ? 'Could not verify your plan right now. Try again in a moment.'
            : 'Activate or renew your membership to continue using the shipping optimizer.';

    badge.textContent = lockedReason;
    badge.className = 'mls-credits mls-credits--locked';
    if (accessBadge) {
      accessBadge.textContent = lockedReason;
      accessBadge.className = 'mls-plan-access__badge mls-plan-access__badge--locked';
    }
    if (activeCard) activeCard.hidden = true;
    if (lockedCard) lockedCard.hidden = false;
    if (workspace) workspace.hidden = true;
    if (lockedTitleEl) lockedTitleEl.textContent = lockedReason;
    if (lockedTextEl) lockedTextEl.textContent = lockedMessage;
    if (whatsappLink) {
      whatsappLink.hidden = false;
      const message = encodeURIComponent('Hi, I want to activate or renew my MEESHO A+ LISTING AUTOMATION PRO membership (Autofill + Shipping Optimizer).');
      whatsappLink.href = `https://wa.me/919064827025?text=${message}`;
    }
  }

  function openPanel(view) {
    window.dispatchEvent(new CustomEvent('__meesho_af_open_panel', {
      detail: { view }
    }));
  }

  function showAccessMessage(status, state) {
    const message = state.reason === 'device_locked'
        ? 'License locked to another PC. Contact Sohel Enterprise support on WhatsApp.'
        : state.reason === 'revoked'
          ? 'This license was revoked by admin. Contact support to restore access.'
        : state.reason === 'unauthenticated'
          ? 'Sign in from the extension before using the shipping optimizer.'
        : state.reason === 'network'
          ? 'Could not verify subscription right now. Try again shortly.'
          : 'License expired. Renew on WhatsApp to continue using the shipping optimizer.';
    status.textContent = message;
    status.className = 'mls-status mls-status--error';
  }

  function setStatus(message, kind = '') {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = message;
    status.className = 'mls-status';
    if (kind) status.classList.add(`mls-status--${kind}`);
  }

  function parseRupees(text) {
    const value = parseFloat(String(text || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function readBreakdown(container) {
    const output = { meeshoPrice: null, shipping: null };
    container.querySelectorAll('p').forEach(element => {
      const text = element.textContent.trim();
      if (text.startsWith('Shipping')) output.shipping = parseRupees(text);
      if (text.startsWith('Meesho price')) {
        const sibling = element.nextElementSibling;
        if (sibling) output.meeshoPrice = parseRupees(sibling.textContent);
      }
    });
    return output;
  }

  function findBankSettlementCard() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() !== 'Bank Settlement Breakdown') continue;
      let card = node.parentElement;
      for (let depth = 0; depth < 8 && card; depth += 1) {
        const hasPrice = [...card.querySelectorAll('p')]
          .some(element => element.textContent.trim().startsWith('Meesho price'));
        if (hasPrice) return card;
        card = card.parentElement;
      }
    }
    const matches = document.querySelectorAll(TARGET_SELECTOR);
    return matches[matches.length - 1] || null;
  }

  function getPageFileInputs() {
    return [...document.querySelectorAll('input[type="file"]')].filter(input =>
      !input.closest(`#${BOX_ID}`)
    );
  }

  function getPageInputs(selector) {
    return [...document.querySelectorAll(selector)].filter(input =>
      !input.closest(`#${BOX_ID}`)
    );
  }

  function isLikelyMeeshoImageInput(input) {
    if (!input) return false;
    const meta = [
      input.id,
      input.name,
      input.className,
      input.accept,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder')
    ].join(' ').toLowerCase();
    return (
      meta.includes('changefrontimage') ||
      meta.includes('front') ||
      meta.includes('image') ||
      meta.includes('photo') ||
      meta.includes('upload')
    ) || String(input.accept || '').toLowerCase().includes('image');
  }

  function getManualImageInput() {
    return document.getElementById('mls-manual-image-input');
  }

  function getSourceModeButton(mode) {
    return document.querySelector(`[data-source-mode="${mode}"]`);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getVisibleText(text) {
    return String(text || '').trim().toLowerCase();
  }

  function findFrontImagePreviewUrl() {
    const candidates = [...document.querySelectorAll('img')].filter(img => {
      if (!img || !img.src) return false;
      if (img.closest(`#${BOX_ID}`)) return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20 && img.offsetParent !== null;
    });

    const scored = candidates.map(img => {
      const containerText = (img.closest('div, section, article, aside')?.textContent || '').toLowerCase();
      let score = 0;
      if (containerText.includes('uploaded images')) score += 3;
      if (containerText.includes('front image')) score += 4;
      if (containerText.includes('change')) score += 2;
      if (containerText.includes('uploaded')) score += 1;
      if (img.alt && /front|uploaded|catalog/i.test(img.alt)) score += 2;
      return { img, score };
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.img?.currentSrc || scored[0]?.img?.src || '';
  }

  function findFrontImagePreviewElement() {
    const candidates = [...document.querySelectorAll('img')].filter(img => {
      if (!img || !img.src) return false;
      if (img.closest(`#${BOX_ID}`)) return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20 && img.offsetParent !== null;
    });

    const scored = candidates.map(img => {
      const containerText = (img.closest('div, section, article, aside')?.textContent || '').toLowerCase();
      let score = 0;
      if (containerText.includes('uploaded images')) score += 3;
      if (containerText.includes('front image')) score += 4;
      if (containerText.includes('change')) score += 2;
      if (containerText.includes('uploaded')) score += 1;
      if (img.alt && /front|uploaded|catalog/i.test(img.alt)) score += 2;
      return { img, score };
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.img || null;
  }

  async function fileFromUrl(url, filenamePrefix = 'meesho-front') {
    if (!url) return null;
    const attempts = [
      undefined,
      { credentials: 'include' },
    ];

    for (const init of attempts) {
      try {
        const response = init ? await fetch(url, init) : await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        return new File([blob], `${filenamePrefix}-${Date.now()}.jpg`, {
          type: blob.type || 'image/jpeg'
        });
      } catch (_) {
        // try next strategy
      }
    }

    return null;
  }

  async function fileFromImageElement(img, filenamePrefix = 'meesho-front') {
    if (!img) return null;
    try {
      if (!img.complete) {
        await new Promise(resolve => {
          const finish = () => resolve();
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
        });
      }

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) return null;

      return new File([blob], `${filenamePrefix}-${Date.now()}.jpg`, {
        type: blob.type || 'image/jpeg'
      });
    } catch (_) {
      return null;
    }
  }

  function findFrontImageInputByContext() {
    const labels = [...document.querySelectorAll('*')].filter(el => {
      if (!el || el.closest(`#${BOX_ID}`)) return false;
      const text = getVisibleText(el.textContent);
      return text === 'front image' || text.includes('front image') || text.includes('uploaded images');
    });

    for (const label of labels) {
      const container = label.closest('div, section, article, aside') || label.parentElement;
      if (!container) continue;
      const input = container.querySelector('input[type="file"]');
      if (input && !input.closest(`#${BOX_ID}`)) return input;
    }

    return null;
  }

  function getMeeshoImageInput() {
    const exact = document.querySelector('#changeFrontImage');
    if (exact && !exact.closest(`#${BOX_ID}`)) return exact;

    const contextual = findFrontImageInputByContext();
    if (contextual) return contextual;

    const inputs = getPageFileInputs();
    if (inputs.length === 0) return null;

    const selected = inputs.find(input => input.files && input.files.length > 0);
    if (selected) return selected;

    const likely = inputs.find(isLikelyMeeshoImageInput);
    if (likely) return likely;

    return inputs[0] || null;
  }

  function currentSourceFile() {
    return getMeeshoImageInput()?.files?.[0] || null;
  }

  function getSourceStrategyLabel() {
    if (sourceMode === SOURCE_MODE_MANUAL) {
      return 'Uploaded own front image';
    }
    if (currentSourceFile()) {
      return 'Current uploaded front image';
    }
    if (findFrontImagePreviewUrl() || draftInfo?.imageUrl) {
      return 'Current saved front image';
    }
    if (manualSourceFile) {
      return 'Uploaded own front image';
    }
    return 'Current front image';
  }

  function updateSourceModeUI() {
    const currentButton = getSourceModeButton(SOURCE_MODE_CURRENT);
    const manualButton = getSourceModeButton(SOURCE_MODE_MANUAL);

    if (currentButton) {
      const active = sourceMode === SOURCE_MODE_CURRENT;
      currentButton.classList.toggle('mls-source-switch__btn--active', active);
      currentButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    if (manualButton) {
      const active = sourceMode === SOURCE_MODE_MANUAL;
      manualButton.classList.toggle('mls-source-switch__btn--active', active);
      manualButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function setSourceMode(mode) {
    sourceMode = mode === SOURCE_MODE_MANUAL ? SOURCE_MODE_MANUAL : SOURCE_MODE_CURRENT;
    if (sourceMode === SOURCE_MODE_MANUAL) {
      clearAutoStartQueue();
    }
    updateSourceModeUI();
    syncSourcePreview();
  }

  function setManualSourceFile(file) {
    manualSourceFile = file || null;
    if (manualSourceFile) {
      sourceMode = SOURCE_MODE_MANUAL;
      clearAutoStartQueue();
    }
    updateSourceModeUI();
    syncSourcePreview();
  }

  function requestCatalogContext() {
    window.dispatchEvent(new CustomEvent('mls:request-catalog-context'));
  }

  async function waitForCatalogContext(timeoutMs = 1800) {
    const normalizedDraft = normalizeCatalogDraft(draftInfo);
    if (normalizedDraft.sscatId && normalizedDraft.supplierId) return normalizedDraft;
    requestCatalogContext();
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const loopDraft = normalizeCatalogDraft(draftInfo);
      if (loopDraft.sscatId && loopDraft.supplierId) return loopDraft;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return normalizeCatalogDraft(draftInfo);
  }

  async function resolveSourceFile() {
    if (sourceMode === SOURCE_MODE_MANUAL) {
      sourceResolveState = manualSourceFile ? 'manual-ok' : 'manual-missing';
      return manualSourceFile || null;
    }

    const localFile = currentSourceFile();
    if (localFile) {
      sourceResolveState = 'current-file';
      return localFile;
    }

    const previewUrl = findFrontImagePreviewUrl();
    const previewElement = findFrontImagePreviewElement();
    if (previewElement) {
      const previewFile = await fileFromImageElement(previewElement, 'meesho-front');
      if (previewFile) {
        sourceResolveState = 'preview-element';
        return previewFile;
      }
    }

    if (!previewUrl && !draftInfo?.imageUrl) {
      sourceResolveState = 'current-missing';
      return null;
    }

    const preferredUrl = previewUrl || draftInfo.imageUrl;
    const file = await fileFromUrl(preferredUrl, 'meesho-front');
    if (file) {
      sourceResolveState = previewUrl ? 'preview-url' : 'saved-ok';
      return file;
    }

    if (manualSourceFile) {
      sourceResolveState = 'manual-fallback';
      return manualSourceFile;
    }

    sourceResolveState = 'saved-load-failed';
    return null;
  }

  function updatePreviewFromSource({
    previewUrl = '',
    previewObjectUrl = null,
    fileName = '',
    strategy = 'Ready'
  }) {
    if (currentPreviewObjectUrl && currentPreviewObjectUrl !== previewUrl) {
      try {
        URL.revokeObjectURL(currentPreviewObjectUrl);
      } catch (_) {}
      currentPreviewObjectUrl = null;
    }

    currentPreviewUrl = previewUrl || '';
    currentPreviewObjectUrl = previewObjectUrl;

    const preview = document.getElementById('mls-live-preview');
    const emptyPreview = document.getElementById('mls-preview-empty');
    if (preview) {
      if (currentPreviewUrl) {
        preview.src = currentPreviewUrl;
        preview.hidden = false;
        if (emptyPreview) emptyPreview.hidden = true;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
        if (emptyPreview) emptyPreview.hidden = false;
      }
    }

    const fileNameEl = document.getElementById('mls-file-name');
    if (fileNameEl && fileName) {
      fileNameEl.textContent = fileName;
    }

    updateProgress({
      previewDataUrl: currentPreviewUrl,
      strategy: running ? currentProgress.strategy : strategy
    });
  }

  function configureApi() {
    const api = window.MeeshoAPI;
    if (!api) return null;
    api.detectAllValues();
    const normalizedDraft = normalizeCatalogDraft(draftInfo);
    if (normalizedDraft.sscatId) api.setCategory(Number(normalizedDraft.sscatId));
    if (normalizedDraft.supplierId) {
      if (typeof api.setSupplier === 'function') api.setSupplier(Number(normalizedDraft.supplierId));
      else api.cache.supplierId = Number(normalizedDraft.supplierId);
    }
    if (currentMeeshoPrice) api.cache.price = Number(currentMeeshoPrice);
    return api;
  }

  function phaseLabel(phase) {
    const labels = {
      ready: 'Ready to optimize',
      generating: 'Creating image variation',
      uploading: 'Uploading variation to Meesho',
      matching: 'Finding duplicate PID',
      verified: 'Lower shipping result verified',
      not_lower: 'Verified, but not lower than current cost',
      no_match: 'No visual match for this variation',
      upload_failed: 'Variation upload failed'
    };
    return labels[phase] || 'Processing';
  }

  function updateProgress(progress = {}) {
    currentProgress = {
      ...currentProgress,
      ...progress
    };
    if (Object.prototype.hasOwnProperty.call(progress, 'previewDataUrl')) {
      if (currentPreviewObjectUrl && progress.previewDataUrl !== currentPreviewObjectUrl) {
        try {
          URL.revokeObjectURL(currentPreviewObjectUrl);
        } catch (_) {}
        currentPreviewObjectUrl = null;
      }
      currentPreviewUrl = progress.previewDataUrl || '';
    }

    const preview = document.getElementById('mls-live-preview');
    const emptyPreview = document.getElementById('mls-preview-empty');
    if (preview) {
      if (currentPreviewUrl) {
        preview.src = currentPreviewUrl;
        preview.hidden = false;
        if (emptyPreview) emptyPreview.hidden = true;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
        if (emptyPreview) emptyPreview.hidden = false;
      }
    }

    const bestCard = document.getElementById('mls-stat-best');
    const bestValue = toPositiveNumber(currentProgress.best);
    if (bestCard) {
      const bestHit = isBestWithinCurrent(bestValue);
      bestCard.classList.toggle('mls-stat-card--best', bestValue != null && bestHit);
      bestCard.classList.toggle('mls-stat-card--best-warn', bestValue != null && !bestHit);
    }

    const phase = document.getElementById('mls-progress-phase');
    const attempt = document.getElementById('mls-progress-attempt');
    const best = document.getElementById('mls-progress-best');
    const viable = document.getElementById('mls-progress-viable');
    const tested = document.getElementById('mls-progress-tested');
    const bar = document.getElementById('mls-progress-bar');

    if (phase) phase.textContent = phaseLabel(currentProgress.phase);
    if (attempt) {
      attempt.textContent = currentProgress.total
        ? `${currentProgress.attempt} / ${currentProgress.total}`
        : '0 / 0';
    }
    if (best) best.textContent = bestValue == null ? '—' : `₹${bestValue}`;
    if (viable) viable.textContent = String(currentProgress.viableCount || 0);
    if (tested) tested.textContent = String(currentProgress.attempt || 0);
    if (bar) {
      const percentage = currentProgress.total
        ? Math.min(100, Math.round((currentProgress.attempt / currentProgress.total) * 100))
        : 0;
      bar.style.width = `${percentage}%`;
    }

    const category = document.getElementById('mls-context-category');
    const supplier = document.getElementById('mls-context-supplier');
    const categoryState = document.getElementById('mls-context-category-state');
    const supplierState = document.getElementById('mls-context-supplier-state');
    const categoryCard = document.getElementById('mls-context-category-card');
    const supplierCard = document.getElementById('mls-context-supplier-card');
    const normalizedDraft = normalizeCatalogDraft(draftInfo);
    const categoryValue = normalizedDraft.sscatId || window.MeeshoAPI?.cache?.categoryId || '';
    const supplierValue = normalizedDraft.supplierId || window.MeeshoAPI?.cache?.supplierId || '';

    if (category) category.textContent = categoryValue || 'Waiting';
    if (supplier) supplier.textContent = supplierValue || 'Waiting';
    if (categoryState) categoryState.textContent = categoryValue ? '✓' : '—';
    if (supplierState) supplierState.textContent = supplierValue ? '✓' : '—';
    if (categoryCard) categoryCard.classList.toggle('mls-context-pill--ready', Boolean(categoryValue));
    if (supplierCard) supplierCard.classList.toggle('mls-context-pill--ready', Boolean(supplierValue));
  }

  function renderResults() {
    const container = document.getElementById(RESULTS_ID);
    if (!container) return;
    const bestValue = toPositiveNumber(currentProgress.best);
    const targetShipping = getTargetShippingValue();
    const currentValue = getCurrentShippingValue();
    const bestHit = isBestWithinCurrent(bestValue);
    const summaryClass = bestValue != null
      ? bestHit
        ? ' mls-result-summary--best-hit'
        : ' mls-result-summary--best-miss'
      : '';

    if (!results.length) {
      if (bestValue == null) {
        container.innerHTML = currentProgress.phase === 'no_match'
          ? `
            <div class="mls-no-result">
              <strong>No lower endpoint found</strong>
              <span>Current shipping ₹${currentShipping} remains the best verified cost.</span>
            </div>
          `
          : '';
        return;
      }

      const noResultNote = currentProgress.phase === 'no_match'
        ? `
          <div class="mls-no-result">
            <strong>No lower endpoint found</strong>
            <span>${bestHit
              ? 'Best seen shipping improved over current shipping, but did not hit target.'
              : 'Best verified shipping stayed above the current shipping.'}</span>
          </div>
        `
        : '';

      const summarySmall = bestValue == null
        ? ''
        : bestHit
          ? `Save ₹${Math.max(0, Number(currentValue) - Number(bestValue))} per order${targetShipping != null && bestValue > targetShipping ? ` • ₹${Math.max(0, bestValue - targetShipping)} above target` : ''}`
          : `₹${Math.max(0, Number(bestValue) - Number(currentValue))} above current shipping${targetShipping != null ? ` • ₹${Math.max(0, bestValue - targetShipping)} above target` : ''}`;

      container.innerHTML = `
        <div class="mls-result-summary${summaryClass}">
          <span>Best verified result</span>
          <strong>₹${bestValue}</strong>
          <small>${summarySmall}</small>
        </div>
        ${noResultNote}
      `;
      return;
    }

    if (resultsCollapsed && appliedResult) {
      container.innerHTML = `
        <div class="mls-result-summary mls-result-summary--applied">
          <span>Applied match</span>
          <strong>₹${appliedResult.shippingCost}</strong>
          <small>Images hidden for a cleaner view</small>
        </div>
        <div class="mls-results-collapsed">
          <button type="button" class="mls-btn mls-btn--ghost" id="mls-show-matches">Show matches</button>
        </div>
      `;

      const showMatches = container.querySelector('#mls-show-matches');
      if (showMatches) {
        showMatches.addEventListener('click', () => {
          resultsCollapsed = false;
          renderResults();
        });
      }
      return;
    }

    const visibleResults = results.slice(0, 5);
    const summaryShipping = bestValue ?? results[0].shippingCost;
    const summaryHit = isBestWithinCurrent(summaryShipping);
    const summaryCurrent = getCurrentShippingValue();
    const summarySmall = summaryHit
      ? `Save ₹${Math.max(0, Number(summaryCurrent) - Number(summaryShipping))} per order${targetShipping != null && summaryShipping > targetShipping ? ` • ₹${Math.max(0, summaryShipping - targetShipping)} above target` : ''}`
      : `₹${Math.max(0, Number(summaryShipping) - Number(summaryCurrent))} above current shipping${targetShipping != null ? ` • ₹${Math.max(0, summaryShipping - targetShipping)} above target` : ''}`;
    container.innerHTML = `
      <div class="mls-result-summary${summaryHit ? ' mls-result-summary--best-hit' : ' mls-result-summary--best-miss'}">
        <span>Best verified result</span>
        <strong>₹${summaryShipping}</strong>
        <small>${summarySmall}</small>
      </div>
      <div class="mls-results-header">
        <div>
          <strong>Top verified matches</strong>
          <span>Showing ${visibleResults.length} of ${results.length}</span>
        </div>
      </div>
      <div class="mls-result-grid">
      ${visibleResults.map((result, index) => `
      <div class="mls-result${index === 0 ? ' mls-result--best' : ''}${result.isImprovement === false ? ' mls-result--high' : ''}">
        <img class="mls-result__image" src="${result.dataUrl}" alt="">
        <div class="mls-result__meta">
          <span class="mls-result__rank">${index === 0 ? 'Best match' : `Match #${index + 1}`}</span>
          <strong>₹${result.shippingCost} <em>${result.savings > 0 ? `Save ₹${result.savings}` : result.aboveCurrent > 0 ? `Above current ₹${result.aboveCurrent}` : 'Verified image'}</em></strong>
          <span>${result.strategy || 'Optimized image'}</span>
        </div>
        <div class="mls-result__actions">
          <button type="button" class="mls-btn mls-btn--ghost" data-download-index="${index}">Save</button>
          <button type="button" class="mls-btn" data-result-index="${index}">Apply</button>
        </div>
      </div>
      `).join('')}
      </div>
    `;

    container.querySelectorAll('[data-download-index]').forEach(button => {
      button.addEventListener('click', () => {
        const result = results[Number(button.dataset.downloadIndex)];
        if (result) downloadResult(result);
      });
    });
    container.querySelectorAll('[data-result-index]').forEach(button => {
      button.addEventListener('click', () => {
        const result = results[Number(button.dataset.resultIndex)];
        if (result) applyResult(result, button);
      });
    });
  }

  function downloadResult(result) {
    const link = document.createElement('a');
    link.download = `meesho-shipping-${result.shippingCost}-${Date.now()}.jpg`;
    link.href = result.dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function detectShipping() {
    const card = findBankSettlementCard();
    if (!card) return null;
    const breakdown = readBreakdown(card);
    return Number.isFinite(Number(breakdown.shipping))
      ? Number(breakdown.shipping)
      : null;
  }

  async function triggerPriceRefresh() {
    const priceSelectors = [
      'input[name="price"]',
      'input[name="mrp"]',
      'input[name="sellingPrice"]',
      'input[placeholder*="price" i]',
      'input[placeholder*="mrp" i]',
      'input[id*="price" i]',
      'input[class*="price" i]',
      '.MuiInputBase-input',
      'input[type="number"]',
    ];

    let priceInput = null;
    for (const selector of priceSelectors) {
      try {
        const inputs = getPageInputs(selector);
        for (const input of inputs) {
          const value = String(input.value || '').trim();
          if (value && /^\d+$/.test(value) && Number(value) >= 10) {
            priceInput = input;
            break;
          }
        }
        if (priceInput) break;
      } catch (_) {}
    }

    if (priceInput) {
      const currentValue = priceInput.value;
      priceInput.focus();
      priceInput.click();
      await delay(100);
      priceInput.select?.();
      priceInput.value = currentValue;
      priceInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      priceInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'Tab', keyCode: 9 }));
      priceInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: 'Tab', keyCode: 9 }));
      await delay(100);
      priceInput.blur();
      priceInput.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
      priceInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
      document.body.click();
    }

    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(button =>
      !button.closest(`#${BOX_ID}`)
    );
    for (const button of buttons) {
      const text = (button.textContent || '').toLowerCase().trim();
      if (text.includes('calculate') || text.includes('update') || text === 'save') {
        button.click();
        await delay(500);
        break;
      }
    }
  }

  async function waitForFinalShipping(expectedShipping, initialShipping) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = detectShipping();
      if (current && current > 0) {
        if (Number.isFinite(Number(expectedShipping)) && current === Number(expectedShipping)) {
          return current;
        }
        if (!Number.isFinite(Number(initialShipping)) || current !== Number(initialShipping)) {
          return current;
        }
      }
      await delay(400);
    }
    return detectShipping();
  }

  async function applyResult(result, button) {
    const generation = optimizerGeneration;
    const input = getMeeshoImageInput();
    if (!input) {
      setStatus('Meesho front image input not found.', 'error');
      return;
    }

    button.disabled = true;
    setStatus('Applying optimized image...');
    resultsCollapsed = true;
    appliedResult = result;
    renderResults();
    try {
      const response = await fetch(result.dataUrl);
      if (generation !== optimizerGeneration) return;
      const blob = await response.blob();
      if (generation !== optimizerGeneration) return;
      const file = new File([blob], `optimized-${Date.now()}.jpg`, {
        type: 'image/jpeg'
      });
      const transfer = new DataTransfer();
      if (generation !== optimizerGeneration) return;
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

      window.dispatchEvent(new CustomEvent('mls:set-pid', {
        detail: { pid: result.duplicatePid }
      }));

      await delay(3000);
      if (generation !== optimizerGeneration) return;
      await triggerPriceRefresh();
      if (generation !== optimizerGeneration) return;
      await delay(1500);
      if (generation !== optimizerGeneration) return;
      await triggerPriceRefresh();
      if (generation !== optimizerGeneration) return;
      await delay(2000);
      if (generation !== optimizerGeneration) return;

      const finalShipping = await waitForFinalShipping(result.shippingCost, currentShipping);
      if (generation !== optimizerGeneration) return;
      if (Number.isFinite(Number(finalShipping))) {
        currentShipping = Number(finalShipping);
      } else {
        currentShipping = Number(result.shippingCost);
      }

      const currentValue = document.getElementById('mls-current-shipping');
      if (currentValue) currentValue.textContent = `₹${currentShipping}`;

      if (Number.isFinite(Number(finalShipping))) {
        if (Number(finalShipping) === Number(result.shippingCost)) {
          setStatus(`Optimized image applied. Shipping ₹${finalShipping}.`, 'success');
        } else {
          setStatus(`Applied, but page still shows ₹${finalShipping}. Tested result was ₹${result.shippingCost}.`, 'error');
        }
      } else {
        setStatus(`Applied. Tested shipping ₹${result.shippingCost}, waiting for page refresh...`, 'success');
      }
    } catch (_) {
      if (generation !== optimizerGeneration) return;
      setStatus('Could not apply optimized image.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function startOptimizer() {
    if (running) return;
    clearAutoStartQueue();
    const generation = ++optimizerGeneration;

    const status = document.getElementById(STATUS_ID);
    const latestCard = findBankSettlementCard();
    if (latestCard) {
      const latestBreakdown = readBreakdown(latestCard);
      if (latestBreakdown.shipping != null) currentShipping = latestBreakdown.shipping;
      if (latestBreakdown.meeshoPrice != null) currentMeeshoPrice = latestBreakdown.meeshoPrice;
      const currentValue = document.getElementById('mls-current-shipping');
      if (currentValue) currentValue.textContent = `₹${currentShipping}`;
    }

    renderPlanStatus(null);
    setStatus('Checking subscription...');
    const access = await checkSubscription();
    if (generation !== optimizerGeneration) return;
    renderPlanStatus(access);
    if (!access.allowed) {
      showAccessMessage(status, access);
      return;
    }

    setStatus('Reading Meesho catalog context...');
    const catalogDraft = await waitForCatalogContext();
    if (generation !== optimizerGeneration) return;
    currentCatalogSignature = catalogSignature(catalogDraft) || currentCatalogSignature;
    const categoryId = catalogDraft.sscatId || window.MeeshoAPI?.cache?.categoryId;
    const supplierId = catalogDraft.supplierId || window.MeeshoAPI?.cache?.supplierId;
    if (!categoryId) {
      setStatus('Catalog category is not ready. Wait for the draft to load, then try again.', 'error');
      updateProgress({ phase: 'ready', strategy: 'Waiting for catalog category' });
      return;
    }
    if (!supplierId) {
      setStatus('Supplier context is not ready. Refresh this Meesho catalog page, then try again.', 'error');
      updateProgress({ phase: 'ready', strategy: 'Waiting for supplier context' });
      return;
    }

    const file = await resolveSourceFile();
    if (generation !== optimizerGeneration) return;
    if (!file) {
      const sourceErrors = {
        'manual-missing': 'Choose a file in Upload own image, then run the optimizer.',
        'saved-load-failed': 'Could not load the current Meesho image. Switch to Upload own image and try again.',
        'current-missing': 'No current Meesho image detected. Use Current image or switch to Upload own image.',
      };
      setStatus(
        sourceErrors[sourceResolveState] || 'No usable front image found. Use Current image or upload your own file.',
        'error'
      );
      return;
    }

    const api = configureApi();
    if (generation !== optimizerGeneration) return;
    if (!api) {
      setStatus('Optimizer engine not loaded. Reload extension.', 'error');
      return;
    }

    const target = Math.max(
      1,
      Number(document.getElementById('mls-target-shipping')?.value) || 80
    );
    const maxAttempts = Math.min(
      200,
      Math.max(1, Number(document.getElementById('mls-max-attempts')?.value) || 100)
    );
    const startButton = document.getElementById('mls-start-optimizer');
    const stopButton = document.getElementById('mls-stop-optimizer');

    running = true;
    shouldStop = false;
    results = [];
    resultsCollapsed = false;
    appliedResult = null;
    const sourceLabel = getSourceStrategyLabel();
    if (currentPreviewObjectUrl) {
      try {
        URL.revokeObjectURL(currentPreviewObjectUrl);
      } catch (_) {}
      currentPreviewObjectUrl = null;
    }
    currentPreviewUrl = URL.createObjectURL(file);
    currentPreviewObjectUrl = currentPreviewUrl;
    currentProgress = {
      attempt: 0,
      total: maxAttempts,
      phase: 'ready',
      best: null,
      noPidCount: 0,
      verifiedCount: 0,
      viableCount: 0,
      strategy: sourceLabel
    };
    updateProgress({
      previewDataUrl: currentPreviewUrl,
      strategy: sourceLabel
    });
    renderResults();
    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.hidden = false;

    try {
      const search = await api.smartSearch(
        file,
        target,
        maxAttempts,
        (attempt, total, best, noPidCount, progressInfo = {}) => {
          if (generation !== optimizerGeneration) return;
          const nextBest = lowestPositive(
            best,
            progressInfo.shippingCost,
            currentProgress.best
          );
          updateProgress({
            ...progressInfo,
            attempt,
            total,
            best: nextBest,
            noPidCount,
            verifiedCount:
              progressInfo.verifiedCount ?? currentProgress.verifiedCount,
            viableCount:
              progressInfo.viableCount ?? currentProgress.viableCount
          });

          const bestText = nextBest == null ? 'Best price pending' : `Best ₹${nextBest}`;
          const attemptText = Number.isFinite(Number(progressInfo.shippingCost))
            ? `Checked ₹${progressInfo.shippingCost}`
            : phaseLabel(progressInfo.phase);
          setStatus(
            `Attempt ${attempt}/${total} • ${attemptText} • ${bestText}`
          );
        },
        found => {
          if (generation !== optimizerGeneration) return;
          updateProgress({
            phase: 'verified',
            best: lowestPositive(currentProgress.best, found.shippingCost) ?? found.shippingCost,
            previewDataUrl: found.dataUrl,
            strategy: found.strategy,
            duplicatePid: found.duplicatePid
          });
          setStatus(`Target found at ₹${found.shippingCost}.`, 'success');
        },
        () => shouldStop,
        currentShipping
      );

      if (generation !== optimizerGeneration) return;
      results = search.results || [];
      renderResults();
      if (results.length) {
        const best = results[0];
        const bestShipping = lowestPositive(search.bestSeenShipping, currentProgress.best, best.shippingCost) ?? best.shippingCost;
        const bestLowerThanCurrent = isBestWithinCurrent(bestShipping);
        updateProgress({
          phase: 'verified',
          best: bestShipping,
          previewDataUrl: best.dataUrl,
          strategy: best.strategy,
          verifiedCount: search.verifiedCount,
          viableCount: search.viableCount,
          noPidCount: search.noPidCount
        });
        setStatus(
          `${shouldStop ? 'Stopped' : 'Complete'}. Best verified shipping ₹${bestShipping}.`,
          bestLowerThanCurrent ? 'success' : 'error'
        );
      } else {
        const bestSeen = lowestPositive(search.bestSeenShipping, currentProgress.best);
        updateProgress({
          phase: 'no_match',
          best: bestSeen,
          noPidCount: search.noPidCount,
          verifiedCount: search.verifiedCount,
          viableCount: 0
        });
        setStatus(
          bestSeen != null
            ? `No result lower than current ₹${currentShipping}. Best seen ₹${bestSeen}. ${search.verifiedCount} prices were verified.`
            : `No result lower than current ₹${currentShipping}. ${search.verifiedCount} prices were verified.`,
          'error'
        );
        renderResults();
      }
    } catch (error) {
      if (generation !== optimizerGeneration) return;
      setStatus(error?.message || 'Optimizer failed.', 'error');
    } finally {
      if (generation === optimizerGeneration) {
        running = false;
      } else {
        running = false;
      }
      if (startButton) startButton.disabled = false;
      if (stopButton) stopButton.hidden = true;
    }
  }

  function toggleMaximize(box, force) {
    const maximize = force ?? !box.classList.contains('mls-maximized');
    box.classList.toggle('mls-maximized', maximize);
    document.documentElement.classList.toggle('mls-optimizer-open', maximize);
    const button = box.querySelector('#mls-toggle-maximize');
    if (button) {
      button.textContent = maximize ? '↙' : '↗';
      button.title = maximize ? 'Restore compact view' : 'Open full workspace';
      button.setAttribute('aria-label', button.title);
    }
  }

  function buildBox(shipping) {
    const box = document.createElement('div');
    box.id = BOX_ID;
    const suggestedTarget = Math.max(20, Math.floor(Number(shipping || 100) * 0.65));

    box.innerHTML = `
      <div class="mls-header">
        <div class="mls-brand">
          <span class="mls-brand__mark">M</span>
          <div>
            <h5>${PRODUCT_NAME}</h5>
            <p>Clean front-image optimization</p>
          </div>
        </div>
        <div class="mls-header__actions">
          <span id="${PLAN_ID}" class="mls-credits">Checking plan...</span>
          <button id="mls-toggle-maximize" class="mls-icon-btn" type="button"
            title="Open full workspace" aria-label="Open full workspace">↗</button>
        </div>
      </div>

      <div id="mls-plan-access" class="mls-plan-access">
        <div id="mls-plan-access-active" class="mls-plan-access__active" hidden>
          <div class="mls-plan-access__top">
            <div>
              <span class="mls-plan-access__eyebrow">Membership access</span>
              <strong>Account details</strong>
            </div>
            <span id="mls-plan-access-badge" class="mls-plan-access__badge">Checking...</span>
          </div>

          <div class="mls-plan-access__grid">
            <div>
              <span>Name</span>
              <strong id="mls-plan-access-name">—</strong>
            </div>
            <div>
              <span>Email address</span>
              <strong id="mls-plan-access-email">—</strong>
            </div>
            <div>
              <span>Subscription status</span>
              <strong id="mls-plan-access-status">—</strong>
            </div>
            <div>
              <span id="mls-plan-access-expiry-label">Expires on</span>
              <strong id="mls-plan-access-expiry">—</strong>
            </div>
          </div>
        </div>

        <div id="mls-plan-access-locked" class="mls-plan-access__locked" hidden>
          <div class="mls-plan-access__locked-copy">
            <span class="mls-plan-access__eyebrow">Membership access</span>
            <strong id="mls-plan-access-locked-title">License expired</strong>
            <p id="mls-plan-access-locked-text">Activate or renew your membership to continue using the shipping optimizer.</p>
            <div class="mls-plan-prices">
              <span>Shipping plan pricing is controlled by Admin</span>
            </div>
          </div>
          <div class="mls-plan-access__locked-actions">
            <a id="mls-plan-access-whatsapp" class="mls-plan-access__button mls-plan-access__button--wa"
               href="https://wa.me/919064827025?text=Hi%2C%20I%20want%20to%20renew%20my%20Meesho%20Shipping%20Optimizer%20license."
               target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </div>
      </div>

      <div class="mls-workspace" hidden>
        <section class="mls-stage">
          <div class="mls-preview">
            <img id="mls-live-preview" alt="Current optimizer attempt" hidden>
            <div id="mls-preview-empty" class="mls-preview__empty">
              <span>IMAGE</span>
              <strong>Current variation appears here</strong>
            </div>
          </div>

          <div class="mls-preview__overlay">
            <span id="mls-progress-attempt">0 / 0</span>
            <strong id="mls-progress-phase">Ready to optimize</strong>
          </div>

          <div class="mls-progress-track">
            <span id="mls-progress-bar"></span>
          </div>

          <div class="mls-stat-grid">
            <div data-stat="current" id="mls-stat-current"><span>Current</span><strong id="mls-current-shipping">₹${shipping}</strong></div>
            <div data-stat="best" id="mls-stat-best"><span>Best</span><strong id="mls-progress-best">—</strong></div>
            <div data-stat="viable" id="mls-stat-viable"><span>Viable</span><strong id="mls-progress-viable">0</strong></div>
            <div data-stat="tested" id="mls-stat-tested"><span>Tested</span><strong id="mls-progress-tested">0</strong></div>
          </div>

          <div class="mls-context-strip">
            <div id="mls-context-supplier-card" class="mls-context-pill">
              <div class="mls-context-pill__copy">
                <span>Supplier ID</span>
                <strong id="mls-context-supplier">Waiting</strong>
              </div>
              <em id="mls-context-supplier-state">—</em>
            </div>
            <div id="mls-context-category-card" class="mls-context-pill">
              <div class="mls-context-pill__copy">
                <span>Category ID</span>
                <strong id="mls-context-category">Waiting</strong>
              </div>
              <em id="mls-context-category-state">—</em>
            </div>
          </div>
        </section>

        <section class="mls-sidebar">
          <div class="mls-section-title">
            <div>
              <strong>Optimization setup</strong>
              <span>Choose a source and set the target</span>
            </div>
          </div>

          <div class="mls-controls">
            <div class="mls-source-switch" role="tablist" aria-label="Front image source">
              <button id="mls-source-current" type="button" class="mls-source-switch__btn" data-source-mode="current">Current image</button>
              <button id="mls-source-manual" type="button" class="mls-source-switch__btn" data-source-mode="manual">Upload own image</button>
            </div>
            <div class="mls-source-row">
              <span class="mls-source-row__icon">IMG</span>
              <div>
                <strong>Front image</strong>
                <span id="mls-file-name">Waiting for Meesho image</span>
              </div>
              <span id="mls-source-state" class="mls-source-row__state">AUTO</span>
            </div>
            <input id="mls-manual-image-input" type="file" accept="image/*" hidden>
            <div class="mls-control-grid">
              <label>
                <span>Target shipping</span>
                <input id="mls-target-shipping" type="number" min="1" max="999" value="${suggestedTarget}">
              </label>
              <label>
                <span>Max attempts</span>
                <input id="mls-max-attempts" type="number" min="1" max="200" value="100">
              </label>
            </div>
            <div class="mls-actions">
              <button id="mls-start-optimizer" type="button" class="mls-btn">Optimize Shipping</button>
              <button id="mls-stop-optimizer" type="button" class="mls-btn mls-btn--stop" hidden>Stop</button>
            </div>
          </div>

          <p id="${STATUS_ID}" class="mls-status">Ready. Choose a source and run the optimizer.</p>
        </section>

        <section class="mls-results-panel">
          <div id="${RESULTS_ID}"></div>
        </section>
      </div>
    `;

    const manualImageInput = box.querySelector('#mls-manual-image-input');

    box.querySelectorAll('[data-source-mode]').forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.sourceMode;
        setSourceMode(mode);
        if (mode === SOURCE_MODE_MANUAL && manualImageInput) {
          manualImageInput.click();
        }
      });
    });
    if (manualImageInput) {
      manualImageInput.addEventListener('change', event => {
        const file = event.target.files?.[0] || null;
        setManualSourceFile(file);
      });
    }

    const targetInput = box.querySelector('#mls-target-shipping');
    if (targetInput) {
      targetInput.addEventListener('input', () => {
        updateProgress();
        renderResults();
      });
    }

    box.querySelector('#mls-start-optimizer').addEventListener('click', startOptimizer);
    box.querySelector('#mls-stop-optimizer').addEventListener('click', () => {
      shouldStop = true;
      setStatus('Stopping after current attempt...');
    });
    box.querySelector('#mls-toggle-maximize').addEventListener('click', () => {
      toggleMaximize(box);
    });

    checkSubscription().then(renderPlanStatus);
    requestCatalogContext();
    setTimeout(() => {
      attachSourceListener();
      syncSourcePreview();
      updateProgress();
    }, 250);
    return box;
  }

  function syncSourcePreview() {
    updateSourceModeUI();
    if (running) return;

    const fileName = document.getElementById('mls-file-name');
    const sourceState = document.getElementById('mls-source-state');

    let previewUrl = '';
    let previewObjectUrl = null;
    let displayName = 'No current Meesho image detected';
    let sourceLabel = 'Current front image';

    if (sourceMode === SOURCE_MODE_MANUAL) {
      if (manualSourceFile) {
        previewUrl = URL.createObjectURL(manualSourceFile);
        previewObjectUrl = previewUrl;
        displayName = manualSourceFile.name || 'Selected own image';
        sourceLabel = 'Uploaded own front image';
        if (sourceState) {
          sourceState.textContent = 'UPLOAD';
          sourceState.classList.add('mls-source-row__state--manual');
          sourceState.classList.remove('mls-source-row__state--empty');
        }
      } else {
        displayName = 'Choose a file to start';
        sourceLabel = 'Upload own image waiting';
        if (sourceState) {
          sourceState.textContent = 'EMPTY';
          sourceState.classList.remove('mls-source-row__state--manual');
          sourceState.classList.add('mls-source-row__state--empty');
        }
      }
    } else {
      const file = currentSourceFile();
      if (file) {
        previewUrl = URL.createObjectURL(file);
        previewObjectUrl = previewUrl;
        displayName = file.name || 'Uploaded front image';
        sourceLabel = 'Current uploaded front image';
        if (sourceState) {
          sourceState.textContent = 'AUTO';
          sourceState.classList.remove('mls-source-row__state--manual', 'mls-source-row__state--empty');
        }
      } else {
        previewUrl = findFrontImagePreviewUrl() || draftInfo?.imageUrl || '';
        if (previewUrl) {
          displayName = 'Saved Meesho front image';
          sourceLabel = 'Current saved front image';
          if (sourceState) {
            sourceState.textContent = 'AUTO';
            sourceState.classList.remove('mls-source-row__state--manual', 'mls-source-row__state--empty');
          }
        } else {
          displayName = 'No current Meesho image detected';
          sourceLabel = 'Waiting for current image';
          if (sourceState) {
            sourceState.textContent = 'EMPTY';
            sourceState.classList.remove('mls-source-row__state--manual');
            sourceState.classList.add('mls-source-row__state--empty');
          }
        }
      }
    }

    updatePreviewFromSource({
      previewUrl,
      previewObjectUrl,
      fileName: displayName,
      strategy: sourceLabel
    });
  }

  function attachSourceListener() {
    const refresh = () => setTimeout(syncSourcePreview, 80);
    getPageFileInputs().forEach(input => {
      if (!input || input.dataset.mlsSourceListener === '1') return;
      input.dataset.mlsSourceListener = '1';
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
    });
  }

  function inject() {
    const card = findBankSettlementCard();
    if (!card) return;
    const breakdown = readBreakdown(card);
    if (breakdown.shipping == null) return;

    currentShipping = breakdown.shipping;
    currentMeeshoPrice = breakdown.meeshoPrice;
    attachSourceListener();

    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = buildBox(breakdown.shipping);
      card.insertAdjacentElement('afterend', box);
    } else if (box.previousElementSibling !== card) {
      card.insertAdjacentElement('afterend', box);
    }
    const currentValue = document.getElementById('mls-current-shipping');
    const nextValue = `₹${breakdown.shipping}`;
    if (currentValue && !running && currentValue.textContent !== nextValue) {
      currentValue.textContent = nextValue;
    }
  }

  window.addEventListener('mls:catalog-image', event => {
    const detail = event.detail || {};
    const resetContext = Boolean(detail.resetContext);
    const nextDraft = normalizeCatalogDraft(detail || null);
    if (resetContext) {
      draftInfo = null;
      currentCatalogSignature = '';
      const resetApi = window.MeeshoAPI;
      if (resetApi?.cache) {
        resetApi.cache.categoryId = null;
        resetApi.cache.supplierId = null;
      }
    }
    const mergedDraft = mergeCatalogDraft(resetContext ? null : draftInfo, nextDraft);
    const nextSignature = catalogSignature(mergedDraft);
    const signatureChanged = Boolean(nextSignature && nextSignature !== currentCatalogSignature);
    draftInfo = mergedDraft;
    currentCatalogSignature = nextSignature || currentCatalogSignature;
    const api = configureApi();
    if (api) {
      if (mergedDraft.sscatId) api.setCategory(Number(mergedDraft.sscatId));
      if (mergedDraft.supplierId) {
        if (typeof api.setSupplier === 'function') api.setSupplier(Number(mergedDraft.supplierId));
        else api.cache.supplierId = Number(mergedDraft.supplierId);
      }
    }
    if (signatureChanged) {
      if (running && !resetContext) {
        updateProgress();
        return;
      }
      resetOptimizerState({
        clearPreview: sourceMode !== SOURCE_MODE_MANUAL
      });
      currentCatalogSignature = nextSignature || currentCatalogSignature;
      clearAutoStartQueue();
      if (!running) syncSourcePreview();
      return;
    }
    if (!running) syncSourcePreview();
    updateProgress();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const box = document.getElementById(BOX_ID);
    if (box?.classList.contains('mls-maximized')) toggleMaximize(box, false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (
      changes.user_info ||
      changes.auth_token ||
      changes.supabaseSession
    ) {
      checkSubscription().then(renderPlanStatus);
    }
  });

  const start = () => {
    inject();
    let injectTimer = null;
    new MutationObserver(() => {
      const box = document.getElementById(BOX_ID);
      if (box && document.body.contains(box)) return;

      clearTimeout(injectTimer);
      injectTimer = setTimeout(inject, 120);
    }).observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
