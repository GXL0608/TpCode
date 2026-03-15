ALTER TABLE "tp_product_solution" ALTER COLUMN "enabled" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tp_product_solution"
  ALTER COLUMN "enabled" TYPE bigint
  USING CASE WHEN "enabled" THEN 1 ELSE 0 END;
--> statement-breakpoint
ALTER TABLE "tp_product_solution" ALTER COLUMN "enabled" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "tp_product_solution_root" ALTER COLUMN "enabled" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tp_product_solution_root"
  ALTER COLUMN "enabled" TYPE bigint
  USING CASE WHEN "enabled" THEN 1 ELSE 0 END;
--> statement-breakpoint
ALTER TABLE "tp_product_solution_root" ALTER COLUMN "enabled" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "tp_build_job" ALTER COLUMN "started" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tp_build_job"
  ALTER COLUMN "started" TYPE bigint
  USING CASE WHEN "started" THEN 1 ELSE 0 END;
--> statement-breakpoint
ALTER TABLE "tp_build_job" ALTER COLUMN "started" SET DEFAULT 0;
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution"."enabled" IS '是否启用（0/1）';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_root"."enabled" IS '是否启用（0/1）';
--> statement-breakpoint
COMMENT ON COLUMN "tp_build_job"."started" IS '是否已启动（0/1）';
