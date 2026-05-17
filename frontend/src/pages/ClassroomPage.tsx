/**
 * （責務）教室管理。教室の作成・表示を担当するページ。
 */
import ClassroomAdminPanel from '../components/ClassroomAdminPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function ClassroomPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  if (currentUser?.role !== 'admin') {
    return <p className="text-sm text-slate-700">管理者のみ教室管理機能を利用できます。</p>;
  }

  return <ClassroomAdminPanel getAccessTokenSilently={getAccessTokenSilently} />;
}
