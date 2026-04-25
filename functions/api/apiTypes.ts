import type { JwtVariables } from 'hono/jwt';
import type { Context } from 'hono';

/**
 * Cloudflare `Env` にアプリ用の必須 Auth0 変数を上乗せした Hono バインド型
 */
export type ApiBindings = Env & {
  AUTH0_AUDIENCE: string;
  AUTH0_ISSUER: string;
  AUTH0_JWKS_URI: string;
  VITE_AUTH0_DOMAIN: string;
  AUTH0_M2M_CLIENT_ID: string;
  AUTH0_M2M_CLIENT_SECRET: string;
  AUTH0_DB_CONNECTION: string;
  VITE_AUTH0_CLIENT_ID: string;
};

/**
 * `loadUser` 以降のリクエストで使う API 上のユーザ（JWT sub と D1 users の同期前提）
 */
export type AppUser = {
  id: string;
  role: 'admin' | 'manager' | 'staff';
  classroomId: string | null;
};

export type AppVariables = JwtVariables & {
  currentUser: AppUser;
};

export type Auth0UserResponse = {
  user_id: string;
};

export type Auth0ErrorResponse = {
  message?: string;
};

/**
 * 認可・スコープ判定用の Hono コンテキスト
 */
export type ApiContext = Context<{ Bindings: ApiBindings; Variables: AppVariables }>;
