CREATE TABLE `classrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `lesson_types` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`name` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`subject_id` text,
	`lesson_type_id` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text DEFAULT 'draft',
	`deleted_at` integer,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_type_id`) REFERENCES `lesson_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth_year` integer NOT NULL,
	`classroom_id` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`name` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'staff',
	`classroom_id` text,
	`color` text DEFAULT '#3b82f6',
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);