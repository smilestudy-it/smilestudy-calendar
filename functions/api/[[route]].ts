import { Hono } from 'hono';
import { jwk } from 'hono/jwk';
import { handle } from 'hono/cloudflare-pages';
import type { Context, Next } from 'hono';
import type { JwtVariables } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { users, classrooms, students, subjects, lessonTypes, timeSlots } from '../../db/schema';
import {
  validateCreateClassroomInput,
  validateCreateLessonTypeInput,
  validateCreateStudentInput,
  validateCreateSubjectInput,
  validateCreateTimeSlotInput,
  validateCreateUserInput,
  validatePatchLessonTypeInput,
  validatePatchSubjectInput,
  validatePatchTimeSlotInput,
} from './validators';

type Bindings = Env & {
  AUTH0_AUDIENCE: string;
  AUTH0_ISSUER: string;
  AUTH0_JWKS_URI: string;
  VITE_AUTH0_DOMAIN: string;
  AUTH0_M2M_CLIENT_ID: string;
  AUTH0_M2M_CLIENT_SECRET: string;
  AUTH0_DB_CONNECTION: string;
  VITE_AUTH0_CLIENT_ID: string;
};

type AppUser = {
  id: string;
  role: 'admin' | 'manager' | 'staff';
  classroomId: string | null;
};

type AppVariables = JwtVariables & {
  currentUser: AppUser;
};

type Auth0UserResponse = {
  user_id: string;
};

type Auth0ErrorResponse = {
  message?: string;
};

/** Thrown when `classrooms.deleted_at` is set between preflight and user insert (create user flow). */
const CLASSROOM_NOT_ACTIVE_ERROR = 'CLASSROOM_NOT_ACTIVE_ERROR';

/** Matches `drizzle/0004_demonic_talkback.sql` partial unique index on active classrooms. */
const CLASSROOMS_NAME_ACTIVE_UNIQUE_INDEX = 'classrooms_name_active_unique';

/** Matches `drizzle/0005_acoustic_night_thrasher.sql` partial unique index on active users. */
const USERS_EMAIL_ACTIVE_UNIQUE_INDEX = 'users_email_active_unique';

function collectErrorTextParts(error: unknown, depth = 0): string[] {
  if (depth > 6) {
    return [];
  }
  if (error instanceof Error) {
    const parts = [error.message];
    if (error.cause !== undefined) {
      parts.push(...collectErrorTextParts(error.cause, depth + 1));
    }
    return parts;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return [message];
    }
  }
  try {
    return [JSON.stringify(error)];
  } catch {
    return [String(error)];
  }
}

function isD1ClassroomNameUniqueViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ');
  const lower = text.toLowerCase();
  return (
    text.includes(CLASSROOMS_NAME_ACTIVE_UNIQUE_INDEX) ||
    lower.includes('unique constraint failed') ||
    (lower.includes('unique constraint') && lower.includes('classroom')) ||
    (lower.includes('sqlite_constraint') && lower.includes('unique'))
  );
}

function isD1UsersEmailUniqueViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ');
  const lower = text.toLowerCase();
  return (
    text.includes(USERS_EMAIL_ACTIVE_UNIQUE_INDEX) ||
    lower.includes('unique constraint failed') ||
    lower.includes('unique constraint')
  );
}

function isD1ForeignKeyViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ').toLowerCase();
  return text.includes('foreign key');
}

export const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>().basePath('/api');

