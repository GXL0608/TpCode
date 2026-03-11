import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.join(__dirname, "../..")

describe("session schema", () => {
  test("declares a composite message session time index", async () => {
    const schema = await fs.readFile(path.join(root, "src/session/session.sql.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))

    const match = migrations.find((item) => item.includes("message_session_time"))
    const sql = match
      ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8")
      : ""

    expect(schema).toContain('index("message_session_time_idx").on(table.session_id, table.time_created, table.id)')
    expect(sql).toContain('CREATE INDEX "message_session_time_idx" ON "message" ("session_id", "time_created", "id")')
  })

  test("declares runtime model columns for session lock-in", async () => {
    const schema = await fs.readFile(path.join(root, "src/session/session.sql.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))

    const match = migrations.find((item) => item.includes("session_runtime_model"))
    const sql = match
      ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8")
      : ""

    expect(schema).toContain("runtime_provider_id: text()")
    expect(schema).toContain("runtime_model_id: text()")
    expect(schema).toContain("runtime_model_source: text()")
    expect(sql).toContain('ALTER TABLE "session" ADD COLUMN "runtime_provider_id"')
    expect(sql).toContain('ALTER TABLE "session" ADD COLUMN "runtime_model_id"')
    expect(sql).toContain('ALTER TABLE "session" ADD COLUMN "runtime_model_source"')
  })
})
