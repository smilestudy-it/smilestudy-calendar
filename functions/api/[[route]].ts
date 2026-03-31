import { Hono } from 'hono';
import { jwk } from 'hono/jwk';
import { handle } from 'hono/cloudflare-pages';
import type { Context, Next } from 'hono';
import type { JwtVariables } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { users, classrooms } from '../../db/schema';
import { validateCreateClassroomInput, validateCreateUserInput } from './validators';

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

const requireClassroomScope = (
  resolveClassroomId: (c: Context<{Bindings: Bindings; Variables: AppVariables}>) => string | null
) =>
  async (c: Context<{Bindings: Bindings; Variables: AppVariables}>, next: Next) => {
    const currentUser = c.var.currentUser;
    
    if(!currentUser){
      return c.json({ message: 'user not loaded' }, 500);
    }

    const targetClassroomId = resolveClassroomId(c);
    if(!targetClassroomId){
      return c.json({ message: 'classroom id is required' }, 400);
    }
    if(currentUser.role !== 'admin' && (currentUser.role !== 'manager' || currentUser.classroomId !== targetClassroomId)){
      return c.json({ message: 'forbidden' }, 403);
    }

    await next();
  };

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

  await db.insert(classrooms).values({id, name: input.name, deletedAt: null});

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

  const classroomUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

  let managementToken = '';
  if (classroomUsers.length > 0) {
    try {
      managementToken = await getAuth0ManagementToken(c.env);
    } catch {
      return c.json({ message: 'failed to delete classroom' }, 400);
    }
  }

  const result = await db
    .update(classrooms)
    .set({ deletedAt })
    .where(and(eq(classrooms.id, id), isNull(classrooms.deletedAt)));

  if(result.meta.changes === 0){
    return c.json({message: 'classroom not found'}, 404);
  }

  const updatedUserIds: string[] = [];
  try {
    for (const classroomUser of classroomUsers) {
      const userUpdateResult = await db
        .update(users)
        .set({ deletedAt })
        .where(and(eq(users.id, classroomUser.id), isNull(users.deletedAt)));

      if (userUpdateResult.meta.changes > 0) {
        updatedUserIds.push(classroomUser.id);
      }
    }

    for (const userId of updatedUserIds) {
      const auth0Deleted = await deleteAuth0User(c.env, managementToken, userId);
      if (!auth0Deleted) {
        throw new Error('failed to delete auth0 user');
      }
    }
  } catch {
    await db.update(classrooms).set({ deletedAt: null }).where(eq(classrooms.id, id)).catch(() => undefined);
    for (const userId of updatedUserIds) {
      await db.update(users).set({ deletedAt: null }).where(eq(users.id, userId)).catch(() => undefined);
    }
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
  } catch {
    if (d1Inserted && auth0UserId) {
      await db.delete(users).where(eq(users.id, auth0UserId)).catch(() => undefined);
    }
    if (managementToken && auth0UserId) {
      await deleteAuth0User(c.env, managementToken, auth0UserId).catch(() => undefined);
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

  const auth0Deleted = await deleteAuth0User(c.env, managementToken, targetId);
  if (!auth0Deleted) {
    await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, targetId))
      .catch(() => undefined);
    return c.json({ message: 'failed to delete user' }, 400);
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