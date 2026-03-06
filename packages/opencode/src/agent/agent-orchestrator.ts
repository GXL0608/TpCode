import { PMAgent } from "./pm-agent"
import { ArchitectAgent } from "./architect-agent"
import { CoderAgent } from "./coder-agent"
import { ReviewerAgent } from "./reviewer-agent"
import { QAAgent } from "./qa-agent"
import { AgentContext } from "./agent-context"
import type { AgentProcessOutput } from "./base-agent"

export interface OrchestrationResult {
  pm: AgentProcessOutput
  architect: AgentProcessOutput
  coder: AgentProcessOutput
  reviewer: AgentProcessOutput
  qa: AgentProcessOutput
  context: AgentContext
}

export class AgentOrchestrator {
  private pmAgent: PMAgent
  private architectAgent: ArchitectAgent
  private coderAgent: CoderAgent
  private reviewerAgent: ReviewerAgent
  private qaAgent: QAAgent

  constructor() {
    this.pmAgent = new PMAgent()
    this.architectAgent = new ArchitectAgent()
    this.coderAgent = new CoderAgent()
    this.reviewerAgent = new ReviewerAgent()
    this.qaAgent = new QAAgent()
  }

  async processRequirement(
    requirement: string,
    context: AgentContext
  ): Promise<OrchestrationResult> {
    // 1. PM Agent 分析需求
    const pmResult = await this.pmAgent.process({
      content: requirement,
      context,
    })

    // 2. Architect Agent 设计架构
    const architectResult = await this.architectAgent.process({
      content: "基于需求设计系统架构",
      context,
    })

    // 3. Coder Agent 生成代码
    const coderResult = await this.coderAgent.process({
      content: "生成实现代码",
      context,
    })

    // 4. Reviewer Agent 审查代码
    const reviewerResult = await this.reviewerAgent.process({
      content: "审查生成的代码",
      context,
    })

    // 5. QA Agent 质量评估
    const qaResult = await this.qaAgent.process({
      content: "评估整体质量",
      context,
    })

    return {
      pm: pmResult,
      architect: architectResult,
      coder: coderResult,
      reviewer: reviewerResult,
      qa: qaResult,
      context,
    }
  }
}
