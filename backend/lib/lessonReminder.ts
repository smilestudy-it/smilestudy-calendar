/**
 * （責務）授業リマインドの対象日と、GAS へ渡す宛先ごとの授業一覧を組み立てる。
 * メール送信自体は GAS が行う。
 */
import { toTokyoDateKey, toTokyoHm } from './tokyoDate';

/** 06:00 JST。Cloudflare Cron は UTC なので 21:00 UTC。 */
export const STUDENT_SAME_DAY_CRON = '0 21 * * *';
/** 20:00 JST。Cloudflare Cron は UTC なので 11:00 UTC。 */
export const TEACHER_NEXT_DAY_CRON = '0 11 * * *';

export type ReminderKind = 'student_same_day' | 'teacher_next_day';

export type ReminderLesson = {
  startAt: string;
  endAt: string;
  startTime: string;
  endTime: string;
  subjectName: string;
  lessonTypeName: string;
  counterpartName: string;
};

export type ReminderRecipient = {
  email: string;
  name: string;
  subject: string;
  html: string;
};

/** GAS の doPost が読む JSON。secret は本文に置く（GAS は独自ヘッダを読みにくい）。 */
export type GasReminderPayload = {
  secret: string;
  kind: ReminderKind;
  date: string;
  recipients: ReminderRecipient[];
};

