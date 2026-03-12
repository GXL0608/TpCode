import { describe, expect, test } from "bun:test"
import { buildPlanFeedbackUrl, getPlanFeedbackPhoneIssue, hasPlanFeedbackPhone } from "./plan-feedback"

describe("buildPlanFeedbackUrl", () => {
  test("encodes phone and plan id into third-party feedback url", () => {
    expect(buildPlanFeedbackUrl({
      phone: "+86 13800138000",
      plan_id: "plan/123?x=1",
    })).toBe(
      "http://123.57.5.73:9527/#/ExternalCreateFeedback?userId=%2B86%2013800138000&planId=plan%2F123%3Fx%3D1",
    )
  })
})

describe("hasPlanFeedbackPhone", () => {
  test("requires a non-empty trimmed phone number", () => {
    expect(hasPlanFeedbackPhone("13800138000")).toBe(true)
    expect(hasPlanFeedbackPhone("   ")).toBe(false)
    expect(hasPlanFeedbackPhone(undefined)).toBe(false)
  })
})

describe("getPlanFeedbackPhoneIssue", () => {
  test("returns save-specific message key when phone is missing before save", () => {
    expect(getPlanFeedbackPhoneIssue({ phone: "   ", mode: "save" })).toBe("plan.feedback.toast.phoneRequiredToSave")
  })

  test("returns feedback-specific message key when phone is missing after save", () => {
    expect(getPlanFeedbackPhoneIssue({ phone: "", mode: "feedback" })).toBe("plan.feedback.toast.phoneRequired")
  })

  test("returns undefined when phone exists", () => {
    expect(getPlanFeedbackPhoneIssue({ phone: "13800138000", mode: "save" })).toBeUndefined()
  })
})
