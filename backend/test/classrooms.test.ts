/**
 * （責務）教室 CRUD 等の API の Vitest。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, lessonTypes, lessons, students, subjects, timeSlots, users } from '../db/schema';

type ClassroomRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
};

type ClassroomUserRow = {
  id: string;
  classroomId: string | null;
  deletedAt: Date | null;
};

type ClassroomStudentRow = {
  id: string;
  classroomId: string;
  deletedAt: Date | null;
};

type PresetSubjectRow = { id: string; classroomId: string; deletedAt: Date | null };
type PresetLessonTypeRow = { id: string; classroomId: string; deletedAt: Date | null };
type PresetTimeSlotRow = { id: string; classroomId: string; deletedAt: Date | null };
type ClassroomLessonRow = { id: string; classroomId: string; deletedAt: Date | null };

const state: {
  classrooms: ClassroomRow[];
  classroomUsers: ClassroomUserRow[];
  classroomStudents: ClassroomStudentRow[];
  classroomLessons: ClassroomLessonRow[];
  presetSubjects: PresetSubjectRow[];
  presetLessonTypes: PresetLessonTypeRow[];
  presetTimeSlots: PresetTimeSlotRow[];
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string | null;
  deleteAuth0Ok: boolean;
  deletedAuth0UserIds: string[];
  /** When set, Auth0 user DELETE succeeds until this many URLs have been recorded, then fails. */
  deleteAuth0FailAfterSuccessCount?: number;
  /** Simulates D1 unique violation on classroom insert (e.g. race after preflight). */
  insertSimulateClassroomUniqueViolation: boolean;
  /** First soft-delete of a preset subject inside DELETE /classrooms tx throws (for rollback test). */
  throwOnPresetSubjectSoftDelete: boolean;
  /** Snapshot/restore D1 state on transaction failure (simulates SQL rollback in mock). */
  snapshotDbStateOnTransactionFailure: boolean;
} = {
  classrooms: [],
  classroomUsers: [],
  classroomStudents: [],
  classroomLessons: [],
  presetSubjects: [],
  presetLessonTypes: [],
  presetTimeSlots: [],
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  deleteAuth0Ok: true,
  deletedAuth0UserIds: [],
  insertSimulateClassroomUniqueViolation: false,
  throwOnPresetSubjectSoftDelete: false,
  snapshotDbStateOnTransactionFailure: false,
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

  type MockDb = {
    select: (selection: Record<string, unknown>) => { from: (table: unknown) => unknown };
    insert: () => { values: (value: ClassroomRow) => Promise<void> };
    update: (table: unknown) => unknown;
    transaction: <T>(fn: (tx: MockDb) => Promise<T>) => Promise<T>;
    batch: (queries: any[]) => Promise<any[]>;
  };

  const db: MockDb = {
    select: (selection: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === users) {
          const keys = Object.keys(selection);
          if (keys.length === 3 && keys.includes('id') && keys.includes('role') && keys.includes('classroomId')) {
            return {
              where: () => ({
                limit: async () => (state.userRole
                  ? [{
                    id: state.jwtSub ?? 'auth0|current-user',
                    role: state.userRole,
                    classroomId: state.userRole === 'admin' ? null : 'room-1',
                  }]
                  : []),
              }),
            };
          }

          if (keys.length === 1 && keys.includes('role')) {
            return {
              where: () => ({
                limit: async () => (state.userRole ? [{ role: state.userRole }] : []),
              }),
            };
          }

          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.classroomUsers
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }

          return {
            where: async () => [],
          };
        }

        if (table === students) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.classroomStudents
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }
          return {
            where: async () => [],
          };
        }

        if (table === subjects) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.presetSubjects
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }
          return {
            where: async () => [],
          };
        }

        if (table === lessonTypes) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.presetLessonTypes
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }
          return {
            where: async () => [],
          };
        }

        if (table === timeSlots) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.presetTimeSlots
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }
          return {
            where: async () => [],
          };
        }

        if (table === lessons) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: async (predicate: unknown) => {
                const classroomId = extractRequestedId(predicate);
                return state.classroomLessons
                  .filter((row) => row.classroomId === classroomId && row.deletedAt === null)
                  .map((row) => ({ id: row.id }));
              },
            };
          }
          return {
            where: async () => [],
          };
        }

        if (table === classrooms) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const requestedValue = extractRequestedId(predicate);
                  if (!requestedValue) {
                    return [];
                  }
                  const target = state.classrooms.find(
                    (row) => (row.name === requestedValue || row.id === requestedValue) && row.deletedAt === null,
                  );
                  return target ? [{ id: target.id }] : [];
                },
              }),
            };
          }

          return {
            where: async () =>
              state.classrooms
                .filter((row) => row.deletedAt === null)
                .map((row) => ({ id: row.id, name: row.name })),
          };
        }

        return {
          where: async () => [],
        };
      },
    }),
    insert: () => ({
      values: async (value: ClassroomRow) => {
        if (state.insertSimulateClassroomUniqueViolation) {
          throw new Error(
            'UNIQUE constraint failed: index classrooms_name_active_unique',
          );
        }
        if (state.classrooms.some(c => c.name === value.name && c.deletedAt === null)) {
          throw new Error('UNIQUE constraint failed: index classrooms_name_active_unique');
        }
        state.classrooms.push(value);
      },
    }),
    update: (table: unknown) => ({
      set: (value: { deletedAt: Date | null }) => ({
        where: (predicate: unknown) => ({
          then: (resolve: any, reject: any) => {
            try {
              const requestedId = extractRequestedId(predicate);
              if (!requestedId) return resolve({ meta: { changes: 0 } });

              if (table === classrooms) {
                const target = state.classrooms.find(row => row.id === requestedId && row.deletedAt === null);
                if (target) { target.deletedAt = value.deletedAt; return resolve({ meta: { changes: 1 } }); }
                return resolve({ meta: { changes: 0 } });
              }
              if (table === users) {
                const target = state.classroomUsers.find(row => row.id === requestedId && row.deletedAt === null);
                if (target) { target.deletedAt = value.deletedAt; return resolve({ meta: { changes: 1 } }); }
                return resolve({ meta: { changes: 0 } });
              }

              let changes = 0;
              const updateRows = (rows: any[]) => {
                rows.forEach(row => {
                  if (row.classroomId === requestedId && row.deletedAt === null) {
                    row.deletedAt = value.deletedAt;
                    changes++;
                  }
                });
              };

              if (table === subjects) {
                if (value.deletedAt !== null && state.throwOnPresetSubjectSoftDelete) {
                  throw new Error('simulated preset subject soft-delete failure');
                }
                updateRows(state.presetSubjects);
              }

              if (table === students) updateRows(state.classroomStudents);
              if (table === lessonTypes) updateRows(state.presetLessonTypes);
              if (table === timeSlots) updateRows(state.presetTimeSlots);
              if (table === lessons) updateRows(state.classroomLessons);

              resolve({ meta: { changes } });
            } catch (err) {
              reject(err);
            }
          }
        })
      }),
    }),
    transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => {
      if (!state.snapshotDbStateOnTransactionFailure) {
        return fn(db);
      }
      const snap = {
        classrooms: structuredClone(state.classrooms),
        classroomUsers: structuredClone(state.classroomUsers),
        classroomStudents: structuredClone(state.classroomStudents),
        classroomLessons: structuredClone(state.classroomLessons),
        presetSubjects: structuredClone(state.presetSubjects),
        presetLessonTypes: structuredClone(state.presetLessonTypes),
        presetTimeSlots: structuredClone(state.presetTimeSlots),
      };
      try {
        return await fn(db);
      } catch {
        state.classrooms = snap.classrooms;
        state.classroomUsers = snap.classroomUsers;
        state.classroomStudents = snap.classroomStudents;
        state.classroomLessons = snap.classroomLessons;
        state.presetSubjects = snap.presetSubjects;
        state.presetLessonTypes = snap.presetLessonTypes;
        state.presetTimeSlots = snap.presetTimeSlots;
        throw new Error('transaction aborted');
      }
    },
    batch: async (queries: any[]) => {
      const snap = {
        classrooms: structuredClone(state.classrooms),
        classroomUsers: structuredClone(state.classroomUsers),
        classroomStudents: structuredClone(state.classroomStudents),
        classroomLessons: structuredClone(state.classroomLessons),
        presetSubjects: structuredClone(state.presetSubjects),
        presetLessonTypes: structuredClone(state.presetLessonTypes),
        presetTimeSlots: structuredClone(state.presetTimeSlots),
      };
      try {
        return await Promise.all(queries);
      } catch (err) {
        state.classrooms = snap.classrooms;
        state.classroomUsers = snap.classroomUsers;
        state.classroomStudents = snap.classroomStudents;
        state.classroomLessons = snap.classroomLessons;
        state.presetSubjects = snap.presetSubjects;
        state.presetLessonTypes = snap.presetLessonTypes;
        state.presetTimeSlots = snap.presetTimeSlots;
        throw err;
      }
    }
  };

  return {
    getDb: () => db,
  };
});

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input.toString();

  if (url.includes('/oauth/token')) {
    return new Response(JSON.stringify({ access_token: 'm2m-token' }), { status: 200 });
  }

  if (url.includes('/api/v2/users/') && !url.endsWith('/api/v2/users')) {
    if (!state.deleteAuth0Ok) {
      return new Response(null, { status: 500 });
    }
    if (
      state.deleteAuth0FailAfterSuccessCount !== undefined &&
      state.deletedAuth0UserIds.length >= state.deleteAuth0FailAfterSuccessCount
    ) {
      return new Response(null, { status: 500 });
    }
    state.deletedAuth0UserIds.push(url.split('/api/v2/users/')[1] ?? '');
    return new Response(null, { status: 204 });
  }

  return new Response('not found', { status: 404 });
});

