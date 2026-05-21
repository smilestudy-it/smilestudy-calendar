/*
  student追加/削除などのAPIを管理
*/

import { Hono } from 'hono';
import { getDb } from '../db';
import { classrooms, students } from '../db/schema';
import type { ApiBindings, AppVariables } from '../types/apiTypes';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { validateCreateStudentInput } from '../lib/validators';
import { auth, loadUser, requireManagerOrAbove, requireClassroomScope } from '../middleware/honoStack';

const studentsApp = new Hono<{ Bindings: ApiBindings; Variables: AppVariables }>();


// 生徒登録
studentsApp.post('/', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateStudentInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  if (actor.role === 'manager' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const db = getDb(c.env);
  const id = crypto.randomUUID();

  try{
      const [classroom] = await db.select({id: classrooms.id}).from(classrooms).where(and(eq(classrooms.id, input.classroomId), isNotNull(classrooms.deletedAt))).limit(1);
      if(!classroom){
        throw new Error('CLASSROOM_NOT_FOUND');
      }
      await db.insert(students).values({id: id, name: input.name, email: input.email, birthYear: input.birthYear, classroomId: input.classroomId});
  }catch(err){
    if(err instanceof Error){
      if(err.message === 'CLASSROOM_NOT_FOUND'){
        return c.json({ message: 'classroom not found' }, 404);      
      }
      return c.json({message: err.message}, 500);
    }
    return c.json({ message: 'failed to create student' }, 500);
  }

  return c.json(
    {
      id,
      name: input.name,
      email: input.email,
      birthYear: input.birthYear,
      classroomId: input.classroomId,
    },
    201,
  );
});

// 生徒削除
studentsApp.delete('/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const db = getDb(c.env);
  const deletedAt = new Date();

  try{
      const [target] = await db.select({ id: students.id, classroomId: students.classroomId }).from(students).where(and(eq(students.id, targetId), isNull(students.deletedAt))).limit(1);
      if(!target){
        throw Error('STUDENT_NOT_FOUND');
      }
      if(actor.role === 'manager' && (actor.classroomId !== target.classroomId)){
        throw Error('FORBIDDEN');
      }
      await db.update(students).set({ deletedAt: deletedAt }).where(and(eq(students.id, targetId), isNull(students.deletedAt)));
  }catch(err){
    if(err instanceof Error){
      if(err.message === 'STUDENT_NOT_FOUND'){
        return c.json({ message: 'student not found' }, 404);
      }
      if(err.message === 'FORBIDDEN'){
        return c.json({ message: 'forbidden'}, 403);
      }
    }
    return c.json({ message: 'failed to delete student' }, 500);
  }

  
  return c.json({ success: true }, 200);
});

// 生徒取得
studentsApp.get('/:classroomId', auth, loadUser, requireClassroomScope((c) => c.req.param('classroomId') ?? null), async (c) => {
  const classroomId = c.req.param('classroomId');
  if (!classroomId) {
    return c.json({ message: 'classroom id is required' }, 400);
  }
  const db = getDb(c.env);

  const rows = await db
    .select({
      id: students.id,
      name: students.name,
      email: students.email,
      birthYear: students.birthYear,
    })
    .from(students)
    .where(and(eq(students.classroomId, classroomId), isNull(students.deletedAt)));
  return c.json(rows, 200);
});

export default studentsApp;
