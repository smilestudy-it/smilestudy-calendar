import type { AppRole } from '@/types/role';
import type { CurrentUser } from '@/types/currentUser';

/**
 * 画面表示用: 管理画面で API が返す role 値（英語）に対応する日本語ラベル
 */
export const ROLE_LABEL_JA: Record<AppRole, string> = {
  admin: '管理者',
  manager: '教室長',
  staff: '講師',
};

const CALENDAR_ROLES: readonly AppRole[] = ['admin', 'manager', 'staff'];

const PRESET_SETTINGS_ROLES: readonly AppRole[] = ['admin', 'manager'];

/**
 * カレンダー画面（週表示）へ遷移できるか。講師・教室長・管理者。
 * シェル表示用の `role` 文字列（`'-'` 等）も想定。
 */
export function canAccessCalendar(role: CurrentUser['role'] | string | undefined): boolean {
  if (role == null || role === '') {
    return false;
  }
  return (CALENDAR_ROLES as readonly string[]).includes(role);
}

/**
 * 授業プリセット設定画面へ遷移できるか。教室長以上。
 */
export function canAccessPresetsSettings(role: CurrentUser['role'] | string | undefined): boolean {
  if (role == null || role === '') {
    return false;
  }
  return (PRESET_SETTINGS_ROLES as readonly string[]).includes(role);
}
