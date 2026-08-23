import type { HolidayListItem } from '@/types/api';

/** 教室休業日一覧（GET /api/holidays/:classroomId、認証不要）。 */
export async function fetchClassroomHolidays(
  classroomId: string,
  init?: RequestInit,
): Promise<HolidayListItem[]> {
  const res = await fetch(
    `/api/holidays/${encodeURIComponent(classroomId)}`,
    init,
  );
  if (!res.ok) {
    throw new Error('failed to fetch classroom holidays');
  }
  return (await res.json()) as HolidayListItem[];
}

/** 休業日の日付キー（YYYY-MM-DD）のみ。失敗時は空配列。 */
export async function fetchClassroomHolidayDates(
  classroomId: string,
  init?: RequestInit,
): Promise<string[]> {
  try {
    const rows = await fetchClassroomHolidays(classroomId, init);
    return rows.map((row) => row.date);
  } catch {
    return [];
  }
}
