/**
 * （責務）生徒向け共有ビュー（未認証）。student_id クエリで月次コマを表示。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import dayjs from 'dayjs';
import 'dayjs/locale/ja';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

  // 💡 選択されたコマの情報を保持するState
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

  useEffect(() => {
    setSelectedLesson(null);
  }, [studentId]);

  const calendarEvents = useMemo(() => {
    return lessons.map((l) => {
      const subLt = [l.subjectName, l.lessonTypeName]
        .filter(Boolean)
        .join(' · ');
      return {
        id: l.id,
        title: `${dayjs(l.startAt).format('HH:mm')}${
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
          <MonthCalendar
            focusDate={focusDate}
            events={calendarEvents}
            onFocusDateChange={setFocusDate}
            onEventClick={(event) => {
              // 💡 イベントがクリックされたら詳細を表示
              const lesson = lessons.find((l) => l.id === event.id);
              if (lesson) {
                setSelectedLesson(lesson);
              }
            }}
          />
        )}
      </div>

      {/* 💡 コマの詳細表示用モーダル (閲覧専用) */}
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
                  {selectedLesson.lessonTypeName || '未設定'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">
                  科目
                </span>
                <span className="font-medium">
                  {selectedLesson.subjectName || '未設定'}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
