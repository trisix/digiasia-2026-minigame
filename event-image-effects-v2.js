/**
 * EventImageFX
 * Two image effects extracted from the supplied event visual:
 *  1) dotHalftone()     - portrait/photo: regular dot/ellipse matrix
 *  2) verticalRaster()  - logo/type/image: vertical striped raster mask
 *
 * Vanilla Canvas 2D. No dependencies.
 *
 * Classic-script usage:
 *   Load this file with a normal script tag, then call EventImageFX.*
 *   EventImageFX.dotHalftone(img, canvas, EventImageFX.PRESETS.portraitDots);
 *
 * Both renderers accept HTMLImageElement, HTMLCanvasElement, ImageBitmap,
 * HTMLVideoElement, etc. as CanvasImageSource.
 */
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

  /**
   * EFFECT 1: photo / portrait dot halftone.
   *
   * Brightness can control:
   * - dot radius
   * - dot opacity
   * - both (default, closest to supplied visual)
   */
  function dotHalftone(source, canvas, options = {}) {
    const opt = {
      fit: 'contain',
      background: null,
      color: '#777',

      cellX: 5,
      cellY: 5,

      shape: 'ellipse', // circle | ellipse
      aspectX: 0.72,
      aspectY: 1.00,

      minRadius: 0.10,
      maxRadius: 2.00,

      black: 0.07,
      white: 0.94,
      contrast: 0.55,
      gamma: 1.20,
      levels: 12,

      toneMode: 'radius+alpha', // radius | alpha | radius+alpha
      alphaMin: 0.18,
      alphaMax: 0.82,
      threshold: 0.015,

      invert: false,
      vignette: 0,
      ...options
    };

    const W = canvas.width;
    const H = canvas.height;
    const out = prepareOutput(canvas, opt.background);

    const cellX = Math.max(1, Math.round(opt.cellX));
    const cellY = Math.max(1, Math.round(opt.cellY));
    const cols = Math.ceil(W / cellX);
    const rows = Math.ceil(H / cellY);

    // One photo sample per dot cell.
    const sample = document.createElement('canvas');
    sample.width = cols;
    sample.height = rows;
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

        let y = (
          0.2126 * px[i] +
          0.7152 * px[i + 1] +
          0.0722 * px[i + 2]
        ) / 255;

        if (opt.invert) y = 1 - y;
        y = toneMap(y, opt);
        y *= srcAlpha;

        if (opt.vignette > 0) {
          const nx = (gx + 0.5) / cols * 2 - 1;
          const d = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
          y *= 1 - opt.vignette * smoothstep(0.45, 1.0, d);
        }

        if (y <= opt.threshold) continue;

        let radiusTone = y;
        let alphaTone = 1;

        if (opt.toneMode === 'alpha') {
          radiusTone = 1;
          alphaTone = y;
        } else if (opt.toneMode === 'radius+alpha') {
          alphaTone = y;
        }

        const radius = minR + (maxR - minR) * radiusTone;
        const alpha = opt.alphaMin + (opt.alphaMax - opt.alphaMin) * alphaTone;

        const cx = gx * cellX + cellX / 2;
        const cy = gy * cellY + cellY / 2;

        let rx = radius;
        let ry = radius;

        if (opt.shape === 'ellipse') {
          rx *= opt.aspectX;
          ry *= opt.aspectY;
        }

        out.globalAlpha = clamp01(alpha);
        out.beginPath();
        out.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
        out.fill();
      }
    }

    out.restore();
    return canvas;
  }

  /**
   * EFFECT 2: vertical raster / striped fill.
   *
   * This is intentionally different from the portrait dot effect.
   * It treats the source as a mask and reveals it only through vertical bars.
   *
   * maskSource:
   *   auto      -> use alpha when source has transparency, otherwise luminance
   *   alpha     -> use source alpha only
   *   luminance -> use source luminance only
   */
  function verticalRaster(source, canvas, options = {}) {
    const opt = {
      fit: 'contain',
      background: null,
      color: '#00ff4c',

      pitch: 5,
      stripeWidth: 2,
      phase: 0,

      maskSource: 'auto', // auto | alpha | luminance
      black: 0.08,
      white: 0.92,
      contrast: 1.05,
      gamma: 0.95,
      levels: 0,
      threshold: 0.03,

      opacity: 1,
      ...options
    };

    const W = canvas.width;
    const H = canvas.height;
    const out = prepareOutput(canvas, opt.background);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W;
    srcCanvas.height = H;
    const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });

    sctx.clearRect(0, 0, W, H);
    const r = fitRect(source, W, H, opt.fit);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, r.x, r.y, r.w, r.h);

    const img = sctx.getImageData(0, 0, W, H);
    const data = img.data;

    // Detect whether the source actually contains transparency.
    let hasTransparency = false;
    if (opt.maskSource === 'auto') {
      const stride = Math.max(4, Math.floor(data.length / 4000 / 4) * 4);
      for (let i = 3; i < data.length; i += stride) {
        if (data[i] < 250) {
          hasTransparency = true;
          break;
        }
      }
    }

    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    const maskImage = mctx.createImageData(W, H);
    const dst = maskImage.data;

    const pitch = Math.max(1, Math.round(opt.pitch));
    const stripeWidth = Math.max(1, Math.min(pitch, Math.round(opt.stripeWidth)));
    const phase = ((Math.round(opt.phase) % pitch) + pitch) % pitch;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (((x + phase) % pitch) >= stripeWidth) continue;

        const i = (y * W + x) * 4;
        const a = data[i + 3] / 255;

        let maskValue;
        const mode = opt.maskSource === 'auto'
          ? (hasTransparency ? 'alpha' : 'luminance')
          : opt.maskSource;

        if (mode === 'alpha') {
          maskValue = a;
        } else {
          let lum = (
            0.2126 * data[i] +
            0.7152 * data[i + 1] +
            0.0722 * data[i + 2]
          ) / 255;

          maskValue = toneMap(lum, opt) * a;
        }

        if (maskValue <= opt.threshold) continue;

        dst[i] = 255;
        dst[i + 1] = 255;
        dst[i + 2] = 255;
        dst[i + 3] = Math.round(255 * clamp01(maskValue * opt.opacity));
      }
    }

    mctx.putImageData(maskImage, 0, 0);

    // Colorize the alpha mask without re-reading pixels.
    const colored = document.createElement('canvas');
    colored.width = W;
    colored.height = H;
    const cctx = colored.getContext('2d');

    cctx.drawImage(mask, 0, 0);
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = opt.color;
    cctx.fillRect(0, 0, W, H);

    out.drawImage(colored, 0, 0);
    return canvas;
  }

  const PRESETS = Object.freeze({
    // Right-side portrait/photo in the second supplied visual.
    portraitDots: Object.freeze({
      fit: 'contain',
      background: '#000',
      color: '#777',
      cellX: 5,
      cellY: 5,
      shape: 'ellipse',
      aspectX: 0.72,
      aspectY: 1.00,
      minRadius: 0.10,
      maxRadius: 2.00,
      black: 0.07,
      white: 0.94,
      contrast: 0.55,
      gamma: 1.20,
      levels: 12,
      toneMode: 'radius+alpha',
      alphaMin: 0.18,
      alphaMax: 0.82,
      threshold: 0.015,
      vignette: 0
    }),

    // Green "熱血" style: source shape used as a mask, filled by vertical bars.
    greenVerticalType: Object.freeze({
      fit: 'contain',
      background: '#000',
      color: '#00ff4c',
      pitch: 5,
      stripeWidth: 2,
      phase: 0,
      maskSource: 'auto',
      black: 0.05,
      white: 0.88,
      contrast: 1.10,
      gamma: 0.95,
      levels: 0,
      threshold: 0.025,
      opacity: 1
    }),

    // Same as above but transparent, more useful inside an existing compositor.
    greenVerticalTypeTransparent: Object.freeze({
      fit: 'contain',
      background: null,
      color: '#00ff4c',
      pitch: 5,
      stripeWidth: 2,
      phase: 0,
      maskSource: 'auto',
      black: 0.05,
      white: 0.88,
      contrast: 1.10,
      gamma: 0.95,
      levels: 0,
      threshold: 0.025,
      opacity: 1
    })
  });

  global.EventImageFX = {
    dotHalftone,
    verticalRaster,
    PRESETS
  };
})(typeof window !== 'undefined' ? window : globalThis);
