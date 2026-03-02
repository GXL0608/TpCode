CREATE TABLE `tp_organization` (
  `id` text PRIMARY KEY,
  `name` text NOT NULL,
  `code` text NOT NULL,
  `org_type` text NOT NULL,
  `status` text NOT NULL,
  `parent_id` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_organization_code_unique` ON `tp_organization` (`code`);--> statement-breakpoint
CREATE INDEX `tp_organization_parent_idx` ON `tp_organization` (`parent_id`);--> statement-breakpoint

CREATE TABLE `tp_department` (
  `id` text PRIMARY KEY,
  `org_id` text NOT NULL,
  `parent_id` text,
  `name` text NOT NULL,
  `code` text,
  `sort_order` integer NOT NULL,
  `status` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_department_org_id_tp_organization_id_fk` FOREIGN KEY (`org_id`) REFERENCES `tp_organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_department_org_idx` ON `tp_department` (`org_id`);--> statement-breakpoint
CREATE INDEX `tp_department_parent_idx` ON `tp_department` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tp_department_code_idx` ON `tp_department` (`code`);--> statement-breakpoint

CREATE TABLE `tp_user` (
  `id` text PRIMARY KEY,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `display_name` text NOT NULL,
  `email` text,
  `phone` text,
  `account_type` text NOT NULL,
  `org_id` text NOT NULL,
  `department_id` text,
  `status` text NOT NULL,
  `force_password_reset` integer NOT NULL,
  `failed_login_count` integer NOT NULL,
  `locked_until` integer,
  `vho_user_id` text,
  `external_source` text,
  `last_login_at` integer,
  `last_login_ip` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_user_org_id_tp_organization_id_fk` FOREIGN KEY (`org_id`) REFERENCES `tp_organization`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_user_department_id_tp_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `tp_department`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_user_username_unique` ON `tp_user` (`username`);--> statement-breakpoint
CREATE INDEX `tp_user_org_idx` ON `tp_user` (`org_id`);--> statement-breakpoint
CREATE INDEX `tp_user_department_idx` ON `tp_user` (`department_id`);--> statement-breakpoint
CREATE INDEX `tp_user_status_idx` ON `tp_user` (`status`);--> statement-breakpoint

CREATE TABLE `tp_role` (
  `id` text PRIMARY KEY,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `scope` text NOT NULL,
  `description` text,
  `status` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_role_code_unique` ON `tp_role` (`code`);--> statement-breakpoint

CREATE TABLE `tp_user_role` (
  `user_id` text NOT NULL,
  `role_id` text NOT NULL,
  `time_created` integer NOT NULL,
  CONSTRAINT `tp_user_role_pk` PRIMARY KEY(`user_id`, `role_id`),
  CONSTRAINT `fk_tp_user_role_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_user_role_role_id_tp_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `tp_role`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE `tp_permission` (
  `id` text PRIMARY KEY,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `group_name` text NOT NULL,
  `description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_permission_code_unique` ON `tp_permission` (`code`);--> statement-breakpoint

CREATE TABLE `tp_role_permission` (
  `role_id` text NOT NULL,
  `permission_id` text NOT NULL,
  CONSTRAINT `tp_role_permission_pk` PRIMARY KEY(`role_id`, `permission_id`),
  CONSTRAINT `fk_tp_role_permission_role_id_tp_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `tp_role`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_role_permission_permission_id_tp_permission_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `tp_permission`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE `tp_session_token` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `token_type` text NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer,
  `ip` text,
  `user_agent` text,
  `time_created` integer NOT NULL,
  CONSTRAINT `fk_tp_session_token_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_session_token_token_hash_unique` ON `tp_session_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tp_session_token_user_idx` ON `tp_session_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `tp_session_token_expires_idx` ON `tp_session_token` (`expires_at`);--> statement-breakpoint

CREATE TABLE `tp_user_provider` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `auth_type` text NOT NULL,
  `secret_cipher` text NOT NULL,
  `meta_json` text,
  `is_active` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_user_provider_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_user_provider_user_provider_uidx` ON `tp_user_provider` (`user_id`, `provider_id`);--> statement-breakpoint
CREATE INDEX `tp_user_provider_user_idx` ON `tp_user_provider` (`user_id`);--> statement-breakpoint
CREATE INDEX `tp_user_provider_provider_idx` ON `tp_user_provider` (`provider_id`);--> statement-breakpoint

CREATE TABLE `tp_password_reset` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL,
  `code_hash` text NOT NULL,
  `channel` text NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `time_created` integer NOT NULL,
  CONSTRAINT `fk_tp_password_reset_user_id_tp_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `tp_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_password_reset_user_idx` ON `tp_password_reset` (`user_id`);--> statement-breakpoint
CREATE INDEX `tp_password_reset_expires_idx` ON `tp_password_reset` (`expires_at`);--> statement-breakpoint

CREATE TABLE `tp_audit_log` (
  `id` text PRIMARY KEY,
  `actor_user_id` text,
  `action` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text,
  `result` text NOT NULL,
  `detail_json` text,
  `ip` text,
  `user_agent` text,
  `time_created` integer NOT NULL,
  CONSTRAINT `fk_tp_audit_log_actor_user_id_tp_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `tp_user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `tp_audit_log_actor_idx` ON `tp_audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `tp_audit_log_action_idx` ON `tp_audit_log` (`action`);--> statement-breakpoint

ALTER TABLE `session` ADD COLUMN `user_id` text REFERENCES `tp_user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `org_id` text REFERENCES `tp_organization`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `department_id` text REFERENCES `tp_department`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `visibility` text NOT NULL DEFAULT 'private';--> statement-breakpoint

CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_org_idx` ON `session` (`org_id`);--> statement-breakpoint
CREATE INDEX `session_department_idx` ON `session` (`department_id`);--> statement-breakpoint
CREATE INDEX `session_visibility_idx` ON `session` (`visibility`);--> statement-breakpoint

UPDATE `session` SET `visibility` = 'public' WHERE `user_id` IS NULL;
