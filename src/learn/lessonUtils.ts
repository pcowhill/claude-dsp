/** Shared builders for lesson/challenge projects. */

import type { Project, GraphNode, GraphEdge, ParamValue } from '@/model/types';
import { PROJECT_SCHEMA_VERSION } from '@/model/types';
import { defaultParams } from '@/engine/registry';

let eid = 0;

export function ln(
  id: string,
  type: string,
  x: number,
  y: number,
  params: Record<string, ParamValue> = {},
): GraphNode {
  return { id, type, x, y, params: { ...defaultParams(type), ...params } };
}

export function le(from: string, to: string, toPort = 'in', fromPort = 'out'): GraphEdge {
  return { id: `l-e${eid++}`, from, fromPort, to, toPort };
}

export function lproject(
  id: string,
  name: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  sampleRate = 48000,
): Project {
  const now = new Date().toISOString();
  return {
    version: PROJECT_SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    sampleRate,
    graph: { nodes, edges },
    notes: '',
  };
}

export const fmtHz = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(1)} Hz`;
