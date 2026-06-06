/*
  lesson追加/削除などのAPIを管理
*/
import { and, eq, gt, inArray, isNull, lt} from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import {
  classrooms,
  lessonTypes,
  lessons,
  students,
  subjects,
  timeSlots,
  users,
} from '../db/schema';
import {
  lessonStudentDisplay,
  lessonTeacherDisplay,
  utcDateFromLocalDateKeyAndHm,
} from '../lessonDisplay';
import { isD1ForeignKeyViolation } from '../lib/sqliteConstraint';
import {
  validateBulkLessonsInput,
  validateLessonRangeQuery,
  validatePatchLessonInput,
} from '../lib/validators';
import {
  auth,
  denyUnlessClassroomScope,
  denyUnlessStaffLessonTeacherIsSelf,
  loadUser,
  requireClassroomScope,
} from '../middleware/honoStack';
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
        status: lessons.status,
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

    const teacherMeta =
      teacherIds.length > 0
        ? await db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              deletedAt: users.deletedAt,
            })
            .from(users)
            .where(inArray(users.id, teacherIds))
        : [];

    const studentMeta =
      studentIds.length > 0
        ? await db
            .select({
              id: students.id,
              name: students.name,
              deletedAt: students.deletedAt,
            })
            .from(students)
            .where(inArray(students.id, studentIds))
        : [];

    const teacherById = new Map(teacherMeta.map((t) => [t.id, t]));
    const studentById = new Map(studentMeta.map((s) => [s.id, s]));

    const rows = lessonRows.map((row) => ({
      ...row,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      teacherDisplay: lessonTeacherDisplay(teacherById.get(row.teacherId)),
      studentDisplay: lessonStudentDisplay(studentById.get(row.studentId)),
    }));

    return c.json(rows, 200);
  },
);

type CreateLessonTxResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'classroom_not_found'
        | 'teacher_invalid'
        | 'student_invalid'
        | 'subject_invalid'
        | 'lesson_type_invalid'
        | 'teacher_double_booking'
        | 'student_double_booking';
    };

