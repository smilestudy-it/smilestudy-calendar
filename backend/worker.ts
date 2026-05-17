/**
 * （責務）Hono API の集約: `/api` 下の全ルート登録と `onRequest` 提供。Pages Functions は [[route].ts] から export。
 * ルート定義のさらに細かいファイル分割は段階的にここへ集約可能。
 */
import { Hono } from 'hono';
import { and, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from './db';
import { users, classrooms, students, subjects, lessonTypes, timeSlots, lessons } from './db/schema';
import {
  validateCreateClassroomInput,
  validateBulkLessonsInput,
  validateCreateLessonTypeInput,
  validateCreateStudentInput,
  validateCreateSubjectInput,
  validateCreateTimeSlotInput,
  validateCreateUserInput,
  validateLessonRangeQuery,
  validatePatchLessonInput,
  validatePatchLessonTypeInput,
  validatePatchSubjectInput,
  validatePatchTimeSlotInput,
} from './validators';
import type { ApiBindings as Bindings, AppVariables } from './apiTypes';
import { logApiError } from './lib/logApiError';
import {
  isD1ClassroomNameUniqueViolation,
  isD1UsersEmailUniqueViolation,
  isD1ForeignKeyViolation,
  CLASSROOM_NOT_ACTIVE_ERROR,
} from './lib/sqliteConstraint';
import { lessonTeacherDisplay, lessonStudentDisplay, hmToMinutes, utcDateFromLocalDateKeyAndHm } from './lessonDisplay';
import { getActiveStudentAndClassroom } from './lib/studentRead';
import * as auth0 from './auth0Service';
import {
  auth,
  loadUser,
  requireAdmin,
  requireManagerOrAbove,
  requireStaffOrAbove,
  requireClassroomScope,
  denyUnlessClassroomScope,
  denyUnlessStaffLessonTeacherIsSelf,
} from './middleware/honoStack';

const getAuth0ManagementToken = auth0.getAuth0ManagementToken;
const createAuth0User = auth0.createAuth0User;
const deleteAuth0User = auth0.deleteAuth0User;
const sendAuth0PasswordSetupEmail = auth0.sendAuth0PasswordSetupEmail;

export const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>().basePath('/api');
const rootApp = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

let holidayMapPromise: Promise<Record<string, string>> | null = null;

async function getHolidayMap(): Promise<Record<string, string>> {
  if (!holidayMapPromise) {
    holidayMapPromise = (async () => {
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        if (!res.ok) {
          holidayMapPromise = null;
          return {};
        }
        const json = (await res.json()) as Record<string, string>;
        return json;
      } catch {
        holidayMapPromise = null;
        return {};
      }
    })();
  }
  return holidayMapPromise;
}
/** 未認証。`student_id` を知っている利用者向けの簡易共有ビュー用。 */
app.get('/public/student-lessons', async (c) => {
  const studentId = (c.req.query('student_id') ?? '').trim();
  if (!studentId) {
    return c.json({ message: 'student_id is required' }, 400);
  }
  const { from, to, error } = validateLessonRangeQuery({
    from: c.req.query('from') ?? undefined,
    to: c.req.query('to') ?? undefined,
  });
  if (!from || !to || error) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const db = getDb(c.env);

  const scope = await getActiveStudentAndClassroom(db, studentId);
  if (!scope || !scope.classroom) {
    return c.json({ message: 'not found' }, 404);
  }
  const { student: studentRow } = scope;

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
        eq(lessons.studentId, studentId),
        isNull(lessons.deletedAt),
        inArray(lessons.status, ['published', 'completed']),
        lt(lessons.startAt, to),
        gt(lessons.endAt, from),
      ),
    );

  const teacherIds = [...new Set(lessonRows.map((r) => r.teacherId))];
  const activeTeachers =
    teacherIds.length > 0
      ? await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            color: users.color,
            deletedAt: users.deletedAt,
          })
          .from(users)
          .where(and(inArray(users.id, teacherIds), isNull(users.deletedAt)))
      : [];
  const teacherById = new Map(activeTeachers.map((t) => [t.id, t]));
  const visibleLessons = lessonRows.filter((row) => teacherById.has(row.teacherId));

  const subjectIds = [...new Set(visibleLessons.map((r) => r.subjectId).filter((x): x is string => x != null))];
  const lessonTypeIds = [
    ...new Set(visibleLessons.map((r) => r.lessonTypeId).filter((x): x is string => x != null)),
  ];

  const subjectById = new Map<string, string>();
  if (subjectIds.length > 0) {
    const subRows = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(
        and(
          inArray(subjects.id, subjectIds),
          eq(subjects.classroomId, studentRow.classroomId),
          isNull(subjects.deletedAt),
        ),
      );
    for (const s of subRows) {
      subjectById.set(s.id, s.name);
    }
  }

  const lessonTypeById = new Map<string, string>();
  if (lessonTypeIds.length > 0) {
    const ltRows = await db
      .select({ id: lessonTypes.id, name: lessonTypes.name })
      .from(lessonTypes)
      .where(
        and(
          inArray(lessonTypes.id, lessonTypeIds),
          eq(lessonTypes.classroomId, studentRow.classroomId),
          isNull(lessonTypes.deletedAt),
        ),
      );
    for (const lt of ltRows) {
      lessonTypeById.set(lt.id, lt.name);
    }
  }

  const rows = visibleLessons.map((row) => ({
    id: row.id,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
    teacherDisplay: lessonTeacherDisplay(teacherById.get(row.teacherId)),
    teacherColor: teacherById.get(row.teacherId)?.color ?? null,
    subjectName: row.subjectId ? (subjectById.get(row.subjectId) ?? null) : null,
    lessonTypeName: row.lessonTypeId ? (lessonTypeById.get(row.lessonTypeId) ?? null) : null,
  }));

  return c.json({ studentName: studentRow.name, lessons: rows }, 200);
});

