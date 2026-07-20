import type { GraphEdge, GraphNode, ProjectGraph, ParamValue } from '@/model/types';
import { defaultParams } from '@/engine/registry';
import { runCapture } from '@/engine/capture';

let edgeCounter = 0;

export function node(
  id: string,
  type: string,
  params: Record<string, ParamValue> = {},
): GraphNode {
  return { id, type, x: 0, y: 0, params: { ...defaultParams(type), ...params } };
}

export function edge(from: string, to: string, toPort = 'in', fromPort = 'out'): GraphEdge {
  return { id: `e${edgeCounter++}`, from, fromPort, to, toPort };
}

export function graph(nodes: GraphNode[], edges: GraphEdge[]): ProjectGraph {
  return { nodes, edges };
}

/** Render a graph in capture mode and return one node's buffer. */
export function render(
  g: ProjectGraph,
  nodeId: string,
  duration = 0.5,
  sampleRate = 48000,
  seed = 42,
): Float32Array {
  const result = runCapture({ graph: g, duration, sampleRate, seed });
  const buf = result.buffers[nodeId];
  if (!buf) throw new Error(`No buffer for node ${nodeId}`);
  return buf;
}
