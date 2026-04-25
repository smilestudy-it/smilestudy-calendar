/**
 * （責務）週次カレンダー。教室選択・週移動・コマ一覧とコマ登録ダイアログ。
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import CreateLessonDialog from '@/components/CreateLessonDialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { SelectedClassroomContext } from '@/components/AppShell';
import { startOfWeekSunday } from '@/lib/calendarTime';
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
  const [isLoadingWeek, setIsLoadingWeek] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const weekRequestIdRef = useRef(0);

  const weekStart = useMemo(() => startOfWeekSunday(focusDate), [focusDate]);
  const weekEndExclusive = useMemo(() => weekStart.add(7, 'day'), [weekStart]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
  }, [weekStart]);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const reloadWeek = useCallback(async () => {
    const requestId = ++weekRequestIdRef.current;
    setIsLoadingWeek(true);
    setListError(null);
    if(!activeClassroom){
      setLessons([]);
      return;
    }
    try {
      const from = weekStart.toISOString();
      const to = weekEndExclusive.toISOString();
      const qs = new URLSearchParams({ from, to });
      const userQs = new URLSearchParams({ includeAdmins: '1' });
      const [lRes, uRes, sRes, subRes, ltRes] = await Promise.all([
        authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lessons?${qs}`),
        authedFetch(`/api/users/${encodeURIComponent(activeClassroom.id)}?${userQs}`),
        authedFetch(`/api/students/${encodeURIComponent(activeClassroom.id)}`),
        authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/subjects`),
        authedFetch(`/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lesson-types`),
      ]);
      if (weekRequestIdRef.current !== requestId) {
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
      if (weekRequestIdRef.current !== requestId) {
        return;
      }
      if (uJson) {
        setTeachers(uJson);
      }
      if (sJson) {
        setStudents(sJson);
      }
      if (subJson) {
        setSubjects(subJson);
      }
      if (ltJson) {
        setLessonTypes(ltJson);
      }
      setLessons(lessonsJson);
    } catch {
      if (weekRequestIdRef.current === requestId) {
        setListError('ネットワークエラーが発生しました。');
      }
    } finally {
      if (weekRequestIdRef.current === requestId) {
        setIsLoadingWeek(false);
      }
    }
  }, [activeClassroom, authedFetch, weekEndExclusive, weekStart]);

  useEffect(() => {
    void reloadWeek();
  }, [reloadWeek]);

  const teacherById = useMemo(() => {
    const m = new Map<string, TeacherRow>();
    for (const t of teachers) {
      m.set(t.id, t);
    }
    return m;
  }, [teachers]);

  const studentById = useMemo(() => {
    const m = new Map<string, StudentRow>();
    for (const s of students) {
      m.set(s.id, s);
    }
    return m;
  }, [students]);

  const subjectById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subjects) {
      m.set(s.id, s.name);
    }
    return m;
  }, [subjects]);

  const lessonTypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of lessonTypes) {
      m.set(s.id, s.name);
    }
    return m;
  }, [lessonTypes]);

  if (!currentUser) {
    return <p className="text-sm text-slate-300">この画面にアクセスできません。</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">カレンダー</h2>
          <p className="text-sm text-slate-400">現在の教室: {activeClassroom?.name || '未選択'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            コマを登録
          </Button>
        </div>
      </div>

      {!activeClassroom && (
        <p className="text-sm text-amber-200/90">教室を選択してください。</p>
      )}

      {listError && <p className="text-sm text-rose-300">{listError}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">
              {weekStart.format('M月D日')} 〜 {weekEndExclusive.subtract(1, 'day').format('M月D日')}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusDate((d) => dayjs(d).subtract(7, 'day').toDate())}
              >
                前の週
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusDate(() => new Date())}
              >
                今週
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusDate((d) => dayjs(d).add(7, 'day').toDate())}
              >
                次の週
              </Button>
            </div>
          </div>

          {isLoadingWeek ? (
            <p className="text-sm text-slate-400">週のコマを読み込み中...</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
              {weekDays.map((day) => {
                const dayKey = day.format('YYYY-MM-DD');
                const dayLessons = lessons
                  .filter((l) => dayjs(l.startAt).isSame(day, 'day'))
                  .sort((a, b) => dayjs(a.startAt).valueOf() - dayjs(b.startAt).valueOf());
                return (
                  <div
                    key={dayKey}
                    className="flex min-h-[220px] flex-col rounded-xl border border-slate-800 bg-slate-950/50 p-2"
                  >
                    <p className="mb-2 border-b border-slate-800 pb-1 text-center text-xs font-medium text-slate-400">
                      {day.format('M/D')} {day.format('ddd')}
                    </p>
                    <ul className="flex flex-1 flex-col gap-1.5">
                      {dayLessons.map((l) => {
                        const te = teacherById.get(l.teacherId);
                        const st = studentById.get(l.studentId);
                        const border = te?.color && /^#([0-9a-fA-F]{6})$/.test(te.color) ? te.color : '#6366f1';
                        const sub = l.subjectId ? subjectById.get(l.subjectId) : undefined;
                        const lt = l.lessonTypeId ? lessonTypeById.get(l.lessonTypeId) : undefined;
                        return (
                          <li
                            key={l.id}
                            className="rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1.5 text-left text-xs text-slate-200"
                            style={{ borderLeftWidth: 4, borderLeftColor: border }}
                          >
                            <p className="font-medium text-slate-100">
                              {dayjs(l.startAt).format('HH:mm')}–{dayjs(l.endAt).format('HH:mm')}
                            </p>
                            <p className="text-slate-300">
                              {l.teacherDisplay ||
                                `${te?.lastName ?? ''} ${te?.firstName ?? ''}`.trim() ||
                                l.teacherId}
                            </p>
                            <p className="text-slate-300">
                              {l.studentDisplay ?? st?.name ?? l.studentId}
                            </p>
                            {(sub || lt) && (
                              <p className="text-slate-500">
                                {[sub, lt].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
          <Calendar
            mode="single"
            required
            selected={focusDate}
            onSelect={(d) => d && setFocusDate(d)}
            defaultMonth={focusDate}
          />
        </div>
      </div>

      {activeClassroom && (
        <CreateLessonDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          classroomId={activeClassroom.id}
          getAccessTokenSilently={getAccessTokenSilently}
          initialDate={focusDate}
          onCreated={() => void reloadWeek()}
          actorUserId={currentUser.id}
          actorRole={currentUser.role}
        />
      )}
    </section>
  );
}
