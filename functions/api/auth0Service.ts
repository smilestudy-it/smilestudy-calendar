import type { ApiBindings, Auth0ErrorResponse, Auth0UserResponse } from './apiTypes';

/**
 * M2M クライアント用トークン（User Management 等の Auth0 管理 API 呼び出し）
 */
export async function getAuth0ManagementToken(env: ApiBindings): Promise<string> {
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
}

export async function createAuth0User(
  env: ApiBindings,
  token: string,
  email: string,
  displayName: string,
) {
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
}

export async function deleteAuth0User(env: ApiBindings, token: string, userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  const response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/api/v2/users/${encodedUserId}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  return response.ok;
}

export async function sendAuth0PasswordSetupEmail(env: ApiBindings, email: string) {
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
}
