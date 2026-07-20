/**
 * The eight practical challenges. Grading is measurement-based and
 * deterministic: captures run with a fixed seed, "fixed equipment" node
 * params are forced back before grading, and every criterion is a numeric
 * threshold — so many different graphs can pass.
 */

import type { Challenge, GradeCtx, GradePart, GradeResult } from './types';
import { ln, le, lproject } from './lessonUtils';
import { computeSpectrum } from '@/engine/dsp/fft';
import {
  computeStats,
  maxCorrelation,
  bandRms,
  thdEstimate,
  spectralSimilarity,
} from '@/engine/dsp/measurements';
import { runCapture } from '@/engine/capture';

const SR = 48000;

function ampAt(sig: Float32Array, freq: number, sr: number, offset = 0): number {
  const n = Math.min(8192, sig.length - offset);
  if (n < 256) return 0;
  const spec = computeSpectrum(sig.subarray(offset, offset + n), sr, 8192, 'hann');
  const bin = Math.round(freq / spec.binHz);
  let m = 0;
  for (let k = Math.max(1, bin - 2); k <= Math.min(spec.magnitudes.length - 1, bin + 2); k++) {
    m = Math.max(m, spec.magnitudes[k]);
  }
  return m;
}

function part(label: string, detail: string, met: boolean, points: number, maxPoints: number): GradePart {
  return { label, detail, met, points: Math.round(points), maxPoints };
}

function finish(parts: GradePart[], passScore: number, failMessage: string): GradeResult {
  const score = Math.min(100, Math.round(parts.reduce((s, p) => s + p.points, 0)));
  const passed = score >= passScore;
  return {
    score,
    passed,
    parts,
    message: passed ? 'Solution accepted — see the score breakdown.' : failMessage,
  };
}

function needOut(ctx: GradeCtx): { out: Float32Array | null; missing: GradeResult | null } {
  const outId = ctx.nodeOfType('out.audio');
  const out = outId ? ctx.buffer(outId) : null;
  if (!out || out.length < 4096) {
    return {
      out: null,
      missing: {
        score: 0,
        passed: false,
        parts: [],
        message:
          'No graded signal: the patch needs an Audio Output node with a connected input — grading measures what arrives there.',
      },
    };
  }
  return { out, missing: null };
}

/** Skip initial transient before measuring. */
const SETTLE = 12000;

function refSine(freq: number, length: number, sr: number): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) buf[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return buf;
}

/* ---------------- 1 · Rescue a Noisy Tone ---------------- */

