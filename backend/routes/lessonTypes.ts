/*
  lessonType追加/削除などのAPIを管理
*/
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import { classrooms, lessonTypes } from '../db/schema';
import {
  validateCreateLessonTypeInput,
  validatePatchLessonTypeInput,
} from '../lib/validators';
import {
  auth,
  loadUser,
  requireClassroomScope,
  requireManagerOrAbove,
} from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const lessonTypesApp = new Hono<{
  Bindings: ApiBindings;
  Variables: AppVariables;
}>();

lessonTypesApp.get(
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
      .select({ id: lessonTypes.id, name: lessonTypes.name })
      .from(lessonTypes)
      .where(
        and(
          eq(lessonTypes.classroomId, classroomId),
          isNull(lessonTypes.deletedAt),
        ),
      );
    return c.json(rows, 200);
  },
);

lessonTypesApp.post('', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateLessonTypeInput(body);
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
    await db.insert(lessonTypes).values({
      id: newId,
      name: input.name,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'CLASSROOM_NOT_FOUND') {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create lesson type' }, 500);
  }

  return c.json(
    { id: newId, name: input.name, classroomId: input.classroomId },
    201,
  );
});

lessonTypesApp.patch(
  '/:id',
  auth,
  loadUser,
  requireManagerOrAbove,
  async (c) => {
    const targetId = c.req.param('id');
    if (!targetId) {
      return c.json({ message: 'id is required' }, 400);
    }
    const body = await c.req.json<unknown>().catch(() => null);
    const { input, error } = validatePatchLessonTypeInput(body);
    if (!input) {
      return c.json({ message: error ?? 'invalid request' }, 400);
    }
    const db = getDb(c.env);
    const [row] = await db
      .select({ id: lessonTypes.id, classroomId: lessonTypes.classroomId })
      .from(lessonTypes)
      .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)))
      .limit(1);
    if (!row) {
      return c.json({ message: 'lesson type not found' }, 404);
    }
    const actor = c.var.currentUser;
    if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
      return c.json({ message: 'forbidden' }, 403);
    }
    try {
      const res = await db
        .update(lessonTypes)
        .set({ name: input.name })
        .where(
          and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)),
        );
      if (res.meta.changes === 0) {
        return c.json({ message: 'lesson type not found' }, 404);
      }
    } catch {
      return c.json({ message: 'failed to update lesson type' }, 500);
    }
    return c.json(
      { id: targetId, name: input.name, classroomId: row.classroomId },
      200,
    );
  },
);

lessonTypesApp.delete(
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
      .select({ id: lessonTypes.id, classroomId: lessonTypes.classroomId })
      .from(lessonTypes)
      .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)))
      .limit(1);
    if (!row) {
      return c.json({ message: 'lesson type not found' }, 404);
    }

    const actor = c.var.currentUser;
    if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
      return c.json({ message: 'forbidden' }, 403);
    }

    const deletedAt = new Date();
    try {
      const res = await db
        .update(lessonTypes)
        .set({ deletedAt })
        .where(
          and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)),
        );
      if (res.meta.changes === 0) {
        return c.json({ message: 'lesson type not found' }, 404);
      }
    } catch {
      return c.json({ message: 'failed to delete lesson type' }, 500);
    }
    return c.json({ success: true }, 200);
  },
);

export default lessonTypesApp;
