/*
  classrooms追加/削除などのAPIを管理
*/

import { Hono } from 'hono';
import { getDb } from '../db'
import { classrooms, users, students, subjects, lessonTypes, timeSlots, lessons } from '../db/schema';
import { requireAdmin } from '../middleware/honoStack'
import type { ApiBindings, AppVariables } from '../types/apiTypes'
import { and, eq, isNull } from 'drizzle-orm';
import { auth, loadUser } from '../middleware/honoStack';
import { validateCreateClassroomInput } from '../lib/validators';
import { isD1ClassroomNameUniqueViolation } from '../lib/sqliteConstraint';
import userDelete from '../lib/userDelete';

const classroomsApp = new Hono<{ Bindings: ApiBindings; Variables: AppVariables }>();

classroomsApp.post('/', auth, loadUser, requireAdmin, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateClassroomInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const db = getDb(c.env);
  const id = crypto.randomUUID();

  try {
    await db.insert(classrooms).values({ id, name: input.name, deletedAt: null });
  } catch (error) {
    if (isD1ClassroomNameUniqueViolation(error)) {
      return c.json({ message: 'classroom already exists' }, 409);
    }
    return c.json({ message: 'failed to create classroom' }, 500);
  }

  return c.json({ id, name: input.name }, 201);
});

classroomsApp.get('/', auth, loadUser, requireAdmin, async(c) =>{
  const db = getDb(c.env);

  const rows = await db.select({id: classrooms.id, name: classrooms.name}).from(classrooms).where(isNull(classrooms.deletedAt));
  return c.json(rows, 200);
});

classroomsApp.delete('/:id', auth, loadUser, requireAdmin, async(c) =>{
  const id = c.req.param('id');
  if(!id){
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const [target] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.id, id), isNull(classrooms.deletedAt)))
    .limit(1);

  if (!target) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  const deletedAt = new Date();

  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

  await db.batch([
    db.update(classrooms).set({ deletedAt }).where(eq(classrooms.id, id)),
    db.update(students).set({ deletedAt }).where(eq(students.classroomId, id)),
    db.update(subjects).set({ deletedAt }).where(eq(subjects.classroomId, id)),
    db.update(lessonTypes).set({ deletedAt }).where(eq(lessonTypes.classroomId, id)),
    db.update(timeSlots).set({ deletedAt }).where(eq(timeSlots.classroomId, id)),
    db.update(lessons).set({ deletedAt }).where(eq(lessons.classroomId, id))
  ]);

  return await userDelete(c, targets.map(user => user.id));
});

export default classroomsApp;