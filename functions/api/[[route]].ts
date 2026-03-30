import { Hono } from 'hono';
import { jwk } from 'hono/jwk';
import { handle } from 'hono/cloudflare-pages';
import type { Context, Next } from 'hono';
import type { JwtVariables } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { users, classrooms } from '../../db/schema';

type Bindings = Env & {
  AUTH0_AUDIENCE: string;
  AUTH0_ISSUER: string;
  AUTH0_JWKS_URI: string;
};

type AppUser = {
  id: string;
  role: 'admin' | 'manager' | 'staff';
  classroomId: string | null;
};

type AppVariables = JwtVariables & {
  currentUser: AppUser;
};

export const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>().basePath('/api');

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

const requireClassroomScope = (paramName: string) =>
  async (c: Context<{Bindings: Bindings; Variables: AppVariables}>, next: Next) => {
    const currentUser = c.var.currentUser;
    
    if(!currentUser){
      return c.json({ message: 'user not loaded' }, 500);
    }

    const targetClassroomId = c.req.param(paramName);
    if(currentUser.role !== 'admin' && (currentUser.role !== 'manager' || currentUser.classroomId !== targetClassroomId)){
      return c.json({ message: 'forbidden' }, 403);
    }

    await next();
  };

app.post('/classrooms', auth, loadUser, requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name: string = (typeof body?.name === 'string' ? body.name.trim() : '');

  if(!name){
    return c.json({ message: 'name is required' }, 400);
  }
  if(name.length > 100){
    return c.json({message: 'name must be 100 characters or less'}, 400);
  }

  const id = crypto.randomUUID();
  const db = getDb(c.env);

  await db.insert(classrooms).values({id, name, deletedAt: null});

  return c.json({ id, name }, 201);
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

  const result = await db.update(classrooms).set({deletedAt: new Date()}).where(and(eq(classrooms.id, id), isNull(classrooms.deletedAt)));

  if(result.meta.changes === 0){
    return c.json({message: 'classroom not found'}, 404);
  }

  return c.json({ success: true }, 200);
});


app.delete('/users/:id', auth, loadUser, requireManagerOrAbove, async(c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if(!targetId){
    return c.json({ message: 'id is required' }, 400);
  } 

  const db = getDb(c.env);

  const [target] = await db.select({id: users.id, role: users.role, classroomId: users.classroomId}).from(users).where(and(eq(users.id, targetId), isNull(users.deletedAt))).limit(1);

  if(!target){
    return c.json({ message: 'user not found' }, 404);
  }

  if(actor.role === 'manager' && (target.role === 'admin' || (!actor.classroomId || !target.classroomId || actor.classroomId !== target.classroomId))){
    return c.json({ message: 'forbidden' }, 403);
  }

  const result = await db.update(users).set({ deletedAt: new Date() }).where(and(eq(users.id, targetId), isNull(users.deletedAt)));

  if(result.meta.changes === 0){
    return c.json({ message: 'user not found' }, 404);
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