/** 未認証。指定年月の日本の祝日一覧を返す。 */
app.get('/public/holidays', async (c) => {
  const year = Number(c.req.query('year') ?? '');
  const month = Number(c.req.query('month') ?? '');
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ message: 'year and month query parameters are required' }, 400);
  }

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const holidayMap = await getHolidayMap();
  const holidays = Object.entries(holidayMap)
    .filter(([date]) => date.startsWith(monthPrefix))
    .map(([date, name]) => ({ date, name }));

  return c.json(holidays, 200);
});

app.post('/classrooms', auth, loadUser, requireAdmin, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateClassroomInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const db = getDb(c.env);
  const [existingClassroom] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.name, input.name), isNull(classrooms.deletedAt)))
    .limit(1);

  if (existingClassroom) {
    return c.json({ message: 'classroom already exists' }, 409);
  }

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

app.get('/classrooms', auth, loadUser, requireAdmin, async(c) =>{
  const db = getDb(c.env);

  const rows = await db.select({id: classrooms.id, name: classrooms.name}).from(classrooms).where(isNull(classrooms.deletedAt));
  return c.json(rows, 200);
});

app.delete('/classrooms/:id', auth, loadUser, requireAdmin, async(c) =>{
  const id = c.req.param('id');
  if(!id){
    return c.json({ message: 'id is required' }, 400);
  }
  const db = getDb(c.env);
  const deletedAt = new Date();

  const classroomUsersPreview = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

  let managementToken = '';
  if (classroomUsersPreview.length > 0) {
    try {
      managementToken = await getAuth0ManagementToken(c.env);
    } catch {
      return c.json({ message: 'failed to delete classroom' }, 502);
    }
  }

  const updatedUserIds: string[] = [];
  const updatedStudentIds: string[] = [];
  const updatedSubjectIds: string[] = [];
  const updatedLessonTypeIds: string[] = [];
  const updatedTimeSlotIds: string[] = [];
  const updatedLessonIds: string[] = [];
  let classroomSoftDeleted = false;
  let notFound = false;

  const rollbackPartialClassroomDelete = async () => {
    if (!classroomSoftDeleted) {
      return;
    }
    for (const lessonId of updatedLessonIds) {
      await db
        .update(lessons)
        .set({ deletedAt: null })
        .where(eq(lessons.id, lessonId))
        .catch(() => undefined);
    }
    for (const slotId of updatedTimeSlotIds) {
      await db
        .update(timeSlots)
        .set({ deletedAt: null })
        .where(eq(timeSlots.id, slotId))
        .catch(() => undefined);
    }
    for (const ltId of updatedLessonTypeIds) {
      await db
        .update(lessonTypes)
        .set({ deletedAt: null })
        .where(eq(lessonTypes.id, ltId))
        .catch(() => undefined);
    }
    for (const subId of updatedSubjectIds) {
      await db
        .update(subjects)
        .set({ deletedAt: null })
        .where(eq(subjects.id, subId))
        .catch(() => undefined);
    }
    for (const studentId of updatedStudentIds) {
      await db
        .update(students)
        .set({ deletedAt: null })
        .where(eq(students.id, studentId))
        .catch(() => undefined);
    }
    for (const userId of updatedUserIds) {
      await db
        .update(users)
        .set({ deletedAt: null })
        .where(eq(users.id, userId))
        .catch(() => undefined);
    }
    await db
      .update(classrooms)
      .set({ deletedAt: null })
      .where(eq(classrooms.id, id))
      .catch(() => undefined);
  };

  try {
    // Serialize classroom soft-delete + user/student/preset/lesson soft-deletes. D1 in this stack
    // cannot use Drizzle db.transaction (SQL BEGIN rejected); sequence is not all-or-nothing on failure.
    // Members are selected only after the classroom row is marked deleted so concurrent creates
    // that re-check `classrooms.deleted_at` cannot commit into an "open" classroom.
    const result = await db
      .update(classrooms)
      .set({ deletedAt })
      .where(and(eq(classrooms.id, id), isNull(classrooms.deletedAt)));

    if (result.meta.changes === 0) {
      notFound = true;
    } else {
      classroomSoftDeleted = true;

      const classroomUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.classroomId, id), isNull(users.deletedAt)));

      for (const classroomUser of classroomUsers) {
        const userUpdateResult = await db
          .update(users)
          .set({ deletedAt })
          .where(and(eq(users.id, classroomUser.id), isNull(users.deletedAt)));

        if (userUpdateResult.meta.changes > 0) {
          updatedUserIds.push(classroomUser.id);
        }
      }

      const classroomStudents = await db
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.classroomId, id), isNull(students.deletedAt)));

      for (const row of classroomStudents) {
        const studentUpdateResult = await db
          .update(students)
          .set({ deletedAt })
          .where(and(eq(students.id, row.id), isNull(students.deletedAt)));

        if (studentUpdateResult.meta.changes > 0) {
          updatedStudentIds.push(row.id);
        }
      }

      const classroomSubjects = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.classroomId, id), isNull(subjects.deletedAt)));

      for (const row of classroomSubjects) {
        const r = await db
          .update(subjects)
          .set({ deletedAt })
          .where(and(eq(subjects.id, row.id), isNull(subjects.deletedAt)));
        if (r.meta.changes > 0) {
          updatedSubjectIds.push(row.id);
        }
      }

      const classroomLessonTypes = await db
        .select({ id: lessonTypes.id })
        .from(lessonTypes)
        .where(and(eq(lessonTypes.classroomId, id), isNull(lessonTypes.deletedAt)));

      for (const row of classroomLessonTypes) {
        const r = await db
          .update(lessonTypes)
          .set({ deletedAt })
          .where(and(eq(lessonTypes.id, row.id), isNull(lessonTypes.deletedAt)));
        if (r.meta.changes > 0) {
          updatedLessonTypeIds.push(row.id);
        }
      }

      const classroomTimeSlots = await db
        .select({ id: timeSlots.id })
        .from(timeSlots)
        .where(and(eq(timeSlots.classroomId, id), isNull(timeSlots.deletedAt)));

      for (const row of classroomTimeSlots) {
        const r = await db
          .update(timeSlots)
          .set({ deletedAt })
          .where(and(eq(timeSlots.id, row.id), isNull(timeSlots.deletedAt)));
        if (r.meta.changes > 0) {
          updatedTimeSlotIds.push(row.id);
        }
      }

      const classroomLessons = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.classroomId, id), isNull(lessons.deletedAt)));

      for (const row of classroomLessons) {
        const r = await db
          .update(lessons)
          .set({ deletedAt })
          .where(and(eq(lessons.id, row.id), isNull(lessons.deletedAt)));
        if (r.meta.changes > 0) {
          updatedLessonIds.push(row.id);
        }
      }
    }
  } catch (err) {
    logApiError('DELETE /classrooms/:id', err);
    await rollbackPartialClassroomDelete();
    return c.json({ message: 'failed to delete classroom' }, 500);
  }

  if (notFound) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  const rollbackClassroomChildSoftDeletes = async () => {
    for (const lessonId of updatedLessonIds) {
      await db
        .update(lessons)
        .set({ deletedAt: null })
        .where(eq(lessons.id, lessonId))
        .catch(() => undefined);
    }
    for (const studentId of updatedStudentIds) {
      await db
        .update(students)
        .set({ deletedAt: null })
        .where(eq(students.id, studentId))
        .catch(() => undefined);
    }
    for (const presetId of updatedSubjectIds) {
      await db
        .update(subjects)
        .set({ deletedAt: null })
        .where(eq(subjects.id, presetId))
        .catch(() => undefined);
    }
    for (const presetId of updatedLessonTypeIds) {
      await db
        .update(lessonTypes)
        .set({ deletedAt: null })
        .where(eq(lessonTypes.id, presetId))
        .catch(() => undefined);
    }
    for (const presetId of updatedTimeSlotIds) {
      await db
        .update(timeSlots)
        .set({ deletedAt: null })
        .where(eq(timeSlots.id, presetId))
        .catch(() => undefined);
    }
  };

  if (updatedUserIds.length > 0 && !managementToken) {
    try {
      managementToken = await getAuth0ManagementToken(c.env);
    } catch {
      await db.update(classrooms).set({ deletedAt: null }).where(eq(classrooms.id, id)).catch(() => undefined);
      for (const userId of updatedUserIds) {
        await db.update(users).set({ deletedAt: null }).where(eq(users.id, userId)).catch(() => undefined);
      }
      await rollbackClassroomChildSoftDeletes();
      return c.json({ message: 'failed to delete classroom' }, 502);
    }
  }

  const successfullyDeletedAuth0Ids: string[] = [];
  try {
    for (const userId of updatedUserIds) {
      const auth0Deleted = await deleteAuth0User(c.env, managementToken, userId);
      if (!auth0Deleted) {
        throw new Error('failed to delete auth0 user');
      }
      successfullyDeletedAuth0Ids.push(userId);
    }
  } catch (err) {
    logApiError('DELETE /classrooms/:id (auth0)', err);
    const successSet = new Set(successfullyDeletedAuth0Ids);
    const remainingIds = updatedUserIds.filter((uid) => !successSet.has(uid));
    const newlySucceeded: string[] = [];
    for (const userId of remainingIds) {
      try {
        if (await deleteAuth0User(c.env, managementToken, userId)) {
          newlySucceeded.push(userId);
        }
      } catch (retryErr) {
        logApiError(`DELETE /classrooms/:id (auth0 retry ${userId})`, retryErr);
      }
    }
    const finalAuth0Deleted = new Set([...successfullyDeletedAuth0Ids, ...newlySucceeded]);
    if (finalAuth0Deleted.size === updatedUserIds.length) {
      return c.json({ success: true }, 200);
    }
    const userIdsToRestoreD1 = updatedUserIds.filter((uid) => !finalAuth0Deleted.has(uid));
    logApiError(
      'DELETE /classrooms/:id (auth0 partial)',
      new Error(
        `auth0 delete incomplete after retry; deletedInAuth0=[${[...finalAuth0Deleted].join(
          ',',
        )}]; restoreD1=[${userIdsToRestoreD1.join(',')}]`,
      ),
    );
    await db.update(classrooms).set({ deletedAt: null }).where(eq(classrooms.id, id)).catch(() => undefined);
    for (const userId of userIdsToRestoreD1) {
      await db.update(users).set({ deletedAt: null }).where(eq(users.id, userId)).catch(() => undefined);
    }
    await rollbackClassroomChildSoftDeletes();
    return c.json({ message: 'failed to delete classroom' }, 502);
  }

  return c.json({ success: true }, 200);
});

