CREATE TABLE `tp_project_role_access` (
  `project_id` text NOT NULL,
  `role_id` text NOT NULL,
  `time_created` integer NOT NULL,
  CONSTRAINT `tp_project_role_access_pk` PRIMARY KEY(`project_id`, `role_id`),
  CONSTRAINT `fk_tp_project_role_access_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_project_role_access_role_id_tp_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `tp_role`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_project_role_access_project_idx` ON `tp_project_role_access` (`project_id`);--> statement-breakpoint
CREATE INDEX `tp_project_role_access_role_idx` ON `tp_project_role_access` (`role_id`);--> statement-breakpoint

CREATE TABLE `tp_project_user_access` (
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `mode` text NOT NULL,
  `time_created` integer NOT NULL,
  CONSTRAINT `tp_project_user_access_pk` PRIMARY KEY(`project_id`, `user_id`),
  CONSTRAINT `fk_tp_project_user_access_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_project_user_access_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_project_user_access_project_idx` ON `tp_project_user_access` (`project_id`);--> statement-breakpoint
CREATE INDEX `tp_project_user_access_user_idx` ON `tp_project_user_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `tp_project_user_access_mode_idx` ON `tp_project_user_access` (`mode`);--> statement-breakpoint

CREATE TABLE `tp_user_project_state` (
  `user_id` text PRIMARY KEY,
  `last_project_id` text,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_user_project_state_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_user_project_state_last_project_id_project_id_fk` FOREIGN KEY (`last_project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint

ALTER TABLE `session` ADD COLUMN `context_project_id` text REFERENCES `project`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tp_session_token` ADD COLUMN `context_project_id` text REFERENCES `project`(`id`) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `session` SET `context_project_id` = `project_id` WHERE `context_project_id` IS NULL;--> statement-breakpoint

CREATE INDEX `session_context_project_idx` ON `session` (`context_project_id`);--> statement-breakpoint
CREATE INDEX `tp_session_token_context_project_idx` ON `tp_session_token` (`context_project_id`);
