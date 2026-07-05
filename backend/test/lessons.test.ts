/**
 * （責務）コマ CRUD・週件取得系 API の Vitest。
 */
import { Column, SQL, StringChunk, is } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classrooms,
  lessonTypes,
  lessons,
  students,
  subjects,
  users,
} from '../db/schema';
import { app } from '../worker';

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
  role: string;
  classroomId: string | null;
  deletedAt: Date | null;
  firstName?: string | null;
  lastName?: string | null;
};

type StudentRow = {
  id: string;
  classroomId: string;
  deletedAt: Date | null;
  name?: string | null;
};

type PresetRow = {
  id: string;
  classroomId: string;
  name: string;
  deletedAt: Date | null;
};

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function isLessonsColumn(value: unknown): value is Column {
  return is(value, Column) && (value as Column).table === lessons;
}

function paramValue(chunk: unknown): unknown {
  if (typeof chunk !== 'object' || chunk === null) {
    return undefined;
  }
  if (
    (chunk as { constructor?: { name?: string } }).constructor?.name !== 'Param'
  ) {
    return undefined;
  }
  return (chunk as { value: unknown }).value;
}

function calendarWhereAndParts(predicate: unknown): SQL[] {
  if (!predicate || typeof predicate !== 'object') {
    return [];
  }
  const root = predicate as SQL;
  if (!is(root, SQL)) {
    return [];
  }
  let qc = root.queryChunks;
  if (
    qc.length === 3 &&
    is(qc[0], StringChunk) &&
    qc[0].value.join('') === '(' &&
    is(qc[2], StringChunk) &&
    qc[2].value.join('') === ')' &&
    is(qc[1], SQL)
  ) {
    qc = qc[1].queryChunks;
  }
  const parts: SQL[] = [];
  for (const ch of qc) {
    if (is(ch, SQL)) {
      parts.push(ch);
    }
  }
  return parts;
}

function evalCalendarAtomOnRow(row: LessonRow, atom: SQL): boolean {
  const chunks = atom.queryChunks.filter(
    (c) => !(is(c, StringChunk) && c.value.join('') === ''),
  );
  if (chunks.length < 2 || !isLessonsColumn(chunks[0])) {
    return true;
  }
  const col = chunks[0] as Column;
  if (!is(chunks[1], StringChunk)) {
    return true;
  }
  const op = chunks[1].value.join('');
  if (op === ' = ') {
    const v = paramValue(chunks[2]);
    if (col === lessons.classroomId && typeof v === 'string') {
      return row.classroomId === v;
    }
    return true;
  }
  if (op === ' is null') {
    if (col === lessons.deletedAt) {
      return row.deletedAt === null;
    }
    return true;
  }
  if (op === ' < ') {
    const v = paramValue(chunks[2]);
    if (col === lessons.startAt && v instanceof Date) {
      return row.startAt < v;
    }
    return true;
  }
  if (op === ' > ') {
    const v = paramValue(chunks[2]);
    if (col === lessons.endAt && v instanceof Date) {
      return row.endAt > v;
    }
    return true;
  }
  return true;
}

function lessonRowMatchesCalendarPredicate(
  row: LessonRow,
  predicate: unknown,
): boolean {
  const parts = calendarWhereAndParts(predicate);
  if (parts.length === 0) {
    return false;
  }
  return parts.every((p) => evalCalendarAtomOnRow(row, p));
}

const state: {
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string;
  classrooms: Array<{ id: string; deletedAt: Date | null }>;
  users: UserRow[];
  students: StudentRow[];
  subjectRows: PresetRow[];
  lessonTypeRows: PresetRow[];
  lessonRows: LessonRow[];
  expectPostLessonTx: boolean;
  expectPatchLessonTx: boolean;
  lessonTxLimitIndex: number;
  inTx: boolean;
  postFixture: {
    classroomId: string;
    teacherId: string;
    studentId: string;
    startAt: Date;
    endAt: Date;
  } | null;
  patchTargetId: string | null;
  patchMerged: {
    classroomId: string;
    teacherId: string;
    studentId: string;
    startAt: Date;
    endAt: Date;
  } | null;
} = {
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  classrooms: [],
  users: [],
  students: [],
  subjectRows: [],
  lessonTypeRows: [],
  lessonRows: [],
  expectPostLessonTx: false,
  expectPatchLessonTx: false,
  lessonTxLimitIndex: 0,
  inTx: false,
  postFixture: null,
  patchTargetId: null,
  patchMerged: null,
};

