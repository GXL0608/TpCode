import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.join(__dirname, "../..")

describe("observability schema", () => {
  test("declares app_event_log table and Chinese comments", async () => {
    const schema = await fs.readFile(path.join(root, "src/storage/schema.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))
    const match = migrations.find((item) => item.includes("app_event_log"))
    const sql = match
      ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8")
      : ""

    expect(schema).toContain("AppEventLogTable")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "app_event_log"')
    expect(sql).toContain(`COMMENT ON TABLE "app_event_log" IS '应用事件日志表'`)
    expect(sql).toContain(`COMMENT ON COLUMN "app_event_log"."duration_ms" IS '事件耗时（毫秒）'`)
    expect(sql).toContain('CREATE INDEX "app_event_log_created_at_idx" ON "app_event_log" ("created_at" DESC)')
    expect(sql).toContain('CREATE INDEX "app_event_log_event_created_idx" ON "app_event_log" ("event", "created_at" DESC)')
    expect(sql).toContain(
      'CREATE INDEX "app_event_log_session_created_idx" ON "app_event_log" ("session_id", "created_at" DESC) WHERE "session_id" IS NOT NULL',
    )
    expect(sql).toContain('CREATE INDEX "app_event_log_tags_gin_idx" ON "app_event_log" USING GIN ("tags" jsonb_path_ops)')
  })
})
