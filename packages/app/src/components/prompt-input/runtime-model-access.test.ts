import { describe, expect, test } from "bun:test"
import { canUseRuntimeModelSelector } from "./runtime-model-access"

describe("canUseRuntimeModelSelector", () => {
  test("只根据 build 权限决定显示，不受当前 agent 名称影响", () => {
    expect(canUseRuntimeModelSelector({ hasBuild: true, isSuperAdmin: false, agent: "build" })).toBe(true)
    expect(canUseRuntimeModelSelector({ hasBuild: true, isSuperAdmin: false, agent: "plan" })).toBe(true)
    expect(canUseRuntimeModelSelector({ hasBuild: false, isSuperAdmin: false, agent: "build" })).toBe(false)
    expect(canUseRuntimeModelSelector({ hasBuild: false, isSuperAdmin: false, agent: "plan" })).toBe(false)
  })

  test("超级管理员即使权限数组未展开也应显示选择器", () => {
    expect(canUseRuntimeModelSelector({ hasBuild: false, isSuperAdmin: true, agent: "plan" })).toBe(true)
  })
})
