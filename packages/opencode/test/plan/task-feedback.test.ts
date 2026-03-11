import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import z from "zod"
import { Database, eq } from "../../src/storage/db"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"

const state = {
  info: [] as { message: unknown; extra: Record<string, unknown> | undefined }[],
  warn: [] as { message: unknown; extra: Record<string, unknown> | undefined }[],
  fail: [] as { message: unknown; extra: Record<string, unknown> | undefined }[],
}

function logger() {
  return {
    debug() {},
    info(message?: unknown, extra?: Record<string, unknown>) {
      state.info.push({ message, extra })
    },
    warn(message?: unknown, extra?: Record<string, unknown>) {
      state.warn.push({ message, extra })
    },
    error(message?: unknown, extra?: Record<string, unknown>) {
      state.fail.push({ message, extra })
    },
    tag() {
      return this
    },
    clone() {
      return this
    },
    time() {
      return {
        stop() {},
        [Symbol.dispose]() {},
      }
    },
  }
}

function noop() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    tag() {
      return this
    },
    clone() {
      return this
    },
    time() {
      return {
        stop() {},
        [Symbol.dispose]() {},
      }
    },
  }
}

mock.module("../../src/util/log", () => ({
  Log: {
    Level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    Default: noop(),
    create: (tags?: Record<string, unknown>) => (tags?.service === "plan.task_feedback" ? logger() : noop()),
    init: async () => {},
    file: () => "",
  },
}))

const { TaskFeedbackService } = await import("../../src/plan/task-feedback")

let server: ReturnType<typeof Bun.serve> | undefined
let seen: Array<{ path: string; method: string; body: string; content_type: string | null }> = []
const base = process.env["TPCODE_THIRD_API_BASE_URL"]
const timeout = process.env["TPCODE_THIRD_API_TIMEOUT_MS"]

beforeEach(() => {
  seen = []
  state.info.length = 0
  state.warn.length = 0
  state.fail.length = 0
  delete process.env["TPCODE_THIRD_API_BASE_URL"]
  delete process.env["TPCODE_THIRD_API_TIMEOUT_MS"]
})

afterEach(() => {
  server?.stop(true)
  server = undefined
  if (base === undefined) delete process.env["TPCODE_THIRD_API_BASE_URL"]
  else process.env["TPCODE_THIRD_API_BASE_URL"] = base
  if (timeout === undefined) delete process.env["TPCODE_THIRD_API_TIMEOUT_MS"]
  else process.env["TPCODE_THIRD_API_TIMEOUT_MS"] = timeout
})

function listen(fetch: (req: Request) => Response | Promise<Response>) {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      return fetch(req)
    },
  })
  process.env["TPCODE_THIRD_API_BASE_URL"] = `${server.url.origin}/prod-api`
}

function input(vho_feedback_no: string) {
  return {
    vho_feedback_no,
    plan_id: "plan_1",
    session_id: "session_1",
    message_id: "message_1",
  }
}

async function save(input: { id?: string; feedback?: string; synced?: number }) {
  const now = Date.now()
  const id = input.id ?? `plan_${now}_${Math.random().toString(36).slice(2, 8)}`
  await Database.use((db) =>
    db.insert(TpSavedPlanTable)
      .values({
        id,
        session_id: "session_1",
        message_id: "message_1",
        part_id: "part_1",
        project_id: "global",
        project_name: "global",
        project_worktree: process.cwd(),
        session_title: "title",
        user_id: `task_feedback_${id}`,
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
        department_id: "",
        agent: "plan",
        provider_id: "openai",
        model_id: "gpt-4.1-mini",
        message_created_at: now,
        plan_content: "# plan",
        vho_feedback_no: input.feedback,
        vho_synced: input.synced ?? 0,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

describe("plan.task-feedback", () => {
  test("posts umUpdateHaveAiPlan with feedbackId json body", async () => {
    const plan_id = await save({ feedback: "FK20260310001" })
    listen(async (req) => {
      seen.push({
        path: new URL(req.url).pathname,
        method: req.method,
        body: await req.text(),
        content_type: req.headers.get("content-type"),
      })
      return Response.json({ code: 200, message: "更新成功", content: null })
    })

    const result = await TaskFeedbackService.markAiPlan({
      ...input("FK20260310001"),
      plan_id,
    })

    expect(result).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe("/prod-api/feedbackTask/umUpdateHaveAiPlan")
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.body).toBe(JSON.stringify({ feedbackId: "FK20260310001" }))
    expect(seen[0]?.content_type).toContain("application/json")
    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, plan_id)).get(),
    )
    expect(row?.vho_synced).toBe(1)
  })

  test("blank feedback number skips upstream request", async () => {
    listen(() => {
      throw new Error("should_not_call")
    })

    const result = await TaskFeedbackService.markAiPlan(input("   "))

    expect(result).toEqual({ ok: true })
    expect(seen).toHaveLength(0)
  })

  test("already synced plan skips upstream request", async () => {
    const plan_id = await save({ feedback: "FK_SYNCED", synced: 1 })
    listen(() => {
      throw new Error("should_not_call")
    })

    const result = await TaskFeedbackService.markAiPlan({
      ...input("FK_SYNCED"),
      plan_id,
    })

    expect(result).toEqual({ ok: true })
    expect(seen).toHaveLength(0)
  })

  test("returns failure when upstream business code is not 200", async () => {
    listen(() => Response.json({ code: 500, message: "更新失败", content: null }))

    const result = await TaskFeedbackService.markAiPlan(input("FK20260310002"))

    expect(result).toEqual({
      ok: false,
      code: "third_party_feedback_update_failed",
      message: "更新失败",
    })
  })

  test("returns failure when upstream response is not json", async () => {
    listen(() => new Response("bad gateway", { status: 502 }))

    const result = await TaskFeedbackService.markAiPlan(input("FK20260310003"))

    expect(result).toEqual({
      ok: false,
      code: "third_party_feedback_update_failed",
      message: "第三方接口响应不是合法 JSON",
    })
  })

  test("returns failure when request errors", async () => {
    process.env["TPCODE_THIRD_API_BASE_URL"] = "http://127.0.0.1:1/prod-api"
    process.env["TPCODE_THIRD_API_TIMEOUT_MS"] = "50"

    const result = await TaskFeedbackService.markAiPlan(input("FK20260310004"))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("third_party_feedback_update_failed")
    expect(result.message).toContain("第三方接口请求失败")
    expect(state.fail).toHaveLength(1)
    expect(state.fail[0]?.extra?.vho_feedback_no).toBe("FK20260310004")
  })
})
