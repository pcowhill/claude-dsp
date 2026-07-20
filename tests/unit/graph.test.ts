import { describe, it, expect } from 'vitest';
import { node, edge, graph, render } from './helpers';
import { checkConnection, topologicalOrder, validateGraph, signalPathLabel } from '@/engine/graph';
import { runCapture } from '@/engine/capture';

describe('Connection validation', () => {
  const base = () =>
    graph(
      [
        node('sine', 'src.sine'),
        node('gain', 'proc.gain'),
        node('mix', 'proc.mixer'),
        node('fb', 'proc.feedback'),
        node('out', 'out.audio'),
      ],
      [],
    );

  it('accepts a normal forward connection', () => {
    expect(checkConnection(base(), 'sine', 'out', 'gain', 'in').ok).toBe(true);
  });

  it('rejects self-connection with explanation', () => {
    const r = checkConnection(base(), 'gain', 'out', 'gain', 'in');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Feedback Delay/);
  });

  it('rejects double-cabling an input port', () => {
    const g = base();
    g.edges.push(edge('sine', 'gain'));
    const r = checkConnection(g, 'mix', 'out', 'gain', 'in');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already has a cable/);
  });

  it('rejects unknown ports', () => {
    expect(checkConnection(base(), 'sine', 'nope', 'gain', 'in').ok).toBe(false);
    expect(checkConnection(base(), 'sine', 'out', 'gain', 'nope').ok).toBe(false);
  });

  it('rejects instantaneous cycles with helpful message', () => {
    const g = base();
    g.edges.push(edge('sine', 'mix', 'in1'), edge('mix', 'gain'));
    const r = checkConnection(g, 'gain', 'out', 'mix', 'in2');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/instantaneous feedback loop/i);
  });

  it('allows cycles through the feedback node deferred port', () => {
    const g = base();
    g.edges.push(edge('sine', 'fb', 'in'), edge('fb', 'gain', 'in'));
    const r = checkConnection(g, 'gain', 'out', 'fb', 'fb');
    expect(r.ok).toBe(true);
  });
});

describe('Topological ordering', () => {
  it('is deterministic and respects dependencies', () => {
    const g = graph(
      [node('b', 'proc.gain'), node('a', 'src.sine'), node('c', 'out.audio')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const { order, errors } = topologicalOrder(g);
    expect(errors).toEqual([]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    // Deterministic across calls
    expect(topologicalOrder(g).order).toEqual(order);
  });

  it('reports nodes stuck in illegal cycles', () => {
    const g = graph(
      [node('a', 'proc.gain'), node('b', 'proc.gain')],
      [edge('a', 'b'), edge('b', 'a')],
    );
    const { errors } = topologicalOrder(g);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/cycle/);
  });
});

describe('Graph-level validation', () => {
  it('flags duplicate ids, unknown types and dangling edges', () => {
    const g = graph(
      [node('a', 'src.sine'), { id: 'a', type: 'not.a.node', x: 0, y: 0, params: {} }],
      [edge('a', 'missing')],
    );
    const errors = validateGraph(g);
    expect(errors.some((e) => e.includes('Duplicate'))).toBe(true);
    expect(errors.some((e) => e.includes('Unknown node type'))).toBe(true);
    expect(errors.some((e) => e.includes('missing node'))).toBe(true);
  });

  it('passes a healthy graph', () => {
    const g = graph(
      [node('s', 'src.sine'), node('o', 'out.audio')],
      [edge('s', 'o')],
    );
    expect(validateGraph(g)).toEqual([]);
  });
});

describe('Capture determinism and structure', () => {
  it('captures are exactly repeatable with the same seed', () => {
    const g = graph(
      [
        node('n', 'src.whitenoise', { seed: 3 }),
        node('f', 'proc.lowpass', { freq: 2000 }),
        node('o', 'out.audio'),
      ],
      [edge('n', 'f'), edge('f', 'o')],
    );
    const r1 = runCapture({ graph: g, duration: 0.25, sampleRate: 48000, seed: 9 });
    const r2 = runCapture({ graph: g, duration: 0.25, sampleRate: 48000, seed: 9 });
    expect(Array.from(r1.buffers['o'].subarray(0, 200))).toEqual(
      Array.from(r2.buffers['o'].subarray(0, 200)),
    );
    const r3 = runCapture({ graph: g, duration: 0.25, sampleRate: 48000, seed: 10 });
    expect(Array.from(r1.buffers['o'].subarray(0, 200))).not.toEqual(
      Array.from(r3.buffers['o'].subarray(0, 200)),
    );
  });

  it('branching: one source feeds two paths independently', () => {
    const g = graph(
      [
        node('s', 'src.sine', { freq: 400, amp: 0.5 }),
        node('g1', 'proc.gain', { gain: 0 }),
        node('g2', 'proc.gain', { gain: -20 }),
      ],
      [edge('s', 'g1'), edge('s', 'g2')],
    );
    const r = runCapture({ graph: g, duration: 0.1, sampleRate: 48000, seed: 1 });
    const p1 = Math.max(...Array.from(r.buffers['g1']).map(Math.abs));
    const p2 = Math.max(...Array.from(r.buffers['g2']).map(Math.abs));
    expect(p1).toBeCloseTo(0.5, 2);
    expect(p2).toBeCloseTo(0.05, 2);
  });

  it('nodes in illegal cycles render silence but the rest still works', () => {
    const g = graph(
      [
        node('s', 'src.sine', { amp: 0.5 }),
        node('a', 'proc.gain'),
        node('b', 'proc.gain'),
      ],
      [edge('a', 'b'), edge('b', 'a'), edge('s', 'a', 'in')],
    );
    // 'a' has two inputs? No — edge('b','a') and edge('s','a') both target 'in';
    // validation would flag this, but capture must still not crash.
    const r = runCapture({ graph: g, duration: 0.05, sampleRate: 48000, seed: 1 });
    expect(r.errors['__graph']).toBeTruthy();
    const sPeak = Math.max(...Array.from(r.buffers['s']).map(Math.abs));
    expect(sPeak).toBeCloseTo(0.5, 2);
  });

  it('external feedback loop through the feedback node works and decays', () => {
    const g = graph(
      [
        node('i', 'src.impulse', { startTime: 0.005, mode: 'single' }),
        node('fb', 'proc.feedback', { time: 50, feedback: 0, mix: 1 }),
        node('g', 'proc.gain', { gain: -6 }),
      ],
      [edge('i', 'fb', 'in'), edge('fb', 'g', 'in'), edge('g', 'fb', 'fb')],
    );
    const r = runCapture({ graph: g, duration: 1, sampleRate: 48000, seed: 1 });
    expect(r.errors['__graph']).toBeFalsy();
    const buf = r.buffers['fb'];
    const peak = Math.max(...Array.from(buf).map(Math.abs));
    expect(peak).toBeLessThanOrEqual(1.6); // bounded
    expect(peak).toBeGreaterThan(0.5); // signal flows
  });

  it('signalPathLabel walks upstream', () => {
    const g = graph(
      [node('s', 'src.sine'), node('f', 'proc.lowpass'), node('o', 'out.audio')],
      [edge('s', 'f'), edge('f', 'o')],
    );
    expect(signalPathLabel(g, 'o')).toBe('Sine Wave → Low-Pass Filter → Audio Output');
  });
});
