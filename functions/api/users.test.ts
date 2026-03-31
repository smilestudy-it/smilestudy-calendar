import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, users } from '../../db/schema';

type Role = 'admin' | 'manager' | 'staff';
type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  classroomId: string | null;
  color: string;
  deletedAt: Date | null;
};

const state: {
  users: UserRow[];
  classrooms: Array<{ id: string; deletedAt: Date | null }>;
  jwtSub: string | null;
  tokenOk: boolean;
  createUserOk: boolean;
  createUserStatus: number;
  createUserId: string;
  sendEmailOk: boolean;
  deleteAuth0Ok: boolean;
  deletedAuth0UserIds: string[];
} = {
  users: [],
  classrooms: [],
  jwtSub: 'auth0|admin-user',
  tokenOk: true,
  createUserOk: true,
  createUserStatus: 201,
  createUserId: 'auth0|created-user',
  sendEmailOk: true,
  deleteAuth0Ok: true,
  deletedAuth0UserIds: [],
};

const extractRequestedValue = (predicate: unknown): string | null => {
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

const pickUser = (user: UserRow, selection: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(selection).map((key) => {
      if (key === 'id') return [key, user.id];
      if (key === 'name') return [key, user.name];
      if (key === 'email') return [key, user.email];
      if (key === 'role') return [key, user.role];
      if (key === 'classroomId') return [key, user.classroomId];
      return [key, undefined];
    }),
  );

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
    select: (selection: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === classrooms) {
          return {
            where: (predicate: unknown) => ({
              limit: async () => {
                const requestedId = extractRequestedValue(predicate);
                const target = state.classrooms.find((row) => row.id === requestedId && row.deletedAt === null);
                return target ? [{ id: target.id }] : [];
              },
            }),
          };
        }

        if (table !== users) {
          return {
            where: async () => [],
          };
        }

        const keys = Object.keys(selection);
        const isUserListQuery = keys.length === 2 && keys.includes('id') && keys.includes('name');

        if (isUserListQuery) {
          return {
            where: async (predicate: unknown) => {
              const classroomId = extractRequestedValue(predicate);
              return state.users
                .filter((row) => row.deletedAt === null && row.classroomId === classroomId)
                .map((row) => pickUser(row, selection));
            },
          };
        }

        return {
          where: (predicate: unknown) => ({
            limit: async () => {
              const requestedId = extractRequestedValue(predicate);
              const target = state.users.find((row) => row.deletedAt === null && row.id === requestedId);
              if (!target) {
                return [];
              }
              return [pickUser(target, selection)];
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: UserRow) => {
        if (table !== users) {
          return;
        }
        if (state.users.some((row) => row.email === value.email && row.deletedAt === null)) {
          throw new Error('duplicate email');
        }
        state.users.push(value);
      },
    }),
    update: (table: unknown) => ({
      set: (value: { deletedAt: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table !== users) {
            return { meta: { changes: 0 } };
          }
          const requestedId = extractRequestedValue(predicate);
          const target = state.users.find((row) =>
            value.deletedAt === null
              ? row.id === requestedId
              : row.id === requestedId && row.deletedAt === null,
          );
          if (!target) {
            return { meta: { changes: 0 } };
          }
          target.deletedAt = value.deletedAt;
          return { meta: { changes: 1 } };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        if (table !== users) {
          return { meta: { changes: 0 } };
        }
        const requestedId = extractRequestedValue(predicate);
        const before = state.users.length;
        state.users = state.users.filter((row) => row.id !== requestedId);
        return { meta: { changes: before - state.users.length } };
      },
    }),
  };

  return {
    getDb: () => db,
  };
});

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input.toString();

  if (url.includes('/oauth/token')) {
    if (!state.tokenOk) {
      return new Response(JSON.stringify({ error: 'token_error' }), { status: 500 });
    }
    return new Response(JSON.stringify({ access_token: 'm2m-token' }), { status: 200 });
  }

  if (url.includes('/api/v2/users/') && !url.endsWith('/api/v2/users')) {
    if (!state.deleteAuth0Ok) {
      return new Response(null, { status: 500 });
    }
    state.deletedAuth0UserIds.push(url.split('/api/v2/users/')[1] ?? '');
    return new Response(null, { status: 204 });
  }

  if (url.endsWith('/api/v2/users')) {
    if (!state.createUserOk) {
      return new Response(JSON.stringify({ message: 'conflict' }), { status: state.createUserStatus });
    }
    return new Response(JSON.stringify({ user_id: state.createUserId }), { status: 201 });
  }

  if (url.includes('/dbconnections/change_password')) {
    if (!state.sendEmailOk) {
      return new Response('failed', { status: 500 });
    }
    return new Response('ok', { status: 200 });
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

describe('users api', () => {
  beforeEach(() => {
    state.users = [
      {
        id: 'auth0|admin-user',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        classroomId: null,
        color: '#3b82f6',
        deletedAt: null,
      },
      {
        id: 'auth0|manager-user',
        name: 'Manager',
        email: 'manager@example.com',
        role: 'manager',
        classroomId: 'room-1',
        color: '#3b82f6',
        deletedAt: null,
      },
      {
        id: 'auth0|staff-user',
        name: 'Staff',
        email: 'staff@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#3b82f6',
        deletedAt: null,
      },
    ];
    state.classrooms = [
      { id: 'room-1', deletedAt: null },
      { id: 'room-2', deletedAt: null },
    ];
    state.jwtSub = 'auth0|admin-user';
    state.tokenOk = true;
    state.createUserOk = true;
    state.createUserStatus = 201;
    state.createUserId = 'auth0|created-user';
    state.sendEmailOk = true;
    state.deleteAuth0Ok = true;
    state.deletedAuth0UserIds = [];
    fetchMock.mockClear();
  });

  it('creates a user and sends password setup email', async () => {
    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'New Staff',
        email: 'new-staff@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(201);
    expect(state.users.some((row) => row.id === 'auth0|created-user')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/dbconnections/change_password'),
      expect.anything(),
    );
  });

  it('returns 403 when manager tries to create admin', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'New Admin',
        email: 'new-admin@example.com',
        role: 'admin',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(403);
  });

  it('rolls back Auth0 user when password email fails', async () => {
    state.sendEmailOk = false;
    state.createUserId = 'auth0|rollback-user';

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Rollback User',
        email: 'rollback@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(400);
    expect(state.users.some((row) => row.id === 'auth0|rollback-user')).toBe(false);
    expect(state.deletedAuth0UserIds.some((id) => id.includes('auth0%7Crollback-user'))).toBe(true);
  });

  it('deletes user when manager is in same classroom', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/auth0|staff-user', {
      method: 'DELETE',
    }, env);

    expect(response.status).toBe(200);
    const deleted = state.users.find((row) => row.id === 'auth0|staff-user');
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
  });

  it('rolls back D1 deletion when Auth0 delete fails', async () => {
    state.jwtSub = 'auth0|manager-user';
    state.deleteAuth0Ok = false;

    const response = await app.request('/api/users/auth0|staff-user', {
      method: 'DELETE',
    }, env);

    expect(response.status).toBe(400);
    const restored = state.users.find((row) => row.id === 'auth0|staff-user');
    expect(restored?.deletedAt).toBeNull();
  });

  it('returns 409 when Auth0 user already exists', async () => {
    state.createUserOk = false;
    state.createUserStatus = 409;

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Conflict User',
        email: 'conflict@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(409);
  });

  it('returns 400 when management token fetch fails on create', async () => {
    state.tokenOk = false;

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Token Fail User',
        email: 'token-fail@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('returns 404 when classroom does not exist on create', async () => {
    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'No Classroom User',
        email: 'noclassroom@example.com',
        role: 'staff',
        classroomId: 'room-not-found',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v2/users'),
      expect.anything(),
    );
  });

  it('lists users for manager in own classroom', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/room-1', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; name: string }>;
    expect(payload.map((row) => row.id)).toContain('auth0|staff-user');
  });

  it('returns 403 when manager requests another classroom users', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/room-2', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(403);
  });

  it('returns 403 when manager deletes admin user', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/auth0|admin-user', {
      method: 'DELETE',
    }, env);

    expect(response.status).toBe(403);
  });
});
