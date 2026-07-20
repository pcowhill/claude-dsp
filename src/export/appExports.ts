/**
 * High-level export operations that pull data from the running app:
 * analyzer screenshots, diagram capture, WAV/CSV of captured signals and the
 * experiment report.
 */

import { toPng } from 'html-to-image';
import { getNodeDef } from '@/engine/registry';
import { computeSpectrum, computeSpectrogram, type WindowKind } from '@/engine/dsp/fft';
import { computeStats } from '@/engine/dsp/measurements';
import { explainSignal } from '@/explain/explain';
import {
  clearPlot,
  drawGrid,
  drawScopeTrace,
  drawSpectrum,
  drawSpectrogram,
  drawFreqAxis,
  drawHeatLegend,
  findTrigger,
  PLOT_COLORS,
} from '@/viz/plot';
import { useProjectStore } from '@/state/projectStore';
import { useUiStore, getCaptureResult } from '@/state/uiStore';
import { getSignalWindow, getFullSignal } from '@/state/engines';
import { encodeWav, encodeCsv, downloadBlob, sanitize } from './exporters';
import { buildReportHtml } from './report';

/** Render an analyzer node's current view to a high-res offscreen canvas. */
export function renderAnalyzerCanvas(nodeId: string): HTMLCanvasElement | null {
  const { project } = useProjectStore.getState();
  const node = project.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const sr = project.sampleRate;
  const canvas = document.createElement('canvas');
  canvas.width = 880;
  canvas.height = 330;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  clearPlot(ctx, w, h);

  if (node.type === 'ana.scope') {
    drawGrid(ctx, w, h, 10, 6);
    const timeWindow = Number(node.params['timeWindow'] ?? 20) / 1000;
    const want = Math.max(32, Math.round(timeWindow * sr));
    const data = getSignalWindow(nodeId, want * 2);
    if (data && data.length >= 8) {
      const trig = findTrigger(
        data,
        String(node.params['trigMode'] ?? 'rising') as 'off' | 'rising' | 'falling',
        Number(node.params['trigLevel'] ?? 0),
        Math.max(0, data.length - want),
      );
      drawScopeTrace(ctx, w, h, data.subarray(trig, trig + want), {
        yScale: Number(node.params['yScale'] ?? 1.2),
      });
    }
    stamp(ctx, w, h, `OSCILLOSCOPE · ${(timeWindow * 1000).toFixed(1)} ms window · ±${node.params['yScale'] ?? 1.2}`);
    return canvas;
  }
  if (node.type === 'ana.spectrum') {
    drawGrid(ctx, w, h, 10, 6);
    const fftSize = parseInt(String(node.params['fftSize'] ?? '2048'));
    const data = getSignalWindow(nodeId, fftSize);
    if (data && data.length >= 64) {
      const spec = computeSpectrum(data, sr, fftSize, String(node.params['window'] ?? 'hann') as WindowKind);
      const scale = (node.params['freqScale'] === 'linear' ? 'linear' : 'log') as 'log' | 'linear';
      drawSpectrum(ctx, w, h, spec, {
        freqScale: scale,
        ampScale: (node.params['ampScale'] === 'linear' ? 'linear' : 'db') as 'db' | 'linear',
        maxFreq: sr / 2,
      });
      drawFreqAxis(ctx, w, h, scale, 20, sr / 2);
    }
    stamp(ctx, w, h, `SPECTRUM · FFT ${fftSize} · ${String(node.params['window'] ?? 'hann')} window · Δf ${(sr / fftSize).toFixed(2)} Hz`);
    return canvas;
  }
  if (node.type === 'ana.spectrogram') {
    const fftSize = parseInt(String(node.params['fftSize'] ?? '1024'));
    const data = getSignalWindow(nodeId, 262144);
    if (data && data.length >= fftSize * 2) {
      const sg = computeSpectrogram(
        data,
        sr,
        fftSize,
        Number(node.params['overlap'] ?? 0.5),
        String(node.params['window'] ?? 'hann') as WindowKind,
        w - 30,
      );
      drawSpectrogram(ctx, w - 30, h, sg, Math.min(sr / 2, 20000));
      ctx.save();
      ctx.translate(w - 22, 10);
      drawHeatLegend(ctx, 12, h - 40);
      ctx.restore();
      ctx.fillStyle = PLOT_COLORS.text;
      ctx.font = '9px monospace';
      ctx.fillText('0 dB', w - 58, 16);
      ctx.fillText('-80', w - 52, h - 26);
    }
    stamp(ctx, w, h, `SPECTROGRAM · FFT ${fftSize} · overlap ${Number(node.params['overlap'] ?? 0.5) * 100}%`);
    return canvas;
  }
  return null;
}

