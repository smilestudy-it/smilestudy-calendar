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

export const app = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>().basePath('/api');

const auth = async (c: Context<{ Bindings: Bindings; Variables: JwtVariables }>, next: Next) =>
  jwk({
    jwks_uri: c.env.AUTH0_JWKS_URI,
    alg: ['RS256'],
    verification: {
      aud: c.env.AUTH0_AUDIENCE,
      iss: c.env.AUTH0_ISSUER,
    },
  })(c, next);

const requireAdmin = async (c: Context<{Bindings: Bindings; Variables: JwtVariables}>, next: Next) => {
  const { sub } = c.var.jwtPayload;
  if(!sub){
    return c.json({ message: 'invalid token payload' }, 401);
  }

  const db = getDb(c.env);
  const [currentUser] = await db.select({role: users.role}).from(users).where(and(eq(users.id, sub), isNull(users.deletedAt))).limit(1);

  if(!currentUser){
    return c.json({ message: 'user not found' }, 404);
  }
  if(currentUser.role !== 'admin'){
    return c.json({ message: 'forbidden' }, 403);
  }

  await next();
};

app.post('/classrooms', auth, requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();

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

app.get('/classrooms', auth, requireAdmin, async(c) =>{
  const db = getDb(c.env);

  const rows = await db.select({id: classrooms.id, name: classrooms.name}).from(classrooms).where(isNull(classrooms.deletedAt));
  return c.json(rows, 200);
});

app.delete('/classrooms/:id', auth, requireAdmin, async(c) =>{
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
})

export const onRequest = handle(app);