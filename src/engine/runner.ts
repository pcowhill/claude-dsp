/**
 * GraphRunner — the deterministic block-based execution engine.
 *
 * One instance renders a ProjectGraph block by block. The same class powers
 * the live engine (main thread), the capture engine (worker) and the tests,
 * which is what makes captures repeatable and grading deterministic.
 */

import type { ProjectGraph, RenderCtx, ParamValue } from '@/model/types';
import { LIMITS } from '@/model/types';
import { getNodeDef, hasNodeDef } from './registry';
import { topologicalOrder, isDeferredEdge } from './graph';
import { mulberry32, deriveSeed } from './dsp/rng';

interface RunnerNode {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
  state: Record<string, any>;
  outputs: Float32Array[];
  prevOutput: Float32Array; // previous block of first output (for deferred edges)
  random: () => number;
  error: string | null;
}

export class GraphRunner {
  readonly sampleRate: number;
  readonly blockSize: number;
  readonly mode: 'live' | 'capture';
  private seed: number;
  private nodes = new Map<string, RunnerNode>();
  private order: string[] = [];
  private graph: ProjectGraph;
  startSample = 0;
  orderErrors: string[] = [];

  constructor(
    graph: ProjectGraph,
    sampleRate: number,
    mode: 'live' | 'capture',
    seed = 1,
    blockSize = LIMITS.blockSize,
  ) {
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.mode = mode;
    this.seed = seed;
    this.graph = graph;
    this.rebuild(graph);
  }

  /** Rebuild structure from a (possibly changed) graph, preserving state of surviving nodes. */
  rebuild(graph: ProjectGraph): void {
    this.graph = graph;
    const next = new Map<string, RunnerNode>();
    for (const n of graph.nodes) {
      if (!hasNodeDef(n.type)) continue;
      const def = getNodeDef(n.type);
      const existing = this.nodes.get(n.id);
      if (existing && existing.type === n.type) {
        existing.params = n.params;
        next.set(n.id, existing);
      } else {
        next.set(n.id, this.createRunnerNode(n.id, n.type, n.params));
      }
      // Surface per-node validation errors (expression syntax, tone lists…)
      const rn = next.get(n.id)!;
      rn.error = def.validate ? def.validate(n.params, this.sampleRate) : null;
    }
    this.nodes = next;
    const { order, errors } = topologicalOrder(graph);
    this.order = order.filter((id) => this.nodes.has(id));
    this.orderErrors = errors;
  }

  private createRunnerNode(
    id: string,
    type: string,
    params: Record<string, ParamValue>,
  ): RunnerNode {
    const def = getNodeDef(type);
    const bufCount = Math.max(1, def.outputs.length);
    const outputs: Float32Array[] = [];
    for (let i = 0; i < bufCount; i++) outputs.push(new Float32Array(this.blockSize));
    const seedParam = typeof params['seed'] === 'number' ? (params['seed'] as number) : 0;
    const random =
      this.mode === 'capture'
        ? mulberry32(deriveSeed(this.seed + seedParam * 7919, id))
        : mulberry32((Math.random() * 0xffffffff) >>> 0);
    return {
      id,
      type,
      params,
      state: def.createState ? def.createState(this.sampleRate, params) : {},
      outputs,
      prevOutput: new Float32Array(this.blockSize),
      random,
      error: null,
    };
  }

  /** Reset all node state and the transport position (deterministic restart). */
  reset(): void {
    this.startSample = 0;
    for (const [id, rn] of this.nodes) {
      const def = getNodeDef(rn.type);
      rn.state = def.createState ? def.createState(this.sampleRate, rn.params) : {};
      for (const buf of rn.outputs) buf.fill(0);
      rn.prevOutput.fill(0);
      const seedParam = typeof rn.params['seed'] === 'number' ? (rn.params['seed'] as number) : 0;
      rn.random =
        this.mode === 'capture'
          ? mulberry32(deriveSeed(this.seed + seedParam * 7919, id))
          : mulberry32((Math.random() * 0xffffffff) >>> 0);
    }
  }

  setSeed(seed: number): void {
    this.seed = seed;
  }

  /** Render one block for every node in deterministic order. */
  renderBlock(): void {
    const ctxBase = {
      sampleRate: this.sampleRate,
      blockSize: this.blockSize,
      startSample: this.startSample,
      mode: this.mode,
    };
    for (const id of this.order) {
      const rn = this.nodes.get(id)!;
      const def = getNodeDef(rn.type);
      // Resolve inputs
      const inputs: (Float32Array | null)[] = def.inputs.map((port) => {
        const edge = this.graph.edges.find((e) => e.to === id && e.toPort === port.id);
        if (!edge) return null;
        const src = this.nodes.get(edge.from);
        if (!src) return null;
        if (port.deferred || isDeferredEdge(this.graph, edge)) return src.prevOutput;
        // Nodes outside the order (illegal cycles) contribute silence
        if (!this.order.includes(edge.from)) return null;
        const outIdx = Math.max(
          0,
          getNodeDef(src.type).outputs.findIndex((p) => p.id === edge.fromPort),
        );
        return src.outputs[outIdx] ?? null;
      });
      const ctx: RenderCtx = { ...ctxBase, random: rn.random };
      try {
        def.process(ctx, inputs, rn.outputs, rn.params, rn.state);
      } catch (err) {
        rn.error = err instanceof Error ? err.message : String(err);
        for (const buf of rn.outputs) buf.fill(0);
      }
      // Guard against NaN/Infinity escaping a node
      const out = rn.outputs[0];
      for (let i = 0; i < this.blockSize; i++) {
        if (!Number.isFinite(out[i])) out[i] = 0;
      }
    }
    // Snapshot prev outputs for deferred edges (after the whole block)
    for (const rn of this.nodes.values()) {
      rn.prevOutput.set(rn.outputs[0]);
    }
    this.startSample += this.blockSize;
  }

  /** Current block output buffer (first output port) of a node. */
  getOutput(nodeId: string): Float32Array | null {
    return this.nodes.get(nodeId)?.outputs[0] ?? null;
  }

  getError(nodeId: string): string | null {
    return this.nodes.get(nodeId)?.error ?? null;
  }

  nodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /** The node id feeding this node's given input port (following real edges). */
  upstreamOf(nodeId: string, portId = 'in'): string | null {
    const edge = this.graph.edges.find((e) => e.to === nodeId && e.toPort === portId);
    return edge?.from ?? null;
  }
}
