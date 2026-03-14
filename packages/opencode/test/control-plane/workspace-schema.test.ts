import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.join(__dirname, "../..")

describe("workspace schema", () => {
  test("declares batch workspace columns and migration", async () => {
    const schema = await fs.readFile(path.join(root, "src/control-plane/workspace.sql.ts"), "utf-8")
    const migrations = await fs.readdir(path.join(root, "migration"))
    const match = migrations.find((item) => item.includes("batch_workspace"))
    const sql = match ? await fs.readFile(path.join(root, "migration", match, "migration.sql"), "utf-8") : ""

    expect(schema).toContain("directory: text().notNull()")
    expect(schema).toContain('kind: text().notNull().$type<WorkspaceKind>()')
    expect(schema).toContain('uniqueIndex("workspace_directory_uidx").on(table.directory)')
    expect(sql).toContain('ALTER TABLE "workspace" ADD COLUMN "directory" text;')
    expect(sql).toContain('CREATE UNIQUE INDEX "workspace_directory_uidx" ON "workspace" ("directory")')
    expect(sql).toContain('COMMENT ON COLUMN "workspace"."meta"')
  })
})
