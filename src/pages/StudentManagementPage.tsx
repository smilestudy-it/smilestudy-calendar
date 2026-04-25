/**
 * （責務）生徒管理ページの枠。StudentManagementPanel を包む。
 */
import StudentManagementPanel from '../components/StudentManagementPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function StudentManagementPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {

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
