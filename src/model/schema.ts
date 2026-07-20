/**
 * Zod schemas for persisted/exported data, plus version checking + migration.
 *
 * The project JSON format is versioned via the top-level `version` field.
 * Version 1 is the current format. Future versions must add a migration in
 * MIGRATIONS below; loading refuses versions newer than the app knows.
 */

import { z } from 'zod';
import { PROJECT_SCHEMA_VERSION, LIMITS, type Project } from './types';
import { hasNodeDef, getNodeDef } from '@/engine/registry';

export const paramValueSchema = z.union([z.number().finite(), z.string().max(2000), z.boolean()]);

export const graphNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  params: z.record(z.string().max(64), paramValueSchema),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1).max(96),
  from: z.string().min(1).max(64),
  fromPort: z.string().min(1).max(32),
  to: z.string().min(1).max(64),
  toPort: z.string().min(1).max(32),
});

export const projectGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(LIMITS.maxNodes),
  edges: z.array(graphEdgeSchema).max(LIMITS.maxNodes * 6),
});

export const projectSchema = z.object({
  version: z.number().int().min(1),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  modifiedAt: z.string(),
  sampleRate: z
    .number()
    .int()
    .min(LIMITS.minSampleRate)
    .max(LIMITS.maxSampleRate),
  graph: projectGraphSchema,
  notes: z.string().max(20000).optional(),
});

/** Exported file wrapper — identifies the app and format. */
export const exportFileSchema = z.object({
  format: z.literal('signal-processing-playground/project'),
  appVersion: z.string(),
  project: projectSchema,
});

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** version N -> function migrating a version-N project to N+1. */
const MIGRATIONS: Record<number, Migration> = {
  // Example for the future:
  // 1: (raw) => ({ ...raw, version: 2, somethingNew: defaultValue }),
};

export interface LoadResult {
  ok: boolean;
  project?: Project;
  errors: string[];
  warnings: string[];
}

/**
 * Validate and load a parsed JSON value as a Project, applying migrations.
 * Unknown node types and invalid params are surfaced as warnings/errors with
 * actionable text rather than silently dropped.
 */
export function loadProject(data: unknown): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errors: ['Project file is not a JSON object.'], warnings };
  }
  let raw = data as Record<string, unknown>;
  // Accept both the export wrapper and a bare project object
  if (raw['format'] === 'signal-processing-playground/project' && raw['project']) {
    raw = raw['project'] as Record<string, unknown>;
  }
  const version = typeof raw['version'] === 'number' ? raw['version'] : null;
  if (version === null) {
    return {
      ok: false,
      errors: ['Missing "version" field — this does not look like a playground project file.'],
      warnings,
    };
  }
  if (version > PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `This project uses format version ${version}, but this build only understands up to version ${PROJECT_SCHEMA_VERSION}. Update the app to open it.`,
      ],
      warnings,
    };
  }
  let v = version;
  while (v < PROJECT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      return {
        ok: false,
        errors: [`No migration path from format version ${v}.`],
        warnings,
      };
    }
    raw = migrate(raw);
    v = (raw['version'] as number) ?? v + 1;
    warnings.push(`Project migrated from format version ${version} to ${v}.`);
  }
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }
  const project = parsed.data as Project;
  // Semantic checks: node types, params, edge endpoints
  const keptNodes = project.graph.nodes.filter((n) => {
    if (!hasNodeDef(n.type)) {
      warnings.push(`Node "${n.id}" has unknown type "${n.type}" and was removed.`);
      return false;
    }
    return true;
  });
  const ids = new Set(keptNodes.map((n) => n.id));
  const keptEdges = project.graph.edges.filter((e) => {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      warnings.push(`Cable "${e.id}" referenced a missing node and was removed.`);
      return false;
    }
    return true;
  });
  // Clamp params into their declared ranges
  for (const n of keptNodes) {
    const def = getNodeDef(n.type);
    for (const p of def.params) {
      const v = n.params[p.id];
      if (v === undefined) {
        n.params[p.id] = p.default;
        continue;
      }
      if (p.type === 'number' && typeof v === 'number') {
        const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
        if (clamped !== v) {
          warnings.push(
            `${def.title}.${p.label}: value ${v} was outside the allowed range and was clamped to ${clamped}.`,
          );
          n.params[p.id] = clamped;
        }
      }
    }
  }
  project.graph = { nodes: keptNodes, edges: keptEdges };
  return { ok: true, project, errors, warnings };
}

export const APP_VERSION = '1.0.0';

export function exportProject(project: Project): string {
  return JSON.stringify(
    {
      format: 'signal-processing-playground/project',
      appVersion: APP_VERSION,
      project,
    },
    null,
    2,
  );
}
