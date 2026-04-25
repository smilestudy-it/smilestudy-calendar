/**
 * （責務）フロントが扱うログインユーザの型（/api/me 等）。
 */
import type { AppRole } from './role';

export type CurrentUser = {
  id: string;
  /** API の users.role。未登録や欠損のとき null */
  role: AppRole | null;
  classroomId: string | null;
};
