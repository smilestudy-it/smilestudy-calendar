import { useEffect, useState } from 'react';
import type { CurrentUser } from '../types/currentUser';

type UseCurrentUserParams = {
  isAuthenticated: boolean;
  getAccessTokenSilently: () => Promise<string>;
};

export function useCurrentUser({ isAuthenticated, getAccessTokenSilently }: UseCurrentUserParams) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingCurrentUser, setIsLoadingCurrentUser] = useState(false);
  const [currentUserError, setCurrentUserError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;
    const loadCurrentUser = async () => {
      setIsLoadingCurrentUser(true);
      setCurrentUserError(null);
      try {
        const token = await getAccessTokenSilently();
        const response = await fetch('/api/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (!cancelled) {
            setCurrentUserError('ユーザー情報の取得に失敗しました。');
          }
          return;
        }

        const data = (await response.json()) as CurrentUser;
        if (!cancelled) {
          setCurrentUser(data);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserError('ユーザー情報の取得に失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCurrentUser(false);
        }
      }
    };

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, getAccessTokenSilently]);

  return {
    currentUser,
    isLoadingCurrentUser,
    currentUserError,
  };
}
