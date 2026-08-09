/**
 * （責務）休業日バリデーション・Tokyo 日付キー・登録 UI 用空き枠統合のユニットテスト。
 */
import { describe, expect, it } from 'vitest';

import {
  applyHolidayUnavailability,
  isHolidayDate,
} from '../../src/lib/holidayAvailability';
import { isD1HolidayClassroomDateUniqueViolation } from '../lib/sqliteConstraint';
import { toTokyoDateKey } from '../lib/tokyoDate';
import { validateCreateHolidayInput } from '../lib/validators';

describe('validateCreateHolidayInput', () => {
  it('accepts ISO date and classroom id', () => {
    const r = validateCreateHolidayInput({
      classroomId: 'room-1',
      date: '2026-08-15',
    });
    expect(r.error).toBeUndefined();
    expect(r.input).toEqual({
      classroomId: 'room-1',
      date: '2026-08-15',
    });
  });

  it('rejects invalid date', () => {
    const r = validateCreateHolidayInput({
      classroomId: 'room-1',
      date: '08/15/2026',
    });
    expect(r.input).toBeUndefined();
    expect(r.error).toBeDefined();
  });

  it('rejects missing classroom id', () => {
    const r = validateCreateHolidayInput({
      date: '2026-08-15',
    });
    expect(r.input).toBeUndefined();
    expect(r.error).toBeDefined();
  });
});

describe('toTokyoDateKey', () => {
  it('maps UTC instant to Asia/Tokyo calendar date', () => {
    // 2025-06-10T10:00:00Z == 19:00 JST on 2025-06-10
    expect(toTokyoDateKey(new Date('2025-06-10T10:00:00.000Z'))).toBe(
      '2025-06-10',
    );
  });

  it('rolls date around JST midnight', () => {
    // 2025-06-09T15:00:00Z == 2025-06-10 00:00 JST
    expect(toTokyoDateKey(new Date('2025-06-09T15:00:00.000Z'))).toBe(
      '2025-06-10',
    );
  });
});

describe('isD1HolidayClassroomDateUniqueViolation', () => {
  it('detects holidays active unique index name', () => {
    expect(
      isD1HolidayClassroomDateUniqueViolation(
        new Error(
          'UNIQUE constraint failed: index holidays_classroom_date_active_unique',
        ),
      ),
    ).toBe(true);
    expect(isD1HolidayClassroomDateUniqueViolation(new Error('other'))).toBe(
      false,
    );
  });
});

describe('holidayAvailability (lesson registration UI)', () => {
  it('marks all slots unavailable on holiday dates', () => {
    const map: Record<string, Set<string>> = {
      '2026-08-14': new Set(['slot-a']),
    };
    applyHolidayUnavailability(map, ['2026-08-15'], ['slot-a', 'slot-b']);
    expect(map['2026-08-15']).toEqual(new Set(['slot-a', 'slot-b']));
    expect(map['2026-08-14']).toEqual(new Set(['slot-a']));
  });

  it('isHolidayDate checks set membership', () => {
    const holidays = new Set(['2026-08-15']);
    expect(isHolidayDate('2026-08-15', holidays)).toBe(true);
    expect(isHolidayDate('2026-08-16', holidays)).toBe(false);
  });
});