export const challengeRescue: Challenge = {
  id: 'ch-rescue-tone',
  index: 1,
  title: 'Rescue a Noisy Tone',
  scenario:
    'A sensor transmits a steady 1 kHz calibration tone, but the link adds broadband noise. The receiver (tone + noise + mixer) is fixed equipment — you cannot change what arrives.',
  objective:
    'Process the received signal so the graded output has an SNR of at least 15 dB while keeping at least 40% of the tone’s amplitude.',
  minutes: 10,
  seed: 1101,
  captureDuration: 1,
  build: () =>
    lproject('ch-rescue-tone', 'Challenge · Rescue a Noisy Tone', [
      ln('tone', 'src.sine', 40, 100, { freq: 1000, amp: 0.3 }),
      ln('noise', 'src.whitenoise', 40, 300, { amp: 0.25, seed: 11 }),
      ln('rx', 'proc.mixer', 300, 200),
      ln('spec', 'ana.spectrum', 560, 90, { fftSize: '4096' }),
      ln('stats', 'ana.stats', 560, 310),
      ln('out', 'out.audio', 900, 200),
    ], [
      le('tone', 'rx', 'in1'),
      le('noise', 'rx', 'in2'),
      le('rx', 'spec'),
      le('rx', 'stats'),
      le('spec', 'out'),
    ]),
  fixedNodes: {
    tone: { freq: 1000, amp: 0.3, phase: 0, offset: 0 },
    noise: { amp: 0.25, seed: 11 },
    rx: { g1: 1, g2: 1, g3: 1, g4: 1 },
  },
  hints: [
    'The tone lives at exactly one frequency; the noise is spread across all of them. Which filter keeps a narrow slice?',
    'Insert a Band-Pass Filter between the receiver mixer and the output. Center it on 1000 Hz.',
    'Raise the band-pass Q to narrow the passband (try 8–20). Check the SNR estimate on a Statistics Meter after the filter — higher Q rejects more noise.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const stats = computeStats(out!.subarray(SETTLE), ctx.sampleRate);
    const snr = stats.snrEstimateDb ?? -20;
    const toneAmp = ampAt(out!, 1000, ctx.sampleRate, SETTLE);
    const parts = [
      part('SNR ≥ 15 dB', `measured ${snr.toFixed(1)} dB`, snr >= 15, Math.min(40, Math.max(0, (snr / 15) * 40)), 40),
      part(
        'Tone preserved (≥ 0.12 amplitude at 1 kHz)',
        `measured ${toneAmp.toFixed(3)} (source contributes 0.30)`,
        toneAmp >= 0.12,
        toneAmp >= 0.12 ? 30 : (toneAmp / 0.12) * 30,
        30,
      ),
      part(
        'Dominant frequency is the tone',
        `dominant ${stats.dominantFreq.toFixed(0)} Hz`,
        Math.abs(stats.dominantFreq - 1000) < 30,
        Math.abs(stats.dominantFreq - 1000) < 30 ? 20 : 0,
        20,
      ),
      part(
        'Efficiency: ≤ 8 modules',
        `${ctx.nodeCount} modules used`,
        ctx.nodeCount <= 8,
        ctx.nodeCount <= 8 ? 10 : 4,
        10,
      ),
    ];
    return finish(parts, 70, 'The tone must dominate: filter around 1 kHz without crushing it.');
  },
  passScore: 70,
  efficiencyGoal: 'Full marks for 8 modules or fewer.',
  explanation:
    'Noise power is proportional to bandwidth: a band-pass filter of width f₀/Q admits only a sliver of the noise while passing the whole tone. Doubling Q halves the admitted noise power (+3 dB SNR) — the fundamental trade being selectivity vs. ringing. Filters (band-pass, or a low-pass + high-pass pair) and even a well-tuned moving average all pass.',
};

/* ---------------- 2 · Stop the Aliasing ---------------- */

export const challengeAliasing: Challenge = {
  id: 'ch-stop-aliasing',
  index: 2,
  title: 'Stop the Aliasing',
  scenario:
    'A 5 kHz calibration tone (fixed) is being digitized by a legacy 8 kHz acquisition link with its anti-alias filter unplugged. Downstream analysis sees a phantom 3 kHz tone that is not really there.',
  objective:
    'Reconfigure the acquisition so the output contains the true 5 kHz tone — and no phantom components.',
  minutes: 8,
  seed: 1202,
  captureDuration: 1,
  build: () =>
    lproject('ch-stop-aliasing', 'Challenge · Stop the Aliasing', [
      ln('cal', 'src.sine', 40, 180, { freq: 5000, amp: 0.6 }),
      ln('link', 'proc.srconvert', 300, 180, { targetRate: 8000, antialias: false }),
      ln('spec', 'ana.spectrum', 560, 180, { fftSize: '4096', freqScale: 'linear' }),
      ln('out', 'out.audio', 900, 180),
    ], [le('cal', 'link'), le('link', 'spec'), le('spec', 'out')]),
  fixedNodes: {
    cal: { freq: 5000, amp: 0.6, phase: 0, offset: 0 },
  },
  hints: [
    'Aliases appear when content above half the sampling rate reaches the sampler. The tone is 5 kHz — what is the smallest sample rate that can represent it honestly?',
    'Select the Resampler: its Target Rate must exceed 2 × 5000 = 10,000 Hz for the tone to survive. The anti-alias filter alone would only silence the tone.',
    'Set Target Rate to 12–16 kHz (anti-alias on for good hygiene). The phantom 3 kHz line disappears and the true 5 kHz line returns.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const alias = ampAt(out!, 3000, ctx.sampleRate, SETTLE);
    const tone = ampAt(out!, 5000, ctx.sampleRate, SETTLE);
    const stats = computeStats(out!.subarray(SETTLE), ctx.sampleRate);
    const spurious = alias > 0.03 || (stats.dominantFreq > 100 && Math.abs(stats.dominantFreq - 5000) > 150);
    const parts = [
      part('No phantom tone at 3 kHz (< 0.03)', `measured ${alias.toFixed(3)}`, alias < 0.03, alias < 0.03 ? 40 : Math.max(0, 40 - alias * 300), 40),
      part('True 5 kHz tone present (≥ 0.3)', `measured ${tone.toFixed(3)}`, tone >= 0.3, Math.min(40, (tone / 0.3) * 40), 40),
      part('Spectrum otherwise clean', spurious ? `dominant ${stats.dominantFreq.toFixed(0)} Hz` : 'clean', !spurious, spurious ? 0 : 20, 20),
    ];
    return finish(
      parts,
      75,
      'Remember: an anti-alias filter can only delete out-of-band content. To keep a 5 kHz tone, the sampling rate itself must exceed 10 kHz.',
    );
  },
  passScore: 75,
  explanation:
    'The Nyquist criterion is non-negotiable: fs must exceed twice the highest frequency you want to keep. Raising the link rate above 10 kHz preserves the tone; the anti-alias filter then guards against anything else out of band. Enabling the filter at 8 kHz "fixes" the phantom but silences the signal — passing grading requires respecting both halves of the theorem.',
};

