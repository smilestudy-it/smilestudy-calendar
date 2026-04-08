import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Resolver, SubmitHandler } from 'react-hook-form';
import type { CurrentUser } from '../types/currentUser';

type Classroom = {
  id: string;
  name: string;
};

type StudentRow = {
  id: string;
  name: string;
  email: string;
  birthYear: number;
};

type Props = {
  currentUser: CurrentUser;
  getAccessTokenSilently: () => Promise<string>;
};

const currentYear = new Date().getFullYear();

function buildStudentFormSchema(isAdmin: boolean) {
  return z
    .object({
      name: z.string().trim().min(1, '氏名を入力してください。').max(100, '氏名は100文字以内で入力してください。'),
      email: z.string().trim().pipe(z.email('メールアドレスの形式が不正です。')),
      birthYear: z.coerce
        .number({ message: '出生年を入力してください。' })
        .int('出生年は整数で入力してください。')
        .min(1900, '出生年が不正です。')
        .max(currentYear, '出生年が不正です。'),
      classroomId: z.string().trim().optional(),
    })
    .superRefine((value, ctx) => {
      if (isAdmin && (!value.classroomId || !value.classroomId.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['classroomId'],
          message: '所属教室を選択してください。',
        });
      }
    });
}

type StudentFormValues = z.infer<ReturnType<typeof buildStudentFormSchema>>;

