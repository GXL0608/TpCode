import { describe, test, expect } from "bun:test"
import { BaseAgent } from "./base-agent"
import { AgentContext } from "./agent-context"

describe("BaseAgent", () => {
  test("should create agent with role", () => {
    const agent = new BaseAgent({
      role: "pm",
      name: "Product Manager",
      description: "Analyzes requirements",
    })

    expect(agent.role).toBe("pm")
    expect(agent.name).toBe("Product Manager")
  })

  test("should process message with context", async () => {
    const agent = new BaseAgent({
      role: "pm",
      name: "PM Agent",
      description: "Test agent",
    })

    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    const result = await agent.process({
      content: "Create a user management system",
      context,
    })

    expect(result).toBeDefined()
    expect(result.role).toBe("pm")
  })

  test("should maintain conversation history", async () => {
    const agent = new BaseAgent({
      role: "pm",
      name: "PM Agent",
      description: "Test agent",
    })

    const context = new AgentContext({
      sessionId: "test-session",
      userId: "test-user",
    })

    await agent.process({
      content: "First message",
      context,
    })

    await agent.process({
      content: "Second message",
      context,
    })

    expect(context.history.length).toBe(4)
  })
})
