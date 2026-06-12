/**
 * （責務）管理画面の共通シェル。ナビ・教室切替・ユーザ情報枠と子 route の描画。
 */
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink } from 'react-router-dom';

import { Menu } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ROLE_LABEL_JA } from '@/constants/roles';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import type { CurrentUser } from '@/types/currentUser';
import type { AppRole } from '@/types/role';

import LogoutButton from './ui/LogoutButton';

type Classroom = { id: string; name: string };

type SelectedClassroomContextState = {
  selectedClassroomId: string;
  setSelectedClassroomId: Dispatch<SetStateAction<string>>;
  classrooms: Classroom[];
  activeClassroom: Classroom | undefined;
  isLoadingClassrooms: boolean;
  classroomsError: string | null;
  refreshClassrooms: () => Promise<void>;
};

const SelectedClassroomContext =
  createContext<SelectedClassroomContextState | null>(null);

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

  const activeClassroom: Classroom | undefined = useMemo(() => {
    if (isAdmin) {
      return classrooms.find((v: Classroom) => v.id === selectedClassroomId);
    }
    return classrooms.find((v: Classroom) => v.id === currentUser?.classroomId);
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
          setSelectedClassroomId((prev) => (prev ? prev : (data[0]?.id ?? '')));
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
      {
        label: '講師管理',
        to: '/teachers',
        allowedRoles: ['admin', 'manager'],
      },
      {
        label: 'プリセット',
        to: '/settings/presets',
        allowedRoles: ['admin', 'manager'],
      },
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
    `block rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

  const roleLabel =
    role in ROLE_LABEL_JA ? ROLE_LABEL_JA[role as AppRole] : role;

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
      <div className="bg-background text-foreground min-h-screen">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(true)}
            >
              <Menu />
            </Button>
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              Smile Study Calendar(α版)
            </h1>
            <div className="w-9" aria-hidden />
          </div>

          {isLoadingCurrentUser ? (
            <p className="text-muted-foreground text-sm">
              ユーザー情報を読み込み中...
            </p>
          ) : currentUserError ? (
            <Alert variant="destructive">
              <AlertDescription>{currentUserError}</AlertDescription>
            </Alert>
          ) : (
            children
          )}
        </div>

        <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <SheetContent side="left" className="w-80 gap-0 p-0">
            <SheetHeader className="border-border border-b p-6 text-left">
              <SheetTitle>メニュー</SheetTitle>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="space-y-2 p-6">
                <div className="text-muted-foreground text-sm">
                  {userName && <div>{userName}</div>}
                  {userEmail && <div>{userEmail}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{roleLabel}</Badge>
                  {activeClassroom && (
                    <Badge variant="outline">
                      教室: {activeClassroom.name}
                    </Badge>
                  )}
                </div>
              </div>

              {isAdmin && (
                <>
                  <Separator />
                  <div className="space-y-2 p-6">
                    <Label htmlFor="drawer-classroom">教室切替</Label>
                    <Select
                      value={selectedClassroomId}
                      onValueChange={setSelectedClassroomId}
                      disabled={isLoadingClassrooms}
                    >
                      <SelectTrigger id="drawer-classroom">
                        <SelectValue
                          placeholder={
                            isLoadingClassrooms ? '読み込み中...' : '教室を選択'
                          }
                        />
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
                      <Alert variant="destructive" className="mt-2">
                        <AlertDescription>{classroomsError}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </>
              )}

              <Separator />

              <nav className="p-6">
                <ul className="space-y-1">
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

              <Separator />

              <div className="mt-auto p-6">
                <LogoutButton />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </SelectedClassroomContext.Provider>
  );
}
