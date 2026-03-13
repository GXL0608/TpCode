/**
 * 中文注释：判断当前智能体是否允许打开 VHO 反馈选择能力。
 */
export function canOpenVhoFeedback(input: { agent?: string }) {
  return input.agent === "build"
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
