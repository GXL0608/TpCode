import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workspace } from "../../src/control-plane/workspace"

/** 中文注释：创建一个带初始提交的一级子 git 项目，供批量沙盒删除测试复用。 */
async function createChildGit(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

afterEach(async () => {
  await resetDatabase()
})

describe("control-plane/workspace.removeBatch", () => {
  test("cleans session workspace metadata and sends the session back to the source root", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await createChildGit(directory, "app")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "batch-delete" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await Workspace.removeBatch(prepared.workspaceID!)

        const current = await Session.get(session.id)

        expect(current.directory).toBe(tmp.path)
        expect(current.workspaceID).toBeUndefined()
        expect(current.workspaceDirectory).toBeUndefined()
        expect(current.workspaceKind).toBeUndefined()
        expect(current.workspaceStatus).toBe("removed")
        expect(current.workspaceCleanupStatus).toBe("deleted")
      },
    })
  })
})
