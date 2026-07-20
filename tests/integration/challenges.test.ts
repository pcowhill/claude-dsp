/**
 * Challenge grading integration tests.
 *
 * Every challenge is verified with at least one real solution graph, and the
 * unsolved starting graph must NOT pass. Several challenges are verified with
 * two materially different solutions, proving grading measures outcomes
 * rather than one blessed topology.
 */

import { describe, it, expect } from 'vitest';
import { CHALLENGES } from '@/learn/challenges';
import type { Challenge, GradeResult } from '@/learn/types';
import type { Project, ProjectGraph, ParamValue } from '@/model/types';
import { gradeChallenge } from '@/learn/gradeRunner';
import { runCapture } from '@/engine/capture';
import { defaultParams } from '@/engine/registry';

const deps = {
  runCapture: (req: {
    graph: ProjectGraph;
    sampleRate: number;
    duration: number;
    seed: number;
  }) => Promise.resolve(runCapture(req)),
};

function byId(id: string): Challenge {
  const c = CHALLENGES.find((c) => c.id === id);
  if (!c) throw new Error(`no challenge ${id}`);
  return c;
}

interface Mod {
  addNodes?: { id: string; type: string; params?: Record<string, ParamValue> }[];
  removeEdges?: (e: { from: string; to: string }) => boolean;
  addEdges?: { from: string; to: string; toPort?: string; fromPort?: string }[];
  setParams?: Record<string, Record<string, ParamValue>>;
}

let eid = 900;

/** Apply a solution modification to a challenge's starting project. */
function solve(project: Project, mod: Mod): ProjectGraph {
  const graph: ProjectGraph = JSON.parse(JSON.stringify(project.graph));
  if (mod.removeEdges) {
    graph.edges = graph.edges.filter((e) => !mod.removeEdges!({ from: e.from, to: e.to }));
  }
  for (const n of mod.addNodes ?? []) {
    graph.nodes.push({
      id: n.id,
      type: n.type,
      x: 0,
      y: 0,
      params: { ...defaultParams(n.type), ...n.params },
    });
  }
  for (const e of mod.addEdges ?? []) {
    graph.edges.push({
      id: `sol-e${eid++}`,
      from: e.from,
      fromPort: e.fromPort ?? 'out',
      to: e.to,
      toPort: e.toPort ?? 'in',
    });
  }
  for (const [nodeId, params] of Object.entries(mod.setParams ?? {})) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node) node.params = { ...node.params, ...params };
  }
  return graph;
}

async function grade(
  ch: Challenge,
  graph: ProjectGraph,
  answers: Record<string, number> = {},
): Promise<GradeResult> {
  return gradeChallenge(ch, graph, 48000, answers, deps);
}

describe('Challenge grading — starting graphs do not pass', () => {
  for (const ch of CHALLENGES) {
    it(`${ch.title}: unsolved bench fails`, async () => {
      const r = await grade(ch, ch.build().graph);
      expect(r.passed).toBe(false);
    });
  }
});

describe('Challenge 1 · Rescue a Noisy Tone', () => {
  it('band-pass solution passes', async () => {
    const ch = byId('ch-rescue-tone');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'bpf', type: 'proc.bandpass', params: { freq: 1000, q: 12 } }],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'bpf' },
        { from: 'bpf', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(ch.passScore);
  });

  it('materially different solution (low-pass + high-pass pair) also passes', async () => {
    const ch = byId('ch-rescue-tone');
    const graph = solve(ch.build(), {
      addNodes: [
        { id: 'lpf', type: 'proc.lowpass', params: { freq: 1200, q: 2 } },
        { id: 'hpf', type: 'proc.highpass', params: { freq: 850, q: 2 } },
      ],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'lpf' },
        { from: 'lpf', to: 'hpf' },
        { from: 'hpf', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });

  it('cheating by muting the fixed noise source is neutralized by grading overrides', async () => {
    const ch = byId('ch-rescue-tone');
    const graph = solve(ch.build(), { setParams: { noise: { amp: 0 } } });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(false); // fixed params restored → still noisy
  });
});