app.post('/users', auth, loadUser, requireManagerOrAbove, async (c) =>{
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateCreateUserInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  if (actor.role === 'manager') {
    if (
      input.role === 'admin' ||
      !actor.classroomId ||
      !input.classroomId ||
      actor.classroomId !== input.classroomId
    ) {
      return c.json({ message: 'forbidden' }, 403);
    }
  }

  const db = getDb(c.env);
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    .limit(1);

  if (existingUser) {
    return c.json({ message: 'user already exists' }, 409);
  }

  if (input.classroomId) {
    const [existingClassroom] = await db
      .select({ id: classrooms.id })
      .from(classrooms)
      .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
      .limit(1);

    if (!existingClassroom) {
      return c.json({ message: 'classroom not found' }, 404);
    }
  }

  let managementToken = '';
  try {
    managementToken = await getAuth0ManagementToken(c.env);
  } catch {
    return c.json({ message: 'failed to create user' }, 502);
  }

  let auth0UserId = '';
  let d1Inserted = false;
  let passwordEmailSent = false;
  const displayName = `${input.lastName} ${input.firstName}`.trim();

  try {
    const auth0Result = await createAuth0User(c.env, managementToken, input.email, displayName);
    if (!auth0Result.ok) {
      if (auth0Result.status === 409) {
        return c.json({ message: 'user already exists' }, 409);
      }
      return c.json({ message: auth0Result.message }, 502);
    }

    auth0UserId = auth0Result.userId;

    if (input.classroomId) {
      const [classroomStillActive] = await db
        .select({ id: classrooms.id })
        .from(classrooms)
        .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
        .limit(1);

      if (!classroomStillActive) {
        throw new Error(CLASSROOM_NOT_ACTIVE_ERROR);
      }
    }

    await db.insert(users).values({
      id: auth0UserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: input.role,
      classroomId: input.classroomId,
      color: input.color,
      deletedAt: null,
    });
    d1Inserted = true;

    passwordEmailSent = await sendAuth0PasswordSetupEmail(c.env, input.email);
    if (!passwordEmailSent) {
      logApiError('POST /users (password email)', new Error('password setup email not accepted by Auth0'));
    }
  } catch (error) {
    if (d1Inserted && auth0UserId) {
      await db.delete(users).where(eq(users.id, auth0UserId)).catch(() => undefined);
    }
    if (managementToken && auth0UserId) {
      const auth0RollbackDeleted = await deleteAuth0User(c.env, managementToken, auth0UserId);
      if (!auth0RollbackDeleted) {
        return c.json({ message: 'failed to roll back remote user' }, 500);
      }
    }
    if (error instanceof Error && error.message === CLASSROOM_NOT_ACTIVE_ERROR) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    if (isD1UsersEmailUniqueViolation(error)) {
      return c.json({ message: 'user already exists' }, 409);
    }
    return c.json({ message: 'failed to create user' }, 500);
  }

  return c.json(
    {
      id: auth0UserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: input.role,
      classroomId: input.classroomId,
      color: input.color,
      passwordEmailSent,
    },
    201,
  );
});

