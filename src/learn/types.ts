/** Lesson & challenge type definitions. */

import type { Project, ProjectGraph, ParamValue } from '@/model/types';
import type { SignalStats } from '@/engine/dsp/measurements';

/** Context handed to lesson goal checks (live data, read-only). */
export interface GoalCtx {
  graph: ProjectGraph;
  sampleRate: number;
  /** Recent samples of a node's output (searched by id, or null). */
  signal: (nodeId: string, n?: number) => Float32Array | null;
  /** Stats of a node's recent output. */
  stats: (nodeId: string) => SignalStats | null;
  /** A node's current param value (by node id). */
  param: (nodeId: string, paramId: string) => ParamValue | undefined;
  /** Find the first node of a given type. */
  nodeOfType: (type: string) => string | null;
  playing: boolean;
}

export interface GoalCheck {
  met: boolean;
  /** Live readout shown next to the goal, e.g. "cutoff 2.4 kHz". */
  value?: string;
}

export interface LessonGoal {
  id: string;
  description: string;
  check: (ctx: GoalCtx) => GoalCheck;
}

export interface Prediction {
  id: string;
  question: string;
  options: string[];
  correct: number;
  reveal: string;
}

export interface LessonMath {
  title: string;
  equations: string[];
  symbols: Record<string, string>;
  interpretation: string;
}

export interface LessonStep {
  id: string;
  title: string;
  /** Paragraphs. Inline `code` and **bold** are supported. */
  body: string[];
  /** A concrete instruction, highlighted. */
  action?: string;
  prediction?: Prediction;
  goals?: LessonGoal[];
  math?: LessonMath;
}

export interface Lesson {
  id: string;
  index: number;
  title: string;
  summary: string;
  minutes: number;
  build: () => Project;
  steps: LessonStep[];
  /** Shown when the last step completes. */
  closing: string;
}

/* ---------------- Challenges ---------------- */

export interface GradePart {
  label: string;
  detail: string;
  points: number;
  maxPoints: number;
  met: boolean;
}

export interface GradeResult {
  score: number; // 0..100
  passed: boolean;
  parts: GradePart[];
  /** Actionable message when failing. */
  message: string;
}

export interface GradeCtx {
  graph: ProjectGraph;
  sampleRate: number;
  /** Full capture buffer of a node (by id). */
  buffer: (nodeId: string) => Float32Array | null;
  /** First node id of a type. */
  nodeOfType: (type: string) => string | null;
  nodeCount: number;
  answers: Record<string, number>;
}

export interface AnswerField {
  id: string;
  label: string;
  unit: string;
}

export interface Challenge {
  id: string;
  index: number;
  title: string;
  scenario: string;
  objective: string;
  minutes: number;
  build: () => Project;
  /**
   * Node params frozen for grading: before the grading capture runs, these
   * params are forced back to their original values so the "received signal"
   * cannot be edited away. Listed in the UI as fixed equipment.
   */
  fixedNodes: Record<string, Record<string, ParamValue>>;
  /** Deterministic seed used for grading captures. */
  seed: number;
  captureDuration: number;
  hints: string[];
  answerFields?: AnswerField[];
  grade: (ctx: GradeCtx) => GradeResult;
  passScore: number;
  explanation: string;
  /** Optional efficiency note evaluated post-pass. */
  efficiencyGoal?: string;
}
