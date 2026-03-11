import { describe, expect, test } from "bun:test"
import { filterRoles } from "./settings-users-filter"

const roles = [
  { id: "1", code: "developer", name: "研发工程师", permissions: [] },
  { id: "2", code: "pm", name: "项目经理", permissions: [] },
  { id: "3", code: "ops", name: "运维工程师", permissions: [] },
]

describe("filterRoles", () => {
  test("matches role name and code with trim and case-insensitive query", () => {
    expect(filterRoles(roles, "  研发  ").map((item) => item.code)).toEqual(["developer"])
    expect(filterRoles(roles, "PM").map((item) => item.code)).toEqual(["pm"])
  })

  test("returns all roles for empty query and no roles for misses", () => {
    expect(filterRoles(roles, "   ").map((item) => item.code)).toEqual(["developer", "pm", "ops"])
    expect(filterRoles(roles, "not-found")).toEqual([])
  })
})
