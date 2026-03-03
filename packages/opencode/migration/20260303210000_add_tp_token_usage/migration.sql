CREATE TABLE `tp_token_usage` (
  `id` text PRIMARY KEY NOT NULL,
  `usage_scene` text NOT NULL,
  `source_id` text NOT NULL,
  `session_id` text NOT NULL,
  `message_id` text,
  `project_id` text NOT NULL,
  `workplace` text NOT NULL,
  `user_id` text,
  `username` text,
  `display_name` text,
  `account_type` text,
  `org_id` text,
  `department_id` text,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `token_input` integer NOT NULL DEFAULT 0,
  `token_output` integer NOT NULL DEFAULT 0,
  `token_reasoning` integer NOT NULL DEFAULT 0,
  `token_cache_read` integer NOT NULL DEFAULT 0,
  `token_cache_write` integer NOT NULL DEFAULT 0,
  `token_total` integer NOT NULL DEFAULT 0,
  `cost_micros` integer NOT NULL DEFAULT 0,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_token_usage_scene_source_uidx` ON `tp_token_usage` (`usage_scene`, `source_id`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_time_idx` ON `tp_token_usage` (`time_created`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_session_time_idx` ON `tp_token_usage` (`session_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_message_time_idx` ON `tp_token_usage` (`message_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_project_time_idx` ON `tp_token_usage` (`project_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_user_time_idx` ON `tp_token_usage` (`user_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_token_usage_model_time_idx` ON `tp_token_usage` (`model_id`, `time_created`);
