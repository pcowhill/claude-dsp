/**
 * Source node definitions.
 *
 * All periodic sources use a phase accumulator so live frequency changes are
 * click-free; accumulation is block-sequential and therefore deterministic in
 * capture mode. Geometric waveforms (square/triangle/sawtooth) are the naive
 * mathematical shapes and intentionally alias near Nyquist — the sampling
 * lesson uses this. See docs/DSP_NOTES.md.
 */

import type { NodeDef, ParamDef } from '@/model/types';
import { pnum, pstr, pbool, parseToneList } from './helpers';
import { compileExpression, validateExpression, type CompiledExpr } from '../expr/expression';
import { mulberry32 } from '../dsp/rng';

const TWO_PI = 2 * Math.PI;

const freqParam = (def = 440, max = 20000): ParamDef => ({
  id: 'freq',
  label: 'Frequency',
  type: 'number',
  default: def,
  unit: 'Hz',
  min: 0.1,
  max,
  scale: 'log',
  control: 'knob',
  primary: true,
  digits: 1,
  help: 'Cycles per second. Human hearing spans roughly 20 Hz – 20 kHz.',
});

const ampParam = (def = 0.8): ParamDef => ({
  id: 'amp',
  label: 'Amplitude',
  type: 'number',
  default: def,
  min: 0,
  max: 1.5,
  step: 0.01,
  control: 'knob',
  primary: true,
  digits: 2,
  help: 'Peak value of the waveform. Values above 1.0 will clip at the output.',
});

const phaseParam: ParamDef = {
  id: 'phase',
  label: 'Phase',
  type: 'number',
  default: 0,
  unit: '°',
  min: -180,
  max: 180,
  step: 1,
  control: 'slider',
  digits: 0,
  help: 'Where in its cycle the waveform starts. 360° is one full cycle.',
};

const offsetParam: ParamDef = {
  id: 'offset',
  label: 'DC Offset',
  type: 'number',
  default: 0,
  min: -1,
  max: 1,
  step: 0.01,
  control: 'slider',
  digits: 2,
  help: 'Constant value added to every sample. Shifts the waveform up or down.',
};

interface OscState {
  phase: number;
}

function makeOsc(
  type: string,
  title: string,
  blurb: string,
  description: string,
  shape: (phase: number, params: Record<string, any>) => number,
  extraParams: ParamDef[] = [],
  mathEq?: { equations: string[]; symbols: Record<string, string>; interpretation: string },
): NodeDef {
  return {
    type,
    title,
    category: 'source',
    blurb,
    description,
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
    params: [freqParam(), ampParam(), phaseParam, offsetParam, ...extraParams],
    math: mathEq
      ? {
          title: `${title} equation`,
          ...mathEq,
        }
      : undefined,
    createState: (_sr, params) => ({ phase: ((pnum(params, 'phase') / 360) % 1 + 1) % 1 }),
    process(ctx, _inputs, outputs, params, state) {
      const s = state as unknown as OscState;
      const out = outputs[0];
      const freq = pnum(params, 'freq', 440);
      const amp = pnum(params, 'amp', 0.8);
      const dc = pnum(params, 'offset', 0);
      const inc = freq / ctx.sampleRate;
      for (let i = 0; i < ctx.blockSize; i++) {
        out[i] = amp * shape(s.phase, params) + dc;
        s.phase += inc;
        if (s.phase >= 1) s.phase -= Math.floor(s.phase);
      }
    },
  };
}

export const sineNode = makeOsc(
  'src.sine',
  'Sine Wave',
  'Pure single-frequency tone',
  'Generates a pure sinusoid — the fundamental building block of every signal. A sine wave contains exactly one frequency, so its spectrum is a single line.',
  (p) => Math.sin(TWO_PI * p),
  [],
  {
    equations: ['x(t) = A \\sin(2\\pi f t + \\varphi) + C'],
    symbols: {
      'x(t)': 'output sample at time t (seconds)',
      A: 'amplitude (peak value)',
      f: 'frequency in hertz',
      '\\varphi': 'phase offset in radians (shown in degrees on the panel)',
      C: 'DC offset',
    },
    interpretation:
      'One full cycle takes T = 1/f seconds. Doubling f doubles how many cycles fit into a second, which you hear as a pitch one octave higher.',
  },
);
sineNode.math!.substitute = (params) => {
  const A = pnum(params, 'amp', 0.8);
  const f = pnum(params, 'freq', 440);
  const ph = pnum(params, 'phase', 0);
  const C = pnum(params, 'offset', 0);
  return `x(t) = ${A.toFixed(2)} \\sin(2\\pi \\cdot ${f.toFixed(1)} \\cdot t ${ph ? (ph > 0 ? '+' : '-') + ' ' + Math.abs((ph * Math.PI) / 180).toFixed(2) : '+ 0'}) ${C ? (C > 0 ? '+' : '-') + ' ' + Math.abs(C).toFixed(2) : ''}`;
};

