import { describe, expect, test } from "bun:test"
import path from "path"
import { $ } from "bun"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { EditTool } from "../../src/tool/edit"
import { WriteTool } from "../../src/tool/write"
import { Database, eq } from "../../src/storage/db"
import {
  assertBuildCommandAllowed,
  assertBuildWriteTarget,
} from "../../src/session/build-protection"
import { FileTime } from "../../src/file/time"
import { SessionTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建一个带初始提交的一级子 git 项目，供批量 build 保护测试复用。 */
async function createChildGit(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

const ctx = {
  sessionID: "build-protection-test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("session build protection", () => {
  test("rejects writes into the main worktree during build mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "build-protect-write" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const blocked = path.join(tmp.path, "blocked.txt")
        const allowed = path.join(prepared.directory, "allowed.txt")

        await expect(
          assertBuildWriteTarget({
            sessionID: session.id,
            agent: "build",
            target: blocked,
          }),
        ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")

        await expect(
          assertBuildWriteTarget({
            sessionID: session.id,
            agent: "build",
            target: allowed,
          }),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("rejects pushing to the protected default branch during build mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await $`git branch -M main`.quiet().nothrow().cwd(tmp.path)
        const session = await Session.create({ title: "build-protect-push" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "git push origin main",
            cwd: prepared.directory,
          }),
        ).rejects.toThrow("BuildProtectedBranchPushDeniedError")
      },
    })
  })

  test("allows pushing to a non-protected branch during build mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await $`git branch -M main`.quiet().nothrow().cwd(tmp.path)
        const session = await Session.create({ title: "build-allow-feature-push" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "git push origin feature/session-123",
            cwd: prepared.directory,
          }),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("rejects a plain git push when the current branch is the protected default branch", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await $`git branch -M main`.quiet().nothrow().cwd(tmp.path)
        const session = await Session.create({ title: "build-protect-bare-push" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              workspace_directory: prepared.directory,
            })
            .where(eq(SessionTable.id, session.id))
            .run(),
        )

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "git push",
            cwd: tmp.path,
          }),
        ).rejects.toThrow("BuildProtectedBranchPushDeniedError")
      },
    })
  })

  test("rejects main worktree writes in write, edit, and apply_patch tools", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "build-protect-tools" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const rootFile = path.join(tmp.path, "root.txt")
        await Bun.write(rootFile, "before\n")

        await Instance.provide({
          directory: prepared.directory,
          fn: async () => {
            const write = await WriteTool.init()
            await expect(
              write.execute(
                {
                  filePath: path.join(tmp.path, "root-write.txt"),
                  content: "blocked\n",
                },
                { ...ctx, sessionID: session.id },
              ),
            ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")

            FileTime.read(session.id, rootFile)
            const edit = await EditTool.init()
            await expect(
              edit.execute(
                {
                  filePath: rootFile,
                  oldString: "before\n",
                  newString: "after\n",
                },
                { ...ctx, sessionID: session.id },
              ),
            ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")

            const patch = await ApplyPatchTool.init()
            const relative = path.relative(prepared.directory, rootFile).replaceAll("\\", "/")
            await expect(
              patch.execute(
                {
                  patchText:
                    "*** Begin Patch\n*** Update File: " +
                    relative +
                    "\n@@\n-before\n+after\n*** End Patch",
                },
                { ...ctx, sessionID: session.id },
              ),
            ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")
          },
        })
      },
    })
  })

  test("protects batch build sandboxes and blocks git at the aggregate root", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await createChildGit(directory, "app")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "build-protect-batch" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const sourceFile = path.join(tmp.path, "app", "README.md")
        const sandboxFile = path.join(prepared.directory, "app", "README.md")

        await expect(
          assertBuildWriteTarget({
            sessionID: session.id,
            agent: "build",
            target: sourceFile,
          }),
        ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")

        await expect(
          assertBuildWriteTarget({
            sessionID: session.id,
            agent: "build",
            target: sandboxFile,
          }),
        ).resolves.toBeUndefined()

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "git status",
            cwd: prepared.directory,
          }),
        ).rejects.toThrow("BuildMainWorktreeWriteDeniedError")
      },
    })
  })

  test("allows git commands after changing into a batch member directory", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await createChildGit(directory, "app")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "build-batch-member-cd" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "cd app && git checkout -b feature/test",
            cwd: prepared.directory,
          }),
        ).resolves.toBeUndefined()

        await expect(
          assertBuildCommandAllowed({
            sessionID: session.id,
            agent: "build",
            command: "cd app && git commit -am test",
            cwd: prepared.directory,
          }),
        ).resolves.toBeUndefined()
      },
    })
  })
})
