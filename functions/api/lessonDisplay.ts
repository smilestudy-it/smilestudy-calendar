/**
 * レッスン付帯表示用のラベル・時刻ユーティリティ（API レスポンスの整形）
 */
export function lessonTeacherDisplay(
  row:
    | { firstName: string | null; lastName: string | null; deletedAt: Date | null }
    | null
    | undefined,
): string {
  if (!row) {
    return '（不明）';
  }
  const name = `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim();
  if (row.deletedAt != null) {
    return name ? `${name}（削除済み）` : '（削除済み）';
  }
  return name || '（不明）';
}

export function lessonStudentDisplay(
  row: { name: string | null; deletedAt: Date | null } | null | undefined,
): string {
  if (!row) {
    return '（不明）';
  }
  const name = (row.name ?? '').trim();
  if (row.deletedAt != null) {
    return name ? `${name}（削除済み）` : '（削除済み）';
  }
  return name || '（不明）';
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
