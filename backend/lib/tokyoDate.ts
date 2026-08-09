/**
 * （責務）Asia/Tokyo の暦日キー（YYYY-MM-DD）への変換。休業日照合用。
 */
export function toTokyoDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
