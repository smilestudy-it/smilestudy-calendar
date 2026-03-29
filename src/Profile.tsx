import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";

type AppUser = {
  role: 'admin' | 'manager' | 'staff' | null;
  classroomId: string | null;
};

const Profile = () => {
  const { user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const [appUser, setAppUser] = useState<AppUser | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;
    const loadAppUser = async () => {
      try {
        const token = await getAccessTokenSilently();
        const response = await fetch('/api/getRole', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as AppUser;
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
    return <div className="loading-text">Loading profile...</div>;
  }

  return (
    isAuthenticated && user ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <img 
          src={user.picture || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'%3E%3Ccircle cx='55' cy='55' r='55' fill='%2363b3ed'/%3E%3Cpath d='M55 50c8.28 0 15-6.72 15-15s-6.72-15-15-15-15 6.72-15 15 6.72 15 15 15zm0 7.5c-10 0-30 5.02-30 15v3.75c0 2.07 1.68 3.75 3.75 3.75h52.5c2.07 0 3.75-1.68 3.75-3.75V72.5c0-9.98-20-15-30-15z' fill='%23fff'/%3E%3C/svg%3E`} 
          alt={user.name || 'User'} 
          className="profile-picture"
          style={{ 
            width: '110px', 
            height: '110px', 
            borderRadius: '50%', 
            objectFit: 'cover',
            border: '3px solid #63b3ed'
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'%3E%3Ccircle cx='55' cy='55' r='55' fill='%2363b3ed'/%3E%3Cpath d='M55 50c8.28 0 15-6.72 15-15s-6.72-15-15-15-15 6.72-15 15 6.72 15 15 15zm0 7.5c-10 0-30 5.02-30 15v3.75c0 2.07 1.68 3.75 3.75 3.75h52.5c2.07 0 3.75-1.68 3.75-3.75V72.5c0-9.98-20-15-30-15z' fill='%23fff'/%3E%3C/svg%3E`;
          }}
        />
        <div style={{ textAlign: 'center' }}>
          <div className="profile-name" style={{ fontSize: '2rem', fontWeight: '600', color: '#f7fafc', marginBottom: '0.5rem' }}>
            {user.name}
          </div>
          <div className="profile-email" style={{ fontSize: '1.15rem', color: '#a0aec0' }}>
            {user.email}
          </div>
          {appUser && (
            <div style={{ marginTop: '0.75rem', color: '#cbd5e0', fontSize: '0.95rem' }}>
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