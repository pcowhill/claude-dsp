/**
 * Instrument screens embedded in analyzer nodes on the canvas: scope with
 * trigger/freeze/cursors, spectrum with peak & harmonic markers and a
 * frequency cursor, spectrogram with time/frequency cursors and legend, and
 * the statistics meter. They redraw on the live tick / capture revision and
 * read signal windows from the engine layer — no DSP beyond helper calls.
 */

import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '@/state/uiStore';
import { getSignalWindow } from '@/state/engines';
import { useProjectStore } from '@/state/projectStore';
import {
  computeSpectrum,
  computeSpectrogram,
  dominantFrequency,
  ampToDb,
  type WindowKind,
} from '@/engine/dsp/fft';
import { computeStats } from '@/engine/dsp/measurements';
import {
  clearPlot,
  drawGrid,
  drawScopeTrace,
  drawSpectrum,
  drawSpectrogram,
  drawHeatLegend,
  drawFreqAxis,
  findTrigger,
  freqToX,
  xToFreq,
  PLOT_COLORS,
} from '@/viz/plot';
import type { GraphNode } from '@/model/types';
import { edgeInto } from '@/engine/graph';

function useRedraw(draw: () => void, extraDeps: unknown[] = []): void {
  const liveTick = useUiStore((s) => s.liveTick);
  const captureRevision = useUiStore((s) => s.captureRevision);
  const runMode = useUiStore((s) => s.runMode);
  const graphRevision = useProjectStore((s) => s.graphRevision);
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick, captureRevision, runMode, graphRevision, ...extraDeps]);
}

/** Track a hover cursor in canvas pixel coordinates. */
function useCursor(): {
  cursor: { x: number; y: number } | null;
  handlers: {
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerLeave: () => void;
  };
} {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  return {
    cursor,
    handlers: {
      onPointerMove: (e) => {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const canvas = e.target as HTMLCanvasElement;
        setCursor({
          x: ((e.clientX - rect.left) / rect.width) * canvas.width,
          y: ((e.clientY - rect.top) / rect.height) * canvas.height,
        });
      },
      onPointerLeave: () => setCursor(null),
    },
  };
}

const readoutStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 8.5,
  color: 'var(--text-dim)',
  padding: '2px 2px 0',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

export function ScopeMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cursor, handlers } = useCursor();
  const frozen = useRef<Float32Array | null>(null);
  const [measure, setMeasure] = useState<string>('');
  const [cursorText, setCursorText] = useState<string>('');

  useRedraw(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const sr = useProjectStore.getState().project.sampleRate;
    const timeWindow = Number(node.params['timeWindow'] ?? 20) / 1000;
    const yScale = Number(node.params['yScale'] ?? 1.2);
    const freeze = node.params['freeze'] === true;
    const want = Math.max(32, Math.round(timeWindow * sr));
    const offset = Math.round((Number(node.params['xoffset'] ?? 0) / 1000) * sr);

    let windowData: Float32Array | null = null;
    if (freeze && frozen.current) {
      windowData = frozen.current;
    } else {
      const data = getSignalWindow(node.id, want * 2 + offset);
      if (data && data.length >= 8) {
        const usable = offset > 0 ? data.subarray(0, Math.max(8, data.length - offset)) : data;
        const trig = findTrigger(
          usable,
          String(node.params['trigMode'] ?? 'rising') as 'off' | 'rising' | 'falling',
          Number(node.params['trigLevel'] ?? 0),
          Math.max(0, usable.length - want),
        );
        windowData = usable.subarray(trig, Math.min(usable.length, trig + want));
        if (freeze) frozen.current = new Float32Array(windowData);
      }
    }
    if (!freeze) frozen.current = null;

    clearPlot(ctx, w, h);
    drawGrid(ctx, w, h, 10, 4);
    // Trigger level line
    const trigLevel = Number(node.params['trigLevel'] ?? 0);
    if (String(node.params['trigMode']) !== 'off') {
      ctx.strokeStyle = 'rgba(255,180,84,0.4)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      const ty = h / 2 - (trigLevel / yScale) * (h / 2);
      ctx.moveTo(0, ty);
      ctx.lineTo(w, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!windowData || windowData.length < 2) {
      setMeasure('');
      return;
    }
    drawScopeTrace(ctx, w, h, windowData, { yScale, drawDots: windowData.length < 60 });

    // Measurements: peak-to-peak + period/frequency estimate
    const stats = computeStats(windowData, sr);
    const periodMs = stats.dominantFreq > 0 ? 1000 / stats.dominantFreq : 0;
    setMeasure(
      `Vpp ${stats.peakToPeak.toFixed(3)}  ·  T ${periodMs > 0 ? periodMs.toFixed(2) : '—'} ms  ·  f ${
        stats.dominantFreq > 0 ? stats.dominantFreq.toFixed(1) : '—'
      } Hz${freeze ? '  ·  FROZEN' : ''}`,
    );

    // Cursor
    if (cursor) {
      ctx.strokeStyle = PLOT_COLORS.cursor;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cursor.x, 0);
      ctx.lineTo(cursor.x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      const idx = Math.min(windowData.length - 1, Math.round((cursor.x / w) * windowData.length));
      const t = (idx / sr) * 1000;
      const v = windowData[idx];
      setCursorText(`▸ t ${t.toFixed(2)} ms · x ${v.toFixed(3)}`);
    } else {
      setCursorText('');
    }
  }, [cursor, node.params]);

  return (
    <div style={{ width: '100%' }}>
      <div className="node-screen" style={{ height: 110 }}>
        <canvas ref={ref} width={300} height={110} {...handlers} />
        <span className="screen-tag">SCOPE</span>
      </div>
      <div style={readoutStyle} aria-live="off">
        <span>{measure || 'no signal'}</span>
        <span style={{ color: PLOT_COLORS.cursor }}>{cursorText}</span>
      </div>
    </div>
  );
}

