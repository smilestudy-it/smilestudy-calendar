/**
 * （責務）週（日曜始まり）× 教室プリセット時間枠のグリッド。クリックでトグル、ドラッグで複数セルを選択追加。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import dayjs from 'dayjs';

import { combineLocalDateAndHm, startOfWeekSunday } from '@/lib/calendarTime';
import { weekSlotCellKey } from '@/lib/weekSlotCell';

export type WeekGridLesson = {
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

export type TimeSlotRow = { id: string; startTime: string; endTime: string };

type Props = {
  weekAnchor: Date;
  timeSlots: TimeSlotRow[];
  lessons: WeekGridLesson[];
  classroomId: string;
  selectedKeys: ReadonlySet<string>;
  onToggleKey: (key: string) => void;
  /** ドラッグで塗ったセルを選択に追加（既存は維持） */
  onAddKeys: (keys: string[]) => void;
  onOpenLessonDetail: (lesson: WeekGridLesson) => void;
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function dateKeyLocal(d: Date): string {
  return dayjs(d).format('YYYY-MM-DD');
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function lessonInCell(
  lesson: WeekGridLesson,
  day: Date,
  slot: TimeSlotRow,
  classroomId: string,
): boolean {
  if (lesson.classroomId !== classroomId) {
    return false;
  }
  const start = combineLocalDateAndHm(day, slot.startTime);
  const end = combineLocalDateAndHm(day, slot.endTime);
  return (
    new Date(lesson.startAt).getTime() === start.getTime() &&
    new Date(lesson.endAt).getTime() === end.getTime()
  );
}

export default function WeekLessonSlotGrid({
  weekAnchor,
  timeSlots,
  lessons,
  classroomId,
  selectedKeys,
  onToggleKey,
  onAddKeys,
  onOpenLessonDetail,
}: Props) {
  const weekStart = useMemo(() => startOfWeekSunday(weekAnchor), [weekAnchor]);
  const days = useMemo(() => {
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

  const lessonByCell = useMemo(() => {
    const map = new Map<string, WeekGridLesson>();
    for (const day of days) {
      const dk = dateKeyLocal(day);
      for (const slot of sortedSlots) {
        const key = weekSlotCellKey(dk, slot.id);
        const found = lessons.find((l) =>
          lessonInCell(l, day, slot, classroomId),
        );
        if (found) {
          map.set(key, found);
        }
      }
    }
    return map;
  }, [days, sortedSlots, lessons, classroomId]);

  const dragKeysRef = useRef<Set<string> | null>(null);
  const [dragKeys, setDragKeys] = useState<Set<string> | null>(null);

  useEffect(() => {
    dragKeysRef.current = dragKeys;
  }, [dragKeys]);

  const endDrag = useCallback(() => {
    const painted = dragKeysRef.current;
    if (!painted) {
      return;
    }
    dragKeysRef.current = null;
    setDragKeys(null);

    if (painted.size === 1) {
      const only = [...painted][0]!;
      onToggleKey(only);
      return;
    }
    onAddKeys([...painted]);
  }, [onAddKeys, onToggleKey]);

  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
  }, [endDrag]);

  const onCellMouseDown = (key: string) => {
    const next = new Set([key]);
    dragKeysRef.current = next;
    setDragKeys(next);
  };

  const onCellMouseEnter = (key: string) => {
    setDragKeys((prev) => {
      if (!prev) {
        return null;
      }
      const next = new Set(prev);
      next.add(key);
      dragKeysRef.current = next;
      return next;
    });
  };

  return (
    <div className="border-border bg-background overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] border-collapse text-sm select-none">
        <thead>
          <tr className="border-border bg-muted border-b">
            <th className="border-border bg-muted text-muted-foreground sticky left-0 z-10 border-r px-2 py-2 text-left text-xs font-medium">
              時間枠
            </th>
            {days.map((d, idx) => (
              <th
                key={dateKeyLocal(d)}
                className="border-border min-w-[88px] border-r px-1 py-2 text-center text-xs font-medium last:border-r-0"
              >
                <div>{WEEKDAY_LABELS[idx]}</div>
                <div className="text-muted-foreground font-normal">
                  {dayjs(d).format('M/D')}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedSlots.map((slot) => (
            <tr
              key={slot.id}
              className="border-border border-b last:border-b-0"
            >
              <td className="border-border bg-muted/90 text-muted-foreground sticky left-0 z-10 border-r px-2 py-1.5 text-xs">
                {slot.startTime}–{slot.endTime}
              </td>
              {days.map((day) => {
                const dk = dateKeyLocal(day);
                const key = weekSlotCellKey(dk, slot.id);
                const lesson = lessonByCell.get(key);
                const selected = selectedKeys.has(key);
                const painted = dragKeys?.has(key) ?? false;
                return (
                  <td
                    key={key}
                    className={`border-border border-r p-0 align-top last:border-r-0 ${
                      selected ? 'bg-accent ring-ring ring-1 ring-inset' : ''
                    } ${painted ? 'bg-muted/60' : ''}`}
                  >
                    <div className="flex min-h-[52px] w-full flex-col">
                      <button
                        type="button"
                        className="hover:bg-muted/80 flex flex-1 flex-col items-stretch justify-center gap-0.5 px-1 py-1 text-left text-xs"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onCellMouseDown(key);
                        }}
                        onMouseEnter={() => onCellMouseEnter(key)}
                      >
                        {lesson ? (
                          <>
                            <span className="truncate font-medium">
                              {lesson.teacherDisplay}
                            </span>
                            <span className="text-muted-foreground truncate">
                              {lesson.studentDisplay}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">空き</span>
                        )}
                      </button>
                      {lesson ? (
                        <button
                          type="button"
                          className="border-border text-primary hover:bg-muted border-t px-1 py-0.5 text-center text-[10px]"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={() => onOpenLessonDetail(lesson)}
                        >
                          詳細
                        </button>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
