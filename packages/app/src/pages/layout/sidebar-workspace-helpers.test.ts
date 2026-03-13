import { describe, expect, test } from "bun:test"
import { workspaceOpenState, workspaceVisibleName } from "./sidebar-workspace-helpers"

describe("sidebar workspace helpers", () => {
  test("keeps local workspace expanded by default", () => {
    expect(workspaceOpenState({}, "/root", true)).toBe(true)
    expect(workspaceOpenState({}, "/sandbox", false)).toBe(false)
    expect(workspaceOpenState({ "/sandbox": true }, "/sandbox", false)).toBe(true)
  })

  test("hides local branch details for ordinary users", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/main",
        branch: "main",
        local: true,
        superAdmin: false,
      }),
    ).toBeUndefined()
  })

  test("shows local branch details for super admins", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/main",
        branch: "main",
        local: true,
        superAdmin: true,
      }),
    ).toBe("main")
  })

  test("prefers alias for sandbox workspaces", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/worktree/demo",
        branch: "opencode/demo",
        alias: "演示沙盒",
        local: false,
        superAdmin: false,
      }),
    ).toBe("演示沙盒")
  })

  test("falls back to sandbox name instead of branch for ordinary users", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/worktree/demo",
        branch: "opencode/demo",
        local: false,
        superAdmin: false,
      }),
    ).toBe("demo")
  })
})
