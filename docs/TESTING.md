# Testing

## How to run

```bash
npm test              # Vitest: unit + integration (tests/unit, tests/integration)
npm run test:e2e      # Playwright browser suite (tests/e2e) — starts its own dev server
npm run validate      # typecheck + lint + vitest + production build
```

The Playwright config auto-detects the container's preinstalled Chromium at
`/opt/pw-browsers/chromium` and falls back to Playwright-managed browsers elsewhere
(`npx playwright install chromium` locally if needed).

## Layers

### Unit (tests/unit — 81 tests)

- **dsp-core** — FFT correctness (tone detection, forward/inverse round-trip < 1e-9,
  window shapes, spectrogram energy placement), biquad responses vs closed-form
  magnitude (−3 dB at cutoff, slopes, notch depth), measurement suite (sine RMS/crest/
  ZCR, clipping %, reference SNR ranges, correlation identities), deterministic RNG.
- **expression** — precedence (incl. `-2^2 = -4`, right-assoc `^`), variables,
  functions, non-finite guarding, error messages with positions, and sandbox safety
  (`constructor`, `eval`, `window`… must throw — a prototype-chain escape was caught by
  exactly this test during development).
- **nodes** — every source and processor measured spectrally: square/triangle/saw
  harmonic ratios, seeded noise repeatability, pink-vs-white tilt, impulse/step timing,
  delay sample accuracy, clip harmonics, ~6 dB/bit quantization SNR, resampler aliasing
  with/without AA, filter behaviour in real chains, AM sidebands & DSB carrier
  suppression, FM sideband spreading, convolution vs direct reference and echo tap
  placement, feedback decay & boundedness, analyzer passthrough transparency.
- **graph** — connection rules (self, double-cable, unknown ports, instantaneous cycle
  refusal with explanations, legal feedback via deferred port), stable topological
  order, whole-graph validation, capture determinism per seed, branching/merging,
  cycle-degraded graphs still rendering, path labels.
- **schema** — export/import round trip, wrapper & bare forms, garbage rejection,
  future-version refusal, unknown-node stripping with warnings, param clamping,
  default filling, issue paths.

### Integration (tests/integration — 63 tests)

- **challenges** — see docs/CHALLENGE_GRADING.md: unsolved benches fail, ≥ 1 verified
  solution per challenge, multiple distinct solutions for four of them, anti-cheat,
  negative paths, determinism.
- **app** — lesson content integrity (10 lessons, ordering, predictions answerable,
  goals runnable on fresh benches and responsive to the taught manipulation), explain
  rules (clipping/DC/Nyquist/disconnection/infrasonic/measured-vs-heuristic tagging),
  WAV header/sample round-trip, CSV shape, share-URL round trip incl. corrupted-hash
  handling, full project JSON round trip equality.

### Browser (tests/e2e — 14 scenarios)

Onboarding; starter project live playback with advancing playhead and console-error
assertion; building a chain from an empty bench via library + handle-drag cabling;
invalid-connection refusal with visible explanation; inspector editing incl.
out-of-range validation; capture + WAV download; project JSON export→import round
trip; autosave across reload; share-URL open in a second page; undo/redo; **complete
lesson 1 end-to-end** (predictions, live goal gating, completion stamp); **complete
challenge 4 end-to-end** (correct answers → 100 pts PASSED) plus wrong-answer feedback;
and a full-tour console hygiene check.

Audio note: e2e runs in headless Chromium where the Web Audio graph runs against a
silent device; tests assert engine/transport behaviour and status reporting rather
than audible output. The real audio path (worklet, limiter, volume, suspension) was
exercised manually in headed Chromium during development.

## Conventions

- Numerical assertions use tolerances justified by the underlying math (e.g. harmonic
  ratios to 1 decimal, FFT round-trip to 1e-9, frequency estimates within a bin).
- Engine tests never touch React; browser tests never assert DSP numbers beyond what
  the UI displays. The capture engine is the shared deterministic substrate for both.
