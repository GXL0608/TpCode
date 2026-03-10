CREATE TABLE `tp_feedback_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`page_name` text NOT NULL,
	`menu_path` text,
	`source_platform` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`org_id` text NOT NULL,
	`department_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL DEFAULT 'open',
	`resolved_by` text,
	`resolved_name` text,
	`resolved_at` integer,
	`last_reply_at` integer NOT NULL,
	`reply_count` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tp_feedback_thread` ADD CONSTRAINT `tp_feedback_thread_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE `tp_feedback_post` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`org_id` text NOT NULL,
	`department_id` text,
	`content` text NOT NULL,
	`official_reply` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tp_feedback_post` ADD CONSTRAINT `tp_feedback_post_thread_id_tp_feedback_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `tp_feedback_thread`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `tp_feedback_thread_project_idx` ON `tp_feedback_thread` (`project_id`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_thread_product_idx` ON `tp_feedback_thread` (`product_id`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_thread_status_idx` ON `tp_feedback_thread` (`status`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_thread_user_idx` ON `tp_feedback_thread` (`user_id`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_thread_last_reply_idx` ON `tp_feedback_thread` (`last_reply_at`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_post_thread_idx` ON `tp_feedback_post` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_post_user_idx` ON `tp_feedback_post` (`user_id`);
--> statement-breakpoint
CREATE INDEX `tp_feedback_post_official_idx` ON `tp_feedback_post` (`official_reply`);
