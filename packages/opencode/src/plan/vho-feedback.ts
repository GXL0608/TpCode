import { desc, eq, Database } from "@/storage/db"
import { TpSavedPlanTable } from "./saved-plan.sql"

const VHO_FEEDBACK_URL = "http://123.57.5.73:9527/prod-api/feedbackTask/umGetLoginAndFeedbackList"

type SearchQuery = {
  feedback_id?: string
  plan_id?: string
  feedback_des?: string
  resolution_status?: string
  plan_start_date?: string
  plan_end_date?: string
  page_num?: number
  page_size?: number
}

type SearchSuccess = {
  ok: true
  login_info: {
    user_id?: string
    user_name?: string
  }
  list: Array<{
    feedback_id: string
    plan_id?: string
    feedback_des?: string
    customer_name?: string
    feedback_time?: string
    resolution_status_name?: string
  }>
  total: number
  page_num: number
  page_size: number
}

type SearchFailure = {
  ok: false
  code:
    | "vho_feedback_phone_required"
    | "vho_feedback_upstream_request_failed"
    | "vho_feedback_upstream_invalid"
    | "vho_feedback_upstream_failed"
  message: string
}

type ResolveSuccess = {
  ok: true
  feedback_id?: string
  plan_id?: string
  feedback_des: string
  saved_plan_id: string
  plan_content: string
  matched_by: "plan_id" | "feedback_id"
  prompt_text: string
}

type ResolveFailure = {
  ok: false
  code: "vho_feedback_ref_missing" | "saved_plan_missing"
  message: string
}

/**
 * 中文注释：将反馈问题与计划内容组装为 prompt 输入框需要的双段文本。
 */
function promptText(input: { feedback_des?: string; plan_content: string }) {
  return `反馈问题：${input.feedback_des?.trim() ?? ""}\n\n计划内容：${input.plan_content}`
}

/**
 * 中文注释：把外部反馈列表项统一映射为前端可直接消费的结构。
 */
function item(row: Record<string, unknown>) {
  return {
    feedback_id: String(row.feedbackId ?? row.feedback_id ?? ""),
    plan_id: typeof row.planId === "string" ? row.planId : typeof row.plan_id === "string" ? row.plan_id : undefined,
    feedback_des:
      typeof row.feedbackDes === "string"
        ? row.feedbackDes
        : typeof row.feedback_des === "string"
          ? row.feedback_des
          : undefined,
    customer_name:
      typeof row.customerName === "string"
        ? row.customerName
        : typeof row.customer_name === "string"
          ? row.customer_name
          : undefined,
    feedback_time:
      typeof row.feedbackTime === "string"
        ? row.feedbackTime
        : typeof row.feedback_time === "string"
          ? row.feedback_time
          : undefined,
    resolution_status_name:
      typeof row.resolutionStatusName === "string"
        ? row.resolutionStatusName
        : typeof row.resolution_status_name === "string"
          ? row.resolution_status_name
          : undefined,
  }
}

/**
 * 中文注释：把外部返回中的 feedbackData 统一收敛为分页列表结构。
 */
function page(input: { data: unknown; page_num: number; page_size: number }) {
  if (Array.isArray(input.data)) {
    return {
      list: input.data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object").map(item),
      total: input.data.length,
      page_num: input.page_num,
      page_size: input.page_size,
    }
  }

  const value = input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {}
  const list = Array.isArray(value.list) ? value.list : []
  const total = typeof value.total === "number" ? value.total : list.length
  return {
    list: list.filter((row): row is Record<string, unknown> => !!row && typeof row === "object").map(item),
    total,
    page_num: input.page_num,
    page_size: input.page_size,
  }
}

/**
 * 中文注释：统一解析外部反馈接口的 JSON 响应，屏蔽字段大小写差异。
 */
async function parse(response: Response) {
  const body = (await response.json().catch(() => undefined)) as
    | {
        code?: number
        message?: string
        content?: {
          loginInfo?: Record<string, unknown>
          feedbackData?: unknown
        }
      }
    | undefined
  return body
}

