/**
 * heartificial-generator.js  v2
 * DigiAsia 2026 — HEART___IFICIAL Campaign Mini Game
 *
 * Depends on: event-image-effects-v2.js  (EventImageFX must be loaded first)
 *
 * Public API:
 *
 *   HeartificialGenerator.generate({
 *     photo:       HTMLCanvasElement | HTMLImageElement | File | Blob | string,
 *     drawing:     HTMLCanvasElement,            // user's handwritten text
 *     template:    string,                       // URL of chrome_overlay.png
 *     onProgress:  (pct) => void,                // optional 0–100
 *     quality:     number,                       // JPEG quality 0–1, default 0.92
 *   }) → Promise<Blob>   (JPEG 1920×1200)
 *
 * Compositing order (bottom → top):
 *   1. Black fill
 *   2. User photo  — EventImageFX.dotHalftone() (grey dot-matrix on black)
 *   3. chrome_overlay.png — KV chrome with transparent photo zone
 *   4. User drawing — EventImageFX.verticalRaster() (green vertical stripes
 *        through the stroke shapes), positioned in the upper drawing zone
 *
 * Drawing zone (v2 fix):
 *   Positioned in the UPPER portion of the canvas (above the HEART text band),
 *   horizontally centred.  The flow_description target shows the writing
 *   should appear in the black photo zone above the title typography.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HeartificialGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── Output dimensions (match KV canvas) ─────────────────────────────────
  const OUTPUT_W = 1920;
  const OUTPUT_H = 1200;

  // ─── Photo zone: full canvas width, upper 87% (matches frame layer height) ─
  const PHOTO_ZONE = {
    x: 0,
    y: 0,
    w: OUTPUT_W,
    h: Math.round(OUTPUT_H * 0.87),   // ~1041 px
  };

  // ─── Drawing zone (v2): UPPER area of the black photo region ─────────────
  //
  // The screenshot annotation shows "shall be here" pointing to the region
  // ABOVE the nose/mouth of the face — roughly the upper-left black area,
  // around y 18–35% of canvas height.
  //
  // KV structure:
  //   y=0   – top edge (neon green/black)
  //   y=425 – HEART text starts (~35% of 1200)
  //   y=710 – HEART text ends  (~59%)
  //   y=794 – "Intelligent Marketing" / subtitle band
  //   y=867 – 用人心的溫度 tagline
  //   y=1041– frame bottom / footer start
  //
  // Safe drawing zone: above the HEART text band, inside the black photo blob.
  // x: 8–55% of width (left-centre, avoids the right vertical decorations)
  // y: 18–38% of height → y=216..456, height=240
  const DRAWING_ZONE = {
    x: Math.round(OUTPUT_W * 0.08),    //  154 px from left
    y: Math.round(OUTPUT_H * 0.18),    //  216 px from top
    w: Math.round(OUTPUT_W * 0.50),    //  960 px wide
    h: Math.round(OUTPUT_H * 0.20),    //  240 px tall
  };

  // ─── EventImageFX dot-halftone preset for the user photo ─────────────────
  //
  // Based on PRESETS.portraitDots but:
  //   • fit:'cover' (not 'contain') so the face fills the full canvas
  //   • background: null — we pre-fill black and draw on top; avoids double clear
  //   • color: '#888' — slightly brighter than the reference grey (#777)
  //     to compensate for real-world selfie dynamic range being narrower
  //     than a pro photo studio shot
  const DOT_PHOTO_OPTIONS = {
    fit:         'cover',
    background:  null,
    color:       '#888',
    cellX:       5,
    cellY:       5,
    shape:       'ellipse',
    aspectX:     0.72,
    aspectY:     1.00,
    minRadius:   0.10,
    maxRadius:   2.00,
    black:       0.07,
    white:       0.94,
    contrast:    0.55,
    gamma:       1.20,
    levels:      12,
    toneMode:    'radius+alpha',
    alphaMin:    0.18,
    alphaMax:    0.82,
    threshold:   0.015,
    vignette:    0,
  };

  // ─── EventImageFX vertical-raster preset for the drawing ─────────────────
  //
  // The drawing canvas has a transparent background with green strokes.
  // verticalRaster in 'alpha' mode uses the stroke alpha as the mask,
  // then renders only the columns that fall on a stripe interval.
  // Result: the handwriting appears as green vertical-stripe-filled shapes.
  const RASTER_DRAWING_OPTIONS = {
    fit:         'stretch',   // drawing covers exactly its target zone
    background:  null,        // transparent — composited on top
    color:       '#00ff3c',   // campaign neon green
    pitch:       5,
    stripeWidth: 2,
    phase:       0,
    maskSource:  'alpha',     // drawing canvas has transparent bg + opaque strokes
    black:       0.05,
    white:       0.88,
    contrast:    1.10,
    gamma:       0.95,
    levels:      0,
    threshold:   0.02,
    opacity:     1,
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (src instanceof HTMLCanvasElement) {
        var img = new Image();
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
        var url = URL.createObjectURL(src);
        var img2 = new Image();
        img2.onload = function () { URL.revokeObjectURL(url); resolve(img2); };
        img2.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
        img2.src = url;
        return;
      }
      if (typeof src === 'string') {
        var img3 = new Image();
        img3.crossOrigin = 'anonymous';
        img3.onload = function () { resolve(img3); };
        img3.onerror = reject;
        img3.src = src;
        return;
      }
      reject(new Error('Unsupported image source type: ' + typeof src));
    });
  }

  /**
   * Apply dot-halftone effect to the user photo onto destCtx.
   *
   * Uses EventImageFX.dotHalftone() which must be available globally.
   * Creates a scratch canvas sized to PHOTO_ZONE, renders the effect there,
   * then pastes it into the destination at PHOTO_ZONE offset.
   *
   * @param {CanvasRenderingContext2D} destCtx
   * @param {HTMLImageElement} photoImg
   */
  function applyPhotoEffect(destCtx, photoImg) {
    if (typeof EventImageFX === 'undefined') {
      throw new Error(
        'EventImageFX not found. ' +
        'Load event-image-effects-v2.js before heartificial-generator.js.'
      );
    }

    var scratch = document.createElement('canvas');
    scratch.width  = PHOTO_ZONE.w;
    scratch.height = PHOTO_ZONE.h;

    EventImageFX.dotHalftone(photoImg, scratch, DOT_PHOTO_OPTIONS);

    destCtx.drawImage(scratch, PHOTO_ZONE.x, PHOTO_ZONE.y);
  }

  /**
   * Apply vertical-raster effect to the user's drawing and composite it
   * into DRAWING_ZONE on destCtx.
   *
   * The drawing canvas is first rendered at DRAWING_ZONE dimensions into a
   * scratch canvas, then verticalRaster() is applied (alpha mask mode),
   * then the result is pasted into the destination.
   *
   * @param {CanvasRenderingContext2D} destCtx
   * @param {HTMLCanvasElement} drawingCanvas
   */
  function applyDrawingEffect(destCtx, drawingCanvas) {
    if (!drawingCanvas || !drawingCanvas.width || !drawingCanvas.height) return;

    // Check if the drawing canvas actually has any content
    var checkCtx = drawingCanvas.getContext('2d');
    var checkData = checkCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;
    var hasContent = false;
    for (var ci = 3; ci < checkData.length; ci += 4) {
      if (checkData[ci] > 10) { hasContent = true; break; }
    }
    if (!hasContent) return;

    if (typeof EventImageFX === 'undefined') {
      throw new Error('EventImageFX not found.');
    }

    var zone = DRAWING_ZONE;

    // Scale drawing into a scratch canvas sized to the drawing zone
    var scratch = document.createElement('canvas');
    scratch.width  = zone.w;
    scratch.height = zone.h;
    var sctx = scratch.getContext('2d');

    // Cover-scale: fit drawing into zone preserving aspect ratio, centred
    var dW = drawingCanvas.width;
    var dH = drawingCanvas.height;
    var scaleX = zone.w / dW;
    var scaleY = zone.h / dH;
    var scale  = Math.min(scaleX, scaleY);
    var sw = dW * scale;
    var sh = dH * scale;
    var sx = (zone.w  - sw) / 2;
    var sy = (zone.h  - sh) / 2;
    sctx.drawImage(drawingCanvas, 0, 0, dW, dH, sx, sy, sw, sh);

    // Apply vertical raster effect onto a result canvas
    var result = document.createElement('canvas');
    result.width  = zone.w;
    result.height = zone.h;

    EventImageFX.verticalRaster(scratch, result, RASTER_DRAWING_OPTIONS);

    // Paste result into destination at drawing zone position
    destCtx.drawImage(result, zone.x, zone.y);
  }

  // ─── Main export ──────────────────────────────────────────────────────────

  /**
   * Generate the final campaign poster.
   *
   * @param {Object} opts
   * @param {HTMLCanvasElement|HTMLImageElement|File|Blob|string} opts.photo
   * @param {HTMLCanvasElement} opts.drawing
   * @param {string} opts.template   URL to chrome_overlay.png
   * @param {function} [opts.onProgress]  callback(0–100)
   * @param {number}   [opts.quality]     JPEG quality, default 0.92
   * @returns {Promise<Blob>}
   */
  function generate(opts) {
    var onProgress = opts.onProgress || function () {};
    var quality    = opts.quality != null ? opts.quality : 0.92;

    onProgress(5);

    return Promise.all([
      loadImage(opts.photo),
      loadImage(opts.template),
    ]).then(function (results) {
      var photoImg    = results[0];
      var templateImg = results[1];

      onProgress(30);

      // ── Output canvas ──────────────────────────────────────────────────
      var canvas  = document.createElement('canvas');
      canvas.width  = OUTPUT_W;
      canvas.height = OUTPUT_H;
      var ctx = canvas.getContext('2d');

      // Layer 1 — black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(40);

      // Layer 2 — dot-halftone photo effect
      applyPhotoEffect(ctx, photoImg);

      onProgress(65);

      // Layer 3 — KV chrome overlay
      ctx.drawImage(templateImg, 0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(80);

      // Layer 4 — vertical-raster drawing effect
      if (opts.drawing) {
        applyDrawingEffect(ctx, opts.drawing);
      }

      onProgress(95);

      // ── Export ────────────────────────────────────────────────────────
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (blob) { onProgress(100); resolve(blob); }
            else { reject(new Error('canvas.toBlob() returned null — canvas may be tainted')); }
          },
          'image/jpeg',
          quality
        );
      });
    });
  }

  // ─── Public ───────────────────────────────────────────────────────────────
  return {
    generate:              generate,
    OUTPUT_W:              OUTPUT_W,
    OUTPUT_H:              OUTPUT_H,
    PHOTO_ZONE:            PHOTO_ZONE,
    DRAWING_ZONE:          DRAWING_ZONE,
    DOT_PHOTO_OPTIONS:     DOT_PHOTO_OPTIONS,
    RASTER_DRAWING_OPTIONS: RASTER_DRAWING_OPTIONS,
  };
}));
