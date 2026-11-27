// Home school and courses (INS-01/02, LIB-01, LIB-12). Every query is scoped by user_id (AGENTS rule 8).

import { uuid7 } from '../shared/uuid7.ts';
import type { CourseInput, CourseKind, SchoolRef } from '../shared/courses.ts';

export type CourseRow = {
  id: string;
  kind: CourseKind;
  name: string;
  subject_code: string | null;
  course_number: string | null;
  official_title: string | null;
  institution_unitid: string | null;
  institution_name: string;
  institution_domain: string | null;
  code_verified: number;
  archived_at: number | null;
  created_at: number;
};

export type Course = {
  id: string;
  kind: CourseKind;
  name: string;
  code: string | null;
  title: string | null;
  /** Null for personal courses (LIB-01b). */
  school: SchoolRef | null;
  codeVerified: boolean;
  archived: boolean;
  createdAt: number;
};

export function toCourse(r: CourseRow): Course {
  return {
    id: r.id,
    kind: r.kind === 'personal' ? 'personal' : 'college',
    name: r.name,
    code: r.subject_code && r.course_number ? `${r.subject_code} ${r.course_number}` : null,
    title: r.official_title,
    school: r.kind === 'personal' ? null : { unitid: r.institution_unitid, name: r.institution_name, domain: r.institution_domain },
    codeVerified: r.code_verified === 1,
    archived: r.archived_at !== null,
    createdAt: r.created_at,
  };
}

export async function getHomeSchool(db: D1Database, userId: string): Promise<SchoolRef | null> {
  const r = await db
    .prepare('SELECT home_unitid, home_institution_name, home_institution_domain FROM settings WHERE user_id = ?')
    .bind(userId)
    .first<{ home_unitid: string | null; home_institution_name: string | null; home_institution_domain: string | null }>();
  if (!r || !r.home_institution_name) return null;
  return { unitid: r.home_unitid, name: r.home_institution_name, domain: r.home_institution_domain };
}

export async function setHomeSchool(db: D1Database, userId: string, school: SchoolRef, now = Date.now()): Promise<SchoolRef> {
  await db
    .prepare(
      `INSERT INTO settings (user_id, home_unitid, home_institution_name, home_institution_domain, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET home_unitid = ?2, home_institution_name = ?3, home_institution_domain = ?4, updated_at = ?5`,
    )
    .bind(userId, school.unitid, school.name, school.domain, now)
    .run();
  return school;
}

const COLS = 'id, kind, name, subject_code, course_number, official_title, institution_unitid, institution_name, institution_domain, code_verified, archived_at, created_at';

export async function listCourses(db: D1Database, userId: string): Promise<Course[]> {
  const res = await db
    .prepare(`SELECT ${COLS} FROM courses WHERE user_id = ? ORDER BY archived_at IS NOT NULL, created_at ASC`)
    .bind(userId)
    .all<CourseRow>();
  return res.results.map(toCourse);
}

export class DuplicateCourse extends Error {
  constructor(code: string) {
    super(`You already have ${code} at this school.`);
    this.name = 'DuplicateCourse';
  }
}

export async function createCourse(db: D1Database, userId: string, input: CourseInput, now = Date.now()): Promise<Course> {
  const school = input.school ?? { unitid: null, name: '', domain: null }; // personal: no school
  if (input.subject && input.number && input.school) {
    const dup = await db
      .prepare(
        `SELECT id FROM courses WHERE user_id = ? AND subject_code = ? AND course_number = ? AND archived_at IS NULL
         AND COALESCE(institution_unitid, institution_name) = COALESCE(?, ?)`,
      )
      .bind(userId, input.subject, input.number, input.school.unitid, input.school.name)
      .first();
    if (dup) throw new DuplicateCourse(input.code as string);
  }
  const id = uuid7(now);
  await db
    .prepare(
      `INSERT INTO courses (id, user_id, kind, name, institution_unitid, institution_name, institution_domain, subject_code, course_number,
        official_title, code_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(id, userId, input.kind, input.title, school.unitid, school.name, school.domain, input.subject, input.number, input.kind === 'personal' ? null : input.title, now, now)
    .run();
  const row = await db.prepare(`SELECT ${COLS} FROM courses WHERE id = ? AND user_id = ?`).bind(id, userId).first<CourseRow>();
  if (!row) throw new Error('Course missing after insert');
  return toCourse(row);
}

export async function updateCourse(db: D1Database, userId: string, id: string, patch: { name?: string; archived?: boolean }, now = Date.now()): Promise<Course | null> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (typeof patch.name === 'string') {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (typeof patch.archived === 'boolean') {
    sets.push('archived_at = ?');
    params.push(patch.archived ? now : null);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    await db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params, id, userId).run();
  }
  const row = await db.prepare(`SELECT ${COLS} FROM courses WHERE id = ? AND user_id = ?`).bind(id, userId).first<CourseRow>();
  return row ? toCourse(row) : null;
}

/** Delete a course. Its units and topics go with it; sources and cards keep existing, unlinked (FK SET NULL). */
export async function deleteCourse(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
