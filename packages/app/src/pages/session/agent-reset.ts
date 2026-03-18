/**
 * 中文注释：判断新会话路由进入时是否需要把当前智能体重置回默认态。
 */
export function shouldResetAgentForFreshSession(input: {
  session_id?: string
  has_prompt_handoff: boolean
  has_vho_plan_handoff: boolean
}) {
  if (input.session_id) return false
  if (input.has_prompt_handoff || input.has_vho_plan_handoff) return false
  return true
}
