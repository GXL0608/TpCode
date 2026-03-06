import { BaseAgent, type AgentProcessInput, type AgentProcessOutput } from "./base-agent"

export interface QualityScore {
  overall: number // 0-100
  requirementCoverage: number // 需求覆盖率
  codeQuality: number // 代码质量
  security: number // 安全性
  performance: number // 性能
  maintainability: number // 可维护性
  testCoverage: number // 测试覆盖率
  documentation: number // 文档完整性
}

export interface QualityReport {
  score: QualityScore
  strengths: string[]
  weaknesses: string[]
  recommendations: string[]
  readyForProduction: boolean
  estimatedEffort?: string // 预估改进工作量
}

export class QAAgent extends BaseAgent {
  constructor() {
    super({
      role: "qa",
      name: "Quality Assurance Agent",
      description: "Evaluates overall quality and provides comprehensive assessment",
      systemPrompt: `You are a Quality Assurance AI agent specialized in software quality metrics.

Your responsibilities:
1. Calculate multi-dimensional quality scores
2. Evaluate requirement coverage
3. Assess code maintainability
4. Check test coverage
5. Verify documentation completeness
6. Provide actionable recommendations
7. Determine production readiness

Quality scoring criteria:
- Overall: Weighted average of all dimensions
- Requirement Coverage: % of requirements implemented
- Code Quality: Based on reviewer score
- Security: Inverse of security issues severity
- Performance: Estimated based on code patterns
- Maintainability: Code structure and documentation
- Test Coverage: % of code covered by tests
- Documentation: Completeness of technical docs

Always respond in JSON format with:
{
  "summary": "Quality assessment summary",
  "score": {
    "overall": 0-100,
    "requirementCoverage": 0-100,
    "codeQuality": 0-100,
    "security": 0-100,
    "performance": 0-100,
    "maintainability": 0-100,
    "testCoverage": 0-100,
    "documentation": 0-100
  },
  "strengths": [...],
  "weaknesses": [...],
  "recommendations": [...],
  "readyForProduction": boolean,
  "estimatedEffort": "low|medium|high"
}`,
    })
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 收集所有智能体的输出
    const pmMessages = input.context.getMessagesByRole("pm")
    const architectMessages = input.context.getMessagesByRole("architect")
    const coderMessages = input.context.getMessagesByRole("coder")
    const reviewerMessages = input.context.getMessagesByRole("reviewer")

    const report = this.evaluateQuality({
      pm: pmMessages[pmMessages.length - 1]?.metadata,
      architect: architectMessages[architectMessages.length - 1]?.metadata,
      coder: coderMessages[coderMessages.length - 1]?.metadata,
      reviewer: reviewerMessages[reviewerMessages.length - 1]?.metadata,
    })

    const statusEmoji = report.readyForProduction ? "✅" : "⚠️"
    const statusText = report.readyForProduction ? "可以投入生产" : "需要改进后再部署"

    return {
      role: this.role,
      content: `质量评估完成：

总体评分：${report.score.overall}/100 ${this.getScoreEmoji(report.score.overall)}

${statusEmoji} ${statusText}

📊 详细评分：
- 需求覆盖率：${report.score.requirementCoverage}/100
- 代码质量：${report.score.codeQuality}/100
- 安全性：${report.score.security}/100
- 性能：${report.score.performance}/100
- 可维护性：${report.score.maintainability}/100
- 测试覆盖率：${report.score.testCoverage}/100
- 文档完整性：${report.score.documentation}/100

💪 优势：
${report.strengths.map((s) => `- ${s}`).join("\n")}

⚠️ 弱点：
${report.weaknesses.map((w) => `- ${w}`).join("\n")}

🎯 改进建议：
${report.recommendations.map((r) => `- ${r}`).join("\n")}

预估改进工作量：${report.estimatedEffort}`,
      metadata: { qualityScore: report.score, ...report },
    }
  }

  private getScoreEmoji(score: number): string {
    if (score >= 90) return "🌟"
    if (score >= 80) return "✨"
    if (score >= 70) return "👍"
    if (score >= 60) return "🤔"
    return "⚠️"
  }