export namespace VhoFeedbackService {
  /**
   * 中文注释：代理调用外部 VHO 反馈分页接口，并转换为内部统一结构。
   */
  export async function search(input: { phone?: string; query: SearchQuery }): Promise<SearchSuccess | SearchFailure> {
    const phone = input.phone?.trim()
    if (!phone) {
      return {
        ok: false,
        code: "vho_feedback_phone_required",
        message: "请先绑定手机号后再查询反馈任务。",
      }
    }

    const page_num = input.query.page_num && input.query.page_num > 0 ? input.query.page_num : 1
    const page_size = input.query.page_size && input.query.page_size > 0 ? input.query.page_size : 10

    const response = await fetch(VHO_FEEDBACK_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: phone,
        feedbackId: input.query.feedback_id?.trim() || undefined,
        planId: input.query.plan_id?.trim() || undefined,
        feedbackDes: input.query.feedback_des?.trim() || undefined,
        resolutionStatus: input.query.resolution_status?.trim() || undefined,
        planStartDate: input.query.plan_start_date?.trim() || undefined,
        planEndDate: input.query.plan_end_date?.trim() || undefined,
        pageNum: page_num,
        pageSize: page_size,
      }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((response) => ({ ok: true as const, response }))
      .catch((error: unknown) => ({ ok: false as const, error }))

    if (!response.ok) {
      return {
        ok: false,
        code: "vho_feedback_upstream_request_failed",
        message: response.error instanceof Error ? response.error.message : String(response.error),
      }
    }

    const body = await parse(response.response)
    if (!body) {
      return {
        ok: false,
        code: "vho_feedback_upstream_invalid",
        message: "VHO 反馈接口返回内容无法解析。",
      }
    }

    if (!response.response.ok || body.code !== 200) {
      return {
        ok: false,
        code: "vho_feedback_upstream_failed",
        message: body.message?.trim() || "VHO 反馈接口调用失败。",
      }
    }

    const info = body.content?.loginInfo ?? {}
    const result = page({
      data: body.content?.feedbackData,
      page_num,
      page_size,
    })

    return {
      ok: true,
      login_info: {
        user_id: typeof info.userId === "string" ? info.userId : undefined,
        user_name: typeof info.userName === "string" ? info.userName : undefined,
      },
      ...result,
    }
  }

  /**
   * 中文注释：根据计划 ID 或反馈号解析本地已保存计划，并返回 Prompt 回填内容。
   */
  export async function resolve(input: {
    feedback_id?: string
    plan_id?: string
    feedback_des?: string
  }): Promise<ResolveSuccess | ResolveFailure> {
    const plan_id = input.plan_id?.trim()
    const feedback_id = input.feedback_id?.trim()
    if (!plan_id && !feedback_id) {
      return {
        ok: false,
        code: "vho_feedback_ref_missing",
        message: "请选择反馈号或计划 ID 后再回填。",
      }
    }

    const direct = plan_id
      ? await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, plan_id)).get())
      : undefined
    if (direct) {
      return {
        ok: true,
        feedback_id,
        plan_id,
        feedback_des: input.feedback_des?.trim() ?? "",
        saved_plan_id: direct.id,
        plan_content: direct.plan_content,
        matched_by: "plan_id",
        prompt_text: promptText({
          feedback_des: input.feedback_des,
          plan_content: direct.plan_content,
        }),
      }
    }

    const fallback = feedback_id
      ? await Database.use((db) =>
          db
            .select()
            .from(TpSavedPlanTable)
            .where(eq(TpSavedPlanTable.vho_feedback_no, feedback_id))
            .orderBy(desc(TpSavedPlanTable.time_created))
            .get(),
        )
      : undefined
    if (!fallback) {
      return {
        ok: false,
        code: "saved_plan_missing",
        message: "未找到与该反馈关联的计划内容。",
      }
    }

    return {
      ok: true,
      feedback_id,
      plan_id: plan_id || fallback.id,
      feedback_des: input.feedback_des?.trim() ?? "",
      saved_plan_id: fallback.id,
      plan_content: fallback.plan_content,
      matched_by: "feedback_id",
      prompt_text: promptText({
        feedback_des: input.feedback_des,
        plan_content: fallback.plan_content,
      }),
    }
  }
}
