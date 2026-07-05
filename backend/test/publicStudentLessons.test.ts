/**
 * （責務）未認証 GET /api/public/student-lessons の Vitest。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classrooms,
  lessonTypes,
  lessons,
  students,
  subjects,
  users,
} from '../db/schema';
import { app } from '../worker';

type StudentRow = {
  id: string;
  classroomId: string;
  name: string;
  deletedAt: Date | null;
};
type ClassroomRow = { id: string; deletedAt: Date | null };
type LessonRow = {
  id: string;
  teacherId: string;
  studentId: string;
  classroomId: string;
  subjectId: string;
  lessonTypeId: string;
  startAt: Date;
  endAt: Date;
  deletedAt: Date | null;
};
type UserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  color: string | null;
  deletedAt: Date | null;
};
type SubjectRow = {
  id: string;
  classroomId: string;
  name: string;
  deletedAt: Date | null;
};
type LessonTypeRow = {
  id: string;
  classroomId: string;
  name: string;
  deletedAt: Date | null;
};

const state: {
  studentRows: StudentRow[];
  classroomRows: ClassroomRow[];
  lessonRows: LessonRow[];
  userRows: UserRow[];
  subjectRows: SubjectRow[];
  lessonTypeRows: LessonTypeRow[];
} = {
  studentRows: [],
  classroomRows: [],
  lessonRows: [],
  userRows: [],
  subjectRows: [],
  lessonTypeRows: [],
};

vi.mock('../db', () => {
  const walkPredicate = (
    predicate: unknown,
  ): { strings: string[]; dates: Date[] } => {
    const strings: string[] = [];
    const dates: Date[] = [];
    const visited = new Set<object>();
    const stack: unknown[] = [predicate];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current instanceof Date) {
        dates.push(current);
        continue;
      }
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const v = (current as { value?: unknown }).value;
      if (typeof v === 'string') {
        strings.push(v);
      } else if (v instanceof Date) {
        dates.push(v);
      }
      for (const x of Object.values(current)) {
        stack.push(x);
      }
    }
    return { strings, dates };
  };

  const isLessonsSelection = (sel: Record<string, unknown>) =>
    Object.values(sel).some((v) => v === lessons.teacherId);

  const getDb = () => ({
    select: (sel: Record<string, unknown>) => {
      const keys = Object.keys(sel);

      return {
        from: (table: unknown) => {
          if (table === students && keys.includes('classroomId')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const { strings } = walkPredicate(predicate);
                  const id = strings.find((s) =>
                    state.studentRows.some((r) => r.id === s),
                  );
                  const row = state.studentRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row
                    ? [
                        {
                          id: row.id,
                          classroomId: row.classroomId,
                          name: row.name,
                        },
                      ]
                    : [];
                },
              }),
            };
          }

          if (table === classrooms && keys.length === 1 && keys[0] === 'id') {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const { strings } = walkPredicate(predicate);
                  const id = strings.find((s) =>
                    state.classroomRows.some((r) => r.id === s),
                  );
                  const row = state.classroomRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row ? [{ id: row.id }] : [];
                },
              }),
            };
          }

          if (table === lessons && isLessonsSelection(sel)) {
            return {
              where: async (predicate: unknown) => {
                const { strings, dates: datesFromWalk } =
                  walkPredicate(predicate);
                const studentId = strings.find((s) =>
                  state.studentRows.some((r) => r.id === s),
                );
                if (!studentId) {
                  return [];
                }
                const sorted = [...datesFromWalk].sort(
                  (a, b) => a.getTime() - b.getTime(),
                );
                const from = sorted[0];
                const to = sorted[sorted.length - 1];
                if (!from || !to) {
                  return [];
                }
                return state.lessonRows
                  .filter(
                    (r) =>
                      r.studentId === studentId &&
                      r.deletedAt === null &&
                      r.startAt < to &&
                      r.endAt > from,
                  )
                  .map((r) => ({
                    id: r.id,
                    teacherId: r.teacherId,
                    studentId: r.studentId,
                    classroomId: r.classroomId,
                    subjectId: r.subjectId,
                    lessonTypeId: r.lessonTypeId,
                    startAt: r.startAt,
                    endAt: r.endAt
                  }));
              },
            };
          }

          if (table === users && keys.includes('firstName')) {
            return {
              where: async (predicate: unknown) => {
                const { strings } = walkPredicate(predicate);
                const ids = strings.filter((s) =>
                  state.userRows.some((u) => u.id === s),
                );
                const unique = [...new Set(ids)];
                return state.userRows
                  .filter((u) => unique.includes(u.id) && u.deletedAt === null)
                  .map((u) => ({
                    id: u.id,
                    firstName: u.firstName,
                    lastName: u.lastName,
                    color: u.color,
                    deletedAt: u.deletedAt,
                  }));
              },
            };
          }

          if (table === subjects && keys.includes('name')) {
            return {
              where: async (predicate: unknown) => {
                const { strings } = walkPredicate(predicate);
                const classroomId = strings.find((s) =>
                  state.classroomRows.some((c) => c.id === s),
                );
                const ids = strings.filter((s) =>
                  state.subjectRows.some((x) => x.id === s),
                );
                return state.subjectRows
                  .filter(
                    (s) =>
                      ids.includes(s.id) &&
                      (!classroomId || s.classroomId === classroomId),
                  )
                  .map((s) => ({
                    id: s.id,
                    name: s.name,
                    deletedAt: s.deletedAt,
                  }));
              },
            };
          }

          if (table === lessonTypes && keys.includes('name')) {
            return {
              where: async (predicate: unknown) => {
                const { strings } = walkPredicate(predicate);
                const classroomId = strings.find((s) =>
                  state.classroomRows.some((c) => c.id === s),
                );
                const ids = strings.filter((s) =>
                  state.lessonTypeRows.some((x) => x.id === s),
                );
                return state.lessonTypeRows
                  .filter(
                    (s) =>
                      ids.includes(s.id) &&
                      (!classroomId || s.classroomId === classroomId),
                  )
                  .map((s) => ({
                    id: s.id,
                    name: s.name,
                    deletedAt: s.deletedAt,
                  }));
              },
            };
          }

          return {
            where: () => ({
              limit: async () => [],
            }),
          };
        },
      };
    },
  });

  return { getDb };
});

const env = {
  AUTH0_AUDIENCE: 'https://api.example.local',
  AUTH0_ISSUER: 'https://issuer.example.local/',
  AUTH0_JWKS_URI: 'https://issuer.example.local/.well-known/jwks.json',
  VITE_AUTH0_DOMAIN: 'tenant.example.auth0.com',
  AUTH0_M2M_CLIENT_ID: 'm2m-client-id',
  AUTH0_M2M_CLIENT_SECRET: 'm2m-client-secret',
  AUTH0_DB_CONNECTION: 'Username-Password-Authentication',
  VITE_AUTH0_CLIENT_ID: 'spa-client-id',
  DB: {},
} as unknown as Env;

describe('GET /api/public/student-lessons', () => {
  beforeEach(() => {
    state.classroomRows = [{ id: 'room-1', deletedAt: null }];
    state.studentRows = [
      {
        id: 'stu-1',
        classroomId: 'room-1',
        name: '佐藤 花子',
        deletedAt: null,
      },
    ];
    state.userRows = [
      {
        id: 'teacher-1',
        firstName: '太郎',
        lastName: '山田',
        color: '#22c55e',
        deletedAt: null,
      },
    ];
    state.subjectRows = [
      { id: 'sub-1', classroomId: 'room-1', name: '英語', deletedAt: null },
    ];
    state.lessonTypeRows = [
      { id: 'lt-1', classroomId: 'room-1', name: '通常', deletedAt: null },
    ];
    state.lessonRows = [
      {
        id: 'L-pub',
        teacherId: 'teacher-1',
        studentId: 'stu-1',
        classroomId: 'room-1',
        subjectId: 'sub-1',
        lessonTypeId: 'lt-1',
        startAt: new Date('2025-06-10T10:00:00.000Z'),
        endAt: new Date('2025-06-10T11:00:00.000Z'),
        deletedAt: null,
      },
      {
        id: 'L-draft',
        teacherId: 'teacher-1',
        studentId: 'stu-1',
        classroomId: 'room-1',
        subjectId: 'subject-1',
        lessonTypeId: 'lessonType-1',
        startAt: new Date('2025-06-11T10:00:00.000Z'),
        endAt: new Date('2025-06-11T11:00:00.000Z'),
        deletedAt: null,
      },
      {
        id: 'L-del',
        teacherId: 'teacher-1',
        studentId: 'stu-1',
        classroomId: 'room-1',
        subjectId: 'subject-1',
        lessonTypeId: 'lessonType-1',
        startAt: new Date('2025-06-12T10:00:00.000Z'),
        endAt: new Date('2025-06-12T11:00:00.000Z'),
        deletedAt: new Date()
      },
    ];
  });

  it('returns 400 without student_id', async () => {
    const res = await app.request(
      '/api/public/student-lessons?from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing student', async () => {
    const res = await app.request(
      '/api/public/student-lessons?student_id=missing&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for soft-deleted student', async () => {
    state.studentRows[0] = {
      id: 'stu-1',
      classroomId: 'room-1',
      name: '佐藤 花子',
      deletedAt: new Date(),
    };
    const res = await app.request(
      '/api/public/student-lessons?student_id=stu-1&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns active lessons in range and excludes soft-deleted lessons', async () => {
    const res = await app.request(
      '/api/public/student-lessons?student_id=stu-1&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      studentName: string;
      lessons: Array<{
        id: string;
        teacherDisplay: string;
        teacherColor: string | null;
        subjectName: string;
        lessonTypeName: string;
      }>;
    };
    expect(payload.studentName).toBe('佐藤 花子');
    expect(payload.lessons.map((r) => r.id)).toEqual(['L-pub', 'L-draft']);
    expect(payload.lessons[0]?.teacherDisplay).toContain('山田');
    expect(payload.lessons[0]?.teacherColor).toBe('#22c55e');
    expect(payload.lessons[0]?.subjectName).toBe('英語');
    expect(payload.lessons[0]?.lessonTypeName).toBe('通常');
  });

  it('marks deleted preset names in response', async () => {
    state.subjectRows[0] = {
      id: 'sub-1',
      classroomId: 'room-1',
      name: '英語',
      deletedAt: new Date(),
    };
    const res = await app.request(
      '/api/public/student-lessons?student_id=stu-1&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      lessons: Array<{ subjectName: string }>;
    };
    expect(payload.lessons[0]?.subjectName).toBe('（削除済み）');
  });

  it('excludes lessons whose teacher is soft-deleted', async () => {
    state.userRows[0] = {
      id: 'teacher-1',
      firstName: '太郎',
      lastName: '山田',
      color: '#22c55e',
      deletedAt: new Date(),
    };
    const res = await app.request(
      '/api/public/student-lessons?student_id=stu-1&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { lessons: unknown[] };
    expect(payload.lessons).toHaveLength(0);
  });

  it('does not require Authorization header', async () => {
    const res = await app.request(
      '/api/public/student-lessons?student_id=stu-1&from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET', headers: {} },
      env,
    );
    expect(res.status).toBe(200);
  });
});
