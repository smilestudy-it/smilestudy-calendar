import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, students, users } from '../../db/schema';

type StudentRow = {
  id: string;
  name: string;
  email: string;
  birthYear: number;
  classroomId: string;
  deletedAt: Date | null;
};

type ClassroomRow = { id: string; deletedAt: Date | null };

const state: {
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string;
  classrooms: ClassroomRow[];
  studentRows: StudentRow[];
  insertStudentThrows: boolean;
} = {
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  classrooms: [],
  studentRows: [],
  insertStudentThrows: false,
};

vi.mock('hono/jwk', () => {
  return {
    jwk: () => {
      return async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
        c.set('jwtPayload', { sub: state.jwtSub });
        await next();
      };
    },
  };
});

vi.mock('../../db', () => {
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

  const db = {
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
          if (keys.length === 3 && keys.includes('id') && keys.includes('role') && keys.includes('classroomId')) {
            return {
              where: () => ({
                limit: async () =>
                  state.userRole
                    ? [
                        {
                          id: state.jwtSub,
                          role: state.userRole,
                          classroomId: state.userRole === 'admin' ? null : 'room-1',
                        },
                      ]
                    : [],
              }),
            };
          }
          return { where: () => ({ limit: async () => [] }) };
        }

        if (table === students) {
          const keys = Object.keys(selection);
          if (keys.includes('name')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.studentRows
                  .filter((r) => r.classroomId === classroomId && r.deletedAt === null)
                  .map((r) => ({
                    id: r.id,
                    name: r.name,
                    email: r.email,
                    birthYear: r.birthYear,
                  }));
              },
            };
          }
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const targetId = extractRequestedId(predicate);
                const row = state.studentRows.find(
                  (r) => r.id === targetId && r.deletedAt === null,
                );
                return row ? [{ id: row.id, classroomId: row.classroomId }] : [];
              },
            }),
          };
        }

        return { where: () => ({ limit: async () => [] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: StudentRow) => {
        if (table !== students) {
          return;
        }
        if (state.insertStudentThrows) {
          throw new Error('insert failed');
        }
        state.studentRows.push({ ...value });
      },
    }),
    update: (table: unknown) => ({
      set: (value: { deletedAt: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table !== students) {
            return { meta: { changes: 0 } };
          }
          const requestedId = extractRequestedId(predicate);
          const row = state.studentRows.find((r) =>
            value.deletedAt === null
              ? r.id === requestedId
              : r.id === requestedId && r.deletedAt === null,
          );
          if (!row) {
            return { meta: { changes: 0 } };
          }
          row.deletedAt = value.deletedAt;
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };

  return { getDb: () => db };
});

import { app } from './[[route]]';

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

const validStudentBody = () => ({
  name: 'New Student',
  email: 'new-student@example.com',
  birthYear: 2016,
  classroomId: 'room-1',
});

