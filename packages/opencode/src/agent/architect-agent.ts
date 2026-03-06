import { BaseAgent, type AgentProcessInput, type AgentProcessOutput } from "./base-agent"

export interface DatabaseTable {
  name: string
  columns: Array<{
    name: string
    type: string
    nullable: boolean
    primaryKey?: boolean
    foreignKey?: { table: string; column: string }
  }>
  indexes: Array<{ name: string; columns: string[] }>
}

export interface APIEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string
  description: string
  requestBody?: Record<string, any>
  responseBody?: Record<string, any>
}

export interface TechStack {
  backend: string[]
  frontend: string[]
  database: string
  cache?: string
  messageQueue?: string
}

export class ArchitectAgent extends BaseAgent {
  constructor() {
    super({
      role: "architect",
      name: "Software Architect Agent",
      description: "Designs system architecture, database schema, and API interfaces",
      systemPrompt: `You are a Software Architect AI agent specialized in healthcare systems.

Your responsibilities:
1. Design database schemas with proper normalization
2. Define RESTful API endpoints
3. Recommend appropriate tech stack
4. Design system architecture diagrams
5. Identify integration points with existing systems (HIS/LIS/PACS)

Always respond in JSON format with:
{
  "summary": "Architecture overview",
  "databaseSchema": { "tables": [...] },
  "apiEndpoints": [...],
  "techStack": { "backend", "frontend", "database" },
  "integrationPoints": [...],
  "securityConsiderations": [...]
}`,
    })
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 从上下文中获取 PM Agent 的需求分析
    const pmMessages = input.context.getMessagesByRole("pm")
    const requirements = pmMessages[pmMessages.length - 1]?.metadata?.requirements || []

    const architecture = this.designArchitecture(input.content, requirements)

    return {
      role: this.role,
      content: `架构设计完成：\n\n${architecture.summary}\n\n设计了 ${architecture.databaseSchema.tables.length} 个数据表，${architecture.apiEndpoints.length} 个 API 端点。`,
      metadata: architecture,
    }
  }

  private designArchitecture(
    content: string,
    requirements: any[]
  ): {
    summary: string
    databaseSchema: { tables: DatabaseTable[] }
    apiEndpoints: APIEndpoint[]
    techStack: TechStack
    integrationPoints: string[]
    securityConsiderations: string[]
  } {
    // 简化实现（实际应该用 LLM）
    const tables: DatabaseTable[] = [
      {
        name: "queue",
        columns: [
          { name: "id", type: "text", nullable: false, primaryKey: true },
          { name: "patient_id", type: "text", nullable: false },
          { name: "doctor_id", type: "text", nullable: false },
          { name: "queue_number", type: "integer", nullable: false },
          { name: "status", type: "text", nullable: false },
          { name: "created_at", type: "bigint", nullable: false },
        ],
        indexes: [
          { name: "queue_status_idx", columns: ["status"] },
          { name: "queue_doctor_idx", columns: ["doctor_id"] },
        ],
      },
    ]

    const apiEndpoints: APIEndpoint[] = [
      {
        method: "POST",
        path: "/api/queue",
        description: "创建排队记录",
        requestBody: { patient_id: "string", doctor_id: "string" },
        responseBody: { id: "string", queue_number: "number" },
      },
      {
        method: "GET",
        path: "/api/queue/:id",
        description: "查询排队状态",
        responseBody: { id: "string", status: "string", position: "number" },
      },
    ]

    const techStack: TechStack = {
      backend: ["Bun", "Hono", "TypeScript"],
      frontend: ["SolidJS", "TailwindCSS"],
      database: "PostgreSQL",
      cache: "Redis",
    }

    return {
      summary: "门诊排队叫号系统架构设计",
      databaseSchema: { tables },
      apiEndpoints,
      techStack,
      integrationPoints: ["HIS 系统患者信息接口", "医生排班系统"],
      securityConsiderations: ["患者隐私保护", "RBAC 权限控制", "API 限流"],
    }
  }
}
