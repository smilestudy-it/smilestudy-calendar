/*
  holiday 追加/削除などのAPIを管理
*/
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import { classrooms, holidays } from '../db/schema';
import { isD1HolidayClassroomDateUniqueViolation } from '../lib/sqliteConstraint';
import { validateCreateHolidayInput } from '../lib/validators';
import {
  auth,
  loadUser,
  requireClassroomScope,
  requireManagerOrAbove,
} from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const holidaysApp = new Hono<{
  Bindings: ApiBindings;
  Variables: AppVariables;
}>();

holidaysApp.get(
  '/:classroomId',
  auth,
  loadUser,
  requireClassroomScope((c) => c.req.param('classroomId') ?? null),
  async (c) => {
    const classroomId = c.req.param('classroomId');
    if (!classroomId) {
      return c.json({ message: 'classroom id is required' }, 400);
    }
    const db = getDb(c.env);
    const rows = await db
      .select({ id: holidays.id, date: holidays.date })
      .from(holidays)
      .where(
        and(eq(holidays.classroomId, classroomId), isNull(holidays.deletedAt)),
      );
    return c.json(rows, 200);
  },
);

holidaysApp.post('', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateHolidayInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const db = getDb(c.env);
  const newId = crypto.randomUUID();

  const [activeClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(
      and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)),
    )
    .limit(1);
  if (!activeClassroom) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  try {
    await db.insert(holidays).values({
      id: newId,
      date: input.date,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (isD1HolidayClassroomDateUniqueViolation(err)) {
      return c.json({ message: 'holiday already exists' }, 409);
    }
    return c.json({ message: 'failed to create holiday' }, 500);
  }

  return c.json(
    { id: newId, date: input.date, classroomId: input.classroomId },
    201,
  );
});

holidaysApp.delete('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: holidays.id, classroomId: holidays.classroomId })
    .from(holidays)
    .where(and(eq(holidays.id, targetId), isNull(holidays.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'holiday not found' }, 404);
  }

  const actor = c.var.currentUser;
  if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const deletedAt = new Date();
  try {
    const res = await db
      .update(holidays)
      .set({ deletedAt })
      .where(and(eq(holidays.id, targetId), isNull(holidays.deletedAt)));
    if (res.meta.changes === 0) {
      return c.json({ message: 'holiday not found' }, 404);
    }
  } catch {
    return c.json({ message: 'failed to delete holiday' }, 500);
  }
  return c.json({ success: true }, 200);
});

export default holidaysApp;
