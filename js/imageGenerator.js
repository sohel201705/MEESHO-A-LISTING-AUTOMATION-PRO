

const ImageGenerator = {
  settings: {
    // All settings now randomized - no manual controls
    customText: "",
    textPosition: "bottom",
    textColor: "#ffffff",
    textBgColor: "#48B3AF",
  },

  badgeCache: {},

  updateSettings: function (newSettings) {
    // Only keep text settings, rest is random
    if (newSettings.customText !== undefined)
      this.settings.customText = newSettings.customText;
    if (newSettings.textPosition !== undefined)
      this.settings.textPosition = newSettings.textPosition;
    if (newSettings.textBgColor !== undefined)
      this.settings.textBgColor = newSettings.textBgColor;
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

  preloadBadges: async function () {
    const promises = [];
    for (let i = 1; i <= 25; i++) promises.push(this.loadBadge(i));
    await Promise.all(promises);
  },

  // Vibrant colors (no white)
  randomColor: function () {
    const colors = [
      "#e74c3c",
      "#3498db",
      "#2ecc71",
      "#f39c12",
      "#9b59b6",
      "#1abc9c",
      "#e67e22",
      "#34495e",
      "#16a085",
      "#c0392b",
      "#2980b9",
      "#8e44ad",
      "#27ae60",
      "#d35400",
      "#2c3e50",
      "#f1c40f",
      "#00bcd4",
      "#ff5722",
      "#673ab7",
      "#ff9800",
      "#4caf50",
      "#03a9f4",
      "#e91e63",
      "#795548",
      "#607d8b",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  getPosition: function (pos, w, h, size, margin) {
    const safeMargin = Math.max(margin, 10);
    const maxX = Math.max(0, w - size - safeMargin);
    const maxY = Math.max(0, h - size - safeMargin);

    switch (pos) {
      case "top-left":
        return { x: safeMargin, y: safeMargin };
      case "top-right":
        return { x: maxX, y: safeMargin };
      case "bottom-left":
        return { x: safeMargin, y: maxY };
      case "bottom-right":
        return { x: maxX, y: maxY };
      case "center":
        return { x: (w - size) / 2, y: (h - size) / 2 };
      default:
        return {
          x: safeMargin + Math.random() * Math.max(10, maxX - safeMargin),
          y: safeMargin + Math.random() * Math.max(10, maxY - safeMargin),
        };
    }
  },

  drawBadges: async function (ctx, w, h, borderSize, variationIndex) {
    const count = this.settings.badgeCount;
    if (count === 0) return;

    const size = this.settings.badgeSize;
    const availablePos = [...this.settings.badgePositions];
    const margin = borderSize + 15;

    for (let i = 0; i < count; i++) {
      const randomArray = new Uint32Array(1);
      crypto.getRandomValues(randomArray);
      const badgeNum = (randomArray[0] % 25) + 1;

      const badge = await this.loadBadge(badgeNum);

      if (badge) {
        let pos = "random";
        if (availablePos.length > 0 && !availablePos.includes("random")) {
          pos = availablePos[(variationIndex + i) % availablePos.length];
        }

        const coords = this.getPosition(pos, w, h, size, margin);

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.drawImage(badge, coords.x, coords.y, size, size);
        ctx.restore();
      }
    }
  },

  // Draw custom text on image
  drawText: function (ctx, w, h, borderSize) {
    const text = this.settings.customText;
    if (!text || text.trim() === "") return;

    const fontSize = Math.max(16, Math.min(w / 15, 36));
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;

    const textWidth = ctx.measureText(text).width;
    const padding = 12;
    const boxHeight = fontSize + padding * 2;
    const boxWidth = textWidth + padding * 2;

    let x, y;
    switch (this.settings.textPosition) {
      case "top":
        x = (w - boxWidth) / 2;
        y = borderSize + 10;
        break;
      case "bottom":
      default:
        x = (w - boxWidth) / 2;
        y = h - borderSize - boxHeight - 10;
        break;
    }

    // Draw background
    ctx.fillStyle = this.settings.textBgColor;
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 8);
    ctx.fill();

    // Draw text
    ctx.fillStyle = this.settings.textColor;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padding, y + boxHeight / 2);
  },

  // Main generation - FAST, NO ROTATION
  generateVariations: async function (file, count) {
    await this.preloadBadges();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File read failed"));

      reader.onload = async (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Image load failed"));

        img.onload = async () => {
          const variations = [];
          const w = img.width;
          const h = img.height;

          for (let i = 0; i < count; i++) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");

              if (i === 0) {
                // Original - minimal change
                ctx.drawImage(img, 0, 0);
                ctx.fillStyle = "rgba(0,0,0,0.001)";
                ctx.fillRect(0, 0, 1, 1);
              } else {
                // Border variation
                const baseBorder = this.settings.borderWidth;
                const borderVar = Math.floor(Math.random() * 6) - 3;
                const borderSize = Math.max(15, baseBorder + borderVar);
                const innerW = w - borderSize * 2;
                const innerH = h - borderSize * 2;

                // 1. Draw border/background
                this.drawBorder(ctx, w, h, borderSize, i);

                // 2. Draw image (NO ROTATION)
                ctx.drawImage(img, borderSize, borderSize, innerW, innerH);

                // 3. Apply subtle effect (no rotation)
                this.applyEffect(ctx, borderSize, innerW, innerH, i);

                // 4. Draw badges
                await this.drawBadges(ctx, w, h, borderSize, i);

                // 5. Draw custom text
                this.drawText(ctx, w, h, borderSize);

                // 6. Add unique noise
                this.addNoise(ctx, w, h, i);
              }

              variations.push({
                name: i === 0 ? "Original" : "Var-" + i,
                dataUrl: canvas.toDataURL(
                  "image/jpeg",
                  this.settings.imageQuality,
                ),
              });
            } catch (err) {
              console.error("Variation", i, "error:", err);
            }
          }

          resolve(variations);
        };

        img.src = e.target.result;
      };

      reader.readAsDataURL(file);
    });
  },

  // Draw colored border
  drawBorder: function (ctx, w, h, borderSize, index) {
    const color1 = this.randomColor();
    const color2 = this.randomColor();
    const type = index % 5;

    switch (type) {
      case 0: // Solid
        ctx.fillStyle = color1;
        ctx.fillRect(0, 0, w, h);
        break;
      case 1: // Horizontal gradient
        const hGrad = ctx.createLinearGradient(0, 0, w, 0);
        hGrad.addColorStop(0, color1);
        hGrad.addColorStop(1, color2);
        ctx.fillStyle = hGrad;
        ctx.fillRect(0, 0, w, h);
        break;
      case 2: // Vertical gradient
        const vGrad = ctx.createLinearGradient(0, 0, 0, h);
        vGrad.addColorStop(0, color1);
        vGrad.addColorStop(1, color2);
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, w, h);
        break;
      case 3: // Diagonal gradient
        const dGrad = ctx.createLinearGradient(0, 0, w, h);
        dGrad.addColorStop(0, color1);
        dGrad.addColorStop(1, color2);
        ctx.fillStyle = dGrad;
        ctx.fillRect(0, 0, w, h);
        break;
      case 4: // Radial gradient
        const rGrad = ctx.createRadialGradient(
          w / 2,
          h / 2,
          0,
          w / 2,
          h / 2,
          Math.max(w, h) / 2,
        );
        rGrad.addColorStop(0, color1);
        rGrad.addColorStop(1, color2);
        ctx.fillStyle = rGrad;
        ctx.fillRect(0, 0, w, h);
        break;
    }

    // Draw border decoration
    const style = index % 4;
    ctx.strokeStyle = this.randomColor();
    ctx.lineWidth = 2;

    if (style === 1) ctx.setLineDash([4, 4]);
    else if (style === 2) ctx.setLineDash([10, 5]);
    else ctx.setLineDash([]);

    ctx.strokeRect(
      borderSize / 2,
      borderSize / 2,
      w - borderSize,
      h - borderSize,
    );
    ctx.setLineDash([]);
  },

  // Apply subtle effect (NO ROTATION)
  applyEffect: function (ctx, borderSize, innerW, innerH, index) {
    const effect = index % 5;

    switch (effect) {
      case 1: // Brighten
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(borderSize, borderSize, innerW, innerH);
        break;
      case 2: // Darken
        ctx.fillStyle = "rgba(0,0,0,0.05)";
        ctx.fillRect(borderSize, borderSize, innerW, innerH);
        break;
      case 3: // Warm tint
        ctx.fillStyle = "rgba(255,200,100,0.05)";
        ctx.fillRect(borderSize, borderSize, innerW, innerH);
        break;
      case 4: // Cool tint
        ctx.fillStyle = "rgba(100,150,255,0.05)";
        ctx.fillRect(borderSize, borderSize, innerW, innerH);
        break;
      // case 0: No effect
    }
  },

  // Add noise for uniqueness
  addNoise: function (ctx, w, h, index) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const noiseCount = 30 + index * 10;

    for (let i = 0; i < noiseCount; i++) {
      const px = Math.floor(Math.random() * (data.length / 4)) * 4;
      const noise = Math.floor(Math.random() * 6) - 3;
      data[px] = Math.min(255, Math.max(0, data[px] + noise));
      data[px + 1] = Math.min(255, Math.max(0, data[px + 1] + noise));
      data[px + 2] = Math.min(255, Math.max(0, data[px + 2] + noise));
    }

    // Unique signature
    const sig = Date.now() + index * 1000;
    const sigPx = (sig % (data.length / 4)) * 4;
    data[sigPx] = (data[sigPx] + index) % 256;

    ctx.putImageData(imageData, 0, 0);
  },
};

window.ImageGenerator = ImageGenerator;
