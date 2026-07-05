/**
 * （責務）API レスポンス用の講師/生徒表示名整形と、HH:mm 分数変換（hmToMinutes）。
 * レッスン付帯表示用のラベル・時刻ユーティリティ（API レスポンスの整形）。
 */

export function lessonTeacherDisplay(
  row:
    | {
        firstName: string | null;
        lastName: string | null;
        deletedAt: Date | null;
      }
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

export function lessonPresetDisplay(
  row: { name: string | null; deletedAt: Date | null } | null | undefined,
): string {
  if (!row) {
    return '（不明）';
  }
  if (row.deletedAt != null) {
    return '（削除済み）';
  }
  const name = (row.name ?? '').trim();
  return name || '（不明）';
}

const DATE_KEY_STRICT = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const HM_STRICT = /^([0-9]{1,2}):([0-9]{2})$/;

export function isValidDateKey(dateKey: string): boolean {
  const dm = DATE_KEY_STRICT.exec(dateKey.trim());
  if (!dm) {
    return false;
  }
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  if (
    !Number.isInteger(y) ||
    !Number.isInteger(mo) ||
    !Number.isInteger(d) ||
    mo < 1 ||
    mo > 12
  ) {
    return false;
  }
  const daysInMonth = new Date(y, mo, 0).getDate();
  return d >= 1 && d <= daysInMonth;
}

/**
 * ローカルの暦日 YYYY-MM-DD + 壁時計 HH:mm を UTC の Date に変換する。
 * `timezoneOffsetMinutes` は `Date.prototype.getTimezoneOffset()` と同じ（例: JST では -540）。
 */
export function utcDateFromLocalDateKeyAndHm(
  dateKey: string,
  hm: string,
  timezoneOffsetMinutes: number,
): Date | null {
  const dm = DATE_KEY_STRICT.exec(dateKey.trim());
  if (!dm || !isValidDateKey(dateKey)) {
    return null;
  }
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const tm = HM_STRICT.exec(hm.trim());
  if (!tm) {
    return null;
  }
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (
    !Number.isInteger(y) ||
    !Number.isInteger(mo) ||
    !Number.isInteger(d) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    mo < 1 ||
    mo > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const utcMs =
    Date.UTC(y, mo - 1, d, hour, minute, 0, 0) +
    timezoneOffsetMinutes * 60 * 1000;
  return new Date(utcMs);
}
