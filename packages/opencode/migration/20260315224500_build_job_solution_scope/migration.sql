ALTER TABLE "tp_build_job" ADD COLUMN "solution_scope" text NOT NULL DEFAULT 'single';
--> statement-breakpoint
CREATE INDEX "tp_build_job_scope_time_idx" ON "tp_build_job" ("solution_scope", "time_created");
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."solution_scope" IS '解决方案执行范围：single/product_all';
