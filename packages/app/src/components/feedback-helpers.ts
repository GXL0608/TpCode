export type FeedbackStatus = "open" | "processing" | "resolved"
export type FeedbackSourcePlatform = "pc_web" | "mobile_web"

export function feedbackCanOpen(input: {
  enabled: boolean
  authenticated: boolean
  feedback_enabled?: boolean
  context_project_id?: string
  permissions: string[]
}) {
  if (!input.enabled) return false
  if (!input.authenticated) return false
  if (!input.feedback_enabled) return false
  if (!input.context_project_id) return false
  return input.permissions.some((item) =>
    ["feedback:create", "feedback:reply", "feedback:resolve", "feedback:manage"].includes(item),
  )
}

export function feedbackPageName(input: { title?: string; path?: string }) {
  const title = input.title?.trim()
  if (title) return title
  const path = input.path?.trim()
  if (path) return path
  return "当前页面"
}

export function feedbackPlatform(width: number): FeedbackSourcePlatform {
  return width < 768 ? "mobile_web" : "pc_web"
}
