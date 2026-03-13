/**
 * 中文注释：判断当前智能体是否允许打开 VHO 反馈选择能力。
 */
export function canOpenVhoFeedback(input: { agent?: string }) {
  return input.agent === "build"
}

/**
 * 中文注释：统一计算“选择反馈”按钮是否显示，新建会话与已有会话保持同一规则。
 */
export function shouldShowVhoFeedbackAction(input: { agent?: string; session_id?: string }) {
  return canOpenVhoFeedback({
    agent: input.agent,
  })
}

/**
 * 中文注释：定义 VHO 反馈列表支持的解决状态筛选枚举值。
 */
export const VHO_FEEDBACK_RESOLUTION_OPTIONS = ["", "0", "1", "9"] as const
export const VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS = ["0", "9"] as const
export const VHO_FEEDBACK_PAGE_SIZES = [20, 50, 100, 500] as const
export const VHO_FEEDBACK_DIALOG_BODY_CLASS =
  "flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-3 pb-3 md:overflow-hidden md:px-4 md:pb-4"
export const VHO_FEEDBACK_LIST_SCROLL_CLASS = "max-h-[50vh] overflow-y-auto md:h-full"
export const VHO_FEEDBACK_FOOTER_CLASS =
  "sticky bottom-0 z-10 -mx-3 mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] md:static md:mx-0 md:flex-nowrap md:shrink-0 md:px-1 md:pt-3 md:pb-0"
export const VHO_FEEDBACK_FILTER_ACTIONS_CLASS = "flex items-center justify-end gap-2"

type Filters = {
  user_id: string
  feedback_id: string
  plan_id: string
  feedback_des: string
  resolution_status: Array<"0" | "1" | "9">
  plan_start_date: string
  plan_end_date: string
  page_num: number
  page_size: number
  total: number
  list: Array<Record<string, unknown>>
  error: string
}

type AssignedProject = {
  id: string
  project_id: string
  worktree: string
}

export type VhoFeedbackApplyResult =
  | {
      ok: true
    }
  | {
      ok: false
      message: string
    }

/**
 * 中文注释：把解决状态枚举值映射为国际化文案 key。
 */
export function vhoFeedbackResolutionKey(input: (typeof VHO_FEEDBACK_RESOLUTION_OPTIONS)[number]) {
  if (input === "0") return "dialog.vhoFeedback.resolutionStatus.option.0"
  if (input === "1") return "dialog.vhoFeedback.resolutionStatus.option.1"
  if (input === "9") return "dialog.vhoFeedback.resolutionStatus.option.9"
  return "dialog.vhoFeedback.resolutionStatus.option.all"
}

/**
 * 中文注释：把当前日期转换为日期输入框可直接使用的 yyyy-MM-dd 文本。
 */
export function vhoFeedbackTodayValue(input = new Date()) {
  const year = input.getFullYear()
  const month = String(input.getMonth() + 1).padStart(2, "0")
  const day = String(input.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * 中文注释：生成反馈弹窗默认筛选值，供首次自动查询和重置动作复用。
 */
export function buildVhoFeedbackFilters(today: string): Filters {
  return {
    user_id: "",
    feedback_id: "",
    plan_id: "",
    feedback_des: "",
    resolution_status: [...VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS],
    plan_start_date: today,
    plan_end_date: today,
    page_num: 1,
    page_size: 50,
    total: 0,
    list: [],
    error: "",
  }
}

/**
 * 中文注释：按 project_id 和 worktree 双条件匹配当前账号已分配的目标项目。
 */
export function findAssignedVhoProject(input: {
  project_id?: string
  project_worktree?: string
  products: AssignedProject[]
}) {
  const project_id = input.project_id?.trim()
  const project_worktree = input.project_worktree?.trim()
  if (!project_id || !project_worktree) return
  return input.products.find((item) => item.project_id === project_id && item.worktree === project_worktree)
}

/**
 * 中文注释：把跨项目回填过程中的失败原因统一转换成弹窗内可展示的错误结果。
 */
export function vhoFeedbackApplyFailure(input: {
  reason: "products_failed" | "project_missing" | "project_activate_failed"
}): VhoFeedbackApplyResult {
  if (input.reason === "products_failed") {
    return {
      ok: false,
      message: "当前账号产品信息获取失败，请稍后重试。",
    }
  }

  if (input.reason === "project_activate_failed") {
    return {
      ok: false,
      message: "无法切换到目标项目，请联系管理员检查项目路径。",
    }
  }

  return {
    ok: false,
    message: "当前账号未分配该项目，请联系管理员维护产品。",
  }
}

/**
 * 中文注释：把反馈问题与计划内容格式化成写入输入框的标准文本。
 */
export function buildVhoFeedbackPrompt(input: { feedback_des?: string; plan_content: string }) {
  return `反馈问题：${input.feedback_des?.trim() ?? ""}\n\n计划内容：${input.plan_content}`
}

/**
 * 中文注释：根据当前草稿和确认结果决定是否覆盖输入框内容。
 */
export function mergeVhoFeedbackPrompt(input: {
  current: string
  next: string
  confirm?: (message: string) => boolean
}) {
  if (!input.current.trim()) {
    return {
      ok: true as const,
      value: input.next,
      needs_confirm: false,
    }
  }

  const accepted = input.confirm?.("当前输入框已有内容，确认使用反馈内容覆盖吗？") ?? false
  if (!accepted) {
    return {
      ok: false as const,
      value: input.current,
      needs_confirm: true,
    }
  }

  return {
    ok: true as const,
    value: input.next,
    needs_confirm: true,
  }
}