app.get('/users/admins', auth, loadUser, requireManagerOrAbove, async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      classroomId: users.classroomId,
    })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)));
  return c.json(rows, 200);
});

app.get('/users/:classroomId', auth, loadUser, requireStaffOrAbove, requireClassroomScope((c) => c.req.param('classroomId') ?? null), async(c) =>{
  const classroomId = c.req.param('classroomId');
  if(!classroomId){
    return c.json({ message: 'classroom id is required' }, 400);
  }
  const actor = c.var.currentUser;
  const db = getDb(c.env);
  const includeEmail = actor.role === 'admin';

  const rows = includeEmail
    ? await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
          classroomId: users.classroomId,
          color: users.color,
        })
        .from(users)
        .where(and(eq(users.classroomId, classroomId), isNull(users.deletedAt)))
    : await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          classroomId: users.classroomId,
          color: users.color,
        })
        .from(users)
        .where(and(eq(users.classroomId, classroomId), isNull(users.deletedAt)));

  const includeAdminsQuery =
    (c.req.query('includeAdmins') === '1' || c.req.query('includeAdmins') === 'true') &&
    (actor.role === 'admin' || actor.role === 'manager');
  if (includeAdminsQuery) {
    const admins = includeEmail
      ? await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
            classroomId: users.classroomId,
            color: users.color,
          })
          .from(users)
          .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)))
      : await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
            classroomId: users.classroomId,
            color: users.color,
          })
          .from(users)
          .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)));
    const seen = new Set(rows.map((r) => r.id));
    for (const a of admins) {
      if (!seen.has(a.id)) {
        rows.push(a);
        seen.add(a.id);
      }
    }
  }

  rows.sort((a, b) => {
    const an = `${a.lastName ?? ''} ${a.firstName ?? ''}`.trim();
    const bn = `${b.lastName ?? ''} ${b.firstName ?? ''}`.trim();
    return an.localeCompare(bn, 'ja');
  });

  return c.json(rows, 200);
});

