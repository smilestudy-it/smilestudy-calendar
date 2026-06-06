/**
 * （責務）Auth0 の `logout` によるログアウトボタン。
 */
import { useAuth0 } from '@auth0/auth0-react';

const LogoutButton = () => {
  const { logout } = useAuth0();
  return (
    <button
      onClick={() =>
        logout({ logoutParams: { returnTo: window.location.origin } })
      }
      className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
    >
      Log Out
    </button>
  );
};

export default LogoutButton;
