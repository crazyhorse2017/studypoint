// Home school + courses on the client (INS-01/02, LIB-01). Loaded once, refreshed after changes.

import { useSyncExternalStore } from 'react';
import type { SchoolRef } from '../shared/courses.ts';
import { indexSchools, type School } from '../shared/schoolSearch.ts';
import { api } from './api.ts';

export type Course = {
  id: string;
  /** 'personal' = a subject for its own sake: no school, no code (LIB-01b). */
  kind: 'college' | 'personal';
  name: string;
  code: string | null;
  title: string | null;
  school: SchoolRef | null;
  codeVerified: boolean;
  archived: boolean;
  createdAt: number;
};

type State = { loaded: boolean; error: string | null; school: SchoolRef | null; courses: Course[] };

let state: State = { loaded: false, error: null, school: null, courses: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export async function loadStudy(): Promise<void> {
  try {
    const [s, c] = await Promise.all([
      api<{ school: SchoolRef | null }>('GET', '/api/school'),
      api<{ courses: Course[] }>('GET', '/api/courses'),
    ]);
    set({ loaded: true, error: null, school: s.school, courses: c.courses });
  } catch (e) {
    set({ loaded: true, error: e instanceof Error ? e.message : 'Something went wrong.' });
  }
}

export async function chooseSchool(school: SchoolRef): Promise<void> {
  const r = await api<{ school: SchoolRef }>('PUT', '/api/school', school);
  set({ school: r.school });
}

export async function addCourse(input: { kind: 'college' | 'personal'; code: string; title: string }): Promise<Course> {
  const r = await api<{ course: Course }>('POST', '/api/courses', input);
  set({ courses: [...state.courses, r.course] });
  return r.course;
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  const r = await api<{ course: Course }>('PATCH', `/api/courses/${encodeURIComponent(id)}`, { archived });
  set({ courses: state.courses.map((c) => (c.id === id ? r.course : c)) });
}

export async function renameCourse(id: string, name: string): Promise<void> {
  const r = await api<{ course: Course }>('PATCH', `/api/courses/${encodeURIComponent(id)}`, { name });
  set({ courses: state.courses.map((c) => (c.id === id ? r.course : c)) });
}

export async function removeCourse(id: string): Promise<void> {
  await api('DELETE', `/api/courses/${encodeURIComponent(id)}`);
  set({ courses: state.courses.filter((c) => c.id !== id) });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStudy(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// ---- College directory (static asset, loaded only when the picker opens) --------------------------
let directory: Promise<ReturnType<typeof indexSchools>> | null = null;

export function loadDirectory(): Promise<ReturnType<typeof indexSchools>> {
  if (!directory) {
    directory = fetch('/data/institutions.json')
      .then((r) => {
        if (!r.ok) throw new Error('directory');
        return r.json() as Promise<{ institutions: School[] }>;
      })
      .then((d) => indexSchools(d.institutions))
      .catch((e) => {
        directory = null; // allow a retry
        throw e;
      });
  }
  return directory;
}
