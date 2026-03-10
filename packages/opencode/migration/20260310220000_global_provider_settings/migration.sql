CREATE TABLE `tp_system_provider_setting` (
  `id` text PRIMARY KEY,
  `provider_control_json` text,
  `provider_configs_json` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
DELETE FROM `tp_user_provider`;
