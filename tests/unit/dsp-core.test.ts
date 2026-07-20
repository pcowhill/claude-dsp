import { describe, it, expect } from 'vitest';
import { fftInPlace, computeSpectrum, dominantFrequency, makeWindow, computeSpectrogram } from '@/engine/dsp/fft';
import { designBiquad, biquadMagnitudeAt } from '@/engine/dsp/biquad';
import { computeStats, snrAgainstReference, correlation, rmsError } from '@/engine/dsp/measurements';
import { mulberry32, deriveSeed } from '@/engine/dsp/rng';

describe('FFT', () => {
  it('detects a pure sine at the right frequency and amplitude', () => {
    const sr = 48000;
    const n = 4096;
    const f = 1000; // not bin-centered; windowing should still find it
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / sr);
    const spec = computeSpectrum(sig, sr, n, 'hann');
    const d = dominantFrequency(spec);
    expect(d.freq).toBeCloseTo(f, -1); // within ~5 Hz
    expect(d.amplitude).toBeGreaterThan(0.4);
    expect(d.amplitude).toBeLessThan(0.6);
  });

  it('round-trips through forward FFT + inverse (conjugate trick)', () => {
    const n = 256;
    const rand = mulberry32(7);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const orig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = rand() * 2 - 1;
      orig[i] = re[i];
    }
    fftInPlace(re, im);
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fftInPlace(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i] / n).toBeCloseTo(orig[i], 9);
    }
  });

  it('rejects non-power-of-two sizes', () => {
    expect(() => fftInPlace(new Float64Array(100), new Float64Array(100))).toThrow();
  });

  it('windows have expected shapes', () => {
    const hann = makeWindow('hann', 128);
    expect(hann[0]).toBeCloseTo(0, 6);
    expect(hann[64]).toBeGreaterThan(0.99);
    const rect = makeWindow('rectangular', 128);
    expect(rect[0]).toBe(1);
    expect(rect[127]).toBe(1);
  });

  it('computes a spectrogram with expected dimensions', () => {
    const sr = 8000;
    const sig = new Float32Array(sr); // 1s
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    const sg = computeSpectrogram(sig, sr, 256, 0.5);
    expect(sg.bins).toBe(128);
    expect(sg.frames).toBeGreaterThan(10);
    // Energy should concentrate near 440 Hz
    const bin440 = Math.round(440 / sg.binHz);
    const mid = Math.floor(sg.frames / 2) * sg.bins;
    const at440 = sg.db[mid + bin440];
    const at2k = sg.db[mid + Math.round(2000 / sg.binHz)];
    expect(at440).toBeGreaterThan(at2k + 30);
  });
});

describe('Biquad filters', () => {
  it('lowpass passes DC and attenuates high frequencies', () => {
    const c = designBiquad('lowpass', 48000, 1000, 0.707);
    expect(biquadMagnitudeAt(c, 48000, 10)).toBeCloseTo(1, 2);
    expect(biquadMagnitudeAt(c, 48000, 1000)).toBeCloseTo(Math.SQRT1_2, 1);
    // -12 dB/octave: 4 kHz (2 octaves up) should be ~-24 dB
    const at4k = 20 * Math.log10(biquadMagnitudeAt(c, 48000, 4000));
    expect(at4k).toBeLessThan(-20);
  });

  it('highpass mirrors lowpass behavior', () => {
    const c = designBiquad('highpass', 48000, 1000, 0.707);
    expect(biquadMagnitudeAt(c, 48000, 10000)).toBeCloseTo(1, 1);
    expect(20 * Math.log10(biquadMagnitudeAt(c, 48000, 250))).toBeLessThan(-20);
  });

  it('notch kills the center frequency and passes neighbors', () => {
    const c = designBiquad('notch', 48000, 60, 10);
    expect(biquadMagnitudeAt(c, 48000, 60)).toBeLessThan(0.01);
    expect(biquadMagnitudeAt(c, 48000, 600)).toBeGreaterThan(0.95);
  });

  it('bandpass peaks at center', () => {
    const c = designBiquad('bandpass', 48000, 1000, 5);
    expect(biquadMagnitudeAt(c, 48000, 1000)).toBeCloseTo(1, 1);
    expect(biquadMagnitudeAt(c, 48000, 100)).toBeLessThan(0.1);
    expect(biquadMagnitudeAt(c, 48000, 10000)).toBeLessThan(0.1);
  });
});

describe('Measurements', () => {
  it('measures a sine correctly', () => {
    const sr = 48000;
    const sig = new Float32Array(sr);
    for (let i = 0; i < sr; i++) sig[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const s = computeStats(sig, sr);
    expect(s.rms).toBeCloseTo(0.8 / Math.SQRT2, 3);
    expect(s.peak).toBeCloseTo(0.8, 3);
    expect(s.mean).toBeCloseTo(0, 3);
    expect(s.crestFactor).toBeCloseTo(Math.SQRT2, 2);
    expect(s.dominantFreq).toBeCloseTo(440, 0);
    expect(s.clippingPct).toBe(0);
    // A sine crosses zero twice per cycle
    expect(s.zeroCrossingRate).toBeCloseTo(880, -1);
  });

  it('reports clipping percentage', () => {
    const sig = new Float32Array(1000).fill(1);
    const s = computeStats(sig, 48000);
    expect(s.clippingPct).toBe(100);
  });

  it('snrAgainstReference is high for identical and low for noisy signals', () => {
    const rand = mulberry32(3);
    const ref = new Float32Array(4800);
    for (let i = 0; i < ref.length; i++) ref[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    expect(snrAgainstReference(ref, ref)).toBeGreaterThan(100);
    const noisy = new Float32Array(ref.length);
    for (let i = 0; i < ref.length; i++) noisy[i] = ref[i] + (rand() * 2 - 1) * 0.5;
    const snr = snrAgainstReference(ref, noisy);
    expect(snr).toBeGreaterThan(2);
    expect(snr).toBeLessThan(15);
  });

  it('correlation and rmsError behave', () => {
    const a = new Float32Array([1, -1, 1, -1]);
    const b = new Float32Array([1, -1, 1, -1]);
    const c = new Float32Array([-1, 1, -1, 1]);
    expect(correlation(a, b)).toBeCloseTo(1, 6);
    expect(correlation(a, c)).toBeCloseTo(-1, 6);
    expect(rmsError(a, b)).toBe(0);
    expect(rmsError(a, c)).toBeCloseTo(2, 6);
  });
});

describe('Deterministic RNG', () => {
  it('same seed gives same sequence, different seeds differ', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('deriveSeed is stable per node id', () => {
    expect(deriveSeed(1, 'node-a')).toBe(deriveSeed(1, 'node-a'));
    expect(deriveSeed(1, 'node-a')).not.toBe(deriveSeed(1, 'node-b'));
    expect(deriveSeed(1, 'node-a')).not.toBe(deriveSeed(2, 'node-a'));
  });
});
