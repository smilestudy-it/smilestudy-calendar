/**
 * （責務）管理画面の共通シェル。ナビ・教室切替・ユーザ情報枠と子 route の描画。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { NavLink } from 'react-router-dom';
import LogoutButton from './ui/LogoutButton';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import type { CurrentUser } from '@/types/currentUser';

type Classroom = { id: string; name: string };

type SelectedClassroomContextState = {
  selectedClassroomId: string;
  setSelectedClassroomId: Dispatch<SetStateAction<string>>;
  classrooms: Classroom[];
  activeClassroom: Classroom | undefined;
  isLoadingClassrooms: boolean;
  classroomsError: string | null;
  /** 管理者向け教室一覧 API を再取得し、ドロワーの教室切替と state を同期する */
  refreshClassrooms: () => Promise<void>;
};

const SelectedClassroomContext = createContext<SelectedClassroomContextState | null>(null);

export { SelectedClassroomContext };

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
  userName?: string;
  userEmail?: string;
  role: string;
  isLoadingCurrentUser: boolean;
  currentUserError: string | null;
  children: ReactNode;
};

export default function AppShell({
  currentUser,
  getAccessTokenSilently,
  userName,
  userEmail,
  role,
  isLoadingCurrentUser,
  currentUserError,
  children,
}: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [classroomsError, setClassroomsError] = useState<string | null>(null);
  const authedFetch = useAuthedFetch(getAccessTokenSilently);
  const isAdmin = currentUser?.role === 'admin';
  const loadAdminClassroomsSeqRef = useRef(0);

  const activeClassroom : Classroom | undefined = useMemo(() => {
    if (isAdmin) {
      return classrooms.find((v : Classroom) => v.id === selectedClassroomId);
    }else{
      return classrooms.find((v : Classroom) => v.id === currentUser?.classroomId);
    }
  }, [isAdmin, selectedClassroomId, currentUser?.classroomId, classrooms]);

  type LoadAdminClassroomsMode = 'initial' | 'sync';

  const loadAdminClassrooms = useCallback(
    async (mode: LoadAdminClassroomsMode, cancelled?: { current: boolean }) => {
      if (!isAdmin || !currentUser) {
        return;
      }

      const requestId = ++loadAdminClassroomsSeqRef.current;
      const shouldApply = () =>
        requestId === loadAdminClassroomsSeqRef.current && !cancelled?.current;

      setIsLoadingClassrooms(true);
      setClassroomsError(null);
      try {
        const res = await authedFetch('/api/classrooms');
        if (!res.ok) {
          if (shouldApply()) {
            setClassroomsError('教室一覧の取得に失敗しました。');
          }
          return;
        }
        const data = (await res.json()) as Classroom[];
        if (!shouldApply()) {
          return;
        }
        setClassrooms(data);
        if (mode === 'initial') {
          setSelectedClassroomId((prev) => (prev ? prev : data[0]?.id ?? ''));
        } else {
          setSelectedClassroomId((prev) => {
            if (prev && data.some((c) => c.id === prev)) {
              return prev;
            }
            return data[0]?.id ?? '';
          });
        }
      } catch (error) {
        if (shouldApply()) {
          console.error(error);
          setClassroomsError('教室一覧の取得に失敗しました。');
        }
      } finally {
        if (shouldApply()) {
          setIsLoadingClassrooms(false);
        }
      }
    },
    [authedFetch, currentUser, isAdmin],
  );

  const refreshClassrooms = useCallback(async () => {
    await loadAdminClassrooms('sync');
  }, [loadAdminClassrooms]);

  useEffect(() => {
    if (!isAdmin || !currentUser) {
      return;
    }

    const cancelled = { current: false };
    void loadAdminClassrooms('initial', cancelled);

    return () => {
      cancelled.current = true;
    };
  }, [loadAdminClassrooms, isAdmin, currentUser]);

  type MenuItem = {
    label: string;
    to: string;
    allowedRoles?: Array<'admin' | 'manager'>;
  };

  const filteredMenuItems = useMemo(() => {
    const menuItems: MenuItem[] = [
      { label: 'ホーム', to: '/' },
      { label: 'カレンダー', to: '/calendar' },
      { label: '生徒管理', to: '/students' },
      { label: '講師管理', to: '/teachers', allowedRoles: ['admin', 'manager'] },
      { label: 'プリセット', to: '/settings/presets', allowedRoles: ['admin', 'manager'] },
      { label: '教室管理', to: '/classroom', allowedRoles: ['admin'] },
    ];

    return menuItems.filter((item) => {
      if (!item.allowedRoles) {
        return true;
      }
      return item.allowedRoles.includes(role as 'admin' | 'manager');
    });
  }, [role]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
      isActive ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-200 hover:text-slate-900'
    }`;

  return (
    <SelectedClassroomContext.Provider
      value={{
        selectedClassroomId,
        setSelectedClassroomId,
        classrooms,
        activeClassroom,
        isLoadingClassrooms,
        classroomsError,
        refreshClassrooms,
      }}
    >
      <div className="min-h-screen bg-slate-50 text-slate-900">
        {/* Drawer Menu */}
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-300 ${
            isMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/10"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Drawer */}
          <div
            className={`absolute left-0 top-0 h-full w-80 bg-slate-100 border-r border-slate-200 transform transition-transform duration-300 ${
              isMenuOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <h2 className="text-lg font-semibold">メニュー</h2>
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-slate-200"
                  onClick={() => setIsMenuOpen(false)}
                  aria-label="メニューを閉じる"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* User Info */}
              <div className="p-6 border-b border-slate-200 space-y-2">
                <div className="text-sm text-slate-500">
                  {userName && <div>{userName}</div>}
                  {userEmail && <div>{userEmail}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs uppercase tracking-[0.2em] text-slate-700">
                    {role}
                  </span>
                  {activeClassroom && (
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs uppercase tracking-[0.2em] text-slate-700">
                      教室: {activeClassroom.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Admin Classroom Selection */}
              {isAdmin && (
                <div className="p-6 border-b border-slate-200">
                  <Label htmlFor="drawer-classroom" className="text-slate-700 mb-2 block">
                    教室切替
                  </Label>
                  <Select
                    value={selectedClassroomId}
                    onValueChange={setSelectedClassroomId}
                    disabled={isLoadingClassrooms}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingClassrooms ? '読み込み中...' : '教室を選択'} />
                    </SelectTrigger>
                    <SelectContent>
                      {classrooms.map((classroom) => (
                        <SelectItem key={classroom.id} value={classroom.id}>
                          {classroom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {classroomsError && (
                    <p className="mt-2 text-sm text-rose-600">{classroomsError}</p>
                  )}
                </div>
              )}

              {/* Navigation */}
              <nav className="p-6">
                <ul className="space-y-2">
                  {filteredMenuItems.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={navLinkClass}
                        onClick={() => setIsMenuOpen(false)}
                        end={item.to === '/'}
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* Logout */}
              <div className="p-6 border-t border-slate-200">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="px-4 py-8">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-100 p-5 shadow-2xl md:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 flex-col justify-center gap-1.5 rounded-lg border border-slate-400 bg-slate-400 px-2"
                  aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
                  aria-expanded={isMenuOpen}
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                >
                  <span className="h-0.5 w-full rounded bg-slate-200" />
                  <span className="h-0.5 w-full rounded bg-slate-200" />
                  <span className="h-0.5 w-full rounded bg-slate-200" />
                </button>
              </div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Smile Study Calendar(α版)</h1>
            </div>

            {isLoadingCurrentUser ? (
              <p className="text-sm text-slate-500">ユーザー情報を読み込み中...</p>
            ) : currentUserError ? (
              <p className="text-sm text-rose-600">{currentUserError}</p>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </SelectedClassroomContext.Provider>
  );
}
