import { describe, expect, test } from "bun:test"
import {
  buildVhoFeedbackFilters,
  buildVhoFeedbackPrompt,
  canOpenVhoFeedback,
  findAssignedVhoProject,
  mergeVhoFeedbackPrompt,
  shouldShowVhoFeedbackAction,
  VHO_FEEDBACK_DIALOG_BODY_CLASS,
  VHO_FEEDBACK_FILTER_ACTIONS_CLASS,
  VHO_FEEDBACK_FOOTER_CLASS,
  VHO_FEEDBACK_LIST_SCROLL_CLASS,
  vhoFeedbackApplyFailure,
  vhoFeedbackTodayValue,
  vhoFeedbackResolutionKey,
  VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS,
  VHO_FEEDBACK_PAGE_SIZES,
  VHO_FEEDBACK_RESOLUTION_OPTIONS,
} from "./vho-feedback"
import { dict as zh } from "@/i18n/zh"
import { dict as en } from "@/i18n/en"

describe("canOpenVhoFeedback", () => {
  test("only allows build mode", () => {
    expect(canOpenVhoFeedback({ agent: "build" })).toBe(true)
    expect(canOpenVhoFeedback({ agent: "plan" })).toBe(false)
    expect(canOpenVhoFeedback({ agent: undefined })).toBe(false)
  })
})

describe("shouldShowVhoFeedbackAction", () => {
  test("keeps feedback action visible for build mode even on new sessions", () => {
    expect(
      shouldShowVhoFeedbackAction({
        agent: "build",
        session_id: undefined,
      }),
    ).toBe(true)
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

describe("vhoFeedbackResolutionKey", () => {
  test("maps resolution status enum values to translation keys", () => {
    expect(vhoFeedbackResolutionKey("0")).toBe("dialog.vhoFeedback.resolutionStatus.option.0")
    expect(vhoFeedbackResolutionKey("1")).toBe("dialog.vhoFeedback.resolutionStatus.option.1")
    expect(vhoFeedbackResolutionKey("9")).toBe("dialog.vhoFeedback.resolutionStatus.option.9")
    expect(vhoFeedbackResolutionKey("")).toBe("dialog.vhoFeedback.resolutionStatus.option.all")
  })
})

describe("VHO_FEEDBACK_RESOLUTION_OPTIONS", () => {
  test("exposes supported resolution status filters", () => {
    expect(VHO_FEEDBACK_RESOLUTION_OPTIONS).toEqual(["", "0", "1", "9"])
  })
})

describe("VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS", () => {
  test("defaults to unresolved and unmarked statuses", () => {
    expect(VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS).toEqual(["0", "9"])
  })
})

describe("VHO_FEEDBACK_PAGE_SIZES", () => {
  test("limits page size choices to approved values", () => {
    expect(VHO_FEEDBACK_PAGE_SIZES).toEqual([20, 50, 100, 500])
  })
})

describe("vhoFeedbackTodayValue", () => {
  test("formats date value for date inputs", () => {
    expect(vhoFeedbackTodayValue(new Date("2026-03-13T09:30:00+08:00"))).toBe("2026-03-13")
  })
})

describe("buildVhoFeedbackFilters", () => {
  test("returns default filters used for auto search and reset", () => {
    expect(buildVhoFeedbackFilters("2026-03-13")).toEqual({
      user_id: "",
      feedback_id: "",
      plan_id: "",
      feedback_des: "",
      resolution_status: ["0", "9"],
      plan_start_date: "2026-03-13",
      plan_end_date: "2026-03-13",
      page_num: 1,
      page_size: 50,
      total: 0,
      list: [],
      error: "",
    })
  })
})

describe("findAssignedVhoProject", () => {
  test("matches assigned product by project id and worktree together", () => {
    expect(
      findAssignedVhoProject({
        project_id: "project_1",
        project_worktree: "/tmp/project-1",
        products: [
          { id: "p1", project_id: "project_1", worktree: "/tmp/project-1" },
          { id: "p2", project_id: "project_1", worktree: "/tmp/project-2" },
        ],
      }),
    ).toEqual({
      id: "p1",
      project_id: "project_1",
      worktree: "/tmp/project-1",
    })
  })

  test("returns nothing when assignment is missing", () => {
    expect(
      findAssignedVhoProject({
        project_id: "project_1",
        project_worktree: "/tmp/project-1",
        products: [{ id: "p2", project_id: "project_2", worktree: "/tmp/project-1" }],
      }),
    ).toBeUndefined()
  })
})

describe("vhoFeedbackApplyFailure", () => {
  test("returns dialog-safe messages for cross-project fill failures", () => {
    expect(
      vhoFeedbackApplyFailure({
        reason: "products_failed",
      }),
    ).toEqual({
      ok: false,
      message: "当前账号产品信息获取失败，请稍后重试。",
    })

    expect(
      vhoFeedbackApplyFailure({
        reason: "project_missing",
      }),
    ).toEqual({
      ok: false,
      message: "当前账号未分配该项目，请联系管理员维护产品。",
    })

    expect(
      vhoFeedbackApplyFailure({
        reason: "project_activate_failed",
      }),
    ).toEqual({
      ok: false,
      message: "无法切换到目标项目，请联系管理员检查项目路径。",
    })
  })
})

describe("vho feedback dialog layout classes", () => {
  test("supports mobile body scrolling and desktop list scrolling", () => {
    expect(VHO_FEEDBACK_DIALOG_BODY_CLASS).toContain("overflow-y-auto")
    expect(VHO_FEEDBACK_DIALOG_BODY_CLASS).toContain("md:overflow-hidden")
    expect(VHO_FEEDBACK_LIST_SCROLL_CLASS).toContain("overflow-y-auto")
    expect(VHO_FEEDBACK_LIST_SCROLL_CLASS).toContain("md:h-full")
    expect(VHO_FEEDBACK_FOOTER_CLASS).toContain("sticky")
    expect(VHO_FEEDBACK_FOOTER_CLASS).toContain("md:static")
    expect(VHO_FEEDBACK_FOOTER_CLASS).toContain("safe-area-inset-bottom")
  })

  test("reserves an actions row under filters", () => {
    expect(VHO_FEEDBACK_FILTER_ACTIONS_CLASS).toContain("justify-end")
  })
})

describe("vho feedback translations", () => {
  test("uses reporter phone placeholder in chinese and english", () => {
    expect(zh["dialog.vhoFeedback.userId"]).toBe("反馈人手机号")
    expect(en["dialog.vhoFeedback.userId"]).toBe("Reporter phone number")
  })

  test("includes project-switch success copy", () => {
    expect(zh["dialog.vhoFeedback.select.successProject"]).toBe("已切换到目标项目并回填反馈内容")
    expect(en["dialog.vhoFeedback.select.successProject"]).toBe(
      "Switched to the target project and filled the feedback",
    )
  })

  test("includes labels for primary feedback fields", () => {
    expect(zh["dialog.vhoFeedback.product"]).toBe("产品")
    expect(zh["dialog.vhoFeedback.module"]).toBe("模块")
    expect(zh["dialog.vhoFeedback.function"]).toBe("功能")
    expect(zh["dialog.vhoFeedback.feedbackUser"]).toBe("反馈人")
    expect(zh["dialog.vhoFeedback.rdTaskStatus"]).toBe("研发状态")
    expect(zh["dialog.vhoFeedback.demandType"]).toBe("需求类型")
  })
})
