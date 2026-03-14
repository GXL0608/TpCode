import path from "path"
import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRoutes } from "../../src/server/routes/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import { $ } from "bun"

Log.init({ print: false })

/** 中文注释：创建一个带初始提交的一级子 git 项目，供批量沙盒路由测试复用。 */
async function createChildGit(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

describe("session build workspace routes", () => {
  test("patch archive rejects dirty workspaces instead of bypassing archive safeguards", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "dirty-route-archive" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })
        await Bun.write(path.join(prepared.directory, "dirty.txt"), "dirty\n")

        const response = await SessionRoutes().request(`/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            time: {
              archived: Date.now(),
            },
          }),
        })

        expect(response.status).toBeGreaterThanOrEqual(400)
        expect((await Session.get(session.id)).time.archived).toBeUndefined()
        expect(await Filesystem.exists(prepared.directory)).toBe(true)
      },
    })
  })

  test("patch archive removes a clean build workspace like the dedicated archive endpoint", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "clean-route-archive" })
        const prepared = await Session.prepareBuild({ sessionID: session.id })

        const response = await SessionRoutes().request(`/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            time: {
              archived: Date.now(),
            },
          }),
        })

        expect(response.status).toBe(200)
        expect((await Session.get(session.id)).time.archived).toBeDefined()
        expect(await Filesystem.exists(prepared.directory)).toBe(false)
      },
    })
  })

  test("prompt_async swallows deleted-session failures from the background prompt task", async () => {
    await using tmp = await tmpdir({ git: true })
    const errors: unknown[] = []
    const onError = (error: unknown) => {
      errors.push(error)
    }
    process.on("unhandledRejection", onError)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "async-prompt-delete" })
          const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(
            (async () => {
              throw new Error(`Session not found: ${session.id}`)
            }) as unknown as typeof SessionPrompt.prompt,
          )

          try {
            const response = await SessionRoutes().request(`/${session.id}/prompt_async`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent: "build",
                parts: [{ type: "text", text: "hello" }],
              }),
            })

            expect(response.status).toBe(204)
            await Bun.sleep(20)
          } finally {
            prompt.mockRestore()
          }
        },
      })
    } finally {
      process.off("unhandledRejection", onError)
    }

    expect(
      errors.some((error) => (error instanceof Error ? error.message : String(error)).includes("Session not found")),
    ).toBe(false)
  })

  test("prompt_async for a sandbox session runs inside the session directory instead of the parent directory", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await createChildGit(directory, "app")
      },
    })
    const seen: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seed = await Session.create({ title: "batch-root" })
        const prepared = await Session.prepareBuild({ sessionID: seed.id })
        const plan = await Instance.provide({
          directory: prepared.directory,
          fn: async () => Session.create({ title: "sandbox-plan" }),
        })
        const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(
          (async () => {
            seen.push(Instance.directory)
            return undefined as never
          }) as unknown as typeof SessionPrompt.prompt,
        )

        try {
          const response = await Instance.provide({
            directory: tmp.path,
            fn: async () =>
              SessionRoutes().request(`/${plan.id}/prompt_async`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent: "plan",
                  parts: [{ type: "text", text: "hello batch" }],
                }),
              }),
          })

          expect(response.status).toBe(204)
          for (const _ of Array.from({ length: 20 })) {
            if (seen.length > 0) break
            await Bun.sleep(20)
          }
        } finally {
          prompt.mockRestore()
        }
      },
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toBe(tmp.path)
  })
})
