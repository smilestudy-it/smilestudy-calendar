/*
  lesson追加/削除などのAPIを管理
*/
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import {
  classrooms,
  lessonTypes,
  lessons,
  students,
  subjects,
  users,
} from '../db/schema';
import {
  lessonPresetDisplay,
  lessonStudentDisplay,
  lessonTeacherDisplay,
} from '../lessonDisplay';
import {
  validateCreateLessonInput,
  validateLessonRangeQuery,
  validatePatchLessonInput,
} from '../lib/validators';
import { auth, loadUser, requireClassroomScope } from '../middleware/honoStack';
import type { ApiBindings, AppVariables } from '../types/apiTypes';

const lessonsApp = new Hono<{
  Bindings: ApiBindings;
  Variables: AppVariables;
}>();

lessonsApp.get(
  '/:classroomId',
  auth,
  loadUser,
  requireClassroomScope((c) => c.req.param('classroomId') ?? null),
  async (c) => {
    const classroomId = c.req.param('classroomId');
    if (!classroomId) {
      return c.json({ message: 'classroom id is required' }, 400);
    }
    const { from, to, error } = validateLessonRangeQuery({
      from: c.req.query('from') ?? undefined,
      to: c.req.query('to') ?? undefined,
    });
    if (!from || !to || error) {
      return c.json({ message: error ?? 'invalid request' }, 400);
    }
    const db = getDb(c.env);
    const lessonRows = await db
      .select({
        id: lessons.id,
        teacherId: lessons.teacherId,
        studentId: lessons.studentId,
        classroomId: lessons.classroomId,
        subjectId: lessons.subjectId,
        lessonTypeId: lessons.lessonTypeId,
        startAt: lessons.startAt,
        endAt: lessons.endAt,
      })
      .from(lessons)
      .where(
        and(
          eq(lessons.classroomId, classroomId),
          isNull(lessons.deletedAt),
          lt(lessons.startAt, to),
          gt(lessons.endAt, from),
        ),
      );

    const teacherIds = [...new Set(lessonRows.map((r) => r.teacherId))];
    const studentIds = [...new Set(lessonRows.map((r) => r.studentId))];
    const subjectIds = [...new Set(lessonRows.map((r) => r.subjectId))];
    const lessonTypeIds = [...new Set(lessonRows.map((r) => r.lessonTypeId))];

    const [teacherMeta, studentMeta, subjectMeta, lessonTypeMeta] =
      await Promise.all([
        teacherIds.length > 0
          ? db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                deletedAt: users.deletedAt,
              })
              .from(users)
              .where(inArray(users.id, teacherIds))
          : Promise.resolve([]),
        studentIds.length > 0
          ? db
              .select({
                id: students.id,
                name: students.name,
                deletedAt: students.deletedAt,
              })
              .from(students)
              .where(inArray(students.id, studentIds))
          : Promise.resolve([]),
        subjectIds.length > 0
          ? db
              .select({
                id: subjects.id,
                name: subjects.name,
                deletedAt: subjects.deletedAt,
              })
              .from(subjects)
              .where(
                and(
                  inArray(subjects.id, subjectIds),
                  eq(subjects.classroomId, classroomId),
                ),
              )
          : Promise.resolve([]),
        lessonTypeIds.length > 0
          ? db
              .select({
                id: lessonTypes.id,
                name: lessonTypes.name,
                deletedAt: lessonTypes.deletedAt,
              })
              .from(lessonTypes)
              .where(
                and(
                  inArray(lessonTypes.id, lessonTypeIds),
                  eq(lessonTypes.classroomId, classroomId),
                ),
              )
          : Promise.resolve([]),
      ]);

    const teacherById = new Map(teacherMeta.map((t) => [t.id, t]));
    const studentById = new Map(studentMeta.map((s) => [s.id, s]));
    const subjectById = new Map(subjectMeta.map((s) => [s.id, s]));
    const lessonTypeById = new Map(lessonTypeMeta.map((lt) => [lt.id, lt]));

    const rows = lessonRows.map((row) => ({
      ...row,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      teacherDisplay: lessonTeacherDisplay(teacherById.get(row.teacherId)),
      studentDisplay: lessonStudentDisplay(studentById.get(row.studentId)),
      subjectDisplay: lessonPresetDisplay(subjectById.get(row.subjectId)),
      lessonTypeDisplay: lessonPresetDisplay(
        lessonTypeById.get(row.lessonTypeId),
      ),
    }));

    return c.json(rows, 200);
  },
);

