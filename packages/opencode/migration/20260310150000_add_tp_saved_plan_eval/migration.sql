CREATE TABLE `tp_saved_plan_eval` (
  `id` text PRIMARY KEY,
  `plan_id` text NOT NULL,
  `vho_feedback_no` text,
  `user_id` text NOT NULL,
  `session_id` text NOT NULL,
  `user_message_id` text NOT NULL,
  `assistant_message_id` text NOT NULL,
  `part_id` text NOT NULL,
  `status` text NOT NULL,
  `rubric_version` text,
  `prompt_version` text,
  `judge_provider_id` text,
  `judge_model_id` text,
  `user_score` integer,
  `assistant_score` integer,
  `summary` text,
  `major_issue_side` text,
  `result_json` text,
  `error_code` text,
  `error_message` text,
  `time_started` integer,
  `time_finished` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`plan_id`) REFERENCES `tp_saved_plan`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_saved_plan_eval_plan_uidx` ON `tp_saved_plan_eval` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_feedback_idx` ON `tp_saved_plan_eval` (`vho_feedback_no`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_user_time_idx` ON `tp_saved_plan_eval` (`user_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_session_time_idx` ON `tp_saved_plan_eval` (`session_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_status_time_idx` ON `tp_saved_plan_eval` (`status`, `time_created`);
--> statement-breakpoint
CREATE TABLE `tp_saved_plan_eval_item` (
  `id` text PRIMARY KEY,
  `eval_id` text NOT NULL,
  `plan_id` text NOT NULL,
  `vho_feedback_no` text,
  `subject` text NOT NULL,
  `dimension_code` text NOT NULL,
  `dimension_name` text NOT NULL,
  `max_deduction` integer NOT NULL,
  `deducted_score` integer NOT NULL,
  `final_score` integer NOT NULL,
  `reason` text NOT NULL,
  `evidence_json` text NOT NULL,
  `position` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`eval_id`) REFERENCES `tp_saved_plan_eval`(`id`) ON DELETE cascade,
  FOREIGN KEY (`plan_id`) REFERENCES `tp_saved_plan`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_item_eval_position_idx` ON `tp_saved_plan_eval_item` (`eval_id`, `position`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_item_plan_idx` ON `tp_saved_plan_eval_item` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_item_feedback_idx` ON `tp_saved_plan_eval_item` (`vho_feedback_no`);
--> statement-breakpoint
CREATE INDEX `tp_saved_plan_eval_item_subject_dimension_idx` ON `tp_saved_plan_eval_item` (`subject`, `dimension_code`);
