PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`lesson_type_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_type_id`) REFERENCES `lesson_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_lessons`("id", "teacher_id", "student_id", "classroom_id", "subject_id", "lesson_type_id", "start_at", "end_at", "deleted_at") SELECT "id", "teacher_id", "student_id", "classroom_id", "subject_id", "lesson_type_id", "start_at", "end_at", "deleted_at" FROM `lessons`;--> statement-breakpoint
DROP TABLE `lessons`;--> statement-breakpoint
ALTER TABLE `__new_lessons` RENAME TO `lessons`;--> statement-breakpoint
PRAGMA foreign_keys=ON;