/**
 * Engine singletons and the glue between stores and engines:
 *  - LiveEngine renders continuously and feeds analyzer ring buffers
 *  - AudioEngine plays the Audio Output node through the safety chain
 *  - The capture worker renders finite captures off-thread
 */

import { LiveEngine } from '@/engine/live';
import { AudioEngine } from '@/audio/audioEngine';
import type { CaptureResult } from '@/model/types';
import { useProjectStore } from './projectStore';
import { useUiStore, setCaptureResult, getCaptureResult } from './uiStore';

export const liveEngine = new LiveEngine();

export const audioEngine = new AudioEngine({
  onStatus: (status, detail) => {
    useUiStore.getState().setAudioStatus(status, detail ?? null);
    liveEngine.audioActive = status === 'running';
    if (status !== 'running') return;
  },
  onLimiterActive: (active) => {
    if (useUiStore.getState().limiterActive !== active) {
      useUiStore.getState().setLimiterActive(active);
    }
  },
});

liveEngine.onAudioBlock = (samples) => audioEngine.pushBlock(samples);

// Keep the live engine's graph in sync with the store.
let lastRevision = -1;
useProjectStore.subscribe((state) => {
  if (state.graphRevision !== lastRevision) {
    lastRevision = state.graphRevision;
    liveEngine.setGraph(state.project.graph, state.project.sampleRate);
  }
});

// Initial sync
liveEngine.setGraph(
  useProjectStore.getState().project.graph,
  useProjectStore.getState().project.sampleRate,
);

// UI refresh tick while the transport runs (analyzer canvases subscribe to it)
let tickTimer: number | null = null;

function syncTick(): void {
  const ui = useUiStore.getState();
  const shouldRun = ui.transport === 'playing';
  if (shouldRun && tickTimer === null) {
    tickTimer = window.setInterval(() => useUiStore.getState().bumpLiveTick(), 66);
  } else if (!shouldRun && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

useUiStore.subscribe(syncTick);

/* ---------------- Transport actions ---------------- */

export async function transportPlay(withAudio: boolean): Promise<void> {
  const ui = useUiStore.getState();
  const project = useProjectStore.getState().project;
  if (withAudio) {
    const ok = await audioEngine.start(project.sampleRate);
    if (ok) {
      audioEngine.setVolume(ui.masterVolume);
      audioEngine.setMuted(ui.muted);
      audioEngine.flush();
      liveEngine.audioActive = true;
    } else {
      liveEngine.audioActive = false;
      const detail = useUiStore.getState().audioDetail;
      if (detail) useUiStore.getState().toast('warn', detail);
    }
  }
  liveEngine.play();
  useUiStore.getState().setTransport('playing');
}

export async function transportPause(): Promise<void> {
  liveEngine.pause();
  await audioEngine.suspend();
  useUiStore.getState().setTransport('paused');
}

export async function transportStop(): Promise<void> {
  liveEngine.stop();
  audioEngine.flush();
  await audioEngine.suspend();
  useUiStore.getState().setTransport('stopped');
}

export async function transportRestart(): Promise<void> {
  audioEngine.flush();
  liveEngine.restart();
  useUiStore.getState().setTransport('playing');
}

/* ---------------- Capture ---------------- */

let captureWorker: Worker | null = null;
let captureRequestId = 0;

function getCaptureWorker(): Worker {
  if (!captureWorker) {
    captureWorker = new Worker(new URL('../workers/captureWorker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return captureWorker;
}

/** Run a capture off-thread and resolve with the result (used by grading). */
export function runCaptureAsync(request: {
  graph: import('@/model/types').ProjectGraph;
  sampleRate: number;
  duration: number;
  seed: number;
}): Promise<CaptureResult> {
  const requestId = ++captureRequestId;
  const worker = getCaptureWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (
      ev: MessageEvent<{ kind: string; requestId: number; result?: CaptureResult; error?: string }>,
    ) => {
      if (ev.data.requestId !== requestId) return;
      worker.removeEventListener('message', onMessage);
      if (ev.data.kind === 'capture-done' && ev.data.result) resolve(ev.data.result);
      else reject(new Error(ev.data.error ?? 'Capture failed'));
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ kind: 'capture', requestId, request });
  });
}

export function runCaptureNow(seedOverride?: number): void {
  const ui = useUiStore.getState();
  const project = useProjectStore.getState().project;
  if (project.graph.nodes.length === 0) {
    ui.toast('warn', 'Nothing to capture — the canvas is empty.');
    return;
  }
  const seed = seedOverride ?? ui.captureSeed;
  const requestId = ++captureRequestId;
  ui.setCaptureStatus('running');
  const worker = getCaptureWorker();
  const onMessage = (
    ev: MessageEvent<{
      kind: string;
      requestId: number;
      result?: CaptureResult;
      error?: string;
    }>,
  ) => {
    const msg = ev.data;
    if (msg.requestId !== requestId) return;
    worker.removeEventListener('message', onMessage);
    const uiNow = useUiStore.getState();
    if (msg.kind === 'capture-done' && msg.result) {
      setCaptureResult(msg.result);
      uiNow.setCaptureStatus('done');
      uiNow.bumpCaptureRevision();
      const graphErr = msg.result.errors['__graph'];
      if (graphErr) uiNow.toast('warn', graphErr);
    } else {
      uiNow.setCaptureStatus('error', msg.error ?? 'Capture failed.');
      uiNow.toast('error', `Capture failed: ${msg.error ?? 'unknown error'}`);
    }
  };
  worker.addEventListener('message', onMessage);
  worker.postMessage({
    kind: 'capture',
    requestId,
    request: {
      graph: project.graph,
      sampleRate: project.sampleRate,
      duration: ui.captureDuration,
      seed,
    },
  });
}

/**
 * Unified signal access for analyzers:
 * live mode → recent ring samples; capture mode → slice of the capture buffer.
 */
export function getSignalWindow(nodeId: string, samples: number): Float32Array | null {
  const ui = useUiStore.getState();
  if (ui.runMode === 'capture') {
    const res = getCaptureResult();
    const buf = res?.buffers[nodeId];
    if (!buf) return null;
    return buf.length <= samples ? buf : buf.subarray(buf.length - samples);
  }
  return liveEngine.getRecent(nodeId, samples);
}

export function getFullSignal(nodeId: string): { data: Float32Array; sampleRate: number } | null {
  const ui = useUiStore.getState();
  if (ui.runMode === 'capture') {
    const res = getCaptureResult();
    const buf = res?.buffers[nodeId];
    if (!buf || !res) return null;
    return { data: buf, sampleRate: res.sampleRate };
  }
  const data = liveEngine.getRecent(nodeId, 32768);
  return data ? { data, sampleRate: liveEngine.sampleRate } : null;
}
