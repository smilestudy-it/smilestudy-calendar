/*
  student追加/削除などのAPIを管理
*/
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import { classrooms, subjects } from '../db/schema';
import {
  validateCreateSubjectInput,
  validatePatchSubjectInput,
} from '../lib/validators';
import {
  auth,
  loadUser,
  requireClassroomScope,
  requireManagerOrAbove,
} from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const subjectsApp = new Hono<{
  Bindings: ApiBindings;
  Variables: AppVariables;
}>();

// 科目取得
subjectsApp.get(
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
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(
        and(eq(subjects.classroomId, classroomId), isNull(subjects.deletedAt)),
      );
    return c.json(rows, 200);
  },
);

// 科目名修正
subjectsApp.patch('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchSubjectInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: subjects.id, classroomId: subjects.classroomId })
    .from(subjects)
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'subject not found' }, 404);
  }
  const actor = c.var.currentUser;
  if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  try {
    const res = await db
      .update(subjects)
      .set({ name: input.name })
      .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
    if (res.meta.changes === 0) {
      return c.json({ message: 'subject not found' }, 500);
    }
  } catch {
    return c.json({ message: 'failed to update subject' }, 500);
  }
  return c.json(
    { id: targetId, name: input.name, classroomId: row.classroomId },
    200,
  );
});

// 科目削除
subjectsApp.delete('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: subjects.id, classroomId: subjects.classroomId })
    .from(subjects)
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'subject not found' }, 404);
  }
  const actor = c.var.currentUser;
  if (actor.role !== 'admin' && actor.classroomId !== row.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const deletedAt = new Date();
  try {
    const res = await db
      .update(subjects)
      .set({ deletedAt })
      .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
    if (res.meta.changes === 0) {
      return c.json({ message: 'subject not found' }, 500);
    }
  } catch {
    return c.json({ message: 'failed to delete subject' }, 500);
  }
  return c.json({ success: true }, 200);
});

// 科目追加
subjectsApp.post('', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateSubjectInput(body);
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
      throw Error('CLASSROOM_NOT_FOUND');
    }
    await db.insert(subjects).values({
      id: newId,
      name: input.name,
      classroomId: input.classroomId,
      deletedAt: null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'CLASSROOM_NOT_FOUND') {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create subject' }, 500);
  }

  return c.json(
    { id: newId, name: input.name, classroomId: input.classroomId },
    201,
  );
});

export default subjectsApp;
