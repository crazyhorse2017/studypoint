// What the background study-plan worker is doing (step 6b). A tiny store on its own, so the status line
// and pages can show progress without loading the worker (and the AI code it brings) up front.

import { useSyncExternalStore } from 'react';
import type { BuildProgress } from '../../shared/studyPlan.ts';

export type Job = { courseId: string; courseName: string; progress: BuildProgress };

let job: Job | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function setJob(next: Job | null): void {
  job = next;
  version += 1;
  listeners.forEach((l) => l());
}

export const currentJob = (): Job | null => job;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What the background worker is doing right now (null = nothing). */
export function usePlanJob(): Job | null {
  return useSyncExternalStore(subscribe, () => job, () => job);
}

/** Bumps whenever the worker starts, reports or finishes (pages re-read their plan on change). */
export function usePlanVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Ask the worker to look for work now (loads it if it isn't running yet). */
export function kickPlansSoon(): void {
  void import('./planRunner.ts').then((m) => m.kickPlans());
}
