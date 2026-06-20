/**
 * （責務）Auth0 Management API および change_password 等、サーバー専用の Auth0 呼び出し。
 */
import type {
  ApiBindings,
  Auth0ErrorResponse,
  Auth0UserResponse,
} from './types/apiTypes';

const AUTH0_FETCH_TIMEOUT_MS = 10_000;

/**
 * M2M クライアント用トークン（User Management 等の Auth0 管理 API 呼び出し）
 */
export async function getAuth0ManagementToken(
  env: ApiBindings,
): Promise<string> {
  const signal = AbortSignal.timeout(AUTH0_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/oauth/token`, {
      method: 'POST',
      signal,
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
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? e.message
        : 'failed to get auth0 management token (network/timeout)',
      { cause: e },
    );
  }

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
  const signal = AbortSignal.timeout(AUTH0_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://${env.VITE_AUTH0_DOMAIN}/api/v2/users`, {
      method: 'POST',
      signal,
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
  } catch (e) {
    return {
      ok: false as const,
      status: null,
      message: e instanceof Error ? e.message : 'failed to create auth0 user',
    };
  }

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as Auth0ErrorResponse;
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

export async function deleteAuth0User(
  env: ApiBindings,
  token: string,
  userId: string,
) {
  const encodedUserId = encodeURIComponent(userId);
  const signal = AbortSignal.timeout(AUTH0_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://${env.VITE_AUTH0_DOMAIN}/api/v2/users/${encodedUserId}`,
      {
        method: 'DELETE',
        signal,
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    return false;
  }

  return response.ok;
}

export async function sendAuth0PasswordSetupEmail(
  env: ApiBindings,
  email: string,
) {
  const signal = AbortSignal.timeout(AUTH0_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://${env.VITE_AUTH0_DOMAIN}/dbconnections/change_password`,
      {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: env.VITE_AUTH0_CLIENT_ID,
          email,
          connection: env.AUTH0_DB_CONNECTION,
        }),
      },
    );
  } catch {
    return false;
  }

  return response.ok;
}
