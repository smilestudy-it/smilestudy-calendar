/**
 * 業務上の3ロール（DB users.role と同値）。未設定・不明は `CurrentUser.role` で null 扱い。
 */
export type AppRole = 'admin' | 'manager' | 'staff';
