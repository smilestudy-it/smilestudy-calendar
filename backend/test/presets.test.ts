/**
 * （責務）教室プリセット系 API の Vitest。科目・授業種別・時間枠等。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classrooms,
  lessonTypes,
  subjects,
  timeSlots,
  users,
} from '../db/schema';
import { app } from '../worker';

/** 教室削除時のプリセット連鎖ソフトデリートは `classrooms.test.ts` で検証（DELETE /classrooms 用モックは同ファイルに集約）。 */

type ClassroomRow = { id: string; deletedAt: Date | null };
type SubjectRow = {
  id: string;
  name: string;
  classroomId: string;
  deletedAt: Date | null;
};
type LessonTypeRow = {
  id: string;
  name: string;
  classroomId: string;
  deletedAt: Date | null;
};
type TimeSlotRow = {
  id: string;
  classroomId: string;
  startTime: string;
  endTime: string;
  deletedAt: Date | null;
};

const state: {
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string;
  classrooms: ClassroomRow[];
  subjectRows: SubjectRow[];
  lessonTypeRows: LessonTypeRow[];
  timeSlotRows: TimeSlotRow[];
} = {
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  classrooms: [],
  subjectRows: [],
  lessonTypeRows: [],
  timeSlotRows: [],
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
    select: (selection: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === classrooms) {
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const requestedId = extractRequestedId(predicate);
                const classroom = state.classrooms.find(
                  (r) => r.id === requestedId && r.deletedAt === null,
                );
                return classroom ? [{ id: classroom.id }] : [];
              },
            }),
          };
        }

        if (table === users) {
          const keys = Object.keys(selection);
          if (
            keys.length === 3 &&
            keys.includes('id') &&
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
          return { where: () => ({ limit: async () => [] }) };
        }

        if (table === subjects) {
          const keys = Object.keys(selection);
          if (keys.includes('name') && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.subjectRows
                  .filter(
                    (r) =>
                      r.classroomId === classroomId && r.deletedAt === null,
                  )
                  .map((r) => ({ id: r.id, name: r.name }));
              },
            };
          }
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const targetId = extractRequestedId(predicate);
                const row = state.subjectRows.find(
                  (r) => r.id === targetId && r.deletedAt === null,
                );
                return row
                  ? [{ id: row.id, classroomId: row.classroomId }]
                  : [];
              },
            }),
          };
        }

        if (table === lessonTypes) {
          const keys = Object.keys(selection);
          if (keys.includes('name') && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.lessonTypeRows
                  .filter(
                    (r) =>
                      r.classroomId === classroomId && r.deletedAt === null,
                  )
                  .map((r) => ({ id: r.id, name: r.name }));
              },
            };
          }
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const targetId = extractRequestedId(predicate);
                const row = state.lessonTypeRows.find(
                  (r) => r.id === targetId && r.deletedAt === null,
                );
                return row
                  ? [{ id: row.id, classroomId: row.classroomId }]
                  : [];
              },
            }),
          };
        }

        if (table === timeSlots) {
          const keys = Object.keys(selection);
          if (keys.includes('classroomId') && keys.includes('startTime')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const targetId = extractRequestedId(predicate);
                  const row = state.timeSlotRows.find(
                    (r) => r.id === targetId && r.deletedAt === null,
                  );
                  return row
                    ? [
                        {
                          id: row.id,
                          classroomId: row.classroomId,
                          startTime: row.startTime,
                          endTime: row.endTime,
                        },
                      ]
                    : [];
                },
              }),
            };
          }
          if (keys.includes('startTime') && keys.includes('endTime')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.timeSlotRows
                  .filter(
                    (r) =>
                      r.classroomId === classroomId && r.deletedAt === null,
                  )
                  .map((r) => ({
                    id: r.id,
                    startTime: r.startTime,
                    endTime: r.endTime,
                  }));
              },
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        return { where: () => ({ limit: async () => [] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: SubjectRow | LessonTypeRow | TimeSlotRow) => {
        if (table === subjects) {
          state.subjectRows.push(value as SubjectRow);
        } else if (table === lessonTypes) {
          state.lessonTypeRows.push(value as LessonTypeRow);
        } else if (table === timeSlots) {
          state.timeSlotRows.push(value as TimeSlotRow);
        }
      },
    }),
    update: (table: unknown) => ({
      set: (value: {
        deletedAt?: Date | null;
        name?: string;
        startTime?: string;
        endTime?: string;
      }) => ({
        where: async (predicate: unknown) => {
          const requestedId = extractRequestedId(predicate);
          const apply = <T extends { id: string; deletedAt: Date | null }>(
            rows: T[],
            patch: (row: T) => void,
          ) => {
            const row = rows.find(
              (r) =>
                r.id === requestedId &&
                (value.deletedAt === undefined || r.deletedAt === null),
            );
            if (!row) {
              return { meta: { changes: 0 } };
            }
            patch(row);
            return { meta: { changes: 1 } };
          };

          if (table === subjects) {
            return apply(state.subjectRows, (row) => {
              if (value.name !== undefined) {
                row.name = value.name;
              }
              if (value.deletedAt !== undefined) {
                row.deletedAt = value.deletedAt;
              }
            });
          }
          if (table === lessonTypes) {
            return apply(state.lessonTypeRows, (row) => {
              if (value.name !== undefined) {
                row.name = value.name;
              }
              if (value.deletedAt !== undefined) {
                row.deletedAt = value.deletedAt;
              }
            });
          }
          if (table === timeSlots) {
            return apply(state.timeSlotRows, (row) => {
              if (value.startTime !== undefined) {
                row.startTime = value.startTime;
              }
              if (value.endTime !== undefined) {
                row.endTime = value.endTime;
              }
              if (value.deletedAt !== undefined) {
                row.deletedAt = value.deletedAt;
              }
            });
          }
          return { meta: { changes: 0 } };
        },
      }),
    }),
  };

  const db = {
    ...dbCore,
    transaction: async <T>(
      callback: (tx: typeof dbCore) => Promise<T>,
    ): Promise<T> => callback(dbCore),
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

describe('presets api', () => {
  beforeEach(() => {
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.classrooms = [
      { id: 'room-1', deletedAt: null },
      { id: 'room-2', deletedAt: null },
    ];
    state.subjectRows = [
      {
        id: 'sub-1',
        name: '英語',
        classroomId: 'room-1',
        deletedAt: null,
      },
      {
        id: 'sub-del',
        name: '削除済',
        classroomId: 'room-1',
        deletedAt: new Date(),
      },
    ];
    state.lessonTypeRows = [
      { id: 'lt-1', name: '通常', classroomId: 'room-1', deletedAt: null },
    ];
    state.timeSlotRows = [
      {
        id: 'ts-1',
        classroomId: 'room-1',
        startTime: '17:00',
        endTime: '18:30',
        deletedAt: null,
      },
    ];
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-0000000000aa',
    } as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET lists', () => {
    it('lists active subjects for classroom', async () => {
      const res = await app.request(
        '/api/classrooms/room-1/subjects',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<{ id: string; name: string }>;
      expect(rows.map((r) => r.id)).toContain('sub-1');
      expect(rows.some((r) => r.id === 'sub-del')).toBe(false);
    });

    it('returns 403 when manager requests another classroom subjects', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';
      const res = await app.request(
        '/api/classrooms/room-2/subjects',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(403);
    });

    it('allows staff for their classroom', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';
      const res = await app.request(
        '/api/classrooms/room-1/subjects',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('POST /subjects', () => {
    it('creates subject as admin', async () => {
      const before = state.subjectRows.length;
      const res = await app.request(
        '/api/subjects',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '数学', classroomId: 'room-1' }),
        },
        env,
      );
      expect(res.status).toBe(201);
      expect(state.subjectRows.length).toBe(before + 1);
      expect(state.subjectRows.some((r) => r.name === '数学')).toBe(true);
    });

    it('returns 403 when manager targets another classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';
      const res = await app.request(
        '/api/subjects',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '数学', classroomId: 'room-2' }),
        },
        env,
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 when classroom missing', async () => {
      const res = await app.request(
        '/api/subjects',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '数学', classroomId: 'room-missing' }),
        },
        env,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /subjects/:id', () => {
    it('updates name when scoped', async () => {
      const res = await app.request(
        '/api/subjects/sub-1',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '英語A' }),
        },
        env,
      );
      expect(res.status).toBe(200);
      expect(state.subjectRows.find((r) => r.id === 'sub-1')?.name).toBe(
        '英語A',
      );
    });
  });

  describe('DELETE /subjects/:id', () => {
    it('soft-deletes subject', async () => {
      const res = await app.request(
        '/api/subjects/sub-1',
        { method: 'DELETE' },
        env,
      );
      expect(res.status).toBe(200);
      expect(
        state.subjectRows.find((r) => r.id === 'sub-1')?.deletedAt,
      ).toBeInstanceOf(Date);
    });
  });

  describe('lesson-types', () => {
    it('POST and GET', async () => {
      const post = await app.request(
        '/api/lesson-types',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '振替', classroomId: 'room-1' }),
        },
        env,
      );
      expect(post.status).toBe(201);
      const get = await app.request(
        '/api/classrooms/room-1/lesson-types',
        { method: 'GET' },
        env,
      );
      expect(get.status).toBe(200);
      const rows = (await get.json()) as Array<{ name: string }>;
      expect(rows.some((r) => r.name === '振替')).toBe(true);
    });
  });

  describe('time-slots', () => {
    it('POST validates end after start', async () => {
      const res = await app.request(
        '/api/time-slots',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            startTime: '18:00',
            endTime: '17:00',
          }),
        },
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST rejects out-of-range clock values (no clamping)', async () => {
      const res = await app.request(
        '/api/time-slots',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            startTime: '25:00',
            endTime: '26:00',
          }),
        },
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST creates time slot', async () => {
      const res = await app.request(
        '/api/time-slots',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            startTime: '09:00',
            endTime: '10:00',
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
      expect(state.timeSlotRows.some((r) => r.startTime === '09:00')).toBe(
        true,
      );
    });

    it('POST accepts HH:mm:ss and stores HH:mm', async () => {
      const res = await app.request(
        '/api/time-slots',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            startTime: '09:00:00',
            endTime: '10:30:00',
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
      expect(
        state.timeSlotRows.some(
          (r) => r.startTime === '09:00' && r.endTime === '10:30',
        ),
      ).toBe(true);
    });

    it('PATCH partial time', async () => {
      const res = await app.request(
        '/api/time-slots/ts-1',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endTime: '19:00' }),
        },
        env,
      );
      expect(res.status).toBe(200);
      expect(state.timeSlotRows.find((r) => r.id === 'ts-1')?.endTime).toBe(
        '19:00',
      );
    });
  });
});