/* ---------------- 3 · Prevent Clipping ---------------- */

export const challengeClipping: Challenge = {
  id: 'ch-prevent-clipping',
  index: 3,
  title: 'Prevent Clipping',
  scenario:
    'A field recorder’s preamp is stuck at +12 dB (fixed) and its converter hard-clips at ±1.0 (fixed). The 500 Hz source arrives at 0.9 peak — the recording is badly distorted.',
  objective:
    'Deliver an undistorted recording: clipping below 0.1%, THD under 5%, while keeping a healthy level (RMS ≥ 0.25).',
  minutes: 8,
  seed: 1303,
  captureDuration: 1,
  build: () =>
    lproject('ch-prevent-clipping', 'Challenge · Prevent Clipping', [
      ln('src', 'src.sine', 40, 180, { freq: 500, amp: 0.9 }),
      ln('preamp', 'proc.gain', 300, 180, { gain: 12 }),
      ln('adc', 'proc.clip', 540, 180, { threshold: 1 }),
      ln('scope', 'ana.scope', 780, 90, { timeWindow: 10 }),
      ln('stats', 'ana.stats', 780, 300),
      ln('out', 'out.audio', 1120, 180),
    ], [
      le('src', 'preamp'),
      le('preamp', 'adc'),
      le('adc', 'scope'),
      le('scope', 'stats'),
      le('stats', 'out'),
    ]),
  fixedNodes: {
    src: { freq: 500, amp: 0.9, phase: 0, offset: 0 },
    preamp: { gain: 12 },
    adc: { threshold: 1 },
  },
  hints: [
    'The converter clips anything beyond ±1.0. The preamp multiplies the 0.9 peak by +12 dB ≈ ×4 — how much do you need to attenuate to land under 1.0?',
    'Insert a Gain module somewhere before the converter. Attenuation before the fixed +12 dB preamp works just as well as after it.',
    'Around −12 dB of trim brings the peak to ~0.9. Watch the clipping % on the Statistics Meter reach 0 while RMS stays above 0.25.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const seg = out!.subarray(SETTLE);
    const stats = computeStats(seg, ctx.sampleRate);
    const thd = thdEstimate(seg, ctx.sampleRate, 500) ?? 1;
    const parts = [
      part('Clipping < 0.1%', `measured ${stats.clippingPct.toFixed(2)}%`, stats.clippingPct < 0.1, stats.clippingPct < 0.1 ? 40 : Math.max(0, 40 - stats.clippingPct * 4), 40),
      part('Distortion (THD) < 5%', `measured ${(thd * 100).toFixed(1)}%`, thd < 0.05, thd < 0.05 ? 25 : Math.max(0, 25 - thd * 100), 25),
      part('Healthy level: RMS ≥ 0.25', `measured ${stats.rms.toFixed(3)}`, stats.rms >= 0.25, Math.min(25, (stats.rms / 0.25) * 25), 25),
      part('Efficiency: ≤ 7 modules', `${ctx.nodeCount} modules`, ctx.nodeCount <= 7, ctx.nodeCount <= 7 ? 10 : 4, 10),
    ];
    return finish(parts, 70, 'The signal must fit under the ±1.0 ceiling before the converter — attenuate, but not so much that the level dies.');
  },
  passScore: 70,
  efficiencyGoal: 'Full marks for 7 modules or fewer.',
  explanation:
    'Gain staging: every element in a chain has a ceiling, and the signal must be scaled to fit the *tightest* one. Attenuating anywhere before the clipper works — the graded numbers (clipping %, THD, RMS) don’t care which topology you chose, only that peaks stay under 1.0 with useful level. Saturation before the converter can also pass if driven gently.',
};

