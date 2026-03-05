ALTER TABLE `tp_saved_plan` ADD COLUMN IF NOT EXISTS `vho_feedback_no` text;
--> statement-breakpoint
ALTER TABLE `tp_saved_plan` ALTER COLUMN `project_name` DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE `tp_saved_plan` ALTER COLUMN `department_id` DROP NOT NULL;
