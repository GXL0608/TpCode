import { beforeEach, describe, expect, mock, test } from "bun:test"
import z from "zod"
import { eq, Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable, MessageTable, PartTable } from "../../src/session/session.sql"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { TpSavedPlanEvalTable } from "../../src/plan/saved-plan-eval.sql"
import { TpSavedPlanEvalItemTable } from "../../src/plan/saved-plan-eval-item.sql"
import type { MessageV2 } from "../../src/session/message-v2"

const state = {
  body: "",
  system: "",
  object_error: undefined as Error | undefined,
  runtime_calls: [] as Array<{ providerID: string; modelID: string } | undefined>,
  result: {
    rubric_version: "plan_eval_v3",
    prompt_version: "plan_eval_prompt_v4",
    summary: "用户输入略有歧义，模型回复基本到位。",
    major_issue_side: "user_input" as const,
    user_input: {
      score: 95,
      dimensions: [
        {
          code: "goal_clarity",
          name: "目标清晰度",
          max_deduction: 25,
          deducted_score: 5,
          final_score: 20,
          reason: "目标描述存在轻微范围不清。",
          evidence: ["设计方案"],
        },
        {
          code: "context_completeness",
          name: "背景完整性",
          max_deduction: 20,
          deducted_score: 0,
          final_score: 20,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "constraint_specificity",
          name: "约束明确性",
          max_deduction: 20,
          deducted_score: 0,
          final_score: 20,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "domain_accuracy",
          name: "领域准确性",
          max_deduction: 15,
          deducted_score: 0,
          final_score: 15,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "ambiguity_control",
          name: "歧义控制",
          max_deduction: 10,
          deducted_score: 0,
          final_score: 10,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "communication_efficiency",
          name: "表达效率",
          max_deduction: 10,
          deducted_score: 0,
          final_score: 10,
          reason: "无明显扣分项",
          evidence: [],
        },
      ],
    },
    model_reply: {
      score: 90,
      dimensions: [
        {
          code: "intent_alignment",
          name: "意图理解准确性",
          max_deduction: 25,
          deducted_score: 0,
          final_score: 25,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "coverage_completeness",
          name: "覆盖完整性",
          max_deduction: 20,
          deducted_score: 10,
          final_score: 10,
          reason: "覆盖点略少。",
          evidence: ["只做后端"],
        },
        {
          code: "actionability",
          name: "可执行性",
          max_deduction: 20,
          deducted_score: 0,
          final_score: 20,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "constraint_following",
          name: "约束遵循度",
          max_deduction: 15,
          deducted_score: 0,
          final_score: 15,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "consistency_correctness",
          name: "一致性与正确性",
          max_deduction: 10,
          deducted_score: 0,
          final_score: 10,
          reason: "无明显扣分项",
          evidence: [],
        },
        {
          code: "structure_readability",
          name: "结构可读性",
          max_deduction: 10,
          deducted_score: 0,
          final_score: 10,
          reason: "无明显扣分项",
          evidence: [],
        },
      ],
    },
  },
}

mock.module("ai", () => ({
  generateObject: async (input: { messages?: Array<{ role: string; content: string }> }) => {
    state.system = input.messages?.find((x) => x.role === "system")?.content ?? ""
    state.body = input.messages?.find((x) => x.role === "user")?.content ?? ""
    if (state.object_error) throw state.object_error
    return { object: state.result }
  },
  generateText: async () => ({
    text: JSON.stringify(state.result),
  }),
  streamText: () => ({}),
  streamObject: () => ({
    object: Promise.resolve(state.result),
    async *fullStream() {},
  }),
  dynamicTool: (input: unknown) => input,
  jsonSchema: () => ({}),
  wrapLanguageModel: (input: { model?: unknown }) => input.model,
  tool: (input: unknown) => input,
  asSchema: (input: unknown) => input,
  APICallError: class APICallError extends Error {},
  LoadAPIKeyError: class LoadAPIKeyError extends Error {},
  NoSuchModelError: class NoSuchModelError extends Error {},
  convertToModelMessages: () => [],
}))

