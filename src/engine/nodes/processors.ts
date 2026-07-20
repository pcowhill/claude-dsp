/**
 * Processing node definitions: level, distortion, sampling, filters,
 * modulation, delay/feedback and convolution.
 */

import type { NodeDef, ParamDef, ParamValue } from '@/model/types';
import { LIMITS } from '@/model/types';
import { pnum, pstr, pbool, dbToLin } from './helpers';
import {
  designBiquad,
  makeBiquadState,
  processBiquad,
  type BiquadKind,
  type BiquadCoeffs,
  type BiquadState,
} from '../dsp/biquad';
import { fftInPlace } from '../dsp/fft';
import { mulberry32 } from '../dsp/rng';

const TWO_PI = 2 * Math.PI;

const IN_SIGNAL = { id: 'in', label: 'In', kind: 'signal' as const };
const OUT_SIGNAL = { id: 'out', label: 'Out', kind: 'signal' as const };

const mixParam: ParamDef = {
  id: 'mix',
  label: 'Dry/Wet',
  type: 'number',
  default: 1,
  min: 0,
  max: 1,
  step: 0.01,
  control: 'slider',
  digits: 2,
  help: '0 = only the unprocessed (dry) signal, 1 = only the processed (wet) signal.',
};

export const gainNode: NodeDef = {
  type: 'proc.gain',
  title: 'Gain',
  category: 'process',
  blurb: 'Amplify or attenuate (dB)',
  description:
    'Multiplies the signal by a constant factor, set in decibels. +6 dB roughly doubles amplitude; −6 dB halves it. 0 dB leaves the signal unchanged.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'gain',
      label: 'Gain',
      type: 'number',
      default: 0,
      unit: 'dB',
      min: -60,
      max: 24,
      step: 0.1,
      control: 'knob',
      primary: true,
      digits: 1,
      help: 'Decibels: +6 dB ≈ ×2 amplitude, −20 dB = ×0.1.',
    },
  ],
  math: {
    title: 'Gain in decibels',
    equations: ['y[n] = g \\cdot x[n]', 'g = 10^{G_{dB}/20}'],
    symbols: { g: 'linear gain factor', 'G_{dB}': 'gain in decibels' },
    interpretation:
      'Decibels are logarithmic: every +20 dB multiplies amplitude by 10. Power goes as amplitude squared, so +20 dB is ×100 in power.',
    substitute: (p) => {
      const g = pnum(p, 'gain', 0);
      return `g = 10^{${g.toFixed(1)}/20} = ${dbToLin(g).toFixed(3)}`;
    },
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const g = dbToLin(pnum(params, 'gain', 0));
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) out[i] = g * x[i];
  },
};

export const dcOffsetNode: NodeDef = {
  type: 'proc.dcoffset',
  title: 'DC Offset',
  category: 'process',
  blurb: 'Add a constant level',
  description:
    'Adds a constant to every sample, shifting the whole waveform up or down. DC carries no sound but wastes headroom and can harm speakers — the statistics meter shows it as a non-zero mean.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'offset',
      label: 'Offset',
      type: 'number',
      default: 0.2,
      min: -1,
      max: 1,
      step: 0.01,
      control: 'knob',
      primary: true,
      digits: 2,
    },
  ],
  math: {
    title: 'DC offset',
    equations: ['y[n] = x[n] + C'],
    symbols: { C: 'constant offset' },
    interpretation:
      'Adds energy only at 0 Hz. A high-pass filter with a very low cutoff removes DC without touching audible content.',
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const c = pnum(params, 'offset', 0.2);
    if (!x) {
      out.fill(c);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) out[i] = x[i] + c;
  },
};

export const mixerNode: NodeDef = {
  type: 'proc.mixer',
  title: 'Mixer',
  category: 'process',
  blurb: 'Add up to 4 signals',
  description:
    'Adds its inputs sample by sample, each through its own level control. Addition is how signals combine in the real world — interference, beating and cancellation all come from this node.',
  inputs: [
    { id: 'in1', label: 'In 1', kind: 'signal', optional: true },
    { id: 'in2', label: 'In 2', kind: 'signal', optional: true },
    { id: 'in3', label: 'In 3', kind: 'signal', optional: true },
    { id: 'in4', label: 'In 4', kind: 'signal', optional: true },
  ],
  outputs: [OUT_SIGNAL],
  params: [1, 2, 3, 4].map(
    (i): ParamDef => ({
      id: `g${i}`,
      label: `Level ${i}`,
      type: 'number',
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
      control: 'slider',
      primary: i <= 2,
      digits: 2,
    }),
  ),
  math: {
    title: 'Superposition',
    equations: ['y[n] = \\sum_{k} g_k \\, x_k[n]'],
    symbols: { 'x_k[n]': 'input k', 'g_k': 'level for input k' },
    interpretation:
      'Linear systems obey superposition: the response to a sum is the sum of the responses. Two equal tones in phase double (+6 dB); in opposite phase they cancel to silence.',
  },
  process(ctx, inputs, outputs, params) {
    const out = outputs[0];
    out.fill(0);
    for (let k = 0; k < 4; k++) {
      const x = inputs[k];
      if (!x) continue;
      const g = pnum(params, `g${k + 1}`, 1);
      for (let i = 0; i < ctx.blockSize; i++) out[i] += g * x[i];
    }
  },
};

