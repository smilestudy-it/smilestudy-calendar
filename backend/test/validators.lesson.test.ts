/**
 * （責務）授業/レッスン関連バリデーション（validators）のユニットテスト。
 */
import { describe, expect, it } from 'vitest';
import {
  validateBulkLessonsInput,
  validateCreateLessonInput,
  validateLessonRangeQuery,
  validatePatchLessonInput,
} from '../validators';

describe('lesson validators', () => {
  it('validateLessonRangeQuery requires from and to', () => {
    expect(validateLessonRangeQuery({}).error).toBeDefined();
    expect(validateLessonRangeQuery({ from: '2025-01-01', to: '' }).error).toBeDefined();
  });

  it('validateLessonRangeQuery rejects from >= to', () => {
    const r = validateLessonRangeQuery({ from: '2025-02-01', to: '2025-01-01' });
    expect(r.error).toBeDefined();
  });

  it('validateLessonRangeQuery returns dates', () => {
    const r = validateLessonRangeQuery({ from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' });
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

  it('validatePatchLessonInput requires at least one field', () => {
    const r = validatePatchLessonInput({});
    expect(r.input).toBeUndefined();
    expect(r.error).toBeDefined();
    expect(String(r.error)).toMatch(/at least one field is required/i);
  });

  it('validatePatchLessonInput accepts partial updates', () => {
    const r = validatePatchLessonInput({ status: 'published' });
    expect(r.error).toBeUndefined();
    expect(r.input?.status).toBe('published');
  });

  it('validateBulkLessonsInput requires createsTimezoneOffsetMinutes when creates present', () => {
    const r = validateBulkLessonsInput({
      classroomId: 'c1',
      creates: [
        {
          teacherId: 't1',
          studentId: 's1',
          dateKey: '2025-06-10',
          timeSlotId: 'ts1',
        },
      ],
    });
    expect(r.input).toBeUndefined();
    expect(r.error).toMatch(/createsTimezoneOffsetMinutes/i);
  });

  it('validateBulkLessonsInput accepts creates with dateKey and timeSlotId', () => {
    const r = validateBulkLessonsInput({
      classroomId: 'c1',
      createsTimezoneOffsetMinutes: -540,
      creates: [
        {
          teacherId: 't1',
          studentId: 's1',
          dateKey: '2025-06-10',
          timeSlotId: 'ts1',
        },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.input?.creates?.[0]?.dateKey).toBe('2025-06-10');
    expect(r.input?.creates?.[0]?.timeSlotId).toBe('ts1');
  });
});
