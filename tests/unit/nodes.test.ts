import { describe, it, expect } from 'vitest';
import { node, edge, graph, render } from './helpers';
import { computeStats, snrAgainstReference } from '@/engine/dsp/measurements';
import { computeSpectrum, dominantFrequency } from '@/engine/dsp/fft';
import { synthesizeIr } from '@/engine/nodes/processors';

const SR = 48000;

function ampAt(sig: Float32Array, freq: number, sr = SR, offset = 0): number {
  const spec = computeSpectrum(sig.subarray(offset, offset + 8192), sr, 8192, 'hann');
  const bin = Math.round(freq / spec.binHz);
  let m = 0;
  for (let k = Math.max(1, bin - 2); k <= bin + 2; k++) m = Math.max(m, spec.magnitudes[k] ?? 0);
  return m;
}

describe('Source nodes', () => {
  it('sine has correct frequency, amplitude, phase and offset', () => {
    const g = graph([node('s', 'src.sine', { freq: 440, amp: 0.5, offset: 0.2 })], []);
    const buf = render(g, 's');
    const stats = computeStats(buf, SR);
    expect(stats.dominantFreq).toBeCloseTo(440, 0);
    expect(stats.mean).toBeCloseTo(0.2, 2);
    expect(stats.max).toBeCloseTo(0.7, 2);
    expect(stats.min).toBeCloseTo(-0.3, 2);
  });

  it('sine phase parameter shifts the start', () => {
    const g90 = graph([node('s', 'src.sine', { freq: 100, amp: 1, phase: 90 })], []);
    const buf = render(g90, 's', 0.1);
    expect(buf[0]).toBeCloseTo(1, 2); // sin(90°) = 1
  });

  it('square wave has odd harmonics only', () => {
    const g = graph([node('s', 'src.square', { freq: 500, amp: 0.5 })], []);
    const buf = render(g, 's');
    const h1 = ampAt(buf, 500);
    const h2 = ampAt(buf, 1000);
    const h3 = ampAt(buf, 1500);
    expect(h1).toBeGreaterThan(0.5); // 4A/pi ≈ 0.64
    expect(h3 / h1).toBeCloseTo(1 / 3, 1);
    expect(h2).toBeLessThan(h1 * 0.05);
  });

  it('triangle harmonics fall as 1/n^2', () => {
    const g = graph([node('s', 'src.triangle', { freq: 500, amp: 1 })], []);
    const buf = render(g, 's');
    const h1 = ampAt(buf, 500);
    const h3 = ampAt(buf, 1500);
    expect(h3 / h1).toBeCloseTo(1 / 9, 1);
  });

  it('sawtooth contains even and odd harmonics', () => {
    const g = graph([node('s', 'src.sawtooth', { freq: 500, amp: 1 })], []);
    const buf = render(g, 's');
    const h1 = ampAt(buf, 500);
    const h2 = ampAt(buf, 1000);
    expect(h2 / h1).toBeCloseTo(1 / 2, 1);
  });

  it('white noise is deterministic per seed in capture mode', () => {
    const g1 = graph([node('n', 'src.whitenoise', { seed: 5 })], []);
    const a = render(g1, 'n', 0.1);
    const b = render(g1, 'n', 0.1);
    expect(Array.from(a.subarray(0, 32))).toEqual(Array.from(b.subarray(0, 32)));
    const g2 = graph([node('n', 'src.whitenoise', { seed: 6 })], []);
    const c = render(g2, 'n', 0.1);
    expect(Array.from(a.subarray(0, 32))).not.toEqual(Array.from(c.subarray(0, 32)));
  });

  it('pink noise rolls off relative to white noise at high frequencies', () => {
    const gw = graph([node('n', 'src.whitenoise', { amp: 0.5, seed: 1 })], []);
    const gp = graph([node('n', 'src.pinknoise', { amp: 0.5, seed: 1 })], []);
    const w = render(gw, 'n', 1);
    const p = render(gp, 'n', 1);
    const wLow = ampAt(w, 200);
    const wHigh = ampAt(w, 8000);
    const pLow = ampAt(p, 200);
    const pHigh = ampAt(p, 8000);
    // white ~flat; pink drops ~ -3dB/octave → over ~5.3 octaves ≈ 16 dB
    const whiteRatio = wHigh / wLow;
    const pinkRatio = pHigh / pLow;
    expect(pinkRatio).toBeLessThan(whiteRatio * 0.5);
  });

  it('impulse fires exactly once at the right sample', () => {
    const g = graph([node('i', 'src.impulse', { startTime: 0.01, amp: 1, mode: 'single' })], []);
    const buf = render(g, 'i', 0.05);
    const idx = Math.round(0.01 * SR);
    expect(buf[idx]).toBe(1);
    let nonzero = 0;
    for (const v of buf) if (v !== 0) nonzero++;
    expect(nonzero).toBe(1);
  });

  it('step transitions at the right time', () => {
    const g = graph([node('s', 'src.step', { startTime: 0.02, amp: 0.7 })], []);
    const buf = render(g, 's', 0.05);
    const idx = Math.round(0.02 * SR);
    expect(buf[idx - 2]).toBe(0);
    expect(buf[idx + 2]).toBeCloseTo(0.7, 6);
  });

  it('dual tone contains both frequencies', () => {
    const g = graph([node('d', 'src.dualtone', { freq1: 440, freq2: 660, amp1: 0.3, amp2: 0.3 })], []);
    const buf = render(g, 'd');
    expect(ampAt(buf, 440)).toBeGreaterThan(0.2);
    expect(ampAt(buf, 660)).toBeGreaterThan(0.2);
  });

  it('multi-tone renders its tone list', () => {
    const g = graph([node('m', 'src.multitone', { tones: '300:0.4, 900:0.2', amp: 1 })], []);
    const buf = render(g, 'm');
    expect(ampAt(buf, 300)).toBeCloseTo(0.4, 1);
    expect(ampAt(buf, 900)).toBeCloseTo(0.2, 1);
  });

  it('expression source renders formulas', () => {
    const g = graph([node('e', 'src.expression', { expr: 'sin(2*pi*1000*t)', amp: 1 })], []);
    const buf = render(g, 'e');
    const stats = computeStats(buf, SR);
    expect(stats.dominantFreq).toBeCloseTo(1000, 0);
  });

  it('sample player renders a non-silent deterministic clip', () => {
    const g = graph([node('p', 'src.sample', { sample: 'pluck', amp: 1 })], []);
    const a = render(g, 'p', 0.3);
    const b = render(g, 'p', 0.3);
    expect(computeStats(a, SR).rms).toBeGreaterThan(0.01);
    expect(Array.from(a.subarray(0, 64))).toEqual(Array.from(b.subarray(0, 64)));
  });
});

