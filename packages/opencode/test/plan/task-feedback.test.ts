import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import z from "zod"

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

describe("plan.task-feedback", () => {
  test("posts umUpdateHaveAiPlan with feedbackId json body", async () => {
    listen(async (req) => {
      seen.push({
        path: new URL(req.url).pathname,
        method: req.method,
        body: await req.text(),
        content_type: req.headers.get("content-type"),
      })
      return Response.json({ code: 200, message: "更新成功", content: null })
    })

    const result = await TaskFeedbackService.markAiPlan(input("FK20260310001"))

    expect(result).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe("/prod-api/feedbackTask/umUpdateHaveAiPlan")
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.body).toBe(JSON.stringify({ feedbackId: "FK20260310001" }))
    expect(seen[0]?.content_type).toContain("application/json")
  })

  test("blank feedback number skips upstream request", async () => {
    listen(() => {
      throw new Error("should_not_call")
    })

    const result = await TaskFeedbackService.markAiPlan(input("   "))

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
