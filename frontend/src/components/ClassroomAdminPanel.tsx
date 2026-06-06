/**
 * （責務）（管理者向け）教室名の新規登録と教室一覧表示。
 */
import { useContext, useState } from 'react';
import type { ComponentProps } from 'react';

import { SelectedClassroomContext } from '@/components/AppShell';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';

type Props = {
  getAccessTokenSilently: () => Promise<string>;
};

type FormSubmitHandler = NonNullable<ComponentProps<'form'>['onSubmit']>;

export default function ClassroomAdminPanel({ getAccessTokenSilently }: Props) {
  const classroomNameInputId = 'classroom-name';
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shellClassroom = useContext(SelectedClassroomContext);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const classrooms = shellClassroom?.classrooms ?? [];
  const isLoadingClassroomsList = shellClassroom?.isLoadingClassrooms ?? false;
  const listError = shellClassroom?.classroomsError ?? null;

  const handleCreate: FormSubmitHandler = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('教室名を入力してください。');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await authedFetch('/api/classrooms', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) {
        setError('教室の追加に失敗しました。');
        return;
      }

      setName('');
      await shellClassroom?.refreshClassrooms();
    } catch {
      setError('教室の追加に失敗しました。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const response = await authedFetch(`/api/classrooms/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        setError('教室の削除に失敗しました。');
        return;
      }
      await shellClassroom?.refreshClassrooms();
    } catch {
      setError('教室の削除に失敗しました。');
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold md:text-xl">教室管理（管理者）</h2>

      <form
        onSubmit={handleCreate}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div className="space-y-1">
          <label
            htmlFor={classroomNameInputId}
            className="text-sm text-slate-700"
          >
            教室名
          </label>
          <input
            id={classroomNameInputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="教室名を入力"
            className="w-full rounded-lg border border-slate-200 bg-slate-200 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none"
            maxLength={100}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? '追加中...' : '教室を追加'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {listError && <p className="text-sm text-rose-600">{listError}</p>}

      {isLoadingClassroomsList ? (
        <p className="text-sm text-slate-500">教室一覧を読み込み中...</p>
      ) : (
        <ul className="space-y-2">
          {classrooms.map((room) => (
            <li
              key={room.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
            >
              <span>{room.name}</span>
              <button
                type="button"
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-400"
                onClick={() => void handleDelete(room.id)}
              >
                削除
              </button>
            </li>
          ))}
          {classrooms.length === 0 && (
            <li className="text-sm text-slate-500">教室がありません。</li>
          )}
        </ul>
      )}
    </section>
  );
}