export const delayNode: NodeDef = {
  type: 'proc.delay',
  title: 'Delay',
  category: 'process',
  blurb: 'Shift the signal in time',
  description:
    'Delays the signal by a set time and mixes it with the original. A single short delay creates comb filtering; longer delays are heard as an echo.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'time',
      label: 'Delay',
      type: 'number',
      default: 250,
      unit: 'ms',
      min: 0.1,
      max: LIMITS.maxDelaySeconds * 1000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 1,
    },
    { ...mixParam, default: 0.5, primary: true, control: 'knob' },
  ],
  math: {
    title: 'Pure delay',
    equations: ['y[n] = (1-m)\\,x[n] + m\\,x[n - D]', 'D = t_{delay} \\cdot f_s'],
    symbols: { D: 'delay in samples', m: 'dry/wet mix', 'f_s': 'sample rate' },
    interpretation:
      'Mixing a signal with a delayed copy cancels frequencies whose half-period matches the delay — a comb filter. Delays beyond ~50 ms are perceived as distinct echoes.',
    substitute: (p, sr) => {
      const d = Math.round((pnum(p, 'time', 250) / 1000) * sr);
      return `D = ${(pnum(p, 'time', 250) / 1000).toFixed(3)} \\cdot ${sr} = ${d}\\ \\text{samples}`;
    },
  },
  createState: (sr) => ({
    buf: new Float32Array(Math.ceil(sr * LIMITS.maxDelaySeconds) + 1),
    w: 0,
  }),
  process(ctx, inputs, outputs, params, s) {
    const x = inputs[0];
    const out = outputs[0];
    const buf = s.buf as Float32Array;
    const mix = pnum(params, 'mix', 0.5);
    const D = Math.min(
      buf.length - 1,
      Math.max(1, Math.round((pnum(params, 'time', 250) / 1000) * ctx.sampleRate)),
    );
    for (let i = 0; i < ctx.blockSize; i++) {
      const xi = x ? x[i] : 0;
      const r = (s.w - D + buf.length) % buf.length;
      out[i] = (1 - mix) * xi + mix * buf[r];
      buf[s.w] = xi;
      s.w = (s.w + 1) % buf.length;
    }
  },
};

export const clipNode: NodeDef = {
  type: 'proc.clip',
  title: 'Hard Clip',
  category: 'process',
  blurb: 'Chop peaks at a threshold',
  description:
    'Any sample beyond ±threshold is chopped flat. Clipping creates strong odd harmonics — the classic "digital distortion" sound — clearly visible in the spectrum.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'threshold',
      label: 'Threshold',
      type: 'number',
      default: 0.5,
      min: 0.02,
      max: 1,
      step: 0.01,
      control: 'knob',
      primary: true,
      digits: 2,
      help: 'Samples with |x| above this are flattened to ±threshold.',
    },
  ],
  math: {
    title: 'Hard clipping',
    equations: ['y[n] = \\max(-T, \\min(T, x[n]))'],
    symbols: { T: 'clip threshold' },
    interpretation:
      'The flattened tops turn a sine toward a square wave, adding odd harmonics at 3f, 5f, 7f… The harder the signal drives into the threshold, the stronger the harmonics.',
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const t = pnum(params, 'threshold', 0.5);
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) {
      out[i] = Math.max(-t, Math.min(t, x[i]));
    }
  },
};

export const saturateNode: NodeDef = {
  type: 'proc.saturate',
  title: 'Saturation',
  category: 'process',
  blurb: 'Soft, tape-like overdrive',
  description:
    'Smoothly compresses peaks using a tanh curve instead of chopping them. Sounds warmer than hard clipping because harmonics appear gradually as drive increases.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'drive',
      label: 'Drive',
      type: 'number',
      default: 2,
      min: 0.1,
      max: 20,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 2,
      help: 'Input gain into the tanh curve. Higher drive = more distortion.',
    },
  ],
  math: {
    title: 'Soft saturation',
    equations: ['y[n] = \\frac{\\tanh(d \\cdot x[n])}{\\tanh(d)}'],
    symbols: { d: 'drive', '\\tanh': 'hyperbolic tangent — a smooth S-shaped curve' },
    interpretation:
      'For small signals tanh is nearly linear (no distortion); large peaks are squeezed toward ±1. The division normalizes so a full-scale input still peaks at 1.',
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const d = Math.max(0.1, pnum(params, 'drive', 2));
    const norm = 1 / Math.tanh(d);
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) out[i] = Math.tanh(d * x[i]) * norm;
  },
};

