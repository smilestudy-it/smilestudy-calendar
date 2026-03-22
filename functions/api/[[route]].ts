import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';

const app = new Hono({ strict: false }).basePath('/api');

app.get('/', (c) => {
  return c.json({ message: 'Hello' });
});

export const onRequest = handle(app);