/**
 * （責務）Auth0 サイレント取得トークン付きの fetch フック。認証必須 API 用。
 */
import { useCallback } from 'react';

/**
 * Auth0 のアクセストークン付き `fetch` を返す。
 * 全認証必須 API 呼び出しの共通化用（`Authorization: Bearer` を毎回付与）。
 */
export function useAuthedFetch(getAccessTokenSilently: () => Promise<string>) {
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessTokenSilently();
      return fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessTokenSilently],
  );
}

export type AuthedFetch = ReturnType<typeof useAuthedFetch>;