export const quantizeNode: NodeDef = {
  type: 'proc.quantize',
  title: 'Quantizer',
  category: 'process',
  blurb: 'Round samples to a step size',
  description:
    'Rounds every sample to the nearest multiple of a step size, like an ADC with coarse resolution. The rounding error is heard as quantization noise.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'step',
      label: 'Step Size',
      type: 'number',
      default: 0.25,
      min: 0.001,
      max: 1,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 3,
      help: 'Distance between allowed output levels. Smaller = finer resolution.',
    },
  ],
  math: {
    title: 'Quantization',
    equations: [
      'y[n] = \\Delta \\cdot \\operatorname{round}\\!\\left(\\frac{x[n]}{\\Delta}\\right)',
      'e[n] = y[n] - x[n], \\quad |e[n]| \\leq \\Delta/2',
    ],
    symbols: { '\\Delta': 'quantization step size', 'e[n]': 'quantization error' },
    interpretation:
      'The error is bounded by half a step. For busy signals it behaves like added noise with RMS ≈ Δ/√12; for simple tones it becomes correlated, buzzy distortion.',
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const step = Math.max(1e-4, pnum(params, 'step', 0.25));
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) out[i] = step * Math.round(x[i] / step);
  },
};

export const bitcrushNode: NodeDef = {
  type: 'proc.bitcrush',
  title: 'Bit Depth',
  category: 'process',
  blurb: 'Reduce resolution in bits',
  description:
    'Re-quantizes the signal to a chosen number of bits over the ±1 range. Each bit of depth adds ~6 dB of dynamic range; 8-bit audio has a noticeably gritty noise floor.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'bits',
      label: 'Bit Depth',
      type: 'number',
      default: 8,
      unit: 'bits',
      min: 1,
      max: 16,
      step: 1,
      control: 'knob',
      primary: true,
      digits: 0,
    },
  ],
  math: {
    title: 'Bit depth and dynamic range',
    equations: ['L = 2^{B}', '\\text{SNR}_{max} \\approx 6.02\\,B + 1.76\\ \\text{dB}'],
    symbols: { B: 'bits per sample', L: 'number of levels', '\\text{SNR}_{max}': 'best-case signal-to-noise ratio' },
    interpretation:
      'Each extra bit doubles the number of levels and buys ~6 dB of SNR. CD audio (16-bit) reaches ~98 dB; 8-bit only ~50 dB.',
    substitute: (p) => {
      const b = pnum(p, 'bits', 8);
      return `L = 2^{${b}} = ${Math.pow(2, b)}, \\quad \\text{SNR}_{max} \\approx ${(6.02 * b + 1.76).toFixed(1)}\\ \\text{dB}`;
    },
  },
  process(ctx, inputs, outputs, params) {
    const x = inputs[0];
    const out = outputs[0];
    const bits = Math.max(1, Math.min(16, Math.round(pnum(params, 'bits', 8))));
    const levels = Math.pow(2, bits - 1); // per polarity
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) {
      const clamped = Math.max(-1, Math.min(1, x[i]));
      out[i] = Math.round(clamped * levels) / levels;
    }
  },
};

export const srConvertNode: NodeDef = {
  type: 'proc.srconvert',
  title: 'Resampler',
  category: 'process',
  blurb: 'Simulate a lower sample rate',
  description:
    'Simulates re-sampling the signal at a lower rate: optionally low-pass filters (anti-aliasing), then holds each kept sample (zero-order hold). Turn the anti-alias filter off to hear and see aliasing.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'targetRate',
      label: 'Target Rate',
      type: 'number',
      default: 8000,
      unit: 'Hz',
      min: 500,
      max: 48000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
      help: 'The simulated new sample rate. Content above half this rate will alias unless filtered first.',
    },
    {
      id: 'antialias',
      label: 'Anti-Alias Filter',
      type: 'boolean',
      default: true,
      control: 'toggle',
      primary: true,
      help: 'Low-pass at 45% of the target rate before resampling — the textbook way to prevent aliasing.',
    },
  ],
  math: {
    title: 'Sampling and the Nyquist limit',
    equations: [
      'f_{Nyquist} = \\frac{f_{s,new}}{2}',
      'f_{alias} = |f - k f_{s,new}| \\;\\; (k \\in \\mathbb{Z}\\text{, folding into } [0, f_{Nyquist}])',
    ],
    symbols: {
      'f_{s,new}': 'the new (lower) sample rate',
      'f_{Nyquist}': 'highest representable frequency',
      'f_{alias}': 'where an out-of-band frequency f reappears',
    },
    interpretation:
      'Frequencies above the Nyquist limit do not disappear — they fold back to a mirror frequency below it. The anti-alias filter removes them before the sampling step, which is the only correct place to do it.',
    limitations:
      'This node simulates the effect at the engine rate using a 2×biquad anti-alias filter and zero-order hold reconstruction; a production resampler would use a long polyphase FIR.',
    substitute: (p) => {
      const t = pnum(p, 'targetRate', 8000);
      return `f_{Nyquist} = ${t}/2 = ${(t / 2).toFixed(0)}\\ \\text{Hz}`;
    },
  },
  createState: () => ({
    lp1: makeBiquadState(),
    lp2: makeBiquadState(),
    coeffs: null as BiquadCoeffs | null,
    coeffKey: '',
    hold: 0,
    frac: 0,
    tmp: new Float32Array(LIMITS.blockSize),
  }),
  process(ctx, inputs, outputs, params, s) {
    const x = inputs[0];
    const out = outputs[0];
    if (!x) {
      out.fill(0);
      return;
    }
    const target = Math.max(500, Math.min(ctx.sampleRate, pnum(params, 'targetRate', 8000)));
    const antialias = pbool(params, 'antialias', true);
    let src = x;
    if (antialias && target < ctx.sampleRate) {
      const key = `${target}|${ctx.sampleRate}`;
      if (s.coeffKey !== key) {
        s.coeffs = designBiquad('lowpass', ctx.sampleRate, target * 0.45, 0.707);
        s.coeffKey = key;
      }
      const tmp = s.tmp as Float32Array;
      processBiquad(x, tmp, s.coeffs as BiquadCoeffs, s.lp1 as BiquadState);
      processBiquad(tmp, tmp, s.coeffs as BiquadCoeffs, s.lp2 as BiquadState);
      src = tmp;
    }
    const ratio = target / ctx.sampleRate; // fraction of samples kept
    for (let i = 0; i < ctx.blockSize; i++) {
      s.frac += ratio;
      if (s.frac >= 1) {
        s.frac -= 1;
        s.hold = src[i];
      }
      out[i] = s.hold;
    }
  },
};

