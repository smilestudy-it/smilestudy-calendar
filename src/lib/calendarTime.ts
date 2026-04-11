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
const HM_STRICT = /^([0-9]{1,2}):([0-9]{2})$/;

export function combineLocalDateAndHm(date: Date, hm: string): Date {
  const trimmed = hm.trim();
  const match = HM_STRICT.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid time "${hm}": expected H:mm or HH:mm with minutes 00–59`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid time "${hm}": hour must be 0–23`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid time "${hm}": minute must be 0–59`);
  }
  return dayjs(date).hour(hour).minute(minute).second(0).millisecond(0).toDate();
}
