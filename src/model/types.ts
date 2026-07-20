/**
 * Core model types for the Signal Processing Playground.
 *
 * The runtime graph model is deliberately independent of React and of
 * @xyflow/react so the DSP engine can run in workers and in tests.
 */

export type PortKind = 'signal' | 'control';

export interface PortDef {
  id: string;
  label: string;
  kind: PortKind;
  /**
   * Deferred inputs read the upstream node's output from the PREVIOUS block.
   * Edges into deferred inputs are excluded from cycle detection; this is the
   * only legal way to build feedback loops and it guarantees >= one block of
   * delay around any loop.
   */
  deferred?: boolean;
  /** Optional inputs may be left unconnected. */
  optional?: boolean;
}

export type ParamValue = number | string | boolean;

export interface SelectOption {
  value: string;
  label: string;
}

export interface ParamDef {
  id: string;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'text';
  default: ParamValue;
  /** Unit shown next to values, e.g. 'Hz', 'dB', 's', 'ms', 'bits'. */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** 'log' renders knobs/sliders with logarithmic response (frequencies). */
  scale?: 'linear' | 'log';
  options?: SelectOption[];
  /** Which tactile control the node face uses. */
  control?: 'knob' | 'slider' | 'toggle' | 'select' | 'field';
  /** Show on the node face itself (not only in the inspector). */
  primary?: boolean;
  help?: string;
  /** Number of decimals for display. */
  digits?: number;
}

export type NodeCategory = 'source' | 'process' | 'analyze' | 'output';

export interface MathDoc {
  title: string;
  /** KaTeX expressions (display mode). */
  equations: string[];
  /** Symbol -> meaning (rendered as a definitions table). */
  symbols: Record<string, string>;
  interpretation: string;
  limitations?: string;
  /**
   * Optional live substitution: given current params, return a KaTeX string
   * with concrete values plugged in.
   */
  substitute?: (params: Record<string, ParamValue>, sampleRate: number) => string | null;
}

export interface RenderCtx {
  sampleRate: number;
  blockSize: number;
  /** Absolute index of the first sample of this block since transport start. */
  startSample: number;
  mode: 'live' | 'capture';
  /** Deterministic per-node RNG in capture mode; time-seeded in live mode. */
  random: () => number;
}

export interface NodeDef {
  type: string;
  title: string;
  category: NodeCategory;
  /** Short library/palette description. */
  blurb: string;
  description: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  math?: MathDoc;
  /** Create per-instance runtime state (delay lines, phase accumulators...). */
  createState?: (sampleRate: number, params: Record<string, ParamValue>) => Record<string, any>;
  /**
   * Render one block. `inputs` holds one buffer per input port (null when
   * unconnected). Must write `blockSize` samples into `out` (one per output
   * port). Buffers must not be retained across calls.
   */
  process: (
    ctx: RenderCtx,
    inputs: (Float32Array | null)[],
    outputs: Float32Array[],
    params: Record<string, ParamValue>,
    state: Record<string, any>,
  ) => void;
  /** Extra param validation beyond min/max, returns error message or null. */
  validate?: (params: Record<string, ParamValue>, sampleRate: number) => string | null;
}

/** A node instance in a project graph. */
export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, ParamValue>;
}

export interface GraphEdge {
  id: string;
  from: string; // node id
  fromPort: string; // output port id
  to: string; // node id
  toPort: string; // input port id
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Project {
  version: number;
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  sampleRate: number;
  graph: ProjectGraph;
  notes?: string;
}

export interface SignalMeta {
  sampleRate: number;
  /** Best-known nominal frequency in Hz (e.g. from a sine source), if any. */
  nominalFreq?: number;
  /** Human description of provenance, e.g. 'sine 440 Hz → LPF 1 kHz'. */
  label?: string;
}

export interface CaptureRequest {
  sampleRate: number;
  duration: number; // seconds
  seed: number;
  graph: ProjectGraph;
}

export interface CaptureResult {
  sampleRate: number;
  length: number; // samples
  /** node id -> rendered output buffer (first signal output). */
  buffers: Record<string, Float32Array>;
  /** Errors keyed by node id (validation problems found while rendering). */
  errors: Record<string, string>;
}

export const PROJECT_SCHEMA_VERSION = 1;

/** Hard engineering limits (documented in docs/DSP_NOTES.md). */
export const LIMITS = {
  minSampleRate: 1000,
  maxSampleRate: 96000,
  maxCaptureSeconds: 10,
  maxCaptureTotalSamples: 16 * 1024 * 1024,
  maxFftSize: 16384,
  minFftSize: 256,
  maxDelaySeconds: 2,
  maxConvolutionIr: 48000 * 2,
  maxNodes: 64,
  blockSize: 128,
  liveRingSamples: 32768,
} as const;
