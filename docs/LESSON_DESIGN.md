# Lesson Design

## Pedagogy

Every lesson follows the same loop, chosen to force *active* engagement rather than
reading:

1. **Concise explanation** — 2–3 short paragraphs on a prepared bench (the lesson opens
   its own project; nothing needs to be built before learning starts).
2. **A concrete manipulation** — a highlighted "Try it" instruction naming the exact
   control to move.
3. **Prediction checkpoint** — before the interesting manipulation, a multiple-choice
   prediction. Predictions are the core of the design: committing to an expectation and
   then seeing the bench confirm or refute it is what converts observation into
   understanding. The reveal explains *why*, whether or not the answer was right.
4. **Measurable completion condition** — "Checkpoint" goals evaluated live against the
   running engine (parameter values and/or measured signal statistics), with a live
   readout of the measured value. The Continue button unlocks only when goals are met,
   so a lesson cannot be page-turned without touching the bench.
5. **Expandable mathematics** — a "Math behind it" disclosure per step (KaTeX), never
   forced on the reader.
6. **Closing explanation** — what happened, in one paragraph, marking completion.

Progress (step, predictions, completion) persists locally per lesson.

## Course arc

| # | Lesson | Core idea | Key measurable goals |
| --- | --- | --- | --- |
| 1 | Reading a Waveform | amplitude/frequency/phase/period/DC | RMS follows amplitude; meter tracks knob; DC shows as mean |
| 2 | Combining Signals | superposition | peak doubles in phase; RMS < 0.02 at 180°; beat spacing 2–12 Hz; 3:2 interval |
| 3 | Sampling & Aliasing | Nyquist, folding | staircase; alias measured at 8 k−f; AA filter kills the impostor |
| 4 | Understanding the Spectrum | FFT, resolution, leakage, axes | Δf vs N; window comparison; axis switching |
| 5 | Noise & SNR | white/pink, RMS, SNR | SNR falls 6 dB per noise doubling; pink tilt; capture determinism |
| 6 | Filtering Fundamentals | LP/HP/BP/notch, Q | cutoff sweep below 500 Hz; Q ≥ 5 resonance; swap filter families |
| 7 | Clipping & Quantization | headroom vs resolution | odd harmonics at threshold ≤ 0.6; ≤ 6 bits noise floor; restore clean path |
| 8 | Amplitude Modulation | carrier, sidebands, depth | sidebands track f_m; overmodulation ≥ 1.0; DSB-SC carrier suppression |
| 9 | Frequency Modulation | instantaneous frequency, β | deviation ≥ 300 Hz sweep; audio-rate comb; spectrogram window trade-off |
| 10 | Convolution & Impulse Response | h[n] defines the system | echo pattern; source swap; room IRs; smoothing = filtering |

The sequence is deliberately cumulative: 1–2 build time-domain intuition, 3–4 introduce
the discrete/frequency views, 5–7 cover the practical impairments, 8–9 use everything
for modulation, and 10 closes the loop by unifying filtering/echo/reverb under
convolution — referencing the moving average from lesson 6 and the impulse from
lesson 3.

## Robustness rules for goal checks

- Checks reference the lesson's known node ids but fail gracefully (goal simply unmet)
  if the user deletes a node; `nodeOfType` is used when the lesson asks the user to
  *add* something new.
- Signal-based checks read the same `getSignalWindow` path the instruments use, so live
  and capture mode both satisfy them.
- Tolerances are physical, not pixel-ish: e.g. beating accepts 2–12 Hz spacing;
  cancellation accepts RMS < 0.02 rather than exact zero.
- `tests/integration/app.test.ts` runs every goal check against a rendered capture of
  the fresh lesson bench (must not crash, must not be trivially met) and verifies the
  teaching-critical goals flip when the taught manipulation is applied (lessons 1–3).
