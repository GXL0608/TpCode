import { describe, expect, test } from "bun:test"
import { buildCreateUserBody, resolveRoleNames, summarizeRolePicker } from "./settings-users-role-picker"

const roles = [
  { id: "1", code: "developer", name: "研发工程师", permissions: [] },
  { id: "2", code: "pm", name: "项目经理", permissions: [] },
  { id: "3", code: "ops", name: "运维工程师", permissions: [] },
]

describe("settings users role picker helpers", () => {
  test("summarizes role picker placeholder and selected names", () => {
    expect(summarizeRolePicker([], roles)).toBe("请选择初始角色")
    expect(summarizeRolePicker(["developer"], roles)).toBe("已选 1 项：研发工程师")
    expect(summarizeRolePicker(["developer", "pm"], roles)).toBe("已选 2 项：研发工程师、项目经理")
    expect(summarizeRolePicker(["developer", "pm", "ops"], roles)).toBe("已选 3 项：研发工程师、项目经理…")
  })

  test("falls back to builtin zh role name when role catalog misses one item", () => {
    expect(resolveRoleNames(["super_admin"], roles)).toEqual(["超级管理员"])
  })

  test("keeps empty role_codes after clearing selections when caller can manage roles", () => {
    expect(
      buildCreateUserBody({
        username: " test_user ",
        password: "TpCode2026",
        display_name: " 测试用户 ",
        phone: " 13800138000 ",
        account_type: "internal",
        org_id: "org_1",
        can_role: true,
        role_codes: [],
      }),
    ).toEqual({
      username: "test_user",
      password: "TpCode2026",
      display_name: "测试用户",
      phone: "13800138000",
      account_type: "internal",
      org_id: "org_1",
      role_codes: [],
      force_password_reset: true,
    })
  })

  test("omits role_codes when current user has no role management permission", () => {
    expect(
      buildCreateUserBody({
        username: "test_user",
        password: "TpCode2026",
        display_name: "",
        phone: "13800138000",
        account_type: "internal",
        org_id: "org_1",
        can_role: false,
        role_codes: ["developer"],
      }),
    ).toEqual({
      username: "test_user",
      password: "TpCode2026",
      display_name: undefined,
      phone: "13800138000",
      account_type: "internal",
      org_id: "org_1",
      role_codes: undefined,
      force_password_reset: true,
    })
  })
})
