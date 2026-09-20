CREATE TABLE `students_unable_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`date` text NOT NULL,
	`timeslot_id` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`timeslot_id`) REFERENCES `time_slots`(`id`) ON UPDATE no action ON DELETE no action
);