function makeFilterNode(
  type: string,
  title: string,
  kind: BiquadKind,
  blurb: string,
  description: string,
  defaultFreq: number,
  interpretation: string,
): NodeDef {
  return {
    type,
    title,
    category: 'process',
    blurb,
    description,
    inputs: [IN_SIGNAL],
    outputs: [OUT_SIGNAL],
    params: [
      {
        id: 'freq',
        label: kind === 'bandpass' || kind === 'notch' ? 'Center Freq' : 'Cutoff',
        type: 'number',
        default: defaultFreq,
        unit: 'Hz',
        min: 10,
        max: 20000,
        scale: 'log',
        control: 'knob',
        primary: true,
        digits: 0,
        help:
          kind === 'lowpass' || kind === 'highpass'
            ? 'The −3 dB point: where the filter has reduced amplitude to ~70.7%.'
            : 'The frequency the filter is centered on.',
      },
      {
        id: 'q',
        label: 'Q (Resonance)',
        type: 'number',
        default: 0.707,
        min: 0.1,
        max: 20,
        scale: 'log',
        control: 'knob',
        primary: true,
        digits: 2,
        help:
          'Sharpness. 0.707 is maximally flat (Butterworth). Higher Q = narrower/steeper, with a resonant peak on low/high-pass filters.',
      },
    ],
    math: {
      title: `${title} (biquad)`,
      equations: [
        'y[n] = b_0 x[n] + b_1 x[n-1] + b_2 x[n-2] - a_1 y[n-1] - a_2 y[n-2]',
        'H(f)\\ \\text{from the RBJ Audio-EQ cookbook design for } f_c, Q',
      ],
      symbols: {
        'b_i, a_i': 'filter coefficients computed from cutoff and Q',
        'f_c': 'cutoff / center frequency',
        Q: 'quality factor (sharpness)',
        'H(f)': 'frequency response',
      },
      interpretation,
      limitations:
        'A single biquad is a 2nd-order filter (−12 dB/octave for low/high-pass). Steeper slopes require cascading several sections.',
    },
    createState: () => ({
      bs: makeBiquadState(),
      coeffs: null as BiquadCoeffs | null,
      key: '',
    }),
    process(ctx, inputs, outputs, params, s) {
      const x = inputs[0];
      const out = outputs[0];
      if (!x) {
        out.fill(0);
        return;
      }
      const f = pnum(params, 'freq', defaultFreq);
      const q = pnum(params, 'q', 0.707);
      const key = `${f}|${q}|${ctx.sampleRate}`;
      if (s.key !== key) {
        s.coeffs = designBiquad(kind, ctx.sampleRate, f, q);
        s.key = key;
      }
      processBiquad(x, out, s.coeffs as BiquadCoeffs, s.bs as BiquadState);
    },
  };
}

export const lowpassNode = makeFilterNode(
  'proc.lowpass',
  'Low-Pass Filter',
  'lowpass',
  'Keep lows, remove highs',
  'Passes frequencies below the cutoff and attenuates those above at −12 dB per octave. The everyday "muffle" — walls, pillows and distance are all low-pass filters.',
  1000,
  'Below f_c the response is ~1 (unchanged). At f_c it is −3 dB. Each octave above loses another 12 dB. Raising Q adds a resonant peak right at the cutoff.',
);

export const highpassNode = makeFilterNode(
  'proc.highpass',
  'High-Pass Filter',
  'highpass',
  'Keep highs, remove lows',
  'Passes frequencies above the cutoff and attenuates those below at −12 dB per octave. Used to remove rumble, DC offset and low-frequency hum.',
  200,
  'The mirror image of a low-pass: content below f_c is progressively removed. A high-pass with a very low cutoff (5–20 Hz) is the standard DC-blocking tool.',
);

