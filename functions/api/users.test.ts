import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classrooms, users } from '../../db/schema';

type Role = 'admin' | 'manager' | 'staff';
type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
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
  insertSimulateUniqueViolation: boolean;
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
  insertSimulateUniqueViolation: false,
};

const extractRequestedValue = (predicate: unknown): string | null => {
  if (typeof predicate === 'string') {
    return predicate;
  }

  const visited = new Set<object>();
  const stack: unknown[] = [predicate];

  const collectedStrings: string[] = [];

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
      collectedStrings.push(candidate);
    }

    for (const value of Object.values(current)) {
      stack.push(value);
    }
  }

  const userIds = new Set(state.users.map((row) => row.id));
  const userEmails = new Set(state.users.map((row) => row.email));
  const classroomIds = new Set(state.classrooms.map((row) => row.id));

  for (const value of collectedStrings) {
    if (userIds.has(value) || userEmails.has(value) || classroomIds.has(value)) {
      return value;
    }
  }

  if (collectedStrings.length > 0) {
    return collectedStrings[0] ?? null;
  }

  return null;
};

const collectStringsDeep = (value: unknown, seen: Set<object>, out: Set<string>, depth = 0): void => {
  if (depth > 80) {
    return;
  }
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    out.add(value);
    return;
  }
  if (typeof value !== 'object') {
    return;
  }
  if (seen.has(value as object)) {
    return;
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsDeep(item, seen, out, depth + 1);
    }
    return;
  }
  for (const v of Object.values(value)) {
    collectStringsDeep(v, seen, out, depth + 1);
  }
};

const predicateLooksLikeAdminRoleFilter = (predicate: unknown): boolean => {
  const strings = new Set<string>();
  collectStringsDeep(predicate, new Set(), strings);
  return strings.has('admin') && strings.has('role');
};

