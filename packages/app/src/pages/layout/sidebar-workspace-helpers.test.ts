import { describe, expect, test } from "bun:test"
import { workspaceOpenState, workspaceVisibleName } from "./sidebar-workspace-helpers"

describe("sidebar workspace helpers", () => {
  test("keeps local workspace expanded by default", () => {
    expect(workspaceOpenState({}, "/root", true)).toBe(true)
    expect(workspaceOpenState({}, "/sandbox", false)).toBe(false)
    expect(workspaceOpenState({ "/sandbox": true }, "/sandbox", false)).toBe(true)
  })

  test("shows local branch details", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/main",
        branch: "main",
        local: true,
      }),
    ).toBe("main")
  })

  test("falls back to local directory name when branch is missing", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/main",
        local: true,
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
      }),
    ).toBe("演示沙盒")
  })

  test("shows sandbox branch when alias is missing", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/worktree/demo",
        branch: "opencode/demo",
        local: false,
      }),
    ).toBe("opencode/demo")
  })

  test("falls back to sandbox directory name when alias and branch are missing", () => {
    expect(
      workspaceVisibleName({
        directory: "/repo/worktree/demo",
        local: false,
      }),
    ).toBe("demo")
  })
})
