import { useCallback, useEffect, useState } from 'react';
import { ja } from 'date-fns/locale';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { combineLocalDateAndHm } from '@/lib/calendarTime';

type TeacherRow = {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role?: string;
};

type StudentRow = { id: string; name: string };
type PresetRow = { id: string; name: string };
type TimeSlotRow = { id: string; startTime: string; endTime: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: string;
  getAccessTokenSilently: () => Promise<string>;
  initialDate: Date;
  onCreated: () => void;
  /** staff のとき API 上は自分のみ登録可（一覧は全員表示し、選択は自分のみ有効） */
  actorUserId: string;
  actorRole: 'admin' | 'manager' | 'staff' | null;
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return body.message ? `${fallback}（${body.message}）` : fallback;
}

export default function CreateLessonDialog({
  open,
  onOpenChange,
  classroomId,
  getAccessTokenSilently,
  initialDate,
  onCreated,
  actorUserId,
  actorRole,
}: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [subjects, setSubjects] = useState<PresetRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<PresetRow[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [lessonDate, setLessonDate] = useState<Date>(initialDate);
  const [teacherId, setTeacherId] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [subjectId, setSubjectId] = useState<string>('');
  const [lessonTypeId, setLessonTypeId] = useState<string>('');
  const [timeSlotId, setTimeSlotId] = useState<string>('');

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessTokenSilently();
      return fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessTokenSilently],
  );

  useEffect(() => {
    if (open) {
      setLessonDate(initialDate);
    }
  }, [open, initialDate]);

  useEffect(() => {
    if (!open || !classroomId) {
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const userQs = new URLSearchParams({ includeAdmins: '1' });
        const [uRes, sRes, subRes, ltRes, tsRes] = await Promise.all([
          authedFetch(`/api/users/${encodeURIComponent(classroomId)}?${userQs}`),
          authedFetch(`/api/students/${encodeURIComponent(classroomId)}`),
          authedFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/subjects`),
          authedFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/lesson-types`),
          authedFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/time-slots`),
        ]);
        if (cancelled) {
          return;
        }
        if (!uRes.ok) {
          setLoadError(await readApiError(uRes, '講師一覧の取得に失敗しました'));
          return;
        }
        if (!sRes.ok) {
          setLoadError(await readApiError(sRes, '生徒一覧の取得に失敗しました'));
          return;
        }
        if (!subRes.ok) {
          setLoadError(await readApiError(subRes, '科目の取得に失敗しました'));
          return;
        }
        if (!ltRes.ok) {
          setLoadError(await readApiError(ltRes, '授業種別の取得に失敗しました'));
          return;
        }
        if (!tsRes.ok) {
          setLoadError(await readApiError(tsRes, '時間枠の取得に失敗しました'));
          return;
        }
        let uJson = (await uRes.json()) as TeacherRow[];
        uJson = [...uJson].sort((a, b) => {
          const an = `${a.lastName} ${a.firstName}`.trim();
          const bn = `${b.lastName} ${b.firstName}`.trim();
          return an.localeCompare(bn, 'ja');
        });
        const sJson = (await sRes.json()) as StudentRow[];
        const subJson = (await subRes.json()) as PresetRow[];
        const ltJson = (await ltRes.json()) as PresetRow[];
        const tsJson = (await tsRes.json()) as TimeSlotRow[];
        setTeachers(uJson);
        setStudents(sJson);
        setSubjects(subJson);
        setLessonTypes(ltJson);
        setTimeSlots(tsJson);
        setTeacherId(actorRole === 'staff' && actorUserId ? actorUserId : '');
        setStudentId('');
        setSubjectId('');
        setLessonTypeId('');
        setTimeSlotId('');
        setSubmitError(null);
      } catch {
        if (!cancelled) {
          setLoadError('ネットワークエラーが発生しました。');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, classroomId, authedFetch, actorRole, actorUserId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!teacherId || !studentId || !timeSlotId) {
      setSubmitError('講師・生徒・時間枠を選択してください。');
      return;
    }
    const slot = timeSlots.find((t) => t.id === timeSlotId);
    if (!slot) {
      setSubmitError('時間枠が無効です。');
      return;
    }
    const startAt = combineLocalDateAndHm(lessonDate, slot.startTime);
    const endAt = combineLocalDateAndHm(lessonDate, slot.endTime);
    if (startAt.getTime() >= endAt.getTime()) {
      setSubmitError('終了時刻は開始時刻より後である必要があります。');
      return;
    }
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        classroomId,
        teacherId,
        studentId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        status: 'published',
      };
      if (subjectId) {
        body.subjectId = subjectId;
      }
      if (lessonTypeId) {
        body.lessonTypeId = lessonTypeId;
      }
      const res = await authedFetch('/api/lessons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const msg = await readApiError(res, '時間が重複しています');
        setSubmitError(msg);
        return;
      }
      if (!res.ok) {
        setSubmitError(await readApiError(res, '登録に失敗しました'));
        return;
      }
      onCreated();
      onOpenChange(false);
    } catch {
      setSubmitError('ネットワークエラーが発生しました。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>コマを登録</DialogTitle>
        </DialogHeader>
        {loadError && <p className="text-sm text-rose-300">{loadError}</p>}
        {isLoading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : (
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label>日付</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="justify-start font-normal">
                    {format(lessonDate, 'yyyy年M月d日', { locale: ja })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    required
                    selected={lessonDate}
                    onSelect={(d) => d && setLessonDate(d)}
                    defaultMonth={lessonDate}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lesson-teacher">講師</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger id="lesson-teacher">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => {
                    const roleLabel =
                      t.role === 'admin' ? '管理者' : t.role === 'manager' ? '教室長' : null;
                    const staffLocked = actorRole === 'staff' && t.id !== actorUserId;
                    return (
                      <SelectItem key={t.id} value={t.id} disabled={staffLocked}>
                        {t.lastName} {t.firstName}
                        {roleLabel ? `（${roleLabel}）` : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lesson-student">生徒</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger id="lesson-student">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lesson-subject">科目（任意）</Label>
              <Select value={subjectId || '_none'} onValueChange={(v) => setSubjectId(v === '_none' ? '' : v)}>
                <SelectTrigger id="lesson-subject">
                  <SelectValue placeholder="なし" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">なし</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lesson-type">授業種別（任意）</Label>
              <Select value={lessonTypeId || '_none'} onValueChange={(v) => setLessonTypeId(v === '_none' ? '' : v)}>
                <SelectTrigger id="lesson-type">
                  <SelectValue placeholder="なし" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">なし</SelectItem>
                  {lessonTypes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lesson-slot">時間枠</Label>
              <Select value={timeSlotId} onValueChange={setTimeSlotId}>
                <SelectTrigger id="lesson-slot">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.startTime}–{s.endTime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {submitError && <p className="text-sm text-rose-300">{submitError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? '登録中...' : '登録'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
