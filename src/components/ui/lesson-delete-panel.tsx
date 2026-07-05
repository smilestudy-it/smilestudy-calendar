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
  start: Date;
  end: Date;
  subjectId: string;
  lessonTypeId: string;
  subjectDisplay: string;
  lessonTypeDisplay: string;
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
    subjectId: string;
    lessonTypeId: string;
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

  const subjectVal = event.subjectId;
  const lessonTypeVal = event.lessonTypeId;
  const subjectOptions = [...(presetSubjects ?? [])];
  if (
    subjectVal &&
    !subjectOptions.some((s) => s.id === subjectVal)
  ) {
    subjectOptions.unshift({
      id: subjectVal,
      name: event.subjectDisplay,
    });
  }
  const lessonTypeOptions = [...(presetLessonTypes ?? [])];
  if (
    lessonTypeVal &&
    !lessonTypeOptions.some((s) => s.id === lessonTypeVal)
  ) {
    lessonTypeOptions.unshift({
      id: lessonTypeVal,
      name: event.lessonTypeDisplay,
    });
  }

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
                      subjectId: v,
                      lessonTypeId: event.lessonTypeId
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="科目" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((s) => (
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
                      subjectId: event.subjectId,
                      lessonTypeId: v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="なし" />
                  </SelectTrigger>
                  <SelectContent>
                    {lessonTypeOptions.map((s) => (
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
