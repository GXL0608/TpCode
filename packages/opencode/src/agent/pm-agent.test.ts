import { describe, test, expect } from "bun:test"
import { PMAgent } from "./pm-agent"
import { AgentContext } from "./agent-context"

describe("PMAgent", () => {
  test("should analyze user requirements", async () => {
    const agent = new PMAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "我需要一个门诊排队叫号系统",
      context,
    })

    expect(result.content).toContain("需求分析")
    expect(result.metadata?.requirements).toBeDefined()
  })

  test("should extract user stories", async () => {
    const agent = new PMAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "患者可以查看排队进度，医生可以呼叫下一位患者",
      context,
    })

    expect(result.metadata?.userStories).toBeDefined()
    expect(result.metadata?.userStories.length).toBeGreaterThan(0)
  })

  test("should identify stakeholders", async () => {
    const agent = new PMAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "门诊医生、护士和患者都需要使用这个系统",
      context,
    })

    expect(result.metadata?.stakeholders).toBeDefined()
    expect(result.metadata?.stakeholders).toContain("医生")
    expect(result.metadata?.stakeholders).toContain("患者")
  })
})
