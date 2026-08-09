/**
 * （責務）教室休業日 API の Vitest（一覧・追加・削除・権限）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classrooms, holidays, users } from '../db/schema';
import { app } from '../worker';

type ClassroomRow = { id: string; deletedAt: Date | null };
type HolidayRow = {
  id: string;
  classroomId: string;
  date: string;
  deletedAt: Date | null;
};

const state: {
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string;
  classrooms: ClassroomRow[];
  holidayRows: HolidayRow[];
} = {
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  classrooms: [],
  holidayRows: [],
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

        if (table === classrooms) {
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const id = extractRequestedId(predicate);
                const row = state.classrooms.find(
                  (r) => r.id === id && r.deletedAt === null,
                );
                return row ? [{ id: row.id }] : [];
              },
            }),
          };
        }

        if (table === holidays) {
          const keys = Object.keys(selection);
          if (
            keys.includes('id') &&
            keys.includes('date') &&
            !keys.includes('classroomId')
          ) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.holidayRows
                  .filter(
                    (r) =>
                      r.classroomId === classroomId && r.deletedAt === null,
                  )
                  .map((r) => ({ id: r.id, date: r.date }));
              },
            };
          }
          if (keys.includes('id') && keys.includes('classroomId')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const id = extractRequestedId(predicate);
                  const row = state.holidayRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row
                    ? [{ id: row.id, classroomId: row.classroomId }]
                    : [];
                },
              }),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        return { where: () => ({ limit: async () => [] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: HolidayRow) => {
        if (table === holidays) {
          state.holidayRows.push({ ...value });
        }
      },
    }),
    update: (table: unknown) => ({
      set: (patch: { deletedAt?: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table !== holidays) {
            return { meta: { changes: 0 } };
          }
          const id = extractRequestedId(predicate);
          const row = state.holidayRows.find(
            (r) => r.id === id && r.deletedAt === null,
          );
          if (!row) {
            return { meta: { changes: 0 } };
          }
          if (patch.deletedAt !== undefined) {
            row.deletedAt = patch.deletedAt ?? null;
          }
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };

  return { getDb: () => dbCore };
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

describe('holidays api', () => {
  beforeEach(() => {
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.classrooms = [
      { id: 'room-1', deletedAt: null },
      { id: 'room-2', deletedAt: null },
    ];
    state.holidayRows = [
      {
        id: 'h-1',
        classroomId: 'room-1',
        date: '2026-08-15',
        deletedAt: null,
      },
      {
        id: 'h-del',
        classroomId: 'room-1',
        date: '2026-01-01',
        deletedAt: new Date(),
      },
    ];
    vi.stubGlobal('crypto', {
      randomUUID: () => 'holiday-uuid-001',
    } as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET /holidays/:classroomId', () => {
    it('lists active holidays for classroom', async () => {
      const res = await app.request(
        '/api/holidays/room-1',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<{ id: string; date: string }>;
      expect(rows.map((r) => r.id)).toContain('h-1');
      expect(rows.some((r) => r.id === 'h-del')).toBe(false);
    });

    it('returns 403 when manager requests another classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';
      const res = await app.request(
        '/api/holidays/room-2',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(403);
    });

    it('allows staff for their classroom', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';
      const res = await app.request(
        '/api/holidays/room-1',
        { method: 'GET' },
        env,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('POST /holidays', () => {
    it('creates a holiday', async () => {
      const res = await app.request(
        '/api/holidays',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            date: '2026-12-31',
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        date: string;
        classroomId: string;
      };
      expect(body).toEqual({
        id: 'holiday-uuid-001',
        date: '2026-12-31',
        classroomId: 'room-1',
      });
      expect(
        state.holidayRows.some(
          (r) => r.id === 'holiday-uuid-001' && r.date === '2026-12-31',
        ),
      ).toBe(true);
    });

    it('rejects invalid date', async () => {
      const res = await app.request(
        '/api/holidays',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            date: 'not-a-date',
          }),
        },
        env,
      );
      expect(res.status).toBe(400);
    });

    it('returns 403 when manager posts for another classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';
      const res = await app.request(
        '/api/holidays',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-2',
            date: '2026-05-01',
          }),
        },
        env,
      );
      expect(res.status).toBe(403);
    });

    it('returns 403 for staff', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';
      const res = await app.request(
        '/api/holidays',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'room-1',
            date: '2026-05-01',
          }),
        },
        env,
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 when classroom does not exist', async () => {
      const res = await app.request(
        '/api/holidays',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classroomId: 'missing-room',
            date: '2026-05-01',
          }),
        },
        env,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /holidays/:id', () => {
    it('soft-deletes holiday', async () => {
      const res = await app.request(
        '/api/holidays/h-1',
        { method: 'DELETE' },
        env,
      );
      expect(res.status).toBe(200);
      expect(
        state.holidayRows.find((r) => r.id === 'h-1')?.deletedAt,
      ).toBeInstanceOf(Date);
    });

    it('returns 404 for missing holiday', async () => {
      const res = await app.request(
        '/api/holidays/missing',
        { method: 'DELETE' },
        env,
      );
      expect(res.status).toBe(404);
    });

    it('returns 403 when manager deletes another classroom holiday', async () => {
      state.holidayRows.push({
        id: 'h-other',
        classroomId: 'room-2',
        date: '2026-03-01',
        deletedAt: null,
      });
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';
      const res = await app.request(
        '/api/holidays/h-other',
        { method: 'DELETE' },
        env,
      );
      expect(res.status).toBe(403);
    });
  });
});
