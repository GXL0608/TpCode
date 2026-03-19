ALTER TABLE "tp_product" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tp_product" DROP CONSTRAINT IF EXISTS "fk_tp_product_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tp_product"
  ADD CONSTRAINT "fk_tp_product_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN "tp_product"."project_id" IS '默认上下文项目标识（可空，实际源码来源改由解决方案推导）';
--> statement-breakpoint

ALTER TABLE "tp_session_token" ADD COLUMN IF NOT EXISTS "context_product_id" text REFERENCES "tp_product"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_session_token_context_product_idx" ON "tp_session_token" ("context_product_id");
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_token"."context_product_id" IS '登录态记录中的当前产品上下文标识';
--> statement-breakpoint
UPDATE "tp_session_token" AS "token"
SET "context_product_id" = "product"."id"
FROM "tp_product" AS "product"
WHERE "token"."context_product_id" IS NULL
  AND "product"."project_id" = "token"."context_project_id";
--> statement-breakpoint

ALTER TABLE "tp_user_project_state" ADD COLUMN IF NOT EXISTS "last_product_id" text REFERENCES "tp_product"("id") ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN "tp_user_project_state"."last_product_id" IS '用户最近一次选择的产品标识';
--> statement-breakpoint
UPDATE "tp_user_project_state" AS "state"
SET "last_product_id" = "product"."id"
FROM "tp_product" AS "product"
WHERE "state"."last_product_id" IS NULL
  AND "product"."project_id" = "state"."last_project_id";
--> statement-breakpoint

ALTER TABLE "tp_saved_plan" ADD COLUMN IF NOT EXISTS "product_id" text REFERENCES "tp_product"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_saved_plan_product_time_idx" ON "tp_saved_plan" ("product_id", "time_created");
--> statement-breakpoint
COMMENT ON COLUMN "tp_saved_plan"."product_id" IS '保存计划时所属的产品标识';
--> statement-breakpoint
UPDATE "tp_saved_plan" AS "plan"
SET "product_id" = "product"."id"
FROM "tp_product" AS "product"
WHERE "plan"."product_id" IS NULL
  AND "product"."project_id" = "plan"."project_id";