export const squareNode = makeOsc(
  'src.square',
  'Square Wave',
  'Odd harmonics, buzzy tone',
  'Alternates between +A and −A. Its spectrum contains the fundamental plus all odd harmonics decaying as 1/n — which is why it sounds buzzy and bright.',
  (p, params) => (p < pnum(params, 'duty', 0.5) ? 1 : -1),
  [
    {
      id: 'duty',
      label: 'Duty Cycle',
      type: 'number',
      default: 0.5,
      min: 0.01,
      max: 0.99,
      step: 0.01,
      control: 'slider',
      digits: 2,
      help: 'Fraction of each cycle spent at the high level. 0.5 is a symmetric square.',
    },
  ],
  {
    equations: [
      'x(t) = \\frac{4A}{\\pi} \\sum_{n=1,3,5,\\dots} \\frac{1}{n} \\sin(2\\pi n f t)',
    ],
    symbols: {
      A: 'amplitude',
      f: 'fundamental frequency in hertz',
      n: 'harmonic number (odd only, for 50% duty cycle)',
    },
    interpretation:
      'A square wave is an infinite sum of odd harmonics. The playground generates the ideal shape directly, so harmonics above the Nyquist frequency fold back (alias) — visible in the spectrum analyzer at high fundamentals.',
    limitations:
      'Naive (non-band-limited) synthesis: aliasing is intentionally left audible/visible for teaching.',
  },
);

export const triangleNode = makeOsc(
  'src.triangle',
  'Triangle Wave',
  'Odd harmonics, mellow tone',
  'Ramps linearly up and down. Contains odd harmonics decaying as 1/n², so it is much mellower than a square wave.',
  (p) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1,
  [],
  {
    equations: [
      'x(t) = \\frac{8A}{\\pi^2} \\sum_{n=1,3,5,\\dots} \\frac{(-1)^{(n-1)/2}}{n^2} \\sin(2\\pi n f t)',
    ],
    symbols: { A: 'amplitude', f: 'fundamental frequency', n: 'harmonic number (odd)' },
    interpretation:
      'Harmonic amplitudes fall off as 1/n² — much faster than the square wave’s 1/n — so high harmonics are weak and the tone is soft.',
  },
);

export const sawtoothNode = makeOsc(
  'src.sawtooth',
  'Sawtooth Wave',
  'All harmonics, bright tone',
  'Ramps up and snaps back down. Contains every harmonic decaying as 1/n, making it the brightest of the classic waveforms and the raw material of subtractive synthesis.',
  (p) => 2 * (p - Math.floor(p + 0.5)),
  [],
  {
    equations: ['x(t) = \\frac{2A}{\\pi} \\sum_{n=1}^{\\infty} \\frac{(-1)^{n+1}}{n} \\sin(2\\pi n f t)'],
    symbols: { A: 'amplitude', f: 'fundamental frequency', n: 'harmonic number (all integers)' },
    interpretation:
      'Every harmonic is present. Low-pass filtering a sawtooth removes the upper harmonics — the basis of the classic synthesizer "filter sweep" sound.',
  },
);

