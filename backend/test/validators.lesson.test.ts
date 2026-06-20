/**
 * （責務）授業/レッスン関連バリデーション（validators）のユニットテスト。
 */
import { describe, expect, it } from 'vitest';

import {
  validateCreateLessonInput,
  validateLessonRangeQuery,
  validatePatchLessonInput,
} from '../lib/validators';

describe('lesson validators', () => {
  it('validateLessonRangeQuery requires from and to', () => {
    expect(validateLessonRangeQuery({}).error).toBeDefined();
    expect(
      validateLessonRangeQuery({ from: '2025-01-01', to: '' }).error,
    ).toBeDefined();
  });

  it('validateLessonRangeQuery rejects from >= to', () => {
    const r = validateLessonRangeQuery({
      from: '2025-02-01',
      to: '2025-01-01',
    });
    expect(r.error).toBeDefined();
  });

  it('validateLessonRangeQuery returns dates', () => {
    const r = validateLessonRangeQuery({
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-02-01T00:00:00.000Z',
    });
    expect(r.error).toBeUndefined();
    expect(r.from?.getTime()).toBeLessThan(r.to!.getTime());
  });

  it('validateCreateLessonInput rejects end before start', () => {
    const r = validateCreateLessonInput({
      teacherId: 't1',
      studentId: 's1',
      classroomId: 'c1',
      startAt: '2025-06-01T12:00:00.000Z',
      endAt: '2025-06-01T11:00:00.000Z',
    });
    expect(r.input).toBeUndefined();
    expect(r.error).toBeDefined();
  });

  it('validateCreateLessonInput accepts ISO instants', () => {
    const r = validateCreateLessonInput({
      teacherId: 't1',
      studentId: 's1',
      classroomId: 'c1',
      startAt: '2025-06-01T10:00:00.000Z',
      endAt: '2025-06-01T11:00:00.000Z',
    });
    expect(r.error).toBeUndefined();
    expect(r.input?.startAt.getTime()).toBeLessThan(r.input!.endAt.getTime());
  });

  it('validatePatchLessonInput requires both field', () => {
    const r = validatePatchLessonInput({ lessonTypeId: null });
    expect(r.input).toBeUndefined();
    expect(r.error).toBeDefined();
  });
});
