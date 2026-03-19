ALTER TABLE "tp_product" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "tp_user" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "tp_role" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "tp_product_solution" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "tp_product_solution_binding" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "time_deleted" bigint;
--> statement-breakpoint
ALTER TABLE "tp_system_provider_setting" ADD COLUMN IF NOT EXISTS "provider_deleted_json" text;
--> statement-breakpoint
ALTER TABLE "tp_system_provider_setting" ADD COLUMN IF NOT EXISTS "provider_auth_deleted_json" text;
--> statement-breakpoint
ALTER TABLE "tp_system_provider_setting" ADD COLUMN IF NOT EXISTS "provider_config_deleted_json" text;
--> statement-breakpoint
ALTER TABLE "tp_user_provider_setting" ADD COLUMN IF NOT EXISTS "provider_deleted_json" text;
--> statement-breakpoint
ALTER TABLE "tp_user_provider_setting" ADD COLUMN IF NOT EXISTS "provider_auth_deleted_json" text;
--> statement-breakpoint
ALTER TABLE "tp_user_provider_setting" ADD COLUMN IF NOT EXISTS "provider_config_deleted_json" text;
--> statement-breakpoint

COMMENT ON COLUMN "tp_product"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "tp_user"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "tp_role"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "session"."time_deleted" IS '逻辑删除时间，空表示未删除';
--> statement-breakpoint
COMMENT ON COLUMN "tp_system_provider_setting"."provider_deleted_json" IS 'provider 逻辑删除时间映射';
--> statement-breakpoint
COMMENT ON COLUMN "tp_system_provider_setting"."provider_auth_deleted_json" IS 'provider 认证逻辑删除快照映射';
--> statement-breakpoint
COMMENT ON COLUMN "tp_system_provider_setting"."provider_config_deleted_json" IS 'provider 配置逻辑删除快照映射';
--> statement-breakpoint
COMMENT ON COLUMN "tp_user_provider_setting"."provider_deleted_json" IS '用户 provider 逻辑删除时间映射';
--> statement-breakpoint
COMMENT ON COLUMN "tp_user_provider_setting"."provider_auth_deleted_json" IS '用户 provider 认证逻辑删除快照映射';
--> statement-breakpoint
COMMENT ON COLUMN "tp_user_provider_setting"."provider_config_deleted_json" IS '用户 provider 配置逻辑删除快照映射';
--> statement-breakpoint

DROP INDEX IF EXISTS "tp_product_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_product_name_unique" ON "tp_product" ("name") WHERE "time_deleted" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "tp_product_project_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_product_project_uidx" ON "tp_product" ("project_id") WHERE "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_product_deleted_idx" ON "tp_product" ("time_deleted");
--> statement-breakpoint

DROP INDEX IF EXISTS "tp_user_username_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_user_username_unique" ON "tp_user" ("username") WHERE "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_user_deleted_idx" ON "tp_user" ("time_deleted");
--> statement-breakpoint

DROP INDEX IF EXISTS "tp_role_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_role_code_unique" ON "tp_role" ("code") WHERE "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_role_deleted_idx" ON "tp_role" ("time_deleted");
--> statement-breakpoint

DROP INDEX IF EXISTS "tp_product_solution_code_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_product_solution_code_uidx" ON "tp_product_solution" ("code") WHERE "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_product_solution_deleted_idx" ON "tp_product_solution" ("time_deleted");
--> statement-breakpoint

DROP INDEX IF EXISTS "tp_product_solution_binding_product_solution_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_product_solution_binding_product_solution_uidx"
  ON "tp_product_solution_binding" ("product_id", "solution_id")
  WHERE "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_product_solution_binding_deleted_idx" ON "tp_product_solution_binding" ("time_deleted");
--> statement-breakpoint

DROP INDEX IF EXISTS "session_user_time_active_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_user_time_active_idx"
  ON "session" ("user_id", "time_updated", "id")
  WHERE "time_archived" IS NULL AND "time_deleted" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_deleted_idx" ON "session" ("time_deleted");
