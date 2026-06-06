/*
  timeSlot追加/削除などのAPIを管理
*/
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import { classrooms, timeSlots } from '../db/schema';
import {
  validateCreateTimeSlotInput,
  validatePatchTimeSlotInput,
} from '../lib/validators';
import {
  auth,
  loadUser,
  requireClassroomScope,
  requireManagerOrAbove,
} from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const timeSlotsApp = new Hono<{
  Bindings: ApiBindings;
  Variables: AppVariables;
}>();

timeSlotsApp.get(
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
      .select({
        id: timeSlots.id,
        startTime: timeSlots.startTime,
        endTime: timeSlots.endTime,
      })
      .from(timeSlots)
      .where(
        and(
          eq(timeSlots.classroomId, classroomId),
          isNull(timeSlots.deletedAt),
        ),
      );
    return c.json(rows, 200);
  },
);

timeSlotsApp.post('', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateTimeSlotInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const db = getDb(c.env);
  const newId = crypto.randomUUID();

  try {
    const [activeClassroom] = await db
      .select({ id: classrooms.id })
      .from(classrooms)
      .where(
        and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)),
      )
      .limit(1);
    if (!activeClassroom) {
      throw new Error('CLASSROOM_NOT_FOUND');
    }
    await db.insert(timeSlots).values({
      id: newId,
      startTime: input.startTime,
      endTime: input.endTime,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'CLASSROOM_NOT_FOUND') {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create time slots' }, 500);
  }

  return c.json(
    {
      id: newId,
      startTime: input.startTime,
      endTime: input.endTime,
      classroomId: input.classroomId,
    },
    201,
  );
});

timeSlotsApp.patch('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchTimeSlotInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: timeSlots.id, classroomId: timeSlots.classroomId })
    .from(timeSlots)
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  const actor = c.var.currentUser;
  if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  try {
    await db
      .update(timeSlots)
      .set({ startTime: input.startTime, endTime: input.endTime })
      .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
  } catch {
    return c.json({ message: 'failed to update time slot' }, 500);
  }
  return c.json(
    {
      id: targetId,
      startTime: input.startTime,
      endTime: input.endTime,
      classroomId: row.classroomId,
    },
    200,
  );
});

timeSlotsApp.delete(
  '/:id',
  auth,
  loadUser,
  requireManagerOrAbove,
  async (c) => {
    const targetId = c.req.param('id');
    if (!targetId) {
      return c.json({ message: 'id is required' }, 400);
    }
    const db = getDb(c.env);
    const [row] = await db
      .select({ id: timeSlots.id, classroomId: timeSlots.classroomId })
      .from(timeSlots)
      .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)))
      .limit(1);
    if (!row) {
      return c.json({ message: 'time slots not found' }, 404);
    }

    const actor = c.var.currentUser;
    if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
      return c.json({ message: 'forbidden' }, 403);
    }

    const deletedAt = new Date();
    try {
      await db
        .update(timeSlots)
        .set({ deletedAt })
        .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
    } catch {
      return c.json({ message: 'failed to delete time slots' }, 500);
    }
    return c.json({ success: true }, 200);
  },
);

export default timeSlotsApp;
