/**
 * （責務）授業プリセット（科目・種別・時間枠）設定ページの枠。
 */
import PresetsSettingsPanel from '../components/PresetsSettingsPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function PresetsSettingsPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  if (
    !currentUser ||
    (currentUser.role !== 'admin' && currentUser.role !== 'manager')
  ) {
    return (
      <p className="text-foreground text-sm">
        教室長以上が授業プリセット設定を利用できます。
      </p>
    );
  }

  return (
    <PresetsSettingsPanel
      currentUser={currentUser}
      getAccessTokenSilently={getAccessTokenSilently}
    />
  );
}
