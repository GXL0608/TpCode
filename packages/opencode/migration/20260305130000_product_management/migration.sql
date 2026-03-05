CREATE TABLE `tp_product` (
  `id` text PRIMARY KEY,
  `name` text NOT NULL,
  `project_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_tp_product_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tp_product_name_unique` ON `tp_product` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tp_product_project_uidx` ON `tp_product` (`project_id`);--> statement-breakpoint
CREATE INDEX `tp_product_project_idx` ON `tp_product` (`project_id`);--> statement-breakpoint

CREATE TABLE `tp_role_product_access` (
  `product_id` text NOT NULL,
  `role_id` text NOT NULL,
  `time_created` integer NOT NULL,
  CONSTRAINT `tp_role_product_access_pk` PRIMARY KEY(`product_id`, `role_id`),
  CONSTRAINT `fk_tp_role_product_access_product_id_tp_product_id_fk` FOREIGN KEY (`product_id`) REFERENCES `tp_product`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tp_role_product_access_role_id_tp_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `tp_role`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tp_role_product_access_product_idx` ON `tp_role_product_access` (`product_id`);--> statement-breakpoint
CREATE INDEX `tp_role_product_access_role_idx` ON `tp_role_product_access` (`role_id`);--> statement-breakpoint

WITH `src` AS (
  SELECT DISTINCT
    `pra`.`project_id`,
    `p`.`name` AS `project_name`,
    `p`.`worktree` AS `worktree`
  FROM `tp_project_role_access` AS `pra`
  JOIN `project` AS `p` ON `p`.`id` = `pra`.`project_id`
),
`base` AS (
  SELECT
    `project_id`,
    COALESCE(NULLIF(TRIM(`project_name`), ''), NULLIF(regexp_replace(`worktree`, '^.*[\\\\/]', ''), ''), `project_id`) AS `base_name`
  FROM `src`
),
`named` AS (
  SELECT
    `project_id`,
    `base_name`,
    row_number() OVER (PARTITION BY lower(`base_name`) ORDER BY `project_id`) AS `seq`
  FROM `base`
)
INSERT INTO `tp_product` (`id`, `name`, `project_id`, `time_created`, `time_updated`)
SELECT
  'product_' || substr(md5(`project_id`), 1, 24) AS `id`,
  CASE
    WHEN `seq` = 1 THEN `base_name`
    ELSE `base_name` || '_' || `seq`
  END AS `name`,
  `project_id`,
  extract(epoch FROM now())::bigint,
  extract(epoch FROM now())::bigint
FROM `named`
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO `tp_role_product_access` (`product_id`, `role_id`, `time_created`)
SELECT
  `product`.`id`,
  `pra`.`role_id`,
  `pra`.`time_created`
FROM `tp_project_role_access` AS `pra`
JOIN `tp_product` AS `product` ON `product`.`project_id` = `pra`.`project_id`
ON CONFLICT (`product_id`, `role_id`) DO NOTHING;