describe('students api', () => {
  beforeEach(() => {
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.insertStudentThrows = false;
    state.classrooms = [
      { id: 'room-1', deletedAt: null },
      { id: 'room-2', deletedAt: null },
    ];
    state.studentRows = [
      {
        id: 'student-1',
        name: 'Student One',
        email: 's1@example.com',
        birthYear: 2015,
        classroomId: 'room-1',
        deletedAt: null,
      },
      {
        id: 'student-2',
        name: 'Student Two',
        email: 's2@example.com',
        birthYear: 2014,
        classroomId: 'room-2',
        deletedAt: null,
      },
    ];
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000099',
    } as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /students', () => {
    it('creates a student as admin', async () => {
      const before = state.studentRows.length;
      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validStudentBody()),
        },
        env,
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string; name: string; email: string; birthYear: number };
      expect(body.id).toBe('00000000-0000-4000-8000-000000000099');
      expect(body.name).toBe('New Student');
      expect(body.email).toBe('new-student@example.com');
      expect(body.birthYear).toBe(2016);
      expect(state.studentRows.length).toBe(before + 1);
      expect(state.studentRows.some((r) => r.email === 'new-student@example.com')).toBe(true);
    });

    it('returns 400 when validation fails', async () => {
      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...validStudentBody(), email: 'not-an-email' }),
        },
        env,
      );
      expect(response.status).toBe(400);
    });

    it('returns 403 when manager targets another classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';

      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...validStudentBody(), classroomId: 'room-2' }),
        },
        env,
      );
      expect(response.status).toBe(403);
    });

    it('returns 404 when classroom does not exist', async () => {
      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...validStudentBody(), classroomId: 'room-missing' }),
        },
        env,
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when insert fails', async () => {
      state.insertStudentThrows = true;
      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validStudentBody()),
        },
        env,
      );
      expect(response.status).toBe(400);
    });

    it('returns 403 for staff', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';

      const response = await app.request(
        '/api/students',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validStudentBody()),
        },
        env,
      );
      expect(response.status).toBe(403);
    });
  });

  describe('GET /students/:classroomId', () => {
    it('lists active students for a classroom', async () => {
      const response = await app.request('/api/students/room-1', { method: 'GET' }, env);
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{ id: string; name: string }>;
      expect(rows.map((r) => r.id)).toContain('student-1');
      expect(rows.find((r) => r.id === 'student-1')?.name).toBe('Student One');
    });

    it('excludes soft-deleted students', async () => {
      const row = state.studentRows.find((r) => r.id === 'student-1');
      expect(row).toBeDefined();
      row!.deletedAt = new Date();

      const response = await app.request('/api/students/room-1', { method: 'GET' }, env);
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{ id: string }>;
      expect(rows.some((r) => r.id === 'student-1')).toBe(false);
    });

    it('returns empty array when classroom has no active students', async () => {
      state.studentRows = [];
      const response = await app.request('/api/students/room-1', { method: 'GET' }, env);
      expect(response.status).toBe(200);
      const rows = (await response.json()) as unknown[];
      expect(rows).toEqual([]);
    });

    it('allows staff to list students in assigned classroom', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';

      const response = await app.request('/api/students/room-1', { method: 'GET' }, env);
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('student-1');
    });

    it('returns 403 when staff requests another classroom', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';

      const response = await app.request('/api/students/room-2', { method: 'GET' }, env);
      expect(response.status).toBe(403);
    });

    it('returns 403 when manager requests another classroom list', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';

      const response = await app.request('/api/students/room-2', { method: 'GET' }, env);
      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /students/:id', () => {
    it('soft-deletes student as admin', async () => {
      const response = await app.request('/api/students/student-1', { method: 'DELETE' }, env);
      expect(response.status).toBe(200);
      expect(state.studentRows.find((r) => r.id === 'student-1')?.deletedAt).toBeInstanceOf(Date);
    });

    it('allows manager to delete student in own classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';

      const response = await app.request('/api/students/student-1', { method: 'DELETE' }, env);
      expect(response.status).toBe(200);
      expect(state.studentRows.find((r) => r.id === 'student-1')?.deletedAt).toBeInstanceOf(Date);
    });

    it('returns 403 when manager deletes student in another classroom', async () => {
      state.userRole = 'manager';
      state.jwtSub = 'auth0|manager-user';

      const response = await app.request('/api/students/student-2', { method: 'DELETE' }, env);
      expect(response.status).toBe(403);
      expect(state.studentRows.find((r) => r.id === 'student-2')?.deletedAt).toBeNull();
    });

    it('returns 404 when student does not exist', async () => {
      const response = await app.request('/api/students/missing-id', { method: 'DELETE' }, env);
      expect(response.status).toBe(404);
    });

    it('returns 404 when student is already deleted', async () => {
      state.studentRows.find((r) => r.id === 'student-1')!.deletedAt = new Date();

      const response = await app.request('/api/students/student-1', { method: 'DELETE' }, env);
      expect(response.status).toBe(404);
    });

    it('returns 403 for staff', async () => {
      state.userRole = 'staff';
      state.jwtSub = 'auth0|staff-user';

      const response = await app.request('/api/students/student-1', { method: 'DELETE' }, env);
      expect(response.status).toBe(403);
    });
  });
});
