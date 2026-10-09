
(function () {
  if (window.__meeshoMergedIntercepted) return;
  window.__meeshoMergedIntercepted = true;

  const AUTOFILL_TARGET = 'fetchProductDetailsV3';

  function savePayload(data) {
    let el = document.getElementById('__mfpd_data');
    if (!el) {
      el = document.createElement('script');
      el.id = '__mfpd_data';
      el.type = 'application/json';
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = JSON.stringify(data);
    window.dispatchEvent(new CustomEvent('__mfpd', { detail: data }));
  }

  const DRAFT_TARGET = 'fetchSingleCatalogDraft';
  const SAVE_TARGETS = ['saveSingleCatalogDraft', 'submitSingleCatalog'];
  const matchesSave = (url) => SAVE_TARGETS.some((t) => url.includes(t));
  const TRANSFER_PRICE_URL = 'getTransferPrice';
  const DUPLICATE_PID_URL = 'fetchDuplicatePid';
  const CATALOG_CONTEXT_TARGETS = [
    DRAFT_TARGET,
    TRANSFER_PRICE_URL,
    DUPLICATE_PID_URL,
    ...SAVE_TARGETS
  ];
  const shouldCaptureCatalogContext = (url) =>
    CATALOG_CONTEXT_TARGETS.some((target) => String(url || '').includes(target));
  const isTransientPricingContext = (url) =>
    [TRANSFER_PRICE_URL, DUPLICATE_PID_URL].some((target) => String(url || '').includes(target));

  let pidOverride = null;
  let lastSaveBody = null;
  let lastDraftData = null;
  let lastDraftDetail = null;
  let catalogMemory = {};
  let lastPageKey = `${location.pathname}${location.search}${location.hash}`;
  let userEmail = null;

  function positiveId(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? String(num) : null;
  }

  function getCatalogAssetKey(detail = {}) {
    return String(detail.fileRefId || detail.file_ref_id || detail.imageUrl || detail.image_url || detail.front_image_url || '');
  }

  function dispatchCatalogReset() {
    window.dispatchEvent(
      new CustomEvent('mls:catalog-image', {
        detail: {
          resetContext: true,
          imageUrl: '',
          fileRefId: '',
          file_ref_id: '',
          sscatId: '',
          supplierId: ''
        }
      })
    );
  }

  function resetCatalogMemory() {
    catalogMemory = {};
    lastDraftDetail = null;
    lastDraftData = null;
    lastSaveBody = null;
    pidOverride = null;
    dispatchCatalogReset();
  }

  function resetIfPageChanged() {
    const pageKey = `${location.pathname}${location.search}${location.hash}`;
    if (pageKey === lastPageKey) return;
    lastPageKey = pageKey;
    resetCatalogMemory();
  }

  try {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(resetIfPageChanged, 0);
      return result;
    };
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(resetIfPageChanged, 0);
      return result;
    };
    window.addEventListener('popstate', () => setTimeout(resetIfPageChanged, 0));
  } catch (_) {}

  function mergeCatalogMemory(detail = {}, options = {}) {
    resetIfPageChanged();
    const incomingAssetKey = getCatalogAssetKey(detail);
    const currentAssetKey = getCatalogAssetKey(catalogMemory);
    const assetChanged =
      options.resetOnAssetChange &&
      incomingAssetKey &&
      currentAssetKey &&
      incomingAssetKey !== currentAssetKey;
    if (assetChanged) {
      catalogMemory = {};
      lastDraftDetail = null;
      dispatchCatalogReset();
    }

    const next = { ...catalogMemory };
    const sscatId = positiveId(
      detail.sscatId ??
      detail.sscat_id ??
      detail.sub_sub_category_id ??
      detail.subSubCategoryId ??
      detail.categoryId ??
      detail.category_id
    );
    const supplierId = positiveId(
      detail.supplierId ??
      detail.supplier_id ??
      detail.supplierID
    );

    if (sscatId) next.sscatId = sscatId;
    if (supplierId) next.supplierId = supplierId;
    if (detail.imageUrl || detail.image_url || detail.front_image_url) {
      next.imageUrl = detail.imageUrl || detail.image_url || detail.front_image_url;
    }
    if (detail.fileRefId || detail.file_ref_id) {
      next.fileRefId = detail.fileRefId || detail.file_ref_id;
    }
    if (detail.uploadedBy || detail.uploaded_by) {
      next.uploadedBy = detail.uploadedBy || detail.uploaded_by;
    }
    if (detail.duplicatePid || detail.duplicate_pid) {
      next.duplicatePid = detail.duplicatePid || detail.duplicate_pid;
    }

    catalogMemory = next;
    lastDraftDetail = { ...(lastDraftDetail || {}), ...catalogMemory };
    window.dispatchEvent(new CustomEvent('mls:catalog-image', { detail: lastDraftDetail }));
  }

  function extractCatalogContext(value, depth = 0) {
    if (depth > 8 || value == null) return {};
    if (typeof value !== 'object') return {};

    const found = {};
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = extractCatalogContext(item, depth + 1);
        Object.assign(found, child);
      }
      return found;
    }

    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (['sscatid', 'sscat_id', 'sub_sub_category_id', 'subsubcategoryid', 'categoryid', 'category_id'].includes(normalizedKey)) {
        const id = positiveId(raw);
        if (id) found.sscatId = id;
      }
      if (['supplierid', 'supplier_id'].includes(normalizedKey)) {
        const id = positiveId(raw);
        if (id) found.supplierId = id;
      }
      if (['file_ref_id', 'filerefid'].includes(normalizedKey) && raw) {
        found.fileRefId = String(raw);
        const parts = String(raw).split('-');
        if (!found.supplierId && parts.length >= 2) {
          const id = positiveId(parts[1]);
          if (id) found.supplierId = id;
        }
      }
      if (['front_image_url', 'image_url', 'imageurl'].includes(normalizedKey) && raw) {
        found.imageUrl = String(raw);
      }

      if (raw && typeof raw === 'object') {
        const child = extractCatalogContext(raw, depth + 1);
        Object.assign(found, child);
      }
    }

    return found;
  }

  function stripCatalogAssetFields(detail = {}) {
    const next = { ...detail };
    delete next.imageUrl;
    delete next.image_url;
    delete next.front_image_url;
    delete next.fileRefId;
    delete next.file_ref_id;
    delete next.duplicatePid;
    delete next.duplicate_pid;
    return next;
  }

  function captureCatalogContextFromText(text, options = {}) {
    if (!text || typeof text !== 'string') return;
    try {
      const parsed = JSON.parse(text);
      const extracted = extractCatalogContext(parsed);
      const detail = options.ignoreAssets ? stripCatalogAssetFields(extracted) : extracted;
      if (detail.sscatId || detail.supplierId || detail.imageUrl || detail.fileRefId) {
        mergeCatalogMemory(detail);
      }
    } catch (_) {
      const sscatMatch = text.match(/"(?:sscat_id|sub_sub_category_id|sscatId|category_id|categoryId)"\s*:\s*"?(\d+)"?/i);
      const supplierMatch = text.match(/"(?:supplier_id|supplierId)"\s*:\s*"?(\d+)"?/i);
      const detail = {};
      if (sscatMatch) detail.sscatId = sscatMatch[1];
      if (supplierMatch) detail.supplierId = supplierMatch[1];
      if (detail.sscatId || detail.supplierId) mergeCatalogMemory(detail);
    }
  }

  function captureCatalogContextFromUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      const detail = {
        sscatId:
          parsed.searchParams.get('sscat_id') ||
          parsed.searchParams.get('sscatId') ||
          parsed.searchParams.get('sub_sub_category_id') ||
          parsed.searchParams.get('category_id') ||
          parsed.searchParams.get('categoryId'),
        supplierId:
          parsed.searchParams.get('supplier_id') ||
          parsed.searchParams.get('supplierId')
      };
      if (detail.sscatId || detail.supplierId) mergeCatalogMemory(detail);
    } catch (_) {}
  }

  function captureEmail(text) {
    if (userEmail || !text || typeof text !== 'string') return;
    const m = text.match(
      /"(?:uploaded_by|email|user_email|emailId|emailID)"\s*:\s*"([^"]+@[^"]+)"/
    );
    if (m) userEmail = m[1];
  }

  function maybeForwardShippingCharges(text) {
    try {
      const data = JSON.parse(text);
      const sc =
        data && (data.shipping_charges ?? (data.data && data.data.shipping_charges));
      if (sc != null) {
        window.dispatchEvent(
          new CustomEvent('mls:shipping-charges', { detail: { shipping_charges: sc } })
        );
      }
    } catch (_) {}
  }

  function maybeRewriteSaveBody(body) {
    if (pidOverride === null) return body;
    if (typeof body !== 'string') return body;
    try {
      const parsed = JSON.parse(body);
      const products = parsed && parsed.products;
      if (Array.isArray(products) && products.length) {
        for (const p of products) {
          if (p && 'duplicate_pid' in p) p.duplicate_pid = pidOverride;
        }
        return JSON.stringify(parsed);
      }
    } catch (_) {}
    return body;
  }

  function handleDraftData(data) {
    try {
      const draft = data?.data?.products ? data.data : data;
      lastDraftData = draft;
      const product = draft && draft.products && draft.products[0];
      const imageUrl =
        product?.image_data?.front_image_url ||
        product?.front_image_url ||
        product?.image_url ||
        null;
      const fileRefId = draft && draft.file_ref_id;
      const sscatId =
        draft?.sub_sub_category_id ||
        draft?.sscat_id ||
        draft?.sscatId ||
        draft?.subSubCategoryId ||
        draft?.category_id ||
        draft?.categoryId ||
        product?.sub_sub_category_id ||
        product?.sscat_id ||
        product?.sscatId ||
        product?.subSubCategoryId ||
        product?.category_id ||
        product?.categoryId ||
        null;
      let supplierId = Number(
        draft?.supplier_id ||
        draft?.supplierId ||
        draft?.supplierID ||
        product?.supplier_id ||
        product?.supplierId ||
        product?.supplierID
      ) || null;
      if (fileRefId) {
        const parts = String(fileRefId).split('-');
        if (!supplierId && parts.length >= 2) {
          supplierId = parseInt(parts[1], 10) || null;
        }
      }

      if (!userEmail && draft && typeof draft.uploaded_by === 'string') {
        userEmail = draft.uploaded_by;
      }

      const detail = {
        imageUrl,
        fileRefId,
        sscatId,
        supplierId,
        uploadedBy: userEmail || null,
        duplicatePid: product && product.duplicate_pid,
      };
      mergeCatalogMemory(detail, { resetOnAssetChange: true });
    } catch (_) {}
  }

  window.addEventListener('mls:set-pid', (e) => {
    const v = e && e.detail && e.detail.pid;
    pidOverride = v ? parseInt(v, 10) : null;
  });

  window.addEventListener('mls:request-catalog-context', () => {
    if (!lastDraftDetail) return;
    window.dispatchEvent(
      new CustomEvent('mls:catalog-image', { detail: lastDraftDetail })
    );
  });

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = '';
    try {
      resetIfPageChanged();
      url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      captureCatalogContextFromUrl(url);
      if (args[1] && typeof args[1].body === 'string' && shouldCaptureCatalogContext(url)) {
        captureCatalogContextFromText(args[1].body, { ignoreAssets: isTransientPricingContext(url) });
      }
      if (matchesSave(url) && args[1] && typeof args[1].body === 'string') {
        args[1].body = maybeRewriteSaveBody(args[1].body);
        if (url.includes('saveSingleCatalogDraft')) lastSaveBody = args[1].body;
      }
    } catch (_) {}

    const response = await origFetch.apply(this, args);

    try {
      if (url.includes(AUTOFILL_TARGET)) {
        response.clone().json().then(savePayload).catch(() => {});
      }
      if (url.includes(DRAFT_TARGET)) {
        response.clone().json().then(handleDraftData).catch(() => {});
      }
      if (url.includes(TRANSFER_PRICE_URL)) {
        response.clone().text().then(maybeForwardShippingCharges).catch(() => {});
      }
      if (shouldCaptureCatalogContext(url) && response.headers.get('content-type')?.includes('json')) {
        const contextOptions = { ignoreAssets: isTransientPricingContext(url) };
        response.clone().text().then((text) => captureCatalogContextFromText(text, contextOptions)).catch(() => {});
      }
      if (!userEmail && response.headers.get('content-type')?.includes('json')) {
        response.clone().text().then(captureEmail).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let urlSeen = '';

    const origOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      resetIfPageChanged();
      urlSeen = String(url || '');
      captureCatalogContextFromUrl(urlSeen);
      return origOpen.call(this, method, url, ...rest);
    };

    const origSend = xhr.send;
    xhr.send = function (body) {
      try {
        if (typeof body === 'string' && shouldCaptureCatalogContext(urlSeen)) {
          captureCatalogContextFromText(body, { ignoreAssets: isTransientPricingContext(urlSeen) });
        }
        if (matchesSave(urlSeen) && typeof body === 'string') {
          body = maybeRewriteSaveBody(body);
          if (urlSeen.includes('saveSingleCatalogDraft')) lastSaveBody = body;
        }
      } catch (_) {}
      return origSend.call(this, body);
    };

    xhr.addEventListener('load', function () {
      try {
        const text = xhr.responseText;
        if (!text) return;
        if (urlSeen.includes(AUTOFILL_TARGET)) {
          try { savePayload(JSON.parse(text)); } catch (_) {}
        }
        if (urlSeen.includes(DRAFT_TARGET)) {
          try { handleDraftData(JSON.parse(text)); } catch (_) {}
        }
        if (urlSeen.includes(TRANSFER_PRICE_URL)) {
          maybeForwardShippingCharges(text);
        }
        if (shouldCaptureCatalogContext(urlSeen)) {
          captureCatalogContextFromText(text, { ignoreAssets: isTransientPricingContext(urlSeen) });
        }
        if (!userEmail) captureEmail(text);
      } catch (_) {}
    });

    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  function constructSaveBody(detail) {
    const draft = lastDraftData;
    if (!draft) return null;
    return {
      draft: true,
      file_ref_id: draft.file_ref_id,
      identifier: detail.identifier || null,
      products: draft.products || [],
      scale_id: draft.scale_id != null ? draft.scale_id : 1,
      sub_sub_category_id: draft.sub_sub_category_id,
      supplier_id: detail.supplierId || null,
      uploaded_by: userEmail,
      uploaded_by_supplier: true,
    };
  }

  window.addEventListener('mls:save-draft', async (e) => {
    const detail = (e && e.detail) || {};
    let bodyStr = lastSaveBody;
    if (!bodyStr) {
      const constructed = constructSaveBody(detail);
      if (!constructed) {
        window.dispatchEvent(
          new CustomEvent('mls:save-draft-result', {
            detail: { ok: false, error: 'no body', requestId: detail.requestId },
          })
        );
        return;
      }
      bodyStr = JSON.stringify(constructed);
    }
    bodyStr = maybeRewriteSaveBody(bodyStr);

    try {
      const headers = {
        'content-type': 'application/json;charset=UTF-8',
        accept: 'application/json, text/plain, */*',
        'client-type': 'd-web',
        'client-package-version': '1.0.1',
      };
      if (detail.identifier) headers['identifier'] = detail.identifier;
      if (detail.supplierId) headers['supplier-id'] = String(detail.supplierId);

      const res = await origFetch(
        '/api/cataloging/singleCatalogUploadDesktop/saveSingleCatalogDraft',
        { method: 'POST', credentials: 'include', headers, body: bodyStr }
      );
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      window.dispatchEvent(
        new CustomEvent('mls:save-draft-result', {
          detail: { ok: res.ok, status: res.status, data, requestId: detail.requestId },
        })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('mls:save-draft-result', {
          detail: { ok: false, error: String(err), requestId: detail.requestId },
        })
      );
    }
  });

  window.addEventListener('mls:visual-search', async (e) => {
    const detail = (e && e.detail) || {};
    const imageUrl = detail.imageUrl;
    if (!imageUrl) return;
    try {
      const imgRes = await origFetch(imageUrl);
      if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
      const blob = await imgRes.blob();

      const fd = new FormData();
      const filename = imageUrl.split('/').pop() || 'image.jpg';
      fd.append('image', blob, filename);
      fd.append('type', 'visual_search');

      const res = await origFetch('https://www.meesho.com/api/v1/image/upload', {
        method: 'POST',
        body: fd,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      window.dispatchEvent(
        new CustomEvent('mls:visual-search-result', {
          detail: { ok: res.ok, status: res.status, data, requestId: detail.requestId },
        })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('mls:visual-search-result', {
          detail: { ok: false, error: String(err), requestId: detail.requestId },
        })
      );
    }
  });

  window.addEventListener('mls:product-search', async (e) => {
    const detail = (e && e.detail) || {};
    const relativeUrl = detail.imageUrl;
    if (!relativeUrl) return;
    try {
      const res = await origFetch('https://www.meesho.com/api/v1/products/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'meesho-iso-country-code': 'IN',
        },
        body: JSON.stringify({
          type: 'text_search',
          page: detail.page != null ? detail.page : 1,
          offset: detail.offset != null ? detail.offset : 0,
          limit: detail.limit != null ? detail.limit : 20,
          image_url: relativeUrl,
          cursor: detail.cursor != null ? detail.cursor : null,
          isDevicePhone: false,
        }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      window.dispatchEvent(
        new CustomEvent('mls:product-search-result', {
          detail: { ok: res.ok, status: res.status, data, requestId: detail.requestId },
        })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('mls:product-search-result', {
          detail: { ok: false, error: String(err), requestId: detail.requestId },
        })
      );
    }
  });

  window.addEventListener('mls:transfer-price', async (e) => {
    const detail = e.detail || {};
    const body = detail.body;
    if (!body) return;
    try {
      const headers = {
        'content-type': 'application/json;charset=UTF-8',
        accept: 'application/json, text/plain, */*',
        'client-type': 'd-web',
        'client-package-version': '1.0.1',
      };
      if (detail.identifier) headers['identifier'] = detail.identifier;
      if (detail.supplierId) headers['supplier-id'] = String(detail.supplierId);

      const res = await origFetch(
        '/api/cataloging/singleCatalogUpload/getTransferPrice',
        { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) }
      );
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      window.dispatchEvent(
        new CustomEvent('mls:transfer-price-result', {
          detail: { ok: res.ok, status: res.status, data, requestId: detail.requestId },
        })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('mls:transfer-price-result', {
          detail: { ok: false, error: String(err), requestId: detail.requestId },
        })
      );
    }
  });
})();
