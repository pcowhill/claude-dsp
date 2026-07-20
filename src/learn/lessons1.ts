/** Lessons 1–5: waveforms, superposition, sampling, spectrum, noise & SNR. */

import type { Lesson } from './types';
import { ln, le, lproject, fmtHz } from './lessonUtils';

export const lesson1: Lesson = {
  id: 'lesson-waveform',
  index: 1,
  title: 'Reading a Waveform',
  summary: 'Amplitude, frequency, phase, period and DC offset — the anatomy of the simplest signal.',
  minutes: 8,
  build: () =>
    lproject('lesson-waveform', 'Lesson 1 · Reading a Waveform', [
      ln('sine', 'src.sine', 60, 160, { freq: 440, amp: 0.5 }),
      ln('scope', 'ana.scope', 340, 140, { timeWindow: 10 }),
      ln('stats', 'ana.stats', 720, 140),
      ln('out', 'out.audio', 1060, 160),
    ], [le('sine', 'scope'), le('scope', 'stats'), le('stats', 'out')]),
  steps: [
    {
      id: 'intro',
      title: 'The bench in front of you',
      body: [
        'A **Sine Wave** module feeds an **Oscilloscope**, a **Statistics Meter** and finally the **Audio Output**. The oscilloscope draws voltage against time — the most direct way to look at any signal.',
        'Press **Play** in the transport bar. You should see a steady wave on the scope and hear a clean tone (audio starts quietly — raise the master volume if needed).',
      ],
      action: 'Press Play, then select the Sine Wave node so its knobs and inspector appear.',
      goals: [
        {
          id: 'play',
          description: 'Transport is playing',
          check: (ctx) => ({ met: ctx.playing }),
        },
      ],
    },
    {
      id: 'amplitude',
      title: 'Amplitude — how tall',
      body: [
        'Amplitude is the peak height of the wave. It maps to how loud the tone sounds and how far a real loudspeaker cone would travel.',
        'The Statistics Meter reads two related values: **Peak** (the tallest sample) and **RMS** (the average power). For a sine, RMS = peak ÷ √2 ≈ 0.707 × peak.',
      ],
      action: 'Drag the Amplitude knob on the Sine Wave and watch peak and RMS follow on the meter.',
      prediction: {
        id: 'p-amp',
        question: 'If you set amplitude to 0.8, what will the RMS read?',
        options: ['0.80', '≈ 0.57', '0.40', '≈ 1.13'],
        correct: 1,
        reveal: 'RMS of a sine is A/√2 = 0.8 × 0.707 ≈ 0.57. Peak measures the extreme; RMS measures average power, which is what loudness follows.',
      },
      goals: [
        {
          id: 'amp-change',
          description: 'Set amplitude to 0.8 or higher',
          check: (ctx) => {
            const a = Number(ctx.param('sine', 'amp') ?? 0);
            return { met: a >= 0.8, value: a.toFixed(2) };
          },
        },
      ],
      math: {
        title: 'Amplitude and RMS',
        equations: ['x(t) = A\\sin(2\\pi f t)', 'x_{RMS} = \\frac{A}{\\sqrt{2}}'],
        symbols: { A: 'peak amplitude', 'x_{RMS}': 'root-mean-square value' },
        interpretation:
          'RMS is the DC level that would deliver the same power. Meters, loudness standards and SNR all use RMS rather than peak.',
      },
    },
    {
      id: 'frequency',
      title: 'Frequency and period — how fast',
      body: [
        'Frequency f counts cycles per second (hertz). Its inverse, the **period** T = 1/f, is how long one cycle takes.',
        'At 440 Hz, one period is 2.27 ms — count the cycles on the 10 ms scope screen: you should fit about 4.4 of them.',
      ],
      action: 'Sweep Frequency from 110 Hz to 1760 Hz and listen: every doubling is one octave.',
      prediction: {
        id: 'p-freq',
        question: 'You raise the frequency from 440 Hz to 880 Hz. What happens on the scope?',
        options: [
          'The wave gets taller',
          'Twice as many cycles fit on screen',
          'Half as many cycles fit on screen',
          'Nothing visible changes',
        ],
        correct: 1,
        reveal: 'Doubling f halves the period, so twice as many cycles fit in the same 10 ms window. Height (amplitude) is unrelated to frequency.',
      },
      goals: [
        {
          id: 'freq-high',
          description: 'Take frequency above 800 Hz',
          check: (ctx) => {
            const f = Number(ctx.param('sine', 'freq') ?? 0);
            return { met: f > 800, value: fmtHz(f) };
          },
        },
        {
          id: 'freq-meter',
          description: 'Meter dominant frequency follows your knob',
          check: (ctx) => {
            const st = ctx.stats('sine');
            const f = Number(ctx.param('sine', 'freq') ?? 0);
            if (!st) return { met: false };
            return {
              met: Math.abs(st.dominantFreq - f) < Math.max(20, f * 0.05),
              value: fmtHz(st.dominantFreq),
            };
          },
        },
      ],
    },
    {
      id: 'phase-dc',
      title: 'Phase and DC offset',
      body: [
        '**Phase** shifts where in its cycle the wave starts — on its own it is inaudible, but it decides how waves add together (the next lesson exploits this).',
        '**DC offset** adds a constant, shifting the whole trace up or down. It carries no sound; the meter exposes it as a non-zero **Mean**.',
      ],
      action: 'Set DC Offset to 0.3 and watch the trace and the Mean statistic rise; the tone itself does not change.',
      goals: [
        {
          id: 'dc',
          description: 'Set a DC offset of at least +0.2',
          check: (ctx) => {
            const st = ctx.stats('sine');
            return { met: (st?.mean ?? 0) > 0.2, value: (st?.mean ?? 0).toFixed(2) };
          },
        },
      ],
    },
    {
      id: 'wrap',
      title: 'Trigger & measure',
      body: [
        'Real oscilloscopes hold repeating waves still using a **trigger**: each sweep starts when the signal crosses a level. Select the Oscilloscope and try trigger modes — Free-run lets the wave drift; Rising edge locks it.',
        'Reset the DC offset to 0 to finish with a clean signal.',
      ],
      action: 'Return DC Offset to 0 (double-click the knob to reset).',
      goals: [
        {
          id: 'clean',
          description: 'DC offset back to ~0',
          check: (ctx) => {
            const st = ctx.stats('sine');
            return { met: Math.abs(st?.mean ?? 1) < 0.05, value: (st?.mean ?? 0).toFixed(2) };
          },
        },
      ],
    },
  ],
  closing:
    'You can now read the four numbers that define any sinusoid: amplitude (height ↔ loudness), frequency (cycles/s ↔ pitch), phase (start position) and DC offset (mean). Every signal you will meet from here is built from these.',
};

