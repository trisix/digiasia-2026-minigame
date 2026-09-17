/**
 * heartificial-generator.js  v3
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
 *     dotOptions:  object,                       // override DOT_PHOTO_OPTIONS
 *     rasterOptions: object,                     // override RASTER_DRAWING_OPTIONS
 *   }) → Promise<Blob>   (JPEG 1920×1200)
 *
 * Compositing order (bottom → top):
 *   1. Black fill
 *   2. User photo  — EventImageFX.dotHalftone() (white dot-matrix on black)
 *   3. chrome_overlay.png — KV chrome with transparent photo zone
 *   4. User drawing — EventImageFX.verticalRaster() (green vertical stripes
 *        through the stroke shapes), positioned over the _____ dash of HEART___IFICIAL
 *
 * ── Drawing zone (v3) ────────────────────────────────────────────────────────
 * PSB layer '------' (the dash between HEART and IFICIAL):
 *   pixel coords: x=712–1207, y=609–630 (canvas 1920×1200)
 *   % coords:     x=37.1–62.9%, y=50.8–52.5%
 *
 * Drawing zone is centred on the dash, with enough height to be legible:
 *   x = 680px (35.4%) — slight inset from dash left edge
 *   y = 490px (40.8%) — ~120px above dash top for stroke ascenders
 *   w = 560px (29.2%) — covers x=680–1240, spanning the full dash width
 *   h = 260px (21.7%) — covers y=490–750, descends slightly below dash
 *
 * ── Tuned parameters (v3, confirmed by human visual QA) ─────────────────────
 * Dot halftone:
 *   cellX=7, cellY=7, maxRadius=2.0, aspectX=0.90
 *   contrast=0.55, gamma=0.70, color='#ffffff'
 *
 * Vertical raster:
 *   pitch=5, stripeWidth=2, contrast=1.10
 *   maskSource='auto', color='#1ca629'   (campaign accent green)
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HeartificialGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── Output dimensions ────────────────────────────────────────────────────
  const OUTPUT_W = 1920;
  const OUTPUT_H = 1200;

  // ─── Photo zone: full canvas, upper 87% ──────────────────────────────────
  const PHOTO_ZONE = {
    x: 0,
    y: 0,
    w: OUTPUT_W,
    h: Math.round(OUTPUT_H * 0.87),  // 1044px — matches 'frame' layer bottom
  };

  // ─── Drawing zone (v4) ───────────────────────────────────────────────────
  // PSB coords (canvas 1920×1200):
  //   '------' dash layer: x=712–1207, y=609–630
  //   'Heart' text:        y=425–651
  //   Title band:          y=425–710
  //
  // Goal: drawing ABOVE the dash, NOT overlapping it.
  // Zone sits in the 184px gap between title band top and dash top:
  //   bottom = dash_y1 - 12 margin = 597px  (12px clear above the line)
  //   height = 160px
  //   top    = 437px  (12px below title band top at 425)
  //   x      = dash_x1 - 20 = 692px  (20px left of dash left edge)
  //   width  = (dash_x2 + 20) - 692 = 535px (20px right margin past dash)
  //   aspect = 535:160 ≈ 3.34:1
  const DRAWING_ZONE = {
    x: 692,   // px — 20px left of dash left edge (712)
    y: 437,   // px — 12px below title band top (425), 160px above dash
    w: 535,   // px — spans x=692–1227, covering dash x=712–1207
    h: 160,   // px — fills the gap, bottom at y=597 (12px above dash y=609)
  };

  // ─── Dot halftone options (v3 tuned params + white dots) ─────────────────
  //
  // Changes from v2:
  //   cellX/Y: 5 → 7      (slightly coarser grid, closer to PSB reference)
  //   aspectX: 0.72 → 0.90 (dots nearly circular per human QA)
  //   gamma: 1.20 → 0.70   (brightens mid-tones, more dot visibility)
  //   color: '#888' → '#ffffff'  (white dots on black per brief)
  //   fit: 'cover'  (unchanged — face fills full canvas)
  const DOT_PHOTO_OPTIONS = {
    fit:         'cover',
    background:  null,       // we pre-fill black
    color:       '#ffffff',  // white dots on black
    cellX:       7,
    cellY:       7,
    shape:       'ellipse',
    aspectX:     0.90,       // nearly circular
    aspectY:     1.00,
    minRadius:   0.10,
    maxRadius:   2.00,
    black:       0.07,
    white:       0.94,
    contrast:    0.55,
    gamma:       0.70,       // brighter mid-tones
    levels:      12,
    toneMode:    'radius+alpha',
    alphaMin:    0.18,
    alphaMax:    0.82,
    threshold:   0.015,
    vignette:    0,
  };

  // ─── Vertical raster options (v3) ─────────────────────────────────────────
  //
  // color: '#1ca629' (campaign accent green, confirmed by campaign team)
  // maskSource: 'alpha' — drawing canvas has transparent bg + opaque strokes
  const RASTER_DRAWING_OPTIONS = {
    fit:         'stretch',   // drawing fills its zone exactly
    background:  null,
    color:       '#1ca629',   // campaign accent green
    pitch:       5,
    stripeWidth: 2,
    phase:       0,
    maskSource:  'alpha',     // use stroke alpha, not luminance
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
      reject(new Error('Unsupported image source: ' + typeof src));
    });
  }

  /**
   * Dot-halftone the user photo onto destCtx at PHOTO_ZONE.
   * @param {CanvasRenderingContext2D} destCtx
   * @param {HTMLImageElement} photoImg
   * @param {object} [overrides]  partial DOT_PHOTO_OPTIONS overrides
   */
  function applyPhotoEffect(destCtx, photoImg, overrides) {
    if (typeof EventImageFX === 'undefined') {
      throw new Error('EventImageFX not found — load event-image-effects-v2.js first.');
    }
    var opts = Object.assign({}, DOT_PHOTO_OPTIONS, overrides || {});

    var scratch = document.createElement('canvas');
    scratch.width  = PHOTO_ZONE.w;
    scratch.height = PHOTO_ZONE.h;

    EventImageFX.dotHalftone(photoImg, scratch, opts);
    destCtx.drawImage(scratch, PHOTO_ZONE.x, PHOTO_ZONE.y);
  }

  /**
   * Apply vertical-raster effect to the drawing canvas and composite it
   * into DRAWING_ZONE on destCtx.
   *
   * The drawing content is scaled to fit within DRAWING_ZONE (preserve aspect),
   * centred, then passed to verticalRaster with alpha mask mode.
   *
   * @param {CanvasRenderingContext2D} destCtx
   * @param {HTMLCanvasElement} drawingCanvas
   * @param {object} [overrides]  partial RASTER_DRAWING_OPTIONS overrides
   */
  function applyDrawingEffect(destCtx, drawingCanvas, overrides) {
    if (!drawingCanvas || !drawingCanvas.width || !drawingCanvas.height) return;

    // Guard: skip if the canvas has no actual strokes
    var checkCtx  = drawingCanvas.getContext('2d');
    var checkData = checkCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;
    var hasContent = false;
    for (var ci = 3; ci < checkData.length; ci += 16) {
      if (checkData[ci] > 10) { hasContent = true; break; }
    }
    if (!hasContent) return;

    if (typeof EventImageFX === 'undefined') {
      throw new Error('EventImageFX not found — load event-image-effects-v2.js first.');
    }

    var opts = Object.assign({}, RASTER_DRAWING_OPTIONS, overrides || {});
    var zone = DRAWING_ZONE;

    // Scale drawing to fit inside zone while preserving aspect ratio
    var dW = drawingCanvas.width;
    var dH = drawingCanvas.height;
    var scale  = Math.min(zone.w / dW, zone.h / dH);
    var sw = dW * scale;
    var sh = dH * scale;
    var sx = (zone.w - sw) / 2;
    var sy = (zone.h - sh) / 2;

    // Draw scaled content onto a zone-sized scratch canvas
    var scratch = document.createElement('canvas');
    scratch.width  = zone.w;
    scratch.height = zone.h;
    var sctx = scratch.getContext('2d');
    sctx.drawImage(drawingCanvas, 0, 0, dW, dH, sx, sy, sw, sh);

    // Apply raster effect
    var result = document.createElement('canvas');
    result.width  = zone.w;
    result.height = zone.h;
    EventImageFX.verticalRaster(scratch, result, opts);

    // Composite onto destination
    destCtx.drawImage(result, zone.x, zone.y);
  }

  // ─── Main generate ────────────────────────────────────────────────────────

  /**
   * @param {object} opts
   * @param {*}        opts.photo          user selfie (File/Blob/img/canvas/URL)
   * @param {HTMLCanvasElement} opts.drawing  handwriting canvas
   * @param {string}   opts.template       URL to chrome_overlay.png
   * @param {function} [opts.onProgress]   callback(0–100)
   * @param {number}   [opts.quality]      JPEG quality 0–1, default 0.92
   * @param {object}   [opts.dotOptions]   partial DOT_PHOTO_OPTIONS overrides
   * @param {object}   [opts.rasterOptions] partial RASTER_DRAWING_OPTIONS overrides
   * @returns {Promise<Blob>}
   */
  function generate(opts) {
    var onProgress    = opts.onProgress || function () {};
    var quality       = opts.quality != null ? opts.quality : 0.92;
    var dotOverrides  = opts.dotOptions    || {};
    var rastOverrides = opts.rasterOptions || {};

    onProgress(5);

    return Promise.all([
      loadImage(opts.photo),
      loadImage(opts.template),
    ]).then(function (results) {
      var photoImg    = results[0];
      var templateImg = results[1];

      onProgress(30);

      var canvas = document.createElement('canvas');
      canvas.width  = OUTPUT_W;
      canvas.height = OUTPUT_H;
      var ctx = canvas.getContext('2d');

      // Layer 1 — black base
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(40);

      // Layer 2 — dot-halftone photo
      applyPhotoEffect(ctx, photoImg, dotOverrides);

      onProgress(65);

      // Layer 3 — KV chrome overlay
      ctx.drawImage(templateImg, 0, 0, OUTPUT_W, OUTPUT_H);

      onProgress(80);

      // Layer 4 — vertical-raster drawing (over the _____ dash)
      if (opts.drawing) {
        applyDrawingEffect(ctx, opts.drawing, rastOverrides);
      }

      onProgress(95);

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
    generate:               generate,
    OUTPUT_W:               OUTPUT_W,
    OUTPUT_H:               OUTPUT_H,
    PHOTO_ZONE:             PHOTO_ZONE,
    DRAWING_ZONE:           DRAWING_ZONE,
    DOT_PHOTO_OPTIONS:      DOT_PHOTO_OPTIONS,
    RASTER_DRAWING_OPTIONS: RASTER_DRAWING_OPTIONS,
  };
}));
