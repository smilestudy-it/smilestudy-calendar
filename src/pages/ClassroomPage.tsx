import ClassroomAdminPanel from '../components/ClassroomAdminPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function ClassroomPage({ currentUser, getAccessTokenSilently }: Props) {
  if (currentUser?.role !== 'admin') {
    return <p className="text-sm text-slate-300">管理者のみ教室管理機能を利用できます。</p>;
  }

  return <ClassroomAdminPanel getAccessTokenSilently={getAccessTokenSilently} />;
}
