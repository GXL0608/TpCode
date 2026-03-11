import path from "path"
import { fileURLToPath } from "url"
import { Log } from "@/util/log"
import { Process } from "@/util/process"

const log = Log.create({ service: "plan.task_feedback" })
const user = "zhyy"
const password = "BJtphy@2024!@#"
const host = "123.57.5.73"
const port = 1521
const name = "tphy"
const timeout = 120
const helper = fileURLToPath(new URL("../../vendor/oracle/task-feedback-helper.jar", import.meta.url))
const driver = fileURLToPath(new URL("../../vendor/oracle/ojdbc8.jar", import.meta.url))
const stmt = `
UPDATE TASK_FEEDBACK
SET IS_AI_PLAN = :flag
WHERE TASK_FEEDBACK_ID = :id
`.trim()
let thick = false

type Input = {
  vho_feedback_no: string
  plan_id: string
  session_id: string
  message_id: string
}

type Result =
  | {
      ok: true
    }
  | {
      ok: false
      code: "oracle_feedback_missing" | "oracle_feedback_update_failed" | "oracle_feedback_row_count_invalid"
      message: string
      rows_affected?: number
    }

type Jdbc =
  | {
      ok: true
      rows: number
    }
  | {
      ok: false
      code: "oracle_feedback_missing" | "oracle_feedback_update_failed" | "oracle_feedback_row_count_invalid"
      message: string
      rows?: number
    }

type Attempt =
  | {
      ok: true
      rows_affected?: number
    }
  | {
      ok: false
      code: "oracle_feedback_missing" | "oracle_feedback_update_failed" | "oracle_feedback_row_count_invalid"
      message: string
      rows_affected?: number
      fallback?: boolean
    }

async function client() {
  const mod = (await import("oracledb")) as typeof import("oracledb") & { default?: typeof import("oracledb") }
  const db = mod.default ?? mod
  const libDir = process.env["OPENCODE_ORACLE_CLIENT_LIB_DIR"]?.trim()
    || process.env["ORACLE_CLIENT_LIB_DIR"]?.trim()
    || process.env["OCI_LIB_DIR"]?.trim()
  if (libDir && !thick) {
    db.initOracleClient({ libDir })
    thick = true
  }
  return db
}

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function service() {
  return `(DESCRIPTION=(CONNECT_TIMEOUT=${timeout})(TRANSPORT_CONNECT_TIMEOUT=${timeout})(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${name})))`
}

function sid() {
  return `(DESCRIPTION=(CONNECT_TIMEOUT=${timeout})(TRANSPORT_CONNECT_TIMEOUT=${timeout})(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${name})))`
}

function retry(error: unknown) {
  const text = detail(error)
  return text.includes("NJS-518") || text.includes("is not registered with the listener")
}

function legacy(error: unknown) {
  return detail(error).includes("NJS-138")
}

function message(error: unknown) {
  const text = detail(error)
  if (!legacy(error)) return `Oracle回写失败：${text}`
  return `Oracle回写失败：${text}；当前数据库版本不支持 Thin 模式，请在服务端配置 ORACLE_CLIENT_LIB_DIR（Oracle Instant Client）后重试`
}

function parse(text: string) {
  try {
    return JSON.parse(text) as Jdbc
  } catch {
    return
  }
}

async function jdbc(input: Input): Promise<Attempt> {
  const run = await Process.run(
    [
      "java",
      "-cp",
      [helper, driver].join(path.delimiter),
      "TaskFeedbackUpdate",
      host,
      String(port),
      name,
      String(timeout),
      input.vho_feedback_no.trim(),
    ],
    {
      env: {
        OPENCODE_TASK_FEEDBACK_ORACLE_USER: user,
        OPENCODE_TASK_FEEDBACK_ORACLE_PASSWORD: password,
      },
      nothrow: true,
    },
  )
    .then((value) => ({ ok: true as const, value }))
    .catch((error: unknown) => ({ ok: false as const, error }))
  if (!run.ok) {
    return {
      ok: false as const,
      code: "oracle_feedback_update_failed" as const,
      message: `Oracle回写失败：${detail(run.error)}`,
      fallback: true,
    }
  }

  const stdout = run.value.stdout.toString().trim()
  const stderr = run.value.stderr.toString().trim()
  const result = parse(stdout)
  if (result?.ok) {
    return { ok: true as const, rows_affected: result.rows }
  }
  if (result && !result.ok) {
    return {
      ok: false as const,
      code: result.code,
      message: result.message,
      rows_affected: result.rows,
    }
  }
  const extra = stderr || stdout || `java exited with code ${run.value.code}`
  return {
    ok: false as const,
    code: "oracle_feedback_update_failed" as const,
    message: `Oracle回写失败：${extra}`,
    fallback: true,
  }
}

