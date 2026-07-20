/// <reference lib="webworker" />
/**
 * Capture worker: renders finite captures off the main thread and transfers
 * the resulting buffers back.
 */

import type { CaptureRequest } from '@/model/types';
import { runCapture } from '@/engine/capture';

interface CaptureMessage {
  kind: 'capture';
  requestId: number;
  request: CaptureRequest;
}

self.onmessage = (ev: MessageEvent<CaptureMessage>) => {
  const msg = ev.data;
  if (msg.kind !== 'capture') return;
  try {
    const result = runCapture(msg.request);
    const transfers: ArrayBuffer[] = [];
    const buffers: Record<string, Float32Array> = {};
    for (const [id, buf] of Object.entries(result.buffers)) {
      // Copy the trimmed view into a fresh transferable buffer
      const copy = new Float32Array(buf.length);
      copy.set(buf);
      buffers[id] = copy;
      transfers.push(copy.buffer);
    }
    self.postMessage(
      {
        kind: 'capture-done',
        requestId: msg.requestId,
        result: { ...result, buffers },
      },
      { transfer: transfers },
    );
  } catch (err) {
    self.postMessage({
      kind: 'capture-error',
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