export const bandpassNode = makeFilterNode(
  'proc.bandpass',
  'Band-Pass Filter',
  'bandpass',
  'Keep a band, remove the rest',
  'Passes only frequencies near the center. Bandwidth is set by Q: the passband is roughly f_c/Q wide. Telephone audio (~300–3400 Hz) is band-passed speech.',
  1000,
  'The −3 dB bandwidth is BW ≈ f_c / Q. High Q isolates a single tone; low Q passes a broad region. Use it to pick one component out of a mixture.',
);

export const bandstopNode = makeFilterNode(
  'proc.bandstop',
  'Band-Stop (Notch)',
  'notch',
  'Remove a narrow band',
  'Rejects a narrow band around the center frequency and passes everything else. The classic tool for removing mains hum (50/60 Hz) or a whistle from a recording.',
  60,
  'The notch depth is very high exactly at f_c; the width is f_c/Q. High Q makes a surgical notch that barely touches neighbouring frequencies.',
);

export const movingAvgNode: NodeDef = {
  type: 'proc.movingavg',
  title: 'Moving Average',
  category: 'process',
  blurb: 'Average the last N samples',
  description:
    'Replaces each sample with the average of the last N samples — the simplest FIR low-pass filter. Great smoothing, but with deep comb-like notches at multiples of fs/N.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'length',
      label: 'Window',
      type: 'number',
      default: 16,
      unit: 'samples',
      min: 2,
      max: 512,
      step: 1,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
    },
  ],
  math: {
    title: 'Moving average filter',
    equations: [
      'y[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} x[n-k]',
      '|H(f)| = \\left| \\frac{\\sin(\\pi f N / f_s)}{N \\sin(\\pi f / f_s)} \\right|',
    ],
    symbols: { N: 'window length in samples', '|H(f)|': 'magnitude response (a Dirichlet kernel)' },
    interpretation:
      'The response has nulls at every multiple of f_s/N: components with a whole number of cycles inside the window average to exactly zero.',
    substitute: (p, sr) => {
      const n = Math.round(pnum(p, 'length', 16));
      return `\\text{first null at } f_s/N = ${sr}/${n} = ${(sr / n).toFixed(1)}\\ \\text{Hz}`;
    },
  },
  createState: () => ({ buf: new Float32Array(512), w: 0, sum: 0, count: 0 }),
  process(ctx, inputs, outputs, params, s) {
    const x = inputs[0];
    const out = outputs[0];
    if (!x) {
      out.fill(0);
      return;
    }
    const N = Math.max(2, Math.min(512, Math.round(pnum(params, 'length', 16))));
    const buf = s.buf as Float32Array;
    for (let i = 0; i < ctx.blockSize; i++) {
      buf[s.w] = x[i];
      s.w = (s.w + 1) % 512;
      // Recompute sum over window each sample would be O(N); keep running sum
      // over exactly N by subtracting the sample leaving the window.
      const leaving = buf[(s.w - 1 - N + 1024) % 512];
      s.sum += x[i];
      if (s.count < N) {
        s.count++;
      } else {
        s.sum -= leaving;
      }
      out[i] = s.sum / N;
      // Guard drift/config changes
      if (s.count > N) {
        s.count = N;
      }
    }
    // Periodically rebuild the sum to cancel floating point drift
    if ((ctx.startSample / ctx.blockSize) % 256 === 0) {
      let acc = 0;
      for (let k = 0; k < s.count; k++) acc += buf[(s.w - 1 - k + 1024) % 512];
      s.sum = acc;
    }
  },
};

export const amNode: NodeDef = {
  type: 'proc.am',
  title: 'AM Modulator',
  category: 'process',
  blurb: 'Amplitude-modulate a carrier',
  description:
    'Uses the input as the message that varies the amplitude of an internally generated carrier. Standard AM keeps the carrier; multiply mode (DSB-SC) suppresses it.',
  inputs: [{ id: 'msg', label: 'Message', kind: 'control' }],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'carrier',
      label: 'Carrier',
      type: 'number',
      default: 4000,
      unit: 'Hz',
      min: 100,
      max: 20000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
    },
    {
      id: 'depth',
      label: 'Mod Depth',
      type: 'number',
      default: 0.8,
      min: 0,
      max: 1.5,
      step: 0.01,
      control: 'knob',
      primary: true,
      digits: 2,
      help: 'Modulation index m. Above 1.0 the envelope over-modulates and distorts on recovery.',
    },
    {
      id: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'am',
      options: [
        { value: 'am', label: 'AM (with carrier)' },
        { value: 'dsb', label: 'Multiply (DSB-SC)' },
      ],
      control: 'select',
    },
    { ...gainNode.params[0], id: 'level', label: 'Level', default: -6, primary: false },
  ],
  math: {
    title: 'Amplitude modulation',
    equations: [
      'y(t) = [1 + m \\cdot x(t)] \\cos(2\\pi f_c t)',
      '\\cos(2\\pi f_m t)\\cos(2\\pi f_c t) = \\tfrac{1}{2}\\cos(2\\pi (f_c{-}f_m) t) + \\tfrac{1}{2}\\cos(2\\pi (f_c{+}f_m) t)',
    ],
    symbols: {
      'f_c': 'carrier frequency',
      'f_m': 'message frequency',
      m: 'modulation depth (index)',
      'x(t)': 'message signal (should stay within ±1)',
    },
    interpretation:
      'Modulating amplitude creates sidebands at f_c ± f_m: the message is shifted up next to the carrier. The spectrum shows the carrier line flanked by mirror-image copies of the message spectrum.',
  },
  createState: () => ({ phase: 0 }),
  process(ctx, inputs, outputs, params, s) {
    const msg = inputs[0];
    const out = outputs[0];
    const inc = pnum(params, 'carrier', 4000) / ctx.sampleRate;
    const m = pnum(params, 'depth', 0.8);
    const mode = pstr(params, 'mode', 'am');
    const level = dbToLin(pnum(params, 'level', -6));
    for (let i = 0; i < ctx.blockSize; i++) {
      const c = Math.cos(TWO_PI * s.phase);
      const x = msg ? msg[i] : 0;
      out[i] = level * (mode === 'am' ? (1 + m * x) * c : m * x * c);
      s.phase += inc;
      if (s.phase >= 1) s.phase -= 1;
    }
  },
};

