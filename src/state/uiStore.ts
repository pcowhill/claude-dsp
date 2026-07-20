/** UI-level state: app mode, transport, capture, toasts, dialogs, onboarding. */

import { create } from 'zustand';
import type { CaptureResult } from '@/model/types';
import type { AudioStatus } from '@/audio/audioEngine';
import type { TransportState } from '@/engine/live';

export type AppMode = 'sandbox' | 'lessons' | 'challenges';
export type RunMode = 'live' | 'capture';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'warn' | 'error';
  text: string;
}

let toastId = 0;

/**
 * Capture buffers are large; they live outside zustand in this module-level
 * holder. `captureRevision` in the store tells subscribers when they changed.
 */
let captureResultHolder: CaptureResult | null = null;

export function getCaptureResult(): CaptureResult | null {
  return captureResultHolder;
}

export function setCaptureResult(r: CaptureResult | null): void {
  captureResultHolder = r;
}

interface UiState {
  appMode: AppMode;
  runMode: RunMode;
  transport: TransportState;
  audioStatus: AudioStatus;
  audioDetail: string | null;
  limiterActive: boolean;
  masterVolume: number;
  muted: boolean;
  liveTick: number; // bumped ~15/s while playing so views re-render
  captureStatus: 'idle' | 'running' | 'done' | 'error';
  captureRevision: number;
  captureError: string | null;
  captureDuration: number;
  captureSeed: number;
  activeLessonId: string | null;
  activeChallengeId: string | null;
  onboardingOpen: boolean;
  projectManagerOpen: boolean;
  exportDialogOpen: boolean;
  helpOpen: boolean;
  toasts: Toast[];

  setAppMode: (m: AppMode) => void;
  setRunMode: (m: RunMode) => void;
  setTransport: (t: TransportState) => void;
  setAudioStatus: (s: AudioStatus, detail?: string | null) => void;
  setLimiterActive: (b: boolean) => void;
  setMasterVolume: (v: number) => void;
  setMuted: (b: boolean) => void;
  bumpLiveTick: () => void;
  setCaptureStatus: (s: UiState['captureStatus'], error?: string | null) => void;
  bumpCaptureRevision: () => void;
  setCaptureDuration: (d: number) => void;
  setCaptureSeed: (s: number) => void;
  setActiveLesson: (id: string | null) => void;
  setActiveChallenge: (id: string | null) => void;
  setOnboardingOpen: (b: boolean) => void;
  setProjectManagerOpen: (b: boolean) => void;
  setExportDialogOpen: (b: boolean) => void;
  setHelpOpen: (b: boolean) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  appMode: 'sandbox',
  runMode: 'live',
  transport: 'stopped',
  audioStatus: 'idle',
  audioDetail: null,
  limiterActive: false,
  masterVolume: 0.25,
  muted: false,
  liveTick: 0,
  captureStatus: 'idle',
  captureRevision: 0,
  captureError: null,
  captureDuration: 1,
  captureSeed: 1,
  activeLessonId: null,
  activeChallengeId: null,
  onboardingOpen: false,
  projectManagerOpen: false,
  exportDialogOpen: false,
  helpOpen: false,
  toasts: [],

  setAppMode: (appMode) => set({ appMode }),
  setRunMode: (runMode) => set({ runMode }),
  setTransport: (transport) => set({ transport }),
  setAudioStatus: (audioStatus, audioDetail = null) => set({ audioStatus, audioDetail }),
  setLimiterActive: (limiterActive) => set({ limiterActive }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setMuted: (muted) => set({ muted }),
  bumpLiveTick: () => set((s) => ({ liveTick: s.liveTick + 1 })),
  setCaptureStatus: (captureStatus, captureError = null) => set({ captureStatus, captureError }),
  bumpCaptureRevision: () => set((s) => ({ captureRevision: s.captureRevision + 1 })),
  setCaptureDuration: (captureDuration) => set({ captureDuration }),
  setCaptureSeed: (captureSeed) => set({ captureSeed }),
  setActiveLesson: (activeLessonId) => set({ activeLessonId }),
  setActiveChallenge: (activeChallengeId) => set({ activeChallengeId }),
  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
  setProjectManagerOpen: (projectManagerOpen) => set({ projectManagerOpen }),
  setExportDialogOpen: (exportDialogOpen) => set({ exportDialogOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  toast: (kind, text) =>
    set((s) => {
      const id = ++toastId;
      // Auto-dismiss
      setTimeout(() => {
        useUiStore.getState().dismissToast(id);
      }, kind === 'error' ? 8000 : 4500);
      return { toasts: [...s.toasts.slice(-4), { id, kind, text }] };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
