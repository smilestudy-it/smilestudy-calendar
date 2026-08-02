/**
 * （責務）Auth0 の `logout` によるログアウトボタン。
 */
import { useAuth0 } from '@auth0/auth0-react';

import { Button } from '@/components/ui/button';

const LogoutButton = () => {
  const { logout } = useAuth0();
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={() =>
        logout({ logoutParams: { returnTo: window.location.origin } })
      }
    >
      ログアウト
    </Button>
  );
};

export default LogoutButton;
