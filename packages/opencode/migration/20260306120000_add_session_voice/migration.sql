CREATE TABLE `session_voice` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `message_id` text NOT NULL,
  `part_id` text NOT NULL,
  `mime` text NOT NULL,
  `filename` text NOT NULL,
  `duration_ms` integer,
  `size_bytes` integer NOT NULL,
  `stt_text` text,
  `stt_engine` text,
  `audio_bytes` bytea NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_session_voice_session_id_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_session_voice_message_id_message_id` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE,
  CONSTRAINT `session_voice_duration_check` CHECK (`duration_ms` IS NULL OR (`duration_ms` >= 0 AND `duration_ms` <= 60000)),
  CONSTRAINT `session_voice_size_check` CHECK (`size_bytes` >= 0 AND `size_bytes` <= 3145728)
);
--> statement-breakpoint
CREATE INDEX `session_voice_session_time_idx` ON `session_voice` (`session_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `session_voice_message_idx` ON `session_voice` (`message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_voice_part_uidx` ON `session_voice` (`part_id`);
