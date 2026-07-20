/**
 * Finite capture rendering — pure function shared by the capture worker and
 * the test suite. Renders every node's output for a fixed duration with a
 * fixed seed, so results are exactly repeatable.
 */

import type { CaptureRequest, CaptureResult } from '@/model/types';
import { LIMITS } from '@/model/types';
import { GraphRunner } from './runner';
import { validateGraph } from './graph';

export function runCapture(req: CaptureRequest): CaptureResult {
  const sampleRate = Math.max(
    LIMITS.minSampleRate,
    Math.min(LIMITS.maxSampleRate, Math.round(req.sampleRate)),
  );
  const duration = Math.max(0.01, Math.min(LIMITS.maxCaptureSeconds, req.duration));
  const nodeCount = Math.max(1, req.graph.nodes.length);
  let length = Math.round(duration * sampleRate);
  // Global memory guard: shrink capture if nodes × samples would exceed the cap
  if (length * nodeCount > LIMITS.maxCaptureTotalSamples) {
    length = Math.floor(LIMITS.maxCaptureTotalSamples / nodeCount);
  }
  const blocks = Math.ceil(length / LIMITS.blockSize);
  const errors: Record<string, string> = {};
  const graphErrors = validateGraph(req.graph);
  if (graphErrors.length) errors['__graph'] = graphErrors.join(' ');

  const runner = new GraphRunner(req.graph, sampleRate, 'capture', req.seed);
  runner.reset();
  const buffers: Record<string, Float32Array> = {};
  for (const id of runner.nodeIds()) {
    buffers[id] = new Float32Array(blocks * LIMITS.blockSize);
  }
  for (let b = 0; b < blocks; b++) {
    runner.renderBlock();
    for (const id of runner.nodeIds()) {
      const out = runner.getOutput(id);
      if (out) buffers[id].set(out, b * LIMITS.blockSize);
    }
  }
  for (const id of runner.nodeIds()) {
    const err = runner.getError(id);
    if (err) errors[id] = err;
    // Trim to exact requested length
    buffers[id] = buffers[id].subarray(0, length) as Float32Array;
  }
  return { sampleRate, length, buffers, errors };
}
