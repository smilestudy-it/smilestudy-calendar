/*
  user追加/削除などのAPIを管理
*/
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import type { User } from '../../shared/type';
import * as auth0 from '../auth0Service';
import { getDb } from '../db';
import { classrooms, users } from '../db/schema';
import { isD1UsersEmailUniqueViolation } from '../lib/sqliteConstraint';
import userDelete from '../lib/userDelete';
import { validateCreateUserInput } from '../lib/validators';
import {
  auth,
  loadUser,
  requireClassroomScope,
  requireManagerOrAbove,
} from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const usersApp = new Hono<{ Bindings: ApiBindings; Variables: AppVariables }>();

function usersComp(a: User, b: User) {
  const an = `${a.lastName ?? ''} ${a.firstName ?? ''}`.trim();
  const bn = `${b.lastName ?? ''} ${b.firstName ?? ''}`.trim();
  return an.localeCompare(bn, 'ja');
}

// ユーザ登録
usersApp.post('', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateUserInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  if (actor.role === 'manager') {
    if (
      input.role === 'admin' ||
      !actor.classroomId ||
      !input.classroomId ||
      actor.classroomId !== input.classroomId
    ) {
      return c.json({ message: 'forbidden' }, 403);
    }
  }

  const db = getDb(c.env);
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    .limit(1);

  if (existingUser) {
    return c.json({ message: 'user already exists' }, 409);
  }

  if (input.classroomId) {
    const [existingClassroom] = await db
      .select({ id: classrooms.id })
      .from(classrooms)
      .where(
        and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)),
      )
      .limit(1);

    if (!existingClassroom) {
      return c.json({ message: 'classroom not found' }, 404);
    }
  }

  let managementToken;
  try {
    managementToken = await auth0.getAuth0ManagementToken(c.env);
  } catch {
    return c.json({ message: 'failed to create user' }, 502);
  }

  let auth0UserId = '';
  let d1Inserted = false;
  let passwordEmailSent;
  const displayName = `${input.lastName} ${input.firstName}`.trim();

  try {
    const auth0Result = await auth0.createAuth0User(
      c.env,
      managementToken,
      input.email,
      displayName,
    );
    if (!auth0Result.ok) {
      if (auth0Result.status === 409) {
        return c.json({ message: 'user already exists' }, 409);
      }
      return c.json({ message: auth0Result.message }, 502);
    }

    auth0UserId = auth0Result.userId;

    await db.insert(users).values({
      id: auth0UserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: input.role,
      classroomId: input.classroomId,
      color: input.color,
      deletedAt: null,
    });
    d1Inserted = true;

    passwordEmailSent = await auth0.sendAuth0PasswordSetupEmail(
      c.env,
      input.email,
    );
    if (!passwordEmailSent) {
      console.log('password setup email not accepted by Auth0');
    }
  } catch (error) {
    if (d1Inserted && auth0UserId) {
      await db
        .delete(users)
        .where(eq(users.id, auth0UserId))
        .catch(() => undefined);
    }
    if (managementToken && auth0UserId) {
      const auth0RollbackDeleted = await auth0.deleteAuth0User(
        c.env,
        managementToken,
        auth0UserId,
      );
      if (!auth0RollbackDeleted) {
        return c.json({ message: 'failed to roll back remote user' }, 500);
      }
    }
    if (isD1UsersEmailUniqueViolation(error)) {
      return c.json({ message: 'user already exists' }, 409);
    }
    return c.json({ message: 'failed to create user' }, 500);
  }

  return c.json(
    {
      id: auth0UserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: input.role,
      classroomId: input.classroomId,
      color: input.color,
      passwordEmailSent,
    },
    201,
  );
});

// admin取得
usersApp.get('/admins', auth, loadUser, requireManagerOrAbove, async (c) => {
  const db = getDb(c.env);
  const admins = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      email: users.email,
      classroomId: users.classroomId,
      color: users.color,
    })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)));
  admins.sort(usersComp);
  return c.json(admins, 200);
});

// ユーザ取得(教室ごと)
usersApp.get(
  '/:classroomId',
  auth,
  loadUser,
  requireManagerOrAbove,
  requireClassroomScope((c) => c.req.param('classroomId') ?? null),
  async (c) => {
    const classroomId = c.req.param('classroomId');
    if (!classroomId) {
      return c.json({ message: 'classroom id is required' }, 400);
    }
    const db = getDb(c.env);

    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        email: users.email,
        classroomId: users.classroomId,
        color: users.color,
      })
      .from(users)
      .where(and(eq(users.classroomId, classroomId), isNull(users.deletedAt)));

    rows.sort(usersComp);
    return c.json(rows, 200);
  },
);

// ユーザ削除
usersApp.delete('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const db = getDb(c.env);

  const [target] = await db
    .select({
      id: users.id,
      role: users.role,
      classroomId: users.classroomId,
      email: users.email,
    })
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if (!target) {
    return c.json({ message: 'user not found' }, 404);
  }

  if (actor.id === targetId) {
    return c.json({ message: 'cannot delete yourself' }, 403);
  }

  if (
    actor.role === 'manager' &&
    (target.role === 'admin' || actor.classroomId !== target.classroomId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }

  return await userDelete(c, [target.id]);
});

export default usersApp;
