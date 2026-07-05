/**
 * （責務）月次カレンダー。教室選択・月移動・コマ一覧と週編集への導線。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import MonthCalendar from '@/components/ui/full-calendar';
import LessonDeletePanel, {
  type LessonDetailTarget,
} from '@/components/ui/lesson-delete-panel';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { useSelectedClassroom } from '@/hooks/useSelectedClassroom';
import type { CurrentUser } from '@/types/currentUser';

dayjs.locale('ja');

type LessonApi = {
  id: string;
  teacherId: string;
  studentId: string;
  classroomId: string;
  subjectId: string;
  lessonTypeId: string;
  startAt: string;
  endAt: string;
  teacherDisplay: string;
  studentDisplay: string;
  subjectDisplay: string;
  lessonTypeDisplay: string;
};

type TeacherRow = {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
};

type PresetRow = { id: string; name: string };

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

function toMapById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function buildModalEventTitle(lesson: LessonApi) {
  const detailText = [lesson.subjectDisplay, lesson.lessonTypeDisplay]
    .filter((label) => label !== '（不明）')
    .join('・');
  return detailText
    ? `${lesson.teacherDisplay} - ${lesson.studentDisplay} (${detailText})`
    : `${lesson.teacherDisplay} - ${lesson.studentDisplay}`;
}

export default function CalendarPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const { activeClassroom } = useSelectedClassroom();
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [lessons, setLessons] = useState<LessonApi[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [subjects, setSubjects] = useState<PresetRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<PresetRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);

  // モーダルと編集関連のState
  const [selectedEvent, setSelectedEvent] = useState<LessonDetailTarget | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const monthStart = useMemo(
    () => dayjs(focusDate).startOf('month'),
    [focusDate],
  );
  const monthEndExclusive = useMemo(
    () => monthStart.add(1, 'month'),
    [monthStart],
  );
  const monthFromIso = useMemo(() => monthStart.toISOString(), [monthStart]);
  const monthToIso = useMemo(
    () => monthEndExclusive.toISOString(),
    [monthEndExclusive],
  );

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  // 💡 データの再取得ロジックを useCallback で共通化
  const fetchMonthData = useCallback(
    async (signal?: AbortSignal) => {
      setListError(null);
      if (!activeClassroom) {
        setLessons([]);
        setIsLoadingMonth(false);
        return;
      }
      setIsLoadingMonth(true);
      try {
        const qs = new URLSearchParams({ from: monthFromIso, to: monthToIso });
        const userQs = new URLSearchParams({ includeAdmins: '1' });
        const [lRes, uRes, subRes, ltRes] = await Promise.all([
          authedFetch(
            `/api/lessons/${encodeURIComponent(activeClassroom.id)}?${qs}`,
            { signal },
          ),
          authedFetch(
            `/api/users/${encodeURIComponent(activeClassroom.id)}?${userQs}`,
            { signal },
          ),
          authedFetch(
            `/api/subjects/${encodeURIComponent(activeClassroom.id)}`,
            { signal },
          ),
          authedFetch(
            `/api/lesson-types/${encodeURIComponent(activeClassroom.id)}`,
            { signal },
          ),
        ]);

        if (!lRes.ok) {
          setListError('コマ一覧の取得に失敗しました。');
          return;
        }

        const [lessonsJson, uJson, subJson, ltJson] = await Promise.all([
          lRes.json() as Promise<LessonApi[]>,
          uRes.ok
            ? (uRes.json() as Promise<TeacherRow[]>)
            : Promise.resolve(null),
          subRes.ok
            ? (subRes.json() as Promise<PresetRow[]>)
            : Promise.resolve(null),
          ltRes.ok
            ? (ltRes.json() as Promise<PresetRow[]>)
            : Promise.resolve(null),
        ]);

        setLessons(lessonsJson);
        setTeachers(uJson ?? []);
        setSubjects(subJson ?? []);
        setLessonTypes(ltJson ?? []);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setListError('ネットワークエラーが発生しました。');
      } finally {
        setIsLoadingMonth(false);
      }
    },
    [activeClassroom, authedFetch, monthFromIso, monthToIso],
  );

  // 初回マウント時 ＆ 月変更時にデータを取得
  useEffect(() => {
    const controller = new AbortController();
    void fetchMonthData(controller.signal);
    return () => controller.abort();
  }, [fetchMonthData]);

  const teacherById = useMemo(() => toMapById(teachers), [teachers]);

  const calendarEvents = useMemo(() => {
    return lessons.map((l) => {
      const te = teacherById.get(l.teacherId);
      const teacherLastName =
        te?.lastName?.trim() ||
        l.teacherDisplay.trim().split(/\s+/)[0] ||
        l.teacherId;
      const eventColor =
        te?.color && /^#([0-9a-fA-F]{6})$/.test(te.color)
          ? te.color
          : '#6366f1';
      return {
        id: l.id,
        title: teacherLastName,
        start: l.startAt,
        end: l.endAt,
        backgroundColor: eventColor,
        borderColor: eventColor,
        textColor: '#ffffff',
      };
    });
  }, [lessons, teacherById]);

  // 💡 パネルからの PATCH (更新) 処理
  const handleSavePresets = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    setPanelError(null);
    try {
      const res = await authedFetch(
        `/api/lessons/${encodeURIComponent(selectedEvent.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectId: selectedEvent.subjectId,
            lessonTypeId: selectedEvent.lessonTypeId,
          }),
        },
      );
      if (!res.ok) throw new Error('保存に失敗しました');

      await fetchMonthData(); // カレンダーの最新データを再取得
      setSelectedEvent(null); // モーダルを閉じる
    } catch (e: unknown) {
      setPanelError(
        e instanceof Error ? e.message : '予期せぬエラーが発生しました',
      );
    } finally {
      setIsSaving(false);
    }
  };

  // 💡 パネルからの DELETE (削除) 処理
  const handleDelete = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    setPanelError(null);
    try {
      const res = await authedFetch(
        `/api/lessons/${encodeURIComponent(selectedEvent.id)}`,
        {
          method: 'DELETE',
        },
      );
      if (!res.ok) throw new Error('削除に失敗しました');

      await fetchMonthData(); // カレンダーの最新データを再取得
      setSelectedEvent(null); // モーダルを閉じる
    } catch (e: unknown) {
      setPanelError(
        e instanceof Error ? e.message : '予期せぬエラーが発生しました',
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <p className="text-foreground text-sm">この画面にアクセスできません。</p>
    );
  }

  const isAdmin = currentUser.role === 'admin';

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">カレンダー</h2>
          {isAdmin && (
            <p className="text-muted-foreground text-sm">
              現在の教室: {activeClassroom?.name || '未選択'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link
              to={`/calendar/edit?week=${dayjs(focusDate).format('YYYY-MM-DD')}`}
            >
              編集
            </Link>
          </Button>
        </div>
      </div>

      {isAdmin && !activeClassroom && (
        <p className="text-sm text-amber-700">教室を選択してください。</p>
      )}

      {listError && <p className="text-sm text-rose-600">{listError}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-foreground text-sm">
              {monthStart.format('YYYY年M月')}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFocusDate((d) => dayjs(d).subtract(1, 'month').toDate())
                }
              >
                前の月
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusDate(() => new Date())}
              >
                今月
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFocusDate((d) => dayjs(d).add(1, 'month').toDate())
                }
              >
                次の月
              </Button>
            </div>
          </div>

          {isLoadingMonth ? (
            <p className="text-muted-foreground text-sm">
              月のコマを読み込み中...
            </p>
          ) : (
            <MonthCalendar
              focusDate={focusDate}
              events={calendarEvents}
              onFocusDateChange={setFocusDate}
              onEventClick={(event) => {
                const lesson = lessons.find((l) => l.id === event.id);
                if (!lesson) return;

                setSelectedEvent({
                  id: lesson.id,
                  title: buildModalEventTitle(lesson),
                  start: new Date(lesson.startAt),
                  end: new Date(lesson.endAt),
                  subjectId: lesson.subjectId,
                  lessonTypeId: lesson.lessonTypeId,
                  subjectDisplay: lesson.subjectDisplay,
                  lessonTypeDisplay: lesson.lessonTypeDisplay,
                });
                setPanelError(null); // 開くたびにエラーをリセット
              }}
            />
          )}
        </div>
      </div>

      {/* 💡 詳細・編集・削除用モーダル */}
      <Dialog
        open={!!selectedEvent}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      >
        <DialogContent className="max-w-xl">
          <LessonDeletePanel
            event={selectedEvent}
            isDeleting={isSaving}
            error={panelError}
            presetSubjects={subjects}
            presetLessonTypes={lessonTypes}
            isSavingPresets={isSaving}
            presetsError={panelError}
            onClose={() => setSelectedEvent(null)}
            onDelete={handleDelete}
            onSavePresets={handleSavePresets}
            onPresetChange={(next) => {
              // 選択状態を一時的にローカルStateに保持
              setSelectedEvent((prev) => (prev ? { ...prev, ...next } : null));
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
