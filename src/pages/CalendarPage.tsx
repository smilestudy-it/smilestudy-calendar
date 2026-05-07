/**
 * （責務）月次カレンダー。教室選択・月移動・コマ一覧とコマ登録ダイアログ。
 */
import { useContext, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import CreateLessonDialog from '@/components/CreateLessonDialog';
import { Button } from '@/components/ui/button';
import MonthCalendar from '@/components/ui/full-calendar';
import LessonDeletePanel, { type LessonDeleteTarget } from '@/components/ui/lesson-delete-panel';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { SelectedClassroomContext } from '@/components/AppShell';
import type { CurrentUser } from '@/types/currentUser';

dayjs.locale('ja');

type LessonApi = {
  id: string;
  teacherId: string;
  studentId: string;
  classroomId: string;
  subjectId: string | null;
  lessonTypeId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  teacherDisplay: string;
  studentDisplay: string;
};

type TeacherRow = {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
};

type StudentRow = { id: string; name: string };
type PresetRow = { id: string; name: string };

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

function toMapById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function toNameMap(rows: PresetRow[]) {
  return new Map(rows.map((row) => [row.id, row.name]));
}

function buildModalEventTitle(
  lesson: LessonApi,
  teacher?: TeacherRow,
  student?: StudentRow,
  subjectName?: string,
  lessonTypeName?: string
) {
  const teacherName =
    lesson.teacherDisplay || `${teacher?.lastName ?? ''} ${teacher?.firstName ?? ''}`.trim() || lesson.teacherId;
  const studentName = lesson.studentDisplay || student?.name || lesson.studentId;
  const detailText = [subjectName, lessonTypeName].filter(Boolean).join('・');
  return detailText ? `${teacherName} - ${studentName} (${detailText})` : `${teacherName} - ${studentName}`;
}

export default function CalendarPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const context = useContext(SelectedClassroomContext);
  if (!context) {
    throw new Error('useSelectedClassroom must be used within AppShell');
  }
  const { activeClassroom } = context;
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [lessons, setLessons] = useState<LessonApi[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [subjects, setSubjects] = useState<PresetRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<PresetRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<LessonDeleteTarget | null>(null);
  const [isDeletingLesson, setIsDeletingLesson] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const monthStart = useMemo(() => dayjs(focusDate).startOf('month'), [focusDate]);
  const monthEndExclusive = useMemo(() => monthStart.add(1, 'month'), [monthStart]);
  const monthFromIso = useMemo(() => monthStart.toISOString(), [monthStart]);
  const monthToIso = useMemo(() => monthEndExclusive.toISOString(), [monthEndExclusive]);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const handleDeleteLesson = async () => {
    if (!selectedEvent) {
      return;
    }
    setDeleteError(null);
    setIsDeletingLesson(true);
    try {
      const res = await authedFetch(`/api/lessons/${encodeURIComponent(selectedEvent.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setDeleteError(body.message ? `削除に失敗しました（${body.message}）` : '削除に失敗しました。');
        return;
      }
      setSelectedEvent(null);
      setReloadTick((v) => v + 1);
    } catch {
      setDeleteError('ネットワークエラーが発生しました。');
    } finally {
      setIsDeletingLesson(false);
    }
  };

  useEffect(() => {
    let isDisposed = false;
    const load = async () => {
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
        const [lRes, uRes, sRes, subRes, ltRes] = await Promise.all([
          authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lessons?${qs}`),
          authedFetch(`/api/users/${encodeURIComponent(activeClassroom.id)}?${userQs}`),
          authedFetch(`/api/students/${encodeURIComponent(activeClassroom.id)}`),
          authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/subjects`),
          authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lesson-types`),
        ]);
        if (isDisposed) {
          return;
        }
        if (!lRes.ok) {
          setListError('コマ一覧の取得に失敗しました。');
          return;
        }
        const [lessonsJson, uJson, sJson, subJson, ltJson] = await Promise.all([
          lRes.json() as Promise<LessonApi[]>,
          uRes.ok ? (uRes.json() as Promise<TeacherRow[]>) : Promise.resolve(null),
          sRes.ok ? (sRes.json() as Promise<StudentRow[]>) : Promise.resolve(null),
          subRes.ok ? (subRes.json() as Promise<PresetRow[]>) : Promise.resolve(null),
          ltRes.ok ? (ltRes.json() as Promise<PresetRow[]>) : Promise.resolve(null),
        ]);
        if (isDisposed) {
          return;
        }
        setLessons(lessonsJson);
        if (uJson) setTeachers(uJson);
        if (sJson) setStudents(sJson);
        if (subJson) setSubjects(subJson);
        if (ltJson) setLessonTypes(ltJson);
      } catch {
        if (!isDisposed) {
          setListError('ネットワークエラーが発生しました。');
        }
      } finally {
        setIsLoadingMonth(false);
      }
    };
    void load();
    return () => {
      isDisposed = true;
    };
  }, [activeClassroom, authedFetch, monthFromIso, monthToIso, reloadTick]);

  const teacherById = useMemo(() => toMapById(teachers), [teachers]);
  const studentById = useMemo(() => toMapById(students), [students]);
  const subjectById = useMemo(() => toNameMap(subjects), [subjects]);
  const lessonTypeById = useMemo(() => toNameMap(lessonTypes), [lessonTypes]);

  const calendarEvents = useMemo(() => {
    return lessons.map((l) => {
      const te = teacherById.get(l.teacherId);
      const teacherLastName = te?.lastName?.trim() || l.teacherDisplay.trim().split(/\s+/)[0] || l.teacherId;
      const eventColor = te?.color && /^#([0-9a-fA-F]{6})$/.test(te.color) ? te.color : '#6366f1';
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

  if (!currentUser) {
    return <p className="text-sm text-slate-700">この画面にアクセスできません。</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">カレンダー</h2>
          <p className="text-sm text-slate-500">現在の教室: {activeClassroom?.name || '未選択'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            コマを登録
          </Button>
        </div>
      </div>

      {!activeClassroom && (
        <p className="text-sm text-amber-700">教室を選択してください。</p>
      )}

      {listError && <p className="text-sm text-rose-600">{listError}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              {monthStart.format('YYYY年M月')}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusDate((d) => dayjs(d).subtract(1, 'month').toDate())}
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
                onClick={() => setFocusDate((d) => dayjs(d).add(1, 'month').toDate())}
              >
                次の月
              </Button>
            </div>
          </div>

          {isLoadingMonth ? (
            <p className="text-sm text-slate-500">月のコマを読み込み中...</p>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <MonthCalendar
                focusDate={focusDate}
                events={calendarEvents}
                onFocusDateChange={setFocusDate}
                onEventClick={(event) => {
                  setDeleteError(null);
                  const lesson = lessons.find((l) => l.id === event.id);
                  if (!lesson) {
                    setSelectedEvent(event);
                    return;
                  }
                  const teacher = teacherById.get(lesson.teacherId);
                  const student = studentById.get(lesson.studentId);
                  const subjectName = lesson.subjectId ? subjectById.get(lesson.subjectId) : undefined;
                  const lessonTypeName = lesson.lessonTypeId ? lessonTypeById.get(lesson.lessonTypeId) : undefined;
                  setSelectedEvent({
                    ...event,
                    title: buildModalEventTitle(lesson, teacher, student, subjectName, lessonTypeName),
                  });
                }}
              />
            </div>
          )}
        </div>
      </div>

      <LessonDeletePanel
        event={selectedEvent}
        isDeleting={isDeletingLesson}
        error={deleteError}
        onClose={() => setSelectedEvent(null)}
        onDelete={() => void handleDeleteLesson()}
      />

      {activeClassroom && (
        <CreateLessonDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          classroomId={activeClassroom.id}
          getAccessTokenSilently={getAccessTokenSilently}
          initialDate={focusDate}
          onCreated={() => setReloadTick((v) => v + 1)}
          actorUserId={currentUser.id}
          actorRole={currentUser.role}
        />
      )}
    </section>
  );
}
