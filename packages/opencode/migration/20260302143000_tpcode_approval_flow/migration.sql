CREATE TABLE `tp_change_request` (
  `id` text PRIMARY KEY,
  `page_id` text,
  `session_id` text,
  `user_id` text NOT NULL,
  `org_id` text NOT NULL,
  `department_id` text,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `ai_plan` text,
  `ai_prototype_url` text,
  `ai_score` integer,
  `ai_revenue_assessment` text,
  `status` text NOT NULL,
  `current_step` integer NOT NULL,
  `confirmed_at` integer,
  `submitted_at` integer,
  `approved_at` integer,
  `rejected_at` integer,
  `executing_at` integer,
  `completed_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_change_request_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tp_change_request_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_change_request_org_id_tp_organization_id_fk` FOREIGN KEY (`org_id`) REFERENCES `tp_organization`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_change_request_department_id_tp_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `tp_department`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `tp_change_request_user_idx` ON `tp_change_request` (`user_id`);--> statement-breakpoint
CREATE INDEX `tp_change_request_org_idx` ON `tp_change_request` (`org_id`);--> statement-breakpoint
CREATE INDEX `tp_change_request_department_idx` ON `tp_change_request` (`department_id`);--> statement-breakpoint
CREATE INDEX `tp_change_request_status_idx` ON `tp_change_request` (`status`);--> statement-breakpoint
CREATE INDEX `tp_change_request_session_idx` ON `tp_change_request` (`session_id`);--> statement-breakpoint

CREATE TABLE `tp_approval` (
  `id` text PRIMARY KEY,
  `change_request_id` text NOT NULL,
  `reviewer_id` text NOT NULL,
  `step_order` integer NOT NULL,
  `status` text NOT NULL,
  `comment` text,
  `reviewed_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_approval_change_request_id_tp_change_request_id_fk` FOREIGN KEY (`change_request_id`) REFERENCES `tp_change_request`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_approval_reviewer_id_tp_user_id_fk` FOREIGN KEY (`reviewer_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_approval_change_step_uidx` ON `tp_approval` (`change_request_id`, `step_order`);--> statement-breakpoint
CREATE INDEX `tp_approval_change_idx` ON `tp_approval` (`change_request_id`);--> statement-breakpoint
CREATE INDEX `tp_approval_reviewer_idx` ON `tp_approval` (`reviewer_id`);--> statement-breakpoint
CREATE INDEX `tp_approval_status_idx` ON `tp_approval` (`status`);--> statement-breakpoint

CREATE TABLE `tp_timeline` (
  `id` text PRIMARY KEY,
  `change_request_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `action` text NOT NULL,
  `detail` text,
  `attachment_url` text,
  `time_created` integer NOT NULL,
  CONSTRAINT `fk_tp_timeline_change_request_id_tp_change_request_id_fk` FOREIGN KEY (`change_request_id`) REFERENCES `tp_change_request`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_timeline_actor_id_tp_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_timeline_change_request_idx` ON `tp_timeline` (`change_request_id`);--> statement-breakpoint
CREATE INDEX `tp_timeline_actor_idx` ON `tp_timeline` (`actor_id`);--> statement-breakpoint
CREATE INDEX `tp_timeline_action_idx` ON `tp_timeline` (`action`);