export const fmNode: NodeDef = {
  type: 'proc.fm',
  title: 'FM Modulator',
  category: 'process',
  blurb: 'Frequency-modulate a carrier',
  description:
    'Uses the input to push the frequency of an internal carrier up and down around its center. Small deviation vibrato; large deviation dense, bright sidebands.',
  inputs: [{ id: 'msg', label: 'Message', kind: 'control' }],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'carrier',
      label: 'Carrier',
      type: 'number',
      default: 1000,
      unit: 'Hz',
      min: 20,
      max: 20000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
    },
    {
      id: 'deviation',
      label: 'Deviation',
      type: 'number',
      default: 200,
      unit: 'Hz',
      min: 0,
      max: 5000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
      help: 'How far a full-scale message pushes the instantaneous frequency.',
    },
    { ...ampParamLike('level', 0.8) },
  ],
  math: {
    title: 'Frequency modulation',
    equations: [
      'y(t) = A\\cos\\!\\Big(2\\pi f_c t + 2\\pi \\Delta f \\int_0^t x(\\tau)\\,d\\tau\\Big)',
      'f_{inst}(t) = f_c + \\Delta f \\cdot x(t)',
      '\\beta = \\frac{\\Delta f}{f_m} \\quad \\text{(modulation index)}',
    ],
    symbols: {
      'f_c': 'carrier (center) frequency',
      '\\Delta f': 'peak deviation in hertz',
      'f_{inst}': 'instantaneous frequency',
      '\\beta': 'modulation index — controls sideband count (Carson: BW ≈ 2(Δf + f_m))',
    },
    interpretation:
      'The message changes the carrier’s frequency, not its level. Sidebands appear at f_c ± k·f_m with Bessel-function amplitudes; increasing β spreads energy into more sidebands.',
  },
  createState: () => ({ phase: 0 }),
  process(ctx, inputs, outputs, params, s) {
    const msg = inputs[0];
    const out = outputs[0];
    const fc = pnum(params, 'carrier', 1000);
    const dev = pnum(params, 'deviation', 200);
    const amp = pnum(params, 'level', 0.8);
    const sr = ctx.sampleRate;
    for (let i = 0; i < ctx.blockSize; i++) {
      const x = msg ? msg[i] : 0;
      const f = Math.max(0, Math.min(sr * 0.49, fc + dev * x));
      out[i] = amp * Math.cos(TWO_PI * s.phase);
      s.phase += f / sr;
      if (s.phase >= 1) s.phase -= 1;
    }
  },
};

function ampParamLike(id: string, def: number): ParamDef {
  return {
    id,
    label: 'Level',
    type: 'number',
    default: def,
    min: 0,
    max: 1.5,
    step: 0.01,
    control: 'knob',
    digits: 2,
  };
}

/** ---- Convolution (uniform partitioned overlap-save FFT convolution) ---- */

export type IrKind = 'echo-short' | 'echo-long' | 'room-small' | 'room-large' | 'smooth';

export function synthesizeIr(kind: IrKind, sr: number): Float32Array {
  const rand = mulberry32(0x5eed1234);
  switch (kind) {
    case 'echo-short': {
      const ir = new Float32Array(Math.floor(sr * 0.28));
      ir[0] = 1;
      ir[Math.floor(sr * 0.12)] = 0.55;
      ir[Math.floor(sr * 0.24)] = 0.3;
      return ir;
    }
    case 'echo-long': {
      const ir = new Float32Array(Math.floor(sr * 0.85));
      ir[0] = 1;
      for (let k = 1; k <= 4; k++) {
        ir[Math.floor(sr * 0.2 * k)] = Math.pow(0.55, k);
      }
      return ir;
    }
    case 'room-small': {
      const n = Math.floor(sr * 0.18);
      const ir = new Float32Array(n);
      ir[0] = 1;
      for (let i = 1; i < n; i++) {
        ir[i] = (rand() * 2 - 1) * Math.exp((-6.9 * i) / n) * 0.35;
      }
      return normalizeIr(ir, 0.85);
    }
    case 'room-large': {
      const n = Math.floor(sr * 0.9);
      const ir = new Float32Array(n);
      ir[0] = 0.8;
      // sparse early reflections then dense decaying tail
      ir[Math.floor(sr * 0.019)] = 0.5;
      ir[Math.floor(sr * 0.031)] = 0.4;
      ir[Math.floor(sr * 0.047)] = 0.35;
      let lp = 0;
      for (let i = Math.floor(sr * 0.05); i < n; i++) {
        // progressively low-passed noise tail (darker as it decays)
        const w = (rand() * 2 - 1) * Math.exp((-5.5 * i) / n);
        lp = 0.7 * lp + 0.3 * w;
        ir[i] += lp * 0.5;
      }
      return normalizeIr(ir, 0.9);
    }
    case 'smooth': {
      const n = 33;
      const ir = new Float32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        ir[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        sum += ir[i];
      }
      for (let i = 0; i < n; i++) ir[i] /= sum;
      return ir;
    }
  }
}

