/**
 * （責務）教室ごとの授業種別の追加・行編集・無効化 UI。
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LessonTypeListItem } from '@/types/api';

import PresetSection from './PresetSection';

type Props = {
  lessonTypes: LessonTypeListItem[];
  newLessonTypeName: string;
  onNewLessonTypeNameChange: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  draftNames: Record<string, string>;
  setDraftNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onPatch: (id: string) => void;
  onDisable: (id: string) => void;
};

export default function LessonTypesBlock({
  lessonTypes,
  newLessonTypeName,
  onNewLessonTypeNameChange,
  onAdd,
  draftNames,
  setDraftNames,
  onPatch,
  onDisable,
}: Props) {
  return (
    <PresetSection title="授業種別">
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-2">
          <Label htmlFor="new-lesson-type">追加</Label>
          <Input
            id="new-lesson-type"
            value={newLessonTypeName}
            onChange={(e) => onNewLessonTypeNameChange(e.target.value)}
            placeholder="例: 通常"
            maxLength={100}
          />
        </div>
        <Button type="submit">追加</Button>
      </form>
      <ul className="space-y-3">
        {lessonTypes.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <Input
              aria-label={`授業種別 ${row.name}`}
              value={draftNames[row.id] ?? row.name}
              onChange={(e) =>
                setDraftNames((prev) => ({ ...prev, [row.id]: e.target.value }))
              }
              maxLength={100}
              className="min-w-0 flex-1"
            />
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onPatch(row.id)}
              >
                更新
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void onDisable(row.id)}
              >
                無効化
              </Button>
            </div>
          </li>
        ))}
        {lessonTypes.length === 0 && (
          <li className="text-sm text-muted-foreground">
            授業種別がまだありません。
          </li>
        )}
      </ul>
    </PresetSection>
  );
}
