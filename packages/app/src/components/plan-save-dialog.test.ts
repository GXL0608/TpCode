import { describe, expect, test } from "bun:test"
import { buildPlanSaveFeedbackQuery, resolvePlanSaveFeedbackNo } from "./plan-save-dialog"

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
})