mock.module("../../src/provider/provider", () => ({
  Provider: {
    getModel: async (providerID: string, modelID: string) => ({
      providerID,
      id: modelID,
      api: { npm: "@ai-sdk/openai-compatible", id: modelID },
    }),
    getLanguage: async () => ({}),
    defaultModel: async () => ({ providerID: "openai", modelID: "gpt-4.1-mini" }),
    runtimeModel: async (
      input?:
        | { providerID: string; modelID: string }
        | (() => { providerID: string; modelID: string } | undefined | Promise<{ providerID: string; modelID: string } | undefined>)
        | Promise<{ providerID: string; modelID: string } | undefined>,
    ) => {
      const pending =
        typeof input === "function"
          ? input()
          : input && typeof (input as Promise<unknown>).then === "function"
            ? input
            : Promise.resolve(input)
      const candidate = await pending
      state.runtime_calls.push(candidate)
      return { providerID: "openai", modelID: "gpt-4.1-mini" }
    },
    parseModel: (input: string) => {
      const [providerID, ...rest] = input.split("/")
      return { providerID, modelID: rest.join("/") }
    },
  },
}))

mock.module("../../src/flag/flag", () => ({
  Flag: {
    TPCODE_ACCOUNT_ENABLED: true,
  },
}))

mock.module("../../src/config/config", () => ({
  Config: {
    Provider: z.object({}).catchall(z.any()),
    get: async () => ({}),
  },
}))

mock.module("../../src/auth/index", () => ({
  OAUTH_DUMMY_KEY: "opencode-oauth-dummy-key",
  ACCOUNT_META_DUMMY_KEY: "__tpcode_meta__",
  Auth: {
    get: async () => undefined,
  },
}))

mock.module("../../src/provider/transform", () => ({
  ProviderTransform: {
    providerOptions: () => ({}),
  },
}))

mock.module("../../src/session/system", () => ({
  SystemPrompt: {
    instructions: () => "",
  },
}))

