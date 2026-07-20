/**
 * Right-hand inspector: exact parameter editing with units/ranges/validation,
 * signal in/out comparison, deterministic explanations, layered math and
 * node documentation.
 */

import { useEffect, useRef, useState } from 'react';
import { getNodeDef } from '@/engine/registry';
import type { GraphNode, ParamDef } from '@/model/types';
import { useProjectStore, selectedNode } from '@/state/projectStore';
import { useUiStore } from '@/state/uiStore';
import { getSignalWindow } from '@/state/engines';
import { computeStats } from '@/engine/dsp/measurements';
import { explainSignal } from '@/explain/explain';
import { edgeInto, signalPathLabel } from '@/engine/graph';
import { clearPlot, drawGrid, drawScopeTrace, PLOT_COLORS } from '@/viz/plot';
import { MathBlock } from '../MathBlock';
import { EXPRESSION_HELP } from '@/engine/expr/expression';

function NumberRow({ node, param }: { node: GraphNode; param: ParamDef }) {
  const setParam = useProjectStore((s) => s.setParam);
  const commit = useProjectStore((s) => s.commitParamHistory);
  const value = Number(node.params[param.id] ?? param.default);
  const [text, setText] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(formatForEdit(value));
  }, [value]);

  const applyText = (raw: string) => {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setError(`"${raw}" is not a number. Enter a value between ${param.min} and ${param.max}${param.unit ? ' ' + param.unit : ''}.`);
      return;
    }
    if (param.min !== undefined && parsed < param.min) {
      setError(`Minimum is ${param.min}${param.unit ? ' ' + param.unit : ''} (you entered ${parsed}).`);
      return;
    }
    if (param.max !== undefined && parsed > param.max) {
      setError(`Maximum is ${param.max}${param.unit ? ' ' + param.unit : ''} (you entered ${parsed}).`);
      return;
    }
    setError(null);
    commit();
    setParam(node.id, param.id, parsed);
  };

  const nudge = (dir: number, fine: boolean) => {
    const span = (param.max ?? 1) - (param.min ?? 0);
    const base = param.step ?? span / 200;
    const delta = dir * base * (fine ? 0.2 : 1);
    let next: number;
    if (param.scale === 'log' && (param.min ?? 0) > 0) {
      next = value * Math.pow(param.max! / param.min!, (dir * (fine ? 0.002 : 0.01)));
    } else {
      next = value + delta;
    }
    next = Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, next));
    setError(null);
    commit();
    setParam(node.id, param.id, Number(next.toPrecision(6)));
  };

  return (
    <div className="param-row">
      <span className="p-label" title={param.help}>
        {param.label}
      </span>
      <div className="p-input">
        <input
          className={`field${error ? ' invalid' : ''}`}
          style={{ width: 90 }}
          value={text}
          aria-label={`${param.label}${param.unit ? ` in ${param.unit}` : ''}`}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            editing.current = false;
            applyText(text);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              editing.current = false;
              applyText(text);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              nudge(1, e.shiftKey);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              nudge(-1, e.shiftKey);
            }
          }}
        />
        {param.unit && <span className="p-unit">{param.unit}</span>}
        <button
          type="button"
          className="btn small"
          title={`Reset to default (${param.default}${param.unit ? ' ' + param.unit : ''})`}
          onClick={() => {
            setError(null);
            commit();
            setParam(node.id, param.id, param.default);
          }}
        >
          ⟲
        </button>
      </div>
      <span className="p-meta">
        range {param.min} – {param.max}
        {param.unit ? ` ${param.unit}` : ''} · ↑/↓ adjust, Shift = fine
      </span>
      {error && <span className="p-error" role="alert">{error}</span>}
    </div>
  );
}

function formatForEdit(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

function TextRow({ node, param }: { node: GraphNode; param: ParamDef }) {
  const setParam = useProjectStore((s) => s.setParam);
  const commit = useProjectStore((s) => s.commitParamHistory);
  const value = String(node.params[param.id] ?? param.default);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const def = getNodeDef(node.type);
  const validation = def.validate
    ? def.validate({ ...node.params, [param.id]: text }, useProjectStore.getState().project.sampleRate)
    : null;
  return (
    <div className="param-row">
      <span className="p-label">{param.label}</span>
      <div className="p-input" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <textarea
          className={`field${validation ? ' invalid' : ''}`}
          rows={2}
          aria-label={param.label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            commit();
            setParam(node.id, param.id, text);
          }}
        />
      </div>
      {validation && <span className="p-error" role="alert">{validation}</span>}
      {param.help && <span className="p-meta">{param.help}</span>}
    </div>
  );
}

