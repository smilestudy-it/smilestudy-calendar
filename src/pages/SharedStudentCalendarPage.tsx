/**
 * （責務）生徒向け共有ビュー（未認証）。student_id クエリで月次コマを表示。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import MonthCalendar from '@/components/MonthCalendar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchClassroomHolidayDates } from '@/lib/classroomHolidays';

dayjs.locale('ja');

type PublicLesson = {
  id: string;
  startAt: string;
  endAt: string;
  teacherDisplay: string;
  teacherColor: string | null;
  subjectName: string;
  subjectColor: string | null;
  lessonTypeName: string;
};

/**
 * Displays a public monthly calendar of lessons for the student specified in the URL.
 */
export default function SharedStudentCalendarPage() {
  const [searchParams] = useSearchParams();
  const studentId = (searchParams.get('student_id') ?? '').trim();
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [studentName, setStudentName] = useState('');
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<PublicLesson[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const [closureDates, setClosureDates] = useState<string[]>([]);

  const [selectedLesson, setSelectedLesson] = useState<PublicLesson | null>(
    null,
  );

  const monthStart = useMemo(
    () => dayjs(focusDate).startOf('month'),
    [focusDate],
  );
  const monthEndExclusive = useMemo(
    () => monthStart.add(1, 'month'),
    [monthStart],
  );

  useEffect(() => {
    let isDisposed = false;
    const load = async () => {
      if (!studentId) {
        setStudentName('');
        setClassroomId(null);
        setLessons([]);
        setClosureDates([]);
        return;
      }
      setIsLoadingMonth(true);
      setListError(null);
      try {
        const from = monthStart.toISOString();
        const to = monthEndExclusive.toISOString();
        const qs = new URLSearchParams({ student_id: studentId, from, to });
        const res = await fetch(`/api/public/student-lessons?${qs}`);
        if (isDisposed) {
          return;
        }
        if (res.status === 404) {
          setListError(
            '表示できません。リンクが無効か、対象の生徒が見つかりません。',
          );
          setStudentName('');
          setClassroomId(null);
          setLessons([]);
          setClosureDates([]);
          return;
        }
        if (!res.ok) {
          setListError('コマ一覧の取得に失敗しました。');
          setStudentName('');
          setClassroomId(null);
          setLessons([]);
          setClosureDates([]);
          return;
        }
        const data = (await res.json()) as {
          studentName?: string;
          classroomId?: string;
          lessons?: PublicLesson[];
        };
        if (!isDisposed) {
          setStudentName(data.studentName ?? '');
          setClassroomId(data.classroomId ?? null);
          setLessons(data.lessons ?? []);
        }
      } catch {
        if (!isDisposed) {
          setListError('ネットワークエラーが発生しました。');
          setStudentName('');
          setClassroomId(null);
          setLessons([]);
          setClosureDates([]);
        }
      } finally {
        if (!isDisposed) {
          setIsLoadingMonth(false);
        }
      }
    };
    void load();
    return () => {
      isDisposed = true;
    };
  }, [studentId, monthEndExclusive, monthStart]);

  const LessonCountBySubjectAndType = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const lesson of lessons) {
      let bySubject = map.get(lesson.lessonTypeName);
      if (!bySubject) {
        bySubject = new Map<string, number>();
        map.set(lesson.lessonTypeName, bySubject);
      }
      bySubject.set(
        lesson.subjectName,
        (bySubject.get(lesson.subjectName) ?? 0) + 1,
      );
    }
    return [...map].sort((a, b) => a[0].localeCompare(b[0], 'ja'));
  }, [lessons]);

  const subjectColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const lesson of lessons) {
      if (
        lesson.subjectColor &&
        /^#([0-9a-fA-F]{6})$/.test(lesson.subjectColor) &&
        !map.has(lesson.subjectName)
      ) {
        map.set(lesson.subjectName, lesson.subjectColor);
      }
    }
    return map;
  }, [lessons]);

  useEffect(() => {
    let cancelled = false;
    const classroomAtStart = classroomId;
    setClosureDates([]);

    if (!classroomAtStart) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const dates = await fetchClassroomHolidayDates(classroomAtStart);
      if (!cancelled) {
        setClosureDates(dates);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classroomId]);

  useEffect(() => {
    setSelectedLesson(null);
  }, [studentId]);

  const calendarEvents = useMemo(() => {
    return lessons.map((l) => {
      const subLt = [l.subjectName, l.lessonTypeName]
        .filter((name) => name !== '（不明）')
        .join(' · ');
      const eventColor =
        l.subjectColor && /^#([0-9a-fA-F]{6})$/.test(l.subjectColor)
          ? l.subjectColor
          : '#6366f1';
      return {
        id: l.id,
        title: `${dayjs(l.startAt).format('HH:mm')}${
          subLt ? ` (${subLt})` : ''
        }`,
        start: l.startAt,
        end: l.endAt,
        backgroundColor: eventColor,
        borderColor: eventColor,
        textColor: '#ffffff',
      };
    });
  }, [lessons]);

  if (!studentId) {
    return (
      <div className="mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-lg font-semibold">共有カレンダー</h1>
        <p className="text-muted-foreground text-sm">
          URL に <span className="font-mono">student_id</span>{' '}
          パラメータが必要です。
        </p>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-lg font-semibold md:text-xl">
            共有カレンダー{studentName ? `(${studentName})` : ''}
          </h1>
        </div>
      </div>

      {listError && (
        <p className="text-destructive text-sm" role="alert">
          {listError}
        </p>
      )}

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
          <>
            <MonthCalendar
              focusDate={focusDate}
              events={calendarEvents}
              closureDates={closureDates}
              onFocusDateChange={setFocusDate}
              onEventClick={(event) => {
                const lesson = lessons.find((l) => l.id === event.id);
                if (lesson) {
                  setSelectedLesson(lesson);
                }
              }}
            />
            <div className="space-y-2 pt-1">
              <p className="text-muted-foreground text-sm tabular-nums">
                合計 {lessons.length}コマ
              </p>
              <div className="flex flex-wrap gap-2">
                {LessonCountBySubjectAndType.map(([lessonType, bySubject]) => {
                  const total = [...bySubject.values()].reduce(
                    (sum, n) => sum + n,
                    0,
                  );
                  return (
                    <div
                      key={JSON.stringify(lessonType)}
                      className="flex flex-wrap items-center gap-2"
                    >
                      {/* 左: タイプ名 + 合計 */}
                      <span className="text-sm">
                        <span className="text-foreground font-medium">
                          {lessonType}
                        </span>{' '}
                        <span className="text-foreground font-semibold tabular-nums">
                          {total}
                        </span>
                      </span>
                      {/* 右: 科目ごとの内訳 */}
                      {[...bySubject]
                        .sort((a, b) => a[0].localeCompare(b[0], 'ja')) // 文字列順
                        .map(([subject, count]) => (
                          <span
                            key={JSON.stringify(subject)}
                            className="text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  subjectColorByName.get(subject),
                              }}
                              aria-hidden
                            />
                            <span>{subject}</span>
                            <span className="tabular-nums">{count}</span>
                          </span>
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={!!selectedLesson}
        onOpenChange={(open) => !open && setSelectedLesson(null)}
      >
        <DialogContent className="max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>授業詳細</DialogTitle>
          </DialogHeader>

          {selectedLesson && (
            <div className="space-y-4 pt-4 text-sm">
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-muted-foreground font-semibold">
                  日時
                </span>
                <span className="font-medium">
                  {dayjs(selectedLesson.startAt).format('M月D日(ddd)')}{' '}
                  {dayjs(selectedLesson.startAt).format('HH:mm')} -{' '}
                  {dayjs(selectedLesson.endAt).format('HH:mm')}
                </span>
              </div>

              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-muted-foreground font-semibold">
                  担当講師
                </span>
                <span className="font-medium">
                  {selectedLesson.teacherDisplay}
                </span>
              </div>

              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-muted-foreground font-semibold">
                  授業タイプ
                </span>
                <span className="font-medium">
                  {selectedLesson.lessonTypeName}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">
                  科目
                </span>
                <span className="font-medium">
                  {selectedLesson.subjectName}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
