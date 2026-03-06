import { describe, test, expect } from "bun:test"
import { ReviewerAgent } from "./reviewer-agent"
import { AgentContext } from "./agent-context"

describe("ReviewerAgent", () => {
  test("should identify code issues", async () => {
    const agent = new ReviewerAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    // 添加 Coder Agent 的输出
    context.addMessage({
      role: "coder",
      content: "代码生成完成",
      metadata: {
        generatedCode: {
          language: "typescript",
          code: `async function createUser(data: any) {
  const user = await db.insert(userTable).values(data)
  return user
}`,
          filePath: "src/user/service.ts",
          description: "用户创建服务",
        },
      },
    })

    const result = await agent.process({
      content: "请审查生成的代码",
      context,
    })

    expect(result.metadata?.issues).toBeDefined()
    expect(result.metadata?.issues.length).toBeGreaterThan(0)
    expect(result.metadata?.score).toBeDefined()
  })

  test("should suggest improvements", async () => {
    const agent = new ReviewerAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    context.addMessage({
      role: "coder",
      content: "代码生成完成",
      metadata: {
        generatedCode: {
          language: "typescript",
          code: `function calculate(a, b) {
  return a + b
}`,
          filePath: "src/utils/math.ts",
          description: "计算函数",
        },
      },
    })

    const result = await agent.process({
      content: "请提供改进建议",
      context,
    })

    expect(result.metadata?.suggestions).toBeDefined()
    expect(result.metadata?.suggestions.length).toBeGreaterThan(0)
  })

  test("should check for security vulnerabilities", async () => {
    const agent = new ReviewerAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    context.addMessage({
      role: "coder",
      content: "代码生成完成",
      metadata: {
        generatedCode: {
          language: "typescript",
          code: `async function getUser(id: string) {
  const query = \`SELECT * FROM users WHERE id = '\${id}'\`
  return await db.execute(query)
}`,
          filePath: "src/user/service.ts",
          description: "用户查询服务",
        },
      },
    })

    const result = await agent.process({
      content: "检查安全漏洞",
      context,
    })

    expect(result.metadata?.issues).toBeDefined()
    const securityIssues = result.metadata?.issues.filter(
      (issue: any) => issue.type === "security"
    )
    expect(securityIssues.length).toBeGreaterThan(0)
    expect(securityIssues[0].severity).toBe("critical")
  })
})
