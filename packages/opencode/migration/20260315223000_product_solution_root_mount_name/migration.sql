ALTER TABLE "tp_product_solution_root" ADD COLUMN "mount_name" text;
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."mount_name" IS '聚合工作区挂载目录名';
--> statement-breakpoint
UPDATE "tp_product_solution_root"
SET "mount_name" = COALESCE(NULLIF("display_name", ''), regexp_replace("directory", '^.*[\\/]', ''))
WHERE "mount_name" IS NULL;