/* ---------------- 4 · Find the Hidden Frequencies ---------------- */

export const challengeHidden: Challenge = {
  id: 'ch-hidden-tones',
  index: 4,
  title: 'Find the Hidden Frequencies',
  scenario:
    'A mystery multi-tone source (fixed) contains exactly three sinusoidal components. Your instruments are the only way to identify them.',
  objective: 'Measure the three component frequencies and enter them within ±25 Hz each.',
  minutes: 10,
  seed: 1404,
  captureDuration: 1,
  build: () =>
    lproject('ch-hidden-tones', 'Challenge · Find the Hidden Frequencies', [
      ln('mystery', 'src.multitone', 40, 180, { tones: '620:0.35, 1490:0.3, 3170:0.25', amp: 1 }),
      ln('spec', 'ana.spectrum', 320, 90, { fftSize: '8192' }),
      ln('scope', 'ana.scope', 320, 310, { timeWindow: 20 }),
      ln('out', 'out.audio', 700, 180),
    ], [le('mystery', 'spec'), le('spec', 'scope'), le('scope', 'out')]),
  fixedNodes: {
    mystery: { tones: '620:0.35, 1490:0.3, 3170:0.25', amp: 1 },
  },
  hints: [
    'The spectrum analyzer shows one line per component. Raise the FFT size for finer frequency resolution before reading peaks.',
    'Hover the spectrum in the large FFT setting: at 8192 points and 48 kHz, each bin is ~5.9 Hz wide — precise enough to read all three.',
    'A Band-Pass Filter swept slowly is an alternative: the output peaks each time its center crosses a component. The three components are between 500 Hz and 3.5 kHz.',
  ],
  answerFields: [
    { id: 'f1', label: 'Component 1', unit: 'Hz' },
    { id: 'f2', label: 'Component 2', unit: 'Hz' },
    { id: 'f3', label: 'Component 3', unit: 'Hz' },
  ],
  grade: (ctx) => {
    const truth = [620, 1490, 3170];
    const answers = [ctx.answers['f1'] ?? 0, ctx.answers['f2'] ?? 0, ctx.answers['f3'] ?? 0];
    const remaining = [...truth];
    const parts: GradePart[] = [];
    let exact = 0;
    answers.forEach((a, i) => {
      let bestIdx = -1;
      let bestErr = Infinity;
      remaining.forEach((t, j) => {
        const err = Math.abs(a - t);
        if (err < bestErr) {
          bestErr = err;
          bestIdx = j;
        }
      });
      const matched = bestIdx >= 0 && bestErr <= 25;
      if (matched) {
        if (bestErr <= 6) exact++;
        remaining.splice(bestIdx, 1);
      }
      parts.push(
        part(
          `Answer ${i + 1} within ±25 Hz`,
          matched ? `${a} Hz — off by ${bestErr.toFixed(1)} Hz` : `${a} Hz does not match a component`,
          matched,
          matched ? 30 : 0,
          30,
        ),
      );
    });
    parts.push(part('Precision bonus (all within ±6 Hz)', `${exact}/3 razor-sharp`, exact === 3, exact === 3 ? 10 : 0, 10));
    return finish(parts, 90, 'Use a large FFT (8192) and read each peak carefully — all three components lie between 500 Hz and 3.5 kHz.');
  },
  passScore: 90,
  explanation:
    'Frequency resolution is Δf = fs/N: at 8192 points the grid is fine enough to pin each line within a few hertz, and parabolic peak interpolation (used by the dominant-frequency readout) does even better. The graded tolerance (±25 Hz) is deliberately wider than one bin — measurement care, not luck, is what passes.',
};

