/**
 * Canvas plotting kit — instrument-style rendering shared by the node
 * screens, the inspector views and PNG export. Pure drawing functions; all
 * DSP happens before these are called.
 */

import { ampToDb, type SpectrumResult, type SpectrogramResult } from '@/engine/dsp/fft';

export const PLOT_COLORS = {
  bg: '#10141a',
  grid: 'rgba(120, 144, 156, 0.14)',
  gridMajor: 'rgba(120, 144, 156, 0.26)',
  trace: '#43e08a',
  traceB: '#ffb454',
  cursor: '#56c8ff',
  text: '#8d97a5',
  textBright: '#d6dbe3',
  marker: '#ff7a76',
};

export function clearPlot(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PLOT_COLORS.bg;
  ctx.fillRect(0, 0, w, h);
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  divX = 10,
  divY = 4,
): void {
  ctx.strokeStyle = PLOT_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < divX; i++) {
    const x = Math.round((i / divX) * w) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let i = 1; i < divY; i++) {
    const y = Math.round((i / divY) * h) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  // Center line stronger (scope zero axis)
  ctx.strokeStyle = PLOT_COLORS.gridMajor;
  ctx.beginPath();
  const cy = Math.round(h / 2) + 0.5;
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();
}

/** Find a trigger point (edge crossing of `level`) in the first half of data. */
export function findTrigger(
  data: Float32Array,
  mode: 'off' | 'rising' | 'falling',
  level: number,
  searchLen: number,
): number {
  if (mode === 'off') return 0;
  const n = Math.min(searchLen, data.length - 2);
  for (let i = 1; i < n; i++) {
    if (mode === 'rising' && data[i - 1] < level && data[i] >= level) return i;
    if (mode === 'falling' && data[i - 1] > level && data[i] <= level) return i;
  }
  return 0;
}

export interface ScopeOptions {
  yScale: number; // screen spans ±yScale
  color?: string;
  drawDots?: boolean;
}

/** Draw a waveform across the full canvas. data is exactly the window to show. */
export function drawScopeTrace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  data: Float32Array,
  opts: ScopeOptions,
): void {
  const { yScale } = opts;
  ctx.strokeStyle = opts.color ?? PLOT_COLORS.trace;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = data.length;
  if (n === 0) return;
  const toY = (v: number) => h / 2 - (v / yScale) * (h / 2);
  if (n <= w * 2) {
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1 || 1)) * w;
      const y = toY(data[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (opts.drawDots && n < w / 3) {
      ctx.fillStyle = opts.color ?? PLOT_COLORS.trace;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc((i / (n - 1 || 1)) * w, toY(data[i]), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // Min/max decimation per pixel column keeps peaks visible
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * n);
      const i1 = Math.min(n, Math.floor(((x + 1) / w) * n) + 1);
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = i0; i < i1; i++) {
        if (data[i] < mn) mn = data[i];
        if (data[i] > mx) mx = data[i];
      }
      if (x === 0) ctx.moveTo(x, toY(mx));
      ctx.lineTo(x, toY(mx));
      ctx.lineTo(x, toY(mn));
    }
    ctx.stroke();
  }
}

export interface SpectrumDrawOptions {
  freqScale: 'log' | 'linear';
  ampScale: 'db' | 'linear';
  minFreq?: number;
  maxFreq?: number;
  minDb?: number;
  markers?: { freq: number; label?: string }[];
  cursorFreq?: number | null;
  color?: string;
  fill?: boolean;
}

export function freqToX(
  f: number,
  w: number,
  scale: 'log' | 'linear',
  minF: number,
  maxF: number,
): number {
  if (scale === 'log') {
    const lmin = Math.log10(Math.max(1, minF));
    const lmax = Math.log10(maxF);
    return ((Math.log10(Math.max(1, f)) - lmin) / (lmax - lmin)) * w;
  }
  return ((f - minF) / (maxF - minF)) * w;
}

export function xToFreq(
  x: number,
  w: number,
  scale: 'log' | 'linear',
  minF: number,
  maxF: number,
): number {
  if (scale === 'log') {
    const lmin = Math.log10(Math.max(1, minF));
    const lmax = Math.log10(maxF);
    return Math.pow(10, lmin + (x / w) * (lmax - lmin));
  }
  return minF + (x / w) * (maxF - minF);
}

