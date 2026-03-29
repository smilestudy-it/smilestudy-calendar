import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, users } from '../../db/schema';

type ClassroomRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
};

const state: {
  classrooms: ClassroomRow[];
  userRole: 'admin' | 'manager' | 'staff' | null;
  jwtSub: string | null;
} = {
  classrooms: [],
  userRole: 'admin',
  jwtSub: 'auth0|admin-user',
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
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === users) {
          return {
            where: () => ({
              limit: async () => (state.userRole ? [{ role: state.userRole }] : []),
            }),
          };
        }

        if (table === classrooms) {
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
    update: () => ({
      set: (value: { deletedAt: Date | null }) => ({
        where: async () => {
          const target = state.classrooms.find((row) => row.deletedAt === null);
          if (!target) {
            return { meta: { changes: 0 } };
          }

          target.deletedAt = value.deletedAt;
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };

  return {
    getDb: () => db,
  };
});

import { app } from './[[route]]';

const env = {
  AUTH0_AUDIENCE: 'https://api.example.local',
  AUTH0_ISSUER: 'https://issuer.example.local/',
  AUTH0_JWKS_URI: 'https://issuer.example.local/.well-known/jwks.json',
  DB: {},
} as unknown as Env;

describe('classrooms api flow', () => {
  beforeEach(() => {
    state.classrooms = [];
    state.userRole = 'admin';
    state.jwtSub = 'auth0|admin-user';
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
