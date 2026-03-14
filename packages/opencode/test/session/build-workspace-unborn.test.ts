import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("session build workspace on unborn repositories", () => {
  test("prepares a build workspace even when the git repository has no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "unborn-build" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        expect(prepared.directory).not.toBe(tmp.path)
        expect(prepared.workspaceDirectory).toBe(prepared.directory)
        expect(prepared.workspaceKind).toBe("single_worktree")
        expect(await Filesystem.isDir(prepared.directory)).toBe(true)

        const status = await $`git status --short --branch`.quiet().cwd(prepared.directory).text()
        expect(status).toContain("## No commits yet on")
      },
    })
  })
})