const pickUser = (user: UserRow, selection: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(selection).map((key) => {
      if (key === 'id') return [key, user.id];
      if (key === 'firstName') return [key, user.firstName];
      if (key === 'lastName') return [key, user.lastName];
      if (key === 'email') return [key, user.email];
      if (key === 'role') return [key, user.role];
      if (key === 'classroomId') return [key, user.classroomId];
      if (key === 'color') return [key, user.color];
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
        const isLoadUserQuery = keys.length === 3 && keys.includes('id') && keys.includes('role') && keys.includes('classroomId');
        const isUserListQuery = keys.includes('id') && keys.includes('firstName') && keys.includes('lastName');

        if (isLoadUserQuery) {
          return {
            where: () => ({
              limit: async () => {
                const target = state.users.find((row) => row.deletedAt === null && row.id === state.jwtSub);
                if (!target) {
                  return [];
                }
                return [pickUser(target, selection)];
              },
            }),
          };
        }

        if (isUserListQuery) {
          return {
            where: async (predicate: unknown) => {
              const requested = extractRequestedValue(predicate);
              const hasKnownClassroom =
                requested &&
                state.classrooms.some((row) => row.id === requested && row.deletedAt === null);
              if (hasKnownClassroom) {
                return state.users
                  .filter((row) => row.deletedAt === null && row.classroomId === requested)
                  .map((row) => pickUser(row, selection));
              }
              if (predicateLooksLikeAdminRoleFilter(predicate)) {
                return state.users
                  .filter((row) => row.deletedAt === null && row.role === 'admin')
                  .map((row) => pickUser(row, selection));
              }
              return [];
            },
          };
        }

        return {
          where: (predicate: unknown) => ({
            limit: async () => {
              const requestedId = extractRequestedValue(predicate);
              const target = state.users.find(
                (row) => row.deletedAt === null && (row.id === requestedId || row.email === requestedId),
              );
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
        if (state.insertSimulateUniqueViolation) {
          throw new Error(
            'UNIQUE constraint failed: index users_email_active_unique',
          );
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
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@example.com',
        role: 'admin',
        classroomId: null,
        color: '#3b82f6',
        deletedAt: null,
      },
      {
        id: 'auth0|manager-user',
        firstName: 'Manager',
        lastName: 'User',
        email: 'manager@example.com',
        role: 'manager',
        classroomId: 'room-1',
        color: '#3b82f6',
        deletedAt: null,
      },
      {
        id: 'auth0|staff-user',
        firstName: 'Staff',
        lastName: 'User',
        email: 'staff@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#3b82f6',
        deletedAt: null,
      },
      {
        id: 'auth0|other-admin',
        firstName: 'Other',
        lastName: 'Admin',
        email: 'other-admin@example.com',
        role: 'admin',
        classroomId: null,
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
    state.insertSimulateUniqueViolation = false;
    fetchMock.mockClear();
  });

  it('returns 409 when D1 insert violates users_email_active_unique (race)', async () => {
    state.insertSimulateUniqueViolation = true;
    state.createUserId = 'auth0|unique-race-user';

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Race',
        lastName: 'User',
        email: 'race-unique@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(409);
    expect(state.users.some((row) => row.id === 'auth0|unique-race-user')).toBe(false);
    expect(state.deletedAuth0UserIds.some((id) => id.includes('auth0%7Cunique-race-user'))).toBe(
      true,
    );
  });

  it('creates a user and sends password setup email', async () => {
    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'New',
        lastName: 'Staff',
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
        firstName: 'New',
        lastName: 'Admin',
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
        firstName: 'Rollback',
        lastName: 'User',
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

  it('returns 500 when Auth0 rollback fails after create failure', async () => {
    state.sendEmailOk = false;
    state.deleteAuth0Ok = false;
    state.createUserId = 'auth0|rollback-auth0-fail';

    const response = await app.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Rollback',
        lastName: 'Auth0Fail',
        email: 'rollback-auth0-fail@example.com',
        role: 'staff',
        classroomId: 'room-1',
        color: '#123abc',
      }),
    }, env);

    expect(response.status).toBe(500);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe('failed to roll back remote user');
    expect(state.users.some((row) => row.id === 'auth0|rollback-auth0-fail')).toBe(false);
    expect(state.deletedAuth0UserIds.some((id) => id.includes('auth0%7Crollback-auth0-fail'))).toBe(
      false,
    );
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
        firstName: 'Conflict',
        lastName: 'User',
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
        firstName: 'Token',
        lastName: 'FailUser',
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
        firstName: 'NoClassroom',
        lastName: 'User',
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
    const payload = (await response.json()) as Array<{
      id: string;
      firstName: string;
      lastName: string;
      color?: string;
    }>;
    expect(payload.map((row) => row.id)).toContain('auth0|staff-user');
    expect(payload[0]?.firstName).toBeDefined();
    expect(payload[0]?.lastName).toBeDefined();
    expect(payload.every((row) => typeof row.color === 'string' && row.color.length > 0)).toBe(true);
  });

  it('does not append admins for staff when includeAdmins=1', async () => {
    state.jwtSub = 'auth0|staff-user';

    const response = await app.request('/api/users/room-1?includeAdmins=1', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; role: string }>;
    const ids = payload.map((row) => row.id).sort();
    expect(ids).toEqual(['auth0|manager-user', 'auth0|staff-user'].sort());
    expect(ids).not.toContain('auth0|admin-user');
    expect(payload.every((row) => !('email' in row))).toBe(true);
  });

  it('appends admins when includeAdmins=1 for manager', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/room-1?includeAdmins=1', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; role: string }>;
    const ids = payload.map((row) => row.id);
    expect(ids).toContain('auth0|staff-user');
    expect(ids).toContain('auth0|admin-user');
    expect(ids).toContain('auth0|other-admin');
    expect(payload.find((r) => r.id === 'auth0|admin-user')?.role).toBe('admin');
    expect(payload.every((row) => !('email' in row))).toBe(true);
  });

  it('appends admins with emails when includeAdmins=1 for admin', async () => {
    state.jwtSub = 'auth0|admin-user';

    const response = await app.request('/api/users/room-1?includeAdmins=1', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; role: string; email?: string }>;
    const ids = payload.map((row) => row.id);
    expect(ids).toContain('auth0|staff-user');
    expect(ids).toContain('auth0|admin-user');
    expect(ids).toContain('auth0|other-admin');
    expect(payload.find((r) => r.id === 'auth0|staff-user')?.email).toBe('staff@example.com');
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

  it('lists admin users for admin', async () => {
    state.jwtSub = 'auth0|admin-user';

    const response = await app.request('/api/users/admins', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; role: string }>;
    expect(payload.every((row) => row.role === 'admin')).toBe(true);
    expect(payload.map((row) => row.id).sort()).toEqual(['auth0|admin-user', 'auth0|other-admin'].sort());
  });

  it('lists admin users for manager', async () => {
    state.jwtSub = 'auth0|manager-user';

    const response = await app.request('/api/users/admins', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: string; role: string }>;
    expect(payload.every((row) => row.role === 'admin')).toBe(true);
    expect(payload.map((row) => row.id).sort()).toEqual(['auth0|admin-user', 'auth0|other-admin'].sort());
  });

  it('returns 403 when deleting own account', async () => {
    state.jwtSub = 'auth0|admin-user';

    const response = await app.request('/api/users/auth0|admin-user', {
      method: 'DELETE',
    }, env);

    expect(response.status).toBe(403);
  });

  it('allows admin to delete another admin', async () => {
    state.jwtSub = 'auth0|admin-user';

    const response = await app.request('/api/users/auth0|other-admin', {
      method: 'DELETE',
    }, env);

    expect(response.status).toBe(200);
    const deleted = state.users.find((row) => row.id === 'auth0|other-admin');
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
  });
});
