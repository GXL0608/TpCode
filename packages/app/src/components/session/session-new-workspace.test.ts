import { describe, expect, test } from "bun:test"
import { newSessionWorkspaceState } from "./session-new-workspace"

describe("newSessionWorkspaceState", () => {
  test("shows main workspace in the project root", () => {
    expect(
      newSessionWorkspaceState({
        directory: "/repo",
        projectRoot: "/repo",
        agent: "plan",
      }),
    ).toEqual({
      label: "session.new.workspace.main",
      buildHint: undefined,
    })
  })

  test("shows shared workspace outside the project root", () => {
    expect(
      newSessionWorkspaceState({
        directory: "/repo/.opencode/worktrees/shared",
        projectRoot: "/repo",
        agent: "plan",
      }),
    ).toEqual({
      label: "session.new.workspace.shared",
      buildHint: undefined,
    })
  })

  test("shows build hint from the main workspace", () => {
    expect(
      newSessionWorkspaceState({
        directory: "/repo",
        projectRoot: "/repo",
        agent: "build",
      }),
    ).toEqual({
      label: "session.new.workspace.main",
      buildHint: "session.new.workspace.build.main",
    })
  })

  test("shows build hint from a shared workspace", () => {
    expect(
      newSessionWorkspaceState({
        directory: "/repo/.opencode/worktrees/shared",
        projectRoot: "/repo",
        agent: "build",
      }),
    ).toEqual({
      label: "session.new.workspace.shared",
      buildHint: "session.new.workspace.build.shared",
    })
  })
})
