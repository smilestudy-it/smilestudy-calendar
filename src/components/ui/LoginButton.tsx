/**
 * （責務）Auth0 の `loginWithRedirect` によるログインボタン。
 */
import { useAuth0 } from '@auth0/auth0-react';

import { Button } from '@/components/ui/button';

const LoginButton = () => {
  const { loginWithRedirect } = useAuth0();
  return (
    <Button type="button" className="mt-5" onClick={() => loginWithRedirect()}>
      ログイン
    </Button>
  );
};

export default LoginButton;
