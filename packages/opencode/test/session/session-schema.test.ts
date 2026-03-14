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

  test("declares workspace binding columns for batch sandboxes", async () => {
    const schema = await fs.readFile(path.join(root, "src/session/session.sql.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))

    const match = migrations.find((item) => item.includes("batch_workspace"))
    const sql = match ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8") : ""

    expect(schema).toContain("workspace_id: text().references(() => WorkspaceTable.id, { onDelete: \"set null\" })")
    expect(schema).toContain("workspace_kind: text().$type<WorkspaceKind>()")
    expect(sql).toContain('ALTER TABLE "session" ADD COLUMN "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL;')
    expect(sql).toContain('ALTER TABLE "session" ADD COLUMN "workspace_kind" text;')
  })

  test("declares unified model call record table and removes the mirror table migration", async () => {
    const schema = await fs.readFile(path.join(root, "src/session/session.sql.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))

    const match = migrations.find((item) => item.includes("session_model_call_record"))
    const sql = match ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8") : ""

    expect(schema).toContain('"tp_session_model_call_record"')
    expect(schema).toContain("request_protocol: text()")
    expect(schema).toContain("student_request_protocol: text()")
    expect(schema).not.toContain('table(\n  "tp_session_mirror_record"')
    expect(migrations.some((item) => item.includes("tp_session_mirror_record"))).toBeFalse()
    expect(sql).toContain('CREATE TABLE "tp_session_model_call_record"')
    expect(sql).toContain('COMMENT ON TABLE "tp_session_model_call_record"')
    expect(sql).toContain('CREATE INDEX "tp_session_model_call_record_session_time_idx"')
  })
})
