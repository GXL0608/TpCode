CREATE TABLE IF NOT EXISTS "app_event_log" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "level" text NOT NULL,
  "service" text NOT NULL,
  "event" text NOT NULL,
  "message" text NOT NULL,
  "status" text NOT NULL,
  "duration_ms" integer,
  "request_id" text,
  "session_id" text,
  "message_id" text,
  "user_id" text,
  "project_id" text,
  "workspace_id" text,
  "provider_id" text,
  "model_id" text,
  "agent" text,
  "count" integer NOT NULL DEFAULT 1,
  "tags" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "extra" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
COMMENT ON TABLE "app_event_log" IS '应用事件日志表';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."id" IS '主键，自增日志编号';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."created_at" IS '日志写入时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."level" IS '日志级别';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."service" IS '服务名称';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."event" IS '标准事件名称';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."message" IS '日志消息';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."status" IS '事件状态';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."duration_ms" IS '事件耗时（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."request_id" IS '请求标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."session_id" IS '会话标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."message_id" IS '消息标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."user_id" IS '用户标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."project_id" IS '项目标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."workspace_id" IS '工作区标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."provider_id" IS '模型供应商标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."model_id" IS '模型标识';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."agent" IS '代理名称';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."count" IS '事件计数';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."tags" IS '轻量标签';
--> statement-breakpoint
COMMENT ON COLUMN "app_event_log"."extra" IS '扩展结构化字段';
--> statement-breakpoint
CREATE INDEX "app_event_log_created_at_idx" ON "app_event_log" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX "app_event_log_event_created_idx" ON "app_event_log" ("event", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "app_event_log_service_created_idx" ON "app_event_log" ("service", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "app_event_log_status_created_idx" ON "app_event_log" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "app_event_log_session_created_idx" ON "app_event_log" ("session_id", "created_at" DESC) WHERE "session_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "app_event_log_request_created_idx" ON "app_event_log" ("request_id", "created_at" DESC) WHERE "request_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "app_event_log_duration_idx" ON "app_event_log" ("duration_ms" DESC) WHERE "duration_ms" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "app_event_log_tags_gin_idx" ON "app_event_log" USING GIN ("tags" jsonb_path_ops);
