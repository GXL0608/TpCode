import path from "path"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { $ } from "bun"
import { ExperimentalRoutes } from "../../src/server/routes/experimental"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Project } from "../../src/project/project"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建一个带初始提交的一级子 git 项目，供 worktree 路由测试复用。 */
async function createChildGit(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

describe("worktree routes", () => {
  test("creates a batch workspace from a non-git parent with git children", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await createChildGit(directory, "app")
        await createChildGit(directory, "server")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await ExperimentalRoutes().request("/worktree", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "batch-route",
          }),
        })

        expect(response.status).toBe(200)
        const created = await response.json()
        const row = await Database.use((db) =>
          db.select().from(WorkspaceTable).where(eq(WorkspaceTable.directory, created.directory)).get(),
        )
        const sandboxes = await Project.sandboxes(Instance.project.id)

        expect(created.branch).toMatch(/^opencode\//)
        expect(row?.kind).toBe("batch_worktree")
        expect(row?.meta?.members).toHaveLength(2)
        expect(sandboxes).toContain(created.directory)
      },
    })
  })
})
