/**
 * （責務）週編集ページの一括操作（登録・削除）。
 */
import { useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLE_LABEL_JA } from '@/constants/roles';
import type { AppRole } from '@/types/role';

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
  selectedCount: number;
  emptySlotCount: number;
  occupiedSlotCount: number;
  teachers: TeacherRow[];
  students: StudentRow[];
  subjects: PresetRow[];
  lessonTypes: PresetRow[];
  actorUserId: string;
  actorRole: AppRole;
  isSubmitting: boolean;
  error: string | null;
  onClearSelection: () => void;
  onCreate: (params: {
    teacherId: string;
    studentId: string;
    subjectId: string;
    lessonTypeId: string;
  }) => void;
  onDelete: () => void;
};

const NONE = '_none';

export default function LessonBulkActionPanel({
  selectedCount,
  emptySlotCount,
  occupiedSlotCount,
  teachers,
  students,
  subjects,
  lessonTypes,
  actorUserId,
  actorRole,
  isSubmitting,
  error,
  onClearSelection,
  onCreate,
  onDelete,
}: Props) {
  const [teacherId, setTeacherId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [subjectId, setSubjectId] = useState(NONE);
  const [lessonTypeId, setLessonTypeId] = useState(NONE);

  const teacherOptions = useMemo(() => {
    if (actorRole === 'staff') {
      return teachers.filter((t) => t.id === actorUserId);
    }
    return teachers;
  }, [actorRole, actorUserId, teachers]);

  const canCreate =
    selectedCount > 0 &&
    emptySlotCount === selectedCount &&
    occupiedSlotCount === 0;
  const canDelete =
    selectedCount > 0 &&
    occupiedSlotCount === selectedCount &&
    emptySlotCount === 0;

  if (selectedCount === 0) {
    return null;
  }

  const effectiveTeacherId =
    actorRole === 'staff' ? actorUserId : teacherId || teacherOptions[0]?.id;

  return (
    <fieldset className="border-border space-y-4 rounded-lg border p-4">
      <legend className="text-foreground px-1 text-sm font-medium">
        選択中: {selectedCount}件（空き {emptySlotCount} / 登録済み{' '}
        {occupiedSlotCount}）
      </legend>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {canCreate && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label>講師</Label>
            <Select
              value={effectiveTeacherId}
              disabled={isSubmitting || actorRole === 'staff'}
              onValueChange={setTeacherId}
            >
              <SelectTrigger>
                <SelectValue placeholder="講師を選択" />
              </SelectTrigger>
              <SelectContent>
                {teacherOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.lastName} {t.firstName}
                    {t.role
                      ? `（${ROLE_LABEL_JA[t.role as AppRole] ?? t.role}）`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>生徒</Label>
            <Select
              value={studentId}
              disabled={isSubmitting}
              onValueChange={setStudentId}
            >
              <SelectTrigger>
                <SelectValue placeholder="生徒を選択" />
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
          <div className="grid gap-1.5">
            <Label>科目（任意）</Label>
            <Select
              value={subjectId}
              disabled={isSubmitting}
              onValueChange={setSubjectId}
            >
              <SelectTrigger>
                <SelectValue placeholder="なし" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>なし</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>授業種別（任意）</Label>
            <Select
              value={lessonTypeId}
              disabled={isSubmitting}
              onValueChange={setLessonTypeId}
            >
              <SelectTrigger>
                <SelectValue placeholder="なし" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>なし</SelectItem>
                {lessonTypes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canCreate && (
          <Button
            type="button"
            disabled={isSubmitting || !effectiveTeacherId || !studentId}
            onClick={() =>
              onCreate({
                teacherId: effectiveTeacherId,
                studentId,
                subjectId: subjectId === NONE ? '' : subjectId,
                lessonTypeId: lessonTypeId === NONE ? '' : lessonTypeId,
              })
            }
          >
            {isSubmitting ? '処理中...' : '選択枠に一括登録'}
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting}
            onClick={() => onDelete()}
          >
            {isSubmitting ? '処理中...' : '選択コマを一括削除'}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={onClearSelection}
        >
          選択をクリア
        </Button>
      </div>
    </fieldset>
  );
}
