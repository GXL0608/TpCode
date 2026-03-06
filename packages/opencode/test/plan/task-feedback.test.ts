import { beforeEach, describe, expect, mock, test } from "bun:test"
import z from "zod"

const state = {
  connect: [] as Record<string, unknown>[],
  exec: [] as {
    sql: string
    binds: Record<string, unknown>
    options: Record<string, unknown>
  }[],
  close: 0,
  rows: 1,
  error: undefined as Error | undefined,
  connect_error: undefined as Error | undefined,
  close_error: undefined as Error | undefined,
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

mock.module("oracledb", () => ({
  getConnection: async (input: Record<string, unknown>) => {
    state.connect.push(input)
    if (state.connect_error) throw state.connect_error
    return {
      execute: async (sql: string, binds: Record<string, unknown>, options: Record<string, unknown>) => {
        state.exec.push({ sql, binds, options })
        if (state.error) throw state.error
        return { rowsAffected: state.rows }
      },
      close: async () => {
        state.close += 1
        if (state.close_error) throw state.close_error
      },
    }
  },
}))

const { TaskFeedbackService } = await import("../../src/plan/task-feedback")

beforeEach(() => {
  state.connect.length = 0
  state.exec.length = 0
  state.close = 0
  state.rows = 1
  state.error = undefined
  state.connect_error = undefined
  state.close_error = undefined
  state.info.length = 0
  state.warn.length = 0
  state.fail.length = 0
})

describe("plan.task-feedback", () => {
  test("executes update with where clause and closes connection", async () => {
    await TaskFeedbackService.markAiPlan({
      vho_feedback_no: "  VHO-12345  ",
      plan_id: "plan_1",
      session_id: "session_1",
      message_id: "message_1",
    })

    expect(state.connect).toEqual([
      {
        user: "tphy",
        password: "BJtphy@2024!@#",
        connectString: "123.57.5.73:1521/zhyy",
      },
    ])
    expect(state.exec).toHaveLength(1)
    expect(state.exec[0].sql).toContain("UPDATE TASK_FEEDBACK")
    expect(state.exec[0].sql).toContain("SET IS_AI_PLAN = :flag")
    expect(state.exec[0].sql).toContain("WHERE TASK_FEEDBACK_ID = :id")
    expect(state.exec[0].binds).toEqual({ flag: 1, id: "VHO-12345" })
    expect(state.exec[0].options).toEqual({ autoCommit: true })
    expect(state.close).toBe(1)
    expect(state.info).toHaveLength(1)
    expect(state.warn).toHaveLength(0)
    expect(state.fail).toHaveLength(0)
  })

  test("warns when no feedback row matches", async () => {
    state.rows = 0

    await TaskFeedbackService.markAiPlan({
      vho_feedback_no: "VHO-404",
      plan_id: "plan_2",
      session_id: "session_2",
      message_id: "message_2",
    })

    expect(state.close).toBe(1)
    expect(state.info).toHaveLength(0)
    expect(state.warn).toHaveLength(1)
    expect(state.fail).toHaveLength(0)
    expect(state.warn[0].extra?.vho_feedback_no).toBe("VHO-404")
  })

  test("markAiPlanLater swallows execute errors and still closes connection", async () => {
    state.error = new Error("oracle_down")

    await expect(
      TaskFeedbackService.markAiPlanLater({
        vho_feedback_no: "VHO-ERR",
        plan_id: "plan_3",
        session_id: "session_3",
        message_id: "message_3",
      }),
    ).resolves.toBeUndefined()

    expect(state.exec).toHaveLength(1)
    expect(state.close).toBe(1)
    expect(state.fail).toHaveLength(1)
    expect(state.fail[0].message).toBe("oracle ai plan update failed")
    expect(state.fail[0].extra?.vho_feedback_no).toBe("VHO-ERR")
  })
})
