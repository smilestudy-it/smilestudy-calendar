import TeacherManagementPanel from '../components/TeacherManagementPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  isLoadingCurrentUser: boolean;
  getAccessTokenSilently: () => Promise<string>;
};

export default function TeacherManagementPage({
  currentUser,
  isLoadingCurrentUser,
  getAccessTokenSilently,
}: Props) {
  if (isLoadingCurrentUser) {
    return <p className="text-sm text-slate-300">ユーザー情報を読み込み中...</p>;
  }

  if (!currentUser || currentUser.role === 'staff') {
    return <p className="text-sm text-slate-300">教室長以上が講師管理機能を利用できます。</p>;
  }

  return (
    <TeacherManagementPanel
      currentUser={currentUser}
      getAccessTokenSilently={getAccessTokenSilently}
    />
  );
}
