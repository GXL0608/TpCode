import path from "path"
import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRoutes } from "../../src/server/routes/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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
})