describe('Processing nodes', () => {
  it('gain applies dB correctly', () => {
    const g = graph(
      [node('s', 'src.sine', { freq: 440, amp: 0.5 }), node('g', 'proc.gain', { gain: -6.0206 })],
      [edge('s', 'g')],
    );
    const buf = render(g, 'g');
    expect(computeStats(buf, SR).peak).toBeCloseTo(0.25, 2);
  });

  it('dc offset shifts the mean', () => {
    const g = graph(
      [node('s', 'src.sine', { amp: 0.5 }), node('o', 'proc.dcoffset', { offset: 0.3 })],
      [edge('s', 'o')],
    );
    expect(computeStats(render(g, 'o'), SR).mean).toBeCloseTo(0.3, 2);
  });

  it('mixer adds signals with per-input levels (branching + merging)', () => {
    const g = graph(
      [
        node('a', 'src.sine', { freq: 440, amp: 0.4 }),
        node('b', 'src.sine', { freq: 880, amp: 0.4 }),
        node('m', 'proc.mixer', { g1: 1, g2: 0.5 }),
      ],
      [edge('a', 'm', 'in1'), edge('b', 'm', 'in2')],
    );
    const buf = render(g, 'm');
    expect(ampAt(buf, 440)).toBeCloseTo(0.4, 1);
    expect(ampAt(buf, 880)).toBeCloseTo(0.2, 1);
  });

  it('destructive interference: opposite-phase sines cancel', () => {
    const g = graph(
      [
        node('a', 'src.sine', { freq: 440, amp: 0.5, phase: 0 }),
        node('b', 'src.sine', { freq: 440, amp: 0.5, phase: 180 }),
        node('m', 'proc.mixer', {}),
      ],
      [edge('a', 'm', 'in1'), edge('b', 'm', 'in2')],
    );
    expect(computeStats(render(g, 'm'), SR).rms).toBeLessThan(0.001);
  });

  it('delay shifts the signal by the right number of samples', () => {
    const g = graph(
      [node('i', 'src.impulse', { startTime: 0.01, mode: 'single' }), node('d', 'proc.delay', { time: 10, mix: 1 })],
      [edge('i', 'd')],
    );
    const buf = render(g, 'd', 0.1);
    const expected = Math.round(0.01 * SR) + Math.round(0.01 * SR); // start + 10ms delay
    expect(buf[expected]).toBeCloseTo(1, 4);
  });

  it('hard clip caps samples at the threshold', () => {
    const g = graph(
      [node('s', 'src.sine', { amp: 1 }), node('c', 'proc.clip', { threshold: 0.4 })],
      [edge('s', 'c')],
    );
    const stats = computeStats(render(g, 'c'), SR);
    expect(stats.peak).toBeCloseTo(0.4, 4);
  });

  it('clipping a sine produces odd harmonics', () => {
    const g = graph(
      [node('s', 'src.sine', { freq: 500, amp: 1 }), node('c', 'proc.clip', { threshold: 0.3 })],
      [edge('s', 'c')],
    );
    const buf = render(g, 'c');
    expect(ampAt(buf, 1500)).toBeGreaterThan(0.01); // 3rd harmonic appears
  });

  it('saturation distorts smoothly and stays within ±1', () => {
    const mk = (type: string, params: any) =>
      graph([node('s', 'src.sine', { freq: 500, amp: 1 }), node('x', type, params)], [edge('s', 'x')]);
    const clipped = render(mk('proc.clip', { threshold: 0.3 }), 'x');
    const saturated = render(mk('proc.saturate', { drive: 2 }), 'x');
    // Both distort (3rd harmonic present); hard clip flattens peaks exactly
    // at the threshold while tanh keeps a smooth rounded shape below 1.
    expect(ampAt(saturated, 1500)).toBeGreaterThan(0.01);
    expect(ampAt(clipped, 1500)).toBeGreaterThan(0.01);
    expect(computeStats(clipped, SR).peak).toBeCloseTo(0.3, 4);
    expect(computeStats(saturated, SR).peak).toBeLessThanOrEqual(1.001);
    expect(computeStats(saturated, SR).peak).toBeGreaterThan(0.9);
    // Low drive is nearly transparent
    const gentle = render(mk('proc.saturate', { drive: 0.2 }), 'x');
    expect(ampAt(gentle, 1500)).toBeLessThan(0.01);
  });

  it('quantizer restricts outputs to multiples of the step', () => {
    const g = graph(
      [node('s', 'src.sine', { amp: 1 }), node('q', 'proc.quantize', { step: 0.25 })],
      [edge('s', 'q')],
    );
    const buf = render(g, 'q', 0.05);
    for (let i = 0; i < buf.length; i += 7) {
      const ratio = buf[i] / 0.25;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-4);
    }
  });

  it('bit depth reduction adds quantization noise (~6 dB per bit)', () => {
    const mk = (bits: number) =>
      graph(
        [node('s', 'src.sine', { freq: 440, amp: 0.9 }), node('b', 'proc.bitcrush', { bits })],
        [edge('s', 'b')],
      );
    const ref = graph([node('s', 'src.sine', { freq: 440, amp: 0.9 })], []);
    const clean = render(ref, 's', 0.4);
    const crushed4 = render(mk(4), 'b', 0.4);
    const crushed8 = render(mk(8), 'b', 0.4);
    const snr4 = snrAgainstReference(clean, crushed4);
    const snr8 = snrAgainstReference(clean, crushed8);
    expect(snr8).toBeGreaterThan(snr4 + 15); // ~24 dB apart in theory
    expect(snr4).toBeGreaterThan(15);
    expect(snr4).toBeLessThan(40);
  });

  it('resampler with anti-aliasing removes content above the new Nyquist', () => {
    const mk = (antialias: boolean) =>
      graph(
        [
          node('s', 'src.sine', { freq: 3000, amp: 0.8 }),
          node('r', 'proc.srconvert', { targetRate: 4000, antialias }),
        ],
        [edge('s', 'r')],
      );
    // 3 kHz through a 4 kHz sampler: aliases to 1 kHz without filtering
    const aliased = render(mk(false), 'r');
    const filtered = render(mk(true), 'r');
    expect(ampAt(aliased, 1000)).toBeGreaterThan(0.15); // alias present
    expect(ampAt(filtered, 1000)).toBeLessThan(ampAt(aliased, 1000) * 0.3);
  });

  it('lowpass filter attenuates above cutoff in a real chain', () => {
    const g = graph(
      [
        node('d', 'src.dualtone', { freq1: 200, freq2: 8000, amp1: 0.4, amp2: 0.4 }),
        node('f', 'proc.lowpass', { freq: 1000, q: 0.707 }),
      ],
      [edge('d', 'f')],
    );
    const buf = render(g, 'f');
    expect(ampAt(buf, 200)).toBeGreaterThan(0.35);
    expect(ampAt(buf, 8000)).toBeLessThan(0.02);
  });

  it('bandstop removes hum while keeping nearby content', () => {
    const g = graph(
      [
        node('d', 'src.dualtone', { freq1: 60, freq2: 440, amp1: 0.4, amp2: 0.4 }),
        node('f', 'proc.bandstop', { freq: 60, q: 8 }),
      ],
      [edge('d', 'f')],
    );
    // Skip the filter's settling transient before measuring
    const buf = render(g, 'f', 1);
    expect(ampAt(buf, 60, SR, 30000)).toBeLessThan(0.05);
    expect(ampAt(buf, 440, SR, 30000)).toBeGreaterThan(0.35);
  });

  it('moving average attenuates at its null frequency', () => {
    const N = 48; // null at 48000/48 = 1000 Hz
    const g = graph(
      [
        node('d', 'src.dualtone', { freq1: 100, freq2: 1000, amp1: 0.4, amp2: 0.4 }),
        node('f', 'proc.movingavg', { length: N }),
      ],
      [edge('d', 'f')],
    );
    const buf = render(g, 'f', 1);
    expect(ampAt(buf, 1000)).toBeLessThan(0.02);
    expect(ampAt(buf, 100)).toBeGreaterThan(0.3);
  });

  it('AM produces carrier and sidebands', () => {
    const g = graph(
      [
        node('m', 'src.sine', { freq: 300, amp: 1 }),
        node('am', 'proc.am', { carrier: 5000, depth: 0.8, mode: 'am', level: 0 }),
      ],
      [edge('m', 'am', 'msg')],
    );
    const buf = render(g, 'am');
    expect(ampAt(buf, 5000)).toBeGreaterThan(0.5); // carrier
    expect(ampAt(buf, 4700)).toBeGreaterThan(0.2); // lower sideband
    expect(ampAt(buf, 5300)).toBeGreaterThan(0.2); // upper sideband
  });

  it('DSB-SC suppresses the carrier', () => {
    const g = graph(
      [
        node('m', 'src.sine', { freq: 300, amp: 1 }),
        node('am', 'proc.am', { carrier: 5000, depth: 1, mode: 'dsb', level: 0 }),
      ],
      [edge('m', 'am', 'msg')],
    );
    const buf = render(g, 'am');
    expect(ampAt(buf, 4700)).toBeGreaterThan(0.2);
    expect(ampAt(buf, 5000)).toBeLessThan(0.1); // carrier suppressed
  });

  it('FM spreads energy into sidebands as deviation grows', () => {
    const mk = (deviation: number) =>
      graph(
        [
          node('m', 'src.sine', { freq: 100, amp: 1 }),
          node('fm', 'proc.fm', { carrier: 4000, deviation, level: 0.8 }),
        ],
        [edge('m', 'fm', 'msg')],
      );
    const narrow = render(mk(10), 'fm');
    const wide = render(mk(800), 'fm');
    // With tiny deviation nearly all energy stays at the carrier
    expect(ampAt(narrow, 4000)).toBeGreaterThan(0.7);
    // With large deviation the carrier line loses dominance
    expect(ampAt(wide, 4000)).toBeLessThan(0.5);
  });

  it('convolution with the smoothing kernel matches direct convolution', () => {
    const g = graph(
      [
        node('i', 'src.impulse', { startTime: 0.005, mode: 'single', amp: 1 }),
        node('c', 'proc.convolution', { ir: 'smooth', mix: 1 }),
      ],
      [edge('i', 'c')],
    );
    const buf = render(g, 'c', 0.05);
    const ir = synthesizeIr('smooth', SR);
    const start = Math.round(0.005 * SR);
    // Output should equal the IR itself, starting at the impulse position
    for (let k = 0; k < ir.length; k += 5) {
      expect(buf[start + k]).toBeCloseTo(ir[k], 5);
    }
  });

  it('echo IR produces delayed copies at the right times', () => {
    const g = graph(
      [
        node('i', 'src.impulse', { startTime: 0.01, mode: 'single', amp: 1 }),
        node('c', 'proc.convolution', { ir: 'echo-short', mix: 1 }),
      ],
      [edge('i', 'c')],
    );
    const buf = render(g, 'c', 0.5);
    const start = Math.round(0.01 * SR);
    expect(buf[start]).toBeCloseTo(1, 4);
    expect(buf[start + Math.floor(SR * 0.12)]).toBeCloseTo(0.55, 4);
    expect(buf[start + Math.floor(SR * 0.24)]).toBeCloseTo(0.3, 4);
  });

  it('feedback delay produces decaying repeats and stays bounded', () => {
    const g = graph(
      [
        node('i', 'src.impulse', { startTime: 0.01, mode: 'single', amp: 1 }),
        node('f', 'proc.feedback', { time: 100, feedback: 0.5, mix: 1 }),
      ],
      [edge('i', 'f')],
    );
    const buf = render(g, 'f', 1);
    const start = Math.round(0.01 * SR);
    const D = Math.round(0.1 * SR);
    expect(buf[start]).toBeCloseTo(1, 3);
    expect(buf[start + D]).toBeCloseTo(0.5, 2);
    expect(buf[start + 2 * D]).toBeCloseTo(0.25, 2);
    expect(computeStats(buf, SR).peak).toBeLessThanOrEqual(1.5);
  });
});

