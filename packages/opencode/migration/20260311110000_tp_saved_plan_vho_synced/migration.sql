ALTER TABLE `tp_saved_plan` ADD COLUMN `vho_synced` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`vho_synced` IS 'VHO同步状态：0未同步，1已同步';
