import { describe, expect, test } from "bun:test"
import { shouldResetAgentForFreshSession } from "./agent-reset"

describe("shouldResetAgentForFreshSession", () => {
  test("普通新会话入口仍然重置智能体", () => {
    expect(
      shouldResetAgentForFreshSession({
        session_id: undefined,
        has_prompt_handoff: false,
        has_vho_plan_handoff: false,
      }),
    ).toBe(true)
  })

  test("反馈回填的新会话入口保留 build 模式", () => {
    expect(
      shouldResetAgentForFreshSession({
        session_id: undefined,
        has_prompt_handoff: true,
        has_vho_plan_handoff: true,
      }),
    ).toBe(false)
  })
})
