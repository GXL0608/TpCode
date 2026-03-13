import path from "path"
import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { SessionPrompt } from "../../src/session/prompt"
import { Database, eq } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

describe("session build workspace", () => {
  test("creates an isolated worktree only when build preparation is requested and reuses it", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "lazy-build" })
        const before = await Project.sandboxes(Instance.project.id)

        expect(session.directory).toBe(tmp.path)
        expect(before).toEqual([])

        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const again = await Session.prepareBuild({ sessionID: session.id })
        const current = await Session.get(session.id)
        const sandboxes = await Project.sandboxes(Instance.project.id)

        expect(prepared.directory).not.toBe(tmp.path)
        expect(prepared.directory).toBe(again.directory)
        expect(current.directory).toBe(prepared.directory)
        expect(Reflect.get(prepared, "workspaceDirectory")).toBe(prepared.directory)
        expect(Reflect.get(prepared, "workspaceStatus")).toBe("ready")
        expect(await Filesystem.isDir(prepared.directory)).toBe(true)
        expect(sandboxes).toContain(prepared.directory)
      },
    })
  })

  test("reuses the owned workspace captured when the session is created inside a new worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const owned = await Worktree.create({ name: "owned-plan-workspace" })
        const session = await Instance.provide({
          directory: owned.directory,
          fn: async () =>
            Session.create({
              title: "owned-build",
              workspace: {
                directory: owned.directory,
                branch: owned.branch,
              },
            }),
        })

        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const current = await Session.get(session.id)

        expect(prepared.directory).toBe(owned.directory)
        expect(prepared.workspaceDirectory).toBe(owned.directory)
        expect(prepared.workspaceBranch).toBe(owned.branch)
        expect(current.directory).toBe(owned.directory)
        expect(current.workspaceDirectory).toBe(owned.directory)
      },
    })
  })

  test("rejects binding an existing shared workspace when the ownership marker is missing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const shared = await Worktree.create({ name: "shared-plan-workspace" })
        await Bun.file(path.join(shared.directory, ".opencode", "workspace-owner.json"))
          .delete()
          .catch(() => undefined)

        await expect(
          Instance.provide({
            directory: shared.directory,
            fn: async () =>
              Session.create({
                title: "shared-build",
                workspace: {
                  directory: shared.directory,
                  branch: shared.branch,
                },
              }),
          }),
        ).rejects.toThrow("WorktreeOwnershipInvalidError")
      },
    })
  })

  test("creates a fresh build worktree even when the session starts inside another workspace", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const shared = await Worktree.create({ name: "shared" })
        const session = await Instance.provide({
          directory: shared.directory,
          fn: async () => Session.create({ title: "workspace-build" }),
        })

        expect(session.directory).toBe(shared.directory)

        const prepared = await Session.prepareBuild({ sessionID: session.id })

        expect(prepared.directory).not.toBe(tmp.path)
        expect(prepared.directory).not.toBe(shared.directory)
        expect(Reflect.get(prepared, "workspaceDirectory")).toBe(prepared.directory)
      },
    })
  })

  test("blocks archive until dirty build worktree is confirmed, then archives and removes it", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "archive-build" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })
        const dirty = path.join(prepared.directory, "dirty.txt")

        await Bun.write(dirty, "dirty\n")

        const preview = await Session.archivePreview(session.id)
        expect(preview.has_workspace).toBe(true)
        expect(preview.dirty).toBe(true)

        await expect(
          Session.archive({
            sessionID: session.id,
            time: Date.now(),
          }),
        ).rejects.toThrow("SessionWorkspaceDirtyError")

        const archived = await Session.archive({
          sessionID: session.id,
          time: Date.now(),
          force: true,
        })

        expect(archived.time.archived).toBeDefined()
        expect(await Filesystem.exists(prepared.directory)).toBe(false)
      },
    })
  })

  test("removes a build workspace when the session is deleted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "remove-build" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await Session.remove(session.id)

        expect(await Filesystem.exists(prepared.directory)).toBe(false)
        expect(await Project.sandboxes(Instance.project.id)).not.toContain(prepared.directory)
      },
    })
  })

  test("archives a pending build workspace and removes its directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "archive-pending-build" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              workspace_status: "pending",
            })
            .where(eq(SessionTable.id, session.id))
            .run(),
        )

        const preview = await Session.archivePreview(session.id)
        expect(preview.has_workspace).toBe(true)
        expect(preview.directory).toBe(prepared.directory)

        const archived = await Session.archive({
          sessionID: session.id,
          time: Date.now(),
        })
        const current = await Session.get(session.id)

        expect(archived.time.archived).toBeDefined()
        expect(archived.workspaceStatus).toBe("removed")
        expect(archived.workspaceCleanupStatus).toBe("deleted")
        expect(await Filesystem.exists(prepared.directory)).toBe(false)
        expect(current.workspaceStatus).toBe("removed")
        expect(current.workspaceCleanupStatus).toBe("deleted")
      },
    })
  })

  test("deletes a failed build workspace and removes its directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "remove-failed-build" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        await Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              workspace_status: "failed",
            })
            .where(eq(SessionTable.id, session.id))
            .run(),
        )

        await Session.remove(session.id)

        expect(await Filesystem.exists(prepared.directory)).toBe(false)
        expect(await Project.sandboxes(Instance.project.id)).not.toContain(prepared.directory)
      },
    })
  })

  test("prepares a build workspace before the first shell command", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "shell-build" })

        await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          command: "pwd",
        })

        const current = await Session.get(session.id)
        expect(current.directory).not.toBe(tmp.path)
        expect(Reflect.get(current, "workspaceDirectory")).toBe(current.directory)
      },
    })
  })

  test("blocks pushing to the protected default branch from the build shell", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await $`git branch -M main`.quiet().nothrow().cwd(tmp.path)
        const session = await Session.create({ title: "shell-protected-push" })

        await expect(
          SessionPrompt.shell({
            sessionID: session.id,
            agent: "build",
            command: "git push origin main",
          }),
        ).rejects.toThrow("BuildProtectedBranchPushDeniedError")

        const current = await Session.get(session.id)
        expect(current.workspaceDirectory).toBeDefined()
      },
    })
  })

  test("does not leak missing-session rejections when a shell command is interrupted by session deletion", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    const errors: unknown[] = []
    const onError = (error: unknown) => {
      errors.push(error)
    }
    process.on("unhandledRejection", onError)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "shell-delete-build" })

          const shell = SessionPrompt.shell({
            sessionID: session.id,
            agent: "build",
            command: "printf before && sleep 0.2 && printf after",
          }).catch(() => undefined)

          await Bun.sleep(50)
          await Session.remove(session.id)
          await shell
          await Bun.sleep(50)
        },
      })
    } finally {
      process.off("unhandledRejection", onError)
    }

    expect(
      errors.some((error) => (error instanceof Error ? error.message : String(error)).includes("Session not found")),
    ).toBe(false)
  })
})
