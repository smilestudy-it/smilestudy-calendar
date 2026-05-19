// ユーザの削除関数(失敗時にもロールバック等はしない)
import type { Context } from 'hono';
import type { ApiBindings as Bindings, AppVariables } from '../types/apiTypes';
import { getDb } from '../db';
import { users } from '../db/schema';
import { inArray } from 'drizzle-orm';
import * as auth0 from '../auth0Service';


async function userDelete(c: Context<{Bindings: Bindings; Variables: AppVariables;}>, userIds: string[]){
    const db = getDb(c.env);
    const deletedAt = new Date();
    await db.update(users).set({ deletedAt }).where(inArray(users.id, userIds));
    let managementToken = '';
    try{
        managementToken = await auth0.getAuth0ManagementToken(c.env);
        const deletePromises = userIds.map(async (id) => {
            const success = await auth0.deleteAuth0User(c.env, managementToken, id).catch(() => false);
            if(!success){
                console.error('user delete failed');
            }
        });

        await Promise.allSettled(deletePromises);
    }catch{
        return c.json({ message: 'could not get managementToken'}, 500);
    }
    return c.json({ success: true }, 200);
}

export default userDelete;