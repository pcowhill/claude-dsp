/**
 * Challenge grading pipeline: apply fixed-equipment overrides, render a
 * deterministic capture in the worker, then evaluate the challenge's
 * measurable criteria.
 */

import type { Challenge, GradeResult } from './types';
import type { ProjectGraph } from '@/model/types';
import { getNodeDef, hasNodeDef } from '@/engine/registry';

export interface GradeRunDeps {
  runCapture: (req: {
    graph: ProjectGraph;
    sampleRate: number;
    duration: number;
    seed: number;
  }) => Promise<{ buffers: Record<string, Float32Array>; sampleRate: number }>;
}

export async function gradeChallenge(
  challenge: Challenge,
  graph: ProjectGraph,
  sampleRate: number,
  answers: Record<string, number>,
  deps: GradeRunDeps,
): Promise<GradeResult> {
  // Verify fixed equipment still exists
  for (const nodeId of Object.keys(challenge.fixedNodes)) {
    if (!graph.nodes.some((n) => n.id === nodeId)) {
      return {
        score: 0,
        passed: false,
        parts: [],
        message: `Fixed equipment "${nodeId}" was deleted. Reset the challenge to restore the original bench (your additions are what you should change).`,
      };
    }
  }
  // Force fixed params back before grading
  const gradedGraph: ProjectGraph = {
    nodes: graph.nodes.map((n) =>
      challenge.fixedNodes[n.id]
        ? { ...n, params: { ...n.params, ...challenge.fixedNodes[n.id] } }
        : n,
    ),
    edges: graph.edges,
  };
  const result = await deps.runCapture({
    graph: gradedGraph,
    sampleRate,
    duration: challenge.captureDuration,
    seed: challenge.seed,
  });
  return challenge.grade({
    graph: gradedGraph,
    sampleRate: result.sampleRate,
    buffer: (nodeId) => result.buffers[nodeId] ?? null,
    nodeOfType: (type) =>
      gradedGraph.nodes.find((n) => hasNodeDef(n.type) && n.type === type)?.id ?? null,
    nodeCount: gradedGraph.nodes.filter(
      (n) => hasNodeDef(n.type) && getNodeDef(n.type).category !== 'analyze',
    ).length,
    answers,
  });
}
