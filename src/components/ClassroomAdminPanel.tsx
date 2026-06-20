/**
 * （責務）（管理者向け）教室名の新規登録と教室一覧表示。
 */
import { useContext, useState } from 'react';
import type { ComponentProps } from 'react';

import { SelectedClassroomContext } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { FormErrorAlert } from '@/components/ui/form-error-alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
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
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold md:text-xl">教室管理（管理者）</h2>
      </div>

      <form
        onSubmit={handleCreate}
        className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div className="space-y-2">
          <Label htmlFor={classroomNameInputId}>教室名</Label>
          <Input
            id={classroomNameInputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="教室名を入力"
            maxLength={100}
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '追加中...' : '教室を追加'}
        </Button>
      </form>

      <FormErrorAlert message={error} />
      <FormErrorAlert message={listError} />

      <Separator />

      {isLoadingClassroomsList ? (
        <p className="text-muted-foreground text-sm">教室一覧を読み込み中...</p>
      ) : (
        <ul className="space-y-2">
          {classrooms.map((room) => (
            <li
              key={room.id}
              className="border-border flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
            >
              <span>{room.name}</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete(room.id)}
              >
                削除
              </Button>
            </li>
          ))}
          {classrooms.length === 0 && (
            <li className="text-muted-foreground text-sm">
              教室がありません。
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