export const whiteNoiseNode: NodeDef = {
  type: 'src.whitenoise',
  title: 'White Noise',
  category: 'source',
  blurb: 'Equal energy at all frequencies',
  description:
    'Random samples with equal expected power in every frequency band — a flat spectrum, like the "sh" in speech or analog TV static. In capture mode the seed makes the noise exactly repeatable.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    ampParam(0.5),
    {
      id: 'seed',
      label: 'Noise Seed',
      type: 'number',
      default: 1,
      min: 0,
      max: 9999,
      step: 1,
      control: 'field',
      digits: 0,
      help: 'Capture mode uses this seed so noise is exactly repeatable. Live mode is free-running.',
    },
  ],
  math: {
    title: 'White noise',
    equations: ['x[n] \\sim \\mathcal{U}(-A, A)', 'S_{xx}(f) \\approx \\text{const}'],
    symbols: {
      'x[n]': 'sample n, drawn independently from a uniform distribution',
      A: 'amplitude',
      'S_{xx}(f)': 'power spectral density (flat for white noise)',
    },
    interpretation:
      'Each sample is independent of the last, so no frequency is favoured: the average spectrum is flat. RMS is A/√3 for uniform noise.',
  },
  process(ctx, _inputs, outputs, params, _state) {
    const out = outputs[0];
    const amp = pnum(params, 'amp', 0.5);
    for (let i = 0; i < ctx.blockSize; i++) {
      out[i] = amp * (ctx.random() * 2 - 1);
    }
  },
};

export const pinkNoiseNode: NodeDef = {
  type: 'src.pinknoise',
  title: 'Pink Noise',
  category: 'source',
  blurb: 'Equal energy per octave (1/f)',
  description:
    'Noise whose power falls 3 dB per octave, giving equal energy per octave — closer to how natural sounds and human hearing distribute energy. Generated by filtering white noise (Paul Kellet approximation).',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    ampParam(0.5),
    {
      id: 'seed',
      label: 'Noise Seed',
      type: 'number',
      default: 1,
      min: 0,
      max: 9999,
      step: 1,
      control: 'field',
      digits: 0,
      help: 'Capture mode uses this seed so noise is exactly repeatable.',
    },
  ],
  math: {
    title: 'Pink noise',
    equations: ['S_{xx}(f) \\propto \\frac{1}{f}'],
    symbols: { 'S_{xx}(f)': 'power spectral density', f: 'frequency' },
    interpretation:
      'Power halves each time frequency doubles (−3 dB/octave). On a log-frequency spectrum plot, pink noise looks flat-tilted down, while white noise rises toward the right.',
    limitations:
      'Uses the Paul Kellet 7-pole filter approximation — accurate to within ±0.5 dB across the audio band, not an exact 1/f process.',
  },
  createState: () => ({ b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }),
  process(ctx, _inputs, outputs, params, s) {
    const out = outputs[0];
    const amp = pnum(params, 'amp', 0.5);
    for (let i = 0; i < ctx.blockSize; i++) {
      const white = ctx.random() * 2 - 1;
      s.b0 = 0.99886 * s.b0 + white * 0.0555179;
      s.b1 = 0.99332 * s.b1 + white * 0.0750759;
      s.b2 = 0.969 * s.b2 + white * 0.153852;
      s.b3 = 0.8665 * s.b3 + white * 0.3104856;
      s.b4 = 0.55 * s.b4 + white * 0.5329522;
      s.b5 = -0.7616 * s.b5 - white * 0.016898;
      const pink = s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362;
      s.b6 = white * 0.115926;
      out[i] = amp * pink * 0.11;
    }
  },
};

