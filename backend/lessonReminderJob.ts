/**
 * （責務）JST の定時に、当日授業の生徒または翌日授業の講師を集め、GAS の待ち受け URL へ POST する。
 */
import { and, eq, gte, isNull, lt } from 'drizzle-orm';

import { getDb } from './db';
import { lessonTypes, lessons, students, subjects, users } from './db/schema';
import { lessonPresetDisplay } from './lessonDisplay';
import {
  type GasReminderPayload,
  type ReminderKind,
  type ReminderLessonRow,
  buildReminderRecipients,
  buildUnavailableNoticeRecipients,
  reminderTargetForCron,
  tokyoDayBounds,
} from './lib/lessonReminder';

export type LessonReminderEnv = {
  DB: D1Database;
  GAS_REMINDER_URL?: string;
  GAS_REMINDER_SECRET?: string;
};

/** GAS へリマインド本文を渡す。宛先が空、または設定不足のときは送らない。 */
export async function postReminderToGas(input: {
  url: string | undefined;
  secret: string | undefined;
  kind: ReminderKind;
  date: string;
  recipients: GasReminderPayload['recipients'];
}): Promise<'sent' | 'skipped' | 'unauthorized'> {
  if (input.recipients.length === 0) {
    console.log(
      `lesson reminder skipped: no recipients (${input.kind} ${input.date})`,
    );
    return 'skipped';
  }
  const url = input.url?.trim();
  const secret = input.secret?.trim();
  if (!url || !secret) {
    throw new Error('GAS_REMINDER_URL and GAS_REMINDER_SECRET are required');
  }

  const payload: GasReminderPayload = {
    secret,
    kind: input.kind,
    date: input.date,
    recipients: input.recipients,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GAS reminder webhook failed: ${res.status} ${text}`);
  }

  let result: { success?: boolean; error?: string };
  try {
    result = JSON.parse(text) as { success?: boolean; error?: string };
  } catch {
    throw new Error(`GAS reminder webhook returned invalid JSON: ${text}`);
  }
  if (result.success) {
    return 'sent';
  }
  if (result.error === 'UNAUTHORIZED') {
    console.error(
      `lesson reminder unauthorized by GAS (${input.kind} ${input.date})`,
    );
    return 'unauthorized';
  }
  throw new Error(`GAS mail sending failed: ${text}`);
}

async function loadLessonsOnTokyoDate(
  env: LessonReminderEnv,
  dateKey: string,
): Promise<ReminderLessonRow[]> {
  const { from, to } = tokyoDayBounds(dateKey);
  const db = getDb(env);
  const rows = await db
    .select({
      startAt: lessons.startAt,
      endAt: lessons.endAt,
      teacherEmail: users.email,
      teacherFirstName: users.firstName,
      teacherLastName: users.lastName,
      teacherDeletedAt: users.deletedAt,
      studentEmail: students.email,
      studentName: students.name,
      studentDeletedAt: students.deletedAt,
      subjectName: subjects.name,
      subjectDeletedAt: subjects.deletedAt,
      lessonTypeName: lessonTypes.name,
      lessonTypeDeletedAt: lessonTypes.deletedAt,
    })
    .from(lessons)
    .innerJoin(users, eq(lessons.teacherId, users.id))
    .innerJoin(students, eq(lessons.studentId, students.id))
    .innerJoin(subjects, eq(lessons.subjectId, subjects.id))
    .innerJoin(lessonTypes, eq(lessons.lessonTypeId, lessonTypes.id))
    .where(
      and(
        isNull(lessons.deletedAt),
        gte(lessons.startAt, from),
        lt(lessons.startAt, to),
      ),
    );

  return rows.map((row) => ({
    startAt: row.startAt,
    endAt: row.endAt,
    teacherEmail: row.teacherEmail,
    teacherFirstName: row.teacherFirstName,
    teacherLastName: row.teacherLastName,
    teacherDeleted: row.teacherDeletedAt != null,
    studentEmail: row.studentEmail,
    studentName: row.studentName,
    studentDeleted: row.studentDeletedAt != null,
    subjectName: lessonPresetDisplay({
      name: row.subjectName,
      deletedAt: row.subjectDeletedAt,
    }),
    lessonTypeName: lessonPresetDisplay({
      name: row.lessonTypeName,
      deletedAt: row.lessonTypeDeletedAt,
    }),
  }));
}

/** 指定した通知を集め、GAS へ送る。 */
export async function dispatchReminderKind(
  env: LessonReminderEnv,
  kind: ReminderKind,
  date: string,
): Promise<'sent' | 'skipped' | 'unauthorized'> {
  const recipients = isUnavailableNotice(kind)
    ? buildUnavailableNoticeRecipients(
        kind,
        date,
        await loadActiveStudents(env),
      )
    : buildReminderRecipients(
        kind,
        date,
        await loadLessonsOnTokyoDate(env, date),
      );
  return postReminderToGas({
    url: env.GAS_REMINDER_URL,
    secret: env.GAS_REMINDER_SECRET,
    kind,
    date,
    recipients,
  });
}

function isUnavailableNotice(
  kind: ReminderKind,
): kind is Extract<
  ReminderKind,
  'unavailable_registration_open' | 'unavailable_registration_deadline'
> {
  return (
    kind === 'unavailable_registration_open' ||
    kind === 'unavailable_registration_deadline'
  );
}

async function loadActiveStudents(env: LessonReminderEnv) {
  const db = getDb(env);
  return db
    .select({
      email: students.email,
      name: students.name,
    })
    .from(students)
    .where(isNull(students.deletedAt));
}

/** Cron 発火時刻（UTC）から対象を決め、GAS へ送る。 */
export async function dispatchLessonReminder(
  env: LessonReminderEnv,
  cron: string,
  scheduledAt: Date,
): Promise<'sent' | 'skipped' | 'ignored' | 'unauthorized'> {
  const target = reminderTargetForCron(cron, scheduledAt);
  if (!target) {
    console.error(`lesson reminder ignored unknown cron: ${cron}`);
    return 'ignored';
  }
  return dispatchReminderKind(env, target.kind, target.date);
}