vi.stubGlobal('fetch', fetchMock);

import { app } from '../worker';

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

describe('classrooms api flow', () => {
  beforeEach(() => {
    state.classrooms = [];
    state.classroomUsers = [];
    state.classroomStudents = [];
    state.classroomLessons = [];
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.deleteAuth0Ok = true;
    state.deletedAuth0UserIds = [];
    state.deleteAuth0FailAfterSuccessCount = undefined;
    state.insertSimulateClassroomUniqueViolation = false;
    state.presetSubjects = [];
    state.presetLessonTypes = [];
    state.presetTimeSlots = [];
    state.throwOnPresetSubjectSoftDelete = false;
    state.snapshotDbStateOnTransactionFailure = false;
    fetchMock.mockClear();
  });

  it('POST -> GET -> DELETE -> GET works', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class A' }),
    }, env);
    expect(postResponse.status).toBe(201);

    const created = (await postResponse.json()) as { id: string; name: string };
    expect(created.name).toBe('Class A');

    const getBeforeDelete = await app.request('/api/classrooms', { method: 'GET' }, env);
    expect(getBeforeDelete.status).toBe(200);
    const listBeforeDelete = (await getBeforeDelete.json()) as Array<{ id: string; name: string }>;
    expect(listBeforeDelete).toHaveLength(1);
    expect(listBeforeDelete[0]?.id).toBe(created.id);

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(200);

    const getAfterDelete = await app.request('/api/classrooms', { method: 'GET' }, env);
    expect(getAfterDelete.status).toBe(200);
    const listAfterDelete = (await getAfterDelete.json()) as Array<{ id: string; name: string }>;
    expect(listAfterDelete).toHaveLength(0);
  });

  it('deletes classroom users and students together with classroom', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class A' }),
    }, env);
    const created = (await postResponse.json()) as { id: string };

    state.classroomUsers.push({
      id: 'auth0|staff-user',
      classroomId: created.id,
      deletedAt: null,
    });
    state.classroomStudents.push({
      id: 'student-in-class',
      classroomId: created.id,
      deletedAt: null,
    });

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(200);
    expect(state.classroomUsers[0]?.deletedAt).toBeInstanceOf(Date);
    expect(state.classroomStudents[0]?.deletedAt).toBeInstanceOf(Date);
    expect(state.deletedAuth0UserIds.some((id) => id.includes('auth0%7Cstaff-user'))).toBe(true);
  });

  it('soft-deletes lessons when deleting classroom', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class With Lessons' }),
    }, env);
    const created = (await postResponse.json()) as { id: string };

    state.classroomLessons.push({
      id: 'lesson-in-class',
      classroomId: created.id,
      deletedAt: null,
    });

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(200);
    expect(state.classroomLessons[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it('returns 400 when name is missing or blank', async () => {
    const missingName = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, env);
    expect(missingName.status).toBe(400);

    const blankName = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }, env);
    expect(blankName.status).toBe(400);
  });

  it('returns 400 when name is too long', async () => {
    const tooLongName = 'a'.repeat(101);
    const response = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tooLongName }),
    }, env);
    expect(response.status).toBe(400);
  });

  it('returns 409 when creating classroom with duplicate name', async () => {
    const first = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class Duplicate' }),
    }, env);
    expect(first.status).toBe(201);

    const second = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class Duplicate' }),
    }, env);
    expect(second.status).toBe(409);
  });

  it('returns 409 when D1 insert violates classrooms_name_active_unique (race)', async () => {
    state.insertSimulateClassroomUniqueViolation = true;

    const response = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Race Classroom' }),
    }, env);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe('classroom already exists');
    expect(state.classrooms.some((row) => row.name === 'Race Classroom')).toBe(false);
  });

  it('returns 404 when deleting a non-existing classroom', async () => {
    const response = await app.request('/api/classrooms/non-existing-id', {
      method: 'DELETE',
    }, env);
    expect(response.status).toBe(404);
  });

  it('returns 404 when deleting the same classroom twice', async () => {
    const create = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class B' }),
    }, env);
    const created = (await create.json()) as { id: string };

    const firstDelete = await app.request(`/api/classrooms/${created.id}`, {
      method: 'DELETE',
    }, env);
    expect(firstDelete.status).toBe(200);

    const secondDelete = await app.request(`/api/classrooms/${created.id}`, {
      method: 'DELETE',
    }, env);
    expect(secondDelete.status).toBe(404);
  });

  it('soft-deletes preset subjects, lesson types, and time slots when deleting classroom', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class With Presets' }),
    }, env);
    const created = (await postResponse.json()) as { id: string };

    state.presetSubjects.push({ id: 'ps-1', classroomId: created.id, deletedAt: null });
    state.presetLessonTypes.push({ id: 'plt-1', classroomId: created.id, deletedAt: null });
    state.presetTimeSlots.push({ id: 'pts-1', classroomId: created.id, deletedAt: null });

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(200);
    expect(state.classrooms.find((r) => r.id === created.id)?.deletedAt).toBeInstanceOf(Date);
    expect(state.presetSubjects[0]?.deletedAt).toBeInstanceOf(Date);
    expect(state.presetLessonTypes[0]?.deletedAt).toBeInstanceOf(Date);
    expect(state.presetTimeSlots[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it('returns 500 when preset subject soft-delete fails; compensating rollback restores classroom and members', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class Preset Tx Fail' }),
    }, env);
    const created = (await postResponse.json()) as { id: string };

    state.presetSubjects.push({ id: 'ps-fail', classroomId: created.id, deletedAt: null });
    state.throwOnPresetSubjectSoftDelete = true;

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(500);

    expect(state.classrooms.find((r) => r.id === created.id)?.deletedAt).toBeNull();
    expect(state.presetSubjects[0]?.deletedAt).toBeNull();
  });

  it('returns 403 for manager and staff users', async () => {
    state.userRole = 'manager';
    const managerGet = await app.request('/api/classrooms', { method: 'GET' }, env);
    expect(managerGet.status).toBe(403);

    state.userRole = 'staff';
    const staffPost = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class C' }),
    }, env);
    expect(staffPost.status).toBe(403);
  });

  it('returns 404 when user does not exist', async () => {
    state.userRole = null;
    const response = await app.request('/api/classrooms', { method: 'GET' }, env);
    expect(response.status).toBe(404);
  });

  it('returns 401 when token payload does not include sub', async () => {
    state.jwtSub = null;
    const response = await app.request('/api/classrooms', { method: 'GET' }, env);
    expect(response.status).toBe(401);
  });
});
