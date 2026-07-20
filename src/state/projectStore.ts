/**
 * Central application store: the current project, graph editing operations,
 * selection, undo/redo and dirty tracking. All mutations go through here so
 * history and autosave stay consistent.
 */

import { create } from 'zustand';
import type { Project, ProjectGraph, ParamValue } from '@/model/types';
import { LIMITS, PROJECT_SCHEMA_VERSION } from '@/model/types';
import { defaultParams, getNodeDef } from '@/engine/registry';
import { checkConnection } from '@/engine/graph';

export type AppMode = 'sandbox' | 'lessons' | 'challenges';

let idCounter = 0;

export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function makeEmptyProject(name = 'Untitled experiment'): Project {
  const now = new Date().toISOString();
  return {
    version: PROJECT_SCHEMA_VERSION,
    id: freshId('proj'),
    name,
    createdAt: now,
    modifiedAt: now,
    sampleRate: 48000,
    graph: { nodes: [], edges: [] },
    notes: '',
  };
}

interface HistoryEntry {
  graph: ProjectGraph;
}

function cloneGraph(g: ProjectGraph): ProjectGraph {
  return {
    nodes: g.nodes.map((n) => ({ ...n, params: { ...n.params } })),
    edges: g.edges.map((e) => ({ ...e })),
  };
}

export interface ProjectState {
  project: Project;
  selection: string[];
  dirty: boolean;
  /** Bumped on every graph-affecting change; engines listen to this. */
  graphRevision: number;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastConnectionError: string | null;

  setProject: (p: Project, opts?: { keepHistory?: boolean }) => void;
  renameProject: (name: string) => void;
  setNotes: (notes: string) => void;
  setSampleRate: (sr: number) => void;

