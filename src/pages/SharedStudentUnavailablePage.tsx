/**
 * （責務）共有生徒向け：授業不可時間帯の登録画面（CalendarEdit と同系統の日次マーク UI）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import type { ClassNames } from 'react-day-picker';
import type { Modifiers } from 'react-day-picker';
import { ja } from 'react-day-picker/locale';
import { Link, useSearchParams } from 'react-router-dom';

import { endOfMonth, format, startOfMonth } from 'date-fns';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchClassroomHolidays } from '@/lib/classroomHolidays';
import { cn } from '@/lib/utils';

dayjs.locale('ja');

type TimeSlotRow = {
  id: string;
  startTime: string;
  endTime: string;
};

type PublicLesson = {
  id: string;
  startAt: string;
  endAt: string;
};

type UnavailableEntry = {
  date: string;
  timeSlotId: string;
};

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Public page for students to mark unavailable lesson time slots.
 */
export default function SharedStudentUnavailablePage() {
  const [searchParams] = useSearchParams();
  const studentId = (searchParams.get('student_id') ?? '').trim();
  const shareSearch = searchParams.toString()
    ? `?${searchParams.toString()}`
    : '';

  const [studentName, setStudentName] = useState('');
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [monthLessons, setMonthLessons] = useState<PublicLesson[]>([]);
  const [holidayDateSet, setHolidayDateSet] = useState<Set<string> | null>(
    null,
  );
  const [unavailableByDate, setUnavailableByDate] = useState<
    Map<string, Set<string>>
  >(() => new Map());

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const [draftSlotIds, setDraftSlotIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const dateKey = date ? format(date, 'yyyy-MM-dd') : null;

  // 生徒名・教室・時間枠・不可枠
  useEffect(() => {
    if (!studentId) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadError(null);
      setHolidayDateSet(null);
      try {
        const from = startOfMonth(new Date()).toISOString();
        const to = endOfMonth(new Date()).toISOString();
        const lessonQs = new URLSearchParams({
          student_id: studentId,
          from,
          to,
        });
        const unavailableQs = new URLSearchParams({ student_id: studentId });

        const [lessonRes, unavailableRes] = await Promise.all([
          fetch(`/api/public/student-lessons?${lessonQs}`),
          fetch(`/api/public/student-unavaliable-schedule?${unavailableQs}`),
        ]);

        if (lessonRes.status === 404) {
          if (!cancelled) {
            setLoadError(
              '表示できません。リンクが無効か、対象の生徒が見つかりません。',
            );
            setStudentName('');
          }
          return;
        }
        if (!lessonRes.ok) {
          throw new Error('生徒情報の取得に失敗しました');
        }

        const lessonData = (await lessonRes.json()) as {
          studentName?: string;
          classroomId?: string;
        };
        const cid = lessonData.classroomId ?? null;
        if (!cancelled) {
          setStudentName(lessonData.studentName ?? '');
        }

        if (unavailableRes.ok) {
          const data = (await unavailableRes.json()) as {
            student_unavailable_schedule?: UnavailableEntry[];
          };
          const map = new Map<string, Set<string>>();
          for (const row of data.student_unavailable_schedule ?? []) {
            let set = map.get(row.date);
            if (!set) {
              set = new Set();
              map.set(row.date, set);
            }
            set.add(row.timeSlotId);
          }
          if (!cancelled) {
            setUnavailableByDate(map);
          }
        }

        if (cid) {
          const [slotsRes, holidayResult] = await Promise.allSettled([
            fetch(`/api/time-slots/${encodeURIComponent(cid)}`),
            fetchClassroomHolidays(cid),
          ]);

          if (holidayResult.status === 'fulfilled') {
            if (!cancelled) {
              setHolidayDateSet(
                new Set(holidayResult.value.map((h) => h.date)),
              );
            }
          } else if (!cancelled) {
            // 休業日が取れない場合は lesson 登録同様に編集不可
            setHolidayDateSet(null);
          }

          if (slotsRes.status === 'fulfilled' && slotsRes.value.ok) {
            const slots = (await slotsRes.value.json()) as TimeSlotRow[];
            if (!cancelled) {
              setTimeSlots(
                slots.sort(
                  (a, b) => hmToMinutes(a.startTime) - hmToMinutes(b.startTime),
                ),
              );
            }
          }
        } else if (!cancelled) {
          setHolidayDateSet(new Set());
        }
      } catch {
        if (!cancelled) {
          setLoadError('データの取得に失敗しました。');
          setHolidayDateSet(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // 表示月の授業（○△判定・授業あり枠用）
  const fetchMonthLessons = useCallback(async () => {
    if (!studentId || timeSlots.length === 0) {
      return;
    }
    try {
      const from = startOfMonth(month).toISOString();
      const to = endOfMonth(month).toISOString();
      const qs = new URLSearchParams({ student_id: studentId, from, to });
      const res = await fetch(`/api/public/student-lessons?${qs}`);
      if (res.ok) {
        const data = (await res.json()) as {
          studentName?: string;
          lessons?: PublicLesson[];
        };
        setMonthLessons(data.lessons ?? []);
        if (data.studentName) {
          setStudentName(data.studentName);
        }
      }
    } catch {
      // 月次失敗時は空のまま
    }
  }, [studentId, month, timeSlots.length]);

  useEffect(() => {
    if (timeSlots.length > 0) {
      void fetchMonthLessons();
    }
  }, [fetchMonthLessons, timeSlots.length]);

  const isSelectedDateHoliday = Boolean(
    dateKey && holidayDateSet?.has(dateKey),
  );

  /** 日付ごとの不可登録数（選択中の日は未保存の下書きを反映） */
  const unavailableCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const [dKey, slotIds] of unavailableByDate) {
      if (slotIds.size > 0) {
        map.set(dKey, slotIds.size);
      }
    }
    if (dateKey && !isSelectedDateHoliday) {
      if (draftSlotIds.size > 0) {
        map.set(dateKey, draftSlotIds.size);
      } else {
        map.delete(dateKey);
      }
    }
    return map;
  }, [unavailableByDate, dateKey, draftSlotIds, isSelectedDateHoliday]);

  const lessonSlotIdsOnSelectedDate = useMemo(() => {
    const set = new Set<string>();
    if (!dateKey) {
      return set;
    }
    for (const lesson of monthLessons) {
      if (format(new Date(lesson.startAt), 'yyyy-MM-dd') !== dateKey) {
        continue;
      }
      const hKey = format(new Date(lesson.startAt), 'HH:mm');
      const slot = timeSlots.find((ts) => ts.startTime === hKey);
      if (slot) {
        set.add(slot.id);
      }
    }
    return set;
  }, [monthLessons, dateKey, timeSlots]);

  // 日付変更時に下書きを同期
  useEffect(() => {
    setMessage(null);
    if (!dateKey || isSelectedDateHoliday) {
      setDraftSlotIds(new Set());
      return;
    }
    setDraftSlotIds(new Set(unavailableByDate.get(dateKey) ?? []));
  }, [dateKey, unavailableByDate, isSelectedDateHoliday]);

  // 初期選択が休業日なら解除
  useEffect(() => {
    if (dateKey && holidayDateSet?.has(dateKey)) {
      setDate(undefined);
    }
  }, [dateKey, holidayDateSet]);

  const toggleSlot = (slotId: string) => {
    if (lessonSlotIdsOnSelectedDate.has(slotId)) {
      return;
    }
    setDraftSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
    setMessage(null);
  };

  const handleSave = async () => {
    if (!dateKey || !studentId) {
      return;
    }
    if (holidayDateSet?.has(dateKey)) {
      setMessage({
        text: '休業日には授業不可時間帯を登録できません。',
        type: 'error',
      });
      return;
    }
    if (!holidayDateSet) {
      setMessage({
        text: '休業日情報を取得できないため登録できません。',
        type: 'error',
      });
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ student_id: studentId });
      const timeSlotIds = [...draftSlotIds];
      const res = await fetch(
        `/api/public/student-unavaliable-schedule?${qs}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ date: dateKey, timeSlotIds }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? '保存に失敗しました');
      }
      setUnavailableByDate((prev) => {
        const next = new Map(prev);
        if (timeSlotIds.length === 0) {
          next.delete(dateKey);
        } else {
          next.set(dateKey, new Set(timeSlotIds));
        }
        return next;
      });
      setMessage({ text: '保存しました', type: 'success' });
    } catch (e: unknown) {
      setMessage({
        text: e instanceof Error ? e.message : 'エラーが発生しました',
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!studentId) {
    return (
      <div className="mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-lg font-semibold">授業不可時間帯の登録</h1>
        <p className="text-muted-foreground text-sm">
          URL に <span className="font-mono">student_id</span>{' '}
          パラメータが必要です。
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg space-y-3 text-center">
        <p className="text-destructive text-sm" role="alert">
          {loadError}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/share/calendar${shareSearch}`}>カレンダーに戻る</Link>
        </Button>
      </div>
    );
  }

  const holidaysReady = holidayDateSet != null;

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-lg font-semibold md:text-xl">
            授業不可時間帯の登録
            {studentName ? `（${studentName}）` : ''}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            日付を選び、授業に入れない時間帯をタップして保存してください。
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to={`/share/calendar${shareSearch}`}>戻る</Link>
        </Button>
      </div>

      {!holidaysReady ? (
        <p className="text-muted-foreground text-sm">
          休業日情報を確認しています。取得できない場合は登録できません。
        </p>
      ) : (
        <>
          <Card className="shadow-sm">
            <CardContent className="flex justify-center p-3">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                month={month}
                onMonthChange={setMonth}
                locale={ja}
                formatters={{
                  formatCaption: (d) =>
                    `${d.getFullYear()}年${d.getMonth() + 1}月`,
                }}
                disabled={(d) =>
                  Boolean(holidayDateSet?.has(format(d, 'yyyy-MM-dd')))
                }
                className="w-full"
                classNames={
                  {
                    day: 'relative h-14 w-12 flex-1 p-0 text-center text-sm',
                    week: 'mt-2 flex w-full',
                  } as Partial<ClassNames>
                }
                components={{
                  DayButton: (
                    props: ComponentPropsWithoutRef<'button'> & {
                      day: { date: Date };
                      modifiers: Modifiers;
                    },
                  ) => {
                    const { day, modifiers, ...restProps } = props;
                    const dKey = format(day.date, 'yyyy-MM-dd');
                    const isHoliday = Boolean(holidayDateSet?.has(dKey));
                    const registeredCount =
                      unavailableCountByDate.get(dKey) ?? 0;
                    const totalSlots = timeSlots.length;

                    let mark: string | null = null;
                    if (isHoliday) {
                      mark = '休';
                    } else if (
                      totalSlots > 0 &&
                      registeredCount >= totalSlots
                    ) {
                      mark = '全';
                    } else if (registeredCount > 0) {
                      mark = String(registeredCount);
                    }

                    return (
                      <button
                        {...restProps}
                        className={cn(
                          'relative flex h-full w-full flex-col items-center justify-start rounded-md pt-2 transition-colors',
                          modifiers.selected &&
                            'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                          modifiers.outside &&
                            'text-muted-foreground opacity-50',
                          modifiers.disabled && 'cursor-not-allowed opacity-50',
                          !modifiers.selected &&
                            !modifiers.outside &&
                            !modifiers.disabled &&
                            'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        <span className="text-sm font-medium">
                          {day.date.getDate()}
                        </span>
                        {mark && (
                          <span
                            className={cn(
                              'mt-1 text-sm font-bold tabular-nums',
                              modifiers.selected
                                ? 'text-primary-foreground'
                                : mark === '休'
                                  ? 'text-red-500'
                                  : mark === '全'
                                    ? 'text-orange-600'
                                    : 'text-blue-600',
                            )}
                          >
                            {mark}
                          </span>
                        )}
                      </button>
                    );
                  },
                }}
              />
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-center text-xs">
            <span className="font-bold text-blue-600">数字</span>
            =授業不可の登録数{' '}
            <span className="font-bold text-orange-600">全</span>
            =全日登録 <span className="font-bold text-red-500">休</span>
            =休業日（登録不可）
          </p>

          {date && !isSelectedDateHoliday && (
            <Card className="animate-in fade-in slide-in-from-bottom-4 border-primary/20 shadow-md duration-300">
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-center text-lg">
                  {format(date, 'M月d日')} の授業不可時間帯
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {timeSlots.length === 0 ? (
                  <p className="text-muted-foreground text-center text-sm">
                    登録できる時間枠がありません。
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {timeSlots.map((slot) => {
                      const hasLesson = lessonSlotIdsOnSelectedDate.has(
                        slot.id,
                      );
                      const isSelected = draftSlotIds.has(slot.id);
                      return (
                        <Button
                          key={slot.id}
                          type="button"
                          variant={isSelected ? 'default' : 'outline'}
                          disabled={hasLesson}
                          aria-pressed={isSelected}
                          className={cn(
                            'flex h-auto flex-col gap-1 py-3',
                            isSelected && 'ring-primary ring-2 ring-offset-1',
                            hasLesson &&
                              'bg-muted cursor-not-allowed opacity-60',
                          )}
                          onClick={() => toggleSlot(slot.id)}
                        >
                          <span className="font-bold tabular-nums">
                            {slot.startTime} - {slot.endTime}
                          </span>
                          {hasLesson ? (
                            <Badge variant="secondary">授業あり</Badge>
                          ) : isSelected ? (
                            <span className="text-primary-foreground/90 text-xs">
                              授業不可
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              タップで登録
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {message && (
                  <p
                    className={cn(
                      'text-center text-sm',
                      message.type === 'success'
                        ? 'text-green-600'
                        : 'text-destructive',
                    )}
                    role={message.type === 'error' ? 'alert' : undefined}
                  >
                    {message.text}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    disabled={isSaving || draftSlotIds.size === 0}
                    onClick={() => {
                      setDraftSlotIds(new Set());
                      setMessage(null);
                    }}
                  >
                    すべて解除
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={isSaving}
                    onClick={() => void handleSave()}
                  >
                    {isSaving ? '保存中…' : '保存する'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
