import { beforeEach, describe, expect, mock, test } from "bun:test"
import z from "zod"

const state = {
  connect: [] as Record<string, unknown>[],
  init: [] as Record<string, unknown>[],
  run: [] as { cmd: string[]; env: Record<string, unknown> | undefined }[],
  exec: [] as {
    sql: string
    binds: Record<string, unknown>
    options: Record<string, unknown>
  }[],
  close: 0,
  rows: 1,
  error: undefined as Error | undefined,
  connect_error: [] as Error[],
  close_error: undefined as Error | undefined,
  run_error: undefined as Error | undefined,
  run_result: undefined as { code: number; stdout: string; stderr: string } | undefined,
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

mock.module("../../src/util/process", () => ({
  Process: {
    run: async (cmd: string[], opts?: { env?: Record<string, unknown> }) => {
      state.run.push({ cmd, env: opts?.env })
      if (state.run_error) throw state.run_error
      const result = state.run_result ?? { code: 0, stdout: "{\"ok\":true,\"rows\":1}", stderr: "" }
      return {
        code: result.code,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr),
      }
    },
  },
}))

mock.module("oracledb", () => ({
  initOracleClient: (input?: Record<string, unknown>) => {
    state.init.push(input ?? {})
  },
  getConnection: async (input: Record<string, unknown>) => {
    state.connect.push(input)
    const error = state.connect_error.shift()
    if (error) throw error
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
  state.init.length = 0
  state.run.length = 0
  state.exec.length = 0
  state.close = 0
  state.rows = 1
  state.error = undefined
  state.connect_error.length = 0
  state.close_error = undefined
  state.run_error = undefined
  state.run_result = undefined
  state.info.length = 0
  state.warn.length = 0
  state.fail.length = 0
})

describe("plan.task-feedback", () => {
  test("executes update with where clause and closes connection", async () => {
    const result = await TaskFeedbackService.markAiPlan({
      vho_feedback_no: "  VHO-12345  ",
      plan_id: "plan_1",
      session_id: "session_1",
      message_id: "message_1",
    })

    expect(result).toEqual({ ok: true })
    expect(state.connect).toEqual([
      {
        user: "zhyy",
        password: "BJtphy@2024!@#",
        connectString: "123.57.5.73:1521/tphy",
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

    const result = await TaskFeedbackService.markAiPlan({
      vho_feedback_no: "VHO-404",
      plan_id: "plan_2",
      session_id: "session_2",
      message_id: "message_2",
    })

    expect(result).toEqual({
      ok: false,
      code: "oracle_feedback_missing",
      message: "Oracle回写失败：未找到 TASK_FEEDBACK_ID=VHO-404 对应的数据",
      rows_affected: 0,
    })
    expect(state.close).toBe(1)
    expect(state.info).toHaveLength(0)
    expect(state.warn).toHaveLength(1)
    expect(state.fail).toHaveLength(0)
    expect(state.warn[0].extra?.vho_feedback_no).toBe("VHO-404")
  })

  test("retries with sid when listener does not recognize service name", async () => {
    state.connect_error.push(
      new Error('NJS-518: cannot connect to Oracle Database. Service "zhyy" is not registered with the listener'),
    )

    await expect(TaskFeedbackService.markAiPlan({
      vho_feedback_no: "VHO-SID",
      plan_id: "plan_4",
      session_id: "session_4",
      message_id: "message_4",
    })).resolves.toEqual({ ok: true })

    expect(state.connect).toHaveLength(2)
    expect(state.connect[0]).toEqual({
      user: "zhyy",
      password: "BJtphy@2024!@#",
      connectString: "123.57.5.73:1521/tphy",
    })
    expect(state.connect[1]).toEqual({
      user: "zhyy",
      password: "BJtphy@2024!@#",
      connectString: "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=123.57.5.73)(PORT=1521))(CONNECT_DATA=(SID=tphy)))",
    })
    expect(state.exec).toHaveLength(1)
    expect(state.fail).toHaveLength(0)
  })

  test("falls back to bundled jdbc when thin mode does not support the server version", async () => {
    state.connect_error.push(new Error("NJS-138: connections to this database server version are not supported by node-oracledb in Thin mode"))

    await expect(TaskFeedbackService.markAiPlan({
      vho_feedback_no: "VHO-THICK",
      plan_id: "plan_5",
      session_id: "session_5",
      message_id: "message_5",
    })).resolves.toEqual({ ok: true })

    expect(state.run).toHaveLength(1)
    expect(state.run[0].cmd[0]).toBe("java")
    expect(state.run[0].cmd[1]).toBe("-cp")
    expect(state.run[0].cmd[3]).toBe("TaskFeedbackUpdate")
    expect(state.run[0].cmd.slice(-4)).toEqual(["123.57.5.73", "1521", "tphy", "VHO-THICK"])
    expect(state.run[0].env).toMatchObject({
      OPENCODE_TASK_FEEDBACK_ORACLE_USER: "zhyy",
      OPENCODE_TASK_FEEDBACK_ORACLE_PASSWORD: "BJtphy@2024!@#",
    })
  })

  test("returns failure when execute errors and still closes connection", async () => {
    state.error = new Error("oracle_down")

    await expect(TaskFeedbackService.markAiPlan({
      vho_feedback_no: "VHO-ERR",
      plan_id: "plan_3",
      session_id: "session_3",
      message_id: "message_3",
    })).resolves.toEqual({
      ok: false,
      code: "oracle_feedback_update_failed",
      message: "Oracle回写失败：oracle_down",
    })

    expect(state.exec).toHaveLength(1)
    expect(state.close).toBe(1)
    expect(state.fail).toHaveLength(1)
    expect(state.fail[0].message).toBe("oracle ai plan update failed")
    expect(state.fail[0].extra?.vho_feedback_no).toBe("VHO-ERR")
  })
})
