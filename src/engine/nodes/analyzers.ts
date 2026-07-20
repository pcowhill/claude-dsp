/**
 * Analyzer and output node definitions.
 *
 * Analyzers are pure taps: they copy input to output unchanged. Their
 * parameters (FFT size, window, trigger…) only affect how the UI computes and
 * draws views of the tapped ring/capture buffers — never the signal itself.
 */

import type { NodeDef } from '@/model/types';
import { LIMITS } from '@/model/types';
import { WINDOW_OPTIONS } from '../dsp/fft';
import { pnum } from './helpers';
import { dbToLin } from './helpers';

const IN = { id: 'in', label: 'In', kind: 'signal' as const };
const THRU = { id: 'out', label: 'Thru', kind: 'signal' as const };

function passthrough(): NodeDef['process'] {
  return (ctx, inputs, outputs) => {
    const x = inputs[0];
    const out = outputs[0];
    if (!x) {
      out.fill(0);
      return;
    }
    out.set(x.subarray(0, ctx.blockSize));
  };
}

const fftSizeParam = {
  id: 'fftSize',
  label: 'FFT Size',
  type: 'select' as const,
  default: '2048',
  options: ['256', '512', '1024', '2048', '4096', '8192', '16384']
    .filter((v) => parseInt(v) <= LIMITS.maxFftSize)
    .map((v) => ({ value: v, label: v })),
  control: 'select' as const,
  help: 'More points = finer frequency resolution but a longer analysis window (worse time resolution).',
};

const windowParam = {
  id: 'window',
  label: 'Window',
  type: 'select' as const,
  default: 'hann',
  options: WINDOW_OPTIONS.map((w) => ({ value: w.value, label: w.label })),
  control: 'select' as const,
  help: 'Tapers the analysis frame to reduce spectral leakage. Hann is the safe default; Rectangular shows leakage clearly.',
};

export const scopeNode: NodeDef = {
  type: 'ana.scope',
  title: 'Oscilloscope',
  category: 'analyze',
  blurb: 'Waveform vs. time',
  description:
    'Draws the waveform against time, like a lab oscilloscope. Use the trigger to freeze repeating waveforms in place, and cursors to measure period and amplitude.',
  inputs: [IN],
  outputs: [THRU],
  params: [
    {
      id: 'timeWindow',
      label: 'Time Window',
      type: 'number',
      default: 20,
      unit: 'ms',
      min: 0.5,
      max: 500,
      scale: 'log',
      control: 'knob',
      primary: true,
      digits: 1,
      help: 'How much time the screen spans.',
    },
    {
      id: 'trigMode',
      label: 'Trigger',
      type: 'select',
      default: 'rising',
      options: [
        { value: 'off', label: 'Free-run' },
        { value: 'rising', label: 'Rising edge' },
        { value: 'falling', label: 'Falling edge' },
      ],
      control: 'select',
      primary: true,
      help: 'Start each sweep where the signal crosses the trigger level, so periodic waveforms hold still.',
    },
    {
      id: 'trigLevel',
      label: 'Trig Level',
      type: 'number',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      control: 'slider',
      digits: 2,
    },
    {
      id: 'yScale',
      label: 'Y Scale',
      type: 'number',
      default: 1.2,
      min: 0.05,
      max: 4,
      scale: 'log',
      control: 'knob',
      digits: 2,
      help: 'Vertical range: the screen spans ±this value.',
    },
  ],
  math: {
    title: 'Time-domain view',
    equations: ['T = \\frac{1}{f}, \\qquad V_{pp} = x_{max} - x_{min}'],
    symbols: { T: 'period in seconds', f: 'frequency in hertz', 'V_{pp}': 'peak-to-peak amplitude' },
    interpretation:
      'The oscilloscope is the most direct view of a signal. Frequency is measured by reading the period between repeating features and inverting it.',
  },
  process: passthrough(),
};

export const spectrumNode: NodeDef = {
  type: 'ana.spectrum',
  title: 'Spectrum Analyzer',
  category: 'analyze',
  blurb: 'Magnitude vs. frequency (FFT)',
  description:
    'Shows how much of each frequency the signal contains, computed with the FFT. Switch axis scales, change FFT size and window, and hover to read exact frequencies.',
  inputs: [IN],
  outputs: [THRU],
  params: [
    { ...fftSizeParam, primary: true },
    { ...windowParam, primary: true },
    {
      id: 'freqScale',
      label: 'Freq Axis',
      type: 'select',
      default: 'log',
      options: [
        { value: 'log', label: 'Logarithmic' },
        { value: 'linear', label: 'Linear' },
      ],
      control: 'select',
    },
    {
      id: 'ampScale',
      label: 'Amp Axis',
      type: 'select',
      default: 'db',
      options: [
        { value: 'db', label: 'Decibels' },
        { value: 'linear', label: 'Linear' },
      ],
      control: 'select',
    },
  ],
  math: {
    title: 'The discrete Fourier transform',
    equations: [
      'X[k] = \\sum_{n=0}^{N-1} x[n]\\, e^{-j 2\\pi k n / N}',
      '\\Delta f = \\frac{f_s}{N}',
    ],
    symbols: {
      'X[k]': 'complex amplitude of bin k',
      N: 'FFT size (samples analyzed)',
      '\\Delta f': 'frequency resolution — spacing between bins',
      'f_s': 'sample rate',
    },
    interpretation:
      'The FFT correlates the signal against sinusoids at N evenly spaced frequencies. Larger N gives finer Δf but needs a longer stretch of signal — you trade time resolution for frequency resolution.',
    substitute: (p, sr) => {
      const n = parseInt(String(p['fftSize'] ?? '2048'));
      return `\\Delta f = ${sr}/${n} = ${(sr / n).toFixed(2)}\\ \\text{Hz per bin}`;
    },
  },
  process: passthrough(),
};

