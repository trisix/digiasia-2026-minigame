/**
 * heartificial-generator.js
 * DigiAsia 2026 — HEART___IFICIAL Campaign Mini Game
 *
 * Public API (single function):
 *
 *   HeartificialGenerator.generate({
 *     photo:       HTMLCanvasElement | HTMLImageElement | File | Blob,
 *     drawing:     HTMLCanvasElement,           // user's handwritten text
 *     template:    string,                      // URL of chrome_overlay.png
 *     onProgress:  (pct) => void,               // optional 0–100
 *   }) → Promise<Blob>   (JPEG, quality 0.92)
 *
 * Compositing order (bottom → top):
 *   1. Black fill (#000)
 *   2. User photo — desaturated, high-contrast, SCREEN blend
 *   3. chrome_overlay.png — the KV chrome with transparent photo zone
 *   4. User drawing — centred in the lower-centre safe zone
 *
 * Output: 1920×1200 px (matches KV canvas)
 *
 * Effect pipeline (replicates PSB layer stack):
 *   grayscale(100%) → contrast(220%) → brightness(90%)
 *   → rendered with SCREEN composite operation onto black
 *   → subtle grain overlay (opacity ~0.08) to match texture layers
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HeartificialGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const OUTPUT_W = 1920;
  const OUTPUT_H = 1200;

  // Photo zone within the KV canvas (where the processed photo is visible).
  // Derived from PSB layer bboxes: photo smart objects span roughly the upper
  // 85% of the canvas, centred horizontally.
  const PHOTO_ZONE = {
    x:      0,
    y:      0,
    w:      OUTPUT_W,
    h:      Math.round(OUTPUT_H * 0.87),   // ~1041px, matches 'frame' layer bottom
  };

  // Drawing safe zone: bottom-centre of the canvas, below the main text band.
  // Tweak these to reposition where the user's handwriting appears.
  const DRAWING_ZONE = {
    x:      Math.round(OUTPUT_W * 0.12),   // 230px from left
    y:      Math.round(OUTPUT_H * 0.67),   // 804px from top
    w:      Math.round(OUTPUT_W * 0.76),   // 1459px wide
    h:      Math.round(OUTPUT_H * 0.20),   // 240px tall
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Load any image source (URL, File, Blob, HTMLImageElement, HTMLCanvasElement)
   * into an HTMLImageElement, resolving when fully loaded.
   * @param {string|File|Blob|HTMLImageElement|HTMLCanvasElement} src
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (src instanceof HTMLCanvasElement) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = src.toDataURL();
        return;
      }
      if (src instanceof HTMLImageElement) {
        if (src.complete && src.naturalWidth) { resolve(src); return; }
        src.onload = function () { resolve(src); };
        src.onerror = reject;
        return;
      }
      if (src instanceof File || src instanceof Blob) {
        const url = URL.createObjectURL(src);
        const img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
        return;
      }
      if (typeof src === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = src;
        return;
      }
      reject(new Error('Unsupported image source type: ' + typeof src));
    });
  }

  /**
   * Apply the DigiAsia photo effect to an image onto a destination canvas context.
   *
   * Effect replicates the PSB layer '圖層 4' (smart object, SCREEN blend):
   *   1. Cover-crop the photo to fill PHOTO_ZONE maintaining aspect ratio
   *   2. grayscale(100%) + contrast(220%) + brightness(90%)  — makes it near B&W
   *   3. Draw onto a temp canvas using 'screen' composite op onto black fill
   *   4. Overlay subtle grain (matching texture layers opacity=51/255 ≈ 0.20)
   *
   * @param {CanvasRenderingContext2D} destCtx  — destination (full OUTPUT_W×H canvas)
   * @param {HTMLImageElement} photoImg
   */
  function applyPhotoEffect(destCtx, photoImg) {
    const zW = PHOTO_ZONE.w;
    const zH = PHOTO_ZONE.h;

    // ── Temp canvas for the photo processing ──────────────────────────────
    const tmp = document.createElement('canvas');
    tmp.width  = zW;
    tmp.height = zH;
    const ctx  = tmp.getContext('2d');

    // 1. Black base
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, zW, zH);

    // 2. Cover-crop calculation (object-fit: cover)
    const iW  = photoImg.naturalWidth  || photoImg.width;
    const iH  = photoImg.naturalHeight || photoImg.height;
    const imgRatio    = iW / iH;
    const zoneRatio   = zW / zH;
    let drawW, drawH, drawX, drawY;
    if (imgRatio > zoneRatio) {
      // image is wider → fit height, crop sides
      drawH = zH;
      drawW = zH * imgRatio;
      drawX = (zW - drawW) / 2;
      drawY = 0;
    } else {
      // image is taller → fit width, crop top/bottom
      drawW = zW;
      drawH = zW / imgRatio;
      drawX = 0;
      drawY = (zH - drawH) / 2;
    }

    // 3. Apply CSS filter: grayscale + high contrast + slight darkness
    //    This replicates the Photoshop B&W + Brightness/Contrast adjustments
    //    in the '群組 24' / '亮度/對比 1' layers in the PSB.
    ctx.filter = 'grayscale(100%) contrast(220%) brightness(85%)';
    ctx.globalCompositeOperation = 'screen';  // matches PSB blend mode
    ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    // 4. Grain overlay — replicates texture layers (opacity=51, LINEAR_DODGE)
    //    We draw a very subtle noise over the whole photo zone.
    _addGrain(ctx, zW, zH, 0.18);

    // ── Paste onto main canvas at PHOTO_ZONE position ─────────────────────
    destCtx.drawImage(tmp, PHOTO_ZONE.x, PHOTO_ZONE.y);
  }

  /**
   * Draw a subtle film-grain noise overlay.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} opacity  0–1
   */
  function _addGrain(ctx, w, h, opacity) {
    const grain = document.createElement('canvas');
    grain.width  = w;
    grain.height = h;
    const gCtx   = grain.getContext('2d');
    const imgData = gCtx.createImageData(w, h);
    const data    = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      // random monochrome noise
      const v = Math.random() * 255 | 0;
      data[i]   = v;
      data[i+1] = v;
      data[i+2] = v;
      data[i+3] = 255;
    }
    gCtx.putImageData(imgData, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(grain, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw the user's handwriting canvas into the DRAWING_ZONE of destCtx.
   * The drawing is scaled to fit within the zone while preserving aspect ratio,
   * and centred within it.
   *
   * @param {CanvasRenderingContext2D} destCtx
   * @param {HTMLCanvasElement} drawingCanvas
   */
  function applyDrawing(destCtx, drawingCanvas) {
    const dW = drawingCanvas.width;
    const dH = drawingCanvas.height;
    if (!dW || !dH) return;

    const zone   = DRAWING_ZONE;
    const scaleX = zone.w / dW;
    const scaleY = zone.h / dH;
    const scale  = Math.min(scaleX, scaleY);

    const scaledW = dW * scale;
    const scaledH = dH * scale;
    const destX   = zone.x + (zone.w - scaledW) / 2;
    const destY   = zone.y + (zone.h - scaledH) / 2;

    destCtx.drawImage(drawingCanvas, 0, 0, dW, dH, destX, destY, scaledW, scaledH);
  }

  // ─── Main export ──────────────────────────────────────────────────────────

  /**
   * Generate the final campaign poster image.
   *
   * @param {Object} opts
   * @param {HTMLCanvasElement|HTMLImageElement|File|Blob|string} opts.photo
   *   The user's selfie. Accepts canvas, img element, File, Blob, or URL string.
   * @param {HTMLCanvasElement} opts.drawing
   *   The drawing canvas (from the handwriting pad).
   * @param {string} opts.template
   *   URL of chrome_overlay.png (the KV chrome with transparent photo zone).
   * @param {function} [opts.onProgress]
   *   Optional callback(0–100) for progress reporting.
   * @param {number} [opts.quality=0.92]
   *   JPEG quality 0–1.
   * @returns {Promise<Blob>} JPEG image blob.
   */
  function generate(opts) {
    const onProgress = opts.onProgress || function () {};
    const quality    = opts.quality != null ? opts.quality : 0.92;

    onProgress(5);

    // Load photo and template in parallel
    return Promise.all([
      loadImage(opts.photo),
      loadImage(opts.template),
    ]).then(function (results) {
      const photoImg    = results[0];
      const templateImg = results[1];

      onProgress(40);

      // ── Build output canvas ──────────────────────────────────────────────
      const canvas  = document.createElement('canvas');
      canvas.width  = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx     = canvas.getContext('2d');

      // Layer 1 — solid black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(50);

      // Layer 2 — processed user photo (SCREEN blend effect)
      applyPhotoEffect(ctx, photoImg);

      onProgress(70);

      // Layer 3 — KV chrome overlay (neon green, text, logos, decorations)
      ctx.drawImage(templateImg, 0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(85);

      // Layer 4 — user's handwritten text
      if (opts.drawing) {
        applyDrawing(ctx, opts.drawing);
      }

      onProgress(95);

      // ── Export as JPEG blob ──────────────────────────────────────────────
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (blob) {
              onProgress(100);
              resolve(blob);
            } else {
              reject(new Error('canvas.toBlob() returned null — canvas may be tainted'));
            }
          },
          'image/jpeg',
          quality
        );
      });
    });
  }

  // ─── Public interface ─────────────────────────────────────────────────────
  return {
    generate:     generate,
    OUTPUT_W:     OUTPUT_W,
    OUTPUT_H:     OUTPUT_H,
    PHOTO_ZONE:   PHOTO_ZONE,
    DRAWING_ZONE: DRAWING_ZONE,
  };
}));