app.delete('/users/:id', auth, loadUser, requireManagerOrAbove, async(c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if(!targetId){
    return c.json({ message: 'id is required' }, 400);
  } 

  const db = getDb(c.env);

  const [target] = await db
    .select({ id: users.id, role: users.role, classroomId: users.classroomId, email: users.email })
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if(!target){
    return c.json({ message: 'user not found' }, 404);
  }

  if (actor.id === targetId) {
    return c.json({ message: 'cannot delete yourself' }, 403);
  }

  if(actor.role === 'manager' && (target.role === 'admin' || (!actor.classroomId || !target.classroomId || actor.classroomId !== target.classroomId))){
    return c.json({ message: 'forbidden' }, 403);
  }

  let managementToken = '';
  const deletedAt = new Date();

  try {
    managementToken = await getAuth0ManagementToken(c.env);
  } catch {
    return c.json({ message: 'failed to delete user' }, 502);
  }

  const result = await db
    .update(users)
    .set({ deletedAt })
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)));

  if(result.meta.changes === 0){
    return c.json({ message: 'user not found' }, 404);
  }

  const rollbackUserSoftDelete = async () => {
    await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, targetId))
      .catch(() => undefined);
  };

  try {
    const auth0Deleted = await deleteAuth0User(c.env, managementToken, targetId);
    if (!auth0Deleted) {
      await rollbackUserSoftDelete();
      return c.json({ message: 'failed to delete user' }, 502);
    }
  } catch {
    await rollbackUserSoftDelete();
    return c.json({ message: 'failed to delete user' }, 502);
  }
  
  return c.json({ success: true }, 200);
});


