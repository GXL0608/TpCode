import { describe, expect, test } from "bun:test"
import { workspaceLines, workspaceState } from "./session-header-workspace"

const base = {} as const

describe("workspaceState", () => {
  test("returns nothing before session metadata is loaded", () => {
    expect(
      workspaceState({
        session: undefined,
        directory: "/repo",
        projectRoot: "/repo",
      }),
    ).toBeUndefined()
  })

  test("shows main workspace when session has no isolated workspace", () => {
    expect(
      workspaceState({
        session: { ...base },
        directory: "/repo",
        projectRoot: "/repo",
      }),
    ).toEqual({
      tone: "neutral",
      label: "session.header.workspace.main",
    })
  })

  test("shows isolated workspace when current directory matches workspace directory", () => {
    expect(
      workspaceState({
        session: { ...base, workspaceDirectory: "/repo/.ws/ses_123", workspaceStatus: "ready" },
        directory: "/repo/.ws/ses_123",
        projectRoot: "/repo",
      }),
    ).toEqual({
      tone: "success",
      label: "session.header.workspace.isolated",
    })
  })

  test("shows preparing when isolated workspace is not ready", () => {
    expect(
      workspaceState({
        session: { ...base, workspaceDirectory: "/repo/.ws/ses_123", workspaceStatus: "pending" },
        directory: "/repo/.ws/ses_123",
        projectRoot: "/repo",
      }),
    ).toEqual({
      tone: "warning",
      label: "session.header.workspace.preparing",
    })
  })

  test("shows error when cleanup failed", () => {
    expect(
      workspaceState({
        session: {
          ...base,
          workspaceDirectory: "/repo/.ws/ses_123",
          workspaceStatus: "ready",
          workspaceCleanupStatus: "failed",
        },
        directory: "/repo/.ws/ses_123",
        projectRoot: "/repo",
      }),
    ).toEqual({
      tone: "error",
      label: "session.header.workspace.error",
    })
  })

  test("shows error when metadata exists but current directory is not isolated workspace", () => {
    expect(
      workspaceState({
        session: { ...base, workspaceDirectory: "/repo/.ws/ses_123", workspaceStatus: "ready" },
        directory: "/repo",
        projectRoot: "/repo",
      }),
    ).toEqual({
      tone: "error",
      label: "session.header.workspace.error",
    })
  })
})

describe("workspaceLines", () => {
  test("returns tooltip lines", () => {
    expect(
      workspaceLines({
        session: { ...base, workspaceBranch: "feat/demo", workspaceStatus: "ready" },
        directory: "/repo/.ws/ses_123",
        projectRoot: "/repo",
      }),
    ).toEqual({
      directory: "/repo/.ws/ses_123",
      projectRoot: "/repo",
      branch: "feat/demo",
      kind: undefined,
      summary: undefined,
      status: "ready",
    })
  })
})