lessonsApp.post('/', auth, loadUser, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateLessonInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (
    (actor.role !== 'admin' && actor.classroomId !== input.classroomId) ||
    (actor.role === 'staff' && actor.id !== input.teacherId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const db = getDb(c.env);

  const [
    [classroomRes],
    [teacherRes],
    [studentRes],
    [subjectRes],
    [lessonTypeRes],
  ] = await Promise.all([
    db
      .select()
      .from(classrooms)
      .where(
        and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)),
      )
      .limit(1),
    db
      .select()
      .from(users)
      .where(and(eq(users.id, input.teacherId), isNull(users.deletedAt)))
      .limit(1),
    db
      .select()
      .from(students)
      .where(
        and(
          eq(students.id, input.studentId),
          eq(students.classroomId, input.classroomId),
          isNull(students.deletedAt),
        ),
      )
      .limit(1),
    db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.id, input.subjectId),
          eq(subjects.classroomId, input.classroomId),
          isNull(subjects.deletedAt),
        ),
      )
      .limit(1),
    db
      .select()
      .from(lessonTypes)
      .where(
        and(
          eq(lessonTypes.id, input.lessonTypeId),
          eq(lessonTypes.classroomId, input.classroomId),
          isNull(lessonTypes.deletedAt),
        ),
      )
      .limit(1),
  ]);
  if (!classroomRes) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  if (!teacherRes) {
    return c.json({ message: 'teacher not found' }, 404);
  }
  if (!studentRes) {
    return c.json({ message: 'student not found' }, 404);
  }
  if (!subjectRes) {
    return c.json({ message: 'invalid subject' }, 400);
  }
  if (!lessonTypeRes) {
    return c.json({ message: 'invalid lesson type' }, 400);
  }

  const id = crypto.randomUUID();

  try {
    await db.insert(lessons).values({
      id,
      teacherId: input.teacherId,
      studentId: input.studentId,
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      lessonTypeId: input.lessonTypeId,
      startAt: input.startAt,
      endAt: input.endAt,
      deletedAt: null,
    });
  } catch (err: unknown) {
    console.error('create lesson failed', err);
    return c.json({ message: 'create lesson failed' }, 500);
  }
  return c.json({ success: true, id }, 200);
});

lessonsApp.patch('/:id', auth, loadUser, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validatePatchLessonInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const db = getDb(c.env);
  const [existing] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)))
    .limit(1);

  if (!existing) {
    return c.json({ message: 'lesson not found' }, 404);
  }

  if (
    (actor.role === 'manager' && actor.classroomId !== existing.classroomId) ||
    (actor.role === 'staff' && actor.id !== existing.teacherId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const [subject] = await db
    .select()
    .from(subjects)
    .where(
      and(
        eq(subjects.id, input.subjectId),
        eq(subjects.classroomId, existing.classroomId),
        isNull(subjects.deletedAt),
      ),
    )
    .limit(1);
  if (!subject) {
    return c.json({ message: 'invalid subject' }, 400);
  }

  const [lessonType] = await db
    .select()
    .from(lessonTypes)
    .where(
      and(
        eq(lessonTypes.id, input.lessonTypeId),
        eq(lessonTypes.classroomId, existing.classroomId),
        isNull(lessonTypes.deletedAt),
      ),
    )
    .limit(1);
  if (!lessonType) {
    return c.json({ message: 'invalid lesson type' }, 400);
  }

  try {
    const res = await db
      .update(lessons)
      .set({ lessonTypeId: input.lessonTypeId, subjectId: input.subjectId })
      .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)));
    if (res.meta.changes === 0) {
      return c.json({ message: 'failed to update lesson' }, 500);
    }
  } catch (e: unknown) {
    console.error('patch lesson failed', e);
    return c.json({ message: 'patch lesson failed' }, 500);
  }
  return c.json(
    {
      id: targetId,
      lessonTypeId: input.lessonTypeId,
      subjectId: input.subjectId,
    },
    200,
  );
});

lessonsApp.delete('/:id', auth, loadUser, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const db = getDb(c.env);
  const [existing] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)))
    .limit(1);

  if (!existing) {
    return c.json({ message: 'lesson not found' }, 404);
  }

  if (
    (actor.role === 'manager' && actor.classroomId !== existing.classroomId) ||
    (actor.role === 'staff' && actor.id !== existing.teacherId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }
  const deletedAt = new Date();

  try {
    const res = await db
      .update(lessons)
      .set({ deletedAt })
      .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)));
    if (res.meta.changes === 0) {
      return c.json({ message: 'failed to delete lesson' }, 500);
    }
  } catch (e: unknown) {
    console.error('delete lesson failed', e);
    return c.json({ message: 'delete lesson failed' }, 500);
  }
  return c.json({ success: true }, 200);
});

export default lessonsApp;
