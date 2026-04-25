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
  setDraftSlots: React.Dispatch<React.SetStateAction<Record<string, SlotDraft>>>;
  onPatch: (id: string) => void;
  onDisable: (id: string) => void;
};

/**
 * 教室ごとの「時間枠」一覧: 追加用 time input + 行の開始終了編集
 */
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
        <div>
          <label htmlFor="new-slot-start" className="mb-1 block text-xs text-slate-400">
            開始
          </label>
          <input
            id="new-slot-start"
            type="time"
            value={newSlotStart}
            onChange={(e) => onNewSlotStartChange(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="new-slot-end" className="mb-1 block text-xs text-slate-400">
            終了
          </label>
          <input
            id="new-slot-end"
            type="time"
            value={newSlotEnd}
            onChange={(e) => onNewSlotEndChange(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
        >
          追加
        </button>
      </form>
      <ul className="mt-4 space-y-2">
        {timeSlots.map((row) => {
          const d = draftSlots[row.id] ?? { start: row.startTime, end: row.endTime };
          return (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-end"
            >
              <div className="flex flex-wrap gap-2">
                <div>
                  <span className="mb-1 block text-xs text-slate-400">開始</span>
                  <input
                    type="time"
                    aria-label={`時間枠開始 ${row.id}`}
                    value={d.start}
                    onChange={(e) =>
                      setDraftSlots((prev) => ({
                        ...prev,
                        [row.id]: { ...d, start: e.target.value },
                      }))
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-slate-400">終了</span>
                  <input
                    type="time"
                    aria-label={`時間枠終了 ${row.id}`}
                    value={d.end}
                    onChange={(e) =>
                      setDraftSlots((prev) => ({
                        ...prev,
                        [row.id]: { ...d, end: e.target.value },
                      }))
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
                <button
                  type="button"
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => void onPatch(row.id)}
                >
                  更新
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900/60"
                  onClick={() => void onDisable(row.id)}
                >
                  無効化
                </button>
              </div>
            </li>
          );
        })}
        {timeSlots.length === 0 && <li className="text-sm text-slate-500">時間枠がまだありません。</li>}
      </ul>
    </PresetSection>
  );
}
