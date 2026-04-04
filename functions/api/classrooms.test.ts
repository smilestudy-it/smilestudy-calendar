import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, users } from '../../db/schema';

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

const state: {
  classrooms: ClassroomRow[];
  classroomUsers: ClassroomUserRow[];
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string | null;
  deleteAuth0Ok: boolean;
  deletedAuth0UserIds: string[];
  /** When set, Auth0 user DELETE succeeds until this many URLs have been recorded, then fails. */
  deleteAuth0FailAfterSuccessCount?: number;
} = {
  classrooms: [],
  classroomUsers: [],
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
  deleteAuth0Ok: true,
  deletedAuth0UserIds: [],
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

        if (table === classrooms) {
          const keys = Object.keys(selection);
          if (keys.length === 1 && keys.includes('id')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const requestedName = extractRequestedId(predicate);
                  if (!requestedName) {
                    return [];
                  }
                  const target = state.classrooms.find(
                    (row) => row.name === requestedName && row.deletedAt === null,
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
        state.classrooms.push(value);
      },
    }),
    update: (table: unknown) => ({
      set: (value: { deletedAt: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table === classrooms) {
            const requestedId = extractRequestedId(predicate);
            if (!requestedId) {
              return { meta: { changes: 0 } };
            }

            const target = state.classrooms.find(
              (row) => row.id === requestedId && (value.deletedAt === null || row.deletedAt === null),
            );
            if (!target) {
              return { meta: { changes: 0 } };
            }

            target.deletedAt = value.deletedAt;
            return { meta: { changes: 1 } };
          }

          if (table === users) {
            const requestedId = extractRequestedId(predicate);
            if (!requestedId) {
              return { meta: { changes: 0 } };
            }
            const target = state.classroomUsers.find(
              (row) => row.id === requestedId && (value.deletedAt === null || row.deletedAt === null),
            );
            if (!target) {
              return { meta: { changes: 0 } };
            }
            target.deletedAt = value.deletedAt;
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 0 } };
        },
      }),
    }),
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

describe('classrooms api flow', () => {
  beforeEach(() => {
    state.classrooms = [];
    state.classroomUsers = [];
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
    state.deleteAuth0Ok = true;
    state.deletedAuth0UserIds = [];
    state.deleteAuth0FailAfterSuccessCount = undefined;
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

  it('deletes classroom users together with classroom', async () => {
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

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(200);
    expect(state.classroomUsers[0]?.deletedAt).toBeInstanceOf(Date);
    expect(state.deletedAuth0UserIds.some((id) => id.includes('auth0%7Cstaff-user'))).toBe(true);
  });

  it('partial rollback: keeps D1 soft-delete for users already removed from Auth0', async () => {
    const postResponse = await app.request('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Class A' }),
    }, env);
    const created = (await postResponse.json()) as { id: string };

    state.classroomUsers.push(
      {
        id: 'auth0|user-first',
        classroomId: created.id,
        deletedAt: null,
      },
      {
        id: 'auth0|user-second',
        classroomId: created.id,
        deletedAt: null,
      },
    );
    state.deleteAuth0FailAfterSuccessCount = 1;

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(400);

    const classroom = state.classrooms.find((row) => row.id === created.id);
    expect(classroom?.deletedAt).toBeNull();

    const first = state.classroomUsers.find((row) => row.id === 'auth0|user-first');
    const second = state.classroomUsers.find((row) => row.id === 'auth0|user-second');
    expect(first?.deletedAt).toBeInstanceOf(Date);
    expect(second?.deletedAt).toBeNull();
  });

  it('rolls back classroom deletion when auth0 user delete fails', async () => {
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
    state.deleteAuth0Ok = false;

    const deleteResponse = await app.request(`/api/classrooms/${created.id}`, { method: 'DELETE' }, env);
    expect(deleteResponse.status).toBe(400);
    const classroom = state.classrooms.find((row) => row.id === created.id);
    expect(classroom?.deletedAt).toBeNull();
    expect(state.classroomUsers[0]?.deletedAt).toBeNull();
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
