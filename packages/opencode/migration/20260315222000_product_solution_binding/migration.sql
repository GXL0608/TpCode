CREATE TABLE "tp_product_solution_binding" (
  "id" text PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL REFERENCES "tp_product"("id") ON DELETE CASCADE,
  "solution_id" text NOT NULL REFERENCES "tp_product_solution"("id") ON DELETE CASCADE,
  "enabled" bigint NOT NULL DEFAULT 1,
  "sort_order" bigint NOT NULL DEFAULT 0,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tp_product_solution_binding_product_solution_uidx" ON "tp_product_solution_binding" ("product_id", "solution_id");
--> statement-breakpoint
CREATE INDEX "tp_product_solution_binding_product_idx" ON "tp_product_solution_binding" ("product_id");
--> statement-breakpoint
CREATE INDEX "tp_product_solution_binding_solution_idx" ON "tp_product_solution_binding" ("solution_id");
--> statement-breakpoint
CREATE INDEX "tp_product_solution_binding_product_sort_idx" ON "tp_product_solution_binding" ("product_id", "sort_order");
--> statement-breakpoint
COMMENT ON TABLE "tp_product_solution_binding" IS '产品与解决方案绑定关系';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."id" IS '绑定关系主键';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."product_id" IS '产品标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."solution_id" IS '解决方案标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."enabled" IS '是否启用（0/1）';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."sort_order" IS '排序值';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."time_created" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_product_solution_binding"."time_updated" IS '更新时间';
--> statement-breakpoint
INSERT INTO "tp_product_solution_binding" (
  "id",
  "product_id",
  "solution_id",
  "enabled",
  "sort_order",
  "time_created",
  "time_updated"
)
SELECT
  concat('psb_', md5("product_id" || ':' || "id")),
  "product_id",
  "id",
  1,
  0,
  "time_created",
  "time_updated"
FROM "tp_product_solution"
ON CONFLICT ("product_id", "solution_id") DO NOTHING;