  addNode: (type: string, x: number, y: number) => string | null;
  moveNode: (id: string, x: number, y: number, recordHistory?: boolean) => void;
  setParam: (nodeId: string, paramId: string, value: ParamValue) => void;
  commitParamHistory: () => void;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => string[];
  tryAddEdge: (from: string, fromPort: string, to: string, toPort: string) => boolean;
  clearConnectionError: () => void;
  setSelection: (ids: string[]) => void;

  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 100;

export const useProjectStore = create<ProjectState>((set, get) => {
  /** Push current graph onto the undo stack (call BEFORE mutating). */
  function push(state: ProjectState): Pick<ProjectState, 'past' | 'future'> {
    const past = [...state.past, { graph: cloneGraph(state.project.graph) }];
    if (past.length > MAX_HISTORY) past.shift();
    return { past, future: [] };
  }

  function touch(p: Project): Project {
    return { ...p, modifiedAt: new Date().toISOString() };
  }

  return {
    project: makeEmptyProject(),
    selection: [],
    dirty: false,
    graphRevision: 0,
    past: [],
    future: [],
    lastConnectionError: null,

    setProject: (p) =>
      set((s) => ({
        project: p,
        selection: [],
        past: [],
        future: [],
        dirty: false,
        graphRevision: s.graphRevision + 1,
        lastConnectionError: null,
      })),

    renameProject: (name) =>
      set((s) => ({ project: touch({ ...s.project, name }), dirty: true })),

    setNotes: (notes) => set((s) => ({ project: touch({ ...s.project, notes }), dirty: true })),

    setSampleRate: (sr) =>
      set((s) => ({
        project: touch({
          ...s.project,
          sampleRate: Math.max(LIMITS.minSampleRate, Math.min(LIMITS.maxSampleRate, Math.round(sr))),
        }),
        dirty: true,
        graphRevision: s.graphRevision + 1,
      })),

    addNode: (type, x, y) => {
      const s = get();
      if (s.project.graph.nodes.length >= LIMITS.maxNodes) {
        set({ lastConnectionError: `Node limit reached (${LIMITS.maxNodes}).` });
        return null;
      }
      const id = freshId(type.split('.')[1] ?? 'node');
      set((st) => ({
        ...push(st),
        project: touch({
          ...st.project,
          graph: {
            ...st.project.graph,
            nodes: [
              ...st.project.graph.nodes,
              { id, type, x: Math.round(x), y: Math.round(y), params: defaultParams(type) },
            ],
          },
        }),
        dirty: true,
        graphRevision: st.graphRevision + 1,
        selection: [id],
      }));
      return id;
    },

    moveNode: (id, x, y, recordHistory = false) =>
      set((st) => ({
        ...(recordHistory ? push(st) : {}),
        project: {
          ...st.project,
          graph: {
            ...st.project.graph,
            nodes: st.project.graph.nodes.map((n) =>
              n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n,
            ),
          },
        },
        dirty: true,
      })),

    setParam: (nodeId, paramId, value) =>
      set((st) => ({
        project: touch({
          ...st.project,
          graph: {
            ...st.project.graph,
            nodes: st.project.graph.nodes.map((n) =>
              n.id === nodeId ? { ...n, params: { ...n.params, [paramId]: value } } : n,
            ),
          },
        }),
        dirty: true,
        graphRevision: st.graphRevision + 1,
      })),

    // Params change continuously while dragging a knob; call this once when a
    // gesture starts so one drag = one undo step.
    commitParamHistory: () => set((st) => ({ ...push(st) })),

    removeNodes: (ids) =>
      set((st) => {
        const idSet = new Set(ids);
        return {
          ...push(st),
          project: touch({
            ...st.project,
            graph: {
              nodes: st.project.graph.nodes.filter((n) => !idSet.has(n.id)),
              edges: st.project.graph.edges.filter((e) => !idSet.has(e.from) && !idSet.has(e.to)),
            },
          }),
          selection: st.selection.filter((id) => !idSet.has(id)),
          dirty: true,
          graphRevision: st.graphRevision + 1,
        };
      }),

    removeEdges: (ids) =>
      set((st) => {
        const idSet = new Set(ids);
        return {
          ...push(st),
          project: touch({
            ...st.project,
            graph: {
              ...st.project.graph,
              edges: st.project.graph.edges.filter((e) => !idSet.has(e.id)),
            },
          }),
          dirty: true,
          graphRevision: st.graphRevision + 1,
        };
      }),

    duplicateNodes: (ids) => {
      const st = get();
      const idSet = new Set(ids);
      const mapping = new Map<string, string>();
      const newNodes = st.project.graph.nodes
        .filter((n) => idSet.has(n.id))
        .map((n) => {
          const id = freshId(n.type.split('.')[1] ?? 'node');
          mapping.set(n.id, id);
          return { ...n, id, x: n.x + 40, y: n.y + 48, params: { ...n.params } };
        });
      if (
        newNodes.length === 0 ||
        st.project.graph.nodes.length + newNodes.length > LIMITS.maxNodes
      ) {
        return [];
      }
      // Also duplicate edges strictly between duplicated nodes
      const newEdges = st.project.graph.edges
        .filter((e) => idSet.has(e.from) && idSet.has(e.to))
        .map((e) => ({
          ...e,
          id: freshId('e'),
          from: mapping.get(e.from)!,
          to: mapping.get(e.to)!,
        }));
      set((s2) => ({
        ...push(s2),
        project: touch({
          ...s2.project,
          graph: {
            nodes: [...s2.project.graph.nodes, ...newNodes],
            edges: [...s2.project.graph.edges, ...newEdges],
          },
        }),
        selection: newNodes.map((n) => n.id),
        dirty: true,
        graphRevision: s2.graphRevision + 1,
      }));
      return newNodes.map((n) => n.id);
    },

    tryAddEdge: (from, fromPort, to, toPort) => {
      const st = get();
      const check = checkConnection(st.project.graph, from, fromPort, to, toPort);
      if (!check.ok) {
        set({ lastConnectionError: check.reason ?? 'Connection not allowed.' });
        return false;
      }
      set((s2) => ({
        ...push(s2),
        project: touch({
          ...s2.project,
          graph: {
            ...s2.project.graph,
            edges: [...s2.project.graph.edges, { id: freshId('e'), from, fromPort, to, toPort }],
          },
        }),
        dirty: true,
        graphRevision: s2.graphRevision + 1,
        lastConnectionError: null,
      }));
      return true;
    },

    clearConnectionError: () => set({ lastConnectionError: null }),

    setSelection: (ids) => set({ selection: ids }),

    undo: () =>
      set((st) => {
        const prev = st.past[st.past.length - 1];
        if (!prev) return st;
        return {
          past: st.past.slice(0, -1),
          future: [{ graph: cloneGraph(st.project.graph) }, ...st.future].slice(0, MAX_HISTORY),
          project: touch({ ...st.project, graph: cloneGraph(prev.graph) }),
          dirty: true,
          graphRevision: st.graphRevision + 1,
        };
      }),

    redo: () =>
      set((st) => {
        const next = st.future[0];
        if (!next) return st;
        return {
          future: st.future.slice(1),
          past: [...st.past, { graph: cloneGraph(st.project.graph) }].slice(-MAX_HISTORY),
          project: touch({ ...st.project, graph: cloneGraph(next.graph) }),
          dirty: true,
          graphRevision: st.graphRevision + 1,
        };
      }),
  };
});

/** Convenience: the currently selected single node, if exactly one. */
export function selectedNode(state: ProjectState) {
  if (state.selection.length !== 1) return null;
  return state.project.graph.nodes.find((n) => n.id === state.selection[0]) ?? null;
}

export function nodeTitle(type: string): string {
  try {
    return getNodeDef(type).title;
  } catch {
    return type;
  }
}