app.post('/students', auth, loadUser, requireManagerOrAbove, async (c) => {
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

  try {
    const insertRun = await db.run(sql`
      INSERT INTO ${students} (${sql.identifier('id')}, ${sql.identifier('name')}, ${sql.identifier('email')}, ${sql.identifier('birth_year')}, ${sql.identifier('classroom_id')}, ${sql.identifier('deleted_at')})
      SELECT ${id}, ${input.name}, ${input.email}, ${input.birthYear}, ${input.classroomId}, NULL
      WHERE EXISTS (
        SELECT 1 FROM ${classrooms}
        WHERE ${and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt))}
      )
    `);
    if (insertRun.meta.changes !== 1) {
      return c.json({ message: 'classroom not found' }, 404);
    }
  } catch (err) {
    logApiError('POST /students', err);
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
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

app.delete('/students/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const targetId = c.req.param('id');
  if (!targetId) {
    return c.json({ message: 'id is required' }, 400);
  }

  const db = getDb(c.env);

  const [target] = await db
    .select({ id: students.id, classroomId: students.classroomId })
    .from(students)
    .where(and(eq(students.id, targetId), isNull(students.deletedAt)))
    .limit(1);

  if (!target) {
    return c.json({ message: 'student not found' }, 404);
  }

  if (
    actor.role === 'manager' &&
    (!actor.classroomId || actor.classroomId !== target.classroomId)
  ) {
    return c.json({ message: 'forbidden' }, 403);
  }

  const deletedAt = new Date();
  const result = await db
    .update(students)
    .set({ deletedAt })
    .where(and(eq(students.id, targetId), isNull(students.deletedAt)));

  if (result.meta.changes === 0) {
    return c.json({ message: 'student not found' }, 404);
  }

  return c.json({ success: true }, 200);
});

app.get('/students/:classroomId', auth, loadUser, requireClassroomScope((c) => c.req.param('classroomId') ?? null), async (c) => {
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

app.get(
  '/classrooms/:classroomId/subjects',
  auth,
  loadUser,
  requireStaffOrAbove,
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
      .where(and(eq(subjects.classroomId, classroomId), isNull(subjects.deletedAt)));
    return c.json(rows, 200);
  },
);

app.get(
  '/classrooms/:classroomId/lesson-types',
  auth,
  loadUser,
  requireStaffOrAbove,
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
      .where(and(eq(lessonTypes.classroomId, classroomId), isNull(lessonTypes.deletedAt)));
    return c.json(rows, 200);
  },
);

app.get(
  '/classrooms/:classroomId/time-slots',
  auth,
  loadUser,
  requireStaffOrAbove,
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
      .where(and(eq(timeSlots.classroomId, classroomId), isNull(timeSlots.deletedAt)));
    return c.json(rows, 200);
  },
);

app.post('/subjects', auth, loadUser, requireManagerOrAbove, async (c) => {
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

  type CreateSubjectTxResult = { ok: true } | { ok: false; reason: 'classroom_not_found' };

  // POST /lesson-types and POST /time-slots use the same non-transactional check-then-insert pattern (D1).
  let txResult: CreateSubjectTxResult;
  try {
    txResult = await (async () => {
        const [activeClassroom] = await db
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
          .limit(1);
        if (!activeClassroom) {
          return { ok: false as const, reason: 'classroom_not_found' as const };
        }
        await db.insert(subjects).values({
          id: newId,
          name: input.name,
          classroomId: input.classroomId,
          deletedAt: null,
        });
        return { ok: true as const };
    })();
  } catch (err) {
    logApiError('POST /subjects', err);
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create subject' }, 500);
  }

  if (!txResult.ok) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  return c.json({ id: newId, name: input.name, classroomId: input.classroomId }, 201);
});

app.post('/lesson-types', auth, loadUser, requireManagerOrAbove, async (c) => {
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

  type CreateLessonTypeTxResult = { ok: true } | { ok: false; reason: 'classroom_not_found' };

  let txResult: CreateLessonTypeTxResult;
  try {
    txResult = await (async () => {
        const [activeClassroom] = await db
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
          .limit(1);
        if (!activeClassroom) {
          return { ok: false as const, reason: 'classroom_not_found' as const };
        }
        await db.insert(lessonTypes).values({
          id: newId,
          name: input.name,
          classroomId: input.classroomId,
          deletedAt: null,
        });
        return { ok: true as const };
    })();
  } catch (err) {
    logApiError('POST /lesson-types', err);
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create lesson type' }, 500);
  }

  if (!txResult.ok) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  return c.json({ id: newId, name: input.name, classroomId: input.classroomId }, 201);
});

app.post('/time-slots', auth, loadUser, requireManagerOrAbove, async (c) => {
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

  type CreateTimeSlotTxResult = { ok: true } | { ok: false; reason: 'classroom_not_found' };

  let txResult: CreateTimeSlotTxResult;
  try {
    txResult = await (async () => {
        const [activeClassroom] = await db
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.id, input.classroomId), isNull(classrooms.deletedAt)))
          .limit(1);
        if (!activeClassroom) {
          return { ok: false as const, reason: 'classroom_not_found' as const };
        }
        await db.insert(timeSlots).values({
          id: newId,
          classroomId: input.classroomId,
          startTime: input.startTime,
          endTime: input.endTime,
          deletedAt: null,
        });
        return { ok: true as const };
    })();
  } catch (err) {
    logApiError('POST /time-slots', err);
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'classroom not found' }, 404);
    }
    return c.json({ message: 'failed to create time slot' }, 500);
  }

  if (!txResult.ok) {
    return c.json({ message: 'classroom not found' }, 404);
  }

  return c.json(
    {
      id: newId,
      classroomId: input.classroomId,
      startTime: input.startTime,
      endTime: input.endTime,
    },
    201,
  );
});