export const lesson2: Lesson = {
  id: 'lesson-combining',
  index: 2,
  title: 'Combining Signals',
  summary: 'Superposition: constructive & destructive interference, beating, and phase cancellation.',
  minutes: 10,
  build: () =>
    lproject('lesson-combining', 'Lesson 2 · Combining Signals', [
      ln('sineA', 'src.sine', 60, 90, { freq: 440, amp: 0.4 }),
      ln('sineB', 'src.sine', 60, 300, { freq: 440, amp: 0.4, phase: 0 }),
      ln('mix', 'proc.mixer', 330, 190),
      ln('scope', 'ana.scope', 560, 170, { timeWindow: 20 }),
      ln('stats', 'ana.stats', 930, 170),
      ln('out', 'out.audio', 1270, 190),
    ], [
      le('sineA', 'mix', 'in1'),
      le('sineB', 'mix', 'in2'),
      le('mix', 'scope'),
      le('scope', 'stats'),
      le('stats', 'out'),
    ]),
  steps: [
    {
      id: 'super',
      title: 'Adding waves',
      body: [
        'Two identical 440 Hz sines feed a **Mixer**, which adds them sample by sample. Addition is all that happens when sounds share the same air.',
        'Press Play. Both sines are in phase, so their peaks line up: the sum has **double** the amplitude (+6 dB). This is **constructive interference**.',
      ],
      action: 'Play, select the mixer, and confirm peak ≈ 0.8 on the meter (0.4 + 0.4).',
      goals: [
        {
          id: 'constructive',
          description: 'Mixed peak ≈ 0.8 (constructive)',
          check: (ctx) => {
            const st = ctx.stats('mix');
            return { met: (st?.peak ?? 0) > 0.7, value: (st?.peak ?? 0).toFixed(2) };
          },
        },
      ],
      math: {
        title: 'Superposition',
        equations: ['y(t) = x_1(t) + x_2(t)'],
        symbols: { 'x_1, x_2': 'the two input signals', y: 'the mixed output' },
        interpretation:
          'Linear systems add. Everything in this lesson — reinforcement, cancellation, beating — is just this one equation with different phases and frequencies.',
      },
    },
    {
      id: 'cancel',
      title: 'Phase cancellation',
      prediction: {
        id: 'p-cancel',
        question: 'Set the second sine to 180° phase. What will the mixer output?',
        options: [
          'The same tone, twice as loud',
          'The same tone, unchanged',
          'Almost exact silence',
          'A tone at 880 Hz',
        ],
        correct: 2,
        reveal:
          'At 180°, every peak of one wave meets an equal-and-opposite trough of the other: 0.4 + (−0.4) = 0 at every instant. This is destructive interference — the principle behind noise-cancelling headphones.',
      },
      body: [
        'Select the second sine (**sineB**) and drag its Phase slider to 180°.',
        'Watch the scope collapse toward a flat line and the RMS drop near zero, even though both sources are still running at full amplitude.',
      ],
      action: 'Set sineB phase to 180° and observe the cancellation.',
      goals: [
        {
          id: 'destructive',
          description: 'Mixed RMS below 0.02 (cancellation)',
          check: (ctx) => {
            const st = ctx.stats('mix');
            return { met: (st?.rms ?? 1) < 0.02, value: (st?.rms ?? 0).toFixed(3) };
          },
        },
      ],
    },
    {
      id: 'beating',
      title: 'Beating — almost the same frequency',
      body: [
        'Return phase to 0°, then detune the second sine to **446 Hz** — 6 Hz away from the first.',
        'The two waves drift in and out of phase 6 times per second: the tone pulses at the **beat rate** |f₁ − f₂|. Musicians tune instruments by listening for beats slowing to zero.',
      ],
      action: 'Set sineB to 0° phase and 446 Hz; widen the scope Time Window to ~200 ms to see the beat envelope.',
      goals: [
        {
          id: 'beat',
          description: 'Frequencies ~6 Hz apart (beating)',
          check: (ctx) => {
            const f1 = Number(ctx.param('sineA', 'freq') ?? 0);
            const f2 = Number(ctx.param('sineB', 'freq') ?? 0);
            const d = Math.abs(f1 - f2);
            return { met: d >= 2 && d <= 12, value: `Δ ${d.toFixed(1)} Hz` };
          },
        },
      ],
      math: {
        title: 'Beat frequency',
        equations: [
          '\\sin(2\\pi f_1 t) + \\sin(2\\pi f_2 t) = 2\\cos\\!\\big(2\\pi\\tfrac{f_1-f_2}{2}t\\big)\\sin\\!\\big(2\\pi\\tfrac{f_1+f_2}{2}t\\big)',
        ],
        symbols: {
          '\\tfrac{f_1+f_2}{2}': 'the tone you hear (the average)',
          '|f_1-f_2|': 'the pulse rate of the loudness envelope',
        },
        interpretation:
          'A trigonometric identity turns the sum into a product: an average-frequency tone multiplied by a slow envelope. Your ear hears the envelope as beating.',
      },
    },
    {
      id: 'interval',
      title: 'Intervals and consonance',
      body: [
        'Now set the second sine to **660 Hz** — a 3:2 ratio with 440 Hz, the musical fifth. The beating disappears and the combined waveform settles into a stable repeating pattern.',
        'Simple frequency ratios repeat quickly and sound consonant; awkward ratios never quite line up and sound rough.',
      ],
      action: 'Set sineB to 660 Hz and shrink the Time Window back to ~20 ms to see the repeating composite shape.',
      goals: [
        {
          id: 'fifth',
          description: 'Set sineB near 660 Hz (a perfect fifth)',
          check: (ctx) => {
            const f2 = Number(ctx.param('sineB', 'freq') ?? 0);
            return { met: Math.abs(f2 - 660) < 8, value: fmtHz(f2) };
          },
        },
      ],
    },
  ],
  closing:
    'Signals combine by simple addition, yet that produces reinforcement (+6 dB), perfect silence (180° phase), beating (nearby frequencies) and musical harmony (simple ratios). Phase — invisible on a lone tone — becomes decisive the moment two signals meet.',
};