  private evaluateQuality(agentOutputs: {
    pm?: any
    architect?: any
    coder?: any
    reviewer?: any
  }): QualityReport {
    const score: QualityScore = {
      overall: 0,
      requirementCoverage: 0,
      codeQuality: 0,
      security: 0,
      performance: 0,
      maintainability: 0,
      testCoverage: 0,
      documentation: 0,
    }

    const strengths: string[] = []
    const weaknesses: string[] = []
    const recommendations: string[] = []

    // 1. 评估需求覆盖率
    if (agentOutputs.pm?.requirements && agentOutputs.pm.requirements.length > 0) {
      score.requirementCoverage = 90
      strengths.push("需求分析完整，识别了所有关键功能")
    } else {
      score.requirementCoverage = 50
      weaknesses.push("需求分析不完整或缺失")
      recommendations.push("补充完整的需求文档和用户故事")
    }

    // 2. 评估代码质量
    if (agentOutputs.reviewer?.overallScore !== undefined) {
      score.codeQuality = agentOutputs.reviewer.overallScore
      if (score.codeQuality >= 80) {
        strengths.push(`代码质量优秀 (${score.codeQuality}/100)`)
      } else if (score.codeQuality >= 60) {
        weaknesses.push(`代码质量一般 (${score.codeQuality}/100)`)
        recommendations.push("重构代码以提升质量分数")
      } else {
        weaknesses.push(`代码质量较差 (${score.codeQuality}/100)`)
        recommendations.push("需要大幅重构代码")
      }
    } else {
      score.codeQuality = 60
      weaknesses.push("缺少代码审查")
      recommendations.push("进行完整的代码审查")
    }

    // 3. 评估安全性
    if (agentOutputs.reviewer?.securityIssues) {
      const criticalIssues = agentOutputs.reviewer.securityIssues.filter(
        (i: any) => i.severity === "critical"
      ).length
      const highIssues = agentOutputs.reviewer.securityIssues.filter(
        (i: any) => i.severity === "high"
      ).length

      score.security = Math.max(0, 100 - criticalIssues * 30 - highIssues * 15)

      if (criticalIssues > 0) {
        weaknesses.push(`存在 ${criticalIssues} 个严重安全问题`)
        recommendations.push("🚨 立即修复所有严重安全漏洞")
      } else if (highIssues > 0) {
        weaknesses.push(`存在 ${highIssues} 个高危安全问题`)
        recommendations.push("优先修复高危安全问题")
      } else {
        strengths.push("未发现严重安全问题")
      }
    } else {
      score.security = 70
    }

    // 4. 评估性能
    if (agentOutputs.architect?.techStack) {
      score.performance = 75
      strengths.push("技术栈选择合理")
    } else {
      score.performance = 60
    }

    // 检查是否有明显的性能问题
    if (agentOutputs.coder?.generatedCode?.code) {
      const code = agentOutputs.coder.generatedCode.code
      if (code.includes("N+1") || (code.includes("for") && code.includes("await"))) {
        score.performance -= 20
        weaknesses.push("可能存在 N+1 查询或性能问题")
        recommendations.push("优化数据库查询，避免 N+1 问题")
      }
    }

    // 5. 评估可维护性
    if (agentOutputs.coder?.generatedCode?.code) {
      const code = agentOutputs.coder.generatedCode.code
      const hasComments = code.includes("//") || code.includes("/*")
      const hasTypes = !code.includes(": any")
      const hasModularStructure = code.includes("export") && code.includes("import")

      let maintainabilityScore = 0
      if (hasComments) maintainabilityScore += 30
      if (hasTypes) maintainabilityScore += 40
      if (hasModularStructure) maintainabilityScore += 30

      score.maintainability = maintainabilityScore

      if (maintainabilityScore >= 80) {
        strengths.push("代码结构清晰，易于维护")
      } else {
        weaknesses.push("代码可维护性需要提升")
        if (!hasComments) recommendations.push("添加必要的代码注释")
        if (!hasTypes) recommendations.push("使用明确的类型定义，避免 any")
      }
    } else {
      score.maintainability = 60
    }

    // 6. 评估测试覆盖率
    if (agentOutputs.coder?.testCode) {
      score.testCoverage = 80
      strengths.push("包含测试代码")
    } else {
      score.testCoverage = 0
      weaknesses.push("缺少测试代码")
      recommendations.push("添加单元测试和集成测试")
    }

    // 7. 评估文档完整性
    let docScore = 0
    if (agentOutputs.pm?.summary) docScore += 30
    if (agentOutputs.architect?.summary) docScore += 40
    if (agentOutputs.coder?.generatedCode?.description) docScore += 30

    score.documentation = docScore

    if (docScore >= 80) {
      strengths.push("文档完整，包含需求和架构说明")
    } else {
      weaknesses.push("文档不完整")
      recommendations.push("补充技术文档和 API 文档")
    }

    // 8. 计算总体评分（加权平均）
    score.overall = Math.round(
      score.requirementCoverage * 0.15 +
        score.codeQuality * 0.25 +
        score.security * 0.2 +
        score.performance * 0.1 +
        score.maintainability * 0.15 +
        score.testCoverage * 0.1 +
        score.documentation * 0.05
    )

    // 9. 判断是否可以投入生产
    const readyForProduction =
      score.overall >= 80 &&
      score.security >= 90 &&
      score.testCoverage >= 70 &&
      (agentOutputs.reviewer?.securityIssues?.filter((i: any) => i.severity === "critical")
        .length || 0) === 0

    // 10. 预估改进工作量
    let estimatedEffort = "low"
    if (score.overall < 60 || score.security < 70) {
      estimatedEffort = "high"
    } else if (score.overall < 80 || score.testCoverage < 50) {
      estimatedEffort = "medium"
    }

    // 11. 添加通用建议
    if (!readyForProduction) {
      recommendations.push("提升整体质量分数至 80 分以上")
      recommendations.push("确保安全性评分达到 90 分以上")
      recommendations.push("测试覆盖率至少达到 70%")
    }

    return {
      score,
      strengths,
      weaknesses,
      recommendations,
      readyForProduction,
      estimatedEffort,
    }
  }
}
