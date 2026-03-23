import { Hono } from 'hono';
import { jwk } from 'hono/jwk';
import { handle } from 'hono/cloudflare-pages';
import type { Context, Next } from 'hono';
import type { JwtVariables } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { users } from '../../db/schema';

type Bindings = Env & {
  AUTH0_AUDIENCE: string;
  AUTH0_ISSUER: string;
  AUTH0_JWKS_URI: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>().basePath('/api');

const auth = async (c: Context<{ Bindings: Bindings; Variables: JwtVariables }>, next: Next) =>
  jwk({
    jwks_uri: c.env.AUTH0_JWKS_URI,
    alg: ['RS256'],
    verification: {
      aud: c.env.AUTH0_AUDIENCE,
      iss: c.env.AUTH0_ISSUER,
    },
  })(c, next);

app.get('/', (c) => c.json({ message: 'Hello' }));

app.get('/protect', auth, (c) => {
  const { sub } = c.var.jwtPayload; 
  return c.json({ message: 'auth success', userId: sub });
});

app.get('/getRole', auth, async (c) => {
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