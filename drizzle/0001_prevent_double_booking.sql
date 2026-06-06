-- Custom SQL migration file, put your code below! --

-- 1. 講師のダブルブッキング防止 (INSERT時)
CREATE TRIGGER prevent_teacher_double_booking_insert
BEFORE INSERT ON lessons
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'teacher_double_booking')
  WHERE EXISTS (
    SELECT 1 FROM lessons
    WHERE teacherId = NEW.teacherId
      AND deletedAt IS NULL
      AND startAt < NEW.endAt
      AND endAt > NEW.startAt
  );
END;

-- 2. 講師のダブルブッキング防止 (UPDATE時)
CREATE TRIGGER prevent_teacher_double_booking_update
BEFORE UPDATE ON lessons
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'teacher_double_booking')
  WHERE EXISTS (
    SELECT 1 FROM lessons
    WHERE teacherId = NEW.teacherId
      AND id != NEW.id -- 更新時は自分自身のレコードを除外する
      AND deletedAt IS NULL
      AND startAt < NEW.endAt
      AND endAt > NEW.startAt
  );
END;

-- 3. 生徒のダブルブッキング防止 (INSERT時)
CREATE TRIGGER prevent_student_double_booking_insert
BEFORE INSERT ON lessons
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'student_double_booking')
  WHERE EXISTS (
    SELECT 1 FROM lessons
    WHERE studentId = NEW.studentId
      AND deletedAt IS NULL
      AND startAt < NEW.endAt
      AND endAt > NEW.startAt
  );
END;

-- 4. 生徒のダブルブッキング防止 (UPDATE時)
CREATE TRIGGER prevent_student_double_booking_update
BEFORE UPDATE ON lessons
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'student_double_booking')
  WHERE EXISTS (
    SELECT 1 FROM lessons
    WHERE studentId = NEW.studentId
      AND id != NEW.id
      AND deletedAt IS NULL
      AND startAt < NEW.endAt
      AND endAt > NEW.startAt
  );
END;