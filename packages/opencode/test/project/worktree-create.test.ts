import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.create", () => {
  test("creates a worktree for repositories without any commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const created = await Worktree.create({ name: "unborn-root" })

        expect(created.branch).toBe("opencode/unborn-root")
        expect(await Filesystem.isDir(created.directory)).toBe(true)

        const status = await $`git status --short --branch`.quiet().cwd(created.directory).text()
        expect(status).toContain("## No commits yet on opencode/unborn-root")
      },
    })
  })
})
