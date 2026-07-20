/**
 * React Flow canvas wired to the project store. The store is the source of
 * truth; RF nodes/edges are derived. Connection attempts run through
 * checkConnection so invalid patches are refused with an explanation.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Connection,
  type Edge as RFEdge,
  type NodeChange,
  type EdgeChange,
  type IsValidConnection,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useProjectStore } from '@/state/projectStore';
import { useUiStore } from '@/state/uiStore';
import { checkConnection, isDeferredEdge } from '@/engine/graph';
import { getNodeDef } from '@/engine/registry';
import { DspNode, type DspRFNode } from './DspNode';

const nodeTypes = { dsp: DspNode };

function CanvasInner() {
  const graph = useProjectStore((s) => s.project.graph);
  const selection = useProjectStore((s) => s.selection);
  const moveNode = useProjectStore((s) => s.moveNode);
  const removeNodes = useProjectStore((s) => s.removeNodes);
  const removeEdges = useProjectStore((s) => s.removeEdges);
  const setSelection = useProjectStore((s) => s.setSelection);
  const tryAddEdge = useProjectStore((s) => s.tryAddEdge);
  const addNode = useProjectStore((s) => s.addNode);
  const lastConnectionError = useProjectStore((s) => s.lastConnectionError);
  const clearConnectionError = useProjectStore((s) => s.clearConnectionError);
  const transport = useUiStore((s) => s.transport);
  const toast = useUiStore((s) => s.toast);
  const { screenToFlowPosition } = useReactFlow();
  const dragMoved = useRef(false);

  const rfNodes = useMemo<DspRFNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'dsp' as const,
        position: { x: n.x, y: n.y },
        data: { graphNode: n },
        selected: selection.includes(n.id),
      })),
    [graph.nodes, selection],
  );

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      graph.edges.map((e) => {
        const toNode = graph.nodes.find((n) => n.id === e.to);
        const toDef = toNode ? getNodeDef(toNode.type) : null;
        const toPort = toDef?.inputs.find((p) => p.id === e.toPort);
        const deferred = isDeferredEdge(graph, e);
        const control = toPort?.kind === 'control';
        const active = transport === 'playing';
        return {
          id: e.id,
          source: e.from,
          sourceHandle: e.fromPort,
          target: e.to,
          targetHandle: e.toPort,
          className: [
            control ? 'cable-control' : '',
            deferred ? 'cable-feedback' : '',
            active ? 'cable-active animate-flow' : '',
          ]
            .filter(Boolean)
            .join(' '),
        };
      }),
    [graph, transport],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DspRFNode>[]) => {
      const removed: string[] = [];
      let selectionChanged = false;
      const nextSelection = new Set(useProjectStore.getState().selection);
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position && ch.dragging !== false) {
          dragMoved.current = true;
          moveNode(ch.id, ch.position.x, ch.position.y);
        } else if (ch.type === 'remove') {
          removed.push(ch.id);
        } else if (ch.type === 'select') {
          selectionChanged = true;
          if (ch.selected) nextSelection.add(ch.id);
          else nextSelection.delete(ch.id);
        }
      }
      if (removed.length) removeNodes(removed);
      if (selectionChanged) setSelection([...nextSelection]);
    },
    [moveNode, removeNodes, setSelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length) removeEdges(removed);
    },
    [removeEdges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const ok = tryAddEdge(
        conn.source,
        conn.sourceHandle ?? 'out',
        conn.target,
        conn.targetHandle ?? 'in',
      );
      if (!ok) {
        const err = useProjectStore.getState().lastConnectionError;
        if (err) {
          toast('warn', err);
          clearConnectionError();
        }
      }
    },
    [tryAddEdge, toast, clearConnectionError],
  );

  const isValidConnection: IsValidConnection = useCallback((conn) => {
    if (!conn.source || !conn.target) return false;
    return checkConnection(
      useProjectStore.getState().project.graph,
      conn.source,
      conn.sourceHandle ?? 'out',
      conn.target,
      conn.targetHandle ?? 'in',
    ).ok;
  }, []);

  // When a drag ends on a handle that was refused, explain why.
  const onConnectEnd = useCallback(
    (_event: unknown, connectionState: { isValid: boolean | null; fromHandle?: unknown; toHandle?: { nodeId?: string | null; id?: string | null } | null; fromNode?: { id?: string } | null }) => {
      if (connectionState.isValid !== false) return;
      const to = connectionState.toHandle;
      const fromNode = connectionState.fromNode;
      if (!to?.nodeId || !fromNode?.id) return;
      const check = checkConnection(
        useProjectStore.getState().project.graph,
        fromNode.id,
        'out',
        to.nodeId,
        to.id ?? 'in',
      );
      if (!check.ok && check.reason) toast('warn', check.reason);
    },
    [toast],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/spp-node-type');
      if (!type) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(type, pos.x - 80, pos.y - 20);
    },
    [screenToFlowPosition, addNode],
  );

  return (
    <div className="flow-zone" data-testid="flow-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStop={() => {
          dragMoved.current = false;
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.75}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionKeyCode={null}
        proOptions={{ hideAttribution: false }}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="rgba(120,144,156,0.07)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          bgColor="#10141a"
          nodeColor={(n) => {
            const gn = (n as DspRFNode).data?.graphNode;
            if (!gn) return '#39414d';
            const cat = getNodeDef(gn.type).category;
            return cat === 'source'
              ? '#8a6a3a'
              : cat === 'process'
                ? '#3a6a85'
                : cat === 'analyze'
                  ? '#2f7a53'
                  : '#8a4a48';
          }}
          maskColor="rgba(16,20,26,0.75)"
        />
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <div className="canvas-empty">
          <div className="inner">
            <h3>Empty bench</h3>
            <p>
              Drag a module from the library on the left onto the canvas — start with a{' '}
              <strong>Sine Wave</strong>, wire it into an <strong>Oscilloscope</strong>, then an{' '}
              <strong>Audio Output</strong>. Or open an example from the Projects menu above.
            </p>
          </div>
        </div>
      )}
      {lastConnectionError && (
        <span style={{ display: 'none' }} data-testid="connection-error">
          {lastConnectionError}
        </span>
      )}
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
