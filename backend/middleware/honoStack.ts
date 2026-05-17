/**
 * （責務）Hono: JWT 検証、loadUser、ロール/教室スコープ系のミドルウェア群。
 */
import { jwk } from 'hono/jwk';
import type { Next } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import type { AppUser, ApiContext } from '../apiTypes';
import { jsonMessage } from '../lib/jsonMessage';

export const auth = async (c: ApiContext, next: Next) => {
  return jwk({
    jwks_uri: c.env.AUTH0_JWKS_URI,
    alg: ['RS256'],
    verification: {
      aud: c.env.AUTH0_AUDIENCE,
      iss: c.env.AUTH0_ISSUER,
    },
  })(c, next);
};

export const loadUser = async (c: ApiContext, next: Next) => {
  const { sub } = c.var.jwtPayload;
  if (!sub) {
    return jsonMessage(c, 401, 'invalid token payload');
  }

  const db = getDb(c.env);
  const [currentUser] = await db
    .select({ id: users.id, role: users.role, classroomId: users.classroomId })
    .from(users)
    .where(and(eq(users.id, sub), isNull(users.deletedAt)))
    .limit(1);

  if (!currentUser) {
    return jsonMessage(c, 404, 'user not found');
  }
  c.set('currentUser', currentUser);

  await next();
};

export const requireAdmin = async (c: ApiContext, next: Next) => {
  const currentUser = c.var.currentUser;
  if (!currentUser) {
    return jsonMessage(c, 500, 'user not loaded');
  }
  if (currentUser.role !== 'admin') {
    return jsonMessage(c, 403, 'forbidden');
  }
  await next();
};

export const requireManagerOrAbove = async (c: ApiContext, next: Next) => {
  const currentUser = c.var.currentUser;
  if (!currentUser) {
    return jsonMessage(c, 500, 'user not loaded');
  }
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    return jsonMessage(c, 403, 'forbidden');
  }
  await next();
};

/** 講師・教室長・管理者 */
export const requireStaffOrAbove = async (c: ApiContext, next: Next) => {
  const currentUser = c.var.currentUser;
  if (!currentUser) {
    return jsonMessage(c, 500, 'user not loaded');
  }
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager' && currentUser.role !== 'staff') {
    return jsonMessage(c, 403, 'forbidden');
  }
  await next();
};

/**
 * 対象 classroomId へのアクセス可否
 */
export function denyUnlessClassroomScope(
  c: ApiContext,
  targetClassroomId: string | null | undefined,
): Response | null {
  const currentUser = c.var.currentUser;
  if (!currentUser) {
    return jsonMessage(c, 500, 'user not loaded');
  }
  const id = typeof targetClassroomId === 'string' ? targetClassroomId.trim() : '';
  if (!id) {
    return jsonMessage(c, 400, 'classroom id is required');
  }
  if (currentUser.role === 'admin') {
    return null;
  }
  if (!currentUser.classroomId || currentUser.classroomId !== id) {
    return jsonMessage(c, 403, 'forbidden');
  }
  return null;
}

/**
 * コマの講師: staff は常に本人のみ
 */
export function denyUnlessStaffLessonTeacherIsSelf(
  c: ApiContext,
  actor: AppUser,
  teacherId: string,
): Response | null {
  if (actor.role === 'staff' && teacherId !== actor.id) {
    return jsonMessage(c, 403, 'forbidden');
  }
  return null;
}

/**
 * 管理者は全教室。教室長・講師は自教室のみ
 */
export const requireClassroomScope = (resolveClassroomId: (c: ApiContext) => string | null) =>
  async (c: ApiContext, next: Next) => {
    const targetClassroomId = resolveClassroomId(c);
    const denied = denyUnlessClassroomScope(c, targetClassroomId);
    if (denied) {
      return denied;
    }
    await next();
  };
