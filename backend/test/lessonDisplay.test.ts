/**
 * （責務）lessonDisplay の日時ヘルパーのユニットテスト。
 */
import { describe, expect, it } from 'vitest';

import {
  lessonPresetDisplay,
  lessonStudentDisplay,
  lessonTeacherDisplay,
  utcDateFromLocalDateKeyAndHm,
} from '../lessonDisplay';

describe('lessonStudentDisplay', () => {
  it('returns active student name', () => {
    expect(lessonStudentDisplay({ name: '生徒A', deletedAt: null })).toBe(
      '生徒A',
    );
  });

  it('marks soft-deleted student without name', () => {
    expect(
      lessonStudentDisplay({
        name: '生徒A',
        deletedAt: new Date('2025-01-01'),
      }),
    ).toBe('（削除済み）');
  });
});

describe('lessonTeacherDisplay', () => {
  it('returns active teacher name', () => {
    expect(
      lessonTeacherDisplay({
        firstName: '太郎',
        lastName: '山田',
        deletedAt: null,
      }),
    ).toBe('山田 太郎');
  });

  it('marks soft-deleted teacher without name', () => {
    expect(
      lessonTeacherDisplay({
        firstName: '太郎',
        lastName: '山田',
        deletedAt: new Date('2025-01-01'),
      }),
    ).toBe('（削除済み）');
  });
});

describe('lessonPresetDisplay', () => {
  it('returns active preset name', () => {
    expect(lessonPresetDisplay({ name: '英語', deletedAt: null })).toBe('英語');
  });

  it('marks soft-deleted preset', () => {
    expect(
      lessonPresetDisplay({
        name: '数学',
        deletedAt: new Date('2025-01-01'),
      }),
    ).toBe('（削除済み）');
  });

  it('returns fallback when preset row is missing', () => {
    expect(lessonPresetDisplay(null)).toBe('（不明）');
  });
});

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
