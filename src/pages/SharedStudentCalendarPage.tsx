/**
 * （責務）生徒向け共有ビュー（未認証）。student_id クエリで週次コマのみ表示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { startOfWeekSunday } from '@/lib/calendarTime';

dayjs.locale('ja');

type PublicLesson = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  teacherDisplay: string;
  subjectName: string | null;
  lessonTypeName: string | null;
};

export default function SharedStudentCalendarPage() {
  const [searchParams] = useSearchParams();
  const studentId = (searchParams.get('student_id') ?? '').trim();
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [lessons, setLessons] = useState<PublicLesson[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingWeek, setIsLoadingWeek] = useState(false);
  const weekRequestIdRef = useRef(0);

  const weekStart = useMemo(() => startOfWeekSunday(focusDate), [focusDate]);
  const weekEndExclusive = useMemo(() => weekStart.add(7, 'day'), [weekStart]);
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
  }, [weekStart]);

  const reloadWeek = useCallback(async () => {
    if (!studentId) {
      setLessons([]);
      return;
    }
    const requestId = ++weekRequestIdRef.current;
    setIsLoadingWeek(true);
    setListError(null);
    try {
      const from = weekStart.toISOString();
      const to = weekEndExclusive.toISOString();
      const qs = new URLSearchParams({ student_id: studentId, from, to });
      const res = await fetch(`/api/public/student-lessons?${qs}`);
      if (weekRequestIdRef.current !== requestId) {
        return;
      }
      if (res.status === 404) {
        setListError('表示できません。リンクが無効か、対象の生徒が見つかりません。');
        setLessons([]);
        return;
      }
      if (!res.ok) {
        setListError('コマ一覧の取得に失敗しました。');
        setLessons([]);
        return;
      }
      const data = (await res.json()) as PublicLesson[];
      if (weekRequestIdRef.current !== requestId) {
        return;
      }
      setLessons(data);
    } catch {
      if (weekRequestIdRef.current === requestId) {
        setListError('ネットワークエラーが発生しました。');
      }
    } finally {
      if (weekRequestIdRef.current === requestId) {
        setIsLoadingWeek(false);
      }
    }
  }, [studentId, weekEndExclusive, weekStart]);

  useEffect(() => {
    void reloadWeek();
  }, [reloadWeek]);

  if (!studentId) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-slate-100/80 p-8 text-center shadow-xl">
        <h1 className="text-lg font-semibold text-slate-900">共有カレンダー</h1>
        <p className="mt-3 text-sm text-slate-500">
          URL に <span className="font-mono text-slate-700">student_id</span> パラメータが必要です。
        </p>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 md:text-xl">共有カレンダー</h1>
          <p className="text-xs text-slate-500">閲覧のみ（ログイン不要）</p>
        </div>
      </div>

      {listError && <p className="text-sm text-rose-600">{listError}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
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
              <Button type="button" variant="outline" size="sm" onClick={() => setFocusDate(() => new Date())}>
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
            <p className="text-sm text-slate-500">週のコマを読み込み中...</p>
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
                    className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-slate-50/50 p-2"
                  >
                    <p className="mb-2 border-b border-slate-200 pb-1 text-center text-xs font-medium text-slate-500">
                      {day.format('M/D')} {day.format('ddd')}
                    </p>
                    <ul className="flex flex-1 flex-col gap-1.5">
                      {dayLessons.map((l) => {
                        const subLt = [l.subjectName, l.lessonTypeName].filter(Boolean).join(' · ');
                        return (
                          <li
                            key={l.id}
                            className="rounded-md border border-slate-200 bg-slate-100/80 px-2 py-1.5 text-left text-xs text-slate-800"
                            style={{ borderLeftWidth: 4, borderLeftColor: '#6366f1' }}
                          >
                            <p className="font-medium text-slate-900">
                              {dayjs(l.startAt).format('HH:mm')}–{dayjs(l.endAt).format('HH:mm')}
                            </p>
                            <p className="text-slate-700">{l.teacherDisplay}</p>
                            {subLt ? <p className="text-slate-500">{subLt}</p> : null}
                            {l.status === 'completed' ? (
                              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-emerald-500/90">完了</p>
                            ) : null}
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

        <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-2">
          <Calendar
            mode="single"
            required
            month={focusDate}
            onMonthChange={(m) => m && setFocusDate(m)}
            selected={focusDate}
            onSelect={(d) => d && setFocusDate(d)}
          />
        </div>
      </div>
    </section>
  );
}
