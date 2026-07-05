import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClassNames } from 'react-day-picker';
import type { Modifiers } from 'react-day-picker';
import { Link } from 'react-router-dom';

import { endOfMonth, format, startOfMonth } from 'date-fns';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { useSelectedClassroom } from '@/hooks/useSelectedClassroom';
import { cn } from '@/lib/utils';
import type { CurrentUser } from '@/types/currentUser';

dayjs.extend(utc);
dayjs.extend(timezone);

type TimeSlotRow = {
  id: string;
  startTime: string;
  endTime: string;
};

type StudentRow = {
  id: string;
  name: string;
};

// 💡 授業タイプと科目の型を追加
type LessonTypeRow = {
  id: string;
  name: string;
};

type SubjectRow = {
  id: string;
  name: string;
};

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

type Lesson = {
  teacherId: string;
  studentId: string;
  startAt: string;
  endAt: string;
  subject: string;
  lessonType: string;
};

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export default function CalendarSingleEditPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const { activeClassroom } = useSelectedClassroom();
  const authedFetch = useAuthedFetch(getAccessTokenSilently);

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<LessonTypeRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);

  // その月の「教室全体の授業データ」を丸ごと保持します
  const [monthLessons, setMonthLessons] = useState<Lesson[]>([]);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedLessonTypeId, setSelectedLessonTypeId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const dateKey = date ? format(date, 'yyyy-MM-dd') : null;

  // 1. 初期データの取得（時間枠、生徒、授業タイプ、科目）
  useEffect(() => {
    if (!activeClassroom) return;
    const fetchData = async () => {
      const [tsRes, stRes, ltRes, subRes] = await Promise.all([
        authedFetch(
          `/api/time-slots/${encodeURIComponent(activeClassroom.id)}`,
        ),
        authedFetch(`/api/students/${encodeURIComponent(activeClassroom.id)}`),
        authedFetch(
          `/api/lesson-types/${encodeURIComponent(activeClassroom.id)}`,
        ),
        authedFetch(`/api/subjects/${encodeURIComponent(activeClassroom.id)}`),
      ]);

      if (tsRes.ok) {
        const data = (await tsRes.json()) as TimeSlotRow[];
        setTimeSlots(
          data.sort(
            (a, b) => hmToMinutes(a.startTime) - hmToMinutes(b.startTime),
          ),
        );
      }
      if (stRes.ok) {
        const data = (await stRes.json()) as StudentRow[];
        setStudents(data);
      }
      if (ltRes.ok) {
        const data = (await ltRes.json()) as LessonTypeRow[];
        setLessonTypes(data);
      }
      if (subRes.ok) {
        const data = (await subRes.json()) as SubjectRow[];
        setSubjects(data);
      }
    };
    void fetchData();
  }, [activeClassroom, authedFetch]);

  // 2. 月ごとの授業状況取得（教室全体のデータを取得）
  const fetchMonthShifts = useCallback(async () => {
    if (!activeClassroom || !currentUser || timeSlots.length === 0) return;
    setIsLoading(true);
    try {
      const from = startOfMonth(month).toISOString();
      const to = endOfMonth(month).toISOString();

      const res = await authedFetch(
        `/api/lessons/${encodeURIComponent(activeClassroom.id)}?from=${from}&to=${to}`,
      );

      if (res.ok) {
        const lessons = (await res.json()) as Lesson[];
        setMonthLessons(lessons); // 絞り込まずに全体を保存
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [activeClassroom, currentUser, month, timeSlots, authedFetch]);

  useEffect(() => {
    if (timeSlots.length > 0) void fetchMonthShifts();
  }, [fetchMonthShifts, timeSlots.length]);

  // 3. 【重要】講師と生徒の「両方の予定」を計算して塞がっている枠を割り出す
  const unavailableSlotsByDate = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    if (!currentUser || !selectedStudentId) return map;

    // 自分(講師) または 選んだ生徒 のどちらかが入っている授業を抽出
    const relevantLessons = monthLessons.filter(
      (l) =>
        l.teacherId === currentUser.id || l.studentId === selectedStudentId,
    );

    for (const lesson of relevantLessons) {
      const localDate = new Date(lesson.startAt);
      const dKey = format(localDate, 'yyyy-MM-dd');
      const hKey = format(localDate, 'HH:mm');

      const slot = timeSlots.find((ts) => ts.startTime === hKey);
      if (slot) {
        if (!map[dKey]) map[dKey] = new Set();
        map[dKey].add(slot.id); // 塞がっている枠IDとして登録
      }
    }
    return map;
  }, [monthLessons, currentUser, selectedStudentId, timeSlots]);

  // 生徒や日付が変わったら選択状態とメッセージをリセット
  useEffect(() => {
    setSelectedSlotId(null);
    setMessage(null);
  }, [dateKey, selectedStudentId]);

  // 4. 1コマ登録処理
  const handleSave = async () => {
    if (
      !activeClassroom ||
      !currentUser ||
      !dateKey ||
      !selectedSlotId ||
      !selectedStudentId
    ) {
      setMessage({ text: '時間と生徒を選択してください。', type: 'error' });
      return;
    }

    if (
      !selectedLessonTypeId || !selectedSubjectId
    ) {
      setMessage({ text: '科目・授業種別を選択してください。', type: 'error' });
      return;
    }

    const slot = timeSlots.find((s) => s.id === selectedSlotId);
    if (!slot) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const startDateTime = dayjs.tz(
        `${dateKey} ${slot.startTime}`,
        'YYYY-MM-DD HH:mm',
        'Asia/Tokyo',
      );
      const endDateTime = dayjs.tz(
        `${dateKey} ${slot.endTime}`,
        'YYYY-MM-DD HH:mm',
        'Asia/Tokyo',
      );

      if (!startDateTime.isValid() || !endDateTime.isValid()) {
        throw new Error('日時の形式が不正です');
      }

      // 💡 保存するデータに lessonTypeId と subjectId を追加
      const requestBody = {
        classroomId: activeClassroom.id,
        teacherId: currentUser.id,
        studentId: selectedStudentId,
        lessonTypeId: selectedLessonTypeId,
        subjectId: selectedSubjectId,
        startAt: startDateTime.toISOString(),
        endAt: endDateTime.toISOString(),
      };

      const res = await authedFetch('/api/lessons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || '保存に失敗しました');
      }

      setMessage({ text: '授業を登録しました！', type: 'success' });
      setSelectedSlotId(null);
      await fetchMonthShifts(); // 保存後、カレンダーを再計算
    } catch (e: unknown) {
      if (e instanceof Error) {
        setMessage({ text: e.message, type: 'error' });
      } else {
        setMessage({ text: 'エラーが発生しました', type: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentUser) return <p className="text-sm">アクセスできません。</p>;

  return (
    <section className="mx-auto max-w-xl space-y-6 pb-40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">コマ登録</h2>
          <p className="text-muted-foreground text-sm">
            教室: {activeClassroom?.name || '未選択'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/calendar">カレンダーへ</Link>
        </Button>
      </div>

      {isLoading && timeSlots.length === 0 ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : (
        <>
          {/* 1. 生徒選択エリア */}
          <Card className="border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <label className="text-primary text-sm font-bold">
                1. 生徒を選択してください
              </label>
              <Select
                value={selectedStudentId || undefined}
                onValueChange={setSelectedStudentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="--- 生徒を選択 ---" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* 生徒が選択されていない場合は、ここで表示をストップ */}
          {!selectedStudentId ? (
            <p className="text-muted-foreground pt-4 text-center text-sm">
              生徒を選択すると、お互いの空き時間カレンダーが表示されます。
            </p>
          ) : (
            <>
              {/* 2. カレンダーエリア */}
              <Card className="shadow-sm">
                <CardContent className="flex justify-center p-3">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    month={month}
                    onMonthChange={setMonth}
                    className="w-full"
                    classNames={
                      {
                        day: 'relative h-14 w-12 flex-1 p-0 text-center text-sm',
                        week: 'mt-2 flex w-full'
                      } as Partial<ClassNames>
                    }
                    components={{
                      DayButton: (
                        props: React.ComponentPropsWithoutRef<'button'> & {
                          day: { date: Date };
                          modifiers: Modifiers;
                        },
                      ) => {
                        const { day, modifiers, ...restProps } = props;
                        const dKey = format(day.date, 'yyyy-MM-dd');

                        // その日の塞がっている枠数を計算
                        const busySlotCount =
                          unavailableSlotsByDate[dKey]?.size || 0;
                        const totalSlots = timeSlots.length;
                        const availableCount = totalSlots - busySlotCount;

                        let mark = null;
                        if (totalSlots > 0) {
                          if (availableCount <= 0) {
                            mark = '×';
                          } else if (availableCount === 1) {
                            mark = '△';
                          } else {
                            mark = '○';
                          }
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
                              !modifiers.selected &&
                              !modifiers.outside &&
                              'hover:bg-accent hover:text-accent-foreground',
                            )}
                          >
                            <span className="text-sm font-medium">
                              {day.date.getDate()}
                            </span>
                            {mark && (
                              <span
                                className={cn(
                                  'mt-1 text-sm font-bold',
                                  modifiers.selected
                                    ? 'text-primary-foreground'
                                    : mark === '×'
                                      ? 'text-red-500'
                                      : mark === '△'
                                        ? 'text-yellow-500'
                                        : 'text-blue-500',
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

              {/* 3. 時間帯選択エリア */}
              {date && (
                <Card className="animate-in fade-in slide-in-from-bottom-4 border-primary/20 shadow-md duration-300">
                  <CardHeader className="border-b pb-3">
                    <CardTitle className="text-center text-lg">
                      {format(date, 'M月d日')} のコマ登録
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      {timeSlots.map((slot) => {
                        const isSelected = selectedSlotId === slot.id;
                        // 講師か生徒のどちらかが塞がっていれば disabled にする
                        const isUnavailable = dateKey
                          ? unavailableSlotsByDate[dateKey]?.has(slot.id)
                          : false;

                        return (
                          <Button
                            key={slot.id}
                            variant={isSelected ? 'default' : 'outline'}
                            className={cn(
                              'flex h-auto flex-col py-3',
                              isSelected && 'ring-primary ring-2 ring-offset-1',
                              isUnavailable &&
                              'bg-muted cursor-not-allowed opacity-50',
                            )}
                            onClick={() =>
                              !isUnavailable && setSelectedSlotId(slot.id)
                            }
                            disabled={isUnavailable}
                          >
                            <span className="font-bold">
                              {slot.startTime} - {slot.endTime}
                            </span>
                            {isUnavailable && (
                              <span className="mt-1 text-xs font-normal text-red-500">
                                予定あり
                              </span>
                            )}
                          </Button>
                        );
                      })}
                    </div>

                    {selectedSlotId && (
                      <div className="animate-in fade-in slide-in-from-top-2 bg-muted/30 mt-4 space-y-5 rounded-lg border p-4 duration-200">
                        {/* 🌟 4. 授業タイプと科目の選択エリア */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-bold">
                              授業種別
                            </label>
                            <Select
                              value={selectedLessonTypeId || undefined}
                              onValueChange={setSelectedLessonTypeId}
                            >
                              <SelectTrigger className="bg-background">
                                <SelectValue placeholder="--- 選択 ---" />
                              </SelectTrigger>
                              <SelectContent>
                                {lessonTypes.map((lt) => (
                                  <SelectItem key={lt.id} value={lt.id}>
                                    {lt.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-bold">科目</label>
                            <Select
                              value={selectedSubjectId || undefined}
                              onValueChange={setSelectedSubjectId}
                            >
                              <SelectTrigger className="bg-background">
                                <SelectValue placeholder="--- 選択 ---" />
                              </SelectTrigger>
                              <SelectContent>
                                {subjects.map((sub) => (
                                  <SelectItem key={sub.id} value={sub.id}>
                                    {sub.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {message && (
                          <p
                            className={cn(
                              'text-center text-sm font-bold',
                              message.type === 'success'
                                ? 'text-green-600'
                                : 'text-red-600',
                            )}
                          >
                            {message.text}
                          </p>
                        )}
                        <Button
                          className="h-12 w-full text-lg shadow-sm"
                          onClick={handleSave}
                          disabled={isSaving}
                        >
                          {isSaving ? '登録中...' : 'このコマを登録する'}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
