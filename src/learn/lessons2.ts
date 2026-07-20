/** Lessons 6–10: filtering, distortion & quantization, AM, FM, convolution. */

import type { Lesson } from './types';
import { ln, le, lproject, fmtHz } from './lessonUtils';

export const lesson6: Lesson = {
  id: 'lesson-filtering',
  index: 6,
  title: 'Filtering Fundamentals',
  summary: 'Low-pass, high-pass, band-pass and notch behaviour on a harmonic-rich signal.',
  minutes: 12,
  build: () =>
    lproject('lesson-filtering', 'Lesson 6 · Filtering Fundamentals', [
      ln('saw', 'src.sawtooth', 50, 180, { freq: 220, amp: 0.45 }),
      ln('lpf', 'proc.lowpass', 300, 180, { freq: 8000, q: 0.707 }),
      ln('spec', 'ana.spectrum', 550, 90, { fftSize: '4096' }),
      ln('scope', 'ana.scope', 550, 300, { timeWindow: 15 }),
      ln('out', 'out.audio', 920, 180),
    ], [le('saw', 'lpf'), le('lpf', 'spec'), le('spec', 'scope'), le('scope', 'out')]),
  steps: [
    {
      id: 'sweep',
      title: 'The classic filter sweep',
      body: [
        'A sawtooth (every harmonic present) runs through a **Low-Pass Filter**. Press Play and slowly sweep the cutoff from 8 kHz down toward 300 Hz.',
        'Watch harmonics disappear from the top down while the scope waveform rounds off toward a sine. The sound dulls — exactly the effect of walls, distance, or a hand over your mouth.',
      ],
      action: 'Sweep the LPF cutoff down to ~300 Hz and back while playing.',
      goals: [
        {
          id: 'lowcut',
          description: 'Bring the cutoff below 500 Hz',
          check: (ctx) => {
            const f = Number(ctx.param('lpf', 'freq') ?? 9999);
            return { met: f < 500, value: fmtHz(f) };
          },
        },
      ],
      math: {
        title: 'Cutoff and rolloff',
        equations: ['|H(f_c)| = \\tfrac{1}{\\sqrt{2}} \\approx -3\\,\\text{dB}', '\\text{slope} \\approx -12\\ \\text{dB/octave (2nd order)}'],
        symbols: { 'f_c': 'cutoff frequency', '|H(f)|': 'how much the filter passes at frequency f' },
        interpretation:
          'A filter is a frequency-dependent volume knob. This biquad reduces amplitude to 70.7% at the cutoff and by a further factor of ~4 for each octave above it.',
      },
    },
    {
      id: 'q',
      title: 'Resonance (Q)',
      body: [
        'Set the cutoff near 1 kHz and raise **Q** from 0.7 toward 8. A peak grows right at the cutoff: the filter now *emphasizes* frequencies at its corner before cutting above it.',
        'High-Q filters ring: strike them with transients and they oscillate briefly at their resonant frequency — audible as a "wah" character while sweeping.',
      ],
      action: 'Raise Q to 6+ and sweep the cutoff to hear resonance.',
      goals: [
        {
          id: 'hi-q',
          description: 'Q of at least 5',
          check: (ctx) => {
            const q = Number(ctx.param('lpf', 'q') ?? 0);
            return { met: q >= 5, value: q.toFixed(1) };
          },
        },
      ],
    },
    {
      id: 'hpf',
      title: 'High-pass: the mirror image',
      prediction: {
        id: 'p-hpf',
        question: 'Replace your mental low-pass with a high-pass at 1 kHz on this 220 Hz sawtooth. What survives?',
        options: [
          'Only the 220 Hz fundamental',
          'Harmonics above ~1 kHz; the fundamental is heavily cut',
          'Everything, quietly',
          'Nothing at all',
        ],
        correct: 1,
        reveal:
          'A high-pass at 1 kHz removes the fundamental (220 Hz) and low harmonics, keeping the buzz of the upper harmonics — thin and bright, like a small phone speaker.',
      },
      body: [
        'Swap in a **High-Pass Filter**: delete the LPF (select + Delete), add a High-Pass from the library, and rewire saw → HPF → Spectrum. Set its cutoff to 1 kHz.',
        'The pitch you perceive may barely change (your brain reconstructs the fundamental from harmonic spacing) but the body of the tone is gone.',
      ],
      action: 'Replace the low-pass with a high-pass filter at ~1 kHz.',
      goals: [
        {
          id: 'hpf-in',
          description: 'A High-Pass Filter is processing the sawtooth',
          check: (ctx) => {
            const hpf = ctx.nodeOfType('proc.highpass');
            if (!hpf) return { met: false };
            const st = ctx.stats(hpf);
            return { met: (st?.rms ?? 0) > 0.01, value: st ? `rms ${st.rms.toFixed(3)}` : undefined };
          },
        },
      ],
    },
    {
      id: 'bandpass-notch',
      title: 'Band-pass and notch',
      body: [
        '**Band-pass** keeps only a slice around its center — try one at 880 Hz with Q 8 to isolate a single harmonic from the sawtooth comb.',
        'The **Band-Stop (notch)** is its inverse: it surgically removes one narrow band and leaves the rest. Notches at 50/60 Hz remove mains hum from recordings — you will use exactly this in a challenge.',
      ],
      action: 'Try a Band-Pass Filter (880 Hz, Q 8) in place of the high-pass and listen: one harmonic, nearly alone.',
      goals: [
        {
          id: 'bpf-in',
          description: 'A Band-Pass Filter isolates a harmonic',
          check: (ctx) => {
            const bpf = ctx.nodeOfType('proc.bandpass');
            if (!bpf) return { met: false };
            const st = ctx.stats(bpf);
            const met = !!st && st.rms > 0.005 && st.dominantFreq > 400;
            return { met, value: st ? fmtHz(st.dominantFreq) : undefined };
          },
        },
      ],
    },
  ],
  closing:
    'Four shapes cover most of filtering: low-pass (remove highs), high-pass (remove lows), band-pass (keep a slice), notch (remove a slice). Cutoff places the boundary; Q sharpens it and adds resonance. Filters are volume knobs that discriminate by frequency.',
};

