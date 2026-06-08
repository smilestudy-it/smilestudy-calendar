import dayjs from 'dayjs';

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
import { Separator } from '@/components/ui/separator';

export type LessonPresetRow = { id: string; name: string };

export type LessonDetailTarget = {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
  subjectId?: string | null;
  lessonTypeId?: string | null;
};

/** @deprecated 互換のため。`LessonDetailTarget` と同じ */
export type LessonDeleteTarget = LessonDetailTarget;

type Props = {
  event: LessonDetailTarget | null;
  isDeleting?: boolean;
  error: string | null;
  onClose: () => void;
  onDelete?: () => void;
  presetSubjects?: LessonPresetRow[];
  presetLessonTypes?: LessonPresetRow[];
  isSavingPresets?: boolean;
  presetsError?: string | null;
  onPresetChange?: (next: {
    subjectId: string | null;
    lessonTypeId: string | null;
  }) => void;
  onSavePresets?: () => void;
};

export default function LessonDeletePanel({
  event,
  isDeleting = false,
  error,
  onClose,
  onDelete,
  presetSubjects,
  presetLessonTypes,
  isSavingPresets = false,
  presetsError = null,
  onPresetChange,
  onSavePresets,
}: Props) {
  if (!event) {
    return null;
  }

  const showPresets =
    presetSubjects !== undefined &&
    presetLessonTypes !== undefined &&
    onPresetChange &&
    onSavePresets;

  const subjectVal = event.subjectId ?? '_none';
  const lessonTypeVal = event.lessonTypeId ?? '_none';

  return (
    <div className="space-y-4 pt-4">
      <Separator />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">コマの詳細</p>
          <p className="text-sm">{event.title}</p>
          <p className="text-muted-foreground text-xs">
            {event.start ? dayjs(event.start).format('YYYY/MM/DD HH:mm') : '-'}{' '}
            – {event.end ? dayjs(event.end).format('HH:mm') : '-'}
          </p>

          {showPresets && (
            <div className="grid gap-2 pt-2 sm:max-w-xl sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">科目</Label>
                <Select
                  value={subjectVal}
                  disabled={isDeleting || isSavingPresets}
                  onValueChange={(v) =>
                    onPresetChange({
                      subjectId: v === '_none' ? null : v,
                      lessonTypeId: event.lessonTypeId ?? null,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="なし" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">なし</SelectItem>
                    {presetSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">授業種別</Label>
                <Select
                  value={lessonTypeVal}
                  disabled={isDeleting || isSavingPresets}
                  onValueChange={(v) =>
                    onPresetChange({
                      subjectId: event.subjectId ?? null,
                      lessonTypeId: v === '_none' ? null : v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="なし" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">なし</SelectItem>
                    {presetLessonTypes.map((s) => (
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
                  size="sm"
                  disabled={isDeleting || isSavingPresets}
                  onClick={() => onSavePresets()}
                >
                  {isSavingPresets ? '保存中...' : '科目・種別を保存'}
                </Button>
              </div>
            </div>
          )}

          {presetsError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-xs">
                {presetsError}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
          >
            閉じる
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting ? '削除中...' : '削除'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