export const impulseNode: NodeDef = {
  type: 'src.impulse',
  title: 'Impulse',
  category: 'source',
  blurb: 'Single spike or impulse train',
  description:
    'A single one-sample spike (or a repeating train of them). Impulses excite every frequency equally, which is why they are used to measure the impulse response of a system.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    ampParam(1),
    {
      id: 'startTime',
      label: 'Start Time',
      type: 'number',
      default: 0.1,
      unit: 's',
      min: 0,
      max: 10,
      step: 0.01,
      control: 'field',
      digits: 3,
      help: 'When the (first) impulse fires, measured from transport start.',
    },
    {
      id: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'single',
      options: [
        { value: 'single', label: 'Single' },
        { value: 'train', label: 'Repeating train' },
      ],
      control: 'select',
    },
    {
      id: 'rate',
      label: 'Train Rate',
      type: 'number',
      default: 4,
      unit: 'Hz',
      min: 0.1,
      max: 100,
      scale: 'log',
      control: 'knob',
      digits: 1,
      help: 'Impulses per second when in train mode.',
    },
  ],
  math: {
    title: 'Unit impulse',
    equations: ['\\delta[n] = \\begin{cases}1 & n = 0\\\\ 0 & n \\neq 0\\end{cases}', 'y[n] = (h * \\delta)[n] = h[n]'],
    symbols: {
      '\\delta[n]': 'discrete unit impulse',
      'h[n]': 'impulse response of a system',
      '*': 'convolution',
    },
    interpretation:
      'Feeding an impulse into a linear system returns the system’s impulse response — a complete description of its behaviour. Its spectrum is flat: an impulse contains all frequencies at once.',
  },
  process(ctx, _inputs, outputs, params, _state) {
    const out = outputs[0];
    out.fill(0);
    const amp = pnum(params, 'amp', 1);
    const startSample = Math.round(pnum(params, 'startTime', 0.1) * ctx.sampleRate);
    const mode = pstr(params, 'mode', 'single');
    if (mode === 'single') {
      const idx = startSample - ctx.startSample;
      if (idx >= 0 && idx < ctx.blockSize) out[idx] = amp;
    } else {
      const period = Math.max(1, Math.round(ctx.sampleRate / pnum(params, 'rate', 4)));
      for (let i = 0; i < ctx.blockSize; i++) {
        const abs = ctx.startSample + i - startSample;
        if (abs >= 0 && abs % period === 0) out[i] = amp;
      }
    }
  },
};

export const stepNode: NodeDef = {
  type: 'src.step',
  title: 'Step Signal',
  category: 'source',
  blurb: 'Jumps from 0 to a level',
  description:
    'Zero until the start time, then a constant level. Step inputs reveal how systems settle: filters ring or glide toward the new value depending on their design.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    ampParam(0.8),
    {
      id: 'startTime',
      label: 'Step Time',
      type: 'number',
      default: 0.1,
      unit: 's',
      min: 0,
      max: 10,
      step: 0.01,
      control: 'field',
      digits: 3,
      help: 'When the signal steps from 0 to the amplitude level.',
    },
  ],
  math: {
    title: 'Unit step',
    equations: ['u[n] = \\begin{cases}0 & n < n_0\\\\ A & n \\geq n_0\\end{cases}'],
    symbols: { 'u[n]': 'step signal', n_0: 'step sample index', A: 'level after the step' },
    interpretation:
      'The step is the integral of the impulse. A system’s step response shows overshoot, ringing and settling time — the time-domain fingerprint of its frequency response.',
  },
  process(ctx, _inputs, outputs, params, _state) {
    const out = outputs[0];
    const amp = pnum(params, 'amp', 0.8);
    const startSample = Math.round(pnum(params, 'startTime', 0.1) * ctx.sampleRate);
    for (let i = 0; i < ctx.blockSize; i++) {
      out[i] = ctx.startSample + i >= startSample ? amp : 0;
    }
  },
};

export const dualToneNode: NodeDef = {
  type: 'src.dualtone',
  title: 'Dual-Tone',
  category: 'source',
  blurb: 'Two sines — beats & intervals',
  description:
    'Two independent sine waves added together. Set the frequencies close for beating, or in ratios for musical intervals. DTMF phone dial tones are dual-tones.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    { ...freqParam(440), id: 'freq1', label: 'Freq 1' },
    { ...freqParam(446), id: 'freq2', label: 'Freq 2' },
    {
      id: 'amp1',
      label: 'Amp 1',
      type: 'number',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
      digits: 2,
    },
    {
      id: 'amp2',
      label: 'Amp 2',
      type: 'number',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
      digits: 2,
    },
  ],
  math: {
    title: 'Beating between two tones',
    equations: [
      'x(t) = A_1\\sin(2\\pi f_1 t) + A_2\\sin(2\\pi f_2 t)',
      '2A\\sin\\!\\big(2\\pi \\tfrac{f_1+f_2}{2} t\\big)\\cos\\!\\big(2\\pi \\tfrac{f_1-f_2}{2} t\\big)',
    ],
    symbols: {
      'f_1, f_2': 'the two tone frequencies',
      'A_1, A_2': 'their amplitudes',
    },
    interpretation:
      'When A₁ = A₂ and the frequencies are close, the sum sounds like the average frequency pulsing at the difference |f₁ − f₂| — the beat rate.',
  },
  createState: () => ({ p1: 0, p2: 0 }),
  process(ctx, _inputs, outputs, params, s) {
    const out = outputs[0];
    const i1 = pnum(params, 'freq1', 440) / ctx.sampleRate;
    const i2 = pnum(params, 'freq2', 446) / ctx.sampleRate;
    const a1 = pnum(params, 'amp1', 0.4);
    const a2 = pnum(params, 'amp2', 0.4);
    for (let i = 0; i < ctx.blockSize; i++) {
      out[i] = a1 * Math.sin(TWO_PI * s.p1) + a2 * Math.sin(TWO_PI * s.p2);
      s.p1 += i1;
      s.p2 += i2;
      if (s.p1 >= 1) s.p1 -= 1;
      if (s.p2 >= 1) s.p2 -= 1;
    }
  },
};

