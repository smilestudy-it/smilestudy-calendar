/**
 * （責務）週スロットグリッドでのコマ一括編集。POST /api/lessons/bulk を使用。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import customParseFormat from 'dayjs/plugin/customParseFormat';

import LessonBulkActionPanel from '@/components/LessonBulkActionPanel';
import WeekLessonSlotGrid, {
  type TimeSlotRow,
  type WeekGridLesson,
} from '@/components/WeekLessonSlotGrid';
import { Button } from '@/components/ui/button';
import LessonDeletePanel, {
  type LessonDetailTarget,
} from '@/components/ui/lesson-delete-panel';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { useSelectedClassroom } from '@/hooks/useSelectedClassroom';
import { startOfWeekSunday } from '@/lib/calendarTime';
import { parseWeekSlotCellKey, weekSlotCellKey } from '@/lib/weekSlotCell';
import type { CurrentUser } from '@/types/currentUser';

dayjs.locale('ja');
dayjs.extend(customParseFormat);

type TeacherRow = {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role?: string;
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

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export default function CalendarBulkEditPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const { activeClassroom } = useSelectedClassroom();
  const [searchParams, setSearchParams] = useSearchParams();
  const weekParam = searchParams.get('week');
  const initialWeek =
    weekParam && dayjs(weekParam, 'YYYY-MM-DD', true).isValid()
      ? dayjs(weekParam).toDate()
      : new Date();
  const [weekAnchor, setWeekAnchor] = useState(initialWeek);
  const [lessons, setLessons] = useState<WeekGridLesson[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [subjects, setSubjects] = useState<PresetRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<PresetRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailEvent, setDetailEvent] = useState<LessonDetailTarget | null>(
    null,
  );
  const [isDeletingLesson, setIsDeletingLesson] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSavingPresets, setIsSavingPresets] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const weekStart = useMemo(() => startOfWeekSunday(weekAnchor), [weekAnchor]);
  const weekFromIso = useMemo(
    () => weekStart.toDate().toISOString(),
    [weekStart],
  );
  const weekToIso = useMemo(
    () => weekStart.add(7, 'day').toDate().toISOString(),
    [weekStart],
  );

  const weekDays = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      out.push(weekStart.add(i, 'day').toDate());
    }
    return out;
  }, [weekStart]);

  const sortedSlots = useMemo(
    () =>
      [...timeSlots].sort(
        (a, b) => hmToMinutes(a.startTime) - hmToMinutes(b.startTime),
      ),
    [timeSlots],
  );

  const lessonByCellKey = useMemo(() => {
    const map = new Map<string, WeekGridLesson>();
    if (!activeClassroom) {
      return map;
    }
    const slotIdByHmRange = new Map(
      sortedSlots.map((slot) => [`${slot.startTime}-${slot.endTime}`, slot.id]),
    );
    const lessonIndex = new Map<string, WeekGridLesson>();
    for (const lesson of lessons) {
      if (lesson.classroomId !== activeClassroom.id) {
        continue;
      }
      const startLocal = dayjs(new Date(lesson.startAt));
      const endLocal = dayjs(new Date(lesson.endAt));
      const slotId = slotIdByHmRange.get(
        `${startLocal.format('HH:mm')}-${endLocal.format('HH:mm')}`,
      );
      if (!slotId) {
        continue;
      }
      lessonIndex.set(
        weekSlotCellKey(startLocal.format('YYYY-MM-DD'), slotId),
        lesson,
      );
    }
    for (const day of weekDays) {
      const dk = dayjs(day).format('YYYY-MM-DD');
      for (const slot of sortedSlots) {
        const key = weekSlotCellKey(dk, slot.id);
        const found = lessonIndex.get(key);
        if (found) {
          map.set(key, found);
        }
      }
    }
    return map;
  }, [weekDays, sortedSlots, lessons, activeClassroom]);

  useEffect(() => {
    const w = searchParams.get('week');
    if (w && dayjs(w, 'YYYY-MM-DD', true).isValid()) {
      setWeekAnchor(dayjs(w).toDate());
    }
  }, [searchParams]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setListError(null);
      if (!activeClassroom) {
        setLessons([]);
        setTimeSlots([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const qs = new URLSearchParams({ from: weekFromIso, to: weekToIso });
        const userQs = new URLSearchParams({ includeAdmins: '1' });
        const [lRes, tsRes, uRes, sRes, subRes, ltRes] = await Promise.all([
          authedFetch(
            `/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lessons?${qs}`,
          ),
          authedFetch(
            `/api/classrooms/${encodeURIComponent(activeClassroom.id)}/time-slots`,
          ),
          authedFetch(
            `/api/users/${encodeURIComponent(activeClassroom.id)}?${userQs}`,
          ),
          authedFetch(
            `/api/students/${encodeURIComponent(activeClassroom.id)}`,
          ),
          authedFetch(
            `/api/classrooms/${encodeURIComponent(activeClassroom.id)}/subjects`,
          ),
          authedFetch(
            `/api/classrooms/${encodeURIComponent(activeClassroom.id)}/lesson-types`,
          ),
        ]);
        if (disposed) {
          return;
        }
        if (!lRes.ok) {
          setListError('コマ一覧の取得に失敗しました。');
          return;
        }
        if (!tsRes.ok) {
          setListError('時間枠の取得に失敗しました。');
          return;
        }
        const [lessonsJson, tsJson, uJson, sJson, subJson, ltJson] =
          await Promise.all([
            lRes.json() as Promise<WeekGridLesson[]>,
            tsRes.json() as Promise<TimeSlotRow[]>,
            uRes.ok
              ? (uRes.json() as Promise<TeacherRow[]>)
              : Promise.resolve([]),
            sRes.ok
              ? (sRes.json() as Promise<StudentRow[]>)
              : Promise.resolve([]),
            subRes.ok
              ? (subRes.json() as Promise<PresetRow[]>)
              : Promise.resolve([]),
            ltRes.ok
              ? (ltRes.json() as Promise<PresetRow[]>)
              : Promise.resolve([]),
          ]);
        if (disposed) {
          return;
        }
        setLessons(lessonsJson);
        setTimeSlots(tsJson);
        setTeachers(uJson);
        setStudents(sJson);
        setSubjects(subJson);
        setLessonTypes(ltJson);
      } catch {
        if (!disposed) {
          setListError('ネットワークエラーが発生しました。');
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [activeClassroom, authedFetch, weekFromIso, weekToIso, reloadTick]);

  const teacherById = useMemo(() => toMapById(teachers), [teachers]);
  const studentById = useMemo(() => toMapById(students), [students]);

  const selectionMeta = useMemo(() => {
    let empty = 0;
    let occ = 0;
    for (const key of selectedKeys) {
      if (lessonByCellKey.has(key)) {
        occ += 1;
      } else {
        empty += 1;
      }
    }
    return { empty, occ };
  }, [selectedKeys, lessonByCellKey]);

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setDetailEvent(null);
  }, []);

  const addKeys = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        next.add(k);
      }
      return next;
    });
    setDetailEvent(null);
  }, []);

  const openLessonDetail = useCallback(
    (lesson: WeekGridLesson) => {
      setSelectedKeys(new Set());
      const teacher = teacherById.get(lesson.teacherId);
      const student = studentById.get(lesson.studentId);
      const teacherName =
        lesson.teacherDisplay ||
        `${teacher?.lastName ?? ''} ${teacher?.firstName ?? ''}`.trim() ||
        lesson.teacherId;
      const studentName =
        lesson.studentDisplay || student?.name || lesson.studentId;
      setDetailEvent({
        id: lesson.id,
        title: `${teacherName} – ${studentName}`,
        start: new Date(lesson.startAt),
        end: new Date(lesson.endAt),
        subjectId: lesson.subjectId,
        lessonTypeId: lesson.lessonTypeId,
      });
      setDeleteError(null);
      setPresetsError(null);
    },
    [teacherById, studentById],
  );

  const handleDeleteLesson = async () => {
    if (!detailEvent || !activeClassroom) {
      return;
    }
    setDeleteError(null);
    setIsDeletingLesson(true);
    try {
      const res = await authedFetch('/api/lessons/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId: activeClassroom.id,
          deleteIds: [detailEvent.id],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setDeleteError(
          body.message
            ? `削除に失敗しました（${body.message}）`
            : '削除に失敗しました。',
        );
        return;
      }
      setDetailEvent(null);
      setReloadTick((v) => v + 1);
    } catch {
      setDeleteError('ネットワークエラーが発生しました。');
    } finally {
      setIsDeletingLesson(false);
    }
  };

  const handleSaveDetailPresets = async () => {
    if (!detailEvent) {
      return;
    }
    setPresetsError(null);
    setIsSavingPresets(true);
    try {
      const res = await authedFetch(
        `/api/lessons/${encodeURIComponent(detailEvent.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subjectId: detailEvent.subjectId ?? null,
            lessonTypeId: detailEvent.lessonTypeId ?? null,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setPresetsError(
          body.message
            ? `保存に失敗しました（${body.message}）`
            : '保存に失敗しました。',
        );
        return;
      }
      setReloadTick((v) => v + 1);
    } catch {
      setPresetsError('ネットワークエラーが発生しました。');
    } finally {
      setIsSavingPresets(false);
    }
  };

  const readBulkFailures = (arr: Array<{ ok: boolean; message?: string }>) =>
    arr.filter((x) => !x.ok).map((x) => x.message ?? 'error');

  const runBulk = async (body: Record<string, unknown>) => {
    setBulkError(null);
    setIsBulkSubmitting(true);
    try {
      const res = await authedFetch('/api/lessons/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        deletes?: Array<{ ok: boolean; message?: string }>;
        creates?: Array<{ ok: boolean; message?: string }>;
      };
      if (!res.ok) {
        setBulkError(
          json.message ? `失敗（${json.message}）` : '一括処理に失敗しました。',
        );
        return;
      }
      const fails = [
        ...readBulkFailures(json.deletes ?? []),
        ...readBulkFailures(json.creates ?? []),
      ];
      if (fails.length > 0) {
        setBulkError(`一部失敗: ${fails.slice(0, 3).join(' / ')}`);
      }
      setSelectedKeys(new Set());
      setReloadTick((v) => v + 1);
    } catch {
      setBulkError('ネットワークエラーが発生しました。');
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleBulkCreate = async (params: {
    teacherId: string;
    studentId: string;
    subjectId: string;
    lessonTypeId: string;
  }) => {
    if (!activeClassroom) {
      return;
    }
    const creates: Record<string, unknown>[] = [];
    const tzOff = new Date().getTimezoneOffset();
    for (const key of selectedKeys) {
      const parsed = parseWeekSlotCellKey(key);
      if (!parsed) {
        continue;
      }
      const slot = timeSlots.find((t) => t.id === parsed.timeSlotId);
      if (!slot) {
        continue;
      }
      const row: Record<string, unknown> = {
        teacherId: params.teacherId,
        studentId: params.studentId,
        dateKey: parsed.dateKey,
        timeSlotId: parsed.timeSlotId,
        status: 'published',
      };
      if (params.subjectId) {
        row.subjectId = params.subjectId;
      }
      if (params.lessonTypeId) {
        row.lessonTypeId = params.lessonTypeId;
      }
      creates.push(row);
    }
    if (creates.length === 0) {
      setBulkError('有効な枠がありません。');
      return;
    }
    await runBulk({
      classroomId: activeClassroom.id,
      creates,
      createsTimezoneOffsetMinutes: tzOff,
    });
  };

  const handleBulkDelete = async () => {
    if (!activeClassroom) {
      return;
    }
    const deleteIds: string[] = [];
    for (const key of selectedKeys) {
      const lesson = lessonByCellKey.get(key);
      if (lesson) {
        deleteIds.push(lesson.id);
      }
    }
    if (deleteIds.length === 0) {
      setBulkError('削除対象のコマがありません。');
      return;
    }
    await runBulk({ classroomId: activeClassroom.id, deleteIds });
  };

  const shiftWeek = (delta: number) => {
    const sunday = startOfWeekSunday(weekAnchor);
    const next =
      delta === 0
        ? startOfWeekSunday(new Date()).toDate()
        : sunday.add(delta, 'week').toDate();
    setWeekAnchor(next);
    setSearchParams({ week: dayjs(next).format('YYYY-MM-DD') });
  };

  if (!currentUser) {
    return (
      <p className="text-sm text-slate-700">この画面にアクセスできません。</p>
    );
  }

  return (
    <section className="space-y-6 pb-40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">週コマ編集</h2>
          <p className="text-sm text-slate-500">
            教室: {activeClassroom?.name || '未選択'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to="/calendar">カレンダーへ</Link>
          </Button>
        </div>
      </div>

      {!activeClassroom && (
        <p className="text-sm text-amber-700">教室を選択してください。</p>
      )}
      {listError && <p className="text-sm text-rose-600">{listError}</p>}

      {activeClassroom && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              {weekStart.format('YYYY/M/D')} 週（日曜始まり）
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => shiftWeek(-1)}
              >
                前の週
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => shiftWeek(0)}
              >
                今週
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => shiftWeek(1)}
              >
                次の週
              </Button>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">読み込み中...</p>
          ) : timeSlots.length === 0 ? (
            <p className="text-sm text-amber-700">
              時間枠が未設定です。プリセット設定で時間枠を追加してください。
            </p>
          ) : (
            <WeekLessonSlotGrid
              weekAnchor={weekAnchor}
              timeSlots={timeSlots}
              lessons={lessons}
              classroomId={activeClassroom.id}
              selectedKeys={selectedKeys}
              onToggleKey={toggleKey}
              onAddKeys={addKeys}
              onOpenLessonDetail={openLessonDetail}
            />
          )}

          <p className="text-xs text-slate-500">
            セルをクリックまたはドラッグで複数選択。コマがある枠は「詳細」で下部パネルを開けます。
          </p>

          <LessonBulkActionPanel
            selectedCount={selectedKeys.size}
            emptySlotCount={selectionMeta.empty}
            occupiedSlotCount={selectionMeta.occ}
            teachers={teachers}
            students={students}
            subjects={subjects}
            lessonTypes={lessonTypes}
            actorUserId={currentUser.id}
            actorRole={currentUser.role}
            isSubmitting={isBulkSubmitting}
            error={bulkError}
            onClearSelection={() => {
              setSelectedKeys(new Set());
              setBulkError(null);
            }}
            onCreate={(p) => void handleBulkCreate(p)}
            onDelete={() => void handleBulkDelete()}
          />

          <LessonDeletePanel
            event={detailEvent}
            isDeleting={isDeletingLesson}
            error={deleteError}
            onClose={() => setDetailEvent(null)}
            onDelete={() => void handleDeleteLesson()}
            presetSubjects={subjects}
            presetLessonTypes={lessonTypes}
            isSavingPresets={isSavingPresets}
            presetsError={presetsError}
            onPresetChange={(next) =>
              setDetailEvent((prev) => (prev ? { ...prev, ...next } : null))
            }
            onSavePresets={() => void handleSaveDetailPresets()}
          />
        </>
      )}
    </section>
  );
}
