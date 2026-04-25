/**
 * （責務）D1/SQLite の unique / FK 違反のテキスト判定。教室名・メール衝突など。
 */
import { collectErrorTextParts } from './logApiError';

export const CLASSROOM_NOT_ACTIVE_ERROR = 'CLASSROOM_NOT_ACTIVE_ERROR';

/** `drizzle/0004_demonic_talkback.sql` partial unique index on active classrooms */
export const CLASSROOMS_NAME_ACTIVE_UNIQUE_INDEX = 'classrooms_name_active_unique';

/** `drizzle/0005_acoustic_night_thrasher.sql` partial unique index on active users */
export const USERS_EMAIL_ACTIVE_UNIQUE_INDEX = 'users_email_active_unique';

export function isD1ClassroomNameUniqueViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ');
  const lower = text.toLowerCase();
  return (
    text.includes(CLASSROOMS_NAME_ACTIVE_UNIQUE_INDEX) ||
    lower.includes('unique constraint failed') ||
    (lower.includes('unique constraint') && lower.includes('classroom')) ||
    (lower.includes('sqlite_constraint') && lower.includes('unique'))
  );
}

export function isD1UsersEmailUniqueViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ');
  const lower = text.toLowerCase();
  return (
    text.includes(USERS_EMAIL_ACTIVE_UNIQUE_INDEX) ||
    lower.includes('unique constraint failed') ||
    lower.includes('unique constraint')
  );
}

export function isD1ForeignKeyViolation(error: unknown): boolean {
  const text = collectErrorTextParts(error).join(' ').toLowerCase();
  return text.includes('foreign key');
}
