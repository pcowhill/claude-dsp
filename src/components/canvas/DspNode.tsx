/**
 * The custom node module rendered on the canvas: category band, printed
 * title, tactile primary controls, port jacks, inline analyzer screens and
 * an error LED with message.
 */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node as RFNode } from '@xyflow/react';
import { getNodeDef } from '@/engine/registry';
import type { GraphNode, ParamDef } from '@/model/types';
import { useProjectStore } from '@/state/projectStore';
import { useUiStore } from '@/state/uiStore';
import { liveEngine } from '@/state/engines';
import { Knob } from '../controls/Knob';
import { HSlider, ToggleSwitch, SelectControl } from '../controls/Controls';
import { ScopeMini, SpectrumMini, SpectrogramMini, StatsMini } from './NodeScreens';

export type DspNodeData = { graphNode: GraphNode };
export type DspRFNode = RFNode<DspNodeData, 'dsp'>;

const PORT_SPACING = 24;
const PORT_TOP = 42;

function PrimaryControl({
  node,
  param,
}: {
  node: GraphNode;
  param: ParamDef;
}) {
  const setParam = useProjectStore((s) => s.setParam);
  const commit = useProjectStore((s) => s.commitParamHistory);
  const value = node.params[param.id] ?? param.default;
  const onGestureStart = useCallback(() => commit(), [commit]);

  if (param.type === 'boolean') {
    return (
      <ToggleSwitch
        label={param.label}
        value={Boolean(value)}
        onChange={(v) => setParam(node.id, param.id, v)}
        onGestureStart={onGestureStart}
      />
    );
  }
  if (param.type === 'select') {
    return (
      <SelectControl
        label={param.label}
        value={String(value)}
        options={param.options ?? []}
        onChange={(v) => setParam(node.id, param.id, v)}
        onGestureStart={onGestureStart}
        compact
      />
    );
  }
  if (param.type === 'number') {
    if (param.control === 'slider') {
      return (
        <div style={{ width: 185 }}>
          <HSlider
            label={param.label}
            value={Number(value)}
            min={param.min ?? 0}
            max={param.max ?? 1}
            step={param.step ?? 0.01}
            unit={param.unit}
            digits={param.digits ?? 2}
            onChange={(v) => setParam(node.id, param.id, v)}
            onGestureStart={onGestureStart}
          />
        </div>
      );
    }
    return (
      <Knob
        label={param.label}
        value={Number(value)}
        min={param.min ?? 0}
        max={param.max ?? 1}
        step={param.step}
        scale={param.scale ?? 'linear'}
        unit={param.unit}
        digits={param.digits ?? 2}
        defaultValue={typeof param.default === 'number' ? param.default : undefined}
        onChange={(v) => setParam(node.id, param.id, v)}
        onGestureStart={onGestureStart}
      />
    );
  }
  return null;
}

function NodeScreen({ node }: { node: GraphNode }) {
  switch (node.type) {
    case 'ana.scope':
      return <ScopeMini node={node} />;
    case 'ana.spectrum':
      return <SpectrumMini node={node} />;
    case 'ana.spectrogram':
      return <SpectrogramMini node={node} />;
    case 'ana.stats':
      return <StatsMini node={node} />;
    default:
      return null;
  }
}

export const DspNode = memo(function DspNode({ data, selected }: NodeProps<DspRFNode>) {
  const node = data.graphNode;
  const def = getNodeDef(node.type);
  // Re-render on graph changes so param values shown stay fresh
  const liveNode =
    useProjectStore((s) => s.project.graph.nodes.find((n) => n.id === node.id)) ?? node;
  const runtimeError = useNodeError(liveNode);
  const primaries = def.params.filter((p) => p.primary);
  const isAnalyzer = def.category === 'analyze';
  const portCount = Math.max(def.inputs.length, def.outputs.length);
  const minHeight = PORT_TOP + Math.max(0, portCount - 1) * PORT_SPACING + 16;

  return (
    <div
      className={`dsp-node${selected ? ' selected' : ''}${runtimeError ? ' has-error' : ''}`}
      data-cat={def.category}
      style={{ minHeight, width: isAnalyzer ? 330 : undefined }}
    >
      <div className="dsp-node-head">
        <span className="cat-band" aria-hidden />
        <span className="dsp-node-title">{def.title}</span>
        {runtimeError && (
          <span className="led err dsp-node-err-led" role="img" aria-label="error" title={runtimeError} />
        )}
      </div>
      <div className="dsp-node-body">
        {isAnalyzer && <NodeScreen node={liveNode} />}
        {primaries.map((p) => (
          <PrimaryControl key={p.id} node={liveNode} param={p} />
        ))}
        {primaries.length === 0 && !isAnalyzer && (
          <div className="dsp-node-note">{def.blurb}</div>
        )}
        {runtimeError && <div className="dsp-node-error">{runtimeError}</div>}
      </div>

      {def.inputs.map((port, i) => (
        <span key={port.id}>
          <Handle
            id={port.id}
            type="target"
            position={Position.Left}
            className={`jack kind-${port.deferred ? 'feedback' : port.kind}`}
            style={{ top: PORT_TOP + i * PORT_SPACING }}
            aria-label={`${def.title} input ${port.label}${port.kind === 'control' ? ' (modulation)' : ''}`}
          />
          <span className="port-label in" style={{ top: PORT_TOP + i * PORT_SPACING - 5 }}>
            {port.label}
            {port.kind === 'control' ? ' ◇' : ''}
            {port.deferred ? ' ↺' : ''}
          </span>
        </span>
      ))}
      {def.outputs.map((port, i) => (
        <span key={port.id}>
          <Handle
            id={port.id}
            type="source"
            position={Position.Right}
            className={`jack kind-${port.kind}`}
            style={{ top: PORT_TOP + i * PORT_SPACING }}
            aria-label={`${def.title} output ${port.label}`}
          />
          <span className="port-label out" style={{ top: PORT_TOP + i * PORT_SPACING - 5 }}>
            {port.label}
          </span>
        </span>
      ))}
    </div>
  );
});

/** Poll the engine's per-node validation error at UI tick rate. */
function useNodeError(node: GraphNode): string | null {
  useUiStore((s) => s.liveTick);
  useProjectStore((s) => s.graphRevision);
  const def = getNodeDef(node.type);
  const paramError = def.validate
    ? def.validate(node.params, useProjectStore.getState().project.sampleRate)
    : null;
  return paramError ?? liveEngine.getNodeError(node.id);
}
