CREATE TABLE `tp_saved_plan` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `message_id` text NOT NULL,
  `part_id` text NOT NULL,
  `project_id` text NOT NULL,
  `project_name` text,
  `project_worktree` text NOT NULL,
  `session_title` text NOT NULL,
  `user_id` text NOT NULL,
  `username` text NOT NULL,
  `display_name` text NOT NULL,
  `account_type` text NOT NULL,
  `org_id` text NOT NULL,
  `department_id` text,
  `agent` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `message_created_at` integer NOT NULL,
  `plan_content` text NOT NULL,
  `vho_feedback_no` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_user_time_idx` ON `tp_saved_plan` (`user_id`, `time_created`);--> statement-breakpoint
CREATE INDEX `tp_saved_plan_session_time_idx` ON `tp_saved_plan` (`session_id`, `time_created`);--> statement-breakpoint
CREATE INDEX `tp_saved_plan_project_time_idx` ON `tp_saved_plan` (`project_id`, `time_created`);--> statement-breakpoint
CREATE INDEX `tp_saved_plan_message_idx` ON `tp_saved_plan` (`message_id`);