export type ReminderLessonRow = {
  startAt: Date;
  endAt: Date;
  teacherEmail: string;
  teacherFirstName: string;
  teacherLastName: string;
  teacherDeleted: boolean;
  studentEmail: string;
  studentName: string;
  studentDeleted: boolean;
  subjectName: string;
  lessonTypeName: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Asia/Tokyo の暦日 `YYYY-MM-DD` の開始（含む）と翌日開始（含まない）。 */
export function tokyoDayBounds(dateKey: string): { from: Date; to: Date } {
  const from = new Date(`${dateKey}T00:00:00+09:00`);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** Asia/Tokyo の暦日を日数分ずらす。 */
export function addTokyoDays(dateKey: string, days: number): string {
  const noon = new Date(`${dateKey}T12:00:00+09:00`);
  return toTokyoDateKey(new Date(noon.getTime() + days * DAY_MS));
}

/** `2026年11月15日` と `日曜日`。 */
export function formatTokyoDateLabel(dateKey: string): {
  dateLabel: string;
  weekday: string;
} {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'long',
  }).format(new Date(`${dateKey}T12:00:00+09:00`));
  return {
    dateLabel: `${year}年${month}月${day}日`,
    weekday,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function mailShell(body: string): string {
  return `<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:14px;line-height:1.8;color:#222;">${body}<hr style="border:none;border-top:1px solid #ddd;margin:28px 0 12px;"><p style="margin:0;color:#444;">１対１スマイルスタディ</p></div>`;
}

function noticeBox(text: string): string {
  return `<div style="margin:18px 0;padding:12px 16px;background:#fff4d6;border-left:4px solid #e0a100;"><span style="text-decoration:underline;">${text}</span></div>`;
}

function scheduleBlocks(
  lessons: ReminderLesson[],
  lineFor: (lesson: ReminderLesson) => string,
): string {
  return lessons
    .map(
      (lesson) =>
        `<p style="margin:0 0 14px;"><strong>■ ${escapeHtml(lesson.startTime)}〜</strong><br>${lineFor(lesson)}</p>`,
    )
    .join('');
}

function renderStudentMail(
  dateKey: string,
  recipientName: string,
  lessons: ReminderLesson[],
): { subject: string; html: string } {
  const { dateLabel, weekday } = formatTokyoDateLabel(dateKey);
  const name = escapeHtml(recipientName);
  const schedule = scheduleBlocks(
    lessons,
    (lesson) =>
      `${escapeHtml(lesson.counterpartName)} - ${name} (${escapeHtml(lesson.subjectName)})`,
  );
  return {
    subject: `【スマイルスタディ】${dateLabel}の授業スケジュール`,
    html: mailShell(`
<p>お世話になっております。</p>
<p>${name}さん</p>
<p>${dateLabel}${weekday}の授業スケジュールをお知らせいたします。</p>
<p><strong>【本日の授業スケジュール】</strong></p>
${schedule}
<p><strong>【お願い】</strong></p>
<ul>
<li>欠席や遅刻をする場合は、事前にご連絡ください。</li>
<li>体調管理にご注意いただき、元気に授業に参加してください。</li>
</ul>
<p><strong>【振替・ご連絡について】</strong></p>
<ul>
<li>振替につきましては、当日の<strong style="color:#d93025;">90分前</strong>までにご連絡をいただいた場合に限り、承ります。お手数ですが、<strong style="color:#d93025;">90分前</strong>までにComiruの「遅刻・欠席連絡」にてご連絡をお願いいたします。</li>
</ul>
<p><strong>【ご注意】</strong></p>
${noticeBox('こちらは自動メールとなっておりますので、こちらにご返信をいただいてもご返答はできませんのでお気をつけください。ご連絡は必ずComiruにてお願いいたします。')}
<p>何かご不明な点がございましたら、お気軽にお問い合わせください。</p>
<p>よろしくお願いいたします。</p>`),
  };
}

function renderTeacherMail(
  dateKey: string,
  recipientName: string,
  lessons: ReminderLesson[],
): { subject: string; html: string } {
  const { dateLabel, weekday } = formatTokyoDateLabel(dateKey);
  const name = escapeHtml(recipientName);
  const schedule = scheduleBlocks(
    lessons,
    (lesson) =>
      `${escapeHtml(lesson.counterpartName)} (${escapeHtml(lesson.subjectName)}[${escapeHtml(lesson.lessonTypeName)}])`,
  );
  return {
    subject: `【スマイルスタディ】明日（${dateLabel}）の担当授業スケジュール`,
    html: mailShell(`
<p>お世話になっております。</p>
<p>${name}先生</p>
<p>明日（${dateLabel}${weekday}）の担当授業スケジュールをお知らせいたします。</p>
<p><strong>【明日の担当スケジュール】</strong></p>
${schedule}
<p><strong>【お願い】</strong></p>
<ul>
<li>翌月の授業日程変更は「当月<strong style="color:#1a73e8;">20日～25日</strong>」であればComiru連絡のみで調整可能です。</li>
<li>変更期間外は、ご家庭への電話連絡が必須となります。電話後、カレンダーを修正し、Comiruに記録してください。</li>
<li>電話が繋がらない場合は着信履歴を残し、Comiruにて「お電話試行の旨」を記録してください。その後日程調整を行い、カレンダー修正、Comiruに記録をしてください。</li>
<li>講師が授業当日に体調不良でお休みする場合は、必ず塾長に電話で連絡してください。その後、保護者様にも電話で連絡をお願いします。</li>
</ul>
<p><strong>【ご注意】</strong></p>
${noticeBox('こちらは自動メールとなっておりますので、こちらにご返信をいただいてもご返答はできませんのでお気をつけください。')}
<p>何かご不明な点・不具合等がございましたら、お気軽にお問い合わせください。</p>
<p>よろしくお願いいたします。</p>`),
  };
}

/** Cron から、通知種別と授業の暦日（Asia/Tokyo）を決める。未知の Cron は null。 */
export function reminderTargetForCron(
  cron: string,
  now: Date,
): { kind: ReminderKind; date: string } | null {
  const today = toTokyoDateKey(now);
  if (cron === STUDENT_SAME_DAY_CRON) {
    return { kind: 'student_same_day', date: today };
  }
  if (cron === TEACHER_NEXT_DAY_CRON) {
    return { kind: 'teacher_next_day', date: addTokyoDays(today, 1) };
  }
  return null;
}

function teacherMailName(row: ReminderLessonRow): string {
  if (row.teacherDeleted) {
    return '（削除済み）';
  }
  const name = `${row.teacherLastName}${row.teacherFirstName}`.trim();
  return name || '（不明）';
}

function lessonOf(
  row: ReminderLessonRow,
  counterpartName: string,
): ReminderLesson {
  return {
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    startTime: toTokyoHm(row.startAt),
    endTime: toTokyoHm(row.endAt),
    subjectName: row.subjectName,
    lessonTypeName: row.lessonTypeName,
    counterpartName,
  };
}

/**
 * 同じメールアドレスの授業を1通分にまとめる。
 * 生徒向けは削除済み生徒を除き、講師向けは削除済み講師を除く。
 */
export function buildReminderRecipients(
  kind: ReminderKind,
  date: string,
  rows: ReminderLessonRow[],
): ReminderRecipient[] {
  const byEmail = new Map<
    string,
    ReminderRecipient & { lessons: ReminderLesson[] }
  >();

  const sorted = [...rows].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  for (const row of sorted) {
    const forStudent = kind === 'student_same_day';
    if (forStudent ? row.studentDeleted : row.teacherDeleted) {
      continue;
    }
    const email = (forStudent ? row.studentEmail : row.teacherEmail).trim();
    if (!email) {
      continue;
    }
    const name = forStudent ? row.studentName.trim() : teacherMailName(row);
    const counterpartName = forStudent
      ? teacherMailName(row)
      : row.studentName.trim() || '（不明）';

    let recipient = byEmail.get(email);
    if (!recipient) {
      recipient = { email, name, subject: '', html: '', lessons: [] };
      byEmail.set(email, recipient);
    }
    recipient.lessons.push(lessonOf(row, counterpartName));
  }

  return [...byEmail.values()]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((recipient) => {
      const mail =
        kind === 'student_same_day'
          ? renderStudentMail(date, recipient.name, recipient.lessons)
          : renderTeacherMail(date, recipient.name, recipient.lessons);
      return { email: recipient.email, name: recipient.name, ...mail };
    });
}
