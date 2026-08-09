/**
 * （責務）コマ登録 UI 向け：教室休業日を空き枠マップに統合する純関数。
 */
/** 休業日なら全日の枠 ID を unavailable セットへ追加する（破壊的）。 */
export function applyHolidayUnavailability(
  unavailableSlotsByDate: Record<string, Set<string>>,
  holidayDates: Iterable<string>,
  slotIds: readonly string[],
): void {
  for (const dKey of holidayDates) {
    if (!unavailableSlotsByDate[dKey]) {
      unavailableSlotsByDate[dKey] = new Set();
    }
    for (const slotId of slotIds) {
      unavailableSlotsByDate[dKey].add(slotId);
    }
  }
}

export function isHolidayDate(
  dateKey: string,
  holidayDates: ReadonlySet<string>,
): boolean {
  return holidayDates.has(dateKey);
}
