/**
 * Integration tests: lesson content integrity + goal checks against rendered
 * signals, explain rules, export encoders and share round trips.
 */

import { describe, it, expect } from 'vitest';
import { LESSONS } from '@/learn';
import type { GoalCtx } from '@/learn/types';
import { validateGraph } from '@/engine/graph';
import { runCapture } from '@/engine/capture';
import { computeStats } from '@/engine/dsp/measurements';
import { explainSignal } from '@/explain/explain';
import { encodeWav, encodeCsv } from '@/export/exporters';
import { exportProject, loadProject } from '@/model/schema';
import { compressToEncodedURIComponent } from 'lz-string';
import { loadFromHash } from '@/export/share';
import type { Project, ProjectGraph } from '@/model/types';
import { node, edge, graph } from '../unit/helpers';

function goalCtxFor(g: ProjectGraph, playing = true, duration = 0.5): GoalCtx {
  const result = runCapture({ graph: g, sampleRate: 48000, duration, seed: 5 });
  return {
    graph: g,
    sampleRate: 48000,
    playing,
    signal: (id, n = 16384) => {
      const buf = result.buffers[id];
      if (!buf) return null;
      return buf.length <= n ? buf : (buf.subarray(buf.length - n) as Float32Array);
    },
    stats: (id) => {
      const buf = result.buffers[id];
      return buf && buf.length >= 64 ? computeStats(buf, 48000) : null;
    },
    param: (id, pid) => g.nodes.find((n) => n.id === id)?.params[pid],
    nodeOfType: (type) => g.nodes.find((n) => n.type === type)?.id ?? null,
  };
}

