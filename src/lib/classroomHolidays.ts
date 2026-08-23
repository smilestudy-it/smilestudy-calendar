import type { HolidayListItem } from '@/types/api';

/**
 * Fetches the holidays for a classroom.
 *
 * @param classroomId - The classroom identifier.
 * @returns The classroom holiday items.
 * @throws Error if the request fails.
 */
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

/**
 * Retrieves the holiday dates for a classroom.
 *
 * @param classroomId - The classroom identifier
 * @returns The holiday dates in `YYYY-MM-DD` format, or an empty array if retrieval fails.
 */
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