export function SpectrumMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cursor, handlers } = useCursor();
  const [measure, setMeasure] = useState('');
  const [cursorText, setCursorText] = useState('');

  useRedraw(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    clearPlot(ctx, w, h);
    drawGrid(ctx, w, h, 10, 4);
    const sr = useProjectStore.getState().project.sampleRate;
    const fftSize = parseInt(String(node.params['fftSize'] ?? '2048'));
    const scale = (node.params['freqScale'] === 'linear' ? 'linear' : 'log') as 'log' | 'linear';
    const data = getSignalWindow(node.id, fftSize);
    if (!data || data.length < 64) {
      setMeasure('');
      return;
    }
    const spec = computeSpectrum(
      data,
      sr,
      fftSize,
      String(node.params['window'] ?? 'hann') as WindowKind,
    );
    const dom = dominantFrequency(spec);
    // Dominant + harmonic markers
    const markers: { freq: number; label?: string }[] = [];
    if (dom.amplitude > 0.005 && dom.freq > 0) {
      markers.push({ freq: dom.freq, label: `${dom.freq.toFixed(0)}` });
      for (let k = 2; k <= 5; k++) {
        if (dom.freq * k < sr / 2) markers.push({ freq: dom.freq * k });
      }
    }
    drawSpectrum(ctx, w, h, spec, {
      freqScale: scale,
      ampScale: (node.params['ampScale'] === 'linear' ? 'linear' : 'db') as 'db' | 'linear',
      maxFreq: sr / 2,
      markers,
      cursorFreq: cursor ? xToFreq(cursor.x, w, scale, 20, sr / 2) : null,
    });
    drawFreqAxis(ctx, w, h, scale, 20, sr / 2);
    setMeasure(
      dom.amplitude > 0.005
        ? `peak ${dom.freq >= 1000 ? (dom.freq / 1000).toFixed(2) + ' kHz' : dom.freq.toFixed(1) + ' Hz'} @ ${ampToDb(dom.amplitude).toFixed(1)} dB · Δf ${(sr / fftSize).toFixed(1)} Hz`
        : `Δf ${(sr / fftSize).toFixed(1)} Hz/bin`,
    );
    if (cursor) {
      const f = xToFreq(cursor.x, w, scale, 20, sr / 2);
      const bin = Math.min(spec.magnitudes.length - 1, Math.max(0, Math.round(f / spec.binHz)));
      setCursorText(
        `▸ ${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : f.toFixed(0) + ' Hz'} · ${ampToDb(spec.magnitudes[bin]).toFixed(1)} dB`,
      );
    } else {
      setCursorText('');
    }
  }, [cursor, node.params]);

  return (
    <div style={{ width: '100%' }}>
      <div className="node-screen" style={{ height: 110 }}>
        <canvas ref={ref} width={300} height={110} {...handlers} />
        <span className="screen-tag">SPECTRUM</span>
      </div>
      <div style={readoutStyle} aria-live="off">
        <span>{measure || 'no signal'}</span>
        <span style={{ color: PLOT_COLORS.cursor }}>{cursorText}</span>
      </div>
    </div>
  );
}

