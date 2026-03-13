import { describe, expect, test } from "bun:test"
import { buildVhoFeedbackPrompt, canOpenVhoFeedback, mergeVhoFeedbackPrompt } from "./vho-feedback"

describe("canOpenVhoFeedback", () => {
  test("only allows build mode", () => {
    expect(canOpenVhoFeedback({ agent: "build" })).toBe(true)
    expect(canOpenVhoFeedback({ agent: "plan" })).toBe(false)
    expect(canOpenVhoFeedback({ agent: undefined })).toBe(false)
  })
})

describe("buildVhoFeedbackPrompt", () => {
  test("formats feedback and plan with blank line separation", () => {
    expect(
      buildVhoFeedbackPrompt({
        feedback_des: "登录界面加载缓慢的问题",
        plan_content: "先排查接口，再优化缓存。",
      }),
    ).toBe("反馈问题：登录界面加载缓慢的问题\n\n计划内容：先排查接口，再优化缓存。")
  })
})

describe("mergeVhoFeedbackPrompt", () => {
  test("writes directly when draft is empty", () => {
    expect(
      mergeVhoFeedbackPrompt({
        current: "   ",
        next: "反馈问题：A\n\n计划内容：B",
      }),
    ).toEqual({
      ok: true,
      value: "反馈问题：A\n\n计划内容：B",
      needs_confirm: false,
    })
  })

  test("requires confirmation before overwriting non-empty draft", () => {
    let calls = 0
    const result = mergeVhoFeedbackPrompt({
      current: "已有草稿",
      next: "反馈问题：A\n\n计划内容：B",
      confirm: () => {
        calls += 1
        return false
      },
    })

    expect(result).toEqual({
      ok: false,
      value: "已有草稿",
      needs_confirm: true,
    })
    expect(calls).toBe(1)
  })

  test("overwrites when confirmation passes", () => {
    const result = mergeVhoFeedbackPrompt({
      current: "已有草稿",
      next: "反馈问题：A\n\n计划内容：B",
      confirm: () => true,
    })

    expect(result).toEqual({
      ok: true,
      value: "反馈问题：A\n\n计划内容：B",
      needs_confirm: true,
    })
  })
})
