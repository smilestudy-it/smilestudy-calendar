/**
 * （責務）管理画面の共通シェル。ナビ・ユーザ情報枠と子 route の描画。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import LogoutButton from '../LogoutButton';

type Props = {
  userName?: string;
  userEmail?: string;
  role: string;
  classroomId: string;
  isLoadingCurrentUser: boolean;
  currentUserError: string | null;
  children: ReactNode;
};

export default function AppShell({
  isLoadingCurrentUser,
  currentUserError,
  children,
}: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl md:p-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Smile Study Calendar</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-10 w-10 flex-col justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 md:hidden"
              aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((prev) => !prev)}
            >
              <span className="h-0.5 w-full rounded bg-slate-200" />
              <span className="h-0.5 w-full rounded bg-slate-200" />
              <span className="h-0.5 w-full rounded bg-slate-200" />
            </button>
            <LogoutButton />
          </div>
        </div>

        {isLoadingCurrentUser && <p className="text-sm text-slate-400">ユーザー情報を読み込み中...</p>}
        {currentUserError && <p className="text-sm text-rose-300">{currentUserError}</p>}

        {children}
      </div>
    </div>
  );
}
