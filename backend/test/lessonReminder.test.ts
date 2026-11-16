/**
 * （責務）授業リマインドの対象日・宛先まとめ・GAS への POST 条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { postReminderToGas } from '../lessonReminderJob';
import {
  type ReminderLessonRow,
  STUDENT_SAME_DAY_CRON,
  TEACHER_NEXT_DAY_CRON,
  addTokyoDays,
  buildReminderRecipients,
  buildUnavailableNoticeRecipients,
  reminderDateForKind,
  reminderTargetForCron,
  tokyoDayBounds,
} from '../lib/lessonReminder';

function row(partial: Partial<ReminderLessonRow> = {}): ReminderLessonRow {
  return {
    startAt: new Date('2026-11-16T01:00:00.000Z'),
    endAt: new Date('2026-11-16T02:00:00.000Z'),
    teacherEmail: 'teacher@example.com',
    teacherFirstName: '',
    teacherLastName: 'B',
    teacherDeleted: false,
    studentEmail: 'student@example.com',
    studentName: 'A',
    studentDeleted: false,
    subjectName: '英語',
    lessonTypeName: '通常',
    ...partial,
  };
}

describe('tokyo day helpers', () => {
  it('bounds a Tokyo calendar day in UTC', () => {
    const { from, to } = tokyoDayBounds('2026-11-16');
    expect(from.toISOString()).toBe('2026-11-15T15:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });

  it('adds days across a month boundary', () => {
    expect(addTokyoDays('2026-03-31', 1)).toBe('2026-04-01');
  });
});

describe('reminderTargetForCron', () => {
  it('targets the same Tokyo date at 06:00 JST', () => {
    // 2026-11-15T21:00:00Z == 2026-11-16 06:00 JST
    const target = reminderTargetForCron(
      STUDENT_SAME_DAY_CRON,
      new Date('2026-11-15T21:00:00.000Z'),
    );
    expect(target).toEqual({
      kind: 'student_same_day',
      date: '2026-11-16',
    });
  });

  it('targets the next Tokyo date at 20:00 JST', () => {
    // 2026-11-16T11:00:00Z == 2026-11-16 20:00 JST
    const target = reminderTargetForCron(
      TEACHER_NEXT_DAY_CRON,
      new Date('2026-11-16T11:00:00.000Z'),
    );
    expect(target).toEqual({
      kind: 'teacher_next_day',
      date: '2026-11-17',
    });
  });

  it('ignores unknown cron', () => {
    expect(
      reminderTargetForCron('0 0 * * *', new Date('2026-11-16T00:00:00.000Z')),
    ).toBeNull();
  });
});

describe('buildReminderRecipients', () => {
  it('groups a student lessons and skips a deleted student', () => {
    const recipients = buildReminderRecipients(
      'student_same_day',
      '2026-11-16',
      [
        row(),
        row({
          startAt: new Date('2026-11-16T06:00:00.000Z'),
          endAt: new Date('2026-11-16T07:00:00.000Z'),
          subjectName: '数学',
          teacherLastName: 'C',
          teacherFirstName: '',
        }),
        row({
          studentEmail: 'gone@example.com',
          studentDeleted: true,
        }),
      ],
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.email).toBe('student@example.com');
    expect(recipients[0]?.name).toBe('A');
    expect(recipients[0]?.html).toContain('B - A (英語)');
    expect(recipients[0]?.html).toContain('C - A (数学)');
    expect(recipients[0]?.subject).toBe(
      '【スマイルスタディ】2026年11月16日の授業スケジュール',
    );
    expect(recipients[0]?.html).toContain('Aさん');
    expect(recipients[0]?.html).toContain('2026年11月16日月曜日');
    expect(recipients[0]?.html).toContain('■ 10:00〜');
    expect(recipients[0]?.html).toContain('color:#d93025;');
  });

  it('groups a teacher lessons for the next day and skips a deleted teacher', () => {
    const recipients = buildReminderRecipients(
      'teacher_next_day',
      '2026-11-17',
      [
        row(),
        row({
          studentEmail: 'other@example.com',
          studentName: 'D',
          startAt: new Date('2026-11-16T03:00:00.000Z'),
        }),
        row({
          teacherEmail: 'old@example.com',
          teacherDeleted: true,
        }),
      ],
    );
    expect(recipients).toEqual([
      expect.objectContaining({
        email: 'teacher@example.com',
        name: 'B',
      }),
    ]);
    expect(recipients[0]?.html).toContain('A (英語[通常])');
    expect(recipients[0]?.html).toContain('D (英語[通常])');
    expect(recipients[0]?.subject).toBe(
      '【スマイルスタディ】明日（2026年11月17日）の担当授業スケジュール',
    );
    expect(recipients[0]?.html).toContain('B先生');
    expect(recipients[0]?.html).toContain('A (英語[通常])');
    expect(recipients[0]?.html).toContain('color:#1a73e8;');
  });
});

describe('unavailable registration notices', () => {
  it('asks every active student to register by the 25th', () => {
    const recipients = buildUnavailableNoticeRecipients(
      'unavailable_registration_open',
      '2026-11-20',
      [
        { email: 'b@example.com', name: 'B' },
        { email: ' a@example.com ', name: ' A ' },
        { email: ' ', name: '空' },
      ],
    );
    expect(recipients.map((recipient) => recipient.email)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(recipients[0]?.subject).toBe(
      '【スマイルスタディ】受講不可時間帯のご登録のお願い（2026年11月25日まで）',
    );
    expect(recipients[0]?.html).toContain('Aさん');
    expect(recipients[0]?.html).toContain('2026年11月25日');
    expect(recipients[0]?.html).toContain('【お願い】');
    expect(recipients[0]?.html).toContain('color:#1a73e8;');
    expect(
      reminderDateForKind(
        'unavailable_registration_open',
        new Date('2026-11-20T01:00:00.000Z'),
      ),
    ).toBe('2026-11-20');
  });

  it('asks them to register by the end of the 25th', () => {
    const [recipient] = buildUnavailableNoticeRecipients(
      'unavailable_registration_deadline',
      '2026-11-25',
      [{ email: 'a@example.com', name: 'A' }],
    );
    expect(recipient?.subject).toBe(
      '【スマイルスタディ】本日（2026年11月25日）が受講不可時間帯の登録期限です',
    );
    expect(recipient?.html).toContain('本日（');
    expect(recipient?.html).toContain('2026年11月25日水曜日');
    expect(recipient?.html).toContain('color:#d93025;');
  });
});

describe('postReminderToGas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call GAS when nobody has a lesson', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      postReminderToGas({
        url: 'https://script.google.com/macros/s/abc/exec',
        secret: 'secret',
        kind: 'student_same_day',
        date: '2026-11-16',
        recipients: [],
      }),
    ).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the secret and recipients in the JSON body', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await postReminderToGas({
      url: 'https://script.google.com/macros/s/abc/exec',
      secret: 'secret',
      kind: 'teacher_next_day',
      date: '2026-11-17',
      recipients: [
        {
          email: 'teacher@example.com',
          name: 'B',
          subject: '件名',
          html: '<p>本文</p>',
        },
      ],
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      secret: 'secret',
      kind: 'teacher_next_day',
      date: '2026-11-17',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('follow');
  });

  it('swallows an unauthorized JSON result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ success: false, error: 'UNAUTHORIZED' }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      postReminderToGas({
        url: 'https://script.google.com/macros/s/abc/exec',
        secret: 'secret',
        kind: 'student_same_day',
        date: '2026-11-16',
        recipients: [
          {
            email: 'student@example.com',
            name: 'A',
            subject: '件名',
            html: '<p>本文</p>',
          },
        ],
      }),
    ).resolves.toBe('unauthorized');
  });

  it('throws when GAS reports a send failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              results: [{ email: 'student@example.com', success: false }],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      postReminderToGas({
        url: 'https://script.google.com/macros/s/abc/exec',
        secret: 'secret',
        kind: 'student_same_day',
        date: '2026-11-16',
        recipients: [
          {
            email: 'student@example.com',
            name: 'A',
            subject: '件名',
            html: '<p>本文</p>',
          },
        ],
      }),
    ).rejects.toThrow('GAS mail sending failed');
  });
});
