import { describe, test, expect } from "bun:test"
import { ArchitectAgent } from "./architect-agent"
import { AgentContext } from "./agent-context"

describe("ArchitectAgent", () => {
  test("should design database schema", async () => {
    const agent = new ArchitectAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    // 添加 PM Agent 的输出作为上下文
    context.addMessage({
      role: "pm",
      content: "需求分析完成",
      metadata: {
        requirements: [
          { id: "req-1", description: "患者排队管理", priority: "high" },
        ],
      },
    })

    const result = await agent.process({
      content: "请设计数据库架构",
      context,
    })

    expect(result.metadata?.databaseSchema).toBeDefined()
    expect(result.metadata?.databaseSchema.tables).toBeDefined()
  })

  test("should design API endpoints", async () => {
    const agent = new ArchitectAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "设计 RESTful API",
      context,
    })

    expect(result.metadata?.apiEndpoints).toBeDefined()
    expect(result.metadata?.apiEndpoints.length).toBeGreaterThan(0)
  })

  test("should recommend tech stack", async () => {
    const agent = new ArchitectAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "推荐技术栈",
      context,
    })

    expect(result.metadata?.techStack).toBeDefined()
    expect(result.metadata?.techStack.backend).toBeDefined()
    expect(result.metadata?.techStack.frontend).toBeDefined()
  })
})
