/**
 * （責務）教室管理。教室の作成・表示を担当するページ。
 */
import ClassroomAdminPanel from '../components/ClassroomAdminPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  isLoadingCurrentUser: boolean;
  getAccessTokenSilently: () => Promise<string>;
};

export default function ClassroomPage({
  currentUser,
  isLoadingCurrentUser,
  getAccessTokenSilently,
}: Props) {
  if (isLoadingCurrentUser) {
    return <p className="text-sm text-slate-300">ユーザー情報を読み込み中...</p>;
  }

  if (currentUser?.role !== 'admin') {
    return <p className="text-sm text-slate-300">管理者のみ教室管理機能を利用できます。</p>;
  }

  return <ClassroomAdminPanel getAccessTokenSilently={getAccessTokenSilently} />;
}