export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: SpectrumResult,
  opts: SpectrumDrawOptions,
): void {
  const minF = opts.minFreq ?? 20;
  const maxF = opts.maxFreq ?? (spec.magnitudes.length - 1) * spec.binHz;
  const minDb = opts.minDb ?? -100;
  const color = opts.color ?? PLOT_COLORS.trace;
  const toY = (mag: number): number => {
    if (opts.ampScale === 'db') {
      const db = ampToDb(mag, minDb);
      return h - ((db - minDb) / -minDb) * h;
    }
    return h - Math.min(1, mag) * h;
  };
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  let prevX = -1;
  let colMax = 0;
  for (let k = 1; k < spec.magnitudes.length; k++) {
    const f = k * spec.binHz;
    if (f < minF || f > maxF) continue;
    const x = Math.round(freqToX(f, w, opts.freqScale, minF, maxF));
    colMax = Math.max(colMax, spec.magnitudes[k]);
    if (x !== prevX) {
      const y = toY(colMax);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
      prevX = x;
      colMax = 0;
    }
  }
  ctx.stroke();
  if (opts.fill !== false) {
    ctx.globalAlpha = 0.12;
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Markers
  if (opts.markers) {
    ctx.fillStyle = PLOT_COLORS.marker;
    ctx.strokeStyle = PLOT_COLORS.marker;
    ctx.font = '9px "IBM Plex Mono", monospace';
    for (const mk of opts.markers) {
      const x = freqToX(mk.freq, w, opts.freqScale, minF, maxF);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 8);
      ctx.stroke();
      if (mk.label) ctx.fillText(mk.label, Math.min(x + 3, w - 52), 10);
    }
  }
  if (opts.cursorFreq != null) {
    const x = freqToX(opts.cursorFreq, w, opts.freqScale, minF, maxF);
    ctx.strokeStyle = PLOT_COLORS.cursor;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Frequency axis tick labels for spectra. */
export function drawFreqAxis(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: 'log' | 'linear',
  minF: number,
  maxF: number,
): void {
  ctx.fillStyle = PLOT_COLORS.text;
  ctx.font = '8.5px "IBM Plex Mono", monospace';
  const ticks: number[] = [];
  if (scale === 'log') {
    for (const base of [10, 100, 1000, 10000]) {
      for (const m of [1, 2, 5]) {
        const f = base * m;
        if (f >= minF && f <= maxF) ticks.push(f);
      }
    }
  } else {
    const step = niceStep((maxF - minF) / 6);
    for (let f = Math.ceil(minF / step) * step; f <= maxF; f += step) ticks.push(f);
  }
  for (const f of ticks) {
    const x = freqToX(f, w, scale, minF, maxF);
    ctx.fillRect(x, h - 4, 1, 4);
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    ctx.fillText(label, Math.min(x + 2, w - 20), h - 6);
  }
}

export function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const norm = raw / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

/* ---------- Spectrogram ---------- */

/** Perceptual-ish dark→phosphor colormap (deterministic, colorblind-tested ramp). */
export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  // dark navy → teal → green → yellow → white
  const r = Math.round(255 * Math.min(1, Math.max(0, 2.4 * x - 0.9)));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.6 * x - 0.05)));
  const b = Math.round(255 * Math.min(1, Math.max(0, x < 0.4 ? 0.3 + x : 1.4 - 1.8 * x)));
  return [r, g, b];
}

export function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sg: SpectrogramResult,
  maxFreq?: number,
): void {
  const bins = maxFreq ? Math.min(sg.bins, Math.ceil(maxFreq / sg.binHz)) : sg.bins;
  const img = ctx.createImageData(w, h);
  const span = Math.max(20, sg.maxDb - Math.max(sg.minDb, sg.maxDb - 80));
  const floor = sg.maxDb - span;
  for (let px = 0; px < w; px++) {
    const frame = Math.min(sg.frames - 1, Math.floor((px / w) * sg.frames));
    for (let py = 0; py < h; py++) {
      const bin = Math.min(bins - 1, Math.floor(((h - 1 - py) / h) * bins));
      const db = sg.db[frame * sg.bins + bin];
      const t = (db - floor) / span;
      const [r, g, b] = heatColor(t);
      const idx = (py * w + px) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draw the spectrogram color legend (vertical bar). */
export function drawHeatLegend(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const t = 1 - y / h;
    const [r, g, b] = heatColor(t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, w, 1);
  }
}
