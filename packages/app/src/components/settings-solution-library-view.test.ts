import { describe, expect, test } from "bun:test"
import {
  createSolutionDraft,
  filterNamedSolutions,
  solutionLibraryItemClass,
  solutionLibraryLayoutClass,
  solutionLibrarySubmitDisabled,
  sortNamedSolutions,
  syncSolutionLibrarySelection,
  validateSolutionDraft,
} from "./settings-solution-library-view"

const solutions = [
  { id: "solution-a", name: "医保方案" },
  { id: "solution-b", name: "电子病历方案" },
  { id: "solution-c", name: "AAA方案" },
]

describe("settings-solution-library-view", () => {
  test("在当前选中方案不存在时回退到首个方案", () => {
    expect(syncSolutionLibrarySelection(solutions, "")).toBe("solution-a")
    expect(syncSolutionLibrarySelection(solutions, "missing")).toBe("solution-a")
    expect(syncSolutionLibrarySelection(solutions, "solution-b")).toBe("solution-b")
    expect(syncSolutionLibrarySelection([], "missing")).toBe("")
  })

  test("为方案库返回适合设置弹窗的左右布局类名", () => {
    expect(solutionLibraryLayoutClass()).toContain("lg:grid-cols-[280px_minmax(0,1fr)]")
    expect(solutionLibraryLayoutClass()).not.toContain("xl:grid-cols")
  })

  test("选中方案时返回高亮样式，未选中时保留悬浮反馈", () => {
    expect(solutionLibraryItemClass(true)).toContain("border-brand-solid")
    expect(solutionLibraryItemClass(false)).toContain("hover:bg-surface-panel/60")
  })

  test("新增方案默认草稿应生成可提交的编译配置与源码目录", () => {
    const draft = createSolutionDraft({
      id: "product-a",
      name: "产品A",
      project_id: "project-a",
      worktree: "Y:\\source\\product-a",
    })

    const build_profile = JSON.parse(draft.build_profile_text)
    const roots = JSON.parse(draft.roots_text)

    expect(draft.product_id).toBe("product-a")
    expect(draft.project_id).toBe("project-a")
    expect(build_profile.compile_command).toBe("echo build")
    expect(build_profile.workdirs).toEqual(["product-a"])
    expect(roots).toEqual([
      {
        root_type: "single_repo",
        directory: "Y:\\source\\product-a",
        display_name: "产品A",
        mount_name: "product-a",
        sort_order: 0,
        enabled: true,
      },
    ])
    expect(validateSolutionDraft(build_profile, roots)).toBe("")
  })

  test("按名称排序方案导航并支持名称检索", () => {
    expect(sortNamedSolutions(solutions).map((item) => item.name)).toEqual(["AAA方案", "电子病历方案", "医保方案"])
    expect(filterNamedSolutions(solutions, "病历").map((item) => item.name)).toEqual(["电子病历方案"])
    expect(filterNamedSolutions(solutions, "aaa").map((item) => item.name)).toEqual(["AAA方案"])
    expect(filterNamedSolutions(solutions, "").map((item) => item.name)).toEqual(["AAA方案", "电子病历方案", "医保方案"])
  })

  test("解决方案保存按钮不再依赖兼容归属产品字段", () => {
    expect(solutionLibrarySubmitDisabled({ pending: false, name: "前端方案", code: "frontend" })).toBe(false)
    expect(solutionLibrarySubmitDisabled({ pending: true, name: "前端方案", code: "frontend" })).toBe(true)
    expect(solutionLibrarySubmitDisabled({ pending: false, name: "", code: "frontend" })).toBe(true)
    expect(solutionLibrarySubmitDisabled({ pending: false, name: "前端方案", code: "" })).toBe(true)
  })
})