/* ---------------- 5 · Remove an Unwanted Hum ---------------- */

export const challengeHum: Challenge = {
  id: 'ch-remove-hum',
  index: 5,
  title: 'Remove an Unwanted Hum',
  scenario:
    'A plucked-string recording picked up strong 60 Hz mains hum through a ground loop (recording chain fixed). The musical content spans roughly 200 Hz – 6 kHz.',
  objective: 'Suppress the 60 Hz hum by at least 20 dB while preserving at least half of the musical energy.',
  minutes: 10,
  seed: 1505,
  captureDuration: 2,
  build: () =>
    lproject('ch-remove-hum', 'Challenge · Remove an Unwanted Hum', [
      ln('music', 'src.sample', 40, 100, { sample: 'pluck', amp: 0.7, loop: true }),
      ln('hum', 'src.sine', 40, 300, { freq: 60, amp: 0.3 }),
      ln('rx', 'proc.mixer', 300, 200),
      ln('spec', 'ana.spectrum', 560, 90, { fftSize: '8192' }),
      ln('stats', 'ana.stats', 560, 310),
      ln('out', 'out.audio', 900, 200),
    ], [
      le('music', 'rx', 'in1'),
      le('hum', 'rx', 'in2'),
      le('rx', 'spec'),
      le('rx', 'stats'),
      le('spec', 'out'),
    ]),
  fixedNodes: {
    music: { sample: 'pluck', amp: 0.7, loop: true },
    hum: { freq: 60, amp: 0.3, phase: 0, offset: 0 },
    rx: { g1: 1, g2: 1, g3: 1, g4: 1 },
  },
  hints: [
    'The hum is a single narrow line at 60 Hz; the music lives higher. Two families of filters can separate them.',
    'A Band-Stop (notch) at 60 Hz surgically removes the hum. A High-Pass with cutoff ~120 Hz also works since the music starts near 220 Hz.',
    'Raise the notch Q (8–20) so the stopband stays narrow — a wide notch or a high-pass set too high starts eating the music and costs preservation points.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const humOut = ampAt(out!, 60, ctx.sampleRate, SETTLE);
    const humIn = 0.3;
    const suppressionDb = 20 * Math.log10(humIn / Math.max(1e-4, humOut));
    const musicId = ctx.nodeOfType('src.sample');
    const musicRef = musicId ? ctx.buffer(musicId) : null;
    const refBand = musicRef ? bandRms(musicRef.subarray(SETTLE), ctx.sampleRate, 150, 6000) : 0.1;
    const outBand = bandRms(out!.subarray(SETTLE), ctx.sampleRate, 150, 6000);
    const keepRatio = refBand > 1e-6 ? outBand / refBand : 0;
    const parts = [
      part(
        'Hum suppressed ≥ 20 dB',
        `measured ${suppressionDb.toFixed(1)} dB (60 Hz now ${humOut.toFixed(4)})`,
        suppressionDb >= 20,
        Math.min(45, Math.max(0, (suppressionDb / 20) * 45)),
        45,
      ),
      part(
        'Music preserved (≥ 50% band energy 150 Hz–6 kHz)',
        `kept ${(keepRatio * 100).toFixed(0)}%`,
        keepRatio >= 0.5,
        Math.min(35, keepRatio * 60),
        35,
      ),
      part('Efficiency: ≤ 8 modules', `${ctx.nodeCount} modules`, ctx.nodeCount <= 8, ctx.nodeCount <= 8 ? 20 : 8, 20),
    ];
    return finish(parts, 70, 'Kill the 60 Hz line specifically — broad filtering that also removes the music loses preservation points.');
  },
  passScore: 70,
  efficiencyGoal: 'Full marks for 8 modules or fewer.',
  explanation:
    'Interference that occupies a narrow band is best answered with an equally narrow rejection: a high-Q notch removes 60 Hz with barely any collateral damage, while a high-pass below the music’s range achieves the same because nothing musical lives that low. Both solutions — and combinations — pass; what is graded is the outcome: suppression *and* preservation.',
};

/* ---------------- 6 · Reconstruct a Damaged Signal ---------------- */

