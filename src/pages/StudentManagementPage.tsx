import StudentManagementPanel from '../components/StudentManagementPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  isLoadingCurrentUser: boolean;
  getAccessTokenSilently: () => Promise<string>;
};

export default function StudentManagementPage({
  currentUser,
  isLoadingCurrentUser,
  getAccessTokenSilently,
}: Props) {
  if (isLoadingCurrentUser) {
    return <p className="text-sm text-slate-300">ユーザー情報を読み込み中...</p>;
  }

  if (!currentUser) {
    return <p className="text-sm text-slate-300">ユーザー情報を取得できませんでした。</p>;
  }

  return (
    <StudentManagementPanel
      currentUser={currentUser}
      getAccessTokenSilently={getAccessTokenSilently}
    />
  );
}
