/**
 * （責務）Cloudflare D1 バインディングから Drizzle ORM クライアント（getDb）を提供。
 */
import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}
