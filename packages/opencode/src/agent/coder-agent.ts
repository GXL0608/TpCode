import { BaseAgent, type AgentProcessInput, type AgentProcessOutput } from "./base-agent"

export interface GeneratedCode {
  language: string
  code: string
  filePath: string
  description: string
}

export class CoderAgent extends BaseAgent {
  constructor() {
    super({
      role: "coder",
      name: "Code Generator Agent",
      description: "Generates production-ready code based on architecture design",
      systemPrompt: `You are a Code Generator AI agent specialized in TypeScript and healthcare systems.

Your responsibilities:
1. Generate clean, maintainable TypeScript code
2. Follow project conventions and best practices
3. Include proper error handling and validation
4. Add comprehensive comments
5. Generate both implementation and test files

Always respond in JSON format with:
{
  "summary": "What was generated",
  "generatedCode": {
    "language": "typescript",
    "code": "...",
    "filePath": "path/to/file.ts",
    "description": "..."
  },
  "testCode": { ... },
  "dependencies": ["list of new dependencies"]
}`,
    })
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 从上下文获取架构设计
    const architectMessages = input.context.getMessagesByRole("architect")
    const architecture = architectMessages[architectMessages.length - 1]?.metadata || {}

    const generated = this.generateCode(input.content, architecture)

    return {
      role: this.role,
      content: `代码生成完成：\n\n${generated.summary}\n\n生成了 ${generated.generatedCode.filePath}`,
      metadata: generated,
    }
  }

  private generateCode(
    content: string,
    architecture: any
  ): {
    summary: string
    generatedCode: GeneratedCode
    testCode?: GeneratedCode
    dependencies: string[]
  } {
    // 简化实现（实际应该用 LLM）
    let code = ""
    let filePath = ""

    if (content.includes("Drizzle schema") || content.includes("表")) {
      const tableName = architecture.databaseSchema?.tables?.[0]?.name || "queue"
      code = `import { pgTable, text, integer, bigint } from "drizzle-orm/pg-core"
import { ulid } from "ulid"

export const ${tableName}Table = pgTable("${tableName}", {
  id: text("id").primaryKey().$defaultFn(() => ulid()),
  patient_id: text("patient_id").notNull(),
  doctor_id: text("doctor_id").notNull(),
  queue_number: integer("queue_number").notNull(),
  status: text("status").notNull().$default(() => "waiting"),
  created_at: bigint("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now()),
})
`
      filePath = `src/queue/${tableName}.sql.ts`
    } else if (content.includes("API") || content.includes("处理函数")) {
      code = `import { Hono } from "hono"
import { db } from "@/db"
import { queueTable } from "./queue.sql"
import { ulid } from "ulid"
import { eq, sql } from "drizzle-orm"

export const queueRoutes = new Hono()

queueRoutes.post("/", async (c) => {
  const body = await c.req.json()

  // 验证输入
  if (!body.patient_id || !body.doctor_id) {
    return c.json({ error: "Missing required fields" }, 400)
  }

  // 获取当前最大排队号
  const maxQueue = await db
    .select({ max: sql<number>\`MAX(queue_number)\` })
    .from(queueTable)
    .where(eq(queueTable.doctor_id, body.doctor_id))

  const queueNumber = (maxQueue[0]?.max || 0) + 1

  // 创建排队记录
  const [queue] = await db
    .insert(queueTable)
    .values({
      id: ulid(),
      patient_id: body.patient_id,
      doctor_id: body.doctor_id,
      queue_number: queueNumber,
      status: "waiting",
    })
    .returning()

  return c.json(queue, 201)
})
`
      filePath = "src/queue/routes.ts"
    }

    return {
      summary: "生成了排队系统的核心代码",
      generatedCode: {
        language: "typescript",
        code,
        filePath,
        description: "排队管理核心逻辑",
      },
      dependencies: ["ulid", "drizzle-orm"],
    }
  }
}
