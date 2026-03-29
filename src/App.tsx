import { useAuth0 } from '@auth0/auth0-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoginButton from './LoginButton';
import AppShell from './components/AppShell';
import { useCurrentUser } from './hooks/useCurrentUser';
import HomePage from './pages/HomePage';
import ClassroomPage from './pages/ClassroomPage';

function App() {
  const { isAuthenticated, isLoading, error, user, getAccessTokenSilently } = useAuth0();
  const { currentUser, isLoadingCurrentUser, currentUserError } = useCurrentUser({
    isAuthenticated,
    getAccessTokenSilently,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <p className="text-lg font-semibold text-slate-300">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-rose-950/40 p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-rose-200">Auth Error</h1>
          <p className="mt-3 text-sm text-rose-100/90">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Smile Study Calendar</h1>
          <p className="mt-3 text-sm text-slate-300">ログインして教室管理画面にアクセスしてください。</p>
          <LoginButton />
        </div>
      </div>
    );
  }

  const role = currentUser?.role ?? '-';
  const classroomId = currentUser?.classroomId ?? '-';
  return (
    <AppShell
      userName={user?.name}
      userEmail={user?.email}
      role={role}
      classroomId={classroomId}
      isLoadingCurrentUser={isLoadingCurrentUser}
      currentUserError={currentUserError}
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/classroom"
          element={
            <ClassroomPage
              currentUser={currentUser}
              getAccessTokenSilently={getAccessTokenSilently}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default App;