export const lesson3: Lesson = {
  id: 'lesson-sampling',
  index: 3,
  title: 'Sampling & Aliasing',
  summary: 'Sample rate, the Nyquist limit, and how frequencies fold into impostors.',
  minutes: 10,
  build: () =>
    lproject('lesson-sampling', 'Lesson 3 · Sampling & Aliasing', [
      ln('sine', 'src.sine', 60, 180, { freq: 1000, amp: 0.6 }),
      ln('resamp', 'proc.srconvert', 330, 180, { targetRate: 8000, antialias: false }),
      ln('scope', 'ana.scope', 590, 90, { timeWindow: 5 }),
      ln('spec', 'ana.spectrum', 590, 300, { fftSize: '4096', freqScale: 'linear' }),
      ln('out', 'out.audio', 950, 180),
    ], [le('sine', 'resamp'), le('resamp', 'scope'), le('scope', 'spec'), le('spec', 'out')]),
  steps: [
    {
      id: 'setup',
      title: 'A digital bottleneck',
      body: [
        'The **Resampler** simulates feeding the signal through a system that samples at only **8,000 Hz** (its anti-alias filter is switched OFF for now).',
        'A sampler can only describe frequencies up to **half** its rate — the **Nyquist limit**, here 4,000 Hz. Press Play: at 1 kHz everything passes cleanly; the spectrum shows one line at 1 kHz.',
      ],
      action: 'Play, and confirm a single spectral line at 1 kHz.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
      math: {
        title: 'The sampling theorem',
        equations: ['f_{Nyquist} = \\frac{f_s}{2}', 'f < f_{Nyquist} \\Rightarrow \\text{perfect reconstruction possible}'],
        symbols: { 'f_s': 'sample rate (here 8 kHz)', 'f_{Nyquist}': 'highest representable frequency (4 kHz)' },
        interpretation:
          'Shannon and Nyquist proved a band-limited signal is fully described by samples taken at more than twice its highest frequency. Break that condition and information is not lost — it is *misfiled*.',
      },
    },
    {
      id: 'staircase',
      title: 'Seeing the samples',
      body: [
        'Look closely at the scope: the resampled wave is a **staircase**. Each step is one held sample — 8,000 of them per second reconstructing the original 1 kHz curve with 8 steps per cycle.',
        'Raise the sine toward 3 kHz: fewer and fewer steps describe each cycle, and the staircase gets visibly cruder.',
      ],
      action: 'Sweep the sine frequency from 1 kHz to 3.5 kHz and watch the reconstruction coarsen.',
      goals: [
        {
          id: 'near',
          description: 'Push the tone above 3 kHz (approaching Nyquist)',
          check: (ctx) => {
            const f = Number(ctx.param('sine', 'freq') ?? 0);
            return { met: f > 3000, value: fmtHz(f) };
          },
        },
      ],
    },
    {
      id: 'alias',
      title: 'Crossing the line',
      prediction: {
        id: 'p-alias',
        question: 'The sampler runs at 8 kHz. If you set the sine to 5 kHz — above the 4 kHz limit — what will you hear and see?',
        options: [
          'Nothing: frequencies above Nyquist are removed',
          'A 5 kHz tone, unchanged',
          'A tone at 3 kHz that is not really there',
          'Pure noise',
        ],
        correct: 2,
        reveal:
          'The samples of a 5 kHz tone at 8 kHz are numerically identical to those of a 3 kHz tone: the frequency folds around Nyquist (8 − 5 = 3). The impostor is called an alias.',
      },
      body: [
        'Set the sine to **5,000 Hz**. The spectrum now shows a strong line at **3 kHz** — a frequency that does not exist in the source. As you sweep the source upward, the alias sweeps *downward*: the tell-tale signature of aliasing.',
      ],
      action: 'Set the sine to 5 kHz and find the alias at 3 kHz on the spectrum.',
      goals: [
        {
          id: 'aliased',
          description: 'Source above Nyquist (alias visible)',
          check: (ctx) => {
            const f = Number(ctx.param('sine', 'freq') ?? 0);
            const st = ctx.stats('resamp');
            const alias = Math.abs(8000 - f);
            const met = f > 4200 && !!st && Math.abs(st.dominantFreq - alias) < 300;
            return { met, value: st ? `dominant ${fmtHz(st.dominantFreq)}` : undefined };
          },
        },
      ],
    },
    {
      id: 'fix',
      title: 'The cure: filter before you sample',
      body: [
        'Enable the resampler’s **Anti-Alias Filter**. It low-passes the signal *before* the sampling step, removing anything above ~45% of the target rate.',
        'The alias disappears — along with the 5 kHz tone itself, which genuinely cannot survive an 8 kHz representation. That trade is fundamental: remove out-of-band content, or have it fold back as lies.',
      ],
      action: 'Toggle Anti-Alias Filter ON and watch the 3 kHz impostor vanish.',
      goals: [
        {
          id: 'filtered',
          description: 'Anti-alias ON, alias suppressed',
          check: (ctx) => {
            const on = ctx.param('resamp', 'antialias') === true;
            const st = ctx.stats('resamp');
            return { met: on && (st?.rms ?? 1) < 0.1, value: on ? 'filter on' : 'filter off' };
          },
        },
      ],
    },
  ],
  closing:
    'Digital audio is honest only below Nyquist (fs/2). Above it, frequencies fold back as aliases that sweep the wrong way and cannot be removed after the fact — which is why every real ADC filters first and why CD audio at 44.1 kHz can carry every audible frequency.',
};

