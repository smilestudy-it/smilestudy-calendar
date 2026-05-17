/**
 * （責務）週スロットグリッドのセルキー（日付＋時間枠ID）の生成・分解。
 */
export const WEEK_SLOT_CELL_SEP = '\t';

export function weekSlotCellKey(dateKey: string, timeSlotId: string): string {
  return `${dateKey}${WEEK_SLOT_CELL_SEP}${timeSlotId}`;
}

export function parseWeekSlotCellKey(key: string): { dateKey: string; timeSlotId: string } | null {
  const i = key.indexOf(WEEK_SLOT_CELL_SEP);
  if (i <= 0 || i === key.length - 1) {
    return null;
  }
  return { dateKey: key.slice(0, i), timeSlotId: key.slice(i + WEEK_SLOT_CELL_SEP.length) };
}
