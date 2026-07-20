/** Signal measurement helpers shared by the statistics meter, grading and explanations. */

import { computeSpectrum, dominantFrequency, type WindowKind } from './fft';

export interface SignalStats {
  sampleCount: number;
  duration: number; // seconds
  mean: number;
  min: number;
  max: number;
  peak: number; // max(|x|)
  peakToPeak: number;
  rms: number;
  crestFactor: number; // peak / rms
  dominantFreq: number; // Hz, 0 if none found
  dominantAmp: number;
  clippingPct: number; // % samples with |x| >= 0.985
  zeroCrossingRate: number; // crossings per second
  snrEstimateDb: number | null; // null when not meaningful
}

export function computeStats(signal: Float32Array, sampleRate: number): SignalStats {
  const n = signal.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      duration: 0,
      mean: 0,
      min: 0,
      max: 0,
      peak: 0,
      peakToPeak: 0,
      rms: 0,
      crestFactor: 0,
      dominantFreq: 0,
      dominantAmp: 0,
      clippingPct: 0,
      zeroCrossingRate: 0,
      snrEstimateDb: null,
    };
  }
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  let clipped = 0;
  let crossings = 0;
  let prev = signal[0];
  for (let i = 0; i < n; i++) {
    const x = signal[i];
    sum += x;
    sumSq += x * x;
    if (x < min) min = x;
    if (x > max) max = x;
    if (Math.abs(x) >= 0.985) clipped++;
    if (i > 0 && ((prev < 0 && x >= 0) || (prev >= 0 && x < 0))) crossings++;
    prev = x;
  }
  const mean = sum / n;
  const rms = Math.sqrt(sumSq / n);
  const peak = Math.max(Math.abs(min), Math.abs(max));

  // Spectrum-based dominant frequency + SNR estimate
  const fftSize = Math.min(8192, 1 << Math.floor(Math.log2(Math.max(256, n))));
  let dominantFreq = 0;
  let dominantAmp = 0;
  let snr: number | null = null;
  if (n >= 256) {
    const spec = computeSpectrum(signal, sampleRate, fftSize, 'hann');
    const d = dominantFrequency(spec);
    dominantFreq = d.freq;
    dominantAmp = d.amplitude;
    snr = estimateSnrFromSpectrum(spec.magnitudes, spec.binHz, d.freq);
  }

  return {
    sampleCount: n,
    duration: n / sampleRate,
    mean,
    min,
    max,
    peak,
    peakToPeak: max - min,
    rms,
    crestFactor: rms > 1e-9 ? peak / rms : 0,
    dominantFreq,
    dominantAmp,
    clippingPct: (clipped / n) * 100,
    zeroCrossingRate: (crossings / n) * sampleRate,
    snrEstimateDb: snr,
  };
}

/**
 * Estimate SNR by treating the dominant peak (± a few bins, plus harmonics
 * excluded from neither side) as "signal" and everything else as "noise".
 * This is a heuristic — meaningful for tone+noise scenarios, labelled as an
 * estimate wherever shown.
 */
export function estimateSnrFromSpectrum(
  mags: Float32Array,
  binHz: number,
  peakFreq: number,
): number | null {
  if (peakFreq <= 0 || mags.length < 16) return null;
  const peakBin = Math.round(peakFreq / binHz);
  if (peakBin < 1 || peakBin >= mags.length) return null;
  const halfWidth = 3;
  let signalPower = 0;
  let noisePower = 0;
  let noiseBins = 0;
  for (let k = 1; k < mags.length; k++) {
    const p = mags[k] * mags[k];
    if (Math.abs(k - peakBin) <= halfWidth) signalPower += p;
    else {
      noisePower += p;
      noiseBins++;
    }
  }
  if (noiseBins === 0 || signalPower <= 0) return null;
  if (noisePower <= 1e-18) return 120; // effectively noiseless
  return 10 * Math.log10(signalPower / noisePower);
}

