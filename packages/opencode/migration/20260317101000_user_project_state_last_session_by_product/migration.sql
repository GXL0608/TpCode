ALTER TABLE "tp_user_project_state"
  ADD COLUMN IF NOT EXISTS "last_session_by_product" jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "tp_user_project_state"."last_session_by_product" IS '按产品维度记忆最近一次会话，避免共享解决方案产品之间互相串会话';
