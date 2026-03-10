import { describe, expect, test } from "bun:test"
import { feedbackCanOpen, feedbackPageName, feedbackPlatform } from "./feedback-helpers"

describe("feedbackCanOpen", () => {
  test("requires account session, feature flag, project context, and permission", () => {
    expect(
      feedbackCanOpen({
        enabled: true,
        authenticated: true,
        feedback_enabled: true,
        context_project_id: "project_1",
        permissions: ["feedback:create"],
      }),
    ).toBe(true)
    expect(
      feedbackCanOpen({
        enabled: true,
        authenticated: true,
        feedback_enabled: true,
        context_project_id: undefined,
        permissions: ["feedback:create"],
      }),
    ).toBe(false)
    expect(
      feedbackCanOpen({
        enabled: true,
        authenticated: true,
        feedback_enabled: false,
        context_project_id: "project_1",
        permissions: ["feedback:create"],
      }),
    ).toBe(false)
    expect(
      feedbackCanOpen({
        enabled: true,
        authenticated: true,
        feedback_enabled: true,
        context_project_id: "project_1",
        permissions: [],
      }),
    ).toBe(false)
  })
})

describe("feedbackPageName", () => {
  test("prefers title then path then fallback", () => {
    expect(feedbackPageName({ title: "  审批中心  ", path: "/approval" })).toBe("审批中心")
    expect(feedbackPageName({ title: "   ", path: "/approval" })).toBe("/approval")
    expect(feedbackPageName({ title: "   ", path: "   " })).toBe("当前页面")
  })
})

describe("feedbackPlatform", () => {
  test("switches at mobile breakpoint", () => {
    expect(feedbackPlatform(375)).toBe("mobile_web")
    expect(feedbackPlatform(768)).toBe("pc_web")
  })
})