lessonsApp.post('/bulk', auth, loadUser, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateBulkLessonsInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }
  if (actor.role !== 'admin' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const db = getDb(c.env);
  const classroomId = input.classroomId;

  type OpResult = {
    ok: boolean;
    message?: string;
    id?: string;
    dateKey?: string;
    timeSlotId?: string;
  };
  type BulkCreateFailureReason =
    | 'classroom_not_found'
    | 'teacher_invalid'
    | 'student_invalid'
    | 'subject_invalid'
    | 'lesson_type_invalid'
    | 'teacher_double_booking'
    | 'student_double_booking';
  const withCreateRef = (item: { dateKey: string; timeSlotId: string }) => ({
    dateKey: item.dateKey,
    timeSlotId: item.timeSlotId,
  });
  const mapBulkCreateReason = (reason: BulkCreateFailureReason) => {
    switch (reason) {
      case 'teacher_double_booking':
      case 'student_double_booking':
        return 'schedule conflict';
      case 'teacher_invalid':
        return 'teacher not found or not in classroom';
      case 'student_invalid':
        return 'student not found or not in classroom';
      case 'subject_invalid':
        return 'subject not found';
      case 'lesson_type_invalid':
        return 'lesson type not found';
      case 'classroom_not_found':
        return 'classroom not found';
      default:
        return 'failed to create lesson';
    }
  };

  const deleteResults: OpResult[] = [];
  for (const targetId of input.deleteIds ?? []) {
    const [row] = await db
      .select({
        id: lessons.id,
        classroomId: lessons.classroomId,
        teacherId: lessons.teacherId,
      })
      .from(lessons)
      .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)))
      .limit(1);

    if (!row) {
      deleteResults.push({
        ok: false,
        message: 'lesson not found',
        id: targetId,
      });
      continue;
    }
    if (row.classroomId !== classroomId) {
      deleteResults.push({
        ok: false,
        message: 'lesson not in classroom',
        id: targetId,
      });
      continue;
    }

    if (actor.role === 'staff' && row.teacherId !== actor.id) {
      deleteResults.push({ ok: false, message: 'forbidden', id: targetId });
      continue;
    }

    if (actor.role === 'manager') {
      const [teacherUser] = await db
        .select({ classroomId: users.classroomId })
        .from(users)
        .where(eq(users.id, row.teacherId))
        .limit(1);
      if (!teacherUser || teacherUser.classroomId !== row.classroomId) {
        deleteResults.push({ ok: false, message: 'forbidden', id: targetId });
        continue;
      }
    }

    const deletedAt = new Date();
    const result = await db
      .update(lessons)
      .set({ deletedAt })
      .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)));

    if (result.meta.changes === 0) {
      deleteResults.push({
        ok: false,
        message: 'lesson not found',
        id: targetId,
      });
    } else {
      deleteResults.push({ ok: true, id: targetId });
    }
  }

  const createResults: OpResult[] = [];
  const tzOff = input.createsTimezoneOffsetMinutes;
  for (const item of input.creates ?? []) {
    const [slotRow] = await db
      .select({
        id: timeSlots.id,
        startTime: timeSlots.startTime,
        endTime: timeSlots.endTime,
      })
      .from(timeSlots)
      .where(
        and(
          eq(timeSlots.id, item.timeSlotId),
          eq(timeSlots.classroomId, classroomId),
          isNull(timeSlots.deletedAt),
        ),
      )
      .limit(1);

    if (!slotRow) {
      createResults.push({
        ok: false,
        message: 'time slot not found',
        ...withCreateRef(item),
      });
      continue;
    }

    const startAt =
      tzOff === undefined
        ? null
        : utcDateFromLocalDateKeyAndHm(item.dateKey, slotRow.startTime, tzOff);
    const endAt =
      tzOff === undefined
        ? null
        : utcDateFromLocalDateKeyAndHm(item.dateKey, slotRow.endTime, tzOff);
    if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
      createResults.push({
        ok: false,
        message: 'invalid date or time slot range',
        ...withCreateRef(item),
      });
      continue;
    }

    const staffTeacherDenied = denyUnlessStaffLessonTeacherIsSelf(
      c,
      actor,
      item.teacherId,
    );
    if (staffTeacherDenied) {
      createResults.push({
        ok: false,
        message: 'forbidden',
        ...withCreateRef(item),
      });
      continue;
    }

    if (actor.role === 'manager') {
      const [teacherUser] = await db
        .select({ classroomId: users.classroomId })
        .from(users)
        .where(eq(users.id, item.teacherId))
        .limit(1);
      if (!teacherUser || teacherUser.classroomId !== classroomId) {
        createResults.push({
          ok: false,
          message: 'forbidden',
          ...withCreateRef(item),
        });
        continue;
      }
    }

    const createInput = {
      teacherId: item.teacherId,
      studentId: item.studentId,
      classroomId,
      subjectId: item.subjectId,
      lessonTypeId: item.lessonTypeId,
      startAt,
      endAt,
      status: item.status,
    };

    const id = crypto.randomUUID();
    const actorRole = actor.role;

    let txResult: CreateLessonTxResult;
    try {
      txResult = await (async () => {
        const [activeClassroom] = await db
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(
            and(eq(classrooms.id, classroomId), isNull(classrooms.deletedAt)),
          )
          .limit(1);
        if (!activeClassroom) {
          return { ok: false as const, reason: 'classroom_not_found' as const };
        }

        const teacherScope =
          actorRole === 'admin'
            ? and(eq(users.id, createInput.teacherId), isNull(users.deletedAt))
            : and(
                eq(users.id, createInput.teacherId),
                eq(users.classroomId, classroomId),
                isNull(users.deletedAt),
              );

        const [teacher] = await db
          .select({ id: users.id })
          .from(users)
          .where(teacherScope)
          .limit(1);
        if (!teacher) {
          return { ok: false as const, reason: 'teacher_invalid' as const };
        }

        const [student] = await db
          .select({ id: students.id })
          .from(students)
          .where(
            and(
              eq(students.id, createInput.studentId),
              eq(students.classroomId, classroomId),
              isNull(students.deletedAt),
            ),
          )
          .limit(1);
        if (!student) {
          return { ok: false as const, reason: 'student_invalid' as const };
        }

        if (createInput.subjectId) {
          const [sub] = await db
            .select({ id: subjects.id })
            .from(subjects)
            .where(
              and(
                eq(subjects.id, createInput.subjectId),
                eq(subjects.classroomId, classroomId),
                isNull(subjects.deletedAt),
              ),
            )
            .limit(1);
          if (!sub) {
            return { ok: false as const, reason: 'subject_invalid' as const };
          }
        }

        if (createInput.lessonTypeId) {
          const [ltRow] = await db
            .select({ id: lessonTypes.id })
            .from(lessonTypes)
            .where(
              and(
                eq(lessonTypes.id, createInput.lessonTypeId),
                eq(lessonTypes.classroomId, classroomId),
                isNull(lessonTypes.deletedAt),
              ),
            )
            .limit(1);
          if (!ltRow) {
            return {
              ok: false as const,
              reason: 'lesson_type_invalid' as const,
            };
          }
        }

        await db.insert(lessons).values({
          id,
          teacherId: createInput.teacherId,
          studentId: createInput.studentId,
          classroomId,
          subjectId: createInput.subjectId ?? null,
          lessonTypeId: createInput.lessonTypeId ?? null,
          startAt: createInput.startAt,
          endAt: createInput.endAt,
          status: createInput.status ?? 'draft',
          deletedAt: null,
        });
        return { ok: true as const };
      })();
    } catch (err: unknown) {
      console.log('POST /lessons/bulk creates', err);
      if(err instanceof Error){
        const msg = err.message || '';
        if (isD1ForeignKeyViolation(err)) {
          createResults.push({
            ok: false,
            message: 'invalid reference',
            ...withCreateRef(item),
          });
        } else if (msg.includes('teacher_double_booking')){
          createResults.push({
            ok: false,
            message: msg,
            ...withCreateRef(item),
          });
        } else {
          createResults.push({
            ok: false,
            message: 'failed to create lesson',
            ...withCreateRef(item),
          });
        }
      }
      continue;
    }

    if (!txResult.ok) {
      createResults.push({
        ok: false,
        message: mapBulkCreateReason(txResult.reason),
        ...withCreateRef(item),
      });
    } else {
      createResults.push({ ok: true, id, ...withCreateRef(item) });
    }
  }

  return c.json(
    {
      classroomId,
      deletes: deleteResults,
      creates: createResults,
    },
    200,
  );
});

type PatchLessonTxResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'lesson_not_found'
        | 'classroom_not_found'
        | 'teacher_invalid'
        | 'student_invalid'
        | 'subject_invalid'
        | 'lesson_type_invalid'
        | 'teacher_double_booking'
        | 'student_double_booking';
    };

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

  const scopeDenied = denyUnlessClassroomScope(c, existing.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }

  const mergedClassroomId = input.classroomId ?? existing.classroomId;
  const mergedTeacherId = input.teacherId ?? existing.teacherId;
  const mergedStudentId = input.studentId ?? existing.studentId;
  const mergedSubjectId =
    input.subjectId !== undefined ? input.subjectId : existing.subjectId;
  const mergedLessonTypeId =
    input.lessonTypeId !== undefined
      ? input.lessonTypeId
      : existing.lessonTypeId;
  const mergedStartAt = input.startAt ?? existing.startAt;
  const mergedEndAt = input.endAt ?? existing.endAt;
  const mergedStatus = input.status ?? existing.status;

  if (mergedStartAt.getTime() >= mergedEndAt.getTime()) {
    return c.json({ message: 'end must be after start' }, 400);
  }

  const patchScopeDenied = denyUnlessClassroomScope(c, mergedClassroomId);
  if (patchScopeDenied) {
    return patchScopeDenied;
  }

  const patchStaffTeacherDenied = denyUnlessStaffLessonTeacherIsSelf(
    c,
    actor,
    mergedTeacherId,
  );
  if (patchStaffTeacherDenied) {
    return patchStaffTeacherDenied;
  }

  if (actor.role === 'manager') {
    const [teacherUser] = await db
      .select({ classroomId: users.classroomId })
      .from(users)
      .where(eq(users.id, mergedTeacherId))
      .limit(1);
    if (!teacherUser || teacherUser.classroomId !== mergedClassroomId) {
      return c.json({ message: 'forbidden' }, 403);
    }
  }

  const actorRole = actor.role;

  let txResult: PatchLessonTxResult;
  try {
    txResult = await (async () => {
      const [stillThere] = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)))
        .limit(1);
      if (!stillThere) {
        return { ok: false as const, reason: 'lesson_not_found' as const };
      }

      const [activeClassroom] = await db
        .select({ id: classrooms.id })
        .from(classrooms)
        .where(
          and(
            eq(classrooms.id, mergedClassroomId),
            isNull(classrooms.deletedAt),
          ),
        )
        .limit(1);
      if (!activeClassroom) {
        return { ok: false as const, reason: 'classroom_not_found' as const };
      }

      const mergedTeacherScope =
        actorRole === 'admin'
          ? and(eq(users.id, mergedTeacherId), isNull(users.deletedAt))
          : and(
              eq(users.id, mergedTeacherId),
              eq(users.classroomId, mergedClassroomId),
              isNull(users.deletedAt),
            );

      const [teacher] = await db
        .select({ id: users.id })
        .from(users)
        .where(mergedTeacherScope)
        .limit(1);
      if (!teacher) {
        return { ok: false as const, reason: 'teacher_invalid' as const };
      }

      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.id, mergedStudentId),
            eq(students.classroomId, mergedClassroomId),
            isNull(students.deletedAt),
          ),
        )
        .limit(1);
      if (!student) {
        return { ok: false as const, reason: 'student_invalid' as const };
      }

      if (mergedSubjectId) {
        const [sub] = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            and(
              eq(subjects.id, mergedSubjectId),
              eq(subjects.classroomId, mergedClassroomId),
              isNull(subjects.deletedAt),
            ),
          )
          .limit(1);
        if (!sub) {
          return { ok: false as const, reason: 'subject_invalid' as const };
        }
      }

      if (mergedLessonTypeId) {
        const [ltRow] = await db
          .select({ id: lessonTypes.id })
          .from(lessonTypes)
          .where(
            and(
              eq(lessonTypes.id, mergedLessonTypeId),
              eq(lessonTypes.classroomId, mergedClassroomId),
              isNull(lessonTypes.deletedAt),
            ),
          )
          .limit(1);
        if (!ltRow) {
          return { ok: false as const, reason: 'lesson_type_invalid' as const };
        }
      }

      const result = await db
        .update(lessons)
        .set({
          teacherId: mergedTeacherId,
          studentId: mergedStudentId,
          classroomId: mergedClassroomId,
          subjectId: mergedSubjectId,
          lessonTypeId: mergedLessonTypeId,
          startAt: mergedStartAt,
          endAt: mergedEndAt,
          status: mergedStatus,
        })
        .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)));

      if (result.meta.changes === 0) {
        return { ok: false as const, reason: 'lesson_not_found' as const };
      }
      return { ok: true as const };
    })();
  } catch (err: unknown) {
    console.log('PATCH /lessons/:id', err);
    if(err instanceof Error){
      if (isD1ForeignKeyViolation(err)) {
        return c.json({ message: 'invalid reference' }, 400);
      }else if(err.message.includes('double_booking')){
        return c.json({ message: err.message }, 409);
      }
    }
    return c.json({ message: 'failed to update lesson' }, 500);
  }

  if (!txResult.ok) {
    switch (txResult.reason) {
      case 'lesson_not_found':
        return c.json({ message: 'lesson not found' }, 404);
      case 'classroom_not_found':
        return c.json({ message: 'classroom not found' }, 404);
      case 'teacher_invalid':
        return c.json(
          { message: 'teacher not found or not in classroom' },
          400,
        );
      case 'student_invalid':
        return c.json(
          { message: 'student not found or not in classroom' },
          400,
        );
      case 'subject_invalid':
        return c.json({ message: 'subject not found' }, 400);
      case 'lesson_type_invalid':
        return c.json({ message: 'lesson type not found' }, 400);
      default:
        return c.json({ message: 'failed to update lesson' }, 500);
    }
  }

  return c.json(
    {
      id: targetId,
      teacherId: mergedTeacherId,
      studentId: mergedStudentId,
      classroomId: mergedClassroomId,
      subjectId: mergedSubjectId,
      lessonTypeId: mergedLessonTypeId,
      startAt: mergedStartAt,
      endAt: mergedEndAt,
      status: mergedStatus,
    },
    200,
  );
});

export default lessonsApp;
