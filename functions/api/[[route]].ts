import { Hono } from 'hono';
import { jwk } from 'hono/jwk';
import { handle } from 'hono/cloudflare-pages';
import type { Context, Next } from 'hono';
import type { JwtVariables } from 'hono/jwt';

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

export const onRequest = handle(app);