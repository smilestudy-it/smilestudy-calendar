import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps } from 'react';

type Classroom = {
  id: string;
  name: string;
};

type Props = {
  getAccessTokenSilently: () => Promise<string>;
};

type FormSubmitHandler = NonNullable<ComponentProps<'form'>['onSubmit']>;

export default function ClassroomAdminPanel({ getAccessTokenSilently }: Props) {
  const classroomNameInputId = 'classroom-name';
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getAccessTokenSilently();
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  }, [getAccessTokenSilently]);

  const loadClassrooms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authedFetch('/api/classrooms');
      if (!response.ok) {
        setError('教室一覧の取得に失敗しました。');
        return;
      }
      const data = (await response.json()) as Classroom[];
      setClassrooms(data);
    } catch {
      setError('教室一覧の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

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
      await loadClassrooms();
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
      await loadClassrooms();
    } catch {
      setError('教室の削除に失敗しました。');
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold md:text-xl">教室管理（管理者）</h2>

      <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={classroomNameInputId} className="text-sm text-slate-300">
            教室名
          </label>
          <input
            id={classroomNameInputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="教室名を入力"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            maxLength={100}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? '追加中...' : '教室を追加'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-400">教室一覧を読み込み中...</p>
      ) : (
        <ul className="space-y-2">
          {classrooms.map((room) => (
            <li
              key={room.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
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
          {classrooms.length === 0 && <li className="text-sm text-slate-400">教室がありません。</li>}
        </ul>
      )}
    </section>
  );
}