describe('Lesson content integrity', () => {
  it('there are exactly ten lessons in course order', () => {
    expect(LESSONS.length).toBe(10);
    expect(LESSONS.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  for (const lesson of LESSONS) {
    it(`${lesson.title}: valid graph, coherent steps`, () => {
      const project = lesson.build();
      expect(validateGraph(project.graph)).toEqual([]);
      expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.closing.length).toBeGreaterThan(40);
      // Every lesson has at least one prediction and one measurable goal
      expect(lesson.steps.some((s) => s.prediction)).toBe(true);
      expect(lesson.steps.some((s) => (s.goals ?? []).length > 0)).toBe(true);
      // Predictions are answerable
      for (const s of lesson.steps) {
        if (s.prediction) {
          expect(s.prediction.correct).toBeLessThan(s.prediction.options.length);
          expect(s.prediction.reveal.length).toBeGreaterThan(20);
        }
      }
    });

    it(`${lesson.title}: goal checks run without crashing on the fresh bench`, () => {
      const project = lesson.build();
      const ctx = goalCtxFor(project.graph);
      for (const s of lesson.steps) {
        for (const g of s.goals ?? []) {
          const r = g.check(ctx);
          expect(typeof r.met).toBe('boolean');
        }
      }
    });
  }

  it('lesson 1 amplitude goal responds to the parameter change it teaches', () => {
    const lesson = LESSONS[0];
    const project = lesson.build();
    const ctxBefore = goalCtxFor(project.graph);
    const ampGoal = lesson.steps
      .flatMap((s) => s.goals ?? [])
      .find((g) => g.id === 'amp-change')!;
    expect(ampGoal.check(ctxBefore).met).toBe(false);
    const sine = project.graph.nodes.find((n) => n.id === 'sine')!;
    sine.params = { ...sine.params, amp: 0.85 };
    expect(ampGoal.check(goalCtxFor(project.graph)).met).toBe(true);
  });

  it('lesson 2 cancellation goal detects destructive interference', () => {
    const lesson = LESSONS[1];
    const project = lesson.build();
    const goal = lesson.steps.flatMap((s) => s.goals ?? []).find((g) => g.id === 'destructive')!;
    expect(goal.check(goalCtxFor(project.graph)).met).toBe(false);
    const b = project.graph.nodes.find((n) => n.id === 'sineB')!;
    b.params = { ...b.params, phase: 180 };
    expect(goal.check(goalCtxFor(project.graph)).met).toBe(true);
  });

  it('lesson 3 aliasing goal detects the folded frequency', () => {
    const lesson = LESSONS[2];
    const project = lesson.build();
    const goal = lesson.steps.flatMap((s) => s.goals ?? []).find((g) => g.id === 'aliased')!;
    expect(goal.check(goalCtxFor(project.graph)).met).toBe(false);
    const sine = project.graph.nodes.find((n) => n.id === 'sine')!;
    sine.params = { ...sine.params, freq: 5000 };
    expect(goal.check(goalCtxFor(project.graph)).met).toBe(true);
  });
});

describe('Explain This Signal rules', () => {
  const explain = (g: ProjectGraph, nodeId: string, duration = 0.4) => {
    const result = runCapture({ graph: g, sampleRate: 48000, duration, seed: 3 });
    return explainSignal(g, nodeId, result.buffers[nodeId] ?? null, 48000);
  };

  it('flags clipping with measured percentage', () => {
    const g = graph(
      [node('s', 'src.sine', { amp: 1.4 }), node('c', 'proc.clip', { threshold: 1 })],
      [edge('s', 'c')],
    );
    const items = explain(g, 'c');
    const clip = items.find((i) => i.text.includes('clipping'));
    expect(clip).toBeTruthy();
    expect(clip!.kind).toBe('measured');
    expect(clip!.text).toMatch(/\d+(\.\d+)?%/);
  });

  it('flags DC offset and suggests a high-pass', () => {
    const g = graph(
      [node('s', 'src.sine', { amp: 0.4, offset: 0.4 })],
      [],
    );
    const items = explain(g, 's');
    expect(items.some((i) => i.text.includes('DC offset'))).toBe(true);
    expect(items.some((i) => i.kind === 'tip' && i.text.includes('High-Pass'))).toBe(true);
  });

  it('flags sources set above Nyquist with the alias frequency', () => {
    const g = graph([node('s', 'src.sine', { freq: 30000 })], []);
    // 30 kHz at 48 kHz rate → param clamp allows 20 kHz max... use param direct
    g.nodes[0].params['freq'] = 30000;
    const items = explain(g, 's');
    const alias = items.find((i) => i.text.includes('Nyquist'));
    expect(alias).toBeTruthy();
    expect(alias!.severity).toBe('error');
  });

  it('reports disconnected processing inputs', () => {
    const g = graph([node('f', 'proc.lowpass')], []);
    const items = explainSignal(g, 'f', null, 48000);
    expect(items[0].text).toMatch(/no input cable/);
  });

  it('reports infrasonic dominant frequency as likely inaudible', () => {
    const g = graph([node('s', 'src.sine', { freq: 5, amp: 0.5 })], []);
    const items = explain(g, 's', 2);
    expect(items.some((i) => i.text.includes('below the ~20 Hz'))).toBe(true);
  });

  it('distinguishes measured facts from heuristics', () => {
    const g = graph(
      [
        node('s', 'src.sine', { freq: 1000, amp: 0.4 }),
        node('n', 'src.whitenoise', { amp: 0.3 }),
        node('m', 'proc.mixer'),
      ],
      [edge('s', 'm', 'in1'), edge('n', 'm', 'in2')],
    );
    const items = explain(g, 'm', 1);
    expect(items.some((i) => i.kind === 'measured')).toBe(true);
    // SNR should be reported as measured with a dB figure
    const snr = items.find((i) => i.text.includes('SNR'));
    expect(snr?.text).toMatch(/-?\d+(\.\d+)? dB/);
  });
});

describe('Export encoders', () => {
  it('WAV files have a correct RIFF header and length', async () => {
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 10);
    const blob = encodeWav(samples, 48000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE');
    expect(buf.length).toBe(44 + samples.length * 2);
    const view = new DataView(buf.buffer);
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits
    // Round-trip a couple of samples
    const s0 = view.getInt16(44 + 20 * 2, true) / 0x7fff;
    expect(s0).toBeCloseTo(samples[20], 2);
  });

  it('CSV has header + one row per sample', async () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const text = await encodeCsv(samples, 48000).text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('index,time_s,value');
    expect(lines.length).toBe(4);
    expect(lines[2]).toMatch(/^1,0\.0000/);
  });
});

describe('Share URL round trip', () => {
  it('projects survive hash encode/decode intact', () => {
    const project: Project = JSON.parse(
      exportProject({
        version: 1,
        id: 'p-share',
        name: 'Share me',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        sampleRate: 48000,
        graph: graph(
          [node('s', 'src.sine', { freq: 523.25 }), node('o', 'out.audio')],
          [edge('s', 'o')],
        ),
      }),
    ).project;
    const hash = `#p=${compressToEncodedURIComponent(JSON.stringify(project))}`;
    const loaded = loadFromHash(hash);
    expect(loaded).toBeTruthy();
    expect(loaded!.project?.name).toBe('Share me');
    expect(loaded!.project?.graph.nodes[0].params['freq']).toBe(523.25);
    expect(loaded!.project?.graph.edges.length).toBe(1);
  });

  it('corrupted hashes fail with an explanation, not a crash', () => {
    const loaded = loadFromHash('#p=@@@@notvalid@@@@');
    expect(loaded).toBeTruthy();
    expect(loaded!.project).toBeNull();
    expect(loaded!.errors.length).toBeGreaterThan(0);
  });

  it('non-share hashes are ignored', () => {
    expect(loadFromHash('#other')).toBeNull();
    expect(loadFromHash('')).toBeNull();
  });
});

describe('Project persistence round trip (import/export)', () => {
  it('a full featured project round-trips exactly', () => {
    const original: Project = {
      version: 1,
      id: 'rt',
      name: 'Round trip',
      createdAt: '2026-07-20T10:00:00.000Z',
      modifiedAt: '2026-07-20T10:05:00.000Z',
      sampleRate: 44100,
      notes: 'multi\nline\nnotes',
      graph: graph(
        [
          node('e', 'src.expression', { expr: 'sin(2*pi*100*t)' }),
          node('f', 'proc.feedback', { time: 123.4, feedback: 0.33 }),
          node('sc', 'ana.scope', { trigMode: 'falling' }),
          node('o', 'out.audio', { level: -12 }),
        ],
        [edge('e', 'f'), edge('f', 'sc'), edge('sc', 'o')],
      ),
    };
    const restored = loadProject(JSON.parse(exportProject(original)));
    expect(restored.ok).toBe(true);
    expect(restored.warnings).toEqual([]);
    expect(restored.project).toEqual(original);
  });
});
