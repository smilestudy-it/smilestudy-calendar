/**
 * （責務）週編集ページの一括操作バー（登録・削除）。
 */
import { useState } from 'react';
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
  actorRole: AppRole | null;
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
  const [subjectId, setSubjectId] = useState('');
  const [lessonTypeId, setLessonTypeId] = useState('');

  const canCreate = selectedCount > 0 && emptySlotCount === selectedCount && occupiedSlotCount === 0;
  const canDelete = selectedCount > 0 && occupiedSlotCount === selectedCount && emptySlotCount === 0;

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">
            選択中: {selectedCount} 枠（空き {emptySlotCount} / 登録済み {occupiedSlotCount}）
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onClearSelection} disabled={isSubmitting}>
            選択をクリア
          </Button>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        {!canCreate && !canDelete && (
          <p className="text-xs text-amber-700">
            空き枠だけ、または登録済み枠だけをまとめて選んでください（混在は不可）。
          </p>
        )}

        {canCreate && (
          <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">講師</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="選択" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => {
                    const roleLabel =
                      t.role === 'admin' || t.role === 'manager'
                        ? ROLE_LABEL_JA[t.role as 'admin' | 'manager']
                        : null;
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
            <div className="grid gap-1.5">
              <Label className="text-xs">生徒</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="選択" />
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
              <Label className="text-xs">科目（任意）</Label>
              <Select value={subjectId || '_none'} onValueChange={(v) => setSubjectId(v === '_none' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm">
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
            <div className="grid gap-1.5">
              <Label className="text-xs">授業種別（任意）</Label>
              <Select
                value={lessonTypeId || '_none'}
                onValueChange={(v) => setLessonTypeId(v === '_none' ? '' : v)}
              >
                <SelectTrigger className="h-9 text-sm">
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
            <div className="sm:col-span-2">
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={isSubmitting || !teacherId || !studentId}
                onClick={() =>
                  onCreate({
                    teacherId,
                    studentId,
                    subjectId,
                    lessonTypeId,
                  })
                }
              >
                {isSubmitting ? '実行中...' : '選択枠をこの内容で登録'}
              </Button>
            </div>
          </div>
        )}

        {canDelete && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              className="bg-rose-700 text-white hover:bg-rose-600"
              disabled={isSubmitting}
              onClick={onDelete}
            >
              {isSubmitting ? '実行中...' : '選択コマを削除'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
