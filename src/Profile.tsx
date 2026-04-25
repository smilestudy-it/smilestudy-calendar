/**
 * （責務）（サンプル寄り）Auth0 連携のユーザプロフィール表示。/api/me からアプリ上のユーザ行を表示。
 */
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";
import type { CurrentUser } from "./types/currentUser";

const Profile = () => {
  const { user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const [appUser, setAppUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;
    const loadAppUser = async () => {
      try {
        const token = await getAccessTokenSilently();
        const response = await fetch('/api/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as CurrentUser;
        if (!cancelled) {
          setAppUser(data);
        }
      } catch {
        if (!cancelled) {
          setAppUser(null);
        }
      }
    };

    void loadAppUser();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isLoading) {
    return <div className="text-sm text-slate-300">Loading profile...</div>;
  }

  return (
    isAuthenticated && user ? (
      <div className="flex flex-col items-center gap-4">
        <img 
          src={user.picture || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'%3E%3Ccircle cx='55' cy='55' r='55' fill='%2363b3ed'/%3E%3Cpath d='M55 50c8.28 0 15-6.72 15-15s-6.72-15-15-15-15 6.72-15 15 6.72 15 15 15zm0 7.5c-10 0-30 5.02-30 15v3.75c0 2.07 1.68 3.75 3.75 3.75h52.5c2.07 0 3.75-1.68 3.75-3.75V72.5c0-9.98-20-15-30-15z' fill='%23fff'/%3E%3C/svg%3E`} 
          alt={user.name || 'User'} 
          className="h-[110px] w-[110px] rounded-full border-2 border-sky-400 object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'%3E%3Ccircle cx='55' cy='55' r='55' fill='%2363b3ed'/%3E%3Cpath d='M55 50c8.28 0 15-6.72 15-15s-6.72-15-15-15-15 6.72-15 15 6.72 15 15 15zm0 7.5c-10 0-30 5.02-30 15v3.75c0 2.07 1.68 3.75 3.75 3.75h52.5c2.07 0 3.75-1.68 3.75-3.75V72.5c0-9.98-20-15-30-15z' fill='%23fff'/%3E%3C/svg%3E`;
          }}
        />
        <div className="text-center">
          <div className="mb-2 text-2xl font-semibold text-slate-100">
            {user.name}
          </div>
          <div className="text-base text-slate-300">
            {user.email}
          </div>
          {appUser && (
            <div className="mt-3 text-sm text-slate-200">
              <div>role: {appUser.role ?? '-'}</div>
              <div>classroom_id: {appUser.classroomId ?? '-'}</div>
            </div>
          )}
        </div>
      </div>
    ) : null
  );
};

export default Profile;