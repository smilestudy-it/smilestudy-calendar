/**
 * （責務）ルート定義、共有パス /share の未ログイン表示、それ以外の Auth0 ＋管理画面のルーティング。
 */
import { useAuth0 } from '@auth0/auth0-react';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LoginButton from './components/ui/LoginButton';
import AppShell from './components/AppShell';
import { useCurrentUser } from './hooks/useCurrentUser';

const HomePage = lazy(() => import('./pages/HomePage'));
const ClassroomPage = lazy(() => import('./pages/ClassroomPage'));
const TeacherManagementPage = lazy(() => import('./pages/TeacherManagementPage'));
const StudentManagementPage = lazy(() => import('./pages/StudentManagementPage'));
const PresetsSettingsPage = lazy(() => import('./pages/PresetsSettingsPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const SharedStudentCalendarPage = lazy(() => import('./pages/SharedStudentCalendarPage'));

/** `/share` または `/share/...` のみ。`/shared` などは除外 */
const SHARE_APP_PATH = /^\/share(?:\/|$)/;

function App() {
  const location = useLocation();
  const isSharePath = SHARE_APP_PATH.test(location.pathname);
  const { isAuthenticated, isLoading, error, user, getAccessTokenSilently } = useAuth0();
  const { currentUser, isLoadingCurrentUser, currentUserError } = useCurrentUser({
    isAuthenticated,
    getAccessTokenSilently,
  });

  useEffect(() => {
    if (error) {
      console.error('Auth0 authentication error:', error);
    }
  }, [error]);

  if (isSharePath) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <Suspense fallback={<p className="text-center text-sm text-slate-500">画面を読み込み中...</p>}>
          <Routes>
            <Route
              path="/share"
              element={<Navigate to={{ pathname: '/share/calendar', search: location.search }} replace />}
            />
            <Route path="/share/calendar" element={<SharedStudentCalendarPage />} />
            <Route
              path="/share/*"
              element={<Navigate to={{ pathname: '/share/calendar', search: location.search }} replace />}
            />
          </Routes>
        </Suspense>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-100 p-8 text-center shadow-2xl">
          <p className="text-lg font-semibold text-slate-700">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <div className="w-full max-w-lg rounded-2xl border border-rose-200/60 bg-rose-100/40 p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-rose-700">Auth Error</h1>
          <p className="mt-3 text-sm text-rose-100/90">認証に失敗しました。もう一度お試しください。</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-100 p-8 shadow-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Smile Study Calendar</h1>
          <p className="mt-3 text-sm text-slate-700">ログインしてください。</p>
          <LoginButton />
        </div>
      </div>
    );
  }

  const role = currentUser?.role ?? '-';
  return (
    <AppShell
      currentUser={currentUser}
      getAccessTokenSilently={getAccessTokenSilently}
      userName={user?.name}
      userEmail={user?.email}
      role={role}
      isLoadingCurrentUser={isLoadingCurrentUser}
      currentUserError={currentUserError}
    >
      <Suspense fallback={<p className="text-sm text-slate-500">画面を読み込み中...</p>}>
        <Routes>
          <Route path="/" element={<HomePage currentUser={currentUser} />} />
          <Route
            path="/classroom"
            element={
              <ClassroomPage
                currentUser={currentUser}
                getAccessTokenSilently={getAccessTokenSilently}
              />
            }
          />
          <Route
            path="/teachers"
            element={
              <TeacherManagementPage
                currentUser={currentUser}
                getAccessTokenSilently={getAccessTokenSilently}
              />
            }
          />
          <Route
            path="/students"
            element={
              <StudentManagementPage
                currentUser={currentUser}
                getAccessTokenSilently={getAccessTokenSilently}
              />
            }
          />
          <Route
            path="/settings/presets"
            element={
              <PresetsSettingsPage
                currentUser={currentUser}
                getAccessTokenSilently={getAccessTokenSilently}
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <CalendarPage
                currentUser={currentUser}
                getAccessTokenSilently={getAccessTokenSilently}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export default App;