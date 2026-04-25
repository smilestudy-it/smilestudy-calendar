/**
 * （責務）Drizzle SQLite スキーマ定義。教室・ユーザ・生徒・コマ等のテーブル。
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ----------------------------------------------------
// 1. 教室 (Classrooms)
// ----------------------------------------------------
export const classrooms = sqliteTable(
  'classrooms',
  {
    id: text('id').primaryKey(), // UUID
    name: text('name').notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }), // 論理削除用
  },
  (table) => [
    uniqueIndex('classrooms_name_active_unique').on(table.name).where(sql`${table.deletedAt} is null`),
  ],
);
// ----------------------------------------------------
// 2. ユーザー（管理者 / 教室長 / 講師）
// ----------------------------------------------------
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(), // Auth0 の user_id (sub) をそのまま使用
    email: text('email').notNull(),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    role: text('role').$type<'admin' | 'manager' | 'staff'>().default('staff').notNull(),
    classroomId: text('classroom_id').references(() => classrooms.id), // 所属教室（管理者はnullの場合あり）
    color: text('color').default('#3b82f6'), // カレンダー表示色
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('users_email_active_unique').on(table.email).where(sql`${table.deletedAt} is null`),
  ],
);

// ----------------------------------------------------
// 3. 生徒 (Students)
// ----------------------------------------------------
export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  birthYear: integer('birth_year').notNull(), // 生まれた年度
  classroomId: text('classroom_id').references(() => classrooms.id).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

// ----------------------------------------------------
// 4. プリセット（科目 / 授業種別 / 時間枠）
// ----------------------------------------------------
export const subjects = sqliteTable('subjects', {
  id: text('id').primaryKey(), // UUID
  classroomId: text('classroom_id').references(() => classrooms.id).notNull(),
  name: text('name').notNull(), // 例: "英語", "数学"
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const lessonTypes = sqliteTable('lesson_types', {
  id: text('id').primaryKey(),
  classroomId: text('classroom_id').references(() => classrooms.id).notNull(),
  name: text('name').notNull(), // 例: "通常", "振替", "講習"
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const timeSlots = sqliteTable('time_slots', {
  id: text('id').primaryKey(),
  classroomId: text('classroom_id').references(() => classrooms.id).notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});


// ----------------------------------------------------
// 5. コマ・シフト (Lessons)
// ----------------------------------------------------
export const lessons = sqliteTable('lessons', {
  id: text('id').primaryKey(), // UUID
  teacherId: text('teacher_id').references(() => users.id).notNull(),
  studentId: text('student_id').references(() => students.id).notNull(),
  classroomId: text('classroom_id').references(() => classrooms.id).notNull(),
  subjectId: text('subject_id').references(() => subjects.id),
  lessonTypeId: text('lesson_type_id').references(() => lessonTypes.id),
  startAt: integer('start_at', { mode: 'timestamp' }).notNull(),
  endAt: integer('end_at', { mode: 'timestamp' }).notNull(),
  status: text('status').$type<'draft' | 'published' | 'completed'>().default('draft'),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

