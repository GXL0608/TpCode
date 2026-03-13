CREATE TABLE `tp_session_picture` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `message_id` text NOT NULL,
  `part_id` text NOT NULL,
  `mime` text NOT NULL,
  `filename` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `ocr_text` text,
  `ocr_engine` text,
  `image_bytes` bytea NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_session_picture_session_id_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_session_picture_message_id_message_id` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE,
  CONSTRAINT `tp_session_picture_size_check` CHECK (`size_bytes` >= 0 AND `size_bytes` <= 20971520)
);
--> statement-breakpoint
CREATE INDEX `tp_session_picture_session_time_idx` ON `tp_session_picture` (`session_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `tp_session_picture_message_idx` ON `tp_session_picture` (`message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_session_picture_part_uidx` ON `tp_session_picture` (`part_id`);
