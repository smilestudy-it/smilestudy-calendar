/**
 * （責務）共有用 API 等で、論理削除前の生徒＋有効教室の行をまとめて取得。
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { getDb } from '../db';
import { classrooms, students } from '../db/schema';

type Db = ReturnType<typeof getDb>;

/**
 * 共有 API 用: 論理削除されていない生徒と、その教室行（論理削除済み教室は null）
 */
export async function getActiveStudentAndClassroom(
  db: Db,
  studentId: string,
): Promise<{
  student: { id: string; classroomId: string; name: string };
  classroom: { id: string } | null;
} | null> {
  const [studentRow] = await db
    .select({ id: students.id, classroomId: students.classroomId, name: students.name })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
    .limit(1);
  if (!studentRow) {
    return null;
  }
  const [classroomRow] = await db
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.id, studentRow.classroomId), isNull(classrooms.deletedAt)))
    .limit(1);
  return { student: studentRow, classroom: classroomRow ?? null };
}
