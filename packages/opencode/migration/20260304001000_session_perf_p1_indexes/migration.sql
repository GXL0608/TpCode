DROP INDEX IF EXISTS `session_project_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `session_parent_idx`;
--> statement-breakpoint
CREATE INDEX `session_user_time_active_idx` ON `session` (`user_id`, `time_updated`, `id`) WHERE `time_archived` IS NULL;
