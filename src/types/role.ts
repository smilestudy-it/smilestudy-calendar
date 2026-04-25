/**
 * （責務）業務ロール3種（admin / manager / staff）の型。
 * DB `users.role` と同値。未設定・不明は `CurrentUser.role` で null 扱い。
 */

export type AppRole = 'admin' | 'manager' | 'staff';
