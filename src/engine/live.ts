/**
 * LiveEngine — continuous simulation for live mode.
 *
 * Renders the graph in real time on the main thread (blocks are cheap; heavy
 * finite work happens in the capture worker instead). Every node's output is
 * written into a ring buffer that analyzers read at animation rate, and the
 * Audio Output node's blocks are pushed to the AudioEngine when audio is on.
 * The visual simulation runs whether or not audio is enabled.
 */

import type { ProjectGraph } from '@/model/types';
import { LIMITS } from '@/model/types';
import { GraphRunner } from './runner';

const RING = LIMITS.liveRingSamples;

export type TransportState = 'stopped' | 'playing' | 'paused';

export class LiveEngine {
  private runner: GraphRunner | null = null;
  private rings = new Map<string, { buf: Float32Array; pos: number; written: number }>();
  private timer: number | null = null;
  private clockStart = 0; // performance.now() ms at (re)start
  private renderedSamples = 0;
  private graph: ProjectGraph | null = null;
  sampleRate = 48000;
  state: TransportState = 'stopped';
  /** Called for each rendered block of the audio-output node while playing. */
  onAudioBlock: ((samples: Float32Array) => void) | null = null;
  audioActive = false;
  /** Rendering load estimate 0..1+ (fraction of real time spent rendering). */
  load = 0;

  setGraph(graph: ProjectGraph, sampleRate: number): void {
    this.graph = graph;
    if (this.runner && this.sampleRate === sampleRate) {
      this.runner.rebuild(graph);
    } else {
      this.sampleRate = sampleRate;
      this.runner = new GraphRunner(graph, sampleRate, 'live');
      this.syncRings();
    }
    this.syncRings();
  }

  private syncRings(): void {
    if (!this.runner) return;
    const ids = new Set(this.runner.nodeIds());
    for (const id of ids) {
      if (!this.rings.has(id)) {
        this.rings.set(id, { buf: new Float32Array(RING), pos: 0, written: 0 });
      }
    }
    for (const id of [...this.rings.keys()]) {
      if (!ids.has(id)) this.rings.delete(id);
    }
  }

  play(): void {
    if (!this.runner || this.state === 'playing') return;
    if (this.state === 'stopped') {
      this.runner.reset();
      this.renderedSamples = 0;
      this.clearRings();
    }
    this.state = 'playing';
    this.clockStart = performance.now() - (this.renderedSamples / this.sampleRate) * 1000;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.state = 'stopped';
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.runner?.reset();
    this.renderedSamples = 0;
    this.clearRings();
  }

  restart(): void {
    this.stop();
    this.play();
  }

  private clearRings(): void {
    for (const r of this.rings.values()) {
      r.buf.fill(0);
      r.pos = 0;
      r.written = 0;
    }
  }

  /** Render enough blocks to stay slightly ahead of the wall clock. */
  private tick(): void {
    if (!this.runner || this.state !== 'playing') return;
    const t0 = performance.now();
    const elapsed = (t0 - this.clockStart) / 1000;
    const lookahead = this.audioActive ? 0.25 : 0.05;
    const target = Math.ceil(((elapsed + lookahead) * this.sampleRate) / LIMITS.blockSize);
    let blocks = target - Math.floor(this.renderedSamples / LIMITS.blockSize);
    // Never render more than ~1 s of catch-up in one tick (tab was hidden)
    const maxBlocks = Math.ceil(this.sampleRate / LIMITS.blockSize);
    if (blocks > maxBlocks) {
      blocks = maxBlocks;
      this.clockStart = t0 - (this.renderedSamples / this.sampleRate) * 1000;
    }
    const outId = this.findAudioOutputId();
    for (let b = 0; b < blocks; b++) {
      this.runner.renderBlock();
      for (const id of this.runner.nodeIds()) {
        const out = this.runner.getOutput(id);
        if (!out) continue;
        const ring = this.rings.get(id);
        if (!ring) continue;
        for (let i = 0; i < out.length; i++) {
          ring.buf[ring.pos] = out[i];
          ring.pos = (ring.pos + 1) % RING;
        }
        ring.written += out.length;
      }
      if (this.audioActive && outId && this.onAudioBlock) {
        const out = this.runner.getOutput(outId);
        if (out) this.onAudioBlock(out);
      }
      this.renderedSamples += LIMITS.blockSize;
    }
    const dt = performance.now() - t0;
    const budget = 25;
    this.load = this.load * 0.9 + Math.min(2, dt / budget) * 0.1;
  }

  private findAudioOutputId(): string | null {
    if (!this.graph) return null;
    return this.graph.nodes.find((n) => n.type === 'out.audio')?.id ?? null;
  }

  /** Copy of the most recent n samples of a node's output. */
  getRecent(nodeId: string, n: number): Float32Array | null {
    const ring = this.rings.get(nodeId);
    if (!ring || ring.written === 0) return null;
    const count = Math.min(n, RING, ring.written);
    const out = new Float32Array(count);
    let idx = (ring.pos - count + RING) % RING;
    for (let i = 0; i < count; i++) {
      out[i] = ring.buf[idx];
      idx = (idx + 1) % RING;
    }
    return out;
  }

  getNodeError(nodeId: string): string | null {
    return this.runner?.getError(nodeId) ?? null;
  }

  get orderErrors(): string[] {
    return this.runner?.orderErrors ?? [];
  }

  get playheadSeconds(): number {
    return this.renderedSamples / this.sampleRate;
  }

  dispose(): void {
    this.stop();
  }
}
