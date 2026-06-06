-- Custom SQL migration file, put your code below! --
DROP TRIGGER IF EXISTS prevent_teacher_double_booking_insert;
DROP TRIGGER IF EXISTS prevent_teacher_double_booking_update;
DROP TRIGGER IF EXISTS prevent_student_double_booking_insert;
DROP TRIGGER IF EXISTS prevent_student_double_booking_update;


-- 1. 講師のダブルブッキング防止 (INSERT時)
CREATE TRIGGER prevent_teacher_double_booking_insert
BEFORE INSERT ON lessons
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'teacher_double_booking')
  WHERE EXISTS (
    SELECT 1 FROM lessons
    WHERE teacher_id = NEW.teacher_id
      AND deleted_at IS NULL
      AND start_at < NEW.end_at
      AND end_at > NEW.start_at
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
    WHERE teacher_id = NEW.teacher_id
      AND id != NEW.id -- 更新時は自分自身のレコードを除外する
      AND deleted_at IS NULL
      AND start_at < NEW.end_at
      AND end_at > NEW.start_at
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
    WHERE student_id = NEW.student_id
      AND deleted_at IS NULL
      AND start_at < NEW.end_at
      AND end_at > NEW.start_at
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
    WHERE student_id = NEW.student_id
      AND id != NEW.id
      AND deleted_at IS NULL
      AND start_at < NEW.end_at
      AND end_at > NEW.start_at
  );
END;