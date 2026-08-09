CREATE TABLE `holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`date` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
