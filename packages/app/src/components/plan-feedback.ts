const base = "http://123.57.5.73:9527/#/ExternalCreateFeedback"

/**
 * 构建保存计划后的第三方反馈链接。
 */
export function buildPlanFeedbackUrl(input: { phone: string; plan_id: string }) {
  return `${base}?userId=${encodeURIComponent(input.phone)}&planId=${encodeURIComponent(input.plan_id)}`
}

/**
 * 判断当前用户是否具备打开第三方反馈页所需的手机号。
 */
export function hasPlanFeedbackPhone(phone?: string) {
  return !!phone?.trim()
}

/**
 * 返回计划保存/反馈流程中缺少手机号时应提示的文案 key。
 */
export function getPlanFeedbackPhoneIssue(input: { phone?: string; mode: "save" | "feedback" }) {
  if (hasPlanFeedbackPhone(input.phone)) return
  return input.mode === "save" ? "plan.feedback.toast.phoneRequiredToSave" : "plan.feedback.toast.phoneRequired"
}