export namespace TaskFeedbackService {
  export async function markAiPlan(input: Input): Promise<Result> {
    const vho_feedback_no = input.vho_feedback_no.trim()
    if (!vho_feedback_no) return { ok: true as const }

    const primary = await jdbc(input)
    if (primary.ok) {
      log.info("oracle ai plan updated", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        rows_affected: primary.rows_affected ?? 1,
        mode: "jdbc",
      })
      return { ok: true as const }
    }
    if (!primary.fallback) {
      if (primary.code === "oracle_feedback_missing") {
        log.warn("oracle ai plan feedback missing", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: primary.rows_affected ?? 0,
          mode: "jdbc",
        })
      } else if (primary.code === "oracle_feedback_row_count_invalid") {
        log.warn("oracle ai plan updated unexpected row count", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: primary.rows_affected,
          mode: "jdbc",
        })
      } else {
        log.error("oracle ai plan update failed", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          error: primary.message,
          mode: "jdbc",
        })
      }
      return primary
    }
    log.warn("oracle ai plan jdbc helper unavailable, falling back to oracledb", {
      plan_id: input.plan_id,
      session_id: input.session_id,
      message_id: input.message_id,
      vho_feedback_no,
      error: primary.message,
      mode: "jdbc",
    })
    const prefix = `${primary.message}；`

    const mod = await client()
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (!mod.ok) {
      log.error("oracle ai plan update failed", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        error: mod.error,
      })
      return {
        ok: false as const,
        code: "oracle_feedback_update_failed",
        message: prefix + message(mod.error),
      }
    }

    const first = await mod.value.getConnection({
      user,
      password,
      connectString: service(),
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (!first.ok && retry(first.error)) {
      log.warn("oracle ai plan service connect failed, retrying sid", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        error: first.error,
      })
    }
    const connected = first.ok || !retry(first.error)
      ? first
      : await mod.value.getConnection({
        user,
        password,
        connectString: sid(),
      })
        .then((value) => {
          log.warn("oracle ai plan connected with sid fallback", {
            plan_id: input.plan_id,
            session_id: input.session_id,
            message_id: input.message_id,
            vho_feedback_no,
            error: first.error,
          })
          return { ok: true as const, value }
        })
        .catch((error: unknown) => ({ ok: false as const, error: `${detail(first.error)}；SID重试失败：${detail(error)}` }))
    if (!connected.ok) {
      log.error("oracle ai plan update failed", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        error: connected.error,
      })
      return {
        ok: false as const,
        code: "oracle_feedback_update_failed",
        message: prefix + message(connected.error),
      }
    }
    const conn = connected.value

    try {
      const executed = await conn.execute(
        stmt,
        {
          flag: 1,
          id: vho_feedback_no,
        },
        { autoCommit: true },
      )
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ ok: false as const, error }))
      if (!executed.ok) {
        log.error("oracle ai plan update failed", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          error: executed.error,
        })
        return {
          ok: false as const,
          code: "oracle_feedback_update_failed",
          message: prefix + message(executed.error),
        }
      }
      const result = executed.value
      const rows = result.rowsAffected ?? 0
      if (rows === 1) {
        log.info("oracle ai plan updated", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: rows,
        })
        return { ok: true as const }
      }
      if (rows === 0) {
        log.warn("oracle ai plan feedback missing", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: rows,
        })
        return {
          ok: false as const,
          code: "oracle_feedback_missing",
          message: `Oracle回写失败：未找到 TASK_FEEDBACK_ID=${vho_feedback_no} 对应的数据`,
          rows_affected: rows,
        }
      }
      log.warn("oracle ai plan updated unexpected row count", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        rows_affected: rows,
      })
      return {
        ok: false as const,
        code: "oracle_feedback_row_count_invalid",
        message: `Oracle回写失败：更新了 ${rows} 条 TASK_FEEDBACK 记录，期望 1 条`,
        rows_affected: rows,
      }
    } finally {
      await conn.close().catch((error: unknown) => {
        log.warn("oracle ai plan close failed", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          error,
        })
      })
    }
  }

  export async function markAiPlanLater(input: Input) {
    return markAiPlan(input)
  }
}
