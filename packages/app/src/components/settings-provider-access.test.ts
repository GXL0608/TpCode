import { describe, expect, test } from "bun:test"
import { canViewReadonlySystemCandidates } from "./settings-provider-access"

describe("canViewReadonlySystemCandidates", () => {
  test("个人模型配置里只有超级管理员能看到系统候选只读信息", () => {
    expect(canViewReadonlySystemCandidates({ isSelf: true, roles: ["super_admin"] })).toBe(true)
    expect(canViewReadonlySystemCandidates({ isSelf: true, roles: ["agent:use_build"] })).toBe(false)
    expect(canViewReadonlySystemCandidates({ isSelf: true, roles: ["foo"] })).toBe(false)
  })

  test("全局配置页不受这个只读区块限制", () => {
    expect(canViewReadonlySystemCandidates({ isSelf: false, roles: [] })).toBe(false)
    expect(canViewReadonlySystemCandidates({ isSelf: false, roles: ["super_admin"] })).toBe(false)
  })
})
