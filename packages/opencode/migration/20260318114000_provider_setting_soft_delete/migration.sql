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
