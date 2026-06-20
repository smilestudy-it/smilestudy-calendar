/**
 * （責務）生徒一覧の取得・新規登録・削除、共有 URL コピー。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver, SubmitHandler } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FormErrorAlert } from '@/components/ui/form-error-alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';

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
      name: z
        .string()
        .trim()
        .min(1, '氏名を入力してください。')
        .max(100, '氏名は100文字以内で入力してください。'),
      email: z
        .string()
        .trim()
        .pipe(z.email('メールアドレスの形式が不正です。')),
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

export default function StudentManagementPanel({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const isAdmin = currentUser.role === 'admin';
  const canManageStudents =
    currentUser.role === 'admin' || currentUser.role === 'manager';
  const studentFormSchema = useMemo(
    () => buildStudentFormSchema(isAdmin),
    [isAdmin],
  );

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(
    currentUser.classroomId ?? '',
  );
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedShareStudentId, setCopiedShareStudentId] = useState<
    string | null
  >(null);
  const [shareCopyError, setShareCopyError] = useState<string | null>(null);
  const shareCopyFeedbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

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

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const activeClassroomId = useMemo(() => {
    return isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '');
  }, [currentUser.classroomId, isAdmin, selectedClassroomId]);

  const formClassroomId = watch('classroomId') ?? '';
  const targetClassroomIdForForm = isAdmin
    ? formClassroomId
    : (currentUser.classroomId ?? '');

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

  const handleCreateStudent: SubmitHandler<StudentFormValues> = async (
    values,
  ) => {
    const classroomId = isAdmin
      ? (values.classroomId ?? '').trim()
      : (currentUser.classroomId ?? '');
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
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
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
        classroomId: isAdmin
          ? getValues('classroomId')
          : (currentUser.classroomId ?? ''),
      });
      await loadStudentsRef.current();
    } catch {
      setError('生徒の登録に失敗しました。');
    }
  };

  const handleCopyShareLink = useCallback(async (id: string) => {
    const url = `${window.location.origin}/share/calendar?student_id=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopyError(null);
      setCopiedShareStudentId(id);
      if (shareCopyFeedbackTimerRef.current) {
        clearTimeout(shareCopyFeedbackTimerRef.current);
      }
      shareCopyFeedbackTimerRef.current = setTimeout(() => {
        setCopiedShareStudentId(null);
        shareCopyFeedbackTimerRef.current = null;
      }, 2000);
    } catch {
      setCopiedShareStudentId(null);
      setShareCopyError('共有リンクをクリップボードにコピーできませんでした。');
      if (shareCopyFeedbackTimerRef.current) {
        clearTimeout(shareCopyFeedbackTimerRef.current);
      }
      shareCopyFeedbackTimerRef.current = setTimeout(() => {
        setShareCopyError(null);
        shareCopyFeedbackTimerRef.current = null;
      }, 4000);
    }
  }, []);

  const handleDeleteStudent = async (id: string) => {
    setError(null);
    try {
      const response = await authedFetch(`/api/students/${id}`, {
        method: 'DELETE',
      });
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
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Students
        </p>
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          生徒管理
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          {canManageStudents
            ? '教室ごとに生徒を登録・一覧・削除できます。出生年はカレンダー年度の参照用として保存されます。'
            : '所属教室の生徒一覧を閲覧できます（登録・削除は教室長以上のみ）。'}
        </p>
      </header>

      <Separator />

      {canManageStudents && (
        <section className="space-y-4">
          <h3 className="text-base font-semibold">生徒を登録</h3>
          <form
            onSubmit={handleSubmit(handleCreateStudent)}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {isAdmin && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="student-classroom">所属教室</Label>
                <Select
                  value={watch('classroomId') ?? ''}
                  onValueChange={(v) => {
                    setValue('classroomId', v, { shouldValidate: true });
                    setSelectedClassroomId(v);
                  }}
                  disabled={isLoadingClassrooms}
                >
                  <SelectTrigger id="student-classroom">
                    <SelectValue placeholder="教室を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {classrooms.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.classroomId?.message && (
                  <p className="text-destructive text-sm">
                    {errors.classroomId.message}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="student-name">氏名</Label>
              <Input
                id="student-name"
                aria-label="氏名"
                {...register('name')}
                placeholder="山田 太郎"
                maxLength={100}
              />
              {errors.name?.message && (
                <p className="text-destructive text-sm">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="student-email">メールアドレス</Label>
              <Input
                id="student-email"
                type="email"
                aria-label="メールアドレス"
                {...register('email')}
                placeholder="student@example.com"
              />
              {errors.email?.message && (
                <p className="text-destructive text-sm">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="student-birth-year">出生年度（西暦）</Label>
              <Input
                id="student-birth-year"
                type="number"
                aria-label="出生年"
                min={1900}
                max={currentYear}
                {...register('birthYear', { valueAsNumber: true })}
              />
              {errors.birthYear?.message && (
                <p className="text-destructive text-sm">
                  {errors.birthYear.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={
                isSubmitting ||
                (isAdmin && !targetClassroomIdForForm) ||
                (!isAdmin && !currentUser.classroomId)
              }
              className="md:col-span-2"
            >
              {isSubmitting ? '登録中…' : '生徒を登録'}
            </Button>
          </form>
        </section>
      )}

      <FormErrorAlert message={error} />

      <Separator />

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-base font-semibold">生徒一覧</h3>
          {isAdmin && (
            <div className="w-full max-w-xs space-y-2">
              <Label htmlFor="list-classroom" className="text-xs">
                表示する教室
              </Label>
              <Select
                value={selectedClassroomId}
                onValueChange={(v) => {
                  setSelectedClassroomId(v);
                  setValue('classroomId', v, { shouldValidate: true });
                }}
                disabled={isLoadingClassrooms}
              >
                <SelectTrigger id="list-classroom">
                  <SelectValue placeholder="教室を選択" />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {isLoadingStudents ? (
          <p className="text-muted-foreground text-sm">読み込み中…</p>
        ) : !activeClassroomId ? (
          <p className="text-muted-foreground text-sm">
            {isAdmin
              ? '教室を選択すると生徒が表示されます。'
              : '所属教室が割り当てられていないため、生徒一覧を表示できません。'}
          </p>
        ) : students.length === 0 ? (
          <p className="border-border text-muted-foreground border border-dashed px-4 py-8 text-center text-sm">
            この教室に登録された生徒はまだいません。
          </p>
        ) : (
          <div className="space-y-2">
            {shareCopyError ? (
              <p className="text-sm text-amber-700" role="status">
                {shareCopyError}
              </p>
            ) : null}
            <ul className="divide-border divide-y">
              {students.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {row.email}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      出生年: {row.birthYear}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopyShareLink(row.id)}
                    >
                      {copiedShareStudentId === row.id
                        ? 'コピーしました'
                        : '共有リンクをコピー'}
                    </Button>
                    {canManageStudents && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteStudent(row.id)}
                      >
                        削除
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  );
}