app.patch('/subjects/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const result = await db
    .update(subjects)
    .set({ name: input.name })
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'subject not found' }, 404);
  }
  return c.json({ id: targetId, name: input.name, classroomId: row.classroomId }, 200);
});

app.patch('/lesson-types/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const result = await db
    .update(lessonTypes)
    .set({ name: input.name })
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  return c.json({ id: targetId, name: input.name, classroomId: row.classroomId }, 200);
});

app.patch('/time-slots/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
    .select({
      id: timeSlots.id,
      classroomId: timeSlots.classroomId,
      startTime: timeSlots.startTime,
      endTime: timeSlots.endTime,
    })
    .from(timeSlots)
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)))
    .limit(1);
  if (!row) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const nextStart = input.startTime ?? row.startTime;
  const nextEnd = input.endTime ?? row.endTime;
  if (hmToMinutes(nextStart) >= hmToMinutes(nextEnd)) {
    return c.json({ message: 'end time must be after start time' }, 400);
  }
  const result = await db
    .update(timeSlots)
    .set({ startTime: nextStart, endTime: nextEnd })
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  return c.json(
    {
      id: targetId,
      classroomId: row.classroomId,
      startTime: nextStart,
      endTime: nextEnd,
    },
    200,
  );
});

app.delete('/subjects/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(subjects)
    .set({ deletedAt })
    .where(and(eq(subjects.id, targetId), isNull(subjects.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'subject not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.delete('/lesson-types/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(lessonTypes)
    .set({ deletedAt })
    .where(and(eq(lessonTypes.id, targetId), isNull(lessonTypes.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'lesson type not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.delete('/time-slots/:id', auth, loadUser, requireManagerOrAbove, async (c) => {
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
    return c.json({ message: 'time slot not found' }, 404);
  }
  const scopeDenied = denyUnlessClassroomScope(c, row.classroomId);
  if (scopeDenied) {
    return scopeDenied;
  }
  const deletedAt = new Date();
  const result = await db
    .update(timeSlots)
    .set({ deletedAt })
    .where(and(eq(timeSlots.id, targetId), isNull(timeSlots.deletedAt)));
  if (result.meta.changes === 0) {
    return c.json({ message: 'time slot not found' }, 404);
  }
  return c.json({ success: true }, 200);
});

app.get(
  '/classrooms/:classroomId/lessons',
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

app.post('/lessons/bulk', auth, loadUser, requireStaffOrAbove, async (c) => {
  const actor = c.var.currentUser;
  const body = await c.req.json<unknown>().catch(() => null);
  const { input, error } = validateBulkLessonsInput(body);
  if (!input) {
    return c.json({ message: error ?? 'invalid request' }, 400);
  }

  const scopeDenied = denyUnlessClassroomScope(c, input.classroomId);
  if (scopeDenied) {
    return scopeDenied;
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
      .select({ id: lessons.id, classroomId: lessons.classroomId, teacherId: lessons.teacherId })
      .from(lessons)
      .where(and(eq(lessons.id, targetId), isNull(lessons.deletedAt)))
      .limit(1);

    if (!row) {
      deleteResults.push({ ok: false, message: 'lesson not found', id: targetId });
      continue;
    }
    if (row.classroomId !== classroomId) {
      deleteResults.push({ ok: false, message: 'lesson not in classroom', id: targetId });
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
      deleteResults.push({ ok: false, message: 'lesson not found', id: targetId });
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
      createResults.push({ ok: false, message: 'time slot not found', ...withCreateRef(item) });
      continue;
    }

    const startAt =
      tzOff === undefined ? null : utcDateFromLocalDateKeyAndHm(item.dateKey, slotRow.startTime, tzOff);
    const endAt =
      tzOff === undefined ? null : utcDateFromLocalDateKeyAndHm(item.dateKey, slotRow.endTime, tzOff);
    if (!startAt || !endAt || startAt.getTime() >= endAt.getTime()) {
      createResults.push({ ok: false, message: 'invalid date or time slot range', ...withCreateRef(item) });
      continue;
    }

    const staffTeacherDenied = denyUnlessStaffLessonTeacherIsSelf(c, actor, item.teacherId);
    if (staffTeacherDenied) {
      createResults.push({ ok: false, message: 'forbidden', ...withCreateRef(item) });
      continue;
    }

    if (actor.role === 'manager') {
      const [teacherUser] = await db
        .select({ classroomId: users.classroomId })
        .from(users)
        .where(eq(users.id, item.teacherId))
        .limit(1);
      if (!teacherUser || teacherUser.classroomId !== classroomId) {
        createResults.push({ ok: false, message: 'forbidden', ...withCreateRef(item) });
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
          .where(and(eq(classrooms.id, classroomId), isNull(classrooms.deletedAt)))
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

        const [teacher] = await db.select({ id: users.id }).from(users).where(teacherScope).limit(1);
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
            return { ok: false as const, reason: 'lesson_type_invalid' as const };
          }
        }

        const [teacherClash] = await db
          .select({ id: lessons.id })
          .from(lessons)
          .where(
            and(
              eq(lessons.teacherId, createInput.teacherId),
              isNull(lessons.deletedAt),
              lt(lessons.startAt, createInput.endAt),
              gt(lessons.endAt, createInput.startAt),
            ),
          )
          .limit(1);
        if (teacherClash) {
          return { ok: false as const, reason: 'teacher_double_booking' as const };
        }

        const [studentClash] = await db
          .select({ id: lessons.id })
          .from(lessons)
          .where(
            and(
              eq(lessons.studentId, createInput.studentId),
              isNull(lessons.deletedAt),
              lt(lessons.startAt, createInput.endAt),
              gt(lessons.endAt, createInput.startAt),
            ),
          )
          .limit(1);
        if (studentClash) {
          return { ok: false as const, reason: 'student_double_booking' as const };
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
    } catch (err) {
      logApiError('POST /lessons/bulk creates', err);
      if (isD1ForeignKeyViolation(err)) {
        createResults.push({ ok: false, message: 'invalid reference', ...withCreateRef(item) });
      } else {
        createResults.push({ ok: false, message: 'failed to create lesson', ...withCreateRef(item) });
      }
      continue;
    }

    if (!txResult.ok) {
      createResults.push({ ok: false, message: mapBulkCreateReason(txResult.reason), ...withCreateRef(item) });
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

app.patch('/lessons/:id', auth, loadUser, async (c) => {
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
  const mergedSubjectId = input.subjectId !== undefined ? input.subjectId : existing.subjectId;
  const mergedLessonTypeId =
    input.lessonTypeId !== undefined ? input.lessonTypeId : existing.lessonTypeId;
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

  const patchStaffTeacherDenied = denyUnlessStaffLessonTeacherIsSelf(c, actor, mergedTeacherId);
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
        .where(and(eq(classrooms.id, mergedClassroomId), isNull(classrooms.deletedAt)))
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

      const [teacher] = await db.select({ id: users.id }).from(users).where(mergedTeacherScope).limit(1);
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

      const [teacherClash] = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(
          and(
            eq(lessons.teacherId, mergedTeacherId),
            isNull(lessons.deletedAt),
            ne(lessons.id, targetId),
            lt(lessons.startAt, mergedEndAt),
            gt(lessons.endAt, mergedStartAt),
          ),
        )
        .limit(1);
      if (teacherClash) {
        return { ok: false as const, reason: 'teacher_double_booking' as const };
      }

      const [studentClash] = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(
          and(
            eq(lessons.studentId, mergedStudentId),
            isNull(lessons.deletedAt),
            ne(lessons.id, targetId),
            lt(lessons.startAt, mergedEndAt),
            gt(lessons.endAt, mergedStartAt),
          ),
        )
        .limit(1);
      if (studentClash) {
        return { ok: false as const, reason: 'student_double_booking' as const };
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
  } catch (err) {
    logApiError('PATCH /lessons/:id', err);
    if (isD1ForeignKeyViolation(err)) {
      return c.json({ message: 'invalid reference' }, 400);
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
        return c.json({ message: 'teacher not found or not in classroom' }, 400);
      case 'student_invalid':
        return c.json({ message: 'student not found or not in classroom' }, 400);
      case 'subject_invalid':
        return c.json({ message: 'subject not found' }, 400);
      case 'lesson_type_invalid':
        return c.json({ message: 'lesson type not found' }, 400);
      case 'teacher_double_booking':
        return c.json({ message: 'teacher schedule conflict' }, 409);
      case 'student_double_booking':
        return c.json({ message: 'student schedule conflict' }, 409);
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

app.get('/me', auth, async (c) => {
  const { sub } = c.var.jwtPayload;
  if (!sub) {
    return c.json({ message: 'invalid token payload' }, 401);
  }

  const db = getDb(c.env);
  const [currentUser] = await db
    .select({
      id: users.id,
      role: users.role,
      classroomId: users.classroomId,
    })
    .from(users)
    .where(and(eq(users.id, sub), isNull(users.deletedAt)))
    .limit(1);

  if (!currentUser) {
    return c.json({ message: 'user not found' }, 404);
  }

  return c.json(currentUser);
});

rootApp.route('/', app);
// frontend
rootApp.get('*', async(c) =>{
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if(!c.env.ASSETS){
    return c.notFound();
  }
  if(res.ok){
    return res;
  }

  const path = new URL(c.req.url).pathname;
  if(path.match(/\.[a-zA-Z0-9]+$/)){
    return c.notFound();
  }

  const indexReq = new Request(new URL('/', c.req.url), c.req);
  return c.env.ASSETS.fetch(indexReq);
})


export default {
  fetch: rootApp.fetch
}