const getAuth0ManagementToken = async (env: Bindings): Promise<string> => {
  const response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.AUTH0_M2M_CLIENT_ID,
      client_secret: env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${env.VITE_AUTH0_DOMAIN}/api/v2/`,
    }),
  });

  if (!response.ok) {
    throw new Error('failed to get auth0 management token');
  }

  const tokenBody = (await response.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new Error('auth0 management token is missing');
  }

  return tokenBody.access_token;
};

const createAuth0User = async (env: Bindings, token: string, email: string, displayName: string) => {
  const response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/api/v2/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      connection: env.AUTH0_DB_CONNECTION,
      email,
      name: displayName,
      password: `${crypto.randomUUID()}aA1!`,
      email_verified: false,
      verify_email: true,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Auth0ErrorResponse;
    return {
      ok: false as const,
      status: response.status,
      message: body.message ?? 'failed to create auth0 user',
    };
  }

  const created = (await response.json()) as Auth0UserResponse;
  return {
    ok: true as const,
    userId: created.user_id,
  };
};

const deleteAuth0User = async (env: Bindings, token: string, userId: string) => {
  const encodedUserId = encodeURIComponent(userId);
  const response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/api/v2/users/${encodedUserId}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  return response.ok;
};

const sendAuth0PasswordSetupEmail = async (env: Bindings, email: string) => {
  const response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/dbconnections/change_password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.VITE_AUTH0_CLIENT_ID,
      email,
      connection: env.AUTH0_DB_CONNECTION,
    }),
  });

  return response.ok;
};

const auth = async (c: Context<{ Bindings: Bindings; Variables: AppVariables }>, next: Next) =>
  jwk({
    jwks_uri: c.env.AUTH0_JWKS_URI,
    alg: ['RS256'],
    verification: {
      aud: c.env.AUTH0_AUDIENCE,
      iss: c.env.AUTH0_ISSUER,
    },
  })(c, next);

const loadUser = async (c: Context<{Bindings: Bindings; Variables: AppVariables}>, next: Next) => {
  const { sub } = c.var.jwtPayload;
  if(!sub){
    return c.json({ message: 'invalid token payload' }, 401);
  }

  const db = getDb(c.env);
  const [currentUser] = await db.select({id: users.id, role: users.role, classroomId: users.classroomId}).from(users).where(and(eq(users.id, sub), isNull(users.deletedAt))).limit(1);

  if(!currentUser){
    return c.json({ message: 'user not found' }, 404);
  }
  c.set('currentUser', currentUser);

  await next();
}

const requireAdmin = async (c: Context<{Bindings: Bindings; Variables: AppVariables}>, next: Next) => {
  const currentUser = c.var.currentUser;

  if(!currentUser){
    return c.json({ message: 'user not loaded' }, 500);
  }
  if(currentUser.role !== 'admin'){
    return c.json({ message: 'forbidden' }, 403);
  }

  await next();
};


const requireManagerOrAbove = async (c: Context<{Bindings: Bindings; Variables: AppVariables}>, next: Next) => {
  const currentUser = c.var.currentUser;

  if(!currentUser){
    return c.json({ message: 'user not loaded' }, 500);
  }
  if(currentUser.role !== 'admin' && currentUser.role !== 'manager'){
    return c.json({ message: 'forbidden' }, 403);
  }

  await next();
};

type ApiContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/**
 * 対象 classroomId へのアクセス可否（requireClassroomScope と同一ルール）。
 * 解決済みの classroomId を渡す PATCH/DELETE 等でも使う。
 */
function denyUnlessClassroomScope(c: ApiContext, targetClassroomId: string | null | undefined): Response | null {
  const currentUser = c.var.currentUser;
  if (!currentUser) {
    return c.json({ message: 'user not loaded' }, 500);
  }
  const id = typeof targetClassroomId === 'string' ? targetClassroomId.trim() : '';
  if (!id) {
    return c.json({ message: 'classroom id is required' }, 400);
  }
  if (currentUser.role === 'admin') {
    return null;
  }
  if (!currentUser.classroomId || currentUser.classroomId !== id) {
    return c.json({ message: 'forbidden' }, 403);
  }
  return null;
}

/** 対象 classroomId へのアクセス: 管理者は全教室、教室長は自教室のみ（requireManagerOrAbove と併用） */
const requireClassroomScope = (resolveClassroomId: (c: ApiContext) => string | null) =>
  async (c: ApiContext, next: Next) => {
    const targetClassroomId = resolveClassroomId(c);
    const denied = denyUnlessClassroomScope(c, targetClassroomId);
    if (denied) {
      return denied;
    }
    await next();
  };

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

app.post('/classrooms', auth, loadUser, requireAdmin, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateClassroomInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const db = getDb(c.env);
  const [existingClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.name, input.name), isNull(classrooms.deletedAt)))
    .limit(1);

  if (existingClassroom) {
    return c.json({ message: 'classroom already exists' }, 409);
  }

  const id = crypto.randomUUID();

  try {
    await db.insert(classrooms).values({ id, name: input.name, deletedAt: null });
  } catch (error) {
    if (isD1ClassroomNameUniqueViolation(error)) {
      return c.json({ message: 'classroom already exists' }, 409);
    }
    return c.json({ message: 'failed to create classroom' }, 500);
  }

  return c.json({ id, name: input.name }, 201);
});

app.get('/classrooms', auth, loadUser, requireAdmin, async(c) =>{
  const db = getDb(c.env);

  const rows = await db.select({id: classrooms.id, name: classrooms.name}).from(classrooms).where(isNull(classrooms.deletedAt));
  return c.json(rows, 200);
});

app.delete('/classrooms/:id', auth, loadUser, requireAdmin, async(c) =>{
  const id = c.req.param('id');
  if(!id){
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const deletedAt = new Date();

  const classroomUsersPreview = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

  let managementToken = '';
  if (classroomUsersPreview.length > 0) {
    try {
      managementToken = await getAuth0ManagementToken(c.env);
    } catch {
      return c.json({ message: 'failed to delete classroom' }, 400);
    }
  }

  let txResult:
    | {
        notFound: true;
        updatedUserIds: string[];
        updatedStudentIds: string[];
        updatedSubjectIds: string[];
        updatedLessonTypeIds: string[];
        updatedTimeSlotIds: string[];
      }
    | {
        notFound: false;
        updatedUserIds: string[];
        updatedStudentIds: string[];
        updatedSubjectIds: string[];
        updatedLessonTypeIds: string[];
        updatedTimeSlotIds: string[];
      };
  try {
    // Serialize classroom soft-delete + user/student/preset soft-deletes. `immediate` takes a write lock early.
    // Members are selected only after the classroom row is marked deleted so concurrent creates
    // that re-check `classrooms.deleted_at` cannot commit into an "open" classroom.
    txResult = await db.transaction(
      async (tx) => {
        const result = await tx
          .update(classrooms)
          .set({ deletedAt })
          .where(and(eq(classrooms.id, id), isNull(classrooms.deletedAt)));

        if (result.meta.changes === 0) {
          return {
            notFound: true as const,
            updatedUserIds: [] as string[],
            updatedStudentIds: [] as string[],
            updatedSubjectIds: [] as string[],
            updatedLessonTypeIds: [] as string[],
            updatedTimeSlotIds: [] as string[],
          };
        }

        const classroomUsers = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

        const updatedUserIds: string[] = [];
        for (const classroomUser of classroomUsers) {
          const userUpdateResult = await tx
            .update(users)
            .set({ deletedAt })
            .where(and(eq(users.id, classroomUser.id), isNull(users.deletedAt)));

          if (userUpdateResult.meta.changes > 0) {
            updatedUserIds.push(classroomUser.id);
          }
        }

        const classroomStudents = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.classroomId, id), isNull(students.deletedAt)));

        const updatedStudentIds: string[] = [];
        for (const row of classroomStudents) {
          const studentUpdateResult = await tx
            .update(students)
            .set({ deletedAt })
            .where(and(eq(students.id, row.id), isNull(students.deletedAt)));

          if (studentUpdateResult.meta.changes > 0) {
            updatedStudentIds.push(row.id);
          }
        }

        const classroomSubjects = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.classroomId, id), isNull(subjects.deletedAt)));

        const updatedSubjectIds: string[] = [];
        for (const row of classroomSubjects) {
          const r = await tx
            .update(subjects)
            .set({ deletedAt })
            .where(and(eq(subjects.id, row.id), isNull(subjects.deletedAt)));
          if (r.meta.changes > 0) {
            updatedSubjectIds.push(row.id);
          }
        }

        const classroomLessonTypes = await tx
          .select({ id: lessonTypes.id })
          .from(lessonTypes)
          .where(and(eq(lessonTypes.classroomId, id), isNull(lessonTypes.deletedAt)));

        const updatedLessonTypeIds: string[] = [];
        for (const row of classroomLessonTypes) {
          const r = await tx
            .update(lessonTypes)
            .set({ deletedAt })
            .where(and(eq(lessonTypes.id, row.id), isNull(lessonTypes.deletedAt)));
          if (r.meta.changes > 0) {
            updatedLessonTypeIds.push(row.id);
          }
        }

        const classroomTimeSlots = await tx
          .select({ id: timeSlots.id })
          .from(timeSlots)
          .where(and(eq(timeSlots.classroomId, id), isNull(timeSlots.deletedAt)));

        const updatedTimeSlotIds: string[] = [];
        for (const row of classroomTimeSlots) {
          const r = await tx
            .update(timeSlots)
            .set({ deletedAt })
            .where(and(eq(timeSlots.id, row.id), isNull(timeSlots.deletedAt)));
          if (r.meta.changes > 0) {
            updatedTimeSlotIds.push(row.id);
          }
        }

        return {
          notFound: false as const,
          updatedUserIds,
          updatedStudentIds,
          updatedSubjectIds,
          updatedLessonTypeIds,
          updatedTimeSlotIds,
        };
      },
      { behavior: 'immediate' },
    );
  } catch {
    return c.json({ message: 'failed to delete classroom' }, 400);
  }

  if (txResult.notFound) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  const {
    updatedUserIds,
    updatedStudentIds,
    updatedSubjectIds,
    updatedLessonTypeIds,
    updatedTimeSlotIds,
  } = txResult;

  const rollbackClassroomChildSoftDeletes = async () => {
    for (const studentId of updatedStudentIds) {
      await db
        .update(students)
        .set({ deletedAt: null })
        .where(eq(students.id, studentId))
        .catch(() => undefined);
    }
    for (const presetId of updatedSubjectIds) {
      await db
        .update(subjects)
        .set({ deletedAt: null })
        .where(eq(subjects.id, presetId))
        .catch(() => undefined);
    }
    for (const presetId of updatedLessonTypeIds) {
      await db
        .update(lessonTypes)
        .set({ deletedAt: null })
        .where(eq(lessonTypes.id, presetId))
        .catch(() => undefined);
    }
    for (const presetId of updatedTimeSlotIds) {
      await db
        .update(timeSlots)
        .set({ deletedAt: null })
        .where(eq(timeSlots.id, presetId))
        .catch(() => undefined);
    }
  };

  if (updatedUserIds.length > 0 && !managementToken) {
    try {
      managementToken = await getAuth0ManagementToken(c.env);
    } catch {
      await db.update(classrooms).set({ deletedAt: null }).where(eq(classrooms.id, id)).catch(() => undefined);
      for (const userId of updatedUserIds) {
        await db.update(users).set({ deletedAt: null }).where(eq(users.id, userId)).catch(() => undefined);
      }
      await rollbackClassroomChildSoftDeletes();
      return c.json({ message: 'failed to delete classroom' }, 400);
    }
  }

  const successfullyDeletedAuth0Ids: string[] = [];
  try {
    for (const userId of updatedUserIds) {
      const auth0Deleted = await deleteAuth0User(c.env, managementToken, userId);
      if (!auth0Deleted) {
        throw new Error('failed to delete auth0 user');
      }
      successfullyDeletedAuth0Ids.push(userId);
    }
  } catch {
    await db.update(classrooms).set({ deletedAt: null }).where(eq(classrooms.id, id)).catch(() => undefined);
    const successSet = new Set(successfullyDeletedAuth0Ids);
    for (const userId of updatedUserIds) {
      if (!successSet.has(userId)) {
        await db.update(users).set({ deletedAt: null }).where(eq(users.id, userId)).catch(() => undefined);
      }
    }
    await rollbackClassroomChildSoftDeletes();
    return c.json({ message: 'failed to delete classroom' }, 400);
  }

  return c.json({ success: true }, 200);
});

app.post('/users', auth, loadUser, requireManagerOrAbove, async (c) =>{
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateUserInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  if(actor.role === 'manager'){
    if(input.role === 'admin' || (actor.classroomId !== input.classroomId)){
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
      .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
      .limit(1);

    if (!existingClassroom) {
      return c.json({ message: 'classroom not found' }, 404);
    }
  }

  let managementToken = '';
  let auth0UserId = '';
  let d1Inserted = false;
  const displayName = `${input.lastName} ${input.firstName}`.trim();

  try {
    managementToken = await getAuth0ManagementToken(c.env);
    const auth0Result = await createAuth0User(c.env, managementToken, input.email, displayName);
    if (!auth0Result.ok) {
      if (auth0Result.status === 409) {
        return c.json({ message: 'user already exists' }, 409);
      }
      return c.json({ message: auth0Result.message }, 400);
    }

    auth0UserId = auth0Result.userId;

    if (input.classroomId) {
      const [classroomStillActive] = await db
        .select({ id: classrooms.id })
        .from(classrooms)
        .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
        .limit(1);

      if (!classroomStillActive) {
        throw new Error(CLASSROOM_NOT_ACTIVE_ERROR);
      }
    }

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

    const mailSent = await sendAuth0PasswordSetupEmail(c.env, input.email);
    if (!mailSent) {
      throw new Error('failed to send password setup email');
    }
  } catch (error) {
    if (d1Inserted && auth0UserId) {
      await db.delete(users).where(eq(users.id, auth0UserId)).catch(() => undefined);
    }
    if (managementToken && auth0UserId) {
      const auth0RollbackDeleted = await deleteAuth0User(c.env, managementToken, auth0UserId);
      if (!auth0RollbackDeleted) {
        return c.json({ message: 'failed to roll back remote user' }, 500);
      }
    }
    if (error instanceof Error && error.message === CLASSROOM_NOT_ACTIVE_ERROR) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    if (isD1UsersEmailUniqueViolation(error)) {
      return c.json({ message: 'user already exists' }, 409);
    }
    return c.json({ message: 'failed to create user' }, 400);
  }

  return c.json({
    id: auth0UserId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    role: input.role,
    classroomId: input.classroomId,
    color: input.color,
  }, 201);
});

app.get('/users/admins', auth, loadUser, requireManagerOrAbove, async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      classroomId: users.classroomId,
    })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)));
  return c.json(rows, 200);
});

app.get('/users/:classroomId', auth, loadUser, requireManagerOrAbove, requireClassroomScope((c) => c.req.param('classroomId') ?? null), async(c) =>{
  const classroomId = c.req.param('classroomId');
  if(!classroomId){
    return c.json({ message: 'classroom id is required' }, 400);
  }
  const db = getDb(c.env);

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      classroomId: users.classroomId,
    })
    .from(users)
    .where(and(eq(users.classroomId, classroomId), isNull(users.deletedAt)));
  return c.json(rows, 200);
});

app.delete('/users/:id', auth, loadUser, requireManagerOrAbove, async(c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if(!targetId){
    return c.json({ message: 'id is required' }, 400);
  } 

  const db = getDb(c.env);

  const [target] = await db
    .select({ id: users.id, role: users.role, classroomId: users.classroomId, email: users.email })
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if(!target){
    return c.json({ message: 'user not found' }, 404);
  }

  if (actor.id === targetId) {
    return c.json({ message: 'cannot delete yourself' }, 403);
  }

  if(actor.role === 'manager' && (target.role === 'admin' || (!actor.classroomId || !target.classroomId || actor.classroomId !== target.classroomId))){
    return c.json({ message: 'forbidden' }, 403);
  }

  let managementToken = '';
  const deletedAt = new Date();

  try {
    managementToken = await getAuth0ManagementToken(c.env);
  } catch {
    return c.json({ message: 'failed to delete user' }, 400);
  }

  const result = await db
    .update(users)
    .set({ deletedAt })
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)));

  if(result.meta.changes === 0){
    return c.json({ message: 'user not found' }, 404);
  }

  const rollbackUserSoftDelete = async () => {
    await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, targetId))
      .catch(() => undefined);
  };

  try {
    const auth0Deleted = await deleteAuth0User(c.env, managementToken, targetId);
    if (!auth0Deleted) {
      await rollbackUserSoftDelete();
      return c.json({ message: 'failed to delete user' }, 400);
    }
  } catch {
    await rollbackUserSoftDelete();
    return c.json({ message: 'failed to delete user' }, 400);
  }
  
  return c.json({ success: true }, 200);
});


app.post('/students', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateStudentInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const db = getDb(c.env);
  const id = crypto.randomUUID();

  type CreateStudentTxResult =
    | { ok: true }
    | { ok: false; reason: 'classroom_not_found' };

  let txResult: CreateStudentTxResult;
  try {
    txResult = await db.transaction(
      async (tx) => {
        const [activeClassroom] = await tx
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
          .limit(1);
        if (!activeClassroom) {
          return { ok: false as const, reason: 'classroom_not_found' as const };
        }
        await tx.insert(students).values({
          id,
          name: input.name,
          email: input.email,
          birthYear: input.birthYear,
          classroomId: input.classroomId,
          deletedAt: null,
        });
        return { ok: true as const };
      },
      { behavior: 'immediate' },
    );
  } catch (err) {
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    const detail = collectErrorTextParts(err).join(' ') || (err instanceof Error ? err.message : String(err));
    return c.json({ message: 'failed to create student', detail }, 500);
  }

  if (!txResult.ok) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  return c.json(
    {
      id,
      name: input.name,
      email: input.email,
      birthYear: input.birthYear,
      classroomId: input.classroomId,
    },
    201,
  );
});

app.delete('/students/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const db = getDb(c.env);

  const [target] = await db
    .select({ id: students.id, classroomId: students.classroomId })
    .from(students)
    .where(and(eq(students.id, targetId), isNull(students.deletedAt)))
    .limit(1);

  if (!target) {
    return c.json({ message: 'student not found' }, 404);
  }

  if (
    actor.role === 'manager' &&
    (!actor.classroomId || actor.classroomId !== target.classroomId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const deletedAt = new Date();
  const result = await db
    .update(students)
    .set({ deletedAt })
    .where(and(eq(students.id, targetId), isNull(students.deletedAt)));

  if (result.meta.changes === 0) {
    return c.json({ message: 'student not found' }, 404);
  }

  return c.json({ success: true }, 200);
});

app.get('/students/:classroomId', auth, loadUser, requireClassroomScope((c) => c.req.param('classroomId') ?? null), async (c) => {
  const classroomId = c.req.param('classroomId');
  if (!classroomId) {
    return c.json({ message: 'classroom id is required' }, 400);
  }
  const db = getDb(c.env);

  const rows = await db
    .select({
      id: students.id,
      name: students.name,
      email: students.email,
      birthYear: students.birthYear,
    })
    .from(students)
    .where(and(eq(students.classroomId, classroomId), isNull(students.deletedAt)));
  return c.json(rows, 200);
});

app.get(
  '/classrooms/:classroomId/subjects',
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
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.classroomId, classroomId), isNull(subjects.deletedAt)));
    return c.json(rows, 200);
  },
);

app.get(
  '/classrooms/:classroomId/lesson-types',
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
      .select({ id: lessonTypes.id, name: lessonTypes.name })
      .from(lessonTypes)
      .where(and(eq(lessonTypes.classroomId, classroomId), isNull(lessonTypes.deletedAt)));
    return c.json(rows, 200);
  },
);

app.get(
  '/classrooms/:classroomId/time-slots',
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
        id: timeSlots.id,
        startTime: timeSlots.startTime,
        endTime: timeSlots.endTime,
      })
      .from(timeSlots)
      .where(and(eq(timeSlots.classroomId, classroomId), isNull(timeSlots.deletedAt)));
    return c.json(rows, 200);
  },
);

app.post('/subjects', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateSubjectInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const db = getDb(c.env);
  const newId = crypto.randomUUID();
  const [activeClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
    .limit(1);
  if (!activeClassroom) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  try {
    await db.insert(subjects).values({
      id: newId,
      name: input.name,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    const detail = collectErrorTextParts(err).join(' ') || (err instanceof Error ? err.message : String(err));
    return c.json({ message: 'failed to create subject', detail }, 500);
  }
  return c.json({ id: newId, name: input.name, classroomId: input.classroomId }, 201);
});

app.post('/lesson-types', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateLessonTypeInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const db = getDb(c.env);
  const newId = crypto.randomUUID();
  const [activeClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
    .limit(1);
  if (!activeClassroom) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  try {
    await db.insert(lessonTypes).values({
      id: newId,
      name: input.name,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    const detail = collectErrorTextParts(err).join(' ') || (err instanceof Error ? err.message : String(err));
    return c.json({ message: 'failed to create lesson type', detail }, 500);
  }
  return c.json({ id: newId, name: input.name, classroomId: input.classroomId }, 201);
});

app.post('/time-slots', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateTimeSlotInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const db = getDb(c.env);
  const newId = crypto.randomUUID();
  const [activeClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
    .limit(1);
  if (!activeClassroom) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  try {
    await db.insert(timeSlots).values({
      id: newId,
      classroomId: input.classroomId,
      startTime: input.startTime,
      endTime: input.endTime,
      deletedAt: null,
    });
  } catch (err) {
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    const detail = collectErrorTextParts(err).join(' ') || (err instanceof Error ? err.message : String(err));
    return c.json({ message: 'failed to create time slot', detail }, 500);
  }
  return c.json(
    {
      id: newId,
      classroomId: input.classroomId,
      startTime: input.startTime,
      endTime: input.endTime,
    },
    201,
  );
});

app.patch('/subjects/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchSubjectInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: subjects.id, classroomId: subjects.classroomId })
    .from(subjects)
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'subject not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const result = await db
    .update(subjects)
    .set({ name: input.name })
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'subject not found' }, 404);
  }
  return c.json({ id: targetId, name: input.name, classroomId: row.classroomId }, 200);
});

app.patch('/lesson-types/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchLessonTypeInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: lessonTypes.id, classroomId: lessonTypes.classroomId })
    .from(lessonTypes)
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const result = await db
    .update(lessonTypes)
    .set({ name: input.name })
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  return c.json({ id: targetId, name: input.name, classroomId: row.classroomId }, 200);
});

app.patch('/time-slots/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchTimeSlotInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({
      id: timeSlots.id,
      classroomId: timeSlots.classroomId,
      startTime: timeSlots.startTime,
      endTime: timeSlots.endTime,
    })
    .from(timeSlots)
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const nextStart = input.startTime ?? row.startTime;
  const nextEnd = input.endTime ?? row.endTime;
  if (hmToMinutes(nextStart) >= hmToMinutes(nextEnd)) {
    return c.json({ message: 'end time must be after start time' }, 400);
  }
  const result = await db
    .update(timeSlots)
    .set({ startTime: nextStart, endTime: nextEnd })
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  return c.json(
    {
      id: targetId,
      classroomId: row.classroomId,
      startTime: nextStart,
      endTime: nextEnd,
    },
    200,
  );
});

app.delete('/subjects/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: subjects.id, classroomId: subjects.classroomId })
    .from(subjects)
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'subject not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(subjects)
    .set({ deletedAt })
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'subject not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.delete('/lesson-types/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: lessonTypes.id, classroomId: lessonTypes.classroomId })
    .from(lessonTypes)
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(lessonTypes)
    .set({ deletedAt })
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.delete('/time-slots/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: timeSlots.id, classroomId: timeSlots.classroomId })
    .from(timeSlots)
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(timeSlots)
    .set({ deletedAt })
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.get('/me', auth, async (c) => {
  const { sub } = c.var.jwtPayload;
  if (!sub) {
    return c.json({ message: 'invalid token payload' }, 401);
  }

  const db = getDb(c.env);
  const [currentUser] = await db
    .select({
      id: users.id,
      role: users.role,
      classroomId: users.classroomId,
    })
    .from(users)
    .where(and(eq(users.id, sub), isNull(users.deletedAt)))
    .limit(1);

  if (!currentUser) {
    return c.json({ message: 'user not found' }, 404);
  }

  return c.json(currentUser);
});


export const onRequest = handle(app);