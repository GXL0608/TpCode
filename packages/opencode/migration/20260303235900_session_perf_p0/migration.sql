CREATE INDEX `session_project_user_time_idx` ON `session` (`project_id`, `user_id`, `time_updated`, `id`);
--> statement-breakpoint
CREATE INDEX `session_project_parent_time_idx` ON `session` (`project_id`, `parent_id`, `time_updated`, `id`);
--> statement-breakpoint
CREATE INDEX `session_project_time_idx` ON `session` (`project_id`, `time_updated`, `id`);
--> statement-breakpoint
CREATE INDEX `session_time_id_idx` ON `session` (`time_updated`, `id`);
