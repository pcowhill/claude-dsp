/**
 * Graph validation, connection rules and deterministic ordering.
 *
 * Rules:
 *  - Signals flow left to right from output ports to input ports.
 *  - An input port accepts at most one cable (mixers expose several ports).
 *  - Any signal output may drive a control (modulation) input — control inputs
 *    are drawn differently but carry the same mono sample data.
 *  - Cycles are forbidden UNLESS every cycle passes through a deferred input
 *    (the Feedback Delay node's "Loop In"), which reads the previous block and
 *    therefore guarantees at least one block of delay around the loop.
 *  - Evaluation order is a topological sort over non-deferred edges with a
 *    stable tie-break (node id), so results are deterministic.
 */

import type { GraphEdge, GraphNode, ProjectGraph } from '@/model/types';
import { getNodeDef, hasNodeDef } from './registry';

export interface ConnectionCheck {
  ok: boolean;
  reason?: string;
}

export function findNode(graph: ProjectGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** Validate a prospective connection before it is added. */
export function checkConnection(
  graph: ProjectGraph,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): ConnectionCheck {
  const src = findNode(graph, from);
  const dst = findNode(graph, to);
  if (!src || !dst) return { ok: false, reason: 'Both ends of a cable must be existing nodes.' };
  if (from === to) {
    return {
      ok: false,
      reason:
        'A node cannot feed itself directly — the output would depend on itself within the same instant. Use a Feedback Delay node to build loops.',
    };
  }
  const srcDef = getNodeDef(src.type);
  const dstDef = getNodeDef(dst.type);
  const out = srcDef.outputs.find((p) => p.id === fromPort);
  const inp = dstDef.inputs.find((p) => p.id === toPort);
  if (!out) return { ok: false, reason: `No output port "${fromPort}" on ${srcDef.title}.` };
  if (!inp) return { ok: false, reason: `No input port "${toPort}" on ${dstDef.title}.` };
  // One cable per input port
  const occupied = graph.edges.some((e) => e.to === to && e.toPort === toPort);
  if (occupied) {
    return {
      ok: false,
      reason: `${dstDef.title} · ${inp.label} already has a cable. Each input accepts one signal — use a Mixer to combine several.`,
    };
  }
  // Cycle check: would this edge close an instantaneous loop?
  if (!inp.deferred) {
    const candidate: GraphEdge = { id: '__candidate', from, fromPort, to, toPort };
    if (createsInstantCycle(graph, candidate)) {
      return {
        ok: false,
        reason:
          'This cable would close an instantaneous feedback loop, where a sample depends on itself with zero delay. Route the loop through a Feedback Delay node (its Loop In port adds one block of delay) instead.',
      };
    }
  }
  return { ok: true };
}

/** True if adding `edge` creates a cycle using only non-deferred edges. */
function createsInstantCycle(graph: ProjectGraph, edge: GraphEdge): boolean {
  const edges = [...graph.edges, edge].filter((e) => !isDeferredEdge(graph, e));
  // DFS from edge.to; if we can reach edge.from, adding it closes a cycle.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const seen = new Set<string>();
  const stack = [edge.to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === edge.from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export function isDeferredEdge(graph: ProjectGraph, e: GraphEdge): boolean {
  const dst = findNode(graph, e.to);
  if (!dst || !hasNodeDef(dst.type)) return false;
  const port = getNodeDef(dst.type).inputs.find((p) => p.id === e.toPort);
  return !!port?.deferred;
}

export interface GraphOrder {
  order: string[]; // node ids in evaluation order
  errors: string[];
}

/**
 * Deterministic topological order over non-deferred edges. Nodes stuck in an
 * illegal cycle are reported and excluded (their outputs render silence).
 */
export function topologicalOrder(graph: ProjectGraph): GraphOrder {
  const ids = [...graph.nodes.map((n) => n.id)].sort();
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (isDeferredEdge(graph, e)) continue;
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    // Stable: always take lexicographically smallest ready node
    ready.sort();
    const id = ready.shift()!;
    order.push(id);
    for (const next of (adj.get(id) ?? []).sort()) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  const errors: string[] = [];
  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    errors.push(
      `Nodes ${stuck.join(', ')} form an instantaneous cycle and were skipped. Feedback must pass through a Feedback Delay node.`,
    );
  }
  return { order, errors };
}

/** Validate an entire graph (used on import and before capture). */
export function validateGraph(graph: ProjectGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}".`);
    ids.add(n.id);
    if (!hasNodeDef(n.type)) errors.push(`Unknown node type "${n.type}" (node "${n.id}").`);
  }
  const portTaken = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.from)) {
      errors.push(`Cable ${e.id} starts at missing node "${e.from}".`);
      continue;
    }
    if (!ids.has(e.to)) {
      errors.push(`Cable ${e.id} ends at missing node "${e.to}".`);
      continue;
    }
    const srcNode = findNode(graph, e.from)!;
    const dstNode = findNode(graph, e.to)!;
    if (!hasNodeDef(srcNode.type) || !hasNodeDef(dstNode.type)) continue;
    const srcDef = getNodeDef(srcNode.type);
    const dstDef = getNodeDef(dstNode.type);
    if (!srcDef.outputs.some((p) => p.id === e.fromPort)) {
      errors.push(`Cable ${e.id}: ${srcDef.title} has no output "${e.fromPort}".`);
    }
    if (!dstDef.inputs.some((p) => p.id === e.toPort)) {
      errors.push(`Cable ${e.id}: ${dstDef.title} has no input "${e.toPort}".`);
    }
    const key = `${e.to}:${e.toPort}`;
    if (portTaken.has(key)) errors.push(`Input ${dstDef.title} · ${e.toPort} has multiple cables.`);
    portTaken.add(key);
  }
  const { errors: cycleErrors } = topologicalOrder(graph);
  errors.push(...cycleErrors);
  return errors;
}

/** Find the edge feeding a given input port, if any. */
export function edgeInto(graph: ProjectGraph, nodeId: string, portId: string): GraphEdge | undefined {
  return graph.edges.find((e) => e.to === nodeId && e.toPort === portId);
}

/** Human-readable provenance label, e.g. "Sine Wave → Low-Pass Filter". */
export function signalPathLabel(graph: ProjectGraph, nodeId: string, depth = 3): string {
  const parts: string[] = [];
  let cur: string | undefined = nodeId;
  for (let i = 0; i < depth && cur; i++) {
    const node = findNode(graph, cur);
    if (!node) break;
    parts.unshift(getNodeDef(node.type).title);
    const edge = graph.edges.find((e) => e.to === cur && !isDeferredEdge(graph, e));
    cur = edge?.from;
  }
  return parts.join(' → ');
}
