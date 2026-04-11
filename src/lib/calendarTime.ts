import dayjs from 'dayjs';

/** 週の開始を日曜 00:00（ローカル） */
export function startOfWeekSunday(d: Date): dayjs.Dayjs {
  const x = dayjs(d);
  return x.subtract(x.day(), 'day').startOf('day');
}

/**
 * ローカル日付の壁時計 + プリセットの HH:mm を結合して Date を返す。
 * API へは toISOString() 等で送る（ブラウザローカル TZ）。
 */
export function combineLocalDateAndHm(date: Date, hm: string): Date {
  const parts = hm.trim().split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return dayjs(date).hour(h).minute(m).second(0).millisecond(0).toDate();
}
