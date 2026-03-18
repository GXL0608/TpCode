ALTER TABLE "tp_user_project_state" ADD COLUMN IF NOT EXISTS "recent_product_ids" text;
--> statement-breakpoint
COMMENT ON COLUMN "tp_user_project_state"."recent_product_ids" IS '按账号维度记忆最近使用的产品列表，供产品侧栏展示';
--> statement-breakpoint

UPDATE "tp_user_project_state"
SET "recent_product_ids" = json_build_array("last_product_id")::text
WHERE "recent_product_ids" IS NULL
  AND "last_product_id" IS NOT NULL;
--> statement-breakpoint

UPDATE "tp_product"
SET "time_deleted" = CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS bigint)
WHERE "time_deleted" IS NULL
  AND "name" LIKE '删-%';
