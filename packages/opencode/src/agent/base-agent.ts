import { AgentContext } from "./agent-context"

export interface BaseAgentConfig {
  role: string
  name: string
  description: string
  systemPrompt?: string
}

export interface AgentProcessInput {
  content: string
  context: AgentContext
}

export interface AgentProcessOutput {
  role: string
  content: string
  metadata?: Record<string, any>
}

export class BaseAgent {
  public readonly role: string
  public readonly name: string
  public readonly description: string
  protected readonly systemPrompt: string

  constructor(config: BaseAgentConfig) {
    this.role = config.role
    this.name = config.name
    this.description = config.description
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt()
  }

  async process(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 添加用户消息到上下文
    input.context.addMessage({
      role: "user",
      content: input.content,
    })

    // 生成响应（基础实现，子类可以覆盖）
    const response = await this.generateResponse(input)

    // 添加智能体响应到上下文
    input.context.addMessage({
      role: this.role,
      content: response.content,
      metadata: response.metadata,
    })

    return response
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 基础实现：简单回显
    // 子类应该覆盖此方法以实现实际的 AI 逻辑
    return {
      role: this.role,
      content: `[${this.name}] Processed: ${input.content}`,
      metadata: {
        timestamp: Date.now(),
        sessionId: input.context.sessionId,
      },
    }
  }

  protected getDefaultSystemPrompt(): string {
    return `You are ${this.name}, a ${this.role} agent. ${this.description}`
  }

  getRole(): string {
    return this.role
  }

  getName(): string {
    return this.name
  }

  getDescription(): string {
    return this.description
  }
}
