import { BaseAgent, type AgentProcessInput, type AgentProcessOutput } from "./base-agent"

export interface Requirement {
  id: string
  description: string
  priority: "high" | "medium" | "low"
  category: string
}

export interface UserStory {
  id: string
  role: string
  action: string
  benefit: string
  acceptanceCriteria: string[]
}

export class PMAgent extends BaseAgent {
  constructor() {
    super({
      role: "pm",
      name: "Product Manager Agent",
      description: "Analyzes user requirements and creates structured specifications",
      systemPrompt: `You are a Product Manager AI agent specialized in healthcare information systems.

Your responsibilities:
1. Analyze user requirements and extract key features
2. Identify stakeholders and their needs
3. Create user stories in the format: "As a [role], I want to [action], so that [benefit]"
4. Prioritize requirements based on business value and technical complexity
5. Identify potential risks and constraints

Always respond in JSON format with the following structure:
{
  "summary": "Brief summary of the requirement",
  "requirements": [{ "id", "description", "priority", "category" }],
  "userStories": [{ "id", "role", "action", "benefit", "acceptanceCriteria" }],
  "stakeholders": ["list of stakeholders"],
  "risks": ["potential risks"],
  "constraints": ["technical or business constraints"]
}`,
    })
  }

  protected async generateResponse(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // 这里应该调用 LLM API (Claude/GPT)
    // 为了测试，我们先返回模拟数据
    const analysis = this.analyzeRequirement(input.content)

    return {
      role: this.role,
      content: `需求分析完成：\n\n${analysis.summary}\n\n识别到 ${analysis.requirements.length} 个需求，${analysis.userStories.length} 个用户故事。`,
      metadata: analysis,
    }
  }

  private analyzeRequirement(content: string): {
    summary: string
    requirements: Requirement[]
    userStories: UserStory[]
    stakeholders: string[]
    risks: string[]
    constraints: string[]
  } {
    // 简单的关键词提取（实际应该用 LLM）
    const stakeholders: string[] = []
    if (content.includes("医生")) stakeholders.push("医生")
    if (content.includes("护士")) stakeholders.push("护士")
    if (content.includes("患者")) stakeholders.push("患者")
    if (content.includes("门诊")) stakeholders.push("门诊工作人员")

    const requirements: Requirement[] = [
      {
        id: "req-1",
        description: "实现排队叫号功能",
        priority: "high",
        category: "core",
      },
    ]

    const userStories: UserStory[] = [
      {
        id: "us-1",
        role: "患者",
        action: "查看当前排队进度",
        benefit: "知道大概等待时间",
        acceptanceCriteria: ["显示当前排队人数", "显示预计等待时间"],
      },
    ]

    return {
      summary: "门诊排队叫号系统需求分析",
      requirements,
      userStories,
      stakeholders,
      risks: ["高并发场景下的性能问题"],
      constraints: ["需要与现有 HIS 系统集成"],
    }
  }
}