const { PlanEvalService } = await import("../../src/plan/eval-service")

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function seed() {
  const now = Date.now()
  const project_id = uid("project")
  const session_id = Identifier.ascending("session")
  const user_message_id = Identifier.ascending("message")
  const assistant_message_id = Identifier.ascending("message")
  const user_part_id = Identifier.ascending("part")
  const assistant_part_id = Identifier.ascending("part")
  const plan_id = uid("plan")
  const user_info = {
    role: "user",
    time: { created: now },
    agent: "user",
    model: { providerID: "openai", modelID: "gpt-4.1-mini" },
    tools: {},
  } satisfies Omit<MessageV2.User, "id" | "sessionID">
  const assistant_info = {
    role: "assistant",
    time: { created: now, completed: now },
    parentID: user_message_id,
    modelID: "gpt-4.1-mini",
    providerID: "openai",
    mode: "chat",
    agent: "plan",
    path: { cwd: process.cwd(), root: process.cwd() },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } satisfies Omit<MessageV2.Assistant, "id" | "sessionID">
  const user_part = {
    type: "text",
    text: "请给出计划保存后异步质量评价设计方案",
  } satisfies Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID">
  const assistant_part = {
    type: "text",
    text: "# Plan\n- 只做后端\n- 不做前端",
  } satisfies Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID">

  await Database.transaction(async (db) => {
    await db.insert(ProjectTable)
      .values({
        id: project_id,
        worktree: process.cwd(),
        vcs: "git",
        name: "eval test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    await db.insert(SessionTable)
      .values({
        id: session_id,
        project_id,
        context_project_id: project_id,
        slug: session_id,
        directory: process.cwd(),
        title: "eval session",
        version: "1",
        user_id: "user_tp_admin",
        org_id: "org_tp_internal",
        visibility: "private",
        time_created: now,
        time_updated: now,
      })
      .run()
    await db.insert(MessageTable)
      .values({
        id: user_message_id,
        session_id,
        time_created: now,
        time_updated: now,
        data: user_info,
      })
      .run()
    await db.insert(MessageTable)
      .values({
        id: assistant_message_id,
        session_id,
        time_created: now,
        time_updated: now,
        data: assistant_info,
      })
      .run()
    await db.insert(PartTable)
      .values({
        id: user_part_id,
        session_id,
        message_id: user_message_id,
        time_created: now,
        time_updated: now,
        data: user_part,
      })
      .run()
    await db.insert(PartTable)
      .values({
        id: assistant_part_id,
        session_id,
        message_id: assistant_message_id,
        time_created: now,
        time_updated: now,
        data: assistant_part,
      })
      .run()
    await db.insert(TpSavedPlanTable)
      .values({
        id: plan_id,
        session_id,
        message_id: assistant_message_id,
        part_id: assistant_part_id,
        project_id,
        project_name: "eval test",
        project_worktree: process.cwd(),
        session_title: "eval session",
        user_id: "user_tp_admin",
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
        department_id: "",
        agent: "plan",
        provider_id: "openai",
        model_id: "gpt-4.1-mini",
        message_created_at: now,
        plan_content: "# Plan\n- 只做后端\n- 不做前端",
        vho_feedback_no: "VHO-EVAL-1",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  return {
    plan_id,
    session_id,
    assistant_message_id,
    assistant_part_id,
  }
}

beforeEach(() => {
  state.body = ""
  state.system = ""
  state.object_error = undefined
  state.runtime_calls = []
  state.result.summary = "用户输入略有歧义，模型回复基本到位。"
})

describe("plan eval service", () => {
  test("writes eval summary and item rows", async () => {
    const seeded = await seed()

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.vho_feedback_no).toBe("VHO-EVAL-1")
    expect(row?.user_score).toBe(95)
    expect(row?.assistant_score).toBe(90)
    expect(row?.major_issue_side).toBe("model_reply")

    const items = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalItemTable).where(eq(TpSavedPlanEvalItemTable.eval_id, row!.id)).all(),
    )
    expect(items).toHaveLength(12)
    expect(items.every((x) => x.vho_feedback_no === "VHO-EVAL-1")).toBe(true)
  })

  test("uses runtime model selection for judge model", async () => {
    const seeded = await seed()

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-RT",
      user_model_provider_id: "anthropic",
      user_model_id: "claude-sonnet-4-20250514",
      assistant_model_provider_id: "anthropic",
      assistant_model_id: "claude-sonnet-4-20250514",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(state.runtime_calls).toHaveLength(1)
    expect(state.runtime_calls[0]).toBeDefined()
    expect(row?.judge_provider_id).toBe("openai")
    expect(row?.judge_model_id).toBe("gpt-4.1-mini")
  })

  test("uses plan-mode specific scoring guidance in the judge prompt", async () => {
    const seeded = await seed()

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    expect(state.system).toContain("这不是普通闲聊质量评价")
    expect(state.system).toContain("如果用户输入只是问候、身份询问、闲聊、情绪表达")
    expect(state.body).toContain("注意：这是“计划模式保存质量评价”")
    expect(state.body).toContain("若 user_input 只是问候、身份询问、闲聊、测试性输入")
    expect(state.body).toContain("若 model_reply 主要是寒暄、自我介绍、泛泛追问")
  })

  test("uses saved plan snapshot instead of live assistant part text", async () => {
    const seeded = await seed()
    const changed = {
      type: "text",
      text: "# Plan\n- 已被改写",
    } satisfies Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID">

    await Database.use((db) =>
      db.update(PartTable)
        .set({
          data: changed,
          time_updated: Date.now(),
        })
        .where(eq(PartTable.id, seeded.assistant_part_id))
        .run(),
    )

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    expect(state.body).toContain("被保存的计划文本：\n# Plan\n- 只做后端\n- 不做前端")
    expect(state.body).not.toContain("已被改写")
  })

  test("falls back to text generation when structured output parsing fails", async () => {
    const seeded = await seed()
    state.object_error = new Error("No object generated: could not parse the response.")

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.user_score).toBe(95)
    expect(row?.assistant_score).toBe(90)
  })

  test("accepts compatible evaluation json even when field names differ", async () => {
    const seeded = await seed()
    state.object_error = new Error("No object generated: could not parse the response.")
    state.result = {
      user_input_evaluation: {
        goal_clarity: {
          deducted_score: 25,
          reason: "目标不清楚",
          evidence: "你是谁",
        },
        context_completeness: {
          deducted_score: 20,
          reason: "没有背景",
          evidence: "你是谁",
        },
        constraint_specificity: {
          deducted_score: 20,
          reason: "没有约束",
          evidence: "你是谁",
        },
        domain_accuracy: {
          deducted_score: 15,
          reason: "偏离领域",
          evidence: "你是谁",
        },
        ambiguity_control: {
          deducted_score: 10,
          reason: "歧义高",
          evidence: "你是谁",
        },
        communication_efficiency: {
          deducted_score: 10,
          reason: "过于简短",
          evidence: "你是谁",
        },
      },
      model_reply_evaluation: {
        intent_alignment: {
          deducted_score: 25,
          reason: "理解错意图",
          evidence: "Hello! I am **opencode**",
        },
        coverage_completeness: {
          deducted_score: 20,
          reason: "没回答身份问题",
          evidence: "How can I help you plan your next steps?",
        },
        actionability: {
          deducted_score: 20,
          reason: "无法直接解决",
          evidence: "Please provide the details",
        },
        constraint_following: {
          deducted_score: 15,
          reason: "偏离用户输入",
          evidence: "计划模式不提供项目目录",
        },
        consistency_correctness: {
          deducted_score: 10,
          reason: "与输入不一致",
          evidence: "Regarding your request",
        },
        structure_readability: {
          deducted_score: 0,
          reason: "结构清晰",
          evidence: "Hello! I am **opencode**",
        },
      },
    } as unknown as typeof state.result

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.user_score).toBe(0)
    expect(row?.assistant_score).toBe(10)
  })

  test("accepts compatible evaluation json when scorecards are returned as arrays", async () => {
    const seeded = await seed()
    state.object_error = new Error("No object generated: could not parse the response.")
    state.result = {
      user_input_scores: [
        {
          dimension: "goal_clarity",
          deducted_score: 25,
          reason: "目标模糊",
          evidence: "我问的都是什么",
        },
        {
          dimension: "context_completeness",
          deducted_score: 20,
          reason: "缺少上下文",
          evidence: "我问的都是什么",
        },
        {
          dimension: "constraint_specificity",
          deducted_score: 20,
          reason: "没有约束",
          evidence: "我问的都是什么",
        },
        {
          dimension: "domain_accuracy",
          deducted_score: 15,
          reason: "未指向具体领域",
          evidence: "我问的都是什么",
        },
        {
          dimension: "ambiguity_control",
          deducted_score: 10,
          reason: "歧义高",
          evidence: "我问的都是什么",
        },
        {
          dimension: "communication_efficiency",
          deducted_score: 10,
          reason: "表达过于简略",
          evidence: "我问的都是什么",
        },
      ],
      model_reply_scores: [
        {
          dimension: "intent_alignment",
          deducted_score: 20,
          reason: "理解基本正确但不够精准",
          evidence: "你问的问题是",
        },
        {
          dimension: "coverage_completeness",
          deducted_score: 15,
          reason: "覆盖不够完整",
          evidence: "这些都是比较基础的问候和身份确认",
        },
        {
          dimension: "actionability",
          deducted_score: 15,
          reason: "下一步建议较泛",
          evidence: "请告诉我具体需求",
        },
        {
          dimension: "constraint_following",
          deducted_score: 15,
          reason: "存在额外延展",
          evidence: "如果你有代码、文档、或者项目相关的任务需要规划",
        },
        {
          dimension: "consistency_correctness",
          deducted_score: 10,
          reason: "总结略泛化",
          evidence: "这些都是比较基础的问候和身份确认",
        },
        {
          dimension: "structure_readability",
          deducted_score: 10,
          reason: "列表可更紧凑",
          evidence: "1.",
        },
      ],
    } as unknown as typeof state.result

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.user_score).toBe(0)
    expect(row?.assistant_score).toBe(15)
  })

  test("fills missing evidence from source text instead of failing the eval", async () => {
    const seeded = await seed()
    state.result = {
      rubric_version: "plan_eval_v3",
      prompt_version: "plan_eval_prompt_v4",
      summary: "有扣分项但部分 evidence 缺失。",
      major_issue_side: "user_input",
      user_input: {
        score: 90,
        dimensions: [
          {
            code: "goal_clarity",
            name: "目标清晰度",
            max_deduction: 25,
            deducted_score: 10,
            final_score: 15,
            reason: "目标表达不够完整。",
            evidence: [],
          },
          {
            code: "context_completeness",
            name: "背景完整性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "constraint_specificity",
            name: "约束明确性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "domain_accuracy",
            name: "领域准确性",
            max_deduction: 15,
            deducted_score: 0,
            final_score: 15,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "ambiguity_control",
            name: "歧义控制",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "communication_efficiency",
            name: "表达效率",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
        ],
      },
      model_reply: {
        score: 100,
        dimensions: [
          {
            code: "intent_alignment",
            name: "意图理解准确性",
            max_deduction: 25,
            deducted_score: 0,
            final_score: 25,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "coverage_completeness",
            name: "覆盖完整性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "actionability",
            name: "可执行性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "constraint_following",
            name: "约束遵循度",
            max_deduction: 15,
            deducted_score: 0,
            final_score: 15,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "consistency_correctness",
            name: "一致性与正确性",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "structure_readability",
            name: "结构可读性",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
        ],
      },
    }

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    const items = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalItemTable).where(eq(TpSavedPlanEvalItemTable.eval_id, row!.id)).all(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.user_score).toBe(90)
    expect(items.find((x) => x.dimension_code === "goal_clarity")?.evidence_json).toEqual(["请给出计划保存后异步质量评价设计方案"])
  })

  test("recomputes subject scores from deductions instead of trusting model totals", async () => {
    const seeded = await seed()
    state.result = {
      rubric_version: "plan_eval_v3",
      prompt_version: "plan_eval_prompt_v4",
      summary: "总分与扣分不一致。",
      major_issue_side: "user_input",
      user_input: {
        score: 100,
        dimensions: [
          {
            code: "goal_clarity",
            name: "目标清晰度",
            max_deduction: 25,
            deducted_score: 10,
            final_score: 15,
            reason: "目标不够完整。",
            evidence: ["请给出计划保存后异步质量评价设计方案"],
          },
          {
            code: "context_completeness",
            name: "背景完整性",
            max_deduction: 20,
            deducted_score: 10,
            final_score: 10,
            reason: "背景略少。",
            evidence: ["请给出计划保存后异步质量评价设计方案"],
          },
          {
            code: "constraint_specificity",
            name: "约束明确性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "domain_accuracy",
            name: "领域准确性",
            max_deduction: 15,
            deducted_score: 0,
            final_score: 15,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "ambiguity_control",
            name: "歧义控制",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "communication_efficiency",
            name: "表达效率",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
        ],
      },
      model_reply: {
        score: 100,
        dimensions: [
          {
            code: "intent_alignment",
            name: "意图理解准确性",
            max_deduction: 25,
            deducted_score: 0,
            final_score: 25,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "coverage_completeness",
            name: "覆盖完整性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "actionability",
            name: "可执行性",
            max_deduction: 20,
            deducted_score: 0,
            final_score: 20,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "constraint_following",
            name: "约束遵循度",
            max_deduction: 15,
            deducted_score: 0,
            final_score: 15,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "consistency_correctness",
            name: "一致性与正确性",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
          {
            code: "structure_readability",
            name: "结构可读性",
            max_deduction: 10,
            deducted_score: 0,
            final_score: 10,
            reason: "无明显扣分项",
            evidence: [],
          },
        ],
      },
    }

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, seeded.plan_id)).get(),
    )
    expect(row?.status).toBe("completed")
    expect(row?.user_score).toBe(80)
  })

  test("retry rejects other user's eval", async () => {
    const seeded = await seed()

    await Database.use((db) =>
      db.insert(TpSavedPlanEvalTable)
        .values({
          id: uid("eval"),
          plan_id: seeded.plan_id,
          vho_feedback_no: "VHO-EVAL-1",
          user_id: "user_tp_admin",
          session_id: seeded.session_id,
          user_message_id: "",
          assistant_message_id: seeded.assistant_message_id,
          part_id: seeded.assistant_part_id,
          status: "failed",
          error_code: "judge_model_unavailable",
          error_message: "judge_model_unavailable",
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run(),
    )

    await expect(PlanEvalService.retry({ plan_id: seeded.plan_id, actor_user_id: "user_other" })).resolves.toEqual({
      ok: false,
      code: "forbidden",
    })
  })

  test("retry rejects completed eval", async () => {
    const seeded = await seed()

    await PlanEvalService.run({
      plan_id: seeded.plan_id,
      session_id: seeded.session_id,
      user_id: "user_tp_admin",
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-EVAL-1",
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: "openai",
      assistant_model_id: "gpt-4.1-mini",
    })

    await expect(PlanEvalService.retry({ plan_id: seeded.plan_id, actor_user_id: "user_tp_admin" })).resolves.toEqual({
      ok: false,
      code: "plan_eval_retry_invalid",
    })
  })
})