vi.mock('hono/jwk', () => {
  return {
    jwk: () => {
      return async (
        c: { set: (key: string, value: unknown) => void },
        next: () => Promise<void>,
      ) => {
        c.set('jwtPayload', { sub: state.jwtSub });
        await next();
      };
    },
  };
});

vi.mock('../db', () => {
  const extractRequestedId = (predicate: unknown): string | null => {
    if (typeof predicate === 'string') {
      return predicate;
    }
    const visited = new Set<object>();
    const stack: unknown[] = [predicate];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const candidate = (current as { value?: unknown }).value;
      if (typeof candidate === 'string') {
        return candidate;
      }
      for (const value of Object.values(current)) {
        stack.push(value);
      }
    }
    return null;
  };

  const dbCore = {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === users) {
          const keys = Object.keys(selection ?? {});
          if (
            keys.length === 3 &&
            keys.includes('role') &&
            keys.includes('classroomId')
          ) {
            return {
              where: () => ({
                limit: async () =>
                  state.userRole
                    ? [
                        {
                          id: state.jwtSub,
                          role: state.userRole,
                          classroomId:
                            state.userRole === 'admin' ? null : 'room-1',
                        },
                      ]
                    : [],
              }),
            };
          }
          if (keys.length === 1 && keys[0] === 'classroomId') {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const uid = extractRequestedId(predicate);
                  const u = state.users.find(
                    (x) => x.id === uid && x.deletedAt === null,
                  );
                  return u ? [{ classroomId: u.classroomId }] : [];
                },
              }),
            };
          }
          if (
            keys.includes('id') &&
            keys.includes('firstName') &&
            keys.includes('lastName') &&
            keys.includes('deletedAt')
          ) {
            return {
              where: async () =>
                state.users.map((u) => ({
                  id: u.id,
                  firstName: u.firstName ?? null,
                  lastName: u.lastName ?? null,
                  deletedAt: u.deletedAt,
                })),
            };
          }
          if (
            keys.length === 1 &&
            keys[0] === 'id' &&
            (state.inTx ||
              state.expectPostLessonTx ||
              state.expectPatchLessonTx)
          ) {
            return {
              where: () => ({
                limit: async () => {
                  const i = state.lessonTxLimitIndex++;
                  if (
                    state.expectPostLessonTx &&
                    i === 1 &&
                    state.postFixture
                  ) {
                    const t = state.postFixture;
                    const u = state.users.find((x) => {
                      if (x.id !== t.teacherId || x.deletedAt !== null) {
                        return false;
                      }
                      if (state.userRole === 'admin') {
                        return true;
                      }
                      return x.classroomId === t.classroomId;
                    });
                    return u ? [{ id: u.id }] : [];
                  }
                  if (
                    state.expectPatchLessonTx &&
                    i === 2 &&
                    state.patchMerged
                  ) {
                    const t = state.patchMerged;
                    const u = state.users.find((x) => {
                      if (x.id !== t.teacherId || x.deletedAt !== null) {
                        return false;
                      }
                      if (state.userRole === 'admin') {
                        return true;
                      }
                      return x.classroomId === t.classroomId;
                    });
                    return u ? [{ id: u.id }] : [];
                  }
                  return [];
                },
              }),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        if (table === classrooms) {
          return {
            where: () => ({
              limit: async () => {
                const i = state.lessonTxLimitIndex++;
                const wantPost =
                  state.expectPostLessonTx && i === 0 && state.postFixture;
                const wantPatch =
                  state.expectPatchLessonTx && i === 1 && state.patchMerged;
                if (wantPost) {
                  const cid = state.postFixture!.classroomId;
                  const c = state.classrooms.find(
                    (r) => r.id === cid && r.deletedAt === null,
                  );
                  return c ? [{ id: c.id }] : [];
                }
                if (wantPatch) {
                  const cid = state.patchMerged!.classroomId;
                  const c = state.classrooms.find(
                    (r) => r.id === cid && r.deletedAt === null,
                  );
                  return c ? [{ id: c.id }] : [];
                }
                const requestedId = extractRequestedId(selection);
                void requestedId;
                return [];
              },
            }),
          };
        }

        if (table === students) {
          const keys = Object.keys(selection ?? {});
          if (
            keys.includes('id') &&
            keys.includes('name') &&
            keys.includes('deletedAt')
          ) {
            return {
              where: async () =>
                state.students.map((s) => ({
                  id: s.id,
                  name: s.name ?? null,
                  deletedAt: s.deletedAt,
                })),
            };
          }
          if (
            keys.length === 1 &&
            keys[0] === 'id' &&
            (state.inTx ||
              state.expectPostLessonTx ||
              state.expectPatchLessonTx)
          ) {
            return {
              where: () => ({
                limit: async () => {
                  const i = state.lessonTxLimitIndex++;
                  if (
                    state.expectPostLessonTx &&
                    i === 2 &&
                    state.postFixture
                  ) {
                    const t = state.postFixture;
                    const s = state.students.find(
                      (x) =>
                        x.id === t.studentId &&
                        x.classroomId === t.classroomId &&
                        x.deletedAt === null,
                    );
                    return s ? [{ id: s.id }] : [];
                  }
                  if (
                    state.expectPatchLessonTx &&
                    i === 3 &&
                    state.patchMerged
                  ) {
                    const t = state.patchMerged;
                    const s = state.students.find(
                      (x) =>
                        x.id === t.studentId &&
                        x.classroomId === t.classroomId &&
                        x.deletedAt === null,
                    );
                    return s ? [{ id: s.id }] : [];
                  }
                  return [];
                },
              }),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        if (table === lessons) {
          const keys = Object.keys(selection ?? {});
          const isCalendarList =
            keys.includes('teacherId') &&
            keys.includes('startAt') &&
            !keys.includes('deletedAt');
          if (isCalendarList) {
            return {
              where: async (predicate: unknown) =>
                state.lessonRows
                  .filter((r) =>
                    lessonRowMatchesCalendarPredicate(r, predicate),
                  )
                  .map((r) => ({
                    id: r.id,
                    teacherId: r.teacherId,
                    studentId: r.studentId,
                    classroomId: r.classroomId,
                    subjectId: r.subjectId,
                    lessonTypeId: r.lessonTypeId,
                    startAt: r.startAt,
                    endAt: r.endAt,
                  })),
            };
          }

          if (
            keys.includes('classroomId') &&
            keys.includes('teacherId') &&
            keys.includes('id')
          ) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const id = extractRequestedId(predicate);
                  const row = state.lessonRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row
                    ? [
                        {
                          id: row.id,
                          classroomId: row.classroomId,
                          teacherId: row.teacherId,
                        },
                      ]
                    : [];
                },
              }),
            };
          }

          if (keys.length === 1 && keys[0] === 'id') {
            return {
              where: () => ({
                limit: async () => {
                  const i = state.lessonTxLimitIndex++;
                  if (state.expectPostLessonTx && state.postFixture) {
                    if (i === 3) {
                      const t = state.postFixture;
                      const clash = state.lessonRows.find(
                        (r) =>
                          r.deletedAt === null &&
                          r.teacherId === t.teacherId &&
                          overlaps(r.startAt, r.endAt, t.startAt, t.endAt),
                      );
                      return clash ? [{ id: clash.id }] : [];
                    }
                    if (i === 4) {
                      const t = state.postFixture;
                      const clash = state.lessonRows.find(
                        (r) =>
                          r.deletedAt === null &&
                          r.studentId === t.studentId &&
                          overlaps(r.startAt, r.endAt, t.startAt, t.endAt),
                      );
                      return clash ? [{ id: clash.id }] : [];
                    }
                  }
                  if (
                    state.expectPatchLessonTx &&
                    state.patchMerged &&
                    state.patchTargetId
                  ) {
                    if (i === 0) {
                      const row = state.lessonRows.find(
                        (r) =>
                          r.id === state.patchTargetId && r.deletedAt === null,
                      );
                      return row ? [{ id: row.id }] : [];
                    }
                    if (i === 4) {
                      const t = state.patchMerged;
                      const clash = state.lessonRows.find(
                        (r) =>
                          r.deletedAt === null &&
                          r.id !== state.patchTargetId &&
                          r.teacherId === t.teacherId &&
                          overlaps(r.startAt, r.endAt, t.startAt, t.endAt),
                      );
                      return clash ? [{ id: clash.id }] : [];
                    }
                    if (i === 5) {
                      const t = state.patchMerged;
                      const clash = state.lessonRows.find(
                        (r) =>
                          r.deletedAt === null &&
                          r.id !== state.patchTargetId &&
                          r.studentId === t.studentId &&
                          overlaps(r.startAt, r.endAt, t.startAt, t.endAt),
                      );
                      return clash ? [{ id: clash.id }] : [];
                    }
                  }
                  return [];
                },
              }),
            };
          }

          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const id = extractRequestedId(predicate);
                const row = state.lessonRows.find(
                  (r) => r.id === id && r.deletedAt === null,
                );
                return row ? [row] : [];
              },
            }),
          };
        }

        if (table === subjects) {
          const keys = Object.keys(selection ?? {});
          if (
            keys.includes('id') &&
            keys.includes('name') &&
            keys.includes('deletedAt')
          ) {
            return {
              where: async () =>
                state.subjectRows.map((s) => ({
                  id: s.id,
                  name: s.name,
                  deletedAt: s.deletedAt,
                })),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        if (table === lessonTypes) {
          const keys = Object.keys(selection ?? {});
          if (
            keys.includes('id') &&
            keys.includes('name') &&
            keys.includes('deletedAt')
          ) {
            return {
              where: async () =>
                state.lessonTypeRows.map((lt) => ({
                  id: lt.id,
                  name: lt.name,
                  deletedAt: lt.deletedAt,
                })),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        return { where: () => ({ limit: async () => [] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: LessonRow) => {
        if (table === lessons) {
          state.lessonRows.push({ ...value });
        }
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Partial<LessonRow> & { deletedAt?: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table !== lessons) {
            return { meta: { changes: 0 } };
          }
          const requestedId = extractRequestedId(predicate);
          const row = state.lessonRows.find(
            (r) =>
              r.id === requestedId &&
              (patch.deletedAt === undefined || r.deletedAt === null),
          );
          if (!row) {
            return { meta: { changes: 0 } };
          }
          if (patch.deletedAt !== undefined) {
            row.deletedAt = patch.deletedAt;
          }
          if (patch.teacherId !== undefined) {
            row.teacherId = patch.teacherId;
          }
          if (patch.studentId !== undefined) {
            row.studentId = patch.studentId;
          }
          if (patch.classroomId !== undefined) {
            row.classroomId = patch.classroomId;
          }
          if (patch.subjectId !== undefined) {
            row.subjectId = patch.subjectId;
          }
          if (patch.lessonTypeId !== undefined) {
            row.lessonTypeId = patch.lessonTypeId;
          }
          if (patch.startAt !== undefined) {
            row.startAt = patch.startAt;
          }
          if (patch.endAt !== undefined) {
            row.endAt = patch.endAt;
          }
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };

  const db = {
    ...dbCore,
    transaction: async <T>(
      callback: (tx: typeof dbCore) => Promise<T>,
    ): Promise<T> => {
      state.inTx = true;
      state.lessonTxLimitIndex = 0;
      try {
        return await callback(dbCore);
      } finally {
        state.inTx = false;
        state.expectPostLessonTx = false;
        state.expectPatchLessonTx = false;
        state.postFixture = null;
        state.patchMerged = null;
        state.patchTargetId = null;
      }
    },
  };

  return { getDb: () => db };
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

describe('lessons api', () => {
  const t1 = new Date('2025-06-10T10:00:00.000Z');
  const t2 = new Date('2025-06-10T11:00:00.000Z');

  beforeEach(() => {
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.classrooms = [{ id: 'room-1', deletedAt: null }];
    state.users = [
      {
        id: 'teacher-1',
        role: 'staff',
        classroomId: 'room-1',
        deletedAt: null,
        firstName: '一郎',
        lastName: '山田',
      },
      {
        id: 'teacher-2',
        role: 'staff',
        classroomId: 'room-1',
        deletedAt: null,
        firstName: '二郎',
        lastName: '佐藤',
      },
    ];
    state.students = [
      {
        id: 'student-1',
        classroomId: 'room-1',
        deletedAt: null,
        name: '生徒A',
      },
    ];
    state.lessonRows = [];
    state.subjectRows = [
      {
        id: 'subject-1',
        classroomId: 'room-1',
        name: '英語',
        deletedAt: null,
      },
    ];
    state.lessonTypeRows = [
      {
        id: 'lessonTypeId-1',
        classroomId: 'room-1',
        name: '通常',
        deletedAt: null,
      },
    ];
    state.expectPostLessonTx = false;
    state.expectPatchLessonTx = false;
    state.lessonTxLimitIndex = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => 'lesson-uuid-001',
    } as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /classrooms/:id/lessons returns 400 without range', async () => {
    const res = await app.request(
      '/api/lessons/room-1',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('GET /classrooms/:id/lessons returns rows in range', async () => {
    state.lessonRows.push({
      id: 'L1',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      classroomId: 'room-1',
      subjectId: 'subject-1',
      lessonTypeId: 'lessonTypeId-1',
      startAt: t1,
      endAt: t2,
      deletedAt: null,
    });
    const res = await app.request(
      '/api/lessons/room-1?from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      id: string;
      teacherDisplay: string;
      studentDisplay: string;
      subjectDisplay: string;
      lessonTypeDisplay: string;
    }>;
    expect(rows.some((r) => r.id === 'L1')).toBe(true);
    const row = rows.find((r) => r.id === 'L1');
    expect(row?.teacherDisplay).toContain('山田');
    expect(row?.studentDisplay).toBe('生徒A');
    expect(row?.subjectDisplay).toBe('英語');
    expect(row?.lessonTypeDisplay).toBe('通常');
  });

  it('GET /classrooms/:id/lessons marks deleted preset names in display', async () => {
    state.subjectRows[0] = {
      id: 'subject-1',
      classroomId: 'room-1',
      name: '英語',
      deletedAt: new Date('2025-05-01T00:00:00.000Z'),
    };
    state.lessonRows.push({
      id: 'L-deleted-subject',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      classroomId: 'room-1',
      subjectId: 'subject-1',
      lessonTypeId: 'lessonTypeId-1',
      startAt: t1,
      endAt: t2,
      deletedAt: null,
    });
    const res = await app.request(
      '/api/lessons/room-1?from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ subjectDisplay: string }>;
    expect(rows[0]?.subjectDisplay).toBe('（削除済み）');
  });

  it('GET /classrooms/:id/lessons marks soft-deleted teacher in display', async () => {
    state.users[0] = {
      ...state.users[0]!,
      deletedAt: new Date('2025-05-01T00:00:00.000Z'),
    };
    state.lessonRows.push({
      id: 'L-del-teach',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      classroomId: 'room-1',
      subjectId: 'subject-1',
      lessonTypeId: 'lessonType-1',
      startAt: t1,
      endAt: t2,
      deletedAt: null,
    });
    const res = await app.request(
      '/api/lessons/room-1?from=2025-06-01T00:00:00.000Z&to=2025-07-01T00:00:00.000Z',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ teacherDisplay: string }>;
    expect(rows[0]?.teacherDisplay).toContain('削除済み');
  });

  it('PATCH /lessons returns 403 when staff updates another teacher lesson', async () => {
    state.userRole = 'staff';
    state.jwtSub = 'teacher-1';
    state.lessonRows.push({
      id: 'L-other-teacher',
      teacherId: 'teacher-2',
      studentId: 'student-1',
      classroomId: 'room-1',
      subjectId: 'subject-1',
      lessonTypeId: 'lessonType-1',
      startAt: t1,
      endAt: t2,
      deletedAt: null,
    });
    const res = await app.request(
      '/api/lessons/L-other-teacher',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lessonTypeId: 'lessonType-1',
          subjectId: 'subject-1',
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it('PATCH /lessons returns 403 when manager updates lesson whose teacher is outside classroom', async () => {
    state.userRole = 'manager';
    state.jwtSub = 'auth0|manager-user';
    state.classrooms = [
      { id: 'room-1', deletedAt: null },
      { id: 'room-2', deletedAt: null },
    ];
    state.users = [
      {
        id: 'teacher-remote',
        role: 'staff',
        classroomId: 'room-2',
        deletedAt: null,
      },
    ];
    state.students = [
      { id: 'student-1', classroomId: 'room-2', deletedAt: null },
    ];
    state.lessonRows.push({
      id: 'L-mgr-patch-remote',
      teacherId: 'teacher-remote',
      studentId: 'student-1',
      classroomId: 'room-2',
      subjectId: 'subject-1',
      lessonTypeId: 'lessonType-1',
      startAt: t1,
      endAt: t2,
      deletedAt: null,
    });
    const res = await app.request(
      '/api/lessons/L-mgr-patch-remote',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lessonTypeId: 'lessonType-1',
          subjectId: 'subject-1',
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});