export const challengeReconstruct: Challenge = {
  id: 'ch-reconstruct',
  index: 6,
  title: 'Reconstruct a Damaged Signal',
  scenario:
    'An archival playback chain (fixed) delivers a 330 Hz tone that is far too quiet (0.2 peak), sits on a +0.45 DC pedestal, and was stored with coarse quantization.',
  objective:
    'Restore a healthy signal: remove the DC, bring RMS into 0.28–0.75, and smooth the quantization so the result closely matches a clean 330 Hz sine.',
  minutes: 12,
  seed: 1606,
  captureDuration: 1,
  build: () =>
    lproject('ch-reconstruct', 'Challenge · Reconstruct a Damaged Signal', [
      ln('srcTone', 'src.sine', 40, 180, { freq: 330, amp: 0.2 }),
      ln('dmgDc', 'proc.dcoffset', 280, 180, { offset: 0.45 }),
      ln('dmgQ', 'proc.quantize', 500, 180, { step: 0.12 }),
      ln('scope', 'ana.scope', 740, 90, { timeWindow: 15 }),
      ln('stats', 'ana.stats', 740, 300),
      ln('out', 'out.audio', 1080, 180),
    ], [
      le('srcTone', 'dmgDc'),
      le('dmgDc', 'dmgQ'),
      le('dmgQ', 'scope'),
      le('scope', 'stats'),
      le('stats', 'out'),
    ]),
  fixedNodes: {
    srcTone: { freq: 330, amp: 0.2, phase: 0, offset: 0 },
    dmgDc: { offset: 0.45 },
    dmgQ: { step: 0.12 },
  },
  hints: [
    'Three independent problems, three tools: DC → a high-pass with a very low cutoff; low level → gain; quantization grit → a low-pass above 330 Hz.',
    'Order matters less than you might fear, but removing DC before adding gain avoids amplifying the pedestal. Try High-Pass (20–50 Hz) → Gain (+8 to +12 dB) → Low-Pass (600–2000 Hz).',
    'Watch the meter: Mean ≈ 0, RMS between 0.28 and 0.75. The scope should show a smooth sine, not a staircase.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const seg = out!.subarray(SETTLE);
    const stats = computeStats(seg, ctx.sampleRate);
    const ref = refSine(330, Math.min(seg.length, 48000), ctx.sampleRate);
    const corr = maxCorrelation(ref, seg.subarray(0, ref.length), 400);
    const thd = thdEstimate(seg, ctx.sampleRate, 330) ?? 1;
    const parts = [
      part('DC removed (|mean| < 0.03)', `mean ${stats.mean.toFixed(3)}`, Math.abs(stats.mean) < 0.03, Math.abs(stats.mean) < 0.03 ? 25 : Math.max(0, 25 - Math.abs(stats.mean) * 100), 25),
      part('Level restored (RMS 0.28 – 0.75)', `RMS ${stats.rms.toFixed(3)}`, stats.rms >= 0.28 && stats.rms <= 0.75, stats.rms >= 0.28 && stats.rms <= 0.75 ? 25 : 10 * Math.min(1, stats.rms / 0.28), 25),
      part('Waveform matches a 330 Hz sine (corr ≥ 0.9)', `correlation ${corr.toFixed(3)}`, corr >= 0.9, Math.min(30, Math.max(0, corr) * 30), 30),
      part('Quantization smoothed (THD+grit < 8%)', `residual ${(thd * 100).toFixed(1)}%`, thd < 0.08, thd < 0.08 ? 20 : Math.max(0, 20 - thd * 100), 20),
    ];
    return finish(parts, 70, 'Work the three damages independently: DC (high-pass), level (gain), staircase (low-pass). The meter and scope tell you when each is fixed.');
  },
  passScore: 70,
  explanation:
    'Restoration is decomposition: each impairment has a linear cure that does not disturb the others. A first-order view — high-pass kills the 0 Hz pedestal, gain rescales, low-pass removes the quantization harmonics above the tone — recovers a signal correlating ≥ 0.9 with the ideal sine. Any filter arrangement achieving the four measured targets passes.',
};

/* ---------------- 7 · Decode an AM Transmission ---------------- */

