/**
 * Experiment report generator: a fully self-contained HTML document with the
 * signal chain, node settings, measurements, analyzer captures (as embedded
 * PNG data URIs), notes, warnings and formulas. Print-friendly for PDF.
 */

import type { Project } from '@/model/types';
import { getNodeDef } from '@/engine/registry';
import { topologicalOrder, signalPathLabel } from '@/engine/graph';
import type { SignalStats } from '@/engine/dsp/measurements';
import type { ExplainItem } from '@/explain/explain';
import { APP_VERSION } from '@/model/schema';

export interface ReportInputs {
  project: Project;
  diagramPng: string | null; // data URI
  analyzerShots: { title: string; dataUri: string }[];
  measurements: { nodeTitle: string; stats: SignalStats }[];
  warnings: ExplainItem[];
  includeFormulas: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildReportHtml(inputs: ReportInputs): string {
  const { project } = inputs;
  const now = new Date();
  const order = topologicalOrder(project.graph).order;

  const nodeRows = order
    .map((id) => {
      const node = project.graph.nodes.find((n) => n.id === id);
      if (!node) return '';
      const def = getNodeDef(node.type);
      const params = def.params
        .map((p) => {
          const v = node.params[p.id] ?? p.default;
          return `${esc(p.label)}: <b>${esc(String(v))}${p.unit ? ' ' + p.unit : ''}</b>`;
        })
        .join(' · ');
      return `<tr><td>${esc(def.title)}</td><td class="mono">${esc(id)}</td><td>${params || '—'}</td></tr>`;
    })
    .join('');

  const statsRows = inputs.measurements
    .map(
      (m) => `
      <tr><td>${esc(m.nodeTitle)}</td>
      <td class="mono">${m.stats.rms.toFixed(4)}</td>
      <td class="mono">${m.stats.peak.toFixed(4)}</td>
      <td class="mono">${m.stats.mean.toFixed(4)}</td>
      <td class="mono">${m.stats.dominantFreq.toFixed(1)} Hz</td>
      <td class="mono">${m.stats.snrEstimateDb === null ? '—' : m.stats.snrEstimateDb.toFixed(1) + ' dB'}</td>
      <td class="mono">${m.stats.clippingPct.toFixed(2)}%</td></tr>`,
    )
    .join('');

  const warningItems = inputs.warnings
    .map(
      (w) =>
        `<li class="${w.severity}"><span class="tag ${w.kind}">${w.kind}</span> ${esc(w.text)}</li>`,
    )
    .join('');

  const shots = inputs.analyzerShots
    .map(
      (s) => `
      <figure><img src="${s.dataUri}" alt="${esc(s.title)}"><figcaption>${esc(s.title)}</figcaption></figure>`,
    )
    .join('');

  const formulas = inputs.includeFormulas
    ? order
        .map((id) => {
          const node = project.graph.nodes.find((n) => n.id === id);
          if (!node) return '';
          const def = getNodeDef(node.type);
          if (!def.math) return '';
          return `<div class="formula"><h4>${esc(def.title)}</h4><pre>${esc(def.math.equations.join('\n'))}</pre><p>${esc(def.math.interpretation)}</p></div>`;
        })
        .filter(Boolean)
        .join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Experiment Report — ${esc(project.name)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #26221c; background: #f4efe4;
         max-width: 880px; margin: 0 auto; padding: 40px 32px; line-height: 1.55; }
  header { border-bottom: 3px double #6d6353; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-family: 'Arial Narrow', Arial, sans-serif; text-transform: uppercase;
       letter-spacing: 0.08em; font-size: 26px; margin: 0; }
  .meta { font-family: 'Courier New', monospace; font-size: 12px; color: #6d6353; }
  h2 { font-family: 'Arial Narrow', Arial, sans-serif; text-transform: uppercase;
       letter-spacing: 0.1em; font-size: 15px; border-bottom: 1px solid #b9ae9a;
       padding-bottom: 4px; margin-top: 30px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #d8cfbe; vertical-align: top; }
  th { font-family: 'Arial Narrow', Arial, sans-serif; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
  .mono { font-family: 'Courier New', monospace; font-size: 11.5px; }
  figure { margin: 14px 0; }
  figure img { max-width: 100%; border: 1px solid #b9ae9a; }
  figcaption { font-size: 11px; color: #6d6353; font-family: 'Courier New', monospace; margin-top: 4px; }
  .tag { display: inline-block; font-family: 'Courier New', monospace; font-size: 10px;
         text-transform: uppercase; border: 1px solid #8a7f6c; padding: 0 5px; border-radius: 2px; margin-right: 6px; }
  li.warn { color: #8a5a12; } li.error { color: #8a2a26; }
  .notes { background: #fbf8f0; border: 1px solid #d8cfbe; padding: 12px 16px; white-space: pre-wrap; }
  .formula { margin: 12px 0; } .formula h4 { margin: 0 0 4px; }
  .formula pre { background: #fbf8f0; border: 1px solid #d8cfbe; padding: 8px 12px; overflow-x: auto; font-size: 11.5px; }
  footer { margin-top: 36px; border-top: 1px solid #b9ae9a; padding-top: 10px;
           font-size: 11px; color: #6d6353; font-family: 'Courier New', monospace; }
  @media print { body { background: #fff; padding: 10px; } }
</style>
</head>
<body>
<header>
  <h1>Signal Processing Playground — Experiment Report</h1>
  <div class="meta">Project: ${esc(project.name)} · Generated: ${now.toLocaleString()} · Sample rate: ${project.sampleRate} Hz · App v${APP_VERSION}</div>
</header>

<h2>Signal Chain</h2>
${inputs.diagramPng ? `<figure><img src="${inputs.diagramPng}" alt="Signal chain diagram"><figcaption>Node graph (${project.graph.nodes.length} modules, ${project.graph.edges.length} cables)</figcaption></figure>` : `<p class="mono">${esc(project.graph.nodes.map((n) => signalPathLabel(project.graph, n.id, 1)).join(' · '))}</p>`}

<h2>Module Settings</h2>
<table><thead><tr><th>Module</th><th>ID</th><th>Parameters</th></tr></thead><tbody>${nodeRows}</tbody></table>

${statsRows ? `<h2>Measurements</h2>
<table><thead><tr><th>Point</th><th>RMS</th><th>Peak</th><th>Mean (DC)</th><th>Dominant</th><th>SNR est.</th><th>Clipping</th></tr></thead><tbody>${statsRows}</tbody></table>` : ''}

${shots ? `<h2>Analyzer Captures</h2>${shots}` : ''}

${warningItems ? `<h2>Observations &amp; Warnings</h2><ul>${warningItems}</ul>` : ''}

${project.notes ? `<h2>Notes</h2><div class="notes">${esc(project.notes)}</div>` : ''}

${formulas ? `<h2>Relevant Formulas</h2>${formulas}` : ''}

<footer>Generated client-side by Signal Processing Playground v${APP_VERSION}. Educational tool — measurements are estimates, not laboratory-calibrated values.</footer>
</body>
</html>`;
}
