/**
 * Deterministic "Explain This Signal" engine.
 *
 * Pure rules over measured statistics and graph context — no AI, no
 * randomness. Every explanation is tagged:
 *   measured  — a direct statement of a computed value
 *   heuristic — an interpretation that could be wrong in edge cases
 *   tip       — an educational suggestion for what to try next
 */

import type { ProjectGraph } from '@/model/types';
import { getNodeDef } from '@/engine/registry';
import { findNode, edgeInto, signalPathLabel } from '@/engine/graph';
import { computeStats, type SignalStats } from '@/engine/dsp/measurements';

export type ExplainKind = 'measured' | 'heuristic' | 'tip';
export type ExplainSeverity = 'info' | 'warn' | 'error';

export interface ExplainItem {
  kind: ExplainKind;
  severity: ExplainSeverity;
  text: string;
}

const fmt = (v: number, digits = 2) =>
  Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(digits);

const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(1)} Hz`);

/**
 * Explain the signal at a node given a window of its output samples.
 * `stats` may be precomputed by the caller (e.g. the stats meter).
 */
export function explainSignal(
  graph: ProjectGraph,
  nodeId: string,
  signal: Float32Array | null,
  sampleRate: number,
  precomputed?: SignalStats,
): ExplainItem[] {
  const items: ExplainItem[] = [];
  const node = findNode(graph, nodeId);
  if (!node) return items;
  const def = getNodeDef(node.type);

  // --- Graph-context rules (work even with no signal) ---
  if (def.inputs.length > 0) {
    const connected = def.inputs.some((p) => edgeInto(graph, nodeId, p.id));
    if (!connected) {
      items.push({
        kind: 'measured',
        severity: 'warn',
        text: `${def.title} has no input cable, so its output is silence. Connect a source to its input port.`,
      });
      return items;
    }
  }
  if (def.category === 'analyze') {
    const hasInput = edgeInto(graph, nodeId, 'in');
    if (hasInput) {
      const upstream = graph.edges.find((e) => e.to === nodeId && e.toPort === 'in');
      const upNode = upstream ? findNode(graph, upstream.from) : null;
      if (upNode && getNodeDef(upNode.type).category === 'analyze') {
        items.push({
          kind: 'tip',
          severity: 'info',
          text: 'This analyzer is chained after another analyzer. That is fine (analyzers pass signals through unchanged), but placing analyzers on separate branches can keep chains easier to read.',
        });
      }
    }
  }

  if (!signal || signal.length < 64) {
    items.push({
      kind: 'measured',
      severity: 'info',
      text: 'No signal data yet at this node. Press Play (live mode) or run a Capture to produce samples.',
    });
    return items;
  }

  const stats = precomputed ?? computeStats(signal, sampleRate);
  const nyquist = sampleRate / 2;
  const path = signalPathLabel(graph, nodeId);

  // --- Silence / level rules ---
  if (stats.rms < 1e-5) {
    items.push({
      kind: 'measured',
      severity: 'warn',
      text: `The signal here is essentially silent (RMS ${stats.rms.toExponential(1)}). Check levels upstream in “${path}”.`,
    });
    return items;
  }

  // --- Clipping ---
  if (stats.clippingPct > 0.5) {
    items.push({
      kind: 'measured',
      severity: stats.clippingPct > 5 ? 'error' : 'warn',
      text: `${fmt(stats.clippingPct, 1)}% of samples sit at or beyond full scale (|x| ≥ 0.985) — the waveform is clipping. Peak level is ${fmt(stats.peak)}.`,
    });
    items.push({
      kind: 'tip',
      severity: 'info',
      text: 'Reduce an upstream Gain (a few dB is often enough) or lower source amplitudes; clipping adds odd harmonics you can see in a Spectrum Analyzer.',
    });
  } else if (stats.peak > 1.001) {
    items.push({
      kind: 'measured',
      severity: 'warn',
      text: `Peak amplitude is ${fmt(stats.peak)} — beyond the ±1.0 full-scale range. It will be limited before playback, which distorts.`,
    });
  }

  // --- DC offset ---
  if (Math.abs(stats.mean) > 0.05 && Math.abs(stats.mean) > 0.1 * Math.max(stats.rms, 1e-6)) {
    items.push({
      kind: 'measured',
      severity: Math.abs(stats.mean) > 0.3 ? 'warn' : 'info',
      text: `Mean value is ${fmt(stats.mean, 3)} — a DC offset. DC carries no sound but wastes headroom.`,
    });
    items.push({
      kind: 'tip',
      severity: 'info',
      text: 'A High-Pass Filter with a very low cutoff (10–20 Hz) removes DC without touching audible content.',
    });
  }

  // --- Dominant frequency & audibility ---
  if (stats.dominantFreq > 0 && stats.dominantAmp > 0.01) {
    items.push({
      kind: 'measured',
      severity: 'info',
      text: `Dominant component: ${fmtHz(stats.dominantFreq)} at amplitude ${fmt(stats.dominantAmp)}.`,
    });
    if (stats.dominantFreq < 20) {
      items.push({
        kind: 'heuristic',
        severity: 'info',
        text: `The dominant component (${fmtHz(stats.dominantFreq)}) is below the ~20 Hz lower limit of human hearing — you will see it on the oscilloscope but hear little or nothing.`,
      });
    } else if (stats.dominantFreq > 16000) {
      items.push({
        kind: 'heuristic',
        severity: 'info',
        text: `The dominant component (${fmtHz(stats.dominantFreq)}) is near/above the upper limit of most adults' hearing (~16–18 kHz); it may be inaudible even though instruments show it clearly.`,
      });
    }
    // Aliasing risk
    if (stats.dominantFreq > nyquist * 0.9) {
      items.push({
        kind: 'heuristic',
        severity: 'warn',
        text: `The dominant frequency is within 10% of the Nyquist limit (${fmtHz(nyquist)}). Content this high is poorly represented and any nonlinearity will alias.`,
      });
    }
  }

  // --- Aliasing sources upstream ---
  const srcNode = findNode(graph, nodeId);
  if (srcNode) {
    const params = srcNode.params;
    const freqParam = typeof params['freq'] === 'number' ? (params['freq'] as number) : null;
    if (freqParam !== null && freqParam > nyquist) {
      items.push({
        kind: 'measured',
        severity: 'error',
        text: `This node is set to ${fmtHz(freqParam)}, above the Nyquist limit of ${fmtHz(nyquist)} for the ${sampleRate} Hz project rate. It will alias to ${fmtHz(Math.abs(freqParam - Math.round(freqParam / sampleRate) * sampleRate))}.`,
      });
    }
    if (srcNode.type === 'src.square' || srcNode.type === 'src.sawtooth') {
      if (freqParam !== null && freqParam > nyquist / 10) {
        items.push({
          kind: 'heuristic',
          severity: 'info',
          text: `${def.title} at ${fmtHz(freqParam)} generates harmonics beyond the Nyquist limit; the extra spectral lines you may see are aliased harmonics (this playground uses ideal, non-band-limited shapes on purpose).`,
        });
      }
    }
    if (srcNode.type === 'proc.srconvert') {
      const target = typeof params['targetRate'] === 'number' ? (params['targetRate'] as number) : 8000;
      const anti = params['antialias'] !== false;
      if (!anti) {
        items.push({
          kind: 'measured',
          severity: 'warn',
          text: `The resampler runs at ${fmtHz(target)} with its anti-alias filter OFF: any input content above ${fmtHz(target / 2)} folds back into the passband.`,
        });
      }
    }
    if (srcNode.type === 'proc.feedback') {
      const fb = typeof params['feedback'] === 'number' ? (params['feedback'] as number) : 0;
      if (fb > 0.85) {
        items.push({
          kind: 'heuristic',
          severity: 'warn',
          text: `Feedback gain is ${fmt(fb)} — echoes decay very slowly (each repeat keeps ${fmt(fb * 100, 0)}% of the last). Values are capped below 1.0 so the loop cannot run away, but levels can build up.`,
        });
      }
    }
    if (srcNode.type === 'proc.quantize' || srcNode.type === 'proc.bitcrush') {
      items.push({
        kind: 'heuristic',
        severity: 'info',
        text: 'The broadband floor you may see in the spectrum here is quantization noise: the rounding error of forcing samples onto discrete levels.',
      });
    }
  }

  // --- SNR ---
  if (stats.snrEstimateDb !== null && stats.dominantAmp > 0.02) {
    const snr = stats.snrEstimateDb;
    items.push({
      kind: 'measured',
      severity: snr < 10 ? 'warn' : 'info',
      text: `Estimated SNR: ${fmt(snr, 1)} dB (dominant spectral peak vs. everything else).`,
    });
    if (snr < 10) {
      items.push({
        kind: 'tip',
        severity: 'info',
        text: 'To improve SNR for a single tone, try a Band-Pass Filter centered on the tone — it keeps the signal band and rejects broadband noise.',
      });
    }
  }

  // --- Crest factor heuristics ---
  if (stats.crestFactor > 0 && stats.crestFactor < 1.15 && stats.clippingPct < 50) {
    items.push({
      kind: 'heuristic',
      severity: 'info',
      text: `Crest factor is ${fmt(stats.crestFactor)} (peak ≈ RMS): the waveform is square-like or heavily clipped/saturated. A pure sine measures √2 ≈ 1.41.`,
    });
  }

  // --- FFT resolution note for analyzers ---
  if (node.type === 'ana.spectrum' || node.type === 'ana.spectrogram') {
    const fftSize = parseInt(String(node.params['fftSize'] ?? '2048'));
    const res = sampleRate / fftSize;
    items.push({
      kind: 'measured',
      severity: 'info',
      text: `Frequency resolution at the current FFT size (${fftSize}) is ${fmt(res, 1)} Hz per bin. Two tones closer than ~${fmt(res * 2, 1)} Hz will merge into one peak.`,
    });
  }

  if (items.length === 0) {
    items.push({
      kind: 'measured',
      severity: 'info',
      text: `Signal looks healthy: peak ${fmt(stats.peak)}, RMS ${fmt(stats.rms)}, no clipping, negligible DC.`,
    });
  }
  return items;
}