export const challengeAm: Challenge = {
  id: 'ch-decode-am',
  index: 7,
  title: 'Decode an AM Transmission',
  scenario:
    'An off-air receiver hands you a raw AM signal (fixed): a 400 Hz voice tone amplitude-modulating an 8 kHz carrier at 80% depth. Your bench must recover the message.',
  objective:
    'Produce the 400 Hz message at the output: correct dominant frequency, clean waveform, carrier residue below 0.05.',
  minutes: 15,
  seed: 1707,
  captureDuration: 1,
  build: () =>
    lproject('ch-decode-am', 'Challenge · Decode an AM Transmission', [
      ln('rx', 'src.expression', 40, 180, {
        expr: '(1 + 0.8*sin(2*pi*400*t)) * cos(2*pi*8000*t)',
        amp: 0.5,
      }),
      ln('scope', 'ana.scope', 300, 90, { timeWindow: 10 }),
      ln('spec', 'ana.spectrum', 300, 310, { fftSize: '8192', freqScale: 'linear' }),
      ln('out', 'out.audio', 660, 180),
    ], [le('rx', 'scope'), le('scope', 'spec'), le('spec', 'out')]),
  fixedNodes: {
    rx: { expr: '(1 + 0.8*sin(2*pi*400*t)) * cos(2*pi*8000*t)', amp: 0.5 },
  },
  hints: [
    'The message is the *envelope* of the received signal. Multiplying the signal by a synchronized copy of the carrier shifts the message back to baseband (a product detector).',
    'The AM Modulator node in "Multiply (DSB-SC)" mode IS a multiplier: feed the received signal into its Message input and set its internal carrier to 8000 Hz.',
    'After the product detector you have the message plus components near 16 kHz and a DC offset. Low-pass around 1 kHz, then high-pass ~50 Hz (or a DC-blocking high-pass) to leave only the clean 400 Hz tone.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const seg = out!.subarray(SETTLE);
    const stats = computeStats(seg, ctx.sampleRate);
    const ref = refSine(400, Math.min(seg.length, 48000), ctx.sampleRate);
    const corr = maxCorrelation(ref, seg.subarray(0, ref.length), 400);
    const carrier = ampAt(out!, 8000, ctx.sampleRate, SETTLE);
    const parts = [
      part(
        'Dominant output is 400 Hz (±25)',
        `dominant ${stats.dominantFreq.toFixed(0)} Hz`,
        Math.abs(stats.dominantFreq - 400) <= 25,
        Math.abs(stats.dominantFreq - 400) <= 25 ? 40 : 0,
        40,
      ),
      part('Message waveform clean (corr ≥ 0.75)', `correlation ${corr.toFixed(3)}`, corr >= 0.75, Math.min(30, Math.max(0, corr) * 35), 30),
      part('Carrier residue < 0.05 at 8 kHz', `measured ${carrier.toFixed(3)}`, carrier < 0.05, carrier < 0.05 ? 20 : Math.max(0, 20 - carrier * 100), 20),
      part('Efficiency: ≤ 8 modules', `${ctx.nodeCount} modules`, ctx.nodeCount <= 8, ctx.nodeCount <= 8 ? 10 : 4, 10),
    ];
    return finish(parts, 70, 'Demodulate, then clean: multiply by an 8 kHz carrier (AM node in DSB mode), low-pass out the high products, high-pass out the DC.');
  },
  passScore: 70,
  efficiencyGoal: 'Full marks for 8 modules or fewer.',
  explanation:
    'This is synchronous (product) detection: multiplying by cos(2πf_ct) shifts the received spectrum down by f_c, landing the message at baseband and images at 2f_c. A low-pass keeps the message; a high-pass removes the demodulated carrier’s DC term. Capture mode’s deterministic phase makes your local carrier line up exactly — real receivers add a phase-locked loop for the same purpose.',
};

/* ---------------- 8 · Match the Mystery System ---------------- */

/** The hidden reference system: what the user must approximate. */
function mysteryReference(duration: number, seed: number): Float32Array {
  const graph = lproject('ref', 'ref', [
    ln('probe', 'src.impulse', 0, 0, { startTime: 0.05, mode: 'single', amp: 1 }),
    ln('sys', 'proc.feedback', 0, 0, { time: 180, feedback: 0.45, mix: 1 }),
  ], [le('probe', 'sys')]).graph;
  const res = runCapture({ graph, duration, sampleRate: SR, seed });
  return res.buffers['sys'];
}

