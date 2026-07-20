# Architecture

## Design goals

1. **Deterministic DSP, everywhere.** The same block runner (`GraphRunner`) executes in
   the live engine, the capture worker and the test suite. Capture mode with a fixed
   seed produces bit-identical buffers, which is what makes challenge grading and the
   automated tests trustworthy.
2. **No DSP in React.** Components read signals through three narrow functions
   (`getSignalWindow`, `getFullSignal`, engine stores) and draw with the shared plotting
   kit. Everything numeric lives in `src/engine`, `src/viz` (pure drawing) and
   `src/explain` (pure rules).
3. **Fail soft.** Invalid params render silence with a visible per-node error LED;
   NaN/Infinity are scrubbed at block boundaries; audio underruns produce silence, not
   crashes; imports never throw — they return errors and warnings.

## System map

```
src/
  model/        types.ts (core types, LIMITS)  schema.ts (zod, versioning, migration)
  engine/
    dsp/        fft.ts  biquad.ts  measurements.ts  rng.ts
    expr/       expression.ts (sandboxed Pratt parser → closures)
    nodes/      sources.ts  processors.ts  analyzers.ts  helpers.ts
    graph.ts    connection rules, cycle detection, deterministic topo order
    registry.ts node type registry
    runner.ts   GraphRunner — block-based deterministic executor
    capture.ts  finite renders (pure, worker-friendly)
    live.ts     LiveEngine — real-time scheduler + per-node ring buffers
  audio/        audioEngine.ts — AudioContext lifecycle, worklet sink, limiter chain
  workers/      captureWorker.ts
  viz/          plot.ts — canvas drawing kit (scope/spectrum/spectrogram/axes)
  explain/      explain.ts — deterministic explanation rules
  learn/        types.ts  lessons1/2.ts  challenges.ts  gradeRunner.ts
  state/        projectStore (graph + undo/redo)  uiStore  learnStore  persist  engines
  export/       exporters (wav/csv/png)  share.ts  report.ts  appExports.ts
  components/   canvas/  inspector/  transport/  library/  learn/  dialogs/  controls/
  styles/       tokens / base / controls / node / panels / learn (retro-lab system)
```

## The execution model

- Audio-style **block processing**, block size 128 samples.
- Each node type is a `NodeDef`: typed ports, typed params (with units/ranges/scales),
  optional `createState`, a `process(ctx, inputs, outputs, params, state)` function,
  optional `validate` and a `math` document.
- `GraphRunner` orders nodes with a **stable topological sort** (lexicographic
  tie-break) over non-deferred edges, so evaluation order — and therefore output — is
  reproducible regardless of insertion order.
- **Feedback**: input ports may be marked `deferred`. Deferred edges read the upstream
  node's *previous block* and are excluded from cycle detection. The only deferred port
  in the release is the Feedback Delay's "Loop In", guaranteeing ≥ one block (2.7 ms at
  48 kHz) of delay around any loop. Instantaneous cycles are refused at connection time
  with an explanation, and graphs that contain them anyway (e.g. hand-edited imports)
  render the cycle members as silence with a status-bar warning.
- **Determinism and noise**: every node gets its own `mulberry32` RNG. In capture mode
  the stream is seeded from `hash(nodeId) ⊕ f(captureSeed, seedParam)`; in live mode it
  is time-seeded. Phase accumulators (oscillators) advance block-sequentially, so
  captures are exactly repeatable.

## Live vs capture

| | Live | Capture |
| --- | --- | --- |
| Driver | `LiveEngine` timer (25 ms) on the main thread, rendering slightly ahead of a wall/audio clock | `captureWorker` renders the full duration off-thread |
| Data | Per-node ring buffers (32k samples) read by analyzers at ~15 fps | Full per-node buffers (duration × rate, capped) transferred back |
| Noise | Free-running | Seeded, repeatable |
| Used for | Audible playback, knob-twiddling, oscilloscope observation | Grading, WAV/CSV export, precise FFT work, reports |

Blocks are cheap (a 30-node graph renders far faster than real time; the status bar
shows engine load), so live rendering stays on the main thread while all *finite* heavy
work happens in the worker. If the tab is hidden and timers are throttled, the engine
clamps catch-up to ~1 s and the audio ring simply re-buffers.

## Audio path

```
LiveEngine blocks ──postMessage──▶ AudioWorklet ring buffer (1 s capacity, 90 ms prebuffer)
     ──▶ master GainNode (default 0.25, smoothed) ──▶ DynamicsCompressor (limiter)
     ──▶ WaveShaper hard clip ±1 ──▶ destination
```

- The AudioContext is created only inside the Play click handler (explicit gesture).
- The worklet is shipped as an inline Blob module — no bundler worklet-URL fragility,
  works from any base path.
- Underruns silence gracefully and re-buffer; the engine reports them.
- `AudioContext({sampleRate})` is requested; Safari fallback uses the device rate.
- Mute/pause suspend the context; visual simulation continues regardless.

## State

- `projectStore` (zustand): the project graph is the single source of truth; React Flow
  nodes/edges are derived views. All mutations flow through store actions which push
  undo history (up to 100 entries; knob drags coalesce into one entry via
  `commitParamHistory` at gesture start).
- `uiStore`: app mode, transport, capture status/seed/duration, toasts, dialogs. Large
  capture buffers live *outside* zustand (module-level holder) with a revision counter
  for invalidation.
- `learnStore`: lesson/challenge progress, persisted via zustand/persist.
- `engines.ts` wires stores to the singleton `LiveEngine`/`AudioEngine` and owns the
  capture worker client.

## Persistence

- Autosave (debounced 800 ms) to `localStorage` under `spp.project.<id>` with an index.
- Export wraps the project in `{format, appVersion, project}`; import accepts both the
  wrapper and bare projects, validates with zod, migrates old versions
  (`MIGRATIONS` map), strips unknown node types with warnings, clamps out-of-range
  params, and refuses future versions with a clear message.
- Share URLs: `#p=<lz-string compressed JSON>`; links longer than ~8 kB are refused
  with advice to use file export instead. Loading a share link clones to a new id.

## Grading pipeline

`gradeChallenge` → verify fixed equipment exists → force fixed params back onto the
graph → seeded capture (worker in the app, direct call in tests) → challenge-specific
`grade(ctx)` evaluates numeric criteria against the buffers → score breakdown.
Grading measures the signal *arriving at* the Audio Output so the output trim knob does
not affect results. See docs/CHALLENGE_GRADING.md.

## Notable decisions

- **React Flow (@xyflow/react)** for the canvas: mature interaction model (drag,
  multi-select, handles) while all validation and state stay in our code.
- **Hand-written FFT/biquads** instead of a DSP dependency: tiny, testable against
  closed-form expectations, identical across worker/main/test contexts.
- **Uniform partitioned FFT convolution** (overlap-save, FFT = 2×block): exact
  convolution with zero added latency at ~40 MFLOP/s for a 1 s IR — comfortably real
  time, unlike naive time-domain convolution which would not be.
- **Expression source** uses a hand-written tokenizer/Pratt parser compiled to nested
  closures. No `eval`/`Function`; identifiers resolve only through own-property lookups
  (a `constructor`-style prototype escape is explicitly tested against).
- **Inline worklet via Blob URL**: avoids cross-bundler worklet packaging issues and
  base-path problems; the worklet is ~60 lines.