export const lesson4: Lesson = {
  id: 'lesson-spectrum',
  index: 4,
  title: 'Understanding the Spectrum',
  summary: 'The FFT view: harmonics, windowing, spectral leakage and frequency resolution.',
  minutes: 12,
  build: () =>
    lproject('lesson-spectrum', 'Lesson 4 · Understanding the Spectrum', [
      ln('saw', 'src.sawtooth', 60, 180, { freq: 220, amp: 0.5 }),
      ln('spec', 'ana.spectrum', 330, 160, { fftSize: '4096', window: 'hann' }),
      ln('out', 'out.audio', 700, 180),
    ], [le('saw', 'spec'), le('spec', 'out')]),
  steps: [
    {
      id: 'lines',
      title: 'A tone is a comb of lines',
      body: [
        'Play the sawtooth and study the spectrum: a line at 220 Hz (the **fundamental**) and lines at every multiple — 440, 660, 880 Hz… the **harmonics**. Their strengths decay as 1/n.',
        'Your ear fuses this comb into a single bright note. Timbre — why a violin differs from a flute at the same pitch — is exactly this recipe of harmonic strengths.',
      ],
      action: 'Play, select the Spectrum Analyzer, and count the first few harmonics.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
      math: {
        title: 'The DFT',
        equations: ['X[k] = \\sum_{n=0}^{N-1} x[n] e^{-j2\\pi kn/N}', '\\Delta f = f_s / N'],
        symbols: {
          'X[k]': 'how much of frequency k·Δf the block contains',
          N: 'FFT size',
          '\\Delta f': 'bin spacing (resolution)',
        },
        interpretation:
          'The FFT correlates the signal with N reference sinusoids. It does not "detect" frequencies; it projects the signal onto them — which is why its resolution and window matter.',
      },
    },
    {
      id: 'resolution',
      title: 'Frequency resolution costs time',
      prediction: {
        id: 'p-res',
        question: 'At 48 kHz sample rate, FFT size 4096 gives bins of ~11.7 Hz. What does switching to 512 do?',
        options: [
          'Finer bins: ~1.5 Hz',
          'Coarser bins: ~94 Hz',
          'Same bins, faster update',
          'It changes the signal itself',
        ],
        correct: 1,
        reveal:
          'Δf = fs/N = 48000/512 ≈ 94 Hz. Small FFTs react faster in time but blur nearby frequencies together — the time–frequency trade-off.',
      },
      body: [
        'Switch the analyzer FFT Size between 512 and 8192 and watch the lines sharpen as N grows. Nothing about the signal changed — only how finely the analysis grid slices frequency.',
      ],
      action: 'Try FFT sizes 512 → 8192 on the spectrum node.',
      goals: [
        {
          id: 'bigfft',
          description: 'Use FFT size 8192',
          check: (ctx) => ({
            met: String(ctx.param(ctx.nodeOfType('ana.spectrum') ?? 'spec', 'fftSize')) === '8192',
          }),
        },
      ],
    },
    {
      id: 'leakage',
      title: 'Windows and leakage',
      body: [
        'The FFT silently assumes its block repeats forever. If a tone doesn’t complete a whole number of cycles in the block, the seam acts like a click and its energy **leaks** across many bins.',
        'Set the analyzer Window to **Rectangular**: skirts spread around each harmonic. **Hann** tapers the block edges to zero, trading a slightly wider peak for dramatically lower leakage — the everyday default.',
      ],
      action: 'Compare Rectangular vs Hann windows and watch the skirts around each line.',
      goals: [
        {
          id: 'window',
          description: 'Switch the window to Rectangular (then back if you like)',
          check: (ctx) => {
            const w = String(ctx.param(ctx.nodeOfType('ana.spectrum') ?? 'spec', 'window'));
            return { met: w === 'rectangular' || w === 'blackman', value: w };
          },
        },
      ],
      math: {
        title: 'Windowing',
        equations: ['x_w[n] = x[n] \\cdot w[n]'],
        symbols: { 'w[n]': 'window function (Hann, Hamming, Blackman…)' },
        interpretation:
          'Multiplying by a window in time convolves the spectrum with the window’s own transform. Tapered windows have low sidelobes (little leakage) at the cost of a wider main lobe (slightly blurrier peaks).',
      },
    },
    {
      id: 'axes',
      title: 'Choosing your axes',
      body: [
        'Switch the frequency axis between **Linear** (harmonics evenly spaced — good for overtone series) and **Logarithmic** (equal space per octave — matches pitch perception).',
        'The dB amplitude scale compresses an enormous range: −20 dB is 10× smaller in amplitude, −40 dB is 100×. Quiet detail that vanishes on a linear scale is obvious in dB.',
      ],
      action: 'Flip Freq Axis and Amp Axis settings and note what each view makes obvious.',
      goals: [
        {
          id: 'axes',
          description: 'Try the linear frequency axis',
          check: (ctx) => ({
            met: String(ctx.param(ctx.nodeOfType('ana.spectrum') ?? 'spec', 'freqScale')) === 'linear',
          }),
        },
      ],
    },
  ],
  closing:
    'The spectrum is a projection, not a photograph: FFT size sets the resolution grid, the window controls leakage, and the axes shape what your eye notices. Read all three settings before trusting any peak.',
};

