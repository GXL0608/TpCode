import { ulid } from "ulid"

export interface AgentMessage {
  id: string
  role: string
  content: string
  timestamp: number
  metadata?: Record<string, any>
}

export interface AgentContextOptions {
  sessionId: string
  userId: string
  projectId?: string
  metadata?: Record<string, any>
}

export class AgentContext {
  public readonly id: string
  public readonly sessionId: string
  public readonly userId: string
  public readonly projectId?: string
  public readonly metadata: Record<string, any>
  public readonly history: AgentMessage[] = []
  public readonly createdAt: number

  constructor(options: AgentContextOptions) {
    this.id = ulid()
    this.sessionId = options.sessionId
    this.userId = options.userId
    this.projectId = options.projectId
    this.metadata = options.metadata || {}
    this.createdAt = Date.now()
  }

  addMessage(message: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
    const fullMessage: AgentMessage = {
      id: ulid(),
      timestamp: Date.now(),
      ...message,
    }
    this.history.push(fullMessage)
    return fullMessage
  }

  getMessagesByRole(role: string): AgentMessage[] {
    return this.history.filter((msg) => msg.role === role)
  }

  getLastMessage(): AgentMessage | undefined {
    return this.history[this.history.length - 1]
  }

  clear(): void {
    this.history.length = 0
  }
}
