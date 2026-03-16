ALTER TABLE "tp_build_job" ADD COLUMN "runtime_provider_id" text;
--> statement-breakpoint
ALTER TABLE "tp_build_job" ADD COLUMN "runtime_model_id" text;
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."runtime_provider_id" IS '构建任务指定模型的渠道标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."runtime_model_id" IS '构建任务指定模型的模型标识';
