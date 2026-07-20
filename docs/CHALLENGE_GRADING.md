# Challenge Grading

## Principles

1. **Grade outcomes, not topologies.** Every criterion is a numeric measurement of the
   signal arriving at the Audio Output (before its level trim). Any patch achieving the
   numbers passes; the test suite proves materially different solutions pass for
   challenges 1, 2, 3 and 5.
2. **Deterministic.** Grading renders a capture with a fixed per-challenge seed and
   fixed duration through the same engine as everything else, so a given graph always
   produces the same score (asserted by a determinism test).
3. **Un-cheatable fixed equipment.** Each challenge lists "fixed equipment" nodes.
   Before the grading capture runs, their parameters are forced back to the scenario
   values — muting the noise source or retuning the transmitter does not help (tested).
   Deleting fixed equipment yields an actionable failure message.
4. **Tiered hints** (3 per challenge, from concept to concrete numbers) are tracked but
   never reduce the score — the score reflects the solution, hints reflect the journey.
5. **Efficiency as bonus, never gate.** Node-count criteria award ≤ 10–20 points;
   overshooting the module budget still allows a pass with an otherwise strong solution.

## Score model

Each challenge defines parts that sum to 100 points; passing needs 70 (90 for the pure
measurement challenge #4). Parts score continuously (partial credit proportional to the
measurement) so the "live re-grade" option gives real-time progress toward the target.

## The eight challenges

| # | Challenge | Fixed equipment | Graded measurements (pass thresholds) |
| --- | --- | --- | --- |
| 1 | Rescue a Noisy Tone | 1 kHz tone (0.3), noise (0.25, seed 11), receiver mixer | SNR ≥ 15 dB (scored from the ~3 dB unfiltered baseline); tone amplitude ≥ 0.12 at 1 kHz; dominant = 1 kHz ± 30; ≤ 8 modules |
| 2 | Stop the Aliasing | 5 kHz source | phantom at 3 kHz < 0.03; true 5 kHz ≥ 0.3; spectrum otherwise clean. AA-filter-only "solutions" fail honestly (tone dies) |
| 3 | Prevent Clipping | source, +12 dB preamp, ±1.0 clipper | clipping < 0.1 %; THD < 5 %; RMS ≥ 0.25 (35 pts — over-attenuation fails); ≤ 7 modules |
| 4 | Find the Hidden Frequencies | multi-tone (620 / 1490 / 3170 Hz) | three answers within ±25 Hz (order-free matching), precision bonus at ±6 Hz |
| 5 | Remove an Unwanted Hum | pluck sample, 60 Hz hum, receiver | hum suppression ≥ 20 dB; ≥ 50 % band energy kept (150 Hz–6 kHz vs the clean source's own capture buffer); ≤ 8 modules |
| 6 | Reconstruct a Damaged Signal | tone, +0.45 DC stage, step-0.12 quantizer | |mean| < 0.03; RMS 0.28–0.75; lag-tolerant correlation ≥ 0.9 vs an analytic 330 Hz sine; residual distortion < 8 % |
| 7 | Decode an AM Transmission | expression source `(1+0.8·sin 400)·cos 8000` | dominant 400 ± 25 Hz; correlation ≥ 0.75 vs analytic message; carrier residue < 0.05; ≤ 8 modules |
| 8 | Match the Mystery System | impulse probe | echo-tail correlation ≥ 0.9 vs the hidden reference (feedback delay 180 ms / 0.45 / wet); tail energy ±3 dB; full-response correlation ≥ 0.9. Tail-based comparison prevents a bare wire from scoring on the direct impulse |

## Measurement toolbox

`src/engine/dsp/measurements.ts` provides the graded quantities: spectrum-based SNR
estimate, reference SNR, RMS error, zero-lag and max-lag normalized correlation,
spectral cosine similarity, band RMS (spectral integration), THD estimate, clipping
percentage and the standard statistics. Each has unit tests with justified tolerances.

## Verified solutions (tests/integration/challenges.test.ts)

- Every unsolved starting bench fails.
- Every challenge passes with at least one real solution graph.
- Challenges 1 (band-pass vs LP+HP pair), 2 (raise rate vs bypass link),
  3 (attenuate after vs before the preamp) and 5 (notch vs high-pass) pass with two
  materially different solutions each.
- Negative paths: cheating via fixed-param edits is neutralized; over-attenuation
  fails; wrong mystery delay fails; deleted fixed equipment produces the guidance
  message; grading is deterministic across runs.
