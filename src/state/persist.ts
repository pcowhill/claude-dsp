/**
 * LocalStorage persistence: named projects, autosave, last-open tracking.
 * Storage layout:
 *   spp.projectIndex        JSON [{id, name, modifiedAt, example?}]
 *   spp.project.<id>        JSON Project
 *   spp.lastProjectId       string
 *   spp.onboarded           '1' once onboarding has been shown
 */

import type { Project } from '@/model/types';
import { loadProject } from '@/model/schema';
import { useProjectStore } from './projectStore';

const INDEX_KEY = 'spp.projectIndex';
const LAST_KEY = 'spp.lastProjectId';
const ONBOARD_KEY = 'spp.onboarded';

export interface ProjectIndexEntry {
  id: string;
  name: string;
  modifiedAt: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): ProjectIndexEntry[] {
  const raw = safeGet(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ProjectIndexEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: ProjectIndexEntry[]): void {
  safeSet(INDEX_KEY, JSON.stringify(entries));
}

export function saveProjectToStorage(project: Project): boolean {
  const ok = safeSet(`spp.project.${project.id}`, JSON.stringify(project));
  if (!ok) return false;
  const index = listProjects().filter((e) => e.id !== project.id);
  index.unshift({ id: project.id, name: project.name, modifiedAt: project.modifiedAt });
  writeIndex(index.slice(0, 50));
  safeSet(LAST_KEY, project.id);
  return true;
}

export function loadProjectFromStorage(id: string): Project | null {
  const raw = safeGet(`spp.project.${id}`);
  if (!raw) return null;
  try {
    const result = loadProject(JSON.parse(raw));
    return result.ok ? (result.project ?? null) : null;
  } catch {
    return null;
  }
}

export function deleteProjectFromStorage(id: string): void {
  try {
    localStorage.removeItem(`spp.project.${id}`);
  } catch {
    /* ignore */
  }
  writeIndex(listProjects().filter((e) => e.id !== id));
}

export function lastProjectId(): string | null {
  return safeGet(LAST_KEY);
}

export function wasOnboarded(): boolean {
  return safeGet(ONBOARD_KEY) === '1';
}

export function markOnboarded(): void {
  safeSet(ONBOARD_KEY, '1');
}

/* ---------- Autosave ---------- */

let saveTimer: number | null = null;

export function startAutosave(): void {
  useProjectStore.subscribe((state) => {
    if (!state.dirty) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const p = useProjectStore.getState().project;
      saveProjectToStorage(p);
    }, 800);
  });
}
