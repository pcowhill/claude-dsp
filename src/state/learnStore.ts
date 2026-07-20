/** Lesson & challenge progress, persisted locally. */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface LessonProgress {
  completed: boolean;
  step: number;
  predictions: Record<string, number>; // checkpointId -> chosen option index
}

export interface ChallengeProgress {
  completed: boolean;
  bestScore: number;
  hintsUsed: number;
}

interface LearnState {
  lessons: Record<string, LessonProgress>;
  challenges: Record<string, ChallengeProgress>;
  setLessonStep: (id: string, step: number) => void;
  recordPrediction: (lessonId: string, checkpointId: string, choice: number) => void;
  completeLesson: (id: string) => void;
  resetLesson: (id: string) => void;
  recordChallengeResult: (id: string, score: number, completed: boolean) => void;
  useHint: (id: string) => void;
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set) => ({
      lessons: {},
      challenges: {},
      setLessonStep: (id, step) =>
        set((s) => {
          const cur = s.lessons[id] ?? { completed: false, step: 0, predictions: {} };
          return { lessons: { ...s.lessons, [id]: { ...cur, step } } };
        }),
      recordPrediction: (lessonId, checkpointId, choice) =>
        set((s) => {
          const cur = s.lessons[lessonId] ?? { completed: false, step: 0, predictions: {} };
          return {
            lessons: {
              ...s.lessons,
              [lessonId]: {
                ...cur,
                predictions: { ...cur.predictions, [checkpointId]: choice },
              },
            },
          };
        }),
      completeLesson: (id) =>
        set((s) => {
          const cur = s.lessons[id] ?? { completed: false, step: 0, predictions: {} };
          return { lessons: { ...s.lessons, [id]: { ...cur, completed: true } } };
        }),
      resetLesson: (id) =>
        set((s) => ({
          lessons: { ...s.lessons, [id]: { completed: false, step: 0, predictions: {} } },
        })),
      recordChallengeResult: (id, score, completed) =>
        set((s) => {
          const cur = s.challenges[id] ?? { completed: false, bestScore: 0, hintsUsed: 0 };
          return {
            challenges: {
              ...s.challenges,
              [id]: {
                ...cur,
                completed: cur.completed || completed,
                bestScore: Math.max(cur.bestScore, score),
              },
            },
          };
        }),
      useHint: (id) =>
        set((s) => {
          const cur = s.challenges[id] ?? { completed: false, bestScore: 0, hintsUsed: 0 };
          return {
            challenges: { ...s.challenges, [id]: { ...cur, hintsUsed: cur.hintsUsed + 1 } },
          };
        }),
    }),
    { name: 'spp.learnProgress', storage: createJSONStorage(() => localStorage) },
  ),
);
