/**
 * Biquad filter design (Audio EQ Cookbook / RBJ) and processing.
 *
 * These are the standard second-order IIR sections used by essentially every
 * practical audio tool. They are exact digital filters, not approximations —
 * but note they are second-order only; steeper responses would cascade
 * multiple sections. See docs/DSP_NOTES.md.
 */

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export function designBiquad(
  kind: BiquadKind,
  sampleRate: number,
  freq: number,
  q: number,
): BiquadCoeffs {
  const f = Math.min(Math.max(freq, 1), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * Math.max(q, 0.01));
  let b0: number, b1: number, b2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cosW) / 2;
      b1 = 1 - cosW;
      b2 = (1 - cosW) / 2;
      break;
    case 'highpass':
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
      break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosW;
      b2 = 1;
      break;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export function makeBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function processBiquad(
  input: Float32Array,
  output: Float32Array,
  c: BiquadCoeffs,
  s: BiquadState,
): void {
  let { x1, x2, y1, y2 } = s;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  // Flush denormals so long tails don't burn CPU
  s.x1 = Math.abs(x1) < 1e-30 ? 0 : x1;
  s.x2 = Math.abs(x2) < 1e-30 ? 0 : x2;
  s.y1 = Math.abs(y1) < 1e-30 ? 0 : y1;
  s.y2 = Math.abs(y2) < 1e-30 ? 0 : y2;
}

/** Theoretical magnitude response of a biquad at frequency f (for plots/tests). */
export function biquadMagnitudeAt(c: BiquadCoeffs, sampleRate: number, f: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const numIm = -(c.b1 * sin1 + c.b2 * sin2);
  const denRe = 1 + c.a1 * cos1 + c.a2 * cos2;
  const denIm = -(c.a1 * sin1 + c.a2 * sin2);
  return Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
}
