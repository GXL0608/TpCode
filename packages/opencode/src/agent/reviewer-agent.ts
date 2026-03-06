import { BaseAgent, type AgentProcessInput, type AgentProcessOutput } from "./base-agent"

export interface CodeIssue {
  type: "bug" | "security" | "performance" | "style" | "maintainability"
  severity: "critical" | "high" | "medium" | "low"
  line?: number
  message: string
  suggestion?: string
}

export interface ReviewScore {
  overall: number // 0-100
  errorHandling: number
  security: number
  performance: number
  maintainability: number
  codeStyle: number
}

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super({
      role: "reviewer",
      name: "Code Reviewer Agent",
      description: "Reviews generated code for quality, security, and best practices",
      systemPrompt: `You are a Code Reviewer AI agent specialized in TypeScript and healthcare systems.

Your responsibilities:
1. Identify bugs and potential issues
2. Check for security vulnerabilities (SQL injection, XSS, etc.)
3. Evaluate code quality and maintainability
4. Suggest improvements and best practices
5. Verify error handling and edge cases

Always respond in JSON format with:
{
  "summary": "Review summary",
  "issues": [{ "type", "severity", "line", "message", "suggestion" }],
  "suggestions": ["improvement suggestions"],
  "score": { "overall", "errorHandling", "security", "performance", "maintainability", "codeStyle" }
}`,
    })
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 从上下文获取 Coder Agent 的代码
    const coderMessages = input.context.getMessagesByRole("coder")
    const generatedCode = coderMessages[coderMessages.length - 1]?.metadata?.generatedCode

    if (!generatedCode) {
      return {
        role: this.role,
        content: "未找到需要审查的代码",
        metadata: { issues: [], suggestions: [], score: { overall: 0 } },
      }
    }

    const review = this.reviewCode(generatedCode.code, generatedCode.filePath)

    return {
      role: this.role,
      content: `代码审查完成：\n\n发现 ${review.issues.length} 个问题，总体评分 ${review.score.overall}/100`,
      metadata: review,
    }
  }

  private reviewCode(
    code: string,
    filePath: string
  ): {
    summary: string
    issues: CodeIssue[]
    suggestions: string[]
    score: ReviewScore
  } {
    const issues: CodeIssue[] = []
    const suggestions: string[] = []

    // 检查错误处理
    if (!code.includes("try") && !code.includes("catch")) {
      issues.push({
        type: "bug",
        severity: "medium",
        message: "缺少错误处理机制",
        suggestion: "添加 try-catch 块处理潜在错误",
      })
    }

    // 检查 SQL 注入
    if (code.includes("SELECT") && code.includes("${")) {
      issues.push({
        type: "security",
        severity: "critical",
        message: "存在 SQL 注入风险",
        suggestion: "使用参数化查询或 ORM 防止 SQL 注入",
      })
    }

    // 检查输入验证
    if (code.includes("any") && code.includes("data")) {
      issues.push({
        type: "security",
        severity: "high",
        message: "缺少输入验证",
        suggestion: "使用 Zod 或其他验证库验证输入数据",
      })
    }

    // 检查类型安全
    if (code.includes("function") && !code.includes(":")) {
      suggestions.push("添加明确的类型注解提高类型安全")
    }

    // 计算评分
    const score: ReviewScore = {
      overall: 0,
      errorHandling: code.includes("try") ? 80 : 40,
      security: issues.filter((i) => i.type === "security").length === 0 ? 90 : 30,
      performance: 70,
      maintainability: code.includes("//") || code.includes("/**") ? 80 : 60,
      codeStyle: 75,
    }

    score.overall = Math.round(
      (score.errorHandling +
        score.security +
        score.performance +
        score.maintainability +
        score.codeStyle) /
        5
    )

    return {
      summary: `审查了 ${filePath}，发现 ${issues.length} 个问题`,
      issues,
      suggestions,
      score,
    }
  }
}
