/**
 * Mini instrument screens embedded in analyzer nodes on the canvas.
 * They redraw on the live tick / capture revision and read signal windows
 * from the engine layer — no DSP in components beyond calling helpers.
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '@/state/uiStore';
import { getSignalWindow } from '@/state/engines';
import { useProjectStore } from '@/state/projectStore';
import { computeSpectrum, computeSpectrogram, type WindowKind } from '@/engine/dsp/fft';
import { computeStats } from '@/engine/dsp/measurements';
import {
  clearPlot,
  drawGrid,
  drawScopeTrace,
  drawSpectrum,
  drawSpectrogram,
  findTrigger,
  PLOT_COLORS,
} from '@/viz/plot';
import type { GraphNode } from '@/model/types';
import { edgeInto } from '@/engine/graph';

/** The node this analyzer measures: its own passthrough output. */
function useRedraw(draw: () => void): void {
  const liveTick = useUiStore((s) => s.liveTick);
  const captureRevision = useUiStore((s) => s.captureRevision);
  const runMode = useUiStore((s) => s.runMode);
  const graphRevision = useProjectStore((s) => s.graphRevision);
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick, captureRevision, runMode, graphRevision]);
}

export function ScopeMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    const timeWindow = Number(node.params['timeWindow'] ?? 20) / 1000;
    const want = Math.max(32, Math.round(timeWindow * sr));
    // Fetch extra so the trigger search has room
    const data = getSignalWindow(node.id, want * 2);
    if (!data || data.length < 8) return;
    const trig = findTrigger(
      data,
      String(node.params['trigMode'] ?? 'rising') as 'off' | 'rising' | 'falling',
      Number(node.params['trigLevel'] ?? 0),
      Math.max(0, data.length - want),
    );
    const windowData = data.subarray(trig, Math.min(data.length, trig + want));
    drawScopeTrace(ctx, w, h, windowData, {
      yScale: Number(node.params['yScale'] ?? 1.2),
      drawDots: windowData.length < 60,
    });
  });
  return (
    <div className="node-screen" style={{ height: 110 }}>
      <canvas ref={ref} width={300} height={110} />
      <span className="screen-tag">SCOPE</span>
    </div>
  );
}

export function SpectrumMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    const data = getSignalWindow(node.id, fftSize);
    if (!data || data.length < 64) return;
    const spec = computeSpectrum(
      data,
      sr,
      fftSize,
      String(node.params['window'] ?? 'hann') as WindowKind,
    );
    drawSpectrum(ctx, w, h, spec, {
      freqScale: (node.params['freqScale'] === 'linear' ? 'linear' : 'log') as 'log' | 'linear',
      ampScale: (node.params['ampScale'] === 'linear' ? 'linear' : 'db') as 'db' | 'linear',
      maxFreq: sr / 2,
    });
  });
  return (
    <div className="node-screen" style={{ height: 110 }}>
      <canvas ref={ref} width={300} height={110} />
      <span className="screen-tag">SPECTRUM</span>
    </div>
  );
}

export function SpectrogramMini({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    if (!data || data.length < fftSize * 2) return;
    const sg = computeSpectrogram(
      data,
      sr,
      fftSize,
      Number(node.params['overlap'] ?? 0.5),
      String(node.params['window'] ?? 'hann') as WindowKind,
      w,
    );
    drawSpectrogram(ctx, w, h, sg, Math.min(sr / 2, 20000));
  });
  return (
    <div className="node-screen" style={{ height: 110 }}>
      <canvas ref={ref} width={300} height={110} />
      <span className="screen-tag">SPECTROGRAM</span>
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
      style={{ height: 110, padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 9.5 }}
    >
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 10px' }}>
          <Cell k="RMS" v={stats.rms.toFixed(3)} />
          <Cell k="PEAK" v={stats.peak.toFixed(3)} warn={stats.peak > 1} />
          <Cell k="MEAN" v={stats.mean.toFixed(3)} warn={Math.abs(stats.mean) > 0.1} />
          <Cell k="P-P" v={stats.peakToPeak.toFixed(3)} />
          <Cell
            k="DOM"
            v={
              stats.dominantFreq >= 1000
                ? `${(stats.dominantFreq / 1000).toFixed(2)}kHz`
                : `${stats.dominantFreq.toFixed(1)}Hz`
            }
          />
          <Cell
            k="SNR"
            v={stats.snrEstimateDb === null ? '—' : `${stats.snrEstimateDb.toFixed(1)}dB`}
          />
          <Cell k="CLIP" v={`${stats.clippingPct.toFixed(1)}%`} warn={stats.clippingPct > 0.5} />
          <Cell k="CREST" v={stats.crestFactor.toFixed(2)} />
        </div>
      ) : (
        <div style={{ color: PLOT_COLORS.text, paddingTop: 34, textAlign: 'center' }}>
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
