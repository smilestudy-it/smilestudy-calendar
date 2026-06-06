/**
 * （責務）教室・プリセット一覧行など、API レスポンス行の共通化型。
 * フロントが `/api/...` から受け取る共通的な行型（プリセット系）。
 */

export type SubjectListItem = { id: string; name: string };
export type LessonTypeListItem = { id: string; name: string };
export type TimeSlotListItem = {
  id: string;
  startTime: string;
  endTime: string;
};
export type ClassroomListItem = { id: string; name: string };
