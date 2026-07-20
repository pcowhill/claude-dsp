# DSP Notes — algorithms, fidelity and honest limitations

This document records exactly what the engine computes, where it is exact, and where it
deliberately simplifies for clarity or performance. The playground is an educational
tool; nothing here claims laboratory-grade calibration.

## Engine fundamentals

- Mono signals, `Float32Array` blocks of 128 samples, engine rates 1–96 kHz
  (project UI offers 8/16/22.05/44.1/48 kHz).
- Deterministic evaluation order (stable topological sort). Feedback loops only via a
  one-block-deferred port; loop gain capped at 0.95 with a soft safety clip inside the
  loop, so runaway growth is impossible.
- Non-finite samples (NaN/±∞) are replaced with 0 at node boundaries.

## Sources

| Node | Method | Notes |
| --- | --- | --- |
| Sine / Dual / Multi | Phase-accumulator `sin` | Click-free under live frequency changes; phase parameter in degrees |
| Square / Triangle / Saw | **Naive geometric shapes** | *Intentionally not band-limited*: harmonics above Nyquist alias. This is used by Lesson 3/4 to make aliasing visible. A production synth would use polyBLEP/BLIT |
| White noise | mulberry32 uniform in ±A | RMS = A/√3; seeded & repeatable in capture mode |
| Pink noise | Paul Kellet 7-pole filter | ±0.5 dB of true 1/f across the audio band — an approximation, stated in the node's math panel |
| Impulse / Step | Exact sample placement | Impulse train available for IR demonstrations |
| Sample player | Synthesized clips (Karplus–Strong pluck, swept drum, linear chirp) | Deterministic, no external audio assets |
| Expression | Sandboxed parser → closures | Whitelisted functions only, 500-char limit, non-finite results → 0 |

## Processors

- **Gain / DC offset / Mixer / Clip / Saturate (tanh) / Quantizer / Bit depth** —
  textbook sample-wise definitions, exact.
- **Delay** — integer-sample delay line (no interpolation; sub-sample delay is out of
  scope and stated here).
- **Filters (LP/HP/BP/notch)** — RBJ Audio-EQ-Cookbook biquads. These are exact
  2nd-order IIR digital filters (−12 dB/oct for LP/HP). Steeper slopes require
  cascading; the resampler's anti-alias stage cascades two. Coefficients are recomputed
  when params change; state is preserved (click-free), denormals flushed.
- **Moving average** — running-sum FIR with periodic recomputation to cancel float
  drift; response is the Dirichlet kernel with nulls at multiples of fs/N.
- **Resampler** — *simulates* sample-rate conversion at the engine rate: optional
  2×biquad low-pass at 0.45·target ("anti-alias"), then fractional-ratio zero-order
  hold. It demonstrates aliasing and staircase reconstruction faithfully, but a real
  converter would use a long polyphase FIR; the AA filter here leaks a small residual
  (~-16 dB for a tone 40 % above cutoff), which the aliasing challenge exploits
  deliberately.
- **AM** — `(1 + m·x)·cos` (or `m·x·cos` in DSB-SC mode) with an internal
  phase-accumulated carrier.
- **FM** — true phase integration: `phase += (fc + Δf·x)/fs`, instantaneous frequency
  clamped to [0, 0.49·fs].
- **Convolution** — uniform partitioned overlap-save FFT convolution (partition = one
  block, FFT = 256). Mathematically exact (float64 spectra), no added latency. IRs are
  synthesized: sparse echoes (0.28 s / 0.85 s), exponentially decaying noise rooms
  (0.18 s / 0.9 s, energy-normalized), and a 33-tap Hann smoothing kernel, capped ≤ 1 s
  to bound CPU.
- **Feedback delay** — `y[n] = x[n] + g·y[n−D]`, g ≤ 0.95, soft-clipped above |1.5|.

## Analysis

- **FFT** — iterative radix-2 Cooley–Tukey in float64. Verified against closed-form
  sines and by forward+inverse round-trip (error < 1e-9). Sizes 256–16384 (hard cap).
- **Windows** — rectangular, Hann, Hamming, Blackman; amplitude spectra are corrected
  by the window's coherent gain so a full-scale sine reads ≈ 1.0.
- **Dominant frequency** — largest non-DC bin refined by parabolic interpolation
  (sub-bin accuracy, typically < 1 Hz error at 4096+ points).
- **Spectrogram** — STFT with configurable window/overlap, magnitudes in dB, output
  capped to ~600 frames per computation (decimated for display) to bound memory.
- **SNR estimate** — dominant peak ±3 bins vs. everything else, from an 8192-point Hann
  spectrum. This is a *heuristic*, meaningful for tone-plus-noise scenarios, and is
  labelled "estimated" wherever displayed. Grading uses it only where the scenario
  matches (a single calibration tone in broadband noise).
- **THD estimate** — harmonic peak amplitudes (±2 bins) over the fundamental, first
  five harmonics.
- **Grading measures** — reference-based SNR, RMS error, zero-lag and max-lag
  normalized correlation, spectral cosine similarity, band RMS via spectrum
  integration. All tested with justified tolerances in `tests/`.

## Numerical honesty in the UI

- The statistics meter marks SNR as an estimate; the Explain panel tags every statement
  as **measured**, **heuristic** or **tip**.
- Node math panels state their simplifications (naive waveforms, Kellet pink noise,
  2nd-order-only filters, simulated resampling).
- The experiment report footer repeats that measurements are estimates, not calibrated
  laboratory values.

## Performance envelope

Representative worst case (30 nodes, several analyzers, convolution + feedback) renders
at well under 10 % of real time on a typical desktop (the status bar shows live load).
Hard caps: capture ≤ 10 s and ≤ 16 M total samples across nodes, FFT ≤ 16384,
delay lines ≤ 2 s, IRs ≤ 1 s, ≤ 64 nodes, expression length ≤ 500 chars. Captures run
in a worker; spectrogram frames are decimated; analyzer canvases redraw at ≤ 15 fps.
