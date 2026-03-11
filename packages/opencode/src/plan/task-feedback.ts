import { Log } from "@/util/log"
import { ThirdPartyClient } from "@/third-party/client"
import { Database, eq } from "@/storage/db"
import { TpSavedPlanTable } from "./saved-plan.sql"

const log = Log.create({ service: "plan.task_feedback" })

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
      code: "third_party_feedback_update_failed"
      message: string
    }

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function body(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  return data as {
    code?: unknown
    message?: unknown
    content?: unknown
  }
}

async function synced(plan_id: string) {
  return Database.use((db) =>
    db
      .select({
        vho_synced: TpSavedPlanTable.vho_synced,
      })
      .from(TpSavedPlanTable)
      .where(eq(TpSavedPlanTable.id, plan_id))
      .get(),
  )
}

async function mark(plan_id: string) {
  await Database.use((db) =>
    db.update(TpSavedPlanTable)
      .set({
        vho_synced: 1,
        time_updated: Date.now(),
      })
      .where(eq(TpSavedPlanTable.id, plan_id))
      .run(),
  )
}

export namespace TaskFeedbackService {
  export async function markAiPlan(input: Input): Promise<Result> {
    const vho_feedback_no = input.vho_feedback_no.trim()
    if (!vho_feedback_no) return { ok: true as const }
    const row = await synced(input.plan_id)
    if (row?.vho_synced === 1) {
      log.info("third-party ai plan already synced", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
      })
      return { ok: true as const }
    }

    const result = await ThirdPartyClient.post("/feedbackTask/umUpdateHaveAiPlan", {
      feedbackId: vho_feedback_no,
    })
    if (!result.ok) {
      const extra = {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
      }
      if (result.code === "request_failed") log.error("third-party ai plan update failed", extra)
      else log.warn("third-party ai plan update invalid response", extra)
      return {
        ok: false as const,
        code: "third_party_feedback_update_failed",
        message: result.message,
      }
    }

    const payload = body(result.data)
    if (result.status < 200 || result.status >= 300 || payload?.code !== 200) {
      const message = typeof payload?.message === "string" && payload.message.trim()
        ? payload.message
        : `第三方接口返回异常状态: ${result.status}`
      log.warn("third-party ai plan update rejected", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no,
        status: result.status,
        error: message,
      })
      return {
        ok: false as const,
        code: "third_party_feedback_update_failed",
        message,
      }
    }
    await mark(input.plan_id)
    log.info("third-party ai plan updated", {
      plan_id: input.plan_id,
      session_id: input.session_id,
      message_id: input.message_id,
      vho_feedback_no,
    })
    return { ok: true as const }
  }

  export async function markAiPlanLater(input: Input) {
    return markAiPlan(input).catch((error: unknown) => {
      log.error("third-party ai plan update crashed", {
        plan_id: input.plan_id,
        session_id: input.session_id,
        message_id: input.message_id,
        vho_feedback_no: input.vho_feedback_no.trim(),
        error: detail(error),
      })
      return {
        ok: false as const,
        code: "third_party_feedback_update_failed",
        message: `第三方接口请求失败：${detail(error)}`,
      }
    })
  }
}
