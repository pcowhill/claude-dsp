/**
 * Built-in example projects. These are constructed programmatically with
 * stable ids so "open example" always yields a fresh copy.
 */

import type { Project, GraphNode, GraphEdge, ParamValue } from '@/model/types';
import { PROJECT_SCHEMA_VERSION } from '@/model/types';
import { defaultParams } from '@/engine/registry';

let e = 0;
function edge(from: string, to: string, toPort = 'in', fromPort = 'out'): GraphEdge {
  return { id: `ex-e${e++}`, from, fromPort, to, toPort };
}

function n(
  id: string,
  type: string,
  x: number,
  y: number,
  params: Record<string, ParamValue> = {},
): GraphNode {
  return { id, type, x, y, params: { ...defaultParams(type), ...params } };
}

function project(id: string, name: string, nodes: GraphNode[], edges: GraphEdge[], notes = ''): Project {
  const now = new Date().toISOString();
  return {
    version: PROJECT_SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    sampleRate: 48000,
    graph: { nodes, edges },
    notes,
  };
}

export interface ExampleEntry {
  id: string;
  name: string;
  description: string;
  build: () => Project;
}

export const EXAMPLES: ExampleEntry[] = [
  {
    id: 'ex-starter',
    name: 'Starter: Tone → Filter → Output',
    description: 'The canonical first chain: a sine with noise, cleaned by a low-pass filter, visualized twice.',
    build: () =>
      project(
        'ex-starter',
        'Starter: Tone → Filter → Output',
        [
          n('sine', 'src.sine', 40, 120, { freq: 440, amp: 0.5 }),
          n('noise', 'src.whitenoise', 40, 320, { amp: 0.15 }),
          n('mix', 'proc.mixer', 300, 210),
          n('lpf', 'proc.lowpass', 590, 210, { freq: 1200 }),
          n('scope', 'ana.scope', 850, 110, { timeWindow: 10 }),
          n('spec', 'ana.spectrum', 850, 340),
          n('out', 'out.audio', 1240, 210),
        ],
        [
          edge('sine', 'mix', 'in1'),
          edge('noise', 'mix', 'in2'),
          edge('mix', 'lpf'),
          edge('lpf', 'scope'),
          edge('scope', 'spec'),
          edge('spec', 'out'),
        ],
        'Press Play, then sweep the filter cutoff and watch the noise floor fall in the spectrum.',
      ),
  },
  {
    id: 'ex-square-harmonics',
    name: 'Harmonic-Rich Square Wave',
    description: 'A square wave and its odd-harmonic spectrum; low-pass it back toward a sine.',
    build: () =>
      project(
        'ex-square-harmonics',
        'Harmonic-Rich Square Wave',
        [
          n('sq', 'src.square', 40, 200, { freq: 220, amp: 0.5 }),
          n('lpf', 'proc.lowpass', 300, 200, { freq: 8000 }),
          n('scope', 'ana.scope', 560, 90, { timeWindow: 15 }),
          n('spec', 'ana.spectrum', 560, 310, { fftSize: '4096' }),
          n('out', 'out.audio', 860, 200),
        ],
        [edge('sq', 'lpf'), edge('lpf', 'scope'), edge('scope', 'spec'), edge('spec', 'out')],
        'Lower the filter cutoff toward 300 Hz: harmonics vanish one by one until only the fundamental sine remains.',
      ),
  },
  {
    id: 'ex-aliasing',
    name: 'Aliasing Demonstration',
    description: 'A tone above the resampler’s Nyquist limit folds down to a phantom frequency.',
    build: () =>
      project(
        'ex-aliasing',
        'Aliasing Demonstration',
        [
          n('sine', 'src.sine', 40, 200, { freq: 5000, amp: 0.5 }),
          n('src8k', 'proc.srconvert', 300, 200, { targetRate: 8000, antialias: false }),
          n('spec', 'ana.spectrum', 560, 200, { fftSize: '4096' }),
          n('out', 'out.audio', 860, 200),
        ],
        [edge('sine', 'src8k'), edge('src8k', 'spec'), edge('spec', 'out')],
        'The 5 kHz tone re-sampled at 8 kHz aliases to 3 kHz. Toggle the anti-alias filter or raise the target rate to fix it.',
      ),
  },
  {
    id: 'ex-am',
    name: 'AM Transmission',
    description: 'A 300 Hz message amplitude-modulates a 6 kHz carrier: carrier + sidebands.',
    build: () =>
      project(
        'ex-am',
        'AM Transmission',
        [
          n('msg', 'src.sine', 40, 200, { freq: 300, amp: 1 }),
          n('am', 'proc.am', 300, 200, { carrier: 6000, depth: 0.8 }),
          n('scope', 'ana.scope', 560, 90, { timeWindow: 25 }),
          n('spec', 'ana.spectrum', 560, 310, { fftSize: '8192', freqScale: 'linear' }),
          n('out', 'out.audio', 860, 200),
        ],
        [edge('msg', 'am', 'msg'), edge('am', 'scope'), edge('scope', 'spec'), edge('spec', 'out')],
        'The oscilloscope shows the envelope; the spectrum shows lines at 5.7, 6.0 and 6.3 kHz.',
      ),
  },
  {
    id: 'ex-quantization',
    name: 'Quantization Comparison',
    description: 'The same tone at full resolution and crushed to 4 bits, side by side.',
    build: () =>
      project(
        'ex-quantization',
        'Quantization Comparison',
        [
          n('sine', 'src.sine', 40, 200, { freq: 330, amp: 0.9 }),
          n('crush', 'proc.bitcrush', 300, 300, { bits: 4 }),
          n('scopeA', 'ana.scope', 560, 90, { timeWindow: 10 }),
          n('scopeB', 'ana.scope', 560, 310, { timeWindow: 10 }),
          n('mix', 'proc.mixer', 860, 200, { g1: 0, g2: 1 }),
          n('out', 'out.audio', 1100, 200),
        ],
        [
          edge('sine', 'scopeA'),
          edge('sine', 'crush'),
          edge('crush', 'scopeB'),
          edge('scopeA', 'mix', 'in1'),
          edge('scopeB', 'mix', 'in2'),
          edge('mix', 'out'),
        ],
        'Compare the smooth and staircase scopes. Mixer levels choose which version you hear.',
      ),
  },
  {
    id: 'ex-echo',
    name: 'Echo via Convolution',
    description: 'A plucked string through a convolution echo impulse response.',
    build: () =>
      project(
        'ex-echo',
        'Echo via Convolution',
        [
          n('pluck', 'src.sample', 40, 200, { sample: 'pluck', loop: true }),
          n('conv', 'proc.convolution', 300, 200, { ir: 'echo-long', mix: 0.5 }),
          n('scope', 'ana.scope', 560, 200, { timeWindow: 300 }),
          n('out', 'out.audio', 860, 200),
        ],
        [edge('pluck', 'conv'), edge('conv', 'scope'), edge('scope', 'out')],
        'Each pluck is convolved with a sparse impulse response — you hear the repeats it encodes.',
      ),
  },
  {
    id: 'ex-drywet',
    name: 'Parallel Dry/Wet Path',
    description: 'A source split into a dry branch and a heavily processed branch, mixed back together.',
    build: () =>
      project(
        'ex-drywet',
        'Parallel Dry/Wet Path',
        [
          n('saw', 'src.sawtooth', 40, 200, { freq: 110, amp: 0.4 }),
          n('dry', 'proc.gain', 320, 90, { gain: 0 }),
          n('bpf', 'proc.bandpass', 320, 310, { freq: 800, q: 6 }),
          n('sat', 'proc.saturate', 540, 310, { drive: 6 }),
          n('mix', 'proc.mixer', 780, 200, { g1: 0.6, g2: 0.8 }),
          n('spec', 'ana.spectrum', 1010, 200),
          n('out', 'out.audio', 1280, 200),
        ],
        [
          edge('saw', 'dry'),
          edge('saw', 'bpf'),
          edge('bpf', 'sat'),
          edge('dry', 'mix', 'in1'),
          edge('sat', 'mix', 'in2'),
          edge('mix', 'spec'),
          edge('spec', 'out'),
        ],
        'Branching and merging: the classic parallel-processing topology used in mixing.',
      ),
  },
  {
    id: 'ex-noisy-tone',
    name: 'Noisy Tone Filtering',
    description: 'Tone buried in noise, recovered with a band-pass filter; SNR readable on the stats meter.',
    build: () =>
      project(
        'ex-noisy-tone',
        'Noisy Tone Filtering',
        [
          n('sine', 'src.sine', 40, 120, { freq: 1000, amp: 0.3 }),
          n('noise', 'src.whitenoise', 40, 320, { amp: 0.25 }),
          n('mix', 'proc.mixer', 290, 210),
          n('stats1', 'ana.stats', 520, 90),
          n('bpf', 'proc.bandpass', 520, 310, { freq: 1000, q: 8 }),
          n('stats2', 'ana.stats', 760, 310),
          n('out', 'out.audio', 1000, 210),
        ],
        [
          edge('sine', 'mix', 'in1'),
          edge('noise', 'mix', 'in2'),
          edge('mix', 'stats1'),
          edge('mix', 'bpf'),
          edge('bpf', 'stats2'),
          edge('stats2', 'out'),
        ],
        'Compare estimated SNR before and after the band-pass filter.',
      ),
  },
];

export function getExample(id: string): Project | null {
  const entry = EXAMPLES.find((x) => x.id === id);
  return entry ? entry.build() : null;
}