export const lesson7: Lesson = {
  id: 'lesson-quantization',
  index: 7,
  title: 'Clipping & Quantization',
  summary: 'Two very different distortions: running out of headroom vs running out of resolution.',
  minutes: 10,
  build: () =>
    lproject('lesson-quantization', 'Lesson 7 · Clipping & Quantization', [
      ln('sine', 'src.sine', 50, 180, { freq: 330, amp: 0.9 }),
      ln('clip', 'proc.clip', 300, 180, { threshold: 1 }),
      ln('crush', 'proc.bitcrush', 520, 180, { bits: 16 }),
      ln('scope', 'ana.scope', 760, 90, { timeWindow: 10 }),
      ln('spec', 'ana.spectrum', 760, 300, { fftSize: '4096' }),
      ln('out', 'out.audio', 1120, 180),
    ], [
      le('sine', 'clip'),
      le('clip', 'crush'),
      le('crush', 'scope'),
      le('scope', 'spec'),
      le('spec', 'out'),
    ]),
  steps: [
    {
      id: 'headroom',
      title: 'Clipping: hitting the ceiling',
      body: [
        'Lower the Hard Clip **Threshold** to 0.5 while playing. The sine’s tops flatten and the tone hardens: the spectrum sprouts strong **odd harmonics** (3×, 5×, 7× the fundamental).',
        'This is what happens when any stage runs out of headroom — an overdriven amplifier, a too-hot recording, a maxed-out DAC.',
      ],
      action: 'Reduce clip threshold to 0.5 and watch odd harmonics appear in the spectrum.',
      goals: [
        {
          id: 'clipped',
          description: 'Clip threshold at 0.6 or below (visible flattening)',
          check: (ctx) => {
            const t = Number(ctx.param('clip', 'threshold') ?? 1);
            return { met: t <= 0.6, value: t.toFixed(2) };
          },
        },
      ],
      math: {
        title: 'Why odd harmonics?',
        equations: ['y(t) = \\mathrm{clip}(x(t)) \\text{ is odd-symmetric} \\Rightarrow \\text{only odd harmonics}'],
        symbols: { 'odd-symmetric': 'f(−x) = −f(x): both half-cycles distort identically' },
        interpretation:
          'Symmetric distortion cannot create even harmonics — the flattened positive and negative halves mirror each other, and mirrors cancel even terms in the Fourier series.',
      },
    },
    {
      id: 'quant',
      title: 'Quantization: a coarse ruler',
      prediction: {
        id: 'p-bits',
        question: 'Restore the clip threshold to 1.0 and drop Bit Depth from 16 to 4 bits. What appears in the spectrum?',
        options: [
          'Odd harmonics only, like clipping',
          'A broad noise floor and gritty distortion products',
          'Nothing changes below Nyquist',
          'The fundamental shifts frequency',
        ],
        correct: 1,
        reveal:
          '4 bits allow only 16 levels. The rounding error acts like added noise (with tonal grit for simple signals): the noise floor rises ~6 dB for every bit removed.',
      },
      body: [
        'Set the clip threshold back to 1.0, then reduce **Bit Depth** step by step: 12, 8, 6, 4 bits. Watch the staircase coarsen on the scope and the noise floor climb on the spectrum.',
      ],
      action: 'Reduce bit depth to 4 and compare the noise floor with 16 bits.',
      goals: [
        {
          id: 'crushed',
          description: 'Bit depth at 6 or fewer bits',
          check: (ctx) => {
            const b = Number(ctx.param('crush', 'bits') ?? 16);
            return { met: b <= 6, value: `${b} bits` };
          },
        },
      ],
      math: {
        title: 'Bits buy dynamic range',
        equations: ['\\text{SNR}_{max} \\approx 6.02B + 1.76\\ \\text{dB}'],
        symbols: { B: 'bits per sample' },
        interpretation:
          '16-bit audio reaches ~98 dB — enough that dither makes quantization inaudible. At 8 bits (~50 dB) the grit is plain; at 4 bits it dominates.',
      },
    },
    {
      id: 'compare',
      title: 'Two distortions, two fingerprints',
      body: [
        'Clipping correlates with the signal: harmonics locked to multiples of the fundamental, level-dependent, harsh but musical in small doses.',
        'Quantization error behaves like a **noise floor**: broadband, roughly level-independent, and it stays even when the music gets quiet — which is why low bit depths sound "fizzy" in fades.',
        'Both destroy information irreversibly. Gain staging avoids the first; enough bits (plus dither, in real systems) avoids the second.',
      ],
      action: 'Toggle between (threshold 0.4, 16 bits) and (threshold 1.0, 4 bits) and compare the two spectra.',
      goals: [
        {
          id: 'restore',
          description: 'Restore a clean path (threshold 1.0, ≥ 12 bits)',
          check: (ctx) => {
            const t = Number(ctx.param('clip', 'threshold') ?? 0);
            const b = Number(ctx.param('crush', 'bits') ?? 0);
            return { met: t >= 0.95 && b >= 12, value: `thr ${t.toFixed(2)} · ${b} bits` };
          },
        },
      ],
    },
  ],
  closing:
    'Clipping is a headroom failure: signal-correlated odd harmonics. Quantization is a resolution failure: a broadband error floor rising 6 dB per lost bit. Recognizing each fingerprint in a spectrum tells you which part of a system is undersized.',
};