function SelectRow({ node, param }: { node: GraphNode; param: ParamDef }) {
  const setParam = useProjectStore((s) => s.setParam);
  const commit = useProjectStore((s) => s.commitParamHistory);
  return (
    <div className="param-row">
      <span className="p-label">{param.label}</span>
      <div className="p-input">
        <select
          className="field"
          aria-label={param.label}
          value={String(node.params[param.id] ?? param.default)}
          onChange={(e) => {
            commit();
            setParam(node.id, param.id, e.target.value);
          }}
        >
          {(param.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {param.help && <span className="p-meta">{param.help}</span>}
    </div>
  );
}

function BoolRow({ node, param }: { node: GraphNode; param: ParamDef }) {
  const setParam = useProjectStore((s) => s.setParam);
  const commit = useProjectStore((s) => s.commitParamHistory);
  const value = Boolean(node.params[param.id] ?? param.default);
  return (
    <div className="param-row">
      <span className="p-label">{param.label}</span>
      <div className="p-input">
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={value}
          aria-label={param.label}
          onClick={() => {
            commit();
            setParam(node.id, param.id, !value);
          }}
        >
          <span className="thumb" />
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{value ? 'On' : 'Off'}</span>
      </div>
      {param.help && <span className="p-meta">{param.help}</span>}
    </div>
  );
}

/** Small before/after scope pair for the selected processing node. */
function BeforeAfter({ node }: { node: GraphNode }) {
  const inRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);
  const liveTick = useUiStore((s) => s.liveTick);
  const captureRevision = useUiStore((s) => s.captureRevision);
  const graph = useProjectStore((s) => s.project.graph);
  const sr = useProjectStore((s) => s.project.sampleRate);
  const upstream = edgeInto(graph, node.id, 'in')?.from ?? edgeInto(graph, node.id, 'msg')?.from;

  useEffect(() => {
    const draw = (canvas: HTMLCanvasElement | null, nodeId: string | undefined, color: string) => {
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      clearPlot(ctx, canvas.width, canvas.height);
      drawGrid(ctx, canvas.width, canvas.height, 8, 2);
      if (!nodeId) return null;
      const data = getSignalWindow(nodeId, Math.round(sr * 0.02));
      if (!data || data.length < 8) return null;
      drawScopeTrace(ctx, canvas.width, canvas.height, data, { yScale: 1.2, color });
      return computeStats(data, sr);
    };
    draw(inRef.current, upstream, PLOT_COLORS.traceB);
    draw(outRef.current, node.id, PLOT_COLORS.trace);
  }, [liveTick, captureRevision, upstream, node.id, sr]);

  const inData = upstream ? getSignalWindow(upstream, 4096) : null;
  const outData = getSignalWindow(node.id, 4096);
  const inStats = inData && inData.length > 64 ? computeStats(inData, sr) : null;
  const outStats = outData && outData.length > 64 ? computeStats(outData, sr) : null;

  return (
    <div className="ba-screens">
      <div className="ba-row-label">
        <span>IN {upstream ? `· ${signalPathLabel(graph, upstream, 1)}` : '· not connected'}</span>
        <span>{inStats ? `rms ${inStats.rms.toFixed(3)} · peak ${inStats.peak.toFixed(3)}` : ''}</span>
      </div>
      <div className="node-screen">
        <canvas ref={inRef} width={290} height={74} />
      </div>
      <div className="ba-row-label">
        <span>OUT · {getNodeDef(node.type).title}</span>
        <span>{outStats ? `rms ${outStats.rms.toFixed(3)} · peak ${outStats.peak.toFixed(3)}` : ''}</span>
      </div>
      <div className="node-screen">
        <canvas ref={outRef} width={290} height={74} />
      </div>
    </div>
  );
}

function ExplainSection({ node }: { node: GraphNode }) {
  useUiStore((s) => s.liveTick);
  useUiStore((s) => s.captureRevision);
  const graph = useProjectStore((s) => s.project.graph);
  const sr = useProjectStore((s) => s.project.sampleRate);
  const signal = getSignalWindow(node.id, 16384);
  const items = explainSignal(graph, node.id, signal, sr);
  return (
    <div>
      {items.map((item, i) => (
        <div className="explain-item" key={i}>
          <span className={`explain-kind ${item.kind}`}>
            {item.kind === 'measured' ? 'measured' : item.kind === 'heuristic' ? 'heuristic' : 'tip'}
          </span>
          <span
            className={
              item.severity === 'warn'
                ? 'explain-severity-warn'
                : item.severity === 'error'
                  ? 'explain-severity-error'
                  : undefined
            }
          >
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProjectInspector() {
  const project = useProjectStore((s) => s.project);
  const renameProject = useProjectStore((s) => s.renameProject);
  const setNotes = useProjectStore((s) => s.setNotes);
  const setSampleRate = useProjectStore((s) => s.setSampleRate);
  return (
    <div className="inspector-body">
      <details className="insp-section" open>
        <summary>Project</summary>
        <div className="insp-section-body">
          <div className="param-row">
            <span className="p-label">Name</span>
            <div className="p-input">
              <input
                className="field"
                aria-label="Project name"
                value={project.name}
                onChange={(e) => renameProject(e.target.value)}
              />
            </div>
          </div>
          <div className="param-row">
            <span className="p-label">Sample rate</span>
            <div className="p-input">
              <select
                className="field"
                aria-label="Project sample rate"
                value={project.sampleRate}
                onChange={(e) => setSampleRate(parseInt(e.target.value))}
              >
                {[8000, 16000, 22050, 44100, 48000].map((sr) => (
                  <option key={sr} value={sr}>
                    {sr} Hz
                  </option>
                ))}
              </select>
            </div>
            <span className="p-meta">
              The engine rate for live playback and default captures. Nyquist = {project.sampleRate / 2} Hz.
            </span>
          </div>
          <div className="param-row">
            <span className="p-label">Notes</span>
            <div className="p-input">
              <textarea
                className="field"
                rows={4}
                aria-label="Project notes"
                value={project.notes ?? ''}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Lab notes — included in experiment reports."
              />
            </div>
          </div>
        </div>
      </details>
      <details className="insp-section" open>
        <summary>Getting around</summary>
        <div className="insp-section-body" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          <p style={{ marginTop: 0 }}>
            Select a node to edit its parameters, compare its input and output, read the math behind
            it, and get deterministic explanations of what the signal is doing.
          </p>
          <p>
            <strong>Shortcuts:</strong> Delete removes selection · Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z
            redo · Ctrl/⌘+D duplicate · Space play/pause.
          </p>
        </div>
      </details>
    </div>
  );
}

export function Inspector() {
  const node = useProjectStore(selectedNode);
  const removeNodes = useProjectStore((s) => s.removeNodes);
  const duplicateNodes = useProjectStore((s) => s.duplicateNodes);
  const project = useProjectStore((s) => s.project);

  if (!node) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-head">
          <span className="inspector-title">Inspector</span>
        </div>
        <ProjectInspector />
      </aside>
    );
  }

  const def = getNodeDef(node.type);
  const hasSignalIO = def.inputs.some((p) => p.id === 'in' || p.id === 'msg');

  return (
    <aside className="inspector" aria-label={`Inspector: ${def.title}`}>
      <div className="inspector-head">
        <span
          className="cat-band"
          style={{
            background:
              def.category === 'source'
                ? 'var(--sig-source)'
                : def.category === 'process'
                  ? 'var(--sig-process)'
                  : def.category === 'analyze'
                    ? 'var(--sig-analyze)'
                    : 'var(--sig-output)',
          }}
        />
        <span className="inspector-title">{def.title}</span>
        <button
          type="button"
          className="btn small"
          title="Duplicate node (Ctrl/⌘+D)"
          onClick={() => duplicateNodes([node.id])}
        >
          ⧉
        </button>
        <button
          type="button"
          className="btn small danger"
          title="Delete node (Delete)"
          onClick={() => removeNodes([node.id])}
        >
          ✕
        </button>
      </div>
      <div className="inspector-body">
        <p className="param-help" style={{ marginTop: 0 }}>
          {def.description}
        </p>
        {def.params.length > 0 && (
          <details className="insp-section" open>
            <summary>Parameters</summary>
            <div className="insp-section-body">
              {def.params.map((p) => {
                if (p.type === 'number') return <NumberRow key={p.id} node={node} param={p} />;
                if (p.type === 'select') return <SelectRow key={p.id} node={node} param={p} />;
                if (p.type === 'boolean') return <BoolRow key={p.id} node={node} param={p} />;
                return <TextRow key={p.id} node={node} param={p} />;
              })}
              {node.type === 'src.expression' && (
                <div className="param-help">
                  Variables: {EXPRESSION_HELP.variables.map((v) => v.name).join(' · ')}. Try:{' '}
                  {EXPRESSION_HELP.examples.slice(0, 2).map((ex) => (
                    <code key={ex} style={{ display: 'block', marginTop: 2 }}>
                      {ex}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}
        {hasSignalIO && (
          <details className="insp-section" open>
            <summary>Signal In → Out</summary>
            <div className="insp-section-body">
              <BeforeAfter node={node} />
            </div>
          </details>
        )}
        <details className="insp-section" open>
          <summary>Explain This Signal</summary>
          <div className="insp-section-body">
            <ExplainSection node={node} />
          </div>
        </details>
        {def.math && (
          <details className="insp-section">
            <summary>Math Behind It</summary>
            <div className="insp-section-body">
              <MathBlock doc={def.math} params={node.params} sampleRate={project.sampleRate} />
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}