/** SNR between a known reference signal and a test signal (grading). */
export function snrAgainstReference(reference: Float32Array, test: Float32Array): number {
  const n = Math.min(reference.length, test.length);
  let sigP = 0;
  let errP = 0;
  for (let i = 0; i < n; i++) {
    const e = test[i] - reference[i];
    sigP += reference[i] * reference[i];
    errP += e * e;
  }
  if (errP <= 1e-18) return 120;
  if (sigP <= 1e-18) return -120;
  return 10 * Math.log10(sigP / errP);
}

export function rmsError(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/** Normalized cross-correlation at zero lag. */
export function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += a[i] * b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
  }
  const denom = Math.sqrt(saa * sbb);
  return denom > 1e-18 ? sab / denom : 0;
}

/** Max normalized cross-correlation over ± maxLag samples (alignment-tolerant grading). */
export function maxCorrelation(a: Float32Array, b: Float32Array, maxLag: number): number {
  let best = -1;
  for (let lag = -maxLag; lag <= maxLag; lag += Math.max(1, Math.floor(maxLag / 64))) {
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    const start = Math.max(0, -lag);
    const end = Math.min(a.length, b.length - lag);
    for (let i = start; i < end; i++) {
      sab += a[i] * b[i + lag];
      saa += a[i] * a[i];
      sbb += b[i + lag] * b[i + lag];
    }
    const denom = Math.sqrt(saa * sbb);
    const c = denom > 1e-18 ? sab / denom : 0;
    if (c > best) best = c;
  }
  return best;
}

/** Cosine similarity between two magnitude spectra (spectral similarity grading). */
export function spectralSimilarity(
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
  fftSize = 4096,
  window: WindowKind = 'hann',
): number {
  const sa = computeSpectrum(a, sampleRate, fftSize, window).magnitudes;
  const sb = computeSpectrum(b, sampleRate, fftSize, window).magnitudes;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 1; i < sa.length; i++) {
    dot += sa[i] * sb[i];
    na += sa[i] * sa[i];
    nb += sb[i] * sb[i];
  }
  const denom = Math.sqrt(na * nb);
  return denom > 1e-18 ? dot / denom : 0;
}

/** RMS in a frequency band via spectrum integration. */
export function bandRms(
  signal: Float32Array,
  sampleRate: number,
  loHz: number,
  hiHz: number,
  fftSize = 8192,
): number {
  const spec = computeSpectrum(signal, sampleRate, fftSize, 'hann');
  let p = 0;
  const lo = Math.max(1, Math.floor(loHz / spec.binHz));
  const hi = Math.min(spec.magnitudes.length - 1, Math.ceil(hiHz / spec.binHz));
  for (let k = lo; k <= hi; k++) {
    // amplitude -> RMS power of that component ~ (A/sqrt(2))^2
    p += (spec.magnitudes[k] * spec.magnitudes[k]) / 2;
  }
  return Math.sqrt(p);
}

/** Total harmonic distortion estimate from spectrum (ratio, not %). */
export function thdEstimate(
  signal: Float32Array,
  sampleRate: number,
  fundamental: number,
  harmonics = 5,
  fftSize = 8192,
): number | null {
  if (fundamental <= 0) return null;
  const spec = computeSpectrum(signal, sampleRate, fftSize, 'hann');
  const binOf = (f: number) => Math.round(f / spec.binHz);
  const ampAt = (f: number) => {
    const b = binOf(f);
    if (b < 1 || b >= spec.magnitudes.length) return 0;
    let m = 0;
    for (let k = Math.max(1, b - 2); k <= Math.min(spec.magnitudes.length - 1, b + 2); k++) {
      m = Math.max(m, spec.magnitudes[k]);
    }
    return m;
  };
  const a1 = ampAt(fundamental);
  if (a1 < 1e-9) return null;
  let sumSq = 0;
  for (let h = 2; h <= harmonics + 1; h++) {
    const f = fundamental * h;
    if (f >= sampleRate / 2) break;
    const a = ampAt(f);
    sumSq += a * a;
  }
  return Math.sqrt(sumSq) / a1;
}
