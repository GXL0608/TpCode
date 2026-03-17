-- 中文注释：先把仍残留在解决方案主表上的历史 product_id 回填到绑定表，确保删除旧字段前不丢产品与方案关系。
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
  'legacy_' || "id",
  "product_id",
  "id",
  "enabled",
  0,
  "time_created",
  "time_updated"
FROM "tp_product_solution"
WHERE "product_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "tp_product_solution_binding" b
    WHERE b."product_id" = "tp_product_solution"."product_id"
      AND b."solution_id" = "tp_product_solution"."id"
  );

-- 中文注释：解决方案已改为全局库，编码唯一性应直接以 code 全局约束，不再依赖产品维度。
DROP INDEX IF EXISTS "tp_product_solution_product_code_uidx";
DROP INDEX IF EXISTS "tp_product_solution_product_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "tp_product_solution_code_uidx" ON "tp_product_solution" ("code");

-- 中文注释：移除已经无意义的产品归属字段和兼容主项目字段，后续统一由绑定表和 roots 推导运行上下文。
ALTER TABLE "tp_product_solution" DROP COLUMN IF EXISTS "product_id";
ALTER TABLE "tp_product_solution" DROP COLUMN IF EXISTS "primary_project_id";
