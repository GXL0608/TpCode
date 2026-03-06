import { describe, test, expect } from "bun:test"
import { QAAgent } from "./qa-agent"
import { AgentContext } from "./agent-context"

describe("QAAgent", () => {
  test("should calculate quality score", async () => {
    const agent = new QAAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    // 添加完整的智能体链输出
    context.addMessage({
      role: "pm",
      content: "需求分析",
      metadata: { requirements: [{ id: "req-1" }] },
    })
    context.addMessage({
      role: "architect",
      content: "架构设计",
      metadata: { databaseSchema: { tables: [] } },
    })
    context.addMessage({
      role: "coder",
      content: "代码生成",
      metadata: { generatedCode: { code: "..." } },
    })
    context.addMessage({
      role: "reviewer",
      content: "代码审查",
      metadata: { overallScore: 85, approved: true },
    })

    const result = await agent.process({
      content: "评估整体质量",
      context,
    })

    expect(result.metadata?.qualityScore).toBeDefined()
    expect(result.metadata?.qualityScore.overall).toBeGreaterThan(0)
  })

  test("should evaluate requirement coverage", async () => {
    const agent = new QAAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "评估需求覆盖率",
      context,
    })

    expect(result.metadata?.qualityScore?.requirementCoverage).toBeDefined()
  })

  test("should assess maintainability", async () => {
    const agent = new QAAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "评估可维护性",
      context,
    })

    expect(result.metadata?.qualityScore?.maintainability).toBeDefined()
  })

  test("should determine production readiness", async () => {
    const agent = new QAAgent()
    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    // 高质量场景 - 添加完整的智能体链输出
    context.addMessage({
      role: "pm",
      content: "需求分析",
      metadata: { requirements: [{ id: "req-1" }], summary: "完整需求" },
    })
    context.addMessage({
      role: "architect",
      content: "架构设计",
      metadata: { techStack: { backend: ["Bun"] }, summary: "架构设计" },
    })
    context.addMessage({
      role: "coder",
      content: "代码生成",
      metadata: {
        generatedCode: {
          code: "export function test() { return true }",
          description: "测试代码",
        },
        testCode: { code: "test code" },
      },
    })
    context.addMessage({
      role: "reviewer",
      content: "审查完成",
      metadata: {
        overallScore: 95,
        securityIssues: [],
        approved: true,
      },
    })

    const result = await agent.process({
      content: "判断是否可以投入生产",
      context,
    })

    expect(result.metadata?.readyForProduction).toBe(true)
  })
})