function normalizeIr(ir: Float32Array, target: number): Float32Array {
  let energy = 0;
  for (let i = 0; i < ir.length; i++) energy += ir[i] * ir[i];
  const scale = energy > 0 ? target / Math.sqrt(energy) : 1;
  for (let i = 0; i < ir.length; i++) ir[i] *= scale;
  return ir;
}

interface ConvState {
  key: string;
  P: number;
  Hre: Float64Array[];
  Him: Float64Array[];
  Xre: Float64Array[];
  Xim: Float64Array[];
  fdlPos: number;
  prevBlock: Float32Array;
  re: Float64Array;
  im: Float64Array;
  accRe: Float64Array;
  accIm: Float64Array;
}

function setupConvolution(s: Partial<ConvState>, ir: Float32Array, B: number): void {
  const N = 2 * B;
  const P = Math.ceil(ir.length / B);
  s.P = P;
  s.Hre = [];
  s.Him = [];
  s.Xre = [];
  s.Xim = [];
  for (let p = 0; p < P; p++) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < B; i++) {
      const idx = p * B + i;
      if (idx < ir.length) re[i] = ir[idx];
    }
    fftInPlace(re, im);
    s.Hre.push(re);
    s.Him.push(im);
    s.Xre.push(new Float64Array(N));
    s.Xim.push(new Float64Array(N));
  }
  s.fdlPos = 0;
  s.prevBlock = new Float32Array(B);
  s.re = new Float64Array(N);
  s.im = new Float64Array(N);
  s.accRe = new Float64Array(N);
  s.accIm = new Float64Array(N);
}

export const convolutionNode: NodeDef = {
  type: 'proc.convolution',
  title: 'Convolution',
  category: 'process',
  blurb: 'Apply an impulse response',
  description:
    'Convolves the signal with a built-in impulse response: echoes, small/large rooms, or a smoothing kernel. This is exactly how convolution reverbs apply the acoustics of real spaces.',
  inputs: [IN_SIGNAL],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'ir',
      label: 'Impulse Response',
      type: 'select',
      default: 'echo-short',
      options: [
        { value: 'echo-short', label: 'Short echo' },
        { value: 'echo-long', label: 'Longer echo' },
        { value: 'room-small', label: 'Small room' },
        { value: 'room-large', label: 'Large room' },
        { value: 'smooth', label: 'Smoothing kernel' },
      ],
      control: 'select',
      primary: true,
    },
    { ...mixParam, default: 0.6, primary: true, control: 'knob' },
  ],
  math: {
    title: 'Convolution',
    equations: [
      'y[n] = (x * h)[n] = \\sum_{k=0}^{K-1} h[k] \\, x[n-k]',
      'Y(f) = X(f) \\cdot H(f)',
    ],
    symbols: {
      'h[k]': 'impulse response (K taps)',
      '*': 'convolution operator',
      'Y(f), X(f), H(f)': 'spectra of output, input and impulse response',
    },
    interpretation:
      'Every output sample is a weighted mix of recent input history, weighted by the impulse response. In the frequency domain convolution becomes simple multiplication — filtering and reverb are the same mathematics.',
    limitations:
      'Implemented as uniform partitioned FFT convolution (exact, block-latency-free). IRs are synthesized and capped at ~1 s to keep CPU use sensible.',
  },
  createState: () => ({ key: '' }),
  process(ctx, inputs, outputs, params, state) {
    const s = state as unknown as ConvState;
    const x = inputs[0];
    const out = outputs[0];
    const B = ctx.blockSize;
    const kind = pstr(params, 'ir', 'echo-short') as IrKind;
    const key = `${kind}|${ctx.sampleRate}|${B}`;
    if (s.key !== key) {
      setupConvolution(s, synthesizeIr(kind, ctx.sampleRate), B);
      s.key = key;
    }
    const mix = pnum(params, 'mix', 0.6);
    const N = 2 * B;
    // Assemble overlap-save frame [prev | current]
    const re = s.re;
    const im = s.im;
    for (let i = 0; i < B; i++) {
      re[i] = s.prevBlock[i];
      re[B + i] = x ? x[i] : 0;
      im[i] = 0;
      im[B + i] = 0;
    }
    for (let i = 0; i < B; i++) s.prevBlock[i] = x ? x[i] : 0;
    fftInPlace(re, im);
    // Store into frequency delay line
    s.fdlPos = (s.fdlPos + s.P - 1) % s.P;
    s.Xre[s.fdlPos].set(re);
    s.Xim[s.fdlPos].set(im);
    // Accumulate Y = sum_p X[p] * H[p]
    const accRe = s.accRe;
    const accIm = s.accIm;
    accRe.fill(0);
    accIm.fill(0);
    for (let p = 0; p < s.P; p++) {
      const xr = s.Xre[(s.fdlPos + p) % s.P];
      const xi = s.Xim[(s.fdlPos + p) % s.P];
      const hr = s.Hre[p];
      const hi = s.Him[p];
      for (let k = 0; k < N; k++) {
        accRe[k] += xr[k] * hr[k] - xi[k] * hi[k];
        accIm[k] += xr[k] * hi[k] + xi[k] * hr[k];
      }
    }
    // Inverse FFT via conjugate trick: ifft(X) = conj(fft(conj(X)))/N
    for (let k = 0; k < N; k++) accIm[k] = -accIm[k];
    fftInPlace(accRe, accIm);
    for (let i = 0; i < B; i++) {
      const wet = accRe[B + i] / N;
      const dry = x ? x[i] : 0;
      out[i] = (1 - mix) * dry + mix * wet;
    }
  },
};

