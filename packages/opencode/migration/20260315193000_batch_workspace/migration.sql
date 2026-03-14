ALTER TABLE "workspace" ADD COLUMN "directory" text;
UPDATE "workspace"
SET "directory" = COALESCE(("config"::json ->> 'directory'), "id")
WHERE "directory" IS NULL;
ALTER TABLE "workspace" ALTER COLUMN "directory" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "kind" text;
UPDATE "workspace" SET "kind" = 'single_worktree' WHERE "kind" IS NULL;
ALTER TABLE "workspace" ALTER COLUMN "kind" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "meta" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_directory_uidx" ON "workspace" ("directory");
--> statement-breakpoint
COMMENT ON COLUMN "workspace"."directory" IS '工作区入口目录';
--> statement-breakpoint
COMMENT ON COLUMN "workspace"."kind" IS '工作区类型';
--> statement-breakpoint
COMMENT ON COLUMN "workspace"."meta" IS '批量工作区成员元数据';
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL;
ALTER TABLE "session" ADD COLUMN "workspace_kind" text;
--> statement-breakpoint
COMMENT ON COLUMN "session"."workspace_id" IS '当前会话绑定的工作区记录标识';
--> statement-breakpoint
COMMENT ON COLUMN "session"."workspace_kind" IS '当前会话绑定工作区的类型';