describe('Analyzer passthrough', () => {
  it('analyzers do not alter the signal', () => {
    const base = graph([node('s', 'src.sine', { freq: 440, amp: 0.5 })], []);
    const tapped = graph(
      [
        node('s', 'src.sine', { freq: 440, amp: 0.5 }),
        node('sc', 'ana.scope', {}),
        node('sp', 'ana.spectrum', {}),
      ],
      [edge('s', 'sc'), edge('sc', 'sp')],
    );
    const a = render(base, 's', 0.2);
    const b = render(tapped, 'sp', 0.2);
    for (let i = 0; i < a.length; i += 97) expect(b[i]).toBe(a[i]);
  });
});

describe('Spectrum sanity: dominant frequency via analyzer path', () => {
  it('finds the dominant tone in a noisy mixture', () => {
    const g = graph(
      [
        node('s', 'src.sine', { freq: 1234, amp: 0.6 }),
        node('n', 'src.whitenoise', { amp: 0.1, seed: 2 }),
        node('m', 'proc.mixer', {}),
      ],
      [edge('s', 'm', 'in1'), edge('n', 'm', 'in2')],
    );
    const buf = render(g, 'm', 1);
    const spec = computeSpectrum(buf, SR, 8192, 'hann');
    expect(dominantFrequency(spec).freq).toBeCloseTo(1234, -1);
  });
});
