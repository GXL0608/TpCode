import { describe, test, expect } from "bun:test"
import { AgentOrchestrator } from "./agent-orchestrator"
import { AgentContext } from "./agent-context"

describe("AgentOrchestrator", () => {
  test("should process requirement through all agents", async () => {
    const orchestrator = new AgentOrchestrator()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await orchestrator.processRequirement(
      "创建一个门诊排队叫号系统",
      context
    )

    expect(result.pm).toBeDefined()
    expect(result.architect).toBeDefined()
    expect(result.coder).toBeDefined()
    expect(result.reviewer).toBeDefined()
    expect(result.qa).toBeDefined()
    expect(result.qa.metadata?.qualityScore).toBeDefined()
  })
})
