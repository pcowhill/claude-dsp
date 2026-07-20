/** Shareable URLs: project JSON compressed with lz-string into the hash. */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Project } from '@/model/types';
import { loadProject } from '@/model/schema';

/** Above this encoded length we warn instead of producing a URL silently. */
export const SHARE_URL_WARN_LENGTH = 8000;

export interface ShareResult {
  url: string | null;
  length: number;
  tooLarge: boolean;
}

export function buildShareUrl(project: Project, base?: string): ShareResult {
  const json = JSON.stringify(project);
  const encoded = compressToEncodedURIComponent(json);
  const origin = base ?? `${location.origin}${location.pathname}`;
  const url = `${origin}#p=${encoded}`;
  return {
    url: encoded.length > SHARE_URL_WARN_LENGTH ? null : url,
    length: encoded.length,
    tooLarge: encoded.length > SHARE_URL_WARN_LENGTH,
  };
}

export interface ShareLoad {
  project: Project | null;
  errors: string[];
  warnings: string[];
}

/** Try to load a project from the current location hash (`#p=...`). */
export function loadFromHash(hash: string): ShareLoad | null {
  const m = /^#p=(.+)$/.exec(hash);
  if (!m) return null;
  try {
    const json = decompressFromEncodedURIComponent(m[1]);
    if (!json) return { project: null, errors: ['Share link data could not be decompressed.'], warnings: [] };
    const result = loadProject(JSON.parse(json));
    return {
      project: result.ok ? (result.project ?? null) : null,
      errors: result.errors,
      warnings: result.warnings,
    };
  } catch (err) {
    return {
      project: null,
      errors: [`Share link is corrupted: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }
}