export const multiToneNode: NodeDef = {
  type: 'src.multitone',
  title: 'Multi-Tone',
  category: 'source',
  blurb: 'A list of sines (freq:amp pairs)',
  description:
    'Sum of up to 16 sine components defined as "frequency:amplitude" pairs. Build chords, harmonic series, or test signals for the spectrum analyzer.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    {
      id: 'tones',
      label: 'Tone List',
      type: 'text',
      default: '220:0.5, 440:0.35, 660:0.25',
      control: 'field',
      primary: false,
      help: 'Comma-separated frequency:amplitude pairs, e.g. "220:0.5, 440:0.25". Amplitude defaults to 1.',
    },
    { ...ampParam(1), label: 'Master Amp' },
  ],
  validate: (params) => parseToneList(pstr(params, 'tones', '')).error,
  math: {
    title: 'Sum of sinusoids',
    equations: ['x(t) = A\\sum_{k=1}^{K} a_k \\sin(2\\pi f_k t)'],
    symbols: { 'f_k': 'frequency of component k', 'a_k': 'amplitude of component k', A: 'master amplitude' },
    interpretation:
      'Fourier analysis says any periodic signal can be built this way. The spectrum analyzer shows one line per component — try to identify them by ear first.',
  },
  createState: () => ({ phases: new Float64Array(16) }),
  process(ctx, _inputs, outputs, params, s) {
    const out = outputs[0];
    const { tones } = parseToneList(pstr(params, 'tones', ''));
    const master = pnum(params, 'amp', 1);
    out.fill(0);
    const phases = s.phases as Float64Array;
    for (let k = 0; k < tones.length; k++) {
      const inc = tones[k][0] / ctx.sampleRate;
      const a = tones[k][1] * master;
      let p = phases[k];
      for (let i = 0; i < ctx.blockSize; i++) {
        out[i] += a * Math.sin(TWO_PI * p);
        p += inc;
        if (p >= 1) p -= 1;
      }
      phases[k] = p;
    }
  },
};

/** Built-in synthesized audio samples (deterministic, no external assets). */
function synthesizeSample(kind: string, sr: number): Float32Array {
  const rand = mulberry32(0xc0ffee);
  if (kind === 'pluck') {
    // Karplus–Strong plucked string at 220 Hz, 1.5 s
    const n = Math.floor(sr * 1.5);
    const buf = new Float32Array(n);
    const period = Math.floor(sr / 220);
    const line = new Float32Array(period);
    for (let i = 0; i < period; i++) line[i] = rand() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const next = (idx + 1) % period;
      const v = line[idx];
      line[idx] = 0.996 * 0.5 * (line[idx] + line[next]);
      buf[i] = v * 0.8;
      idx = next;
    }
    return buf;
  }
  if (kind === 'drum') {
    // Kick-ish: 150→50 Hz sine sweep with exponential decay + noise attack
    const n = Math.floor(sr * 0.6);
    const buf = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 50 + 100 * Math.exp(-t * 18);
      phase += f / sr;
      const env = Math.exp(-t * 9);
      const noise = (rand() * 2 - 1) * Math.exp(-t * 60) * 0.4;
      buf[i] = (Math.sin(TWO_PI * phase) * env + noise) * 0.9;
    }
    return buf;
  }
  // 'chirp': 200 Hz → 2 kHz linear sweep over 1 s
  const n = Math.floor(sr * 1.0);
  const buf = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 200 + (2000 - 200) * t;
    phase += f / sr;
    buf[i] = 0.7 * Math.sin(TWO_PI * phase);
  }
  return buf;
}

