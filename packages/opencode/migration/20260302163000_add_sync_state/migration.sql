CREATE TABLE `sync_state` (
	`scope` text PRIMARY KEY NOT NULL,
	`full_sync_completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_state_full_sync_idx` ON `sync_state` (`full_sync_completed_at`);