export default function StudentManagementPanel({ currentUser, getAccessTokenSilently }: Props) {
  const isAdmin = currentUser.role === 'admin';
  const canManageStudents = currentUser.role === 'admin' || currentUser.role === 'manager';
  const studentFormSchema = useMemo(() => buildStudentFormSchema(isAdmin), [isAdmin]);

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(currentUser.classroomId ?? '');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestLoadStudentsRequestId = useRef(0);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema) as Resolver<StudentFormValues>,
    defaultValues: {
      name: '',
      email: '',
      birthYear: currentYear - 10,
      classroomId: currentUser.classroomId ?? '',
    },
  });

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessTokenSilently();
      return fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessTokenSilently],
  );

  const activeClassroomId = useMemo(() => {
    return isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '');
  }, [currentUser.classroomId, isAdmin, selectedClassroomId]);

  const formClassroomId = watch('classroomId') ?? '';
  const targetClassroomIdForForm = isAdmin ? formClassroomId : (currentUser.classroomId ?? '');

  const loadClassrooms = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setIsLoadingClassrooms(true);
    try {
      const response = await authedFetch('/api/classrooms');
      if (!response.ok) {
        setError('教室一覧の取得に失敗しました。');
        return;
      }
      const data = (await response.json()) as Classroom[];
      setClassrooms(data);
      const formClassroomId = (getValues('classroomId') ?? '').trim();
      if (data.length > 0 && !formClassroomId) {
        const firstId = data[0]?.id ?? '';
        setSelectedClassroomId(firstId);
        setValue('classroomId', firstId, { shouldValidate: true });
      }
    } catch {
      setError('教室一覧の取得に失敗しました。');
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [authedFetch, getValues, isAdmin, setValue]);

  const loadStudents = useCallback(async () => {
    latestLoadStudentsRequestId.current += 1;
    const requestId = latestLoadStudentsRequestId.current;

    if (!activeClassroomId) {
      if (requestId === latestLoadStudentsRequestId.current) {
        setIsLoadingStudents(false);
        setStudents([]);
      }
      return;
    }

    setIsLoadingStudents(true);
    try {
      const response = await authedFetch(`/api/students/${activeClassroomId}`);
      if (!response.ok) {
        if (requestId === latestLoadStudentsRequestId.current) {
          setStudents([]);
          setError(
            response.status === 403
              ? 'この教室の生徒一覧を表示する権限がありません。'
              : '生徒一覧の取得に失敗しました。',
          );
        }
        return;
      }
      const data = (await response.json()) as StudentRow[];
      if (requestId === latestLoadStudentsRequestId.current) {
        setError(null);
        setStudents(data);
      }
    } catch {
      if (requestId === latestLoadStudentsRequestId.current) {
        setStudents([]);
        setError('生徒一覧の取得に失敗しました。');
      }
    } finally {
      if (requestId === latestLoadStudentsRequestId.current) {
        setIsLoadingStudents(false);
      }
    }
  }, [activeClassroomId, authedFetch]);

  const loadStudentsRef = useRef(loadStudents);
  useEffect(() => {
    loadStudentsRef.current = loadStudents;
  }, [loadStudents]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const handleCreateStudent: SubmitHandler<StudentFormValues> = async (values) => {
    const classroomId = isAdmin ? (values.classroomId ?? '').trim() : (currentUser.classroomId ?? '');
    if (!classroomId) {
      setError('所属教室を選択してください。');
      return;
    }
    setError(null);
    const birthYear =
      typeof values.birthYear === 'number' && Number.isFinite(values.birthYear)
        ? Math.trunc(values.birthYear)
        : currentYear - 10;
    try {
      const response = await authedFetch('/api/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          birthYear,
          classroomId,
        }),
      });

      if (!response.ok) {
        if (response.status === 403) {
          setError('この教室に生徒を登録する権限がありません。');
        } else if (response.status === 404) {
          setError('教室が見つかりません。');
        } else {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          const msg = body.message;
          if (msg === 'invalid request') {
            setError('入力内容を確認してください。');
          } else if (msg === 'failed to create student') {
            setError(
              'データベースへの保存に失敗しました。ローカル D1 のマイグレーションがすべて適用されているか確認してください。',
            );
          } else if (msg) {
            setError(`生徒の登録に失敗しました: ${msg}`);
          } else {
            setError('生徒の登録に失敗しました。');
          }
        }
        return;
      }

      reset({
        name: '',
        email: '',
        birthYear: currentYear - 10,
        classroomId: isAdmin ? getValues('classroomId') : (currentUser.classroomId ?? ''),
      });
      await loadStudentsRef.current();
    } catch {
      setError('生徒の登録に失敗しました。');
    }
  };

  const handleDeleteStudent = async (id: string) => {
    setError(null);
    try {
      const response = await authedFetch(`/api/students/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        if (response.status === 403) {
          setError('この生徒を削除する権限がありません。');
        } else {
          setError('生徒の削除に失敗しました。');
        }
        return;
      }
      await loadStudentsRef.current();
    } catch {
      setError('生徒の削除に失敗しました。');
    }
  };

  return (
    <section className="space-y-8">
      <header className="space-y-2 border-b border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">Students</p>
        <h2 className="text-xl font-bold tracking-tight text-slate-50 md:text-2xl">生徒管理</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          {canManageStudents
            ? '教室ごとに生徒を登録・一覧・削除できます。出生年はカレンダー年度の参照用として保存されます。'
            : '所属教室の生徒一覧を閲覧できます（登録・削除は教室長以上のみ）。'}
        </p>
      </header>

      {canManageStudents && (
      <section className="space-y-4 rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-4 shadow-lg ring-1 ring-emerald-500/10 md:p-5">
        <h3 className="text-base font-semibold text-slate-100">生徒を登録</h3>
        <form onSubmit={handleSubmit(handleCreateStudent)} className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {isAdmin && (
            <div className="md:col-span-2">
              <label htmlFor="student-classroom" className="mb-1 block text-sm text-slate-300">
                所属教室
              </label>
              <select
                id="student-classroom"
                aria-label="登録先の所属教室"
                {...register('classroomId', {
                  onChange: (e) => setSelectedClassroomId(e.target.value),
                })}
                disabled={isLoadingClassrooms}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-slate-100 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
              >
                <option value="">教室を選択</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.classroomId?.message && (
                <p className="mt-1 text-sm text-rose-300">{errors.classroomId.message}</p>
              )}
            </div>
          )}

          <div className="md:col-span-2">
            <label htmlFor="student-name" className="mb-1 block text-sm text-slate-300">
              氏名
            </label>
            <input
              id="student-name"
              aria-label="氏名"
              {...register('name')}
              placeholder="山田 太郎"
              maxLength={100}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            />
            {errors.name?.message && <p className="mt-1 text-sm text-rose-300">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="student-email" className="mb-1 block text-sm text-slate-300">
              メールアドレス
            </label>
            <input
              id="student-email"
              type="email"
              aria-label="メールアドレス"
              {...register('email')}
              placeholder="student@example.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            />
            {errors.email?.message && <p className="mt-1 text-sm text-rose-300">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="student-birth-year" className="mb-1 block text-sm text-slate-300">
              出生年度（西暦）
            </label>
            <input
              id="student-birth-year"
              type="number"
              aria-label="出生年"
              min={1900}
              max={currentYear}
              {...register('birthYear', { valueAsNumber: true })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-slate-100 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            />
            {errors.birthYear?.message && (
              <p className="mt-1 text-sm text-rose-300">{errors.birthYear.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              isSubmitting ||
              (isAdmin && !targetClassroomIdForForm) ||
              (!isAdmin && !currentUser.classroomId)
            }
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2"
          >
            {isSubmitting ? '登録中…' : '生徒を登録'}
          </button>
        </form>
      </section>
      )}

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200" role="alert">
          {error}
        </p>
      )}

      <section className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 md:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-base font-semibold text-slate-100">生徒一覧</h3>
          {isAdmin && (
            <div className="w-full max-w-xs space-y-1">
              <label htmlFor="list-classroom" className="text-xs text-slate-400">
                表示する教室
              </label>
              <select
                id="list-classroom"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                value={selectedClassroomId}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedClassroomId(v);
                  setValue('classroomId', v, { shouldValidate: true });
                }}
                disabled={isLoadingClassrooms}
              >
                <option value="">教室を選択</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isLoadingStudents ? (
          <p className="text-sm text-slate-400">読み込み中…</p>
        ) : !activeClassroomId ? (
          <p className="text-sm text-slate-500">
            {isAdmin
              ? '教室を選択すると生徒が表示されます。'
              : '所属教室が割り当てられていないため、生徒一覧を表示できません。'}
          </p>
        ) : students.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
            この教室に登録された生徒はまだいません。
          </p>
        ) : (
          <ul className="space-y-2">
            {students.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-slate-100">{row.name}</p>
                  <p className="truncate text-sm text-slate-400">{row.email}</p>
                  <p className="text-xs text-slate-500">出生年: {row.birthYear}</p>
                </div>
                {canManageStudents && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-900/60"
                    onClick={() => void handleDeleteStudent(row.id)}
                  >
                    削除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
