/**
 * （責務）教室ごとの時間枠の追加・開始終了編集・無効化 UI。
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TimeSlotListItem } from '@/types/api';

import PresetSection from './PresetSection';

type SlotDraft = { start: string; end: string };

type Props = {
  timeSlots: TimeSlotListItem[];
  newSlotStart: string;
  newSlotEnd: string;
  onNewSlotStartChange: (v: string) => void;
  onNewSlotEndChange: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  draftSlots: Record<string, SlotDraft>;
  setDraftSlots: React.Dispatch<
    React.SetStateAction<Record<string, SlotDraft>>
  >;
  onPatch: (id: string) => void;
  onDisable: (id: string) => void;
};

export default function TimeSlotsBlock({
  timeSlots,
  newSlotStart,
  newSlotEnd,
  onNewSlotStartChange,
  onNewSlotEndChange,
  onAdd,
  draftSlots,
  setDraftSlots,
  onPatch,
  onDisable,
}: Props) {
  return (
    <PresetSection title="時間枠">
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
        <div className="space-y-2">
          <Label htmlFor="new-slot-start">開始</Label>
          <Input
            id="new-slot-start"
            type="time"
            value={newSlotStart}
            onChange={(e) => onNewSlotStartChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-slot-end">終了</Label>
          <Input
            id="new-slot-end"
            type="time"
            value={newSlotEnd}
            onChange={(e) => onNewSlotEndChange(e.target.value)}
          />
        </div>
        <Button type="submit">追加</Button>
      </form>
      <ul className="space-y-3">
        {timeSlots.map((row) => {
          const d = draftSlots[row.id] ?? {
            start: row.startTime,
            end: row.endTime,
          };
          return (
            <li
              key={row.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <div className="flex flex-wrap gap-2">
                <div className="space-y-2">
                  <Label className="text-xs">開始</Label>
                  <Input
                    type="time"
                    aria-label={`時間枠開始 ${row.id}`}
                    value={d.start}
                    onChange={(e) =>
                      setDraftSlots((prev) => ({
                        ...prev,
                        [row.id]: { ...d, start: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">終了</Label>
                  <Input
                    type="time"
                    aria-label={`時間枠終了 ${row.id}`}
                    value={d.end}
                    onChange={(e) =>
                      setDraftSlots((prev) => ({
                        ...prev,
                        [row.id]: { ...d, end: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
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
          );
        })}
        {timeSlots.length === 0 && (
          <li className="text-muted-foreground text-sm">
            時間枠がまだありません。
          </li>
        )}
      </ul>
    </PresetSection>
  );
}
