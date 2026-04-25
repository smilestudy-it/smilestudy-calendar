/**
 * （責務）トップ画面。adminの場合は教室選択、それ以外はメニュー選択を提供する。
 */
import { useContext } from 'react';
import { SelectedClassroomContext } from '@/components/AppShell';
import type { CurrentUser } from '@/types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
};

export default function HomePage({ currentUser }: Props) {
  const context = useContext(SelectedClassroomContext);
  if (!context) {
    throw new Error('useSelectedClassroom must be used within AppShell');
  }
  const { activeClassroom } = context;

  const isAdmin = currentUser?.role === 'admin';

  if (isAdmin) {
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">教室を選択してください</h2>
          <p className="text-sm text-slate-400">管理する教室を選んでください。</p>
        </div>

        {activeClassroom && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-sm text-slate-300">
              教室を選択しました。左上のメニューから管理画面に移動できます。
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold md:text-xl">ホーム</h2>
      <p className="text-sm text-slate-300">
        左上のメニューから、利用したい画面を選択してください。
      </p>
      {activeClassroom ? (
        <p className="text-sm text-slate-400">現在の教室: {activeClassroom.name}</p>
      ) : (
        <p className="text-sm text-amber-200/90">教室が設定されていません。</p>
      )}
    </section>
  );
}