export const lesson8: Lesson = {
  id: 'lesson-am',
  index: 8,
  title: 'Amplitude Modulation',
  summary: 'Carriers, sidebands, modulation depth and the idea behind AM radio.',
  minutes: 12,
  build: () =>
    lproject('lesson-am', 'Lesson 8 · Amplitude Modulation', [
      ln('msg', 'src.sine', 50, 180, { freq: 300, amp: 1 }),
      ln('am', 'proc.am', 300, 180, { carrier: 6000, depth: 0.5, mode: 'am' }),
      ln('scope', 'ana.scope', 550, 90, { timeWindow: 20 }),
      ln('spec', 'ana.spectrum', 550, 300, { fftSize: '8192', freqScale: 'linear' }),
      ln('out', 'out.audio', 920, 180),
    ], [le('msg', 'am', 'msg'), le('am', 'scope'), le('scope', 'spec'), le('spec', 'out')]),
  steps: [
    {
      id: 'envelope',
      title: 'Riding the carrier',
      body: [
        'A 300 Hz **message** modulates the amplitude of a 6 kHz **carrier**. On the scope you see the fast carrier filling an envelope shaped like the slow message.',
        'This is how AM radio squeezes speech (20 Hz–5 kHz) onto a station at, say, 810 kHz: the message rides as the carrier’s changing loudness.',
      ],
      action: 'Play and identify the 300 Hz envelope wrapping the 6 kHz fill.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
    },
    {
      id: 'sidebands',
      title: 'Sidebands: the message relocated',
      prediction: {
        id: 'p-side',
        question: 'The spectrum shows the 6 kHz carrier. Where does the 300 Hz message appear?',
        options: [
          'At 300 Hz, unchanged',
          'Nowhere — amplitude changes have no spectrum',
          'As lines at 5.7 kHz and 6.3 kHz',
          'Spread evenly everywhere',
        ],
        correct: 2,
        reveal:
          'Multiplying by the carrier shifts the message next to it: sidebands at f_c ± f_m. The message’s spectrum is copied (mirrored) around the carrier — that relocation is the whole point of modulation.',
      },
      body: [
        'Zoom mentally into the linear-axis spectrum: three lines — carrier at 6 kHz, **sidebands** at 5.7 and 6.3 kHz. Sweep the message frequency and watch the sidebands track ±f_m around the fixed carrier.',
      ],
      action: 'Sweep the message frequency 100 → 800 Hz and watch the sidebands spread.',
      goals: [
        {
          id: 'spread',
          description: 'Message frequency at 600 Hz+ (wide sidebands)',
          check: (ctx) => {
            const f = Number(ctx.param('msg', 'freq') ?? 0);
            return { met: f >= 600, value: fmtHz(f) };
          },
        },
      ],
      math: {
        title: 'Where sidebands come from',
        equations: [
          '[1 + m\\cos(2\\pi f_m t)]\\cos(2\\pi f_c t) = \\cos(2\\pi f_c t) + \\tfrac{m}{2}\\cos(2\\pi(f_c{-}f_m)t) + \\tfrac{m}{2}\\cos(2\\pi(f_c{+}f_m)t)',
        ],
        symbols: { m: 'modulation depth', 'f_c': 'carrier', 'f_m': 'message frequency' },
        interpretation:
          'A product of cosines is a sum of cosines at the sum and difference frequencies. AM is multiplication, so the message reappears as mirror twins beside the carrier.',
      },
    },
    {
      id: 'depth',
      title: 'Modulation depth and overmodulation',
      body: [
        'Raise **Mod Depth** toward 1.0: the envelope pinches down to zero — 100% modulation, the loudest clean setting.',
        'Push beyond 1.0 and the envelope crosses zero and folds: **overmodulation**. An envelope detector (which can only follow positive envelopes) would distort badly here.',
      ],
      action: 'Set depth to 1.3 and watch the envelope fold at the pinch points.',
      goals: [
        {
          id: 'overmod',
          description: 'Experience overmodulation (depth > 1.0)',
          check: (ctx) => {
            const d = Number(ctx.param('am', 'depth') ?? 0);
            return { met: d > 1.0, value: d.toFixed(2) };
          },
        },
      ],
    },
    {
      id: 'dsb',
      title: 'Suppressing the carrier',
      body: [
        'Switch Mode to **Multiply (DSB-SC)**. The carrier line vanishes from the spectrum, leaving only the two sidebands: all transmitted power now carries information.',
        'The price: recovery needs a synchronized local carrier (a *product detector*) instead of a simple envelope follower — a trade you will exploit in the AM decoding challenge.',
      ],
      action: 'Switch the AM node to DSB-SC and confirm the carrier disappears.',
      goals: [
        {
          id: 'dsb',
          description: 'DSB-SC mode selected',
          check: (ctx) => ({ met: ctx.param('am', 'mode') === 'dsb' }),
        },
      ],
    },
  ],
  closing:
    'AM shifts a message beside a carrier as mirror sidebands; depth sets envelope strength (1.0 = the clean limit) and suppressing the carrier trades simple receivers for efficiency. You now own the vocabulary — carrier, sidebands, depth, detection — used everywhere in communications.',
};

