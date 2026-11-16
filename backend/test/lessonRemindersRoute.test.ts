/**
 * （責務）GAS 時間トリガー用の授業リマインド起動エンドポイント。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchReminderKind } from '../lessonReminderJob';
import { app } from '../worker';

vi.mock('../lessonReminderJob', () => ({
  dispatchReminderKind: vi.fn(async () => 'sent'),
  dispatchLessonReminder: vi.fn(async () => 'sent'),
}));

const env = {
  GAS_REMINDER_SECRET: 'test-secret',
  DB: {},
} as unknown as Env;

describe('POST /api/lesson-reminders', () => {
  beforeEach(() => {
    vi.mocked(dispatchReminderKind).mockClear();
    vi.mocked(dispatchReminderKind).mockResolvedValue('sent');
  });

  it('rejects a missing secret', async () => {
    const res = await app.request(
      '/api/lesson-reminders?kind=student_same_day',
      { method: 'POST' },
      env,
    );
    expect(res.status).toBe(401);
    expect(dispatchReminderKind).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    const res = await app.request(
      '/api/lesson-reminders?kind=other',
      {
        method: 'POST',
        headers: { 'x-reminder-secret': 'test-secret' },
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(dispatchReminderKind).not.toHaveBeenCalled();
  });

  it('sends the same-day student reminder', async () => {
    const res = await app.request(
      '/api/lesson-reminders?kind=student_same_day',
      {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
      },
      env,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'sent',
      kind: 'student_same_day',
    });
    expect(dispatchReminderKind).toHaveBeenCalledWith(
      env,
      'student_same_day',
      expect.any(String),
    );
  });

  it('sends the next-day teacher reminder', async () => {
    vi.mocked(dispatchReminderKind).mockResolvedValue('skipped');
    const res = await app.request(
      '/api/lesson-reminders?kind=teacher_next_day',
      {
        method: 'POST',
        headers: { 'x-reminder-secret': 'test-secret' },
      },
      env,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'skipped',
      kind: 'teacher_next_day',
    });
    expect(dispatchReminderKind).toHaveBeenCalledWith(
      env,
      'teacher_next_day',
      expect.any(String),
    );
  });
});
