/**
 * （責務）休業日設定ページの枠。教室長以上向け。
 */
import HolidaySettingsPanel from '../components/HolidaySettingsPanel';
import type { CurrentUser } from '../types/currentUser';

type Props = {
  currentUser: CurrentUser | null;
  getAccessTokenSilently: () => Promise<string>;
};

export default function HolidaysSettingsPage({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  if (
    !currentUser ||
    (currentUser.role !== 'admin' && currentUser.role !== 'manager')
  ) {
    return (
      <p className="text-foreground text-sm">
        教室長以上が休業日設定を利用できます。
      </p>
    );
  }

  return (
    <HolidaySettingsPanel
      currentUser={currentUser}
      getAccessTokenSilently={getAccessTokenSilently}
    />
  );
}
