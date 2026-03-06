import { Log } from "@/util/log"

const log = Log.create({ service: "plan.task_feedback" })
const user = "tphy"
const password = "BJtphy@2024!@#"
const connectString = "123.57.5.73:1521/zhyy"
const stmt = `
UPDATE TASK_FEEDBACK
SET IS_AI_PLAN = :flag
WHERE TASK_FEEDBACK_ID = :id
`.trim()

type Input = {
  vho_feedback_no: string
  plan_id: string
  session_id: string
  message_id: string
}

async function client() {
  const mod = (await import("oracledb")) as typeof import("oracledb") & { default?: typeof import("oracledb") }
  return mod.default ?? mod
}

export namespace TaskFeedbackService {
  export async function markAiPlan(input: Input) {
    const vho_feedback_no = input.vho_feedback_no.trim()
    if (!vho_feedback_no) return

    const db = await client()
    const conn = await db.getConnection({
      user,
      password,
      connectString,
    })

    try {
      const result = await conn.execute(
        stmt,
        {
          flag: 1,
          id: vho_feedback_no,
        },
        { autoCommit: true },
      )
      const rows = result.rowsAffected ?? 0
      if (rows === 1) {
        log.info("oracle ai plan updated", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: rows,
        })
        return
      }
      if (rows === 0) {
        log.warn("oracle ai plan feedback missing", {
          plan_id: input.plan_id,
          session_id: input.session_id,
          message_id: input.message_id,
          vho_feedback_no,
          rows_affected: rows,
        })
        return
      }
      log.warn("oracle ai plan updated unexpected row count", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        rows_affected: rows,
      })
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
    await markAiPlan(input).catch((error: unknown) => {
      log.error("oracle ai plan update failed", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no: input.vho_feedback_no.trim(),
        error,
      })
    })
  }
}