export const feedbackDelayNode: NodeDef = {
  type: 'proc.feedback',
  title: 'Feedback Delay',
  category: 'process',
  blurb: 'Echoes that repeat & decay',
  description:
    'A delay line whose output is fed back into itself with a gain below 1, producing repeating, decaying echoes. This is the ONLY node allowed inside a loop: its Loop In port reads the previous processing block, guaranteeing the one-block delay that makes feedback stable and computable.',
  inputs: [
    IN_SIGNAL,
    {
      id: 'fb',
      label: 'Loop In',
      kind: 'signal',
      deferred: true,
      optional: true,
    },
  ],
  outputs: [OUT_SIGNAL],
  params: [
    {
      id: 'time',
      label: 'Delay',
      type: 'number',
      default: 300,
      unit: 'ms',
      min: 10,
      max: LIMITS.maxDelaySeconds * 1000,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 0,
    },
    {
      id: 'feedback',
      label: 'Feedback',
      type: 'number',
      default: 0.5,
      min: 0,
      max: 0.95,
      step: 0.01,
      control: 'knob',
      primary: true,
      digits: 2,
      help: 'Fraction of the output fed back. Capped at 0.95 so echoes always decay.',
    },
    { ...mixParam, default: 0.5 },
  ],
  math: {
    title: 'Feedback and stability',
    equations: [
      'y[n] = x[n] + g \\, y[n - D]',
      '\\text{stable} \\iff |g| < 1, \\quad \\text{echo }k\\text{ has amplitude } g^k',
    ],
    symbols: { g: 'feedback gain', D: 'delay in samples', 'g^k': 'level of the k-th repeat' },
    interpretation:
      'Each round trip multiplies the signal by g: with g < 1 the echoes form a decaying geometric series (total gain 1/(1−g)); with g ≥ 1 they would grow without bound. That is also why instantaneous loops (D = 0) are forbidden — y[n] would depend on itself with no delay to break the circle.',
  },
  createState: (sr) => ({
    buf: new Float32Array(Math.ceil(sr * LIMITS.maxDelaySeconds) + 1),
    w: 0,
  }),
  process(ctx, inputs, outputs, params, s) {
    const x = inputs[0];
    const fb = inputs[1];
    const out = outputs[0];
    const buf = s.buf as Float32Array;
    const g = Math.min(0.95, Math.max(0, pnum(params, 'feedback', 0.5)));
    const mix = pnum(params, 'mix', 0.5);
    const D = Math.min(
      buf.length - 1,
      Math.max(1, Math.round((pnum(params, 'time', 300) / 1000) * ctx.sampleRate)),
    );
    for (let i = 0; i < ctx.blockSize; i++) {
      const xi = (x ? x[i] : 0) + (fb ? fb[i] : 0);
      const r = (s.w - D + buf.length) % buf.length;
      let wet = xi + g * buf[r];
      // Soft safety clip inside the loop so runaway input cannot explode
      if (wet > 1.5 || wet < -1.5) wet = Math.tanh(wet / 1.5) * 1.5;
      buf[s.w] = wet;
      s.w = (s.w + 1) % buf.length;
      out[i] = (1 - mix) * (x ? x[i] : 0) + mix * wet;
    }
  },
};

export const PROCESS_NODES: NodeDef[] = [
  gainNode,
  dcOffsetNode,
  mixerNode,
  delayNode,
  clipNode,
  saturateNode,
  quantizeNode,
  bitcrushNode,
  srConvertNode,
  lowpassNode,
  highpassNode,
  bandpassNode,
  bandstopNode,
  movingAvgNode,
  amNode,
  fmNode,
  convolutionNode,
  feedbackDelayNode,
];
