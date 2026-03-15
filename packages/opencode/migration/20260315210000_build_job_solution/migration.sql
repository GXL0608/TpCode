CREATE TABLE "tp_product_solution" (
  "id" text PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL REFERENCES "tp_product"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "primary_project_id" text REFERENCES "project"("id") ON DELETE SET NULL,
  "build_profile_json" jsonb NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tp_product_solution_product_code_uidx" ON "tp_product_solution" ("product_id", "code");
--> statement-breakpoint
CREATE INDEX "tp_product_solution_product_idx" ON "tp_product_solution" ("product_id");
--> statement-breakpoint
COMMENT ON TABLE "tp_product_solution" IS '产品解决方案定义';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."id" IS '解决方案主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."product_id" IS '所属产品标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."name" IS '解决方案名称';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."code" IS '解决方案编码';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."enabled" IS '是否启用';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."primary_project_id" IS '默认上下文项目标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."build_profile_json" IS '编译打包配置';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."time_updated" IS '更新时间';
--> statement-breakpoint

CREATE TABLE "tp_product_solution_root" (
  "id" text PRIMARY KEY NOT NULL,
  "solution_id" text NOT NULL REFERENCES "tp_product_solution"("id") ON DELETE CASCADE,
  "root_type" text NOT NULL,
  "directory" text NOT NULL,
  "display_name" text,
  "sort_order" bigint NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "meta_json" jsonb,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tp_product_solution_root_solution_idx" ON "tp_product_solution_root" ("solution_id");
--> statement-breakpoint
CREATE INDEX "tp_product_solution_root_solution_sort_idx" ON "tp_product_solution_root" ("solution_id", "sort_order");
--> statement-breakpoint
COMMENT ON TABLE "tp_product_solution_root" IS '解决方案源码根目录定义';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."id" IS '源码根目录主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."solution_id" IS '所属解决方案标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."root_type" IS '源码根目录类型';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."directory" IS '目录路径或逻辑目录键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."display_name" IS '展示名称';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."sort_order" IS '排序值';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."enabled" IS '是否启用';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."meta_json" IS '虚拟目录附加配置';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."time_updated" IS '更新时间';
--> statement-breakpoint

CREATE TABLE "tp_build_job" (
  "id" text PRIMARY KEY NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "prompt_text" text,
  "product_id" text NOT NULL REFERENCES "tp_product"("id") ON DELETE CASCADE,
  "solution_id" text NOT NULL REFERENCES "tp_product_solution"("id") ON DELETE CASCADE,
  "session_id" text REFERENCES "session"("id") ON DELETE SET NULL,
  "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL,
  "status" text NOT NULL,
  "current_stage" text,
  "plan_content" text,
  "started" boolean NOT NULL DEFAULT false,
  "error_code" text,
  "error_message" text,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tp_build_job_product_time_idx" ON "tp_build_job" ("product_id", "time_created");
--> statement-breakpoint
CREATE INDEX "tp_build_job_solution_time_idx" ON "tp_build_job" ("solution_id", "time_created");
--> statement-breakpoint
CREATE INDEX "tp_build_job_status_time_idx" ON "tp_build_job" ("status", "time_created");
--> statement-breakpoint
COMMENT ON TABLE "tp_build_job" IS '构建闭环任务主表';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."id" IS '构建任务主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."source_type" IS '任务来源类型';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."source_id" IS '来源记录标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."prompt_text" IS '用户原始需求文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."product_id" IS '所属产品标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."solution_id" IS '执行解决方案标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."session_id" IS '执行会话标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."workspace_id" IS '执行工作区标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."status" IS '任务状态';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."current_stage" IS '当前阶段';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."plan_content" IS '计划快照';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."started" IS '是否已启动';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."error_code" IS '失败错误码';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."error_message" IS '失败错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."time_updated" IS '更新时间';
--> statement-breakpoint

CREATE TABLE "tp_build_job_stage" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL REFERENCES "tp_build_job"("id") ON DELETE CASCADE,
  "stage" text NOT NULL,
  "status" text NOT NULL,
  "detail_json" jsonb,
  "error_code" text,
  "error_message" text,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tp_build_job_stage_job_idx" ON "tp_build_job_stage" ("job_id");
--> statement-breakpoint
CREATE INDEX "tp_build_job_stage_job_stage_idx" ON "tp_build_job_stage" ("job_id", "stage");
--> statement-breakpoint
COMMENT ON TABLE "tp_build_job_stage" IS '构建闭环阶段记录';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."id" IS '阶段记录主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."job_id" IS '所属构建任务标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."stage" IS '阶段名称';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."status" IS '阶段状态';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."detail_json" IS '阶段明细';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."error_code" IS '阶段错误码';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."error_message" IS '阶段错误信息';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job_stage"."time_updated" IS '更新时间';
--> statement-breakpoint

CREATE TABLE "tp_build_artifact" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL REFERENCES "tp_build_job"("id") ON DELETE CASCADE,
  "solution_id" text NOT NULL REFERENCES "tp_product_solution"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "size" bigint NOT NULL DEFAULT 0,
  "hash" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tp_build_artifact_job_idx" ON "tp_build_artifact" ("job_id");
--> statement-breakpoint
CREATE INDEX "tp_build_artifact_solution_idx" ON "tp_build_artifact" ("solution_id");
--> statement-breakpoint
COMMENT ON TABLE "tp_build_artifact" IS '构建产物记录';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."id" IS '产物主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."job_id" IS '所属构建任务标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."solution_id" IS '所属解决方案标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."file_name" IS '产物文件名';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."file_path" IS '产物文件路径';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."size" IS '文件大小';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."hash" IS '文件摘要';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_artifact"."time_updated" IS '更新时间';
