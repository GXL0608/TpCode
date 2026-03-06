import { describe, test, expect } from "bun:test"
import { CoderAgent } from "./coder-agent"
import { AgentContext } from "./agent-context"

describe("CoderAgent", () => {
  test("should generate TypeScript code", async () => {
    const agent = new CoderAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    // 添加 Architect Agent 的输出
    context.addMessage({
      role: "architect",
      content: "架构设计完成",
      metadata: {
        databaseSchema: {
          tables: [
            {
              name: "queue",
              columns: [
                { name: "id", type: "text", primaryKey: true },
                { name: "status", type: "text" },
              ],
            },
          ],
        },
      },
    })

    const result = await agent.process({
      content: "生成 queue 表的 Drizzle schema",
      context,
    })

    expect(result.metadata?.generatedCode).toBeDefined()
    expect(result.metadata?.generatedCode.language).toBe("typescript")
    expect(result.metadata?.generatedCode.code).toContain("pgTable")
  })

  test("should generate API route handlers", async () => {
    const agent = new CoderAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    context.addMessage({
      role: "architect",
      content: "API 设计完成",
      metadata: {
        apiEndpoints: [
          {
            method: "POST",
            path: "/api/queue",
            description: "创建排队",
          },
        ],
      },
    })

    const result = await agent.process({
      content: "生成 POST /api/queue 的处理函数",
      context,
    })

    expect(result.metadata?.generatedCode).toBeDefined()
    expect(result.metadata?.generatedCode.code).toContain("async")
  })
})
