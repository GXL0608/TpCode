ALTER TABLE `tp_user_project_state` ADD COLUMN `open_project_ids` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `tp_user_project_state` ADD COLUMN `last_session_by_project` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `tp_user_project_state` ADD COLUMN `workspace_mode_by_project` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `tp_user_project_state` ADD COLUMN `workspace_order_by_project` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `tp_user_project_state` ADD COLUMN `workspace_expanded_by_directory` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `tp_user_project_state` ADD COLUMN `workspace_alias_by_project_branch` text DEFAULT '{}';
