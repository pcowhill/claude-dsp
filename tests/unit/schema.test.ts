import { describe, it, expect } from 'vitest';
import { loadProject, exportProject } from '@/model/schema';
import type { Project } from '@/model/types';
import { node, edge } from './helpers';

function sampleProject(): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'Test project',
    createdAt: '2026-07-20T00:00:00.000Z',
    modifiedAt: '2026-07-20T00:00:00.000Z',
    sampleRate: 48000,
    graph: {
      nodes: [node('s', 'src.sine', { freq: 440 }), node('o', 'out.audio')],
      edges: [edge('s', 'o')],
    },
    notes: 'hello',
  };
}

describe('Project serialization', () => {
  it('round-trips through export and load', () => {
    const p = sampleProject();
    const json = exportProject(p);
    const loaded = loadProject(JSON.parse(json));
    expect(loaded.ok).toBe(true);
    expect(loaded.project!.name).toBe('Test project');
    expect(loaded.project!.graph.nodes.length).toBe(2);
    expect(loaded.project!.graph.edges.length).toBe(1);
    expect(loaded.project!.graph.nodes[0].params['freq']).toBe(440);
  });

  it('accepts a bare project without the wrapper', () => {
    const loaded = loadProject(sampleProject());
    expect(loaded.ok).toBe(true);
  });

  it('rejects non-objects and garbage', () => {
    expect(loadProject('nope').ok).toBe(false);
    expect(loadProject(null).ok).toBe(false);
    expect(loadProject({ foo: 1 }).ok).toBe(false);
    expect(loadProject({ foo: 1 }).errors[0]).toMatch(/version/);
  });

  it('rejects future versions with a clear message', () => {
    const p = { ...sampleProject(), version: 99 };
    const r = loadProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/version 99/);
  });

  it('removes unknown node types with a warning instead of failing', () => {
    const p = sampleProject();
    p.graph.nodes.push({ id: 'x', type: 'future.node', x: 0, y: 0, params: {} });
    p.graph.edges.push({ id: 'e9', from: 'x', fromPort: 'out', to: 'o', toPort: 'in' });
    const r = loadProject(JSON.parse(exportProject(p)));
    expect(r.ok).toBe(true); // still loads despite the unknown node
    expect(r.project!.graph.nodes.find((n) => n.id === 'x')).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('unknown type'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('removed'))).toBe(true);
  });

  it('clamps out-of-range params with warnings', () => {
    const p = sampleProject();
    p.graph.nodes[0].params['freq'] = 999999;
    const r = loadProject(JSON.parse(exportProject(p)));
    expect(r.ok).toBe(true);
    expect(r.project!.graph.nodes[0].params['freq']).toBe(20000);
    expect(r.warnings.some((w) => w.includes('clamped'))).toBe(true);
  });

  it('fills missing params with defaults', () => {
    const p = sampleProject();
    p.graph.nodes[0].params = {};
    const r = loadProject(JSON.parse(exportProject(p)));
    expect(r.ok).toBe(true);
    expect(r.project!.graph.nodes[0].params['freq']).toBe(440);
  });

  it('reports schema issues with paths', () => {
    const p: any = sampleProject();
    p.sampleRate = 'fast';
    const r = loadProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('sampleRate'))).toBe(true);
  });
});
