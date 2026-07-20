/**
 * Radix-2 in-place FFT plus window functions and spectrum helpers.
 *
 * This is a straightforward iterative Cooley–Tukey implementation — fast
 * enough for interactive FFT sizes up to LIMITS.maxFftSize (16384) at UI
 * refresh rates, and dependency-free so it runs identically in workers,
 * tests, and the main thread.
 */

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place complex FFT. re/im length must be a power of two. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`FFT size must be a power of two, got ${n}`);
  // Bit reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export type WindowKind = 'rectangular' | 'hann' | 'hamming' | 'blackman';

export const WINDOW_OPTIONS: { value: WindowKind; label: string }[] = [
  { value: 'hann', label: 'Hann' },
  { value: 'hamming', label: 'Hamming' },
  { value: 'blackman', label: 'Blackman' },
  { value: 'rectangular', label: 'Rectangular' },
];

export function makeWindow(kind: WindowKind, n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    switch (kind) {
      case 'hann':
        w[i] = 0.5 * (1 - Math.cos(x));
        break;
      case 'hamming':
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case 'blackman':
        w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
      default:
        w[i] = 1;
    }
  }
  return w;
}

/** Coherent gain of a window (mean of samples) for amplitude correction. */
export function windowCoherentGain(w: Float64Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s / w.length;
}

export interface SpectrumResult {
  /** Single-sided magnitude, length fftSize/2, amplitude-corrected so a
   * full-scale sine reads ~1.0 in its bin. */
  magnitudes: Float32Array;
  binHz: number;
  fftSize: number;
}

/**
 * Compute a single-sided amplitude spectrum of `signal` (zero-padded or
 * truncated to fftSize) using the given window.
 */
export function computeSpectrum(
  signal: Float32Array,
  sampleRate: number,
  fftSize: number,
  window: WindowKind = 'hann',
  offset = 0,
): SpectrumResult {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const w = makeWindow(window, fftSize);
  const cg = windowCoherentGain(w) || 1;
  const n = Math.min(fftSize, Math.max(0, signal.length - offset));
  for (let i = 0; i < n; i++) re[i] = signal[offset + i] * w[i];
  fftInPlace(re, im);
  const half = fftSize / 2;
  const mags = new Float32Array(half);
  const scale = 2 / (fftSize * cg);
  for (let k = 0; k < half; k++) {
    mags[k] = Math.hypot(re[k], im[k]) * (k === 0 ? 0.5 * scale * 2 : scale);
  }
  // DC bin should not be doubled
  mags[0] = Math.hypot(re[0], im[0]) / (fftSize * cg);
  return { magnitudes: mags, binHz: sampleRate / fftSize, fftSize };
}

/** Find the dominant (largest magnitude, ignoring DC) bin with parabolic interpolation. */
export function dominantFrequency(spec: SpectrumResult): { freq: number; amplitude: number } {
  const m = spec.magnitudes;
  let best = 1;
  for (let k = 2; k < m.length; k++) if (m[k] > m[best]) best = k;
  let freq = best * spec.binHz;
  // Parabolic interpolation around the peak for sub-bin accuracy
  if (best > 1 && best < m.length - 1) {
    const a = m[best - 1];
    const b = m[best];
    const c = m[best + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) {
      const p = (0.5 * (a - c)) / denom;
      if (Math.abs(p) <= 1) freq = (best + p) * spec.binHz;
    }
  }
  return { freq, amplitude: m[best] };
}

/** Convert amplitude to dBFS-style decibels with a floor. */
export function ampToDb(a: number, floor = -120): number {
  if (a <= 0) return floor;
  return Math.max(floor, 20 * Math.log10(a));
}

export interface SpectrogramResult {
  /** frames x (fftSize/2) magnitudes in dB. */
  db: Float32Array;
  frames: number;
  bins: number;
  binHz: number;
  hopSeconds: number;
  minDb: number;
  maxDb: number;
}

export function computeSpectrogram(
  signal: Float32Array,
  sampleRate: number,
  fftSize: number,
  overlap: number, // 0..0.95
  window: WindowKind = 'hann',
  maxFrames = 600,
): SpectrogramResult {
  const hop = Math.max(16, Math.round(fftSize * (1 - overlap)));
  let frames = Math.max(1, Math.floor((signal.length - fftSize) / hop) + 1);
  let stride = 1;
  if (frames > maxFrames) {
    stride = Math.ceil(frames / maxFrames);
    frames = Math.ceil(frames / stride);
  }
  const bins = fftSize / 2;
  const db = new Float32Array(frames * bins);
  const w = makeWindow(window, fftSize);
  const cg = windowCoherentGain(w) || 1;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const scale = 2 / (fftSize * cg);
  let minDb = 0;
  let maxDb = -160;
  for (let f = 0; f < frames; f++) {
    const off = f * hop * stride;
    re.fill(0);
    im.fill(0);
    const n = Math.min(fftSize, signal.length - off);
    for (let i = 0; i < n; i++) re[i] = signal[off + i] * w[i];
    fftInPlace(re, im);
    for (let k = 0; k < bins; k++) {
      const v = ampToDb(Math.hypot(re[k], im[k]) * scale);
      db[f * bins + k] = v;
      if (v < minDb) minDb = v;
      if (v > maxDb) maxDb = v;
    }
  }
  return {
    db,
    frames,
    bins,
    binHz: sampleRate / fftSize,
    hopSeconds: (hop * stride) / sampleRate,
    minDb,
    maxDb,
  };
}