export const lesson9: Lesson = {
  id: 'lesson-fm',
  index: 9,
  title: 'Frequency Modulation',
  summary: 'Instantaneous frequency, deviation, modulation index and FM’s dense spectrum.',
  minutes: 12,
  build: () =>
    lproject('lesson-fm', 'Lesson 9 · Frequency Modulation', [
      ln('msg', 'src.sine', 50, 180, { freq: 4, amp: 1 }),
      ln('fm', 'proc.fm', 300, 180, { carrier: 800, deviation: 50 }),
      ln('scope', 'ana.scope', 550, 90, { timeWindow: 50 }),
      ln('sgram', 'ana.spectrogram', 550, 300, { fftSize: '1024', overlap: 0.75 }),
      ln('out', 'out.audio', 920, 180),
    ], [le('msg', 'fm', 'msg'), le('fm', 'scope'), le('scope', 'sgram'), le('sgram', 'out')]),
  steps: [
    {
      id: 'vibrato',
      title: 'Wobbling the frequency',
      body: [
        'Here the message does **not** change the carrier’s loudness — it pushes its **frequency** up and down. At a 4 Hz message and ±50 Hz deviation you hear vibrato: pitch wobbling around 800 Hz.',
        'The **spectrogram** shows it directly: a bright line snaking up and down four times per second.',
      ],
      action: 'Play and watch the snaking line on the spectrogram.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
      math: {
        title: 'Instantaneous frequency',
        equations: ['f_{inst}(t) = f_c + \\Delta f \\cdot x_m(t)'],
        symbols: {
          'f_{inst}': 'the frequency at each instant',
          'f_c': 'carrier (center) frequency',
          '\\Delta f': 'peak deviation',
          'x_m(t)': 'message in ±1',
        },
        interpretation:
          'FM writes the message into the *rate of rotation* of the carrier’s phase. Loudness stays constant — which is why FM radio shrugs off amplitude noise like lightning static.',
      },
    },
    {
      id: 'deviation',
      title: 'Deviation: how far it swings',
      body: [
        'Raise **Deviation** from 50 Hz to 400 Hz. The snake’s swing widens: the pitch now sweeps 400–1200 Hz. Deviation is the frequency equivalent of "volume" for the modulation.',
      ],
      action: 'Set deviation to 400 Hz and watch the sweep widen on the spectrogram.',
      goals: [
        {
          id: 'wide',
          description: 'Deviation at 300 Hz or more',
          check: (ctx) => {
            const d = Number(ctx.param('fm', 'deviation') ?? 0);
            return { met: d >= 300, value: fmtHz(d) };
          },
        },
      ],
    },
    {
      id: 'audio-rate',
      title: 'Audio-rate FM: sidebands everywhere',
      prediction: {
        id: 'p-fmside',
        question: 'Raise the message from 4 Hz to 200 Hz (audio rate). What does the spectrum become?',
        options: [
          'A single line that moves too fast to see',
          'Carrier plus ONE pair of sidebands, like AM',
          'A comb of many sidebands spaced 200 Hz apart',
          'White noise',
        ],
        correct: 2,
        reveal:
          'FM is nonlinear in the message: it creates sidebands at f_c ± k·f_m for many k, with Bessel-function amplitudes. The faster and deeper the modulation, the more pairs appear.',
      },
      body: [
        'Set the message to **200 Hz**. The wobble becomes a *timbre*: a bright, metallic comb of sidebands spaced 200 Hz around the carrier. This is the engine of FM synthesis (the DX7 and countless bell/electric-piano sounds).',
      ],
      action: 'Set message frequency to 200 Hz and study the comb in the spectrogram.',
      goals: [
        {
          id: 'audio-fm',
          description: 'Message at audio rate (≥ 100 Hz)',
          check: (ctx) => {
            const f = Number(ctx.param('msg', 'freq') ?? 0);
            return { met: f >= 100, value: fmtHz(f) };
          },
        },
      ],
      math: {
        title: 'Modulation index & bandwidth',
        equations: ['\\beta = \\frac{\\Delta f}{f_m}', '\\text{BW} \\approx 2(\\Delta f + f_m) \\ \\ \\text{(Carson’s rule)}'],
        symbols: { '\\beta': 'modulation index', '\\text{BW}': 'occupied bandwidth' },
        interpretation:
          'β counts how many strong sideband pairs to expect. Carson’s rule estimates total bandwidth — FM buys noise immunity by spending spectrum.',
      },
    },
    {
      id: 'tradeoff',
      title: 'Reading the time–frequency trade-off',
      body: [
        'Select the spectrogram and try FFT size 256 vs 4096 with the 4 Hz message restored: small windows draw the frequency sweep crisply in time but thick in frequency; large windows are the reverse.',
        'No setting wins both — Δf·Δt has a hard floor. Choosing the window IS choosing what question you ask.',
      ],
      action: 'Set the message back to 4 Hz and compare spectrogram FFT sizes 256 and 4096.',
      goals: [
        {
          id: 'window-play',
          description: 'Try a different spectrogram FFT size',
          check: (ctx) => {
            const size = String(ctx.param('sgram', 'fftSize') ?? '1024');
            return { met: size !== '1024', value: `FFT ${size}` };
          },
        },
      ],
    },
  ],
  closing:
    'FM encodes the message in instantaneous frequency: deviation sets the swing, the message rate sets sideband spacing, and β = Δf/f_m predicts the spectral complexity — from gentle vibrato to bell-like combs. The spectrogram, with its window trade-off, is the natural instrument for watching it.',
};

