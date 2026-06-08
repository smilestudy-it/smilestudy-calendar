/**
 * （責務）講師の一覧・招待（作成）と管理者一覧。教室長以上向け操作。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { SubmitHandler } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { User } from '@/../../shared/type';
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

type Props = {
  currentUser: CurrentUser;
  getAccessTokenSilently: () => Promise<string>;
};

const defaultColor = '#3b82f6';
const inviteFormSchema = z
  .object({
    role: z.enum(['admin', 'manager', 'staff']),
    classroomId: z.string().trim().optional(),
    firstName: z
      .string()
      .trim()
      .min(1, '名を入力してください。')
      .max(100, '名は100文字以内で入力してください。'),
    lastName: z
      .string()
      .trim()
      .min(1, '姓を入力してください。')
      .max(100, '姓は100文字以内で入力してください。'),
    email: z.string().trim().pipe(z.email('メールアドレスの形式が不正です。')),
    color: z
      .string()
      .trim()
      .regex(/^#(?:[0-9a-fA-F]{6})$/, 'カラーコードが不正です。'),
  })
  .superRefine((value, ctx) => {
    if (value.role !== 'admin' && !value.classroomId) {
      ctx.addIssue({
        code: 'custom',
        path: ['classroomId'],
        message: '所属教室を選択してください。',
      });
    }
  });

type InviteFormValues = z.infer<typeof inviteFormSchema>;

export default function TeacherManagementPanel({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const isAdmin = currentUser.role === 'admin';
  const canListAdmins =
    currentUser.role === 'admin' || currentUser.role === 'manager';
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(
    currentUser.classroomId ?? '',
  );
  const [users, setUsers] = useState<User[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestLoadUsersRequestId = useRef(0);
  const latestLoadAdminsRequestId = useRef(0);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: {
      role: 'staff',
      classroomId: currentUser.classroomId ?? '',
      firstName: '',
      lastName: '',
      email: '',
      color: defaultColor,
    },
  });

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const activeClassroomId = useMemo(() => {
    return isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '');
  }, [currentUser.classroomId, isAdmin, selectedClassroomId]);
  const inviteRole = watch('role');
  const inviteClassroomId = watch('classroomId') ?? '';
  const requiresClassroom = inviteRole !== 'admin';
  const inviteTargetClassroomId = isAdmin
    ? inviteClassroomId
    : activeClassroomId;

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
      if (!selectedClassroomId && data.length > 0) {
        setSelectedClassroomId(data[0]?.id ?? '');
      }
      if (!getValues('classroomId') && data.length > 0) {
        setValue('classroomId', data[0]?.id ?? '', { shouldValidate: true });
      }
    } catch {
      setError('教室一覧の取得に失敗しました。');
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [authedFetch, getValues, isAdmin, selectedClassroomId, setValue]);

  const loadUsers = useCallback(async () => {
    latestLoadUsersRequestId.current += 1;
    const requestId = latestLoadUsersRequestId.current;

    if (!activeClassroomId) {
      if (requestId === latestLoadUsersRequestId.current) {
        setUsers([]);
      }
      return;
    }

    setIsLoadingUsers(true);
    try {
      const response = await authedFetch(`/api/users/${activeClassroomId}`);
      if (!response.ok) {
        if (requestId === latestLoadUsersRequestId.current) {
          setError(
            response.status === 403
              ? 'この教室の講師一覧を表示する権限がありません。'
              : '講師一覧の取得に失敗しました。',
          );
        }
        return;
      }
      const data = (await response.json()) as User[];
      if (requestId === latestLoadUsersRequestId.current) {
        setError(null);
        setUsers(data);
      }
    } catch {
      if (requestId === latestLoadUsersRequestId.current) {
        setError('講師一覧の取得に失敗しました。');
      }
    } finally {
      if (requestId === latestLoadUsersRequestId.current) {
        setIsLoadingUsers(false);
      }
    }
  }, [activeClassroomId, authedFetch]);

  const loadAdmins = useCallback(async () => {
    latestLoadAdminsRequestId.current += 1;
    const requestId = latestLoadAdminsRequestId.current;

    if (!canListAdmins) {
      if (requestId === latestLoadAdminsRequestId.current) {
        setAdminUsers([]);
      }
      return;
    }

    setIsLoadingAdmins(true);
    try {
      const response = await authedFetch('/api/users/admins');
      if (!response.ok) {
        if (requestId === latestLoadAdminsRequestId.current) {
          setError(
            response.status === 403
              ? '管理者一覧を表示する権限がありません。'
              : '管理者一覧の取得に失敗しました。',
          );
        }
        return;
      }
      const data = (await response.json()) as User[];
      if (requestId === latestLoadAdminsRequestId.current) {
        setError(null);
        setAdminUsers(data);
      }
    } catch {
      if (requestId === latestLoadAdminsRequestId.current) {
        setError('管理者一覧の取得に失敗しました。');
      }
    } finally {
      if (requestId === latestLoadAdminsRequestId.current) {
        setIsLoadingAdmins(false);
      }
    }
  }, [canListAdmins, authedFetch]);

  const loadUsersRef = useRef(loadUsers);
  const loadAdminsRef = useRef(loadAdmins);
  useEffect(() => {
    loadUsersRef.current = loadUsers;
    loadAdminsRef.current = loadAdmins;
  }, [loadUsers, loadAdmins]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  const handleInvite: SubmitHandler<InviteFormValues> = async (values) => {
    if (requiresClassroom && !inviteTargetClassroomId) {
      setError('対象教室を選択してください。');
      return;
    }
    setError(null);
    try {
      const response = await authedFetch('/api/users', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          classroomId: requiresClassroom ? inviteTargetClassroomId : null,
          role: values.role,
          color: values.color,
        }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError('同じメールアドレスの講師がすでに存在します。');
          return;
        }
        setError('講師招待に失敗しました。');
        return;
      }

      reset({
        role: 'staff',
        classroomId: isAdmin
          ? getValues('classroomId')
          : (currentUser.classroomId ?? ''),
        firstName: '',
        lastName: '',
        email: '',
        color: defaultColor,
      });
      await loadUsersRef.current();
      await loadAdminsRef.current();
    } catch {
      setError('講師招待に失敗しました。');
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const response = await authedFetch(`/api/users/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        if (response.status === 403) {
          setError(
            'このユーザーを削除する権限がないか、自分自身は削除できません。',
          );
        } else {
          setError('ユーザー削除に失敗しました。');
        }
        return;
      }
      await loadUsersRef.current();
      await loadAdminsRef.current();
    } catch {
      setError('ユーザー削除に失敗しました。');
    }
  };

  return (
    <section className="space-y-8">
      <h2 className="text-lg font-semibold md:text-xl">
        講師管理（教室長以上）
      </h2>

      <section className="space-y-4">
        <h3 className="text-base font-semibold">講師招待</h3>
        <form
          onSubmit={handleSubmit(handleInvite)}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="invite-role">権限</Label>
            <Select
              value={watch('role')}
              onValueChange={(v) =>
                setValue('role', v as InviteFormValues['role'], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="権限を選択" />
              </SelectTrigger>
              <SelectContent>
                {isAdmin && <SelectItem value="admin">管理者</SelectItem>}
                <SelectItem value="manager">教室長</SelectItem>
                <SelectItem value="staff">講師</SelectItem>
              </SelectContent>
            </Select>
            {errors.role?.message && (
              <p className="text-sm text-destructive">{errors.role.message}</p>
            )}
          </div>

          {isAdmin && requiresClassroom && (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="invite-classroom">所属教室</Label>
              <Select
                value={watch('classroomId') ?? ''}
                onValueChange={(v) =>
                  setValue('classroomId', v, { shouldValidate: true })
                }
                disabled={isLoadingClassrooms}
              >
                <SelectTrigger id="invite-classroom">
                  <SelectValue placeholder="教室を選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.map((classroom) => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.classroomId?.message && (
                <p className="text-sm text-destructive">
                  {errors.classroomId.message}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="invite-last-name">姓</Label>
            <Input
              id="invite-last-name"
              aria-label="姓"
              {...register('lastName')}
              placeholder="姓"
              maxLength={100}
            />
            {errors.lastName?.message && (
              <p className="text-sm text-destructive">
                {errors.lastName.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-first-name">名</Label>
            <Input
              id="invite-first-name"
              aria-label="名"
              {...register('firstName')}
              placeholder="名"
              maxLength={100}
            />
            {errors.firstName?.message && (
              <p className="text-sm text-destructive">
                {errors.firstName.message}
              </p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="invite-email">メールアドレス</Label>
            <Input
              id="invite-email"
              aria-label="メールアドレス"
              type="email"
              {...register('email')}
              placeholder="email@example.com"
            />
            {errors.email?.message && (
              <p className="text-sm text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="invite-color">表示カラー</Label>
            <Input
              id="invite-color"
              aria-label="表示カラー"
              type="color"
              {...register('color')}
              className="h-10 w-full p-1"
            />
            {errors.color?.message && (
              <p className="text-sm text-destructive">
                {errors.color.message}
              </p>
            )}
          </div>
          <Button
            type="submit"
            className="md:col-span-2"
            disabled={
              isSubmitting || (requiresClassroom && !inviteTargetClassroomId)
            }
          >
            {isSubmitting ? '招待中...' : '講師を招待する'}
          </Button>
        </form>
      </section>

      <FormErrorAlert message={error} />

      {canListAdmins && (
        <>
          <Separator />
          <section className="space-y-4">
            <h3 className="text-base font-semibold">管理者一覧</h3>
            {isLoadingAdmins ? (
              <p className="text-sm text-muted-foreground">
                管理者一覧を読み込み中...
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {adminUsers.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="space-y-0.5 text-sm">
                      <p className="font-medium">
                        {row.lastName} {row.firstName}
                      </p>
                      <p className="text-muted-foreground">{row.email}</p>
                      <p className="text-xs text-muted-foreground">
                        role: {row.role}
                      </p>
                    </div>
                    {isAdmin && row.id !== currentUser.id && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDelete(row.id)}
                      >
                        削除
                      </Button>
                    )}
                  </li>
                ))}
                {adminUsers.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    管理者がいません。
                  </li>
                )}
              </ul>
            )}
          </section>
        </>
      )}

      <Separator />

      <section className="space-y-4">
        <h3 className="text-base font-semibold">講師一覧・削除</h3>
        {isAdmin && (
          <div className="max-w-md space-y-2">
            <Label htmlFor="target-classroom">一覧対象教室</Label>
            <Select
              value={selectedClassroomId}
              onValueChange={setSelectedClassroomId}
              disabled={isLoadingClassrooms}
            >
              <SelectTrigger id="target-classroom">
                <SelectValue placeholder="教室を選択してください" />
              </SelectTrigger>
              <SelectContent>
                {classrooms.map((classroom) => (
                  <SelectItem key={classroom.id} value={classroom.id}>
                    {classroom.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {isLoadingUsers ? (
          <p className="text-sm text-muted-foreground">
            講師一覧を読み込み中...
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">
                    {row.lastName} {row.firstName}
                  </p>
                  <p className="text-muted-foreground">{row.email}</p>
                  <p className="text-xs text-muted-foreground">
                    role: {row.role}
                  </p>
                </div>
                {row.id !== currentUser.id && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDelete(row.id)}
                  >
                    削除
                  </Button>
                )}
              </li>
            ))}
            {users.length === 0 && (
              <li className="text-sm text-muted-foreground">
                講師がいません。
              </li>
            )}
          </ul>
        )}
      </section>
    </section>
  );
}
