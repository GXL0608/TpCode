import { describe, expect, test } from "bun:test"
import {
  buildPlanSaveFeedbackQuery,
  PLAN_SAVE_DIALOG_BODY_CLASS,
  PLAN_SAVE_DIALOG_FOOTER_CLASS,
  PLAN_SAVE_DIALOG_LIST_CLASS,
  resolvePlanSaveFeedbackNo,
} from "./plan-save-dialog"

describe("plan-save-dialog helpers", () => {
  test("用手机号生成保存计划弹窗的默认反馈查询条件", () => {
    expect(buildPlanSaveFeedbackQuery("15801507527")).toEqual({
      user_id: "15801507527",
      page_num: 1,
      page_size: 20,
      resolution_status: ["0", "9"],
    })
  })

  test("优先使用手工填写的反馈号，否则回退到列表选择结果", () => {
    expect(resolvePlanSaveFeedbackNo({ manual: "  VHO-123  ", selected: "VHO-456" })).toBe("VHO-123")
    expect(resolvePlanSaveFeedbackNo({ manual: "   ", selected: "VHO-456" })).toBe("VHO-456")
    expect(resolvePlanSaveFeedbackNo({ manual: "", selected: "" })).toBeUndefined()
  })

  test("弹窗内容区和底部按钮区保持固定布局，长列表时仍可操作保存按钮", () => {
    expect(PLAN_SAVE_DIALOG_BODY_CLASS).toContain("max-h-[min(70vh,640px)]")
    expect(PLAN_SAVE_DIALOG_BODY_CLASS).toContain("min-h-0")
    expect(PLAN_SAVE_DIALOG_LIST_CLASS).toContain("flex-1")
    expect(PLAN_SAVE_DIALOG_LIST_CLASS).toContain("overflow-y-auto")
    expect(PLAN_SAVE_DIALOG_FOOTER_CLASS).toContain("sticky")
    expect(PLAN_SAVE_DIALOG_FOOTER_CLASS).toContain("shrink-0")
    expect(PLAN_SAVE_DIALOG_FOOTER_CLASS).toContain("safe-area-inset-bottom")
  })
})
