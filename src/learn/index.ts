import type { Lesson } from './types';
import { lesson1, lesson2, lesson3, lesson4, lesson5 } from './lessons1';
import { lesson6, lesson7, lesson8, lesson9, lesson10 } from './lessons2';

export const LESSONS: Lesson[] = [
  lesson1,
  lesson2,
  lesson3,
  lesson4,
  lesson5,
  lesson6,
  lesson7,
  lesson8,
  lesson9,
  lesson10,
];

export { CHALLENGES } from './challenges';

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
