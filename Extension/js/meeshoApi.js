

const MeeshoAPI = {
  endpoints: {
    uploadImage:
      "https://supplier.meesho.com/api/cataloging/singleCatalogUpload/uploadSingleCatalogImages",
    fetchDuplicatePid:
      "https://supplier.meesho.com/api/cataloging/priceRecommendation/fetchDuplicatePid",
    getTransferPrice:
      "https://supplier.meesho.com/api/cataloging/singleCatalogUpload/getTransferPrice",
    fetchCategories:
      "https://supplier.meesho.com/api/cataloging/bulkCatalogUpload/fetchCategoryTreeOld",
  },

  cache: {
    supplierId: null,
    supplierTag: null,
    categoryId: null,
    browserId: null,
    price: 100,
    categories: null,
  },

  badgeCache: {},

  // Track shipping results
  shippingHistory: new Map(),

  // Keep generateVariation for fallback but use minimal by default
  generateVariation: async function (originalBlob, seed, strategy, bestParams) {
    // Use minimal variation for better PID matching
    return this.generateMinimalVariation(originalBlob, seed);
  },

  init: function () {
    this.detectAllValues();
    this.fetchCategories();
  },

  detectAllValues: function () {
    const browserId = this.getCookie("browser_id");
    const supplierTag = this.detectSupplierTag();
    const supplierId = this.detectSupplierId();
    const categoryId = this.detectCategoryId();
    const price = this.detectPrice();

    if (browserId) this.cache.browserId = browserId;
    if (supplierTag) this.cache.supplierTag = supplierTag;
    if (supplierId) this.cache.supplierId = supplierId;
    if (categoryId) this.cache.categoryId = categoryId;
    if (price) this.cache.price = price;
    if (supplierId || categoryId) {
      this.emitCatalogContext({
        supplierId: supplierId || this.cache.supplierId,
        sscatId: categoryId || this.cache.categoryId
      });
    }
  },
  detectSupplierTag: function () {
    try {
      for (const cookie of document.cookie.split("; ")) {
        if (!cookie.includes("_mixpanel")) continue;
        const value = cookie.slice(cookie.indexOf("=") + 1);
        const data = JSON.parse(decodeURIComponent(value));
        if (
          typeof data.Supplier_tag === "string" &&
          data.Supplier_tag.trim() !== ""
        ) {
          return data.Supplier_tag.trim();
        }
      }
    } catch (e) {
      console.error("Supplier tag detection failed", e);
    }
    return null;
  },
  getCookie: function (name) {
    const match = document.cookie.match(
      new RegExp("(^| )" + name + "=([^;]+)"),
    );
    return match ? decodeURIComponent(match[2]) : "";
  },

  detectSupplierId: function () {
    try {
      for (const cookie of document.cookie.split("; ")) {
        if (!cookie.includes("_mixpanel")) continue;
        const value = cookie.slice(cookie.indexOf("=") + 1);
        const data = JSON.parse(decodeURIComponent(value));
        const supplierId = Number(data.Supplier_id || data.supplier_id);
        if (supplierId > 0) return supplierId;
      }
    } catch (e) {}
    return null;
  },

  detectCategoryId: function () {
    return (
      this.cache.categoryId ||
      this.detectIdFromUrl([
        "sscat_id",
        "sscatId",
        "sub_sub_category_id",
        "category_id",
        "categoryId"
      ]) ||
      null
    );
  },

  detectIdFromUrl: function (keys) {
    try {
      const params = new URL(location.href).searchParams;
      for (const key of keys) {
        const value = params.get(key);
        if (/^\d+$/.test(String(value || "")) && Number(value) > 0) {
          return Number(value);
        }
      }
    } catch (e) {}
    return null;
  },

  detectPrice: function () {
    const inputs = document.querySelectorAll("input");
    for (const inp of inputs) {
      const name = (inp.name || "").toLowerCase();
      if (
        (name.includes("price") || name === "mrp") &&
        inp.value &&
        parseInt(inp.value) > 0
      ) {
        return parseInt(inp.value);
      }
    }
    return 100;
  },

  setCategory: function (id) {
    const parsed = parseInt(id);
    if (parsed > 0) {
      const changed = Number(this.cache.categoryId) !== parsed;
      this.cache.categoryId = parsed;
      if (changed) this.emitCatalogContext({ sscatId: parsed });
    }
  },

  setSupplier: function (id) {
    const parsed = parseInt(id);
    if (parsed > 0) {
      const changed = Number(this.cache.supplierId) !== parsed;
      this.cache.supplierId = parsed;
      if (changed) this.emitCatalogContext({ supplierId: parsed });
    }
  },

  emitCatalogContext: function (detail) {
    try {
      const payload = {
        sscatId: detail?.sscatId || detail?.sscat_id || this.cache.categoryId || null,
        supplierId: detail?.supplierId || detail?.supplier_id || this.cache.supplierId || null,
        imageUrl: detail?.imageUrl || detail?.image_url || null
      };
      if (payload.sscatId || payload.supplierId || payload.imageUrl) {
        window.dispatchEvent(new CustomEvent("mls:catalog-image", { detail: payload }));
      }
    } catch (e) {}
  },

  getHeaders: function () {
    return {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json;charset=UTF-8",
      "client-type": "d-web",
      "client-package-version": "1.0.1",
      "browser-id": this.cache.browserId || "",
      identifier: this.cache.supplierTag || "",
      "supplier-id": this.cache.supplierId ? String(this.cache.supplierId) : "",
    };
  },

  fetchCategories: async function () {
    if (this.cache.categories) return this.cache.categories;
    try {
      const resp = await fetch(this.endpoints.fetchCategories, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          bulk_upload_enabled: false,
          supplier_id: this.cache.supplierId,
          identifier: this.cache.supplierTag,
        }),
        credentials: "include",
      });
      if (!resp.ok) return null;
      const result = await resp.json();
      if (result.items?.length > 0) {
        const subCat = result.items.find((i) => i.type === "sub-sub-category");
        if (subCat?.data) {
          this.cache.categories = subCat.data.map((c) => ({
            id: parseInt(c.id),
            name: c.name,
            parentName: c.parent_name,
          }));
          return this.cache.categories;
        }
      }
    } catch (e) {
      console.error("Categories error:", e);
    }
    return null;
  },

  getCategories: function () {
    return this.cache.categories || [];
  },

  uploadImage: async function (blob, filename) {
    const formData = new FormData();
    formData.append("file", blob, filename || "img-" + Date.now() + ".jpg");
    formData.append("data", "undefined");
    try {
      const resp = await fetch(this.endpoints.uploadImage, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "browser-id": this.cache.browserId || "",
          "client-type": "d-web",
          "client-package-version": "1.0.1",
          identifier: this.cache.supplierTag || "",
          "supplier-id": this.cache.supplierId
            ? String(this.cache.supplierId)
            : "",
        },
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) return null;
      const result = await resp.json();
      return result.image;
    } catch (e) {
      console.error("Upload error:", e);
      return null;
    }
  },

  fetchDuplicatePid: async function (imageUrl, categoryId) {
    const sscatId = Number(categoryId || this.detectCategoryId());
    if (!(sscatId > 0)) return null;
    this.cache.categoryId = sscatId;
    this.emitCatalogContext({ sscatId });
    try {
      const resp = await fetch(this.endpoints.fetchDuplicatePid, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          is_old_image_match_enabled: true,
          sscat_id: sscatId,
          image_url: imageUrl,
        }),
        credentials: "include",
      });
      if (!resp.ok) return null;
      const result = await resp.json();
      return result.data?.duplicate_pid || null;
    } catch (e) {
      return null;
    }
  },

  getShippingCharges: async function (imageUrl) {
    const sscatId = Number(this.detectCategoryId());
    if (!(sscatId > 0)) return null;
    this.cache.categoryId = sscatId;
    const supplierId = this.cache.supplierId;
    const price = this.cache.price || 100;
    this.emitCatalogContext({ sscatId, supplierId });

    let duplicatePid = null;
    if (imageUrl)
      duplicatePid = await this.fetchDuplicatePid(imageUrl, sscatId);

    try {
      const body = {
        sscat_id: sscatId,
        gst_percentage: 0,
        price: price,
        supplier_id: supplierId,
        gst_type: "GSTIN",
        image_url: imageUrl,
      };
      if (duplicatePid) body.duplicate_pid = duplicatePid;

      const resp = await fetch(this.endpoints.getTransferPrice, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!resp.ok) return null;
      const result = await resp.json();
      return { shippingCharges: result.shipping_charges, duplicatePid };
    } catch (e) {
      return null;
    }
  },

  parseShippingValue: function (value) {
    if (value == null) return null;
    const raw = typeof value === 'string' ? value : String(value);
    const cleaned = raw.replace(/[^\d.]/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) && num > 0 ? num : null;
  },

  // FAST Smart Search - Only show verified PID results
  smartSearch: async function (
    originalBlob,
    targetShipping,
    maxAttempts,
    onProgress,
    onFound,
    shouldStopFn,
    baselineShipping,
  ) {
    this.detectAllValues();

    const results = [];
    let bestResult = null;
    let bestSeenShipping = null;
    let attempt = 0;
    let noPidCount = 0;
    let verifiedCount = 0;

    while (attempt < maxAttempts) {
      if (shouldStopFn && shouldStopFn()) {
        break;
      }
      attempt++;
      if (onProgress) {
        onProgress(
          attempt,
          maxAttempts,
          bestSeenShipping,
          noPidCount,
          { phase: "generating", attempt }
        );
      }

      try {
        const variation = await this.generateVariation(originalBlob, attempt);
        if (onProgress) {
          onProgress(
            attempt,
            maxAttempts,
            bestSeenShipping,
            noPidCount,
            {
              phase: "uploading",
              attempt,
              previewDataUrl: variation.dataUrl,
              strategy: variation.strategy,
            }
          );
        }
        const imageUrl = await this.uploadImage(
          variation.blob,
          `v${attempt}.jpg`,
        );
        if (!imageUrl) {
          if (onProgress) {
            onProgress(
            attempt,
            maxAttempts,
            bestSeenShipping,
            noPidCount,
            {
              phase: "upload_failed",
                attempt,
                previewDataUrl: variation.dataUrl,
                strategy: variation.strategy,
              }
            );
          }
          continue;
        }

        if (onProgress) {
          onProgress(
            attempt,
            maxAttempts,
            bestSeenShipping,
            noPidCount,
            {
              phase: "matching",
              attempt,
              previewDataUrl: variation.dataUrl,
              uploadedUrl: imageUrl,
              strategy: variation.strategy,
            }
          );
        }

        const priceData = await this.getShippingCharges(imageUrl);
        if (!priceData) continue;

        const pid = priceData.duplicatePid;
        const shipping = this.parseShippingValue(priceData.shippingCharges);

        if (pid && shipping != null) {
          verifiedCount++;
          if (bestSeenShipping == null || shipping < bestSeenShipping) {
            bestSeenShipping = shipping;
          }
          const isImprovement =
            !Number.isFinite(Number(baselineShipping)) ||
            shipping < Number(baselineShipping);
          const result = {
            name: `Var-${attempt}`,
            dataUrl: variation.dataUrl,
            uploadedUrl: imageUrl,
            shippingCost: shipping,
            duplicatePid: pid,
            isVerified: true,
            strategy: variation.strategy,
            isImprovement,
            savings: Number.isFinite(Number(baselineShipping))
              ? Math.max(0, Number(baselineShipping) - shipping)
              : 0,
            aboveCurrent: Number.isFinite(Number(baselineShipping))
              ? Math.max(0, shipping - Number(baselineShipping))
              : 0,
          };

          results.push(result);

          if (!bestResult || shipping < bestResult.shippingCost) {
            bestResult = result;
          }

          if (onProgress) {
            onProgress(
              attempt,
              maxAttempts,
              bestSeenShipping,
              noPidCount,
              {
                phase: isImprovement ? "verified" : "not_lower",
                attempt,
                previewDataUrl: variation.dataUrl,
                uploadedUrl: imageUrl,
                strategy: variation.strategy,
                duplicatePid: pid,
                shippingCost: shipping,
                verifiedCount,
                viableCount: results.filter(item => item.isImprovement).length,
                isImprovement,
              }
            );
          }

          if (isImprovement && shipping <= targetShipping) {
            if (onFound) onFound(result);
            break;
          }
        } else {
          noPidCount++;
          if (onProgress) {
            onProgress(
              attempt,
              maxAttempts,
              bestSeenShipping,
              noPidCount,
              {
                phase: "no_match",
                attempt,
                previewDataUrl: variation.dataUrl,
                uploadedUrl: imageUrl,
                strategy: variation.strategy,
              }
            );
          }
        }

        await new Promise((r) => setTimeout(r, 20)); // Fast!
      } catch (e) {
        console.error(`[${attempt}]`, e.message);
      }
    }

    results.sort((a, b) => a.shippingCost - b.shippingCost);

    return {
      success: results.length > 0,
      results: results.slice(0, 20),
      bestResult,
      bestSeenShipping,
      targetReached: bestSeenShipping != null && bestSeenShipping <= targetShipping,
      attempts: attempt,
      noPidCount,
      verifiedCount,
      viableCount: results.filter(item => item.isImprovement).length,
    };
  },

  // Restored from the working shipping optimizer. Wider randomized borders
  // and badges produce a broader set of duplicate PID candidates.
  generateVariation: async function (originalBlob, seed) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(originalBlob);
      img.onload = async () => {
        URL.revokeObjectURL(objectUrl);
        const w = img.width;
        const h = img.height;
        const border = 20 + Math.floor(Math.random() * 60);
        const finalW = w + border * 2;
        const finalH = h + border * 2;

        const canvas = document.createElement("canvas");
        canvas.width = finalW;
        canvas.height = finalH;
        const ctx = canvas.getContext("2d");

        const colors = [
          "#e74c3c",
          "#3498db",
          "#2ecc71",
          "#f39c12",
          "#9b59b6",
          "#1abc9c",
          "#e67e22",
          "#16a085",
          "#ff5722",
          "#673ab7",
          "#4caf50",
          "#03a9f4",
          "#e91e63",
          "#8bc34a",
          "#ff9800",
          "#00bcd4",
        ];
        const c1 = colors[Math.floor(Math.random() * colors.length)];
        const c2 = colors[Math.floor(Math.random() * colors.length)];
        const gradType = Math.floor(Math.random() * 4);

        if (gradType === 0) {
          ctx.fillStyle = c1;
        } else {
          let grad;
          if (gradType === 1) grad = ctx.createLinearGradient(0, 0, finalW, 0);
          else if (gradType === 2)
            grad = ctx.createLinearGradient(0, 0, 0, finalH);
          else grad = ctx.createLinearGradient(0, 0, finalW, finalH);
          grad.addColorStop(0, c1);
          grad.addColorStop(1, c2);
          ctx.fillStyle = grad;
        }
        ctx.fillRect(0, 0, finalW, finalH);

        ctx.drawImage(img, border, border, w, h);

        const badgeCount = 2 + Math.floor(Math.random() * 2);
        await this.addBadges(ctx, finalW, finalH, border, badgeCount);

        this.addNoise(ctx, finalW, finalH, seed);

        const quality = 0.75 + Math.random() * 0.15;
        const strategy = `Vibrant border ${border}px + ${badgeCount} badges`;

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not generate image variation"));
              return;
            }
            resolve({
              blob,
              dataUrl: canvas.toDataURL("image/jpeg", quality),
              strategy,
            });
          },
          "image/jpeg",
          quality,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Load failed"));
      };
      img.src = objectUrl;
    });
  },

  // Working optimizer badge layout.
  addBadges: async function (ctx, w, h, border, count) {
    const positions = [
      { x: border + 5, y: border + 5 },
      { x: w - border - 150, y: border + 5 },
      { x: border + 5, y: h - border - 150 },
      { x: w - border - 150, y: h - border - 150 },
    ];

    const used = new Set();
    for (let i = 0; i < count && i < positions.length; i++) {
      let num;
      do {
        num = 1 + Math.floor(Math.random() * 25);
      } while (used.has(num));
      used.add(num);

      const size = 50 + Math.floor(Math.random() * 150);
      try {
        const badge = await this.loadBadge(num);
        if (badge) {
          ctx.drawImage(badge, positions[i].x, positions[i].y, size, size);
        }
      } catch (e) {}
    }
  },

  // Add noise
  addNoise: function (ctx, w, h, seed) {
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    for (let i = 0; i < 50; i++) {
      const px = Math.floor(Math.random() * (d.length / 4)) * 4;
      d[px] = Math.min(
        255,
        Math.max(0, d[px] + Math.floor(Math.random() * 6) - 3),
      );
    }
    d[((Date.now() + seed) % (d.length / 4)) * 4] = seed % 256;
    ctx.putImageData(data, 0, 0);
  },

  loadBadge: async function (num) {
    if (this.badgeCache[num]) return this.badgeCache[num];
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.badgeCache[num] = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = chrome.runtime.getURL("Badge/badge" + num + ".png");
    });
  },

  isReady: function () {
    this.detectAllValues();
    return this.cache.supplierId !== null;
  },
  isValidCatalogPage: function () {
    return (
      window.location.href.includes("supplier.meesho.com") &&
      window.location.href.includes("/cataloging/")
    );
  },
};

MeeshoAPI.init();
window.MeeshoAPI = MeeshoAPI;
