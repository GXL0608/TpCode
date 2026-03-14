import { shouldShowVhoFeedbackAction } from "../vho-feedback"

/**
 * 中文注释：统一计算会话输入框底部操作栏的能力显隐，避免 build 模式特殊入口在重构时被遗漏。
 */
export function buildPromptDockFlags(input: {
  agent?: string
  session_id?: string
  can_select_runtime_model: boolean
}) {
  return {
    runtime_model: input.can_select_runtime_model,
    vho_feedback: shouldShowVhoFeedbackAction({
      agent: input.agent,
      session_id: input.session_id,
    }),
  }
}