describe('Challenge 2 · Stop the Aliasing', () => {
  it('raising the link sample rate passes', async () => {
    const ch = byId('ch-stop-aliasing');
    const graph = solve(ch.build(), {
      setParams: { link: { targetRate: 16000, antialias: true } },
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });

  it('anti-alias filter alone silences the tone and fails honestly', async () => {
    const ch = byId('ch-stop-aliasing');
    const graph = solve(ch.build(), { setParams: { link: { antialias: true } } });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(false);
    // the 5 kHz tone cannot survive an 8 kHz representation
    expect(r.parts[1].met).toBe(false);
  });

  it('bypassing the resampler entirely also passes (alternate solution)', async () => {
    const ch = byId('ch-stop-aliasing');
    const graph = solve(ch.build(), {
      removeEdges: (e) => e.from === 'cal' || e.from === 'link',
      addEdges: [
        { from: 'cal', to: 'spec' },
        { from: 'spec', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });
});

describe('Challenge 3 · Prevent Clipping', () => {
  it('attenuation before the converter passes', async () => {
    const ch = byId('ch-prevent-clipping');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'trim', type: 'proc.gain', params: { gain: -12 } }],
      removeEdges: (e) => e.from === 'preamp' && e.to === 'adc',
      addEdges: [
        { from: 'preamp', to: 'trim' },
        { from: 'trim', to: 'adc' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });

  it('attenuation before the fixed preamp also passes (alternate topology)', async () => {
    const ch = byId('ch-prevent-clipping');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'trim', type: 'proc.gain', params: { gain: -13 } }],
      removeEdges: (e) => e.from === 'src' && e.to === 'preamp',
      addEdges: [
        { from: 'src', to: 'trim' },
        { from: 'trim', to: 'preamp' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });

  it('over-attenuating fails the level criterion', async () => {
    const ch = byId('ch-prevent-clipping');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'trim', type: 'proc.gain', params: { gain: -40 } }],
      removeEdges: (e) => e.from === 'preamp' && e.to === 'adc',
      addEdges: [
        { from: 'preamp', to: 'trim' },
        { from: 'trim', to: 'adc' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(false);
  });
});

describe('Challenge 4 · Find the Hidden Frequencies', () => {
  it('correct answers pass regardless of order', async () => {
    const ch = byId('ch-hidden-tones');
    const r = await grade(ch, ch.build().graph, { f1: 3170, f2: 620, f3: 1490 });
    expect(r.passed).toBe(true);
    expect(r.score).toBe(100);
  });

  it('answers within tolerance pass; wild answers fail', async () => {
    const ch = byId('ch-hidden-tones');
    const near = await grade(ch, ch.build().graph, { f1: 610, f2: 1500, f3: 3180 });
    expect(near.passed).toBe(true);
    const wrong = await grade(ch, ch.build().graph, { f1: 100, f2: 200, f3: 300 });
    expect(wrong.passed).toBe(false);
  });
});

describe('Challenge 5 · Remove an Unwanted Hum', () => {
  it('notch filter solution passes', async () => {
    const ch = byId('ch-remove-hum');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'notch', type: 'proc.bandstop', params: { freq: 60, q: 8 } }],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'notch' },
        { from: 'notch', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });

  it('high-pass solution also passes (different approach)', async () => {
    const ch = byId('ch-remove-hum');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'hp', type: 'proc.highpass', params: { freq: 130, q: 0.707 } }],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'hp' },
        { from: 'hp', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });
});

describe('Challenge 6 · Reconstruct a Damaged Signal', () => {
  it('high-pass + gain + low-pass restoration passes', async () => {
    const ch = byId('ch-reconstruct');
    const graph = solve(ch.build(), {
      addNodes: [
        { id: 'hp', type: 'proc.highpass', params: { freq: 30, q: 0.707 } },
        { id: 'boost', type: 'proc.gain', params: { gain: 10 } },
        { id: 'lp', type: 'proc.lowpass', params: { freq: 500, q: 0.707 } },
      ],
      removeEdges: (e) => e.from === 'stats' && e.to === 'out',
      addEdges: [
        { from: 'dmgQ', to: 'hp' },
        { from: 'hp', to: 'boost' },
        { from: 'boost', to: 'lp' },
        { from: 'lp', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });
});

describe('Challenge 7 · Decode an AM Transmission', () => {
  it('product detector + filters recovers the message', async () => {
    const ch = byId('ch-decode-am');
    const graph = solve(ch.build(), {
      addNodes: [
        { id: 'det', type: 'proc.am', params: { carrier: 8000, depth: 1, mode: 'dsb', level: 0 } },
        { id: 'lp', type: 'proc.lowpass', params: { freq: 1000, q: 0.707 } },
        { id: 'hp', type: 'proc.highpass', params: { freq: 100, q: 0.707 } },
      ],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'det', toPort: 'msg' },
        { from: 'det', to: 'lp' },
        { from: 'lp', to: 'hp' },
        { from: 'hp', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
  });
});

describe('Challenge 8 · Match the Mystery System', () => {
  it('feedback delay at datasheet values matches', async () => {
    const ch = byId('ch-mystery-system');
    const graph = solve(ch.build(), {
      addNodes: [
        { id: 'sys', type: 'proc.feedback', params: { time: 180, feedback: 0.45, mix: 1 } },
      ],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'probe', to: 'sys' },
        { from: 'sys', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(85);
  });

  it('wrong delay time fails the match', async () => {
    const ch = byId('ch-mystery-system');
    const graph = solve(ch.build(), {
      addNodes: [
        { id: 'sys', type: 'proc.feedback', params: { time: 90, feedback: 0.45, mix: 1 } },
      ],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'probe', to: 'sys' },
        { from: 'sys', to: 'out' },
      ],
    });
    const r = await grade(ch, graph);
    expect(r.passed).toBe(false);
  });

  it('deleting fixed equipment gives an actionable failure', async () => {
    const ch = byId('ch-mystery-system');
    const project = ch.build();
    const graph: ProjectGraph = {
      nodes: project.graph.nodes.filter((n) => n.id !== 'probe'),
      edges: project.graph.edges.filter((e) => e.from !== 'probe'),
    };
    const r = await grade(ch, graph);
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/Fixed equipment/);
  });
});

describe('Grading determinism', () => {
  it('identical graphs grade identically across runs', async () => {
    const ch = byId('ch-rescue-tone');
    const graph = solve(ch.build(), {
      addNodes: [{ id: 'bpf', type: 'proc.bandpass', params: { freq: 1000, q: 12 } }],
      removeEdges: (e) => e.from === 'spec' && e.to === 'out',
      addEdges: [
        { from: 'rx', to: 'bpf' },
        { from: 'bpf', to: 'out' },
      ],
    });
    const a = await grade(ch, graph);
    const b = await grade(ch, graph);
    expect(a.score).toBe(b.score);
    expect(a.parts.map((p) => p.detail)).toEqual(b.parts.map((p) => p.detail));
  });
});
