/**
 * （責務）講師管理ページの枠。TeacherManagementPanel を包む。
 */
import TeacherManagementPanel from '../components/TeacherManagementPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function TeacherManagementPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {

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
