/**
 * （責務）教室ごとの休業日の追加・一覧・削除。管理者は教室選択、教室長は自教室のみ。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { FormErrorAlert } from '@/components/FormErrorAlert';
import {
  presetMutationNetworkError,
  readPresetApiError,
} from '@/components/presets/presetFormUtils';
import { Button } from '@/components/ui/button';
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
import type { ClassroomListItem, HolidayListItem } from '@/types/api';
import type { CurrentUser } from '@/types/currentUser';

dayjs.locale('ja');

type Props = {
  currentUser: CurrentUser;
  getAccessTokenSilently: () => Promise<string>;
};

function formatHolidayLabel(isoDate: string): string {
  const d = dayjs(isoDate);
  if (!d.isValid()) {
    return isoDate;
  }
  return d.format('YYYY年M月D日（ddd）');
}

export default function HolidaySettingsPanel({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const isAdmin = currentUser.role === 'admin';

  const [classrooms, setClassrooms] = useState<ClassroomListItem[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState(
    currentUser.classroomId ?? '',
  );
  const [holidays, setHolidays] = useState<HolidayListItem[]>([]);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [isLoadingHolidays, setIsLoadingHolidays] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [pendingDelete, setPendingDelete] = useState<HolidayListItem | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const activeClassroomId = useMemo(
    () => (isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '')),
    [currentUser.classroomId, isAdmin, selectedClassroomId],
  );
  const activeClassroomIdRef = useRef(activeClassroomId);
  const loadGen = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const sortedHolidays = useMemo(
    () =>
      [...holidays].sort((a, b) =>
        a.date.localeCompare(b.date, 'en', {
          numeric: true,
        }),
      ),
    [holidays],
  );

  const loadClassrooms = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setIsLoadingClassrooms(true);
    try {
      const res = await authedFetch('/api/classrooms');
      if (!res.ok) {
        setError('教室一覧の取得に失敗しました。');
        return;
      }
      const data = (await res.json()) as ClassroomListItem[];
      setClassrooms(data);
      setSelectedClassroomId((prev) => (prev ? prev : (data[0]?.id ?? '')));
    } catch {
      setError('教室一覧の取得に失敗しました。');
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [authedFetch, isAdmin]);

  const loadHolidays = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    const gen = ++loadGen.current;
    const classroomAtStart = activeClassroomIdRef.current;

    if (!classroomAtStart) {
      setHolidays([]);
      setIsLoadingHolidays(false);
      return;
    }

    setIsLoadingHolidays(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/api/holidays/${encodeURIComponent(classroomAtStart)}`,
        { signal: ac.signal },
      );
      if (gen !== loadGen.current || ac.signal.aborted) {
        return;
      }
      if (!res.ok) {
        setError('休業日一覧の取得に失敗しました。');
        setHolidays([]);
        return;
      }
      const data = (await res.json()) as HolidayListItem[];
      setHolidays(data);
    } catch (e) {
      if (gen !== loadGen.current || ac.signal.aborted) {
        return;
      }
      setError(presetMutationNetworkError('休業日一覧の取得に失敗しました', e));
      setHolidays([]);
    } finally {
      if (gen === loadGen.current) {
        setIsLoadingHolidays(false);
      }
    }
  }, [authedFetch]);

  useEffect(() => {
    activeClassroomIdRef.current = activeClassroomId;
  }, [activeClassroomId]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    void loadHolidays();
  }, [activeClassroomId, loadHolidays]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClassroomId) {
      return;
    }
    if (!newDate) {
      setError('日付を入力してください。');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await authedFetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroomId: activeClassroomId,
          date: newDate,
        }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '休業日の追加に失敗しました',
            invalidRequestHint: '日付の入力を確認してください。',
          }),
        );
        return;
      }
      await loadHolidays();
    } catch (err) {
      setError(presetMutationNetworkError('休業日の追加に失敗しました', err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/api/holidays/${encodeURIComponent(pendingDelete.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '休業日の削除に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      setPendingDelete(null);
      await loadHolidays();
    } catch (err) {
      setError(presetMutationNetworkError('休業日の削除に失敗しました', err));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isAdmin && !currentUser.classroomId) {
    return (
      <p className="text-muted-foreground text-sm">
        所属教室が割り当てられていないため、休業日を設定できません。
      </p>
    );
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Holidays
        </p>
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">休業日</h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          教室ごとの休業日を登録します。ここで登録した日付はカレンダー等で休業日として扱えます。
        </p>
      </header>

      {isAdmin && (
        <div className="max-w-md space-y-2">
          <Label htmlFor="holiday-classroom">対象教室</Label>
          <Select
            value={selectedClassroomId}
            onValueChange={setSelectedClassroomId}
            disabled={isLoadingClassrooms}
          >
            <SelectTrigger id="holiday-classroom">
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

      <FormErrorAlert message={pendingDelete ? null : error} />

      {!activeClassroomId ? (
        <p className="text-muted-foreground text-sm">
          教室を選択すると休業日を編集できます。
        </p>
      ) : isLoadingHolidays ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleAdd(e)}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="min-w-[12rem] space-y-2">
              <Label htmlFor="new-holiday-date">追加する日付</Label>
              <Input
                id="new-holiday-date"
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '追加中...' : '追加'}
            </Button>
          </form>

          <Separator />

          <ul className="space-y-2">
            {sortedHolidays.map((row) => (
              <li
                key={row.id}
                className="border-border flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <span className="text-sm">{formatHolidayLabel(row.date)}</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setPendingDelete(row);
                  }}
                >
                  削除
                </Button>
              </li>
            ))}
            {sortedHolidays.length === 0 && (
              <li className="text-muted-foreground text-sm">
                休業日がまだありません。
              </li>
            )}
          </ul>
        </div>
      )}

      <ConfirmDeleteDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setError(null);
          }
        }}
        title="休業日を削除しますか？"
        description={
          pendingDelete
            ? `「${formatHolidayLabel(pendingDelete.date)}」を削除します。この操作は取り消せません。`
            : undefined
        }
        error={pendingDelete ? error : null}
        isConfirming={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}
