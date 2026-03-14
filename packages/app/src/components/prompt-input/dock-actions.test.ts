import { describe, expect, test } from "bun:test"
import { buildPromptDockFlags } from "./dock-actions"

describe("buildPromptDockFlags", () => {
  test("keeps build mode feedback selection visible on new sessions", () => {
    expect(
      buildPromptDockFlags({
        agent: "build",
        session_id: undefined,
        can_select_runtime_model: false,
      }),
    ).toEqual({
      runtime_model: false,
      vho_feedback: true,
      build_package: true,
    })
  })

  test("hides feedback selection outside build mode", () => {
    expect(
      buildPromptDockFlags({
        agent: "plan",
        session_id: "session_1",
        can_select_runtime_model: true,
      }),
    ).toEqual({
      runtime_model: true,
      vho_feedback: false,
      build_package: false,
    })
  })
})
