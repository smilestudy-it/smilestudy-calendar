// ユーザの削除関数(失敗時にもロールバック等はしない)
import { inArray } from 'drizzle-orm';
import type { Context } from 'hono';

import * as auth0 from '../auth0Service';
import { getDb } from '../db';
import { users } from '../db/schema';
import type { AppVariables, ApiBindings as Bindings } from '../types/apiTypes';

async function userDelete(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return c.json({ success: true }, 200);
  }
  const db = getDb(c.env);
  const deletedAt = new Date();
  await db.update(users).set({ deletedAt }).where(inArray(users.id, userIds));
  let managementToken = '';
  try {
    managementToken = await auth0.getAuth0ManagementToken(c.env);
    const deletePromises = userIds.map(async (id) => {
      const success = await auth0
        .deleteAuth0User(c.env, managementToken, id)
        .catch(() => false);
      if (!success) {
        console.error(`Auth0 user delete failed for userId: ${id}`);
      }
    });

    await Promise.allSettled(deletePromises);
  } catch {
    return c.json({ message: 'could not get managementToken' }, 500);
  }
  return c.json({ success: true }, 200);
}

export default userDelete;