export const lesson5: Lesson = {
  id: 'lesson-noise',
  index: 5,
  title: 'Noise & SNR',
  summary: 'White vs pink noise, RMS thinking, and measuring signal-to-noise ratio.',
  minutes: 10,
  build: () =>
    lproject('lesson-noise', 'Lesson 5 · Noise & SNR', [
      ln('sine', 'src.sine', 60, 100, { freq: 1000, amp: 0.4 }),
      ln('noise', 'src.whitenoise', 60, 300, { amp: 0.1, seed: 7 }),
      ln('mix', 'proc.mixer', 330, 200),
      ln('spec', 'ana.spectrum', 570, 100, { fftSize: '4096' }),
      ln('stats', 'ana.stats', 570, 320),
      ln('out', 'out.audio', 930, 200),
    ], [
      le('sine', 'mix', 'in1'),
      le('noise', 'mix', 'in2'),
      le('mix', 'spec'),
      le('mix', 'stats'),
      le('spec', 'out'),
    ]),
  steps: [
    {
      id: 'meet-noise',
      title: 'Signal meets noise',
      body: [
        'A clean 1 kHz tone is mixed with white noise. On the spectrum the tone is a narrow spike; the noise is a broad carpet spread across **every** frequency.',
        'That difference in shape — concentrated vs spread — is what makes the tone stand out even when the noise carries comparable total power.',
      ],
      action: 'Play and find the tone spike standing above the noise floor.',
      goals: [
        { id: 'play', description: 'Transport is playing', check: (ctx) => ({ met: ctx.playing }) },
      ],
    },
    {
      id: 'snr',
      title: 'Measuring SNR',
      body: [
        'The Statistics Meter estimates **SNR**: the power near the dominant spectral peak versus the power everywhere else, in decibels.',
        'Raise the noise amplitude and watch SNR fall; each doubling of noise amplitude costs about 6 dB.',
      ],
      action: 'Set noise amplitude to 0.2 and read the SNR estimate on the meter.',
      prediction: {
        id: 'p-snr',
        question: 'Noise amplitude doubles from 0.1 to 0.2 (tone unchanged). Roughly what happens to SNR?',
        options: ['Drops ~3 dB', 'Drops ~6 dB', 'Drops ~20 dB', 'Unchanged — SNR ignores noise level'],
        correct: 1,
        reveal:
          'SNR compares powers. Doubling noise amplitude quadruples noise power: 10·log₁₀(4) ≈ 6 dB. Amplitude ratios of 2 always mean 6 dB.',
      },
      goals: [
        {
          id: 'noisy',
          description: 'Noise amplitude at 0.2+, SNR visibly reduced',
          check: (ctx) => {
            const a = Number(ctx.param('noise', 'amp') ?? 0);
            const st = ctx.stats('mix');
            return {
              met: a >= 0.19,
              value: st?.snrEstimateDb != null ? `${st.snrEstimateDb.toFixed(1)} dB` : undefined,
            };
          },
        },
      ],
      math: {
        title: 'Signal-to-noise ratio',
        equations: ['\\text{SNR} = 10\\log_{10}\\!\\frac{P_{signal}}{P_{noise}}\\ \\text{dB}'],
        symbols: { 'P_{signal}': 'power of the wanted signal', 'P_{noise}': 'power of everything else' },
        interpretation:
          'Every 6 dB is a factor of 2 in amplitude; every 10 dB a factor of 10 in power. Clean speech needs roughly 20–30 dB; hi-fi listening far more.',
      },
    },
    {
      id: 'pink',
      title: 'White vs pink',
      body: [
        'Delete-free experiment: select the White Noise node and imagine its spectrum tilting. Now add a **Pink Noise** module (library → Sources) and wire it into mixer input 3, muting the white one (amplitude 0).',
        'On a log-frequency axis white noise *rises* toward the right (equal energy per Hz, and there are more Hz per octave up high); pink noise looks flat (equal energy per **octave**) — closer to rain, waterfalls and mixed music.',
      ],
      action: 'Add a Pink Noise node, connect it to the mixer, set White Noise amplitude to 0, and compare the floor’s tilt.',
      goals: [
        {
          id: 'pink-added',
          description: 'Pink Noise connected into the mix',
          check: (ctx) => {
            const pink = ctx.nodeOfType('src.pinknoise');
            if (!pink) return { met: false };
            const st = ctx.stats(pink);
            return { met: (st?.rms ?? 0) > 0.005, value: st ? `rms ${st.rms.toFixed(3)}` : undefined };
          },
        },
      ],
    },
    {
      id: 'seeds',
      title: 'Deterministic noise',
      body: [
        'Noise in this playground has a **Seed**. In live mode it free-runs, but in **Capture** mode the same seed always produces the exact same "random" samples.',
        'That is why lessons, challenges and exports are repeatable — switch the transport to Capture and run two captures; the waveforms match sample for sample.',
      ],
      action: 'Switch to Capture mode and press the capture button twice — results are identical for the same seed.',
      goals: [
        {
          id: 'capture',
          description: 'Run a capture',
          check: (ctx) => {
            // In capture mode the signal function serves capture buffers.
            const sig = ctx.signal('mix', 512);
            return { met: !ctx.playing && !!sig && sig.length >= 256 };
          },
        },
      ],
    },
  ],
  closing:
    'Noise is spread; signals are concentrated. RMS and dB let you compare their powers honestly, and the SNR number summarizes the contest. Next lesson: filters, the tool that tilts the contest in the signal’s favour.',
};
