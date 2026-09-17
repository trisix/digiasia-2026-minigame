/*!
 * heartificial.bundle.js  v1.0.0
 * DigiAsia 2026 — HEART___IFICIAL Campaign Mini Game
 *
 * Bundles: EventImageFX (event-image-effects-v2.js) + HeartificialGenerator
 *
 * Usage:
 *   <script src="heartificial.bundle.js"></script>
 *   <script src="assets/chrome_overlay.png must be served over HTTP"></script>
 *
 *   HeartificialGenerator.generate({
 *     photo:    fileOrBlobOrImageElement,   // user selfie
 *     drawing:  drawingCanvasElement,       // handwriting canvas
 *     template: 'path/to/chrome_overlay.png',
 *     onProgress: function(pct) {},         // 0–100, optional
 *   }).then(function(blob) {
 *     var url = URL.createObjectURL(blob);
 *     document.getElementById('result').src = url;      // <img> for mobile save
 *     document.getElementById('download').href = url;   // <a download>
 *   });
 *
 * Output: JPEG Blob, 1920×1200 px
 *
 * NOTE: Must be served over HTTP (not file://) due to canvas CORS requirements.
 *       Template image (chrome_overlay.png) must be same-origin or CORS-enabled.
 */

/* ─── Part 1: EventImageFX ─────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const clamp01 = v => Math.max(0, Math.min(1, v));

  function smoothstep(a, b, x) {
    const t = clamp01((x - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  }

  function sourceSize(source) {
    return {
      width: source.naturalWidth || source.videoWidth || source.width,
      height: source.naturalHeight || source.videoHeight || source.height
    };
  }

  function fitRect(source, W, H, fit) {
    const s = sourceSize(source);
    if (fit === 'stretch') return { x: 0, y: 0, w: W, h: H };
    const scale = fit === 'cover'
      ? Math.max(W / s.width, H / s.height)
      : Math.min(W / s.width, H / s.height);
    const w = s.width * scale;
    const h = s.height * scale;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function prepareOutput(canvas, background) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background != null) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
    return ctx;
  }

  function toneMap(y, opt) {
    y = smoothstep(opt.black, opt.white, y);
    y = clamp01((y - 0.5) * opt.contrast + 0.5);
    y = Math.pow(clamp01(y), opt.gamma);
    if (opt.levels >= 2) {
      y = Math.round(y * (opt.levels - 1)) / (opt.levels - 1);
    }
    return clamp01(y);
  }

  function dotHalftone(source, canvas, options) {
    options = options || {};
    const opt = Object.assign({
      fit: 'contain', background: null, color: '#777',
      cellX: 5, cellY: 5, shape: 'ellipse', aspectX: 0.72, aspectY: 1.00,
      minRadius: 0.10, maxRadius: 2.00,
      black: 0.07, white: 0.94, contrast: 0.55, gamma: 1.20, levels: 12,
      toneMode: 'radius+alpha', alphaMin: 0.18, alphaMax: 0.82, threshold: 0.015,
      invert: false, vignette: 0,
    }, options);

    const W = canvas.width, H = canvas.height;
    const out = prepareOutput(canvas, opt.background);
    const cellX = Math.max(1, Math.round(opt.cellX));
    const cellY = Math.max(1, Math.round(opt.cellY));
    const cols = Math.ceil(W / cellX);
    const rows = Math.ceil(H / cellY);

    const sample = document.createElement('canvas');
    sample.width = cols; sample.height = rows;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, cols, rows);
    const r = fitRect(source, cols, rows, opt.fit);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, r.x, r.y, r.w, r.h);

    const px = sctx.getImageData(0, 0, cols, rows).data;
    const maxR = Math.max(0, opt.maxRadius);
    const minR = Math.max(0, Math.min(maxR, opt.minRadius));

    out.save();
    out.fillStyle = opt.color;

    for (let gy = 0; gy < rows; gy++) {
      const ny = (gy + 0.5) / rows * 2 - 1;
      for (let gx = 0; gx < cols; gx++) {
        const i = (gy * cols + gx) * 4;
        const srcAlpha = px[i + 3] / 255;
        if (srcAlpha <= 0) continue;

        let y = (0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2]) / 255;
        if (opt.invert) y = 1 - y;
        y = toneMap(y, opt);
        y *= srcAlpha;

        if (opt.vignette > 0) {
          const nx = (gx + 0.5) / cols * 2 - 1;
          const d = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
          y *= 1 - opt.vignette * smoothstep(0.45, 1.0, d);
        }
        if (y <= opt.threshold) continue;

        let radiusTone = y, alphaTone = 1;
        if (opt.toneMode === 'alpha') { radiusTone = 1; alphaTone = y; }
        else if (opt.toneMode === 'radius+alpha') { alphaTone = y; }

        const radius = minR + (maxR - minR) * radiusTone;
        const alpha  = opt.alphaMin + (opt.alphaMax - opt.alphaMin) * alphaTone;
        const cx = gx * cellX + cellX / 2;
        const cy = gy * cellY + cellY / 2;
        let rx = radius, ry = radius;
        if (opt.shape === 'ellipse') { rx *= opt.aspectX; ry *= opt.aspectY; }

        out.globalAlpha = clamp01(alpha);
        out.beginPath();
        out.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
        out.fill();
      }
    }
    out.restore();
    return canvas;
  }

  function verticalRaster(source, canvas, options) {
    options = options || {};
    const opt = Object.assign({
      fit: 'contain', background: null, color: '#00ff4c',
      pitch: 5, stripeWidth: 2, phase: 0,
      maskSource: 'auto',
      black: 0.08, white: 0.92, contrast: 1.05, gamma: 0.95, levels: 0,
      threshold: 0.03, opacity: 1,
    }, options);

    const W = canvas.width, H = canvas.height;
    const out = prepareOutput(canvas, opt.background);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, W, H);
    const r = fitRect(source, W, H, opt.fit);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, r.x, r.y, r.w, r.h);

    const img  = sctx.getImageData(0, 0, W, H);
    const data = img.data;

    let hasTransparency = false;
    if (opt.maskSource === 'auto') {
      const stride = Math.max(4, Math.floor(data.length / 4000 / 4) * 4);
      for (let i = 3; i < data.length; i += stride) {
        if (data[i] < 250) { hasTransparency = true; break; }
      }
    }

    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    const maskImage = mctx.createImageData(W, H);
    const dst = maskImage.data;

    const pitch       = Math.max(1, Math.round(opt.pitch));
    const stripeWidth = Math.max(1, Math.min(pitch, Math.round(opt.stripeWidth)));
    const phase       = ((Math.round(opt.phase) % pitch) + pitch) % pitch;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (((x + phase) % pitch) >= stripeWidth) continue;
        const i = (y * W + x) * 4;
        const a = data[i + 3] / 255;
        let maskValue;
        const mode = opt.maskSource === 'auto' ? (hasTransparency ? 'alpha' : 'luminance') : opt.maskSource;
        if (mode === 'alpha') {
          maskValue = a;
        } else {
          const lum = (0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]) / 255;
          maskValue = toneMap(lum, opt) * a;
        }
        if (maskValue <= opt.threshold) continue;
        dst[i] = dst[i+1] = dst[i+2] = 255;
        dst[i+3] = Math.round(255 * clamp01(maskValue * opt.opacity));
      }
    }
    mctx.putImageData(maskImage, 0, 0);

    const colored = document.createElement('canvas');
    colored.width = W; colored.height = H;
    const cctx = colored.getContext('2d');
    cctx.drawImage(mask, 0, 0);
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = opt.color;
    cctx.fillRect(0, 0, W, H);

    out.drawImage(colored, 0, 0);
    return canvas;
  }

  global.EventImageFX = { dotHalftone, verticalRaster };

})(typeof window !== 'undefined' ? window : globalThis);


/* ─── Part 2: HeartificialGenerator ───────────────────────────────────────── */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.HeartificialGenerator = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OUTPUT_W = 1920;
  const OUTPUT_H = 1200;

  const PHOTO_ZONE = { x: 0, y: 0, w: OUTPUT_W, h: Math.round(OUTPUT_H * 0.87) };

  // Drawing zone: above the HEART___IFICIAL dash (PSB '------' at y=609–630)
  // Sits in 184px gap between title band top (y=425) and dash (y=609)
  // Bottom = y=597 (12px above dash). Top = y=437. Aspect ≈ 3.34:1
  const DRAWING_ZONE = { x: 692, y: 437, w: 535, h: 160 };

  const DOT_PHOTO_OPTIONS = {
    fit: 'cover', background: null, color: '#ffffff',
    cellX: 7, cellY: 7, shape: 'ellipse', aspectX: 0.90, aspectY: 1.00,
    minRadius: 0.10, maxRadius: 2.00,
    black: 0.07, white: 0.94, contrast: 0.55, gamma: 0.70, levels: 12,
    toneMode: 'radius+alpha', alphaMin: 0.18, alphaMax: 0.82,
    threshold: 0.015, vignette: 0,
  };

  const RASTER_DRAWING_OPTIONS = {
    fit: 'stretch', background: null, color: '#1ca629',
    pitch: 5, stripeWidth: 2, phase: 0,
    maskSource: 'alpha',
    black: 0.05, white: 0.88, contrast: 1.10, gamma: 0.95,
    levels: 0, threshold: 0.02, opacity: 1,
  };

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

  function applyPhotoEffect(destCtx, photoImg, overrides) {
    var opts = Object.assign({}, DOT_PHOTO_OPTIONS, overrides || {});
    var scratch = document.createElement('canvas');
    scratch.width = PHOTO_ZONE.w;
    scratch.height = PHOTO_ZONE.h;
    EventImageFX.dotHalftone(photoImg, scratch, opts);
    destCtx.drawImage(scratch, PHOTO_ZONE.x, PHOTO_ZONE.y);
  }

  function applyDrawingEffect(destCtx, drawingCanvas, overrides) {
    if (!drawingCanvas || !drawingCanvas.width || !drawingCanvas.height) return;
    var checkCtx  = drawingCanvas.getContext('2d');
    var checkData = checkCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;
    var hasContent = false;
    for (var ci = 3; ci < checkData.length; ci += 16) {
      if (checkData[ci] > 10) { hasContent = true; break; }
    }
    if (!hasContent) return;

    var opts = Object.assign({}, RASTER_DRAWING_OPTIONS, overrides || {});
    var zone = DRAWING_ZONE;
    var dW = drawingCanvas.width, dH = drawingCanvas.height;
    var scale = Math.min(zone.w / dW, zone.h / dH);
    var sw = dW * scale, sh = dH * scale;
    var sx = (zone.w - sw) / 2, sy = (zone.h - sh) / 2;

    var scratch = document.createElement('canvas');
    scratch.width = zone.w; scratch.height = zone.h;
    scratch.getContext('2d').drawImage(drawingCanvas, 0, 0, dW, dH, sx, sy, sw, sh);

    var result = document.createElement('canvas');
    result.width = zone.w; result.height = zone.h;
    EventImageFX.verticalRaster(scratch, result, opts);
    destCtx.drawImage(result, zone.x, zone.y);
  }

  function generate(opts) {
    var onProgress    = opts.onProgress || function () {};
    var quality       = opts.quality != null ? opts.quality : 0.92;
    var dotOverrides  = opts.dotOptions    || {};
    var rastOverrides = opts.rasterOptions || {};

    onProgress(5);
    return Promise.all([loadImage(opts.photo), loadImage(opts.template)])
    .then(function (results) {
      var photoImg = results[0], templateImg = results[1];
      onProgress(30);

      var canvas = document.createElement('canvas');
      canvas.width = OUTPUT_W; canvas.height = OUTPUT_H;
      var ctx = canvas.getContext('2d');

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);
      onProgress(40);

      applyPhotoEffect(ctx, photoImg, dotOverrides);
      onProgress(65);

      ctx.drawImage(templateImg, 0, 0, OUTPUT_W, OUTPUT_H);
      onProgress(80);

      if (opts.drawing) applyDrawingEffect(ctx, opts.drawing, rastOverrides);
      onProgress(95);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) { onProgress(100); resolve(blob); }
          else { reject(new Error('canvas.toBlob() returned null')); }
        }, 'image/jpeg', quality);
      });
    });
  }

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
