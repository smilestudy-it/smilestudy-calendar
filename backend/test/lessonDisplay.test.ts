/**
 * （責務）lessonDisplay の日時ヘルパーのユニットテスト。
 */
import { describe, expect, it } from 'vitest';

import { utcDateFromLocalDateKeyAndHm } from '../lessonDisplay';

describe('utcDateFromLocalDateKeyAndHm', () => {
  it('maps local wall time to UTC using timezone offset (JST -540)', () => {
    const d = utcDateFromLocalDateKeyAndHm('2025-06-10', '10:00', -540);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2025-06-10T01:00:00.000Z');
  });

  it('handles UTC offset 0', () => {
    const d = utcDateFromLocalDateKeyAndHm('2025-06-10', '15:30', 0);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2025-06-10T15:30:00.000Z');
  });

  it('returns null for invalid calendar date', () => {
    const d = utcDateFromLocalDateKeyAndHm('2025-02-31', '10:00', -540);
    expect(d).toBeNull();
  });

  it('returns null for invalid time', () => {
    const d = utcDateFromLocalDateKeyAndHm('2025-06-10', '24:00', 0);
    expect(d).toBeNull();
  });
});