export function SpectrogramMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cursor, handlers } = useCursor();
  const [cursorText, setCursorText] = useState('');
  const [info, setInfo] = useState('');

  useRedraw(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    clearPlot(ctx, w, h);
    const sr = useProjectStore.getState().project.sampleRate;
    const fftSize = parseInt(String(node.params['fftSize'] ?? '1024'));
    const data = getSignalWindow(node.id, 32768);
    const plotW = w - 14;
    if (!data || data.length < fftSize * 2) {
      setInfo('');
      return;
    }
    const sg = computeSpectrogram(
      data,
      sr,
      fftSize,
      Number(node.params['overlap'] ?? 0.5),
      String(node.params['window'] ?? 'hann') as WindowKind,
      plotW,
    );
    const maxF = Math.min(sr / 2, 20000);
    drawSpectrogram(ctx, plotW, h, sg, maxF);
    // dB legend strip on the right
    ctx.save();
    ctx.translate(w - 10, 4);
    drawHeatLegend(ctx, 8, h - 8);
    ctx.restore();
    const span = (data.length / sr).toFixed(2);
    setInfo(`${span}s · Δf ${(sr / fftSize).toFixed(0)} Hz · Δt ${(sg.hopSeconds * 1000).toFixed(0)} ms`);
    if (cursor && cursor.x < plotW) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(cursor.x, 0);
      ctx.lineTo(cursor.x, h);
      ctx.moveTo(0, cursor.y);
      ctx.lineTo(plotW, cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const t = (cursor.x / plotW) * (data.length / sr);
      const f = (1 - cursor.y / h) * maxF;
      setCursorText(
        `▸ ${t.toFixed(2)} s · ${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : f.toFixed(0) + ' Hz'}`,
      );
    } else {
      setCursorText('');
    }
  }, [cursor, node.params]);

  return (
    <div style={{ width: '100%' }}>
      <div className="node-screen" style={{ height: 110 }}>
        <canvas ref={ref} width={300} height={110} {...handlers} />
        <span className="screen-tag">SPECTROGRAM</span>
      </div>
      <div style={readoutStyle} aria-live="off">
        <span>{info || 'gathering signal…'}</span>
        <span style={{ color: PLOT_COLORS.cursor }}>{cursorText}</span>
      </div>
    </div>
  );
}

export function StatsMini({ node }: { node: GraphNode }) {
  const liveTick = useUiStore((s) => s.liveTick);
  const captureRevision = useUiStore((s) => s.captureRevision);
  const runMode = useUiStore((s) => s.runMode);
  const graph = useProjectStore((s) => s.project.graph);
  const sr = useProjectStore((s) => s.project.sampleRate);
  void liveTick;
  void captureRevision;
  void runMode;
  const connected = !!edgeInto(graph, node.id, 'in');
  const data = connected ? getSignalWindow(node.id, 16384) : null;
  const stats = data && data.length >= 64 ? computeStats(data, sr) : null;
  return (
    <div
      className="node-screen"
      style={{ height: 128, padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 9.5 }}
    >
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 10px' }}>
          <Cell k="RMS" v={stats.rms.toFixed(3)} />
          <Cell k="PEAK" v={stats.peak.toFixed(3)} warn={stats.peak > 1} />
          <Cell k="MEAN" v={stats.mean.toFixed(3)} warn={Math.abs(stats.mean) > 0.1} />
          <Cell k="P-P" v={stats.peakToPeak.toFixed(3)} />
          <Cell k="MIN/MAX" v={`${stats.min.toFixed(2)}/${stats.max.toFixed(2)}`} />
          <Cell k="CREST" v={stats.crestFactor.toFixed(2)} />
          <Cell
            k="DOM"
            v={
              stats.dominantFreq >= 1000
                ? `${(stats.dominantFreq / 1000).toFixed(2)}kHz`
                : `${stats.dominantFreq.toFixed(1)}Hz`
            }
          />
          <Cell
            k="SNR~"
            v={stats.snrEstimateDb === null ? '—' : `${stats.snrEstimateDb.toFixed(1)}dB`}
          />
          <Cell k="CLIP" v={`${stats.clippingPct.toFixed(1)}%`} warn={stats.clippingPct > 0.5} />
          <Cell k="ZCR" v={`${stats.zeroCrossingRate.toFixed(0)}/s`} />
          <Cell k="DUR" v={`${stats.duration.toFixed(2)}s`} />
          <Cell k="N" v={`${stats.sampleCount}`} />
        </div>
      ) : (
        <div style={{ color: PLOT_COLORS.text, paddingTop: 44, textAlign: 'center' }}>
          {connected ? 'awaiting signal — press play or capture' : 'no input connected'}
        </div>
      )}
      <span className="screen-tag">METER</span>
    </div>
  );
}

function Cell({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
      <span style={{ color: PLOT_COLORS.text }}>{k}</span>
      <span style={{ color: warn ? '#ffb454' : '#43e08a' }}>{v}</span>
    </div>
  );
}

// re-export for potential external use
export { freqToX };
