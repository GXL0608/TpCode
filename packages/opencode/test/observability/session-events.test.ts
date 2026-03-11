import path from "path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Observe } from "../../src/observability"
import type { LogEvent } from "../../src/observability/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"
import { Todo } from "../../src/session/todo"
import { AccountCurrent } from "../../src/user/current"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")

async function headers(app: ReturnType<typeof Server.App>) {
  const login = await app.request("/account/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
    }),
  })
  const output = new Headers({ "Content-Type": "application/json" })
  if (login.status !== 200) return output
  const body = (await login.json()) as Record<string, unknown>
  if (typeof body.access_token !== "string") return output
  output.set("authorization", `Bearer ${body.access_token}`)
  return output
}

describe("session observability events", () => {
  afterEach(async () => {
    await Observe.stop()
  })

  test("emits session.get event on direct session lookup", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "session events" })
        await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        await Session.get(session.id)
      },
    })

    await Observe.flush()

    const get = events.find((item) => item.event === "session.get")

    expect(get).toBeDefined()
    expect(get?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(get?.session_id).toBeDefined()
  })

  test("emits session.messages without duplicating session.get", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "session messages" })
        await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        await Observe.flush()
        events.length = 0
        await Session.messages({ sessionID: session.id })
      },
    })

    await Observe.flush()

    const get = events.find((item) => item.event === "session.get")
    const messages = events.find((item) => item.event === "session.messages")

    expect(get).toBeUndefined()
    expect(messages).toBeDefined()
    expect(messages?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(messages?.extra.message_count).toBeGreaterThanOrEqual(1)
    expect(messages?.extra.part_count).toBeGreaterThanOrEqual(1)
  })

  test("emits session.todo when loading todos", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "session todo" })
        await Todo.update({
          sessionID: session.id,
          todos: [
            {
              content: "check logs",
              status: "pending",
              priority: "high",
            },
          ],
        })
        await Todo.get(session.id)
      },
    })

    await Observe.flush()

    const todo = events.find((item) => item.event === "session.todo.get")
    expect(todo).toBeDefined()
    expect(todo?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(todo?.extra.todo_count).toBe(1)
  })

  test("emits prompt and model dialogue events during one turn", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

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
        const session = await Session.create({ title: "prompt events" })
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "text-start" }
              yield { type: "text-delta", text: "done" }
              yield { type: "text-end" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                },
              }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "hello" }],
          })
        } finally {
          stream.mockRestore()
        }
      },
    })

    await Observe.flush()

    expect(events.some((item) => item.event === "session.prompt.accept")).toBe(true)
    expect(events.some((item) => item.event === "session.prompt.loop")).toBe(true)
    expect(events.some((item) => item.event === "session.prompt.step")).toBe(true)
    expect(events.some((item) => item.event === "session.get")).toBe(false)
    expect(events.filter((item) => item.event === "session.status.change" && item.tags.state === "busy")).toHaveLength(1)
    expect(events.filter((item) => item.event === "session.status.change" && item.tags.state === "idle")).toHaveLength(1)
    expect(events.some((item) => item.event === "session.prompt.cancel")).toBe(false)
    const history = events.filter((item) => item.event === "session.history.load")
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(new Set(history.map((item) => item.extra.step)).size).toBe(history.length)
    expect(events.filter((item) => item.event === "session.model_messages.build")).toHaveLength(1)
    expect(events.filter((item) => item.event === "tool.resolve")).toHaveLength(1)
    const accept = events.find((item) => item.event === "session.prompt.accept")
    const step = events.find((item) => item.event === "session.prompt.step")
    const loop = events.find((item) => item.event === "session.prompt.loop")
    expect(accept?.message_id).toBeDefined()
    expect(step?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(step?.message_id).toBeDefined()
    expect(step?.tags.result).toBe("continue")
    expect(step?.tags.finish_reason).toBe("stop")
    expect(loop?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(loop?.message_id).toBeDefined()
    expect(loop?.tags.finish_reason).toBe("stop")
  })

  test("emits queue timing when a prompt waits for an active loop", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

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
        const session = await Session.create({ title: "queued prompt events" })
        let call = 0
        let release = Promise.withResolvers<void>()
        let entered = Promise.withResolvers<void>()
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          call++
          const current = call
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              if (current === 1) {
                entered.resolve()
                await release.promise
              }
              yield { type: "text-start" }
              yield { type: "text-delta", text: `done-${current}` }
              yield { type: "text-end" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                },
              }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          const first = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "first" }],
          })
          await entered.promise
          const second = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "second" }],
          })
          await Bun.sleep(5)
          release.resolve()
          await Promise.all([first, second])
        } finally {
          stream.mockRestore()
        }
      },
    })

    await Observe.flush()

    const queue = events.find((item) => item.event === "session.prompt.queue")
    expect(queue).toBeDefined()
    expect(queue?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(queue?.status).toBe("completed")
    expect(queue?.message_id).toBeDefined()
  })

  test("does not double count session.get on session route", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "route session get" })
        const response = await SessionRoutes().request(`/${session.id}`)
        expect(response.status).toBe(200)
      },
    })

    await Observe.flush()

    expect(events.filter((item) => item.event === "session.get")).toHaveLength(1)
  })

  test("injects request and account context into session events", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const auth = await headers(app)
        const login = await app.request("/account/me", { headers: auth })
        expect(login.status).toBe(200)
        const me = (await login.json()) as {
          id: string
          org_id: string
          department_id?: string
          context_project_id?: string
          roles: string[]
          permissions: string[]
        }
        const session = await AccountCurrent.provide(
          {
            user_id: me.id,
            org_id: me.org_id,
            department_id: me.department_id,
            context_project_id: me.context_project_id ?? "global",
            roles: me.roles,
            permissions: me.permissions,
          },
          () => Session.create({ title: "context session" }),
        )
        events.length = 0
        const response = await app.request(`/session/${session.id}`, {
          headers: auth,
        })
        expect(response.status).toBe(200)
      },
    })

    await Observe.flush()

    const item = events.find((event) => event.event === "session.get")
    const request = events.find((event) => event.event === "http.request")
    expect(item?.request_id).toBeDefined()
    expect(item?.user_id).toBeDefined()
    expect(item?.project_id).toBeDefined()
    expect(item?.workspace_id).toBeDefined()
    expect(request?.request_id).toBeDefined()
    expect(request?.user_id).toBeDefined()
    expect(request?.project_id).toBeDefined()
    expect(request?.workspace_id).toBeDefined()
  })
})
