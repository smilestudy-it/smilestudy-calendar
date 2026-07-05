/**
 * （責務）Hono API の集約: `/api` 下の全ルート登録と `onRequest` 提供。Pages Functions は [[route].ts] から export。
 * ルート定義のさらに細かいファイル分割は段階的にここへ集約可能。
 */
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from './db';
import { lessonTypes, lessons, subjects, users } from './db/schema';
import { lessonPresetDisplay, lessonTeacherDisplay } from './lessonDisplay';
import { getActiveStudentAndClassroom } from './lib/studentRead';
import { validateLessonRangeQuery } from './lib/validators';
import { auth } from './middleware/honoStack';
import classroomsApp from './routes/classrooms';
import lessonTypesApp from './routes/lessonTypes';
import lessonsApp from './routes/lessons';
import studentsApp from './routes/students';
import subjectsApp from './routes/subjects';
import timeSlotsApp from './routes/timeSlots';
import usersApp from './routes/users';
import type { AppVariables, ApiBindings as Bindings } from './types/apiTypes';

export const app = new Hono<{
  Bindings: Bindings;
  Variables: AppVariables;
}>().basePath('/api');
const rootApp = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

let holidayMapPromise: Promise<Record<string, string>> | null = null;

async function getHolidayMap(): Promise<Record<string, string>> {
  if (!holidayMapPromise) {
    holidayMapPromise = (async () => {
      try {
        const res = await fetch(
          'https://holidays-jp.github.io/api/v1/date.json',
        );
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
    })
    .from(lessons)
    .where(
      and(
        eq(lessons.studentId, studentId),
        isNull(lessons.deletedAt),
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
  const visibleLessons = lessonRows.filter((row) =>
    teacherById.has(row.teacherId),
  );

  const subjectIds = [...new Set(visibleLessons.map((r) => r.subjectId))];
  const lessonTypeIds = [...new Set(visibleLessons.map((r) => r.lessonTypeId))];

  const subjectById = new Map<
    string,
    { name: string; deletedAt: Date | null }
  >();
  if (subjectIds.length > 0) {
    const subRows = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        deletedAt: subjects.deletedAt,
      })
      .from(subjects)
      .where(
        and(
          inArray(subjects.id, subjectIds),
          eq(subjects.classroomId, studentRow.classroomId),
        ),
      );
    for (const s of subRows) {
      subjectById.set(s.id, { name: s.name, deletedAt: s.deletedAt });
    }
  }

  const lessonTypeById = new Map<
    string,
    { name: string; deletedAt: Date | null }
  >();
  if (lessonTypeIds.length > 0) {
    const ltRows = await db
      .select({
        id: lessonTypes.id,
        name: lessonTypes.name,
        deletedAt: lessonTypes.deletedAt,
      })
      .from(lessonTypes)
      .where(
        and(
          inArray(lessonTypes.id, lessonTypeIds),
          eq(lessonTypes.classroomId, studentRow.classroomId),
        ),
      );
    for (const lt of ltRows) {
      lessonTypeById.set(lt.id, { name: lt.name, deletedAt: lt.deletedAt });
    }
  }

  const rows = visibleLessons.map((row) => ({
    id: row.id,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    teacherDisplay: lessonTeacherDisplay(teacherById.get(row.teacherId)),
    teacherColor: teacherById.get(row.teacherId)?.color ?? null,
    subjectName: lessonPresetDisplay(subjectById.get(row.subjectId)),
    lessonTypeName: lessonPresetDisplay(lessonTypeById.get(row.lessonTypeId)),
  }));

  return c.json({ studentName: studentRow.name, lessons: rows }, 200);
});

/** 未認証。指定年月の日本の祝日一覧を返す。 */
app.get('/public/holidays', async (c) => {
  const year = Number(c.req.query('year') ?? '');
  const month = Number(c.req.query('month') ?? '');
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return c.json(
      { message: 'year and month query parameters are required' },
      400,
    );
  }

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const holidayMap = await getHolidayMap();
  const holidays = Object.entries(holidayMap)
    .filter(([date]) => date.startsWith(monthPrefix))
    .map(([date, name]) => ({ date, name }));

  return c.json(holidays, 200);
});

app.route('/classrooms', classroomsApp);
app.route('/users', usersApp);
app.route('/students', studentsApp);
app.route('/subjects', subjectsApp);
app.route('/lesson-types', lessonTypesApp);
app.route('/time-slots', timeSlotsApp);
app.route('/lessons', lessonsApp);

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
rootApp.get('*', async (c) => {
  if (!c.env.ASSETS) {
    return c.notFound();
  }
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.ok || res.status == 304) {
    return res;
  }

  const path = new URL(c.req.url).pathname;
  if (path.match(/\.[a-zA-Z0-9]+$/)) {
    return c.notFound();
  }

  const indexReq = new Request(new URL('/', c.req.url), c.req);
  return c.env.ASSETS.fetch(indexReq);
});

export default {
  fetch: rootApp.fetch,
};
