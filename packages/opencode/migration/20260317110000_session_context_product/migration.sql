ALTER TABLE "session"
ADD COLUMN IF NOT EXISTS "context_product_id" text REFERENCES "tp_product"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "session_context_product_idx" ON "session" ("context_product_id");

COMMENT ON COLUMN "session"."context_product_id" IS '会话所属的产品上下文标识';

UPDATE "session" AS "session"
SET "context_product_id" = "product"."id"
FROM "tp_product" AS "product"
WHERE "session"."context_product_id" IS NULL
  AND lower("session"."directory") LIKE '%' || lower("product"."id") || '-%';
