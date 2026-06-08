/**
 * （責務）生徒向け共有ビュー（未認証）。student_id クエリで月次コマを表示。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import { Button } from '@/components/ui/button';
import MonthCalendar from '@/components/ui/full-calendar';

dayjs.locale('ja');

type PublicLesson = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  teacherDisplay: string;
  teacherColor: string | null;
  subjectName: string | null;
  lessonTypeName: string | null;
};

export default function SharedStudentCalendarPage() {
  const [searchParams] = useSearchParams();
  const studentId = (searchParams.get('student_id') ?? '').trim();
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [studentName, setStudentName] = useState('');
  const [lessons, setLessons] = useState<PublicLesson[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);

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
        setLessons([]);
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
          setLessons([]);
          return;
        }
        if (!res.ok) {
          setListError('コマ一覧の取得に失敗しました。');
          setStudentName('');
          setLessons([]);
          return;
        }
        const data = (await res.json()) as {
          studentName?: string;
          lessons?: PublicLesson[];
        };
        if (!isDisposed) {
          setStudentName(data.studentName ?? '');
          setLessons(data.lessons ?? []);
        }
      } catch {
        if (!isDisposed) {
          setListError('ネットワークエラーが発生しました。');
          setStudentName('');
          setLessons([]);
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

  const calendarEvents = useMemo(() => {
    return lessons.map((l) => {
      const subLt = [l.subjectName, l.lessonTypeName]
        .filter(Boolean)
        .join(' · ');
      return {
        id: l.id,
        title: `${dayjs(l.startAt).format('HH:mm')}–${dayjs(l.endAt).format('HH:mm')} ${l.teacherDisplay}${
          subLt ? ` (${subLt})` : ''
        }`,
        start: l.startAt,
        end: l.endAt,
        backgroundColor:
          l.teacherColor && /^#([0-9a-fA-F]{6})$/.test(l.teacherColor)
            ? l.teacherColor
            : '#6366f1',
        borderColor:
          l.teacherColor && /^#([0-9a-fA-F]{6})$/.test(l.teacherColor)
            ? l.teacherColor
            : '#6366f1',
        textColor: '#ffffff',
      };
    });
  }, [lessons]);

  if (!studentId) {
    return (
      <div className="mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-lg font-semibold">共有カレンダー</h1>
        <p className="text-sm text-muted-foreground">
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
          <h1 className="text-lg font-semibold text-foreground md:text-xl">
            共有カレンダー{studentName ? `(${studentName})` : ''}
          </h1>
        </div>
      </div>

      {listError && (
        <p className="text-sm text-destructive" role="alert">
          {listError}
        </p>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground">
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
          <p className="text-sm text-muted-foreground">月のコマを読み込み中...</p>
        ) : (
          <MonthCalendar
            focusDate={focusDate}
            events={calendarEvents}
            onFocusDateChange={setFocusDate}
          />
        )}
      </div>
    </section>
  );
}
