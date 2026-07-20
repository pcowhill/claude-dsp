# Signal Processing Playground — Implementation Plan

Status legend: `[ ]` todo · `[x]` done · `[~]` in progress

## Product summary

A fully client-side, desktop-focused educational laboratory for digital signal processing.
Users patch together signal chains on a node canvas, listen to them safely, inspect them
with oscilloscope / spectrum / spectrogram / statistics instruments, follow ten guided
lessons, solve eight measurable challenges, and export their experiments.

## Milestones

### Milestone 1 — Foundation

- [x] Vite + React + TypeScript scaffold with configurable base path
- [x] Development tooling: ESLint (flat config), Prettier, Vitest, Playwright, strict TS
- [ ] Retro-modern instrument visual system (CSS variables, panel components, knobs, switches)
- [ ] Node canvas via @xyflow/react with custom node chrome
- [ ] Node registry with typed definitions (ports, params, docs, math)
- [ ] Project/graph model with zod schemas and schema versioning
- [ ] Connection validation (port kinds, single-cable inputs, cycle blocking with feedback exception)
- [ ] Inspector framework (exact numeric entry, units, ranges, validation, reset, math panel)
- [ ] Undo/redo history for graph edits
- [ ] LocalStorage persistence + named projects + example starter project

### Milestone 2 — DSP engine

- [ ] Block-based deterministic execution engine (topological order, feedback-delayed edges)
- [ ] All 12 source nodes (sine, square, triangle, saw, white/pink noise, impulse, step,
      dual-tone, multi-tone, sample player, expression)
- [ ] Sandboxed expression parser/compiler (no eval; Pratt parser → closure)
- [ ] All processing nodes (gain, offset, mixer, delay, clip, saturate, quantize, bitcrush,
      sample-rate conversion, LP/HP/BP/BS biquads, moving average, AM, FM, convolution,
      feedback delay)
- [ ] Deterministic seeded noise (mulberry32) for capture mode
- [ ] Live engine (main-thread scheduler, ring buffers for analyzers)
- [ ] Capture engine in a Web Worker (finite renders, transferable buffers)
- [ ] Signal metadata propagation (sample rate, source kind, nominal frequency)
- [ ] Safety limits (buffer caps, FFT caps, param clamping with user-visible validation)
- [ ] Core DSP unit tests with numerical tolerances

### Milestone 3 — Visualization & audio

- [ ] Canvas plotting kit (grid, traces, cursors) in instrument style
- [ ] Oscilloscope node UI (time/amplitude scale, zoom, trigger, cursors, measurements, freeze)
- [ ] Spectrum analyzer (FFT size, window select, lin/log axes, dB, peak markers, cursor)
- [ ] Spectrogram (window size, overlap, colormap legend, cursors)
- [ ] Statistics meter (mean, min/max, RMS, crest, dominant freq, SNR est., clipping %, ZCR)
- [ ] Before/after comparison for any selected processing node
- [ ] Web Audio playback: worklet ring-buffer sink, limiter chain, volume, mute
- [ ] Explicit-gesture start, conservative default volume, suspension handling
- [ ] Deterministic "Explain This Signal" panel (measured facts vs heuristics vs suggestions)

### Milestone 4 — Learning experience

- [ ] Lesson engine (steps, prediction checkpoints, completion conditions, progress store)
- [ ] Ten lessons (waveform, combining, sampling/aliasing, spectrum, noise/SNR, filtering,
      clipping/quantization, AM, FM, convolution)
- [ ] Challenge engine (deterministic inputs, measurable grading, tiered hints, scoring)
- [ ] Eight challenges (noisy tone, aliasing, clipping, hidden tones, hum removal,
      damaged signal, AM decode, mystery system)
- [ ] Layered math ("Math Behind It" with KaTeX, live parameter substitution)
- [ ] Grading covered by automated tests (reference solutions verified)

### Milestone 5 — Export, polish & validation

- [ ] WAV export (16-bit PCM), CSV export
- [ ] Analyzer PNG export, signal-chain diagram PNG export
- [ ] Versioned JSON project export/import with zod validation and helpful errors
- [ ] Share URLs (lz-string compressed) with size warnings
- [ ] Experiment report (self-contained HTML, printable)
- [ ] Accessibility pass (keyboard nav, focus states, labels, reduced motion, non-color cues)
- [ ] Performance pass (workers, throttling, buffer reuse, capped sizes)
- [ ] Full validation suite green (typecheck, lint, unit, integration, Playwright)
- [ ] Final screenshots, README, deployment docs

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Audio thread starvation from main-thread jank | Worklet ring buffer with ~370 ms of pre-buffer; graceful underrun (silence, no crash) |
| Unbounded computations freeze UI | Capture length, FFT size, spectrogram size and convolution length are hard-capped; captures run in a worker |
| Feedback loops explode | Cycles only legal through the Feedback Delay node's feedback port (one-block delay); soft-clip inside the loop |
| Expression source abuse | Hand-written parser, whitelisted functions, no eval, evaluation step limits |
| Share URLs too large | Warn above ~8 kB encoded; suggest JSON file export |
| Browser audio differences | Feature-detect worklets; visual simulation runs without audio; Safari-specific resume handling |

## Acceptance criteria

Captured per milestone above; final bar: all required nodes/lessons/challenges/exports
implemented and interactively verified in a real browser with screenshots, no critical
console errors, `npm run validate` green.
