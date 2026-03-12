import { describe, expect, test } from "bun:test"
import * as mod from "./settings-users-filter"

const roles = [
  { id: "1", code: "developer", name: "研发工程师", permissions: [] },
  { id: "2", code: "pm", name: "项目经理", permissions: [] },
  { id: "3", code: "ops", name: "运维工程师", permissions: [] },
]

describe("filterRoles", () => {
  test("matches role name and code with trim and case-insensitive query", () => {
    expect(mod.filterRoles(roles, "  研发  ").map((item) => item.code)).toEqual(["developer"])
    expect(mod.filterRoles(roles, "PM").map((item) => item.code)).toEqual(["pm"])
  })

  test("returns all roles for empty query and no roles for misses", () => {
    expect(mod.filterRoles(roles, "   ").map((item) => item.code)).toEqual(["developer", "pm", "ops"])
    expect(mod.filterRoles(roles, "not-found")).toEqual([])
  })
})

describe("summarizeRoles", () => {
  test("returns placeholder when nothing is selected", () => {
    const summarizeRoles = (mod as Record<string, unknown>).summarizeRoles as undefined | ((codes: string[], names: string[]) => string)

    expect(typeof summarizeRoles).toBe("function")
    expect(summarizeRoles?.([], [])).toBe("请选择初始角色")
  })

  test("returns count and first two role names when items are selected", () => {
    const summarizeRoles = (mod as Record<string, unknown>).summarizeRoles as undefined | ((codes: string[], names: string[]) => string)

    expect(typeof summarizeRoles).toBe("function")
    expect(summarizeRoles?.(["developer"], ["研发工程师"])).toBe("已选 1 项：研发工程师")
    expect(summarizeRoles?.(["developer", "pm"], ["研发工程师", "项目经理"])).toBe("已选 2 项：研发工程师、项目经理")
    expect(summarizeRoles?.(["developer", "pm", "ops"], ["研发工程师", "项目经理", "运维工程师"])).toBe(
      "已选 3 项：研发工程师、项目经理…",
    )
  })
})