export const sampleNode: NodeDef = {
  type: 'src.sample',
  title: 'Sample Player',
  category: 'source',
  blurb: 'Built-in short audio clips',
  description:
    'Plays a short built-in audio clip. All clips are synthesized in-app (Karplus–Strong pluck, swept drum hit, linear chirp) so no external audio files are needed.',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    {
      id: 'sample',
      label: 'Sample',
      type: 'select',
      default: 'pluck',
      options: [
        { value: 'pluck', label: 'Plucked string' },
        { value: 'drum', label: 'Drum hit' },
        { value: 'chirp', label: 'Chirp sweep' },
      ],
      control: 'select',
      primary: true,
    },
    { ...ampParam(0.9), label: 'Level' },
    {
      id: 'loop',
      label: 'Loop',
      type: 'boolean',
      default: true,
      control: 'toggle',
      primary: true,
      help: 'Restart the clip when it ends.',
    },
  ],
  createState: (sr, params) => ({
    buf: synthesizeSample(pstr(params, 'sample', 'pluck'), sr),
    kind: pstr(params, 'sample', 'pluck'),
  }),
  process(ctx, _inputs, outputs, params, s) {
    const kind = pstr(params, 'sample', 'pluck');
    if (s.kind !== kind) {
      s.buf = synthesizeSample(kind, ctx.sampleRate);
      s.kind = kind;
    }
    const buf = s.buf as Float32Array;
    const out = outputs[0];
    const amp = pnum(params, 'amp', 0.9);
    const loop = pbool(params, 'loop', true);
    for (let i = 0; i < ctx.blockSize; i++) {
      const abs = ctx.startSample + i;
      const idx = loop ? abs % buf.length : abs;
      out[i] = idx < buf.length ? amp * buf[idx] : 0;
    }
  },
};

export const expressionNode: NodeDef = {
  type: 'src.expression',
  title: 'Expression',
  category: 'source',
  blurb: 'x(t) from a math formula',
  description:
    'Generates a signal from a mathematical formula of t (seconds). Safe, sandboxed parser — see the help panel for the full function list and examples like sin(2*pi*440*t).',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', kind: 'signal' }],
  params: [
    {
      id: 'expr',
      label: 'Expression',
      type: 'text',
      default: 'sin(2*pi*440*t) * exp(-2*t)',
      control: 'field',
      help: 'A formula for x(t). Variables: t (seconds), sr, pi, tau, e. Functions: sin, cos, sqrt, exp, sawtooth(x), square(x), triangle(x), clamp(x,lo,hi)…',
    },
    { ...ampParam(0.8), label: 'Level' },
  ],
  validate: (params) => validateExpression(pstr(params, 'expr', '')),
  math: {
    title: 'Expression source',
    equations: ['x(t) = A \\cdot f(t)'],
    symbols: { 'f(t)': 'your formula evaluated at each sample time', A: 'level' },
    interpretation:
      'The formula is evaluated once per sample with t = n / f_s. Non-finite results (∞, NaN) are replaced with 0 to protect downstream nodes.',
  },
  createState: () => ({ src: '', fn: null as CompiledExpr | null }),
  process(ctx, _inputs, outputs, params, s) {
    const src = pstr(params, 'expr', '');
    if (s.src !== src) {
      s.src = src;
      try {
        s.fn = compileExpression(src);
      } catch {
        s.fn = null;
      }
    }
    const out = outputs[0];
    const fn = s.fn as CompiledExpr | null;
    if (!fn) {
      out.fill(0);
      return;
    }
    const amp = pnum(params, 'amp', 0.8);
    const sr = ctx.sampleRate;
    for (let i = 0; i < ctx.blockSize; i++) {
      out[i] = amp * fn((ctx.startSample + i) / sr, sr);
    }
  },
};

export const SOURCE_NODES: NodeDef[] = [
  sineNode,
  squareNode,
  triangleNode,
  sawtoothNode,
  whiteNoiseNode,
  pinkNoiseNode,
  impulseNode,
  stepNode,
  dualToneNode,
  multiToneNode,
  sampleNode,
  expressionNode,
];
