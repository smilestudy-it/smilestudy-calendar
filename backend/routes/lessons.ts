/*
  lesson追加/削除などのAPIを管理
*/
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
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
  validateCreateLessonInput,
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

  const [classroom] = await db
    .select()
    .from(classrooms)
    .where(
      and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)),
    )
    .limit(1);
  if (!classroom) {
    return c.json({ message: 'classroom not found' }, 404);
  }
  if (input.subjectId) {
    const [row] = await db
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), isNull(subjects.deletedAt)))
      .limit(1);
    if (!row) {
      return c.json({ message: 'invalid subject' }, 400);
    }
  }
  if (input.lessonTypeId) {
    const [row] = await db
      .select()
      .from(lessonTypes)
      .where(
        and(
          eq(lessonTypes.id, input.lessonTypeId),
          isNull(lessonTypes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      return c.json({ message: 'invalid lesson type' }, 400);
    }
  }

  const id = crypto.randomUUID();

  try {
    const res = await db.insert(lessons).values({
      id,
      teacherId: input.teacherId,
      studentId: input.studentId,
      classroomId: input.classroomId,
      subjectId: input.subjectId ?? null,
      lessonTypeId: input.lessonTypeId ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      deletedAt: null,
    });
    if (res.meta.changes === 0) {
      return c.json({ message: 'failed to create lessons' }, 500);
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      return c.json({ message: err.message }, 500);
    }
    return c.json({ message: 'internal server error' }, 500);
  }
  return c.json({ success: true, id }, 200);
});

lessonsApp.post('/', auth, loadUser, async (c) => {
  const actor = c.var.currentUser;
  const input = await c.req.json().catch(() => null);

  // 1. 基本的な入力チェック
  if (
    !input ||
    !input.classroomId ||
    !input.teacherId ||
    !input.studentId ||
    !input.dateKey ||
    !input.timeSlotId
  ) {
    return c.json({ message: '必要な情報が不足しています' }, 400);
  }

  // 2. アクセス権限チェック（他教室への操作禁止）
  if (actor.role !== 'admin' && actor.classroomId !== input.classroomId) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const db = getDb(c.env);
  const classroomId = input.classroomId;

  // 3. 時間枠の取得と UTC 日時の計算
  const [slotRow] = await db
    .select({
      startTime: timeSlots.startTime,
      endTime: timeSlots.endTime,
    })
    .from(timeSlots)
    .where(
      and(
        eq(timeSlots.id, input.timeSlotId),
        eq(timeSlots.classroomId, classroomId),
        isNull(timeSlots.deletedAt),
      ),
    )
    .limit(1);

  if (!slotRow) {
    return c.json({ message: '指定された時間枠が見つかりません' }, 400);
  }

  // 💡 日本のアプリであることを前提に、フロントから timezoneOffsetMinutes が来ない場合は -540 (JST) とする
  const tzOff = input.timezoneOffsetMinutes ?? -540;
  const startAt = utcDateFromLocalDateKeyAndHm(
    input.dateKey,
    slotRow.startTime,
    tzOff,
  );
  const endAt = utcDateFromLocalDateKeyAndHm(
    input.dateKey,
    slotRow.endTime,
    tzOff,
  );

  if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
    return c.json({ message: '日時の計算に失敗しました' }, 400);
  }

  // 4. 講師本人の登録かどうかのチェック
  const staffTeacherDenied = denyUnlessStaffLessonTeacherIsSelf(
    c,
    actor,
    input.teacherId,
  );
  if (staffTeacherDenied) {
    return c.json({ message: 'forbidden' }, 403);
  }

  // === 🚨 5. ダブルブッキングの明示的ブロック 🚨 ===
  const [existingLesson] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      and(
        // 👇 講師 か 生徒 のどちらかの予定が入っていれば引っかかるように OR を使う
        or(
          eq(lessons.teacherId, input.teacherId),
          eq(lessons.studentId, input.studentId),
        ),
        isNull(lessons.deletedAt),
        lt(lessons.startAt, endAt),
        gt(lessons.endAt, startAt),
      ),
    )
    .limit(1);

  if (existingLesson) {
    return c.json(
      { message: 'schedule conflict: すでにこの時間帯には授業が入っています' },
      409,
    );
  }

  // 6. 生徒や講師が実在するかのチェック
  const [teacher] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.teacherId), isNull(users.deletedAt)))
    .limit(1);

  if (!teacher) {
    return c.json({ message: '講師が見つかりません' }, 400);
  }

  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, input.studentId), isNull(students.deletedAt)))
    .limit(1);

  if (!student) {
    return c.json({ message: '生徒が見つかりません' }, 400);
  }

  // 7. データベースへ登録
  const id = crypto.randomUUID();
  try {
    await db.insert(lessons).values({
      id,
      classroomId,
      teacherId: input.teacherId,
      studentId: input.studentId,
      subjectId: input.subjectId ?? null,
      lessonTypeId: input.lessonTypeId ?? null,
      startAt,
      endAt,
      status: input.status ?? 'published', // 即時確定なら published とする
      deletedAt: null,
    });
  } catch (err) {
    console.error('POST /lessons insert error:', err);
    return c.json({ message: 'サーバーエラーが発生しました' }, 500);
  }

  // 8. 成功レスポンス
  return c.json({ ok: true, id }, 201);
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
    if (err instanceof Error) {
      if (isD1ForeignKeyViolation(err)) {
        return c.json({ message: 'invalid reference' }, 400);
      } else if (err.message.includes('double_booking')) {
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