export const challengeMystery: Challenge = {
  id: 'ch-mystery-system',
  index: 8,
  title: 'Match the Mystery System',
  scenario:
    'A sealed effects unit was measured in the lab before it was lost. Its datasheet survives: “Impulse in → impulse out, followed by repeats every 180 ms, each repeat −6.9 dB (≈ 45%) of the previous, mixed fully wet.” Your probe (a single impulse at t = 50 ms, fixed) is already patched.',
  objective:
    'Rebuild a system whose impulse response matches the datasheet: repeats at the right spacing, decaying at the right rate.',
  minutes: 15,
  seed: 1808,
  captureDuration: 2,
  build: () =>
    lproject('ch-mystery-system', 'Challenge · Match the Mystery System', [
      ln('probe', 'src.impulse', 40, 180, { startTime: 0.05, mode: 'single', amp: 1 }),
      ln('scope', 'ana.scope', 300, 90, { timeWindow: 500, trigMode: 'off' }),
      ln('spec', 'ana.spectrum', 300, 310, { fftSize: '8192' }),
      ln('out', 'out.audio', 660, 180),
    ], [le('probe', 'scope'), le('scope', 'spec'), le('spec', 'out')]),
  fixedNodes: {
    probe: { startTime: 0.05, mode: 'single', amp: 1 },
  },
  hints: [
    'Repeats that each carry a fixed fraction of the previous one are the signature of feedback around a delay. Which module provides exactly that?',
    'Insert a Feedback Delay between the probe and the output. The repeat spacing equals its Delay time — the datasheet says 180 ms.',
    'Each round trip multiplies by the Feedback amount: −6.9 dB per repeat means feedback ≈ 0.45. Set Dry/Wet to fully wet (1.0) and compare your scope with the datasheet numbers.',
  ],
  grade: (ctx) => {
    const { out, missing } = needOut(ctx);
    if (missing) return missing;
    const ref = mysteryReference(ctx.buffer(ctx.nodeOfType('out.audio')!)!.length / ctx.sampleRate, 1808);
    const n = Math.min(ref.length, out!.length);
    const corr = maxCorrelation(ref.subarray(0, n), out!.subarray(0, n), 100);
    const sim = spectralSimilarity(ref.subarray(0, n), out!.subarray(0, n), ctx.sampleRate);
    let refE = 0;
    let outE = 0;
    for (let i = 0; i < n; i++) {
      refE += ref[i] * ref[i];
      outE += out![i] * out![i];
    }
    const energyDb = 10 * Math.log10(Math.max(1e-12, outE) / Math.max(1e-12, refE));
    const parts = [
      part('Impulse response matches (corr ≥ 0.85)', `correlation ${corr.toFixed(3)}`, corr >= 0.85, Math.min(50, Math.max(0, corr) * 55), 50),
      part('Frequency response matches (similarity ≥ 0.9)', `similarity ${sim.toFixed(3)}`, sim >= 0.9, Math.min(30, Math.max(0, sim) * 32), 30),
      part('Overall energy within ±3 dB', `${energyDb >= 0 ? '+' : ''}${energyDb.toFixed(1)} dB`, Math.abs(energyDb) <= 3, Math.abs(energyDb) <= 3 ? 20 : Math.max(0, 20 - Math.abs(energyDb) * 3), 20),
    ];
    return finish(parts, 70, 'Read the datasheet numbers literally: repeat spacing = delay time, repeat ratio = feedback gain, fully wet mix.');
  },
  passScore: 70,
  explanation:
    'You reverse-engineered a system from its impulse-response description: repeats every 180 ms ⇒ delay D = 180 ms; each repeat 45% ⇒ loop gain g = 0.45; fully wet ⇒ mix = 1. Because an LTI system is completely defined by its impulse response, matching h[n] (correlation) automatically matches the frequency response too — the second criterion confirms the first.',
};

export const CHALLENGES: Challenge[] = [
  challengeRescue,
  challengeAliasing,
  challengeClipping,
  challengeHidden,
  challengeHum,
  challengeReconstruct,
  challengeAm,
  challengeMystery,
];
