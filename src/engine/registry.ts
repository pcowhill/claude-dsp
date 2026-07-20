import type { NodeDef, ParamValue } from '@/model/types';
import { SOURCE_NODES } from './nodes/sources';
import { PROCESS_NODES } from './nodes/processors';
import { ANALYZER_NODES, OUTPUT_NODES } from './nodes/analyzers';

export const ALL_NODES: NodeDef[] = [
  ...SOURCE_NODES,
  ...PROCESS_NODES,
  ...ANALYZER_NODES,
  ...OUTPUT_NODES,
];

const byType = new Map<string, NodeDef>(ALL_NODES.map((d) => [d.type, d]));

export function getNodeDef(type: string): NodeDef {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown node type: ${type}`);
  return def;
}

export function hasNodeDef(type: string): boolean {
  return byType.has(type);
}

export function defaultParams(type: string): Record<string, ParamValue> {
  const def = getNodeDef(type);
  const params: Record<string, ParamValue> = {};
  for (const p of def.params) params[p.id] = p.default;
  return params;
}

export const NODE_CATEGORIES = [
  { id: 'source', label: 'Sources' },
  { id: 'process', label: 'Processing' },
  { id: 'analyze', label: 'Analyzers' },
  { id: 'output', label: 'Output' },
] as const;