export const spectrogramNode: NodeDef = {
  type: 'ana.spectrogram',
  title: 'Spectrogram',
  category: 'analyze',
  blurb: 'Frequency content over time',
  description:
    'Slices the signal into overlapping windows and stacks their spectra as colored columns: time runs left to right, frequency bottom to top, brightness is level in dB.',
  inputs: [IN],
  outputs: [THRU],
  params: [
    {
      ...fftSizeParam,
      id: 'fftSize',
      default: '1024',
      primary: true,
      help: 'Window size per column. Large = fine frequency detail but smeared timing; small = sharp timing but coarse frequency.',
    },
    {
      id: 'overlap',
      label: 'Overlap',
      type: 'number',
      default: 0.5,
      min: 0,
      max: 0.9,
      step: 0.05,
      control: 'slider',
      primary: true,
      digits: 2,
      help: 'Fraction of each window shared with the next. More overlap = smoother time axis, more computation.',
    },
    { ...windowParam },
  ],
  math: {
    title: 'Short-time Fourier transform',
    equations: [
      'X[m, k] = \\sum_{n=0}^{N-1} x[n + mH]\\, w[n]\\, e^{-j2\\pi k n/N}',
      '\\Delta f = \\frac{f_s}{N}, \\qquad \\Delta t = \\frac{H}{f_s}',
    ],
    symbols: {
      m: 'frame (column) index',
      H: 'hop size in samples',
      'w[n]': 'window function',
      '\\Delta f, \\Delta t': 'frequency and time resolution',
    },
    interpretation:
      'A spectrogram is many short FFTs side by side. The uncertainty principle applies: Δf · Δt ≥ ~1, so no window setting can be sharp in both time and frequency at once.',
  },
  process: passthrough(),
};

export const statsNode: NodeDef = {
  type: 'ana.stats',
  title: 'Statistics Meter',
  category: 'analyze',
  blurb: 'RMS, peak, SNR & more',
  description:
    'Continuously measures the signal: mean (DC), min/max, peak, RMS, crest factor, dominant frequency, estimated SNR, clipping percentage, zero-crossing rate and duration.',
  inputs: [IN],
  outputs: [THRU],
  params: [],
  math: {
    title: 'Core measurements',
    equations: [
      '\\bar{x} = \\frac{1}{N}\\sum x[n] \\quad \\text{(mean / DC)}',
      'x_{RMS} = \\sqrt{\\frac{1}{N}\\sum x[n]^2}',
      'CF = \\frac{x_{peak}}{x_{RMS}}, \\qquad \\text{SNR} = 10\\log_{10}\\frac{P_{signal}}{P_{noise}}\\ \\text{dB}',
    ],
    symbols: {
      '\\bar{x}': 'mean value — non-zero means DC offset',
      'x_{RMS}': 'root-mean-square — proportional to perceived loudness/power',
      CF: 'crest factor — how "peaky" the signal is (sine: √2 ≈ 1.41)',
      'P_{signal}, P_{noise}': 'signal and noise power',
    },
    interpretation:
      'RMS measures average power regardless of shape. A sine of peak A has RMS A/√2; uniform white noise of peak A has RMS A/√3. SNR here is estimated from the spectrum (dominant peak vs. everything else) — an honest estimate, not ground truth.',
  },
  process: passthrough(),
};

export const outputNode: NodeDef = {
  type: 'out.audio',
  title: 'Audio Output',
  category: 'output',
  blurb: 'Listen (safely limited)',
  description:
    'The end of the chain: what arrives here is what you hear and what captures record by default. Playback is safety-limited, starts only on an explicit Play press, and defaults to a conservative volume.',
  inputs: [IN],
  outputs: [],
  params: [
    {
      id: 'level',
      label: 'Level',
      type: 'number',
      default: -6,
      unit: 'dB',
      min: -60,
      max: 0,
      step: 0.5,
      control: 'knob',
      primary: true,
      digits: 1,
      help: 'Output trim before the master volume and safety limiter.',
    },
  ],
  process(ctx, inputs, outputs, params) {
    // The engine reads this node's "virtual" output buffer for playback/capture.
    const x = inputs[0];
    const out = outputs[0];
    const g = dbToLin(pnum(params, 'level', -6));
    if (!x) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < ctx.blockSize; i++) out[i] = g * x[i];
  },
};

// The output node needs an internal buffer even though it exposes no ports.
export const ANALYZER_NODES: NodeDef[] = [scopeNode, spectrumNode, spectrogramNode, statsNode];
export const OUTPUT_NODES: NodeDef[] = [outputNode];