export const lesson10: Lesson = {
  id: 'lesson-convolution',
  index: 10,
  title: 'Convolution & Impulse Response',
  summary: 'Echoes, rooms and smoothing — every linear system summarized by one signal.',
  minutes: 12,
  build: () =>
    lproject('lesson-convolution', 'Lesson 10 · Convolution & Impulse Response', [
      ln('imp', 'src.impulse', 50, 100, { startTime: 0.1, mode: 'train', rate: 1 }),
      ln('pluck', 'src.sample', 50, 300, { sample: 'pluck', amp: 0, loop: true }),
      ln('mix', 'proc.mixer', 300, 200),
      ln('conv', 'proc.convolution', 520, 200, { ir: 'echo-short', mix: 1 }),
      ln('scope', 'ana.scope', 770, 100, { timeWindow: 400, trigMode: 'off' }),
      ln('sgram', 'ana.spectrogram', 770, 310, { fftSize: '1024' }),
      ln('out', 'out.audio', 1130, 200),
    ], [
      le('imp', 'mix', 'in1'),
      le('pluck', 'mix', 'in2'),
      le('mix', 'conv'),
      le('conv', 'scope'),
      le('scope', 'sgram'),
      le('sgram', 'out'),
    ]),
  steps: [
    {
      id: 'ir',
      title: 'Interrogating a system with a click',
      body: [
        'An **Impulse** (one-sample click, repeating once per second) feeds a **Convolution** module loaded with a "Short echo" response.',
        'Each click comes out as *three* clicks: the original plus copies at 120 ms (×0.55) and 240 ms (×0.3). What you see on the scope IS the system’s **impulse response** — its complete fingerprint.',
      ],
      action: 'Play and read the echo pattern on the 400 ms scope window.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
      math: {
        title: 'Convolution',
        equations: ['y[n] = \\sum_k h[k]\\, x[n-k]'],
        symbols: { 'h[k]': 'impulse response', 'x[n-k]': 'input, k samples ago' },
        interpretation:
          'Every output sample is a history of inputs weighted by h. Feed in δ (a single 1) and the sum collapses to h itself — measuring a system means clicking at it and recording.',
      },
    },
    {
      id: 'music',
      title: 'Convolving real material',
      body: [
        'Silence the impulse train (amplitude 0) and raise the **pluck sample** to 0.9. Every pluck now carries the same echo pattern — convolution applies the fingerprint to *everything* that passes through.',
      ],
      action: 'Set impulse amp → 0, pluck amp → 0.9, and listen to the echoed plucks.',
      goals: [
        {
          id: 'swap',
          description: 'Pluck audible through the echo (impulse muted)',
          check: (ctx) => {
            const ia = Number(ctx.param('imp', 'amp') ?? 1);
            const pa = Number(ctx.param('pluck', 'amp') ?? 0);
            return { met: ia < 0.05 && pa > 0.5, value: `imp ${ia.toFixed(2)} · pluck ${pa.toFixed(2)}` };
          },
        },
      ],
    },
    {
      id: 'rooms',
      title: 'From echoes to rooms',
      prediction: {
        id: 'p-room',
        question: 'Switch the impulse response from "Short echo" to "Large room". What changes in the response?',
        options: [
          'Fewer, cleaner repeats',
          'A dense, decaying wash instead of discrete repeats',
          'The signal gets brighter',
          'Nothing — rooms are not linear systems',
        ],
        correct: 1,
        reveal:
          'A room reflects sound thousands of times: its impulse response is a dense decaying tail (reverberation), not separated clicks. Convolution reverb literally uses measured room IRs like this.',
      },
      body: [
        'Try **Small room** and **Large room** responses. The scope shows the discrete echoes dissolve into a smooth exponential tail; the spectrogram shows every pluck smeared in time.',
      ],
      action: 'Select the Large room IR and compare the tail with the echo IR.',
      goals: [
        {
          id: 'room',
          description: 'A room impulse response selected',
          check: (ctx) => {
            const ir = String(ctx.param('conv', 'ir') ?? '');
            return { met: ir === 'room-small' || ir === 'room-large', value: ir };
          },
        },
      ],
    },
    {
      id: 'smoothing',
      title: 'Convolution is also filtering',
      body: [
        'Load the **Smoothing kernel** — a 33-sample bump. Convolving with it averages neighbouring samples: a low-pass filter! The Moving Average node from Lesson 6 is exactly a convolution with a rectangular kernel.',
        'Filtering, echo and reverb are one operation with different h. In the frequency domain they are all just multiplication by H(f).',
      ],
      action: 'Switch to the Smoothing kernel and hear the plucks dull as high frequencies are averaged away.',
      goals: [
        {
          id: 'smooth',
          description: 'Smoothing kernel selected',
          check: (ctx) => ({ met: String(ctx.param('conv', 'ir')) === 'smooth' }),
        },
      ],
    },
  ],
  closing:
    'One signal — the impulse response — completely characterizes any linear time-invariant system, and convolution applies it to arbitrary input. Echo, reverberation and filtering are the same mathematics with different h[k]. This closes the course loop: time-domain h and frequency-domain H are two views of every system you have met.',
};
