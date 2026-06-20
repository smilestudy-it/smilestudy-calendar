/**
 * （責務）教室ごとの科目の追加・行編集・無効化 UI。
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SubjectListItem } from '@/types/api';

import PresetSection from './PresetSection';

type Props = {
  subjects: SubjectListItem[];
  newSubjectName: string;
  onNewSubjectNameChange: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  draftNames: Record<string, string>;
  setDraftNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onPatch: (id: string) => void;
  onDisable: (id: string) => void;
};

export default function SubjectsBlock({
  subjects,
  newSubjectName,
  onNewSubjectNameChange,
  onAdd,
  draftNames,
  setDraftNames,
  onPatch,
  onDisable,
}: Props) {
  return (
    <PresetSection title="科目">
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-2">
          <Label htmlFor="new-subject">追加</Label>
          <Input
            id="new-subject"
            value={newSubjectName}
            onChange={(e) => onNewSubjectNameChange(e.target.value)}
            placeholder="例: 英語"
            maxLength={100}
          />
        </div>
        <Button type="submit">追加</Button>
      </form>
      <ul className="space-y-3">
        {subjects.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <Input
              aria-label={`科目 ${row.name}`}
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
        {subjects.length === 0 && (
          <li className="text-muted-foreground text-sm">
            科目がまだありません。
          </li>
        )}
      </ul>
    </PresetSection>
  );
}