function stamp(ctx: CanvasRenderingContext2D, w: number, _h: number, text: string): void {
  ctx.fillStyle = PLOT_COLORS.text;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillText(text, 8, 14);
  ctx.fillText('signal processing playground', w - 190, 14);
}

export async function exportAnalyzerPng(nodeId: string): Promise<void> {
  const canvas = renderAnalyzerCanvas(nodeId);
  if (!canvas) throw new Error('This node has no exportable view.');
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'),
  );
  const node = useProjectStore.getState().project.graph.nodes.find((n) => n.id === nodeId);
  const title = node ? getNodeDef(node.type).title : 'analyzer';
  downloadBlob(blob, `${sanitize(title)}-${nodeId.slice(-4)}.png`);
}

/** Snapshot the node-graph canvas (excluding controls/minimap) as PNG. */
export async function diagramPngDataUri(): Promise<string | null> {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!el) return null;
  try {
    return await toPng(el, {
      backgroundColor: '#1e2228',
      filter: (n) => {
        const cls = (n as HTMLElement).classList;
        return !cls || (!cls.contains('react-flow__minimap') && !cls.contains('react-flow__controls'));
      },
      pixelRatio: 1.5,
    });
  } catch {
    return null;
  }
}

export async function exportDiagramPng(): Promise<void> {
  const uri = await diagramPngDataUri();
  if (!uri) throw new Error('Could not render the diagram.');
  const res = await fetch(uri);
  downloadBlob(await res.blob(), `${sanitize(useProjectStore.getState().project.name)}-diagram.png`);
}

/** Export a node's signal as WAV (uses capture buffer when available). */
export function exportWav(nodeId: string): boolean {
  const sig = getFullSignal(nodeId);
  if (!sig || sig.data.length < 16) return false;
  downloadBlob(
    encodeWav(sig.data, sig.sampleRate),
    `${sanitize(useProjectStore.getState().project.name)}-${nodeId.slice(-4)}.wav`,
  );
  return true;
}

export function exportCsv(nodeId: string): boolean {
  const sig = getFullSignal(nodeId);
  if (!sig || sig.data.length < 2) return false;
  downloadBlob(
    encodeCsv(sig.data, sig.sampleRate),
    `${sanitize(useProjectStore.getState().project.name)}-${nodeId.slice(-4)}.csv`,
  );
  return true;
}

export async function exportReport(includeFormulas: boolean): Promise<void> {
  const { project } = useProjectStore.getState();
  const diagram = await diagramPngDataUri();
  const analyzerShots: { title: string; dataUri: string }[] = [];
  const measurements: { title: string; nodeId: string }[] = [];
  for (const node of project.graph.nodes) {
    const def = getNodeDef(node.type);
    if (def.category === 'analyze') {
      const canvas = renderAnalyzerCanvas(node.id);
      if (canvas) {
        analyzerShots.push({
          title: `${def.title} (${node.id})`,
          dataUri: canvas.toDataURL('image/png'),
        });
      }
    }
    if (def.category === 'analyze' || def.category === 'output') {
      measurements.push({ title: def.title, nodeId: node.id });
    }
  }
  const sr = getCaptureResult()?.sampleRate ?? project.sampleRate;
  const stats = measurements
    .map((m) => {
      const sig = getSignalWindow(m.nodeId, 65536);
      if (!sig || sig.length < 64) return null;
      return { nodeTitle: `${m.title} (${m.nodeId.slice(-4)})`, stats: computeStats(sig, sr) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warnings = project.graph.nodes.flatMap((n) => {
    const sig = getSignalWindow(n.id, 16384);
    return explainSignal(project.graph, n.id, sig, sr).filter((i) => i.severity !== 'info');
  });

  const html = buildReportHtml({
    project,
    diagramPng: diagram,
    analyzerShots,
    measurements: stats,
    warnings: warnings.slice(0, 20),
    includeFormulas,
  });
  downloadBlob(new Blob([html], { type: 'text/html' }), `${sanitize(project.name)}-report.html`);
}

export function hasSignalData(nodeId: string): boolean {
  const ui = useUiStore.getState();
  if (ui.runMode === 'capture') return !!getCaptureResult()?.buffers[nodeId];
  const sig = getSignalWindow(nodeId, 256);
  return !!sig && sig.length > 0;
}
