import { ulid } from "ulid"
import z from "zod"
import { generateObject, generateText, streamObject, type ModelMessage } from "ai"
import { AccountCurrent } from "@/user/current"
import { Database, eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { TpSavedPlanTable } from "./saved-plan.sql"
import { TpSavedPlanEvalTable } from "./saved-plan-eval.sql"
import { TpSavedPlanEvalItemTable } from "./saved-plan-eval-item.sql"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "@/session/system"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { Project } from "@/project/project"
import { AccountProviderState } from "@/provider/account-provider-state"

const log = Log.create({ service: "plan.eval" })
const rubric = "plan_eval_v3"
const prompt = "plan_eval_prompt_v4"

const user = [
  { code: "goal_clarity", name: "目标清晰度", max: 25 },
  { code: "context_completeness", name: "背景完整性", max: 20 },
  { code: "constraint_specificity", name: "约束明确性", max: 20 },
  { code: "domain_accuracy", name: "领域准确性", max: 15 },
  { code: "ambiguity_control", name: "歧义控制", max: 10 },
  { code: "communication_efficiency", name: "表达效率", max: 10 },
] as const

const reply = [
  { code: "intent_alignment", name: "意图理解准确性", max: 25 },
  { code: "coverage_completeness", name: "覆盖完整性", max: 20 },
  { code: "actionability", name: "可执行性", max: 20 },
  { code: "constraint_following", name: "约束遵循度", max: 15 },
  { code: "consistency_correctness", name: "一致性与正确性", max: 10 },
  { code: "structure_readability", name: "结构可读性", max: 10 },
] as const

const item = z.object({
  code: z.string(),
  name: z.string(),
  max_deduction: z.number().int(),
  deducted_score: z.number().int(),
  final_score: z.number().int(),
  reason: z.string(),
  evidence: z.array(z.string()),
})

const card = z.object({
  score: z.number().int(),
  dimensions: z.array(item),
})

const output = z.object({
  rubric_version: z.string(),
  prompt_version: z.string(),
  summary: z.string(),
  major_issue_side: z.enum(["user_input", "model_reply", "both", "none"]),
  user_input: card,
  model_reply: card,
})

type Start = {
  plan_id: string
  session_id: string
  user_id: string
  message_id: string
  part_id: string
  vho_feedback_no?: string
  user_model_provider_id: string
  user_model_id: string
  assistant_model_provider_id: string
  assistant_model_id: string
  context_project_id?: string
  retry?: boolean
}

function text(parts: MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function evidence(input: string) {
  const list = input
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.slice(0, 120))
  if (list.length > 0) return list.slice(0, 2)
  const value = input.trim().slice(0, 120)
  return value ? [value] : []
}

function major(input: { user_score: number; assistant_score: number }) {
  if (input.user_score === 100 && input.assistant_score === 100) return "none" as const
  if (input.user_score < input.assistant_score) return "user_input" as const
  if (input.assistant_score < input.user_score) return "model_reply" as const
  return "both" as const
}

function normalize(
  dims: readonly { code: string; name: string; max: number }[],
  list: z.infer<typeof item>[],
  _score: number,
) {
  const map = new Map<string, z.infer<typeof item>>()
  for (const x of list) {
    if (map.has(x.code)) throw new Error(`plan_eval_duplicate_dimension:${x.code}`)
    map.set(x.code, x)
  }
  if (map.size !== dims.length) throw new Error("plan_eval_dimension_count_invalid")
  const normalized = dims.map((dim) => {
    const hit = map.get(dim.code)
    if (!hit) throw new Error(`plan_eval_dimension_missing:${dim.code}`)
    if (hit.name.trim() !== dim.name) throw new Error(`plan_eval_dimension_name_invalid:${dim.code}`)
    if (hit.max_deduction !== dim.max) throw new Error(`plan_eval_dimension_max_invalid:${dim.code}`)
    if (hit.deducted_score < 0 || hit.deducted_score > dim.max) throw new Error(`plan_eval_deduction_invalid:${dim.code}`)
    if (hit.final_score !== dim.max - hit.deducted_score) throw new Error(`plan_eval_final_score_invalid:${dim.code}`)
    const reason = hit.reason.trim()
    if (!reason) throw new Error(`plan_eval_reason_missing:${dim.code}`)
    const evidence = hit.evidence.map((x) => x.trim()).filter(Boolean)
    if (hit.deducted_score > 0 && evidence.length === 0) throw new Error(`plan_eval_evidence_missing:${dim.code}`)
    return {
      code: dim.code,
      name: dim.name,
      max_deduction: dim.max,
      deducted_score: hit.deducted_score,
      final_score: dim.max - hit.deducted_score,
      reason,
      evidence,
    }
  })
  const computed = 100 - normalized.reduce((sum, x) => sum + x.deducted_score, 0)
  return {
    score: computed,
    dimensions: normalized,
  }
}

function repair(list: z.infer<typeof item>[], source: string) {
  return list.map((x) =>
    x.deducted_score > 0 && x.evidence.length === 0
      ? {
          ...x,
          evidence: evidence(source),
        }
      : x,
  )
}

function system() {
  return [
    "你是严格的计划质量评审器，只负责打分，不负责改写内容。",
    "这不是普通闲聊质量评价，而是对“计划模式下被保存的一轮 user_input 与 model_reply”做质量评价。",
    "你要同时考虑两件事：表达本身是否清晰准确，以及这轮内容是否足够适合作为计划模式中的高质量输入/输出。",
    "你必须分别对 user_input 和 model_reply 做多维度百分制、扣分制评价。",
    "两个主体都以 100 分起评，只能扣分，不能加分。",
    "你的目标是判断表达质量和响应质量，而不是判断需求有没有价值、是否高级、是否符合你的偏好。",
    "只能依据当前轮 user 文本和被保存的 assistant plan 文本，不得引用历史轮次，不得臆造缺失上下文。",
    "用户输入评价重点：目标是否清晰、背景是否充分、约束是否明确、表述是否准确、是否存在歧义、表达是否高效，以及是否足以支撑计划模式下的有效响应。",
    "模型回复评价重点：是否准确理解用户意图、是否覆盖关键点、是否可直接执行、是否遵守约束、是否自洽正确、是否结构清晰，以及是否真的产出了适合计划模式保存的内容。",
    "如果用户输入很短，但已经足以表达意图，不要仅因为简短而在 goal_clarity 或 communication_efficiency 上机械扣分。",
    "但如果用户输入虽然能看懂，却没有提供任何任务背景、约束、对象，或根本不是计划任务输入，那么 context_completeness、constraint_specificity、domain_accuracy 仍应按事实扣分。",
    "如果用户输入只是问候、身份询问、闲聊、情绪表达，通常不应被视为高质量计划输入；除非它同时提供了明确任务上下文，否则总分一般不应接近满分。",
    "如果模型回复只是寒暄、自我介绍、泛泛追问，或者没有给出计划模式下可保存的高质量方案/分析，即使文字通顺，也应在 coverage_completeness、actionability、constraint_following 上扣分。",
    "满分非常严格。只有在几乎没有明显缺口、且非常适合作为计划模式保存内容时，才可以给接近 100 分。",
    "示例：若 user_input 只是“你是啥啊”，goal_clarity 可以少扣或不扣，但 context_completeness、constraint_specificity、domain_accuracy 通常应明显扣分，因为它不构成高质量计划输入。",
    "示例：若 model_reply 主要是自我介绍和继续追问，而没有提供计划方案或分析，即使答对了身份问题，也不应在计划模式评价里轻易拿到满分。",
    "每个维度都必须输出 deducted_score、reason、evidence。",
    "deducted_score 必须是整数，且不能超过该维度的 max_deduction。",
    "reason 必须具体说明为什么扣分；没有明显问题时，用“无明显扣分项”。",
    "evidence 必须是来自原文的短片段数组；只有发生扣分时 evidence 才必须非空。",
    "final_score 必须等于 max_deduction - deducted_score。",
    "user_input.score 必须等于 100 - sum(user_input.dimensions[*].deducted_score)。",
    "model_reply.score 必须等于 100 - sum(model_reply.dimensions[*].deducted_score)。",
    "major_issue_side 只能是 user_input、model_reply、both、none 四个值之一。",
    "输出必须是单个合法 JSON 对象，不要 markdown，不要代码块，不要额外说明。",
  ].join("\n")
}

function promptText(input: {
  plan_id: string
  session_id: string
  vho_feedback_no?: string
  user_message_id: string
  assistant_message_id: string
  user_text: string
  plan_text: string
}) {
  const lines = [
    "任务：请对本轮 user_input 与 model_reply 分别做多维度质量评价。",
    "注意：这是“计划模式保存质量评价”，不是普通聊天质量评价。",
    "评分总原则：",
    "1. 只根据给定文本评分，不补全未提供的背景。",
    "2. 只允许扣分，不允许加分。",
    "3. 扣分必须有证据，证据必须是原文短片段。",
    "4. 先判断表达是否清晰，再判断它是否足够适合作为计划模式下被保存的高质量内容。",
    "5. 不要因为用户问题简短、口语化而机械重罚；但如果它不提供计划所需背景/约束/对象，必须在相关维度扣分。",
    "6. 不要因为模型回复篇幅长或短而机械加减分；重点看是否答对、答全、可执行，并且是否真的适合在计划模式下保存。",
    "7. 若 user_input 只是问候、身份询问、闲聊、测试性输入，通常不应被评为高质量计划输入。",
    "8. 若 model_reply 主要是寒暄、自我介绍、泛泛追问，而不是计划方案/分析，即使可读，也不应轻易给高分。",
    "",
    `plan_id: ${input.plan_id}`,
    `session_id: ${input.session_id}`,
    `vho_feedback_no: ${input.vho_feedback_no ?? ""}`,
    `user_message_id: ${input.user_message_id}`,
    `assistant_message_id: ${input.assistant_message_id}`,
    "",
    "user_input 评分维度：",
    "- goal_clarity | 目标清晰度 | max_deduction=25 | 是否一眼能看出用户想解决什么问题、要什么结果",
    "- context_completeness | 背景完整性 | max_deduction=20 | 是否提供了必要背景、现状、对象、上下文",
    "- constraint_specificity | 约束明确性 | max_deduction=20 | 是否说明限制条件、边界、成功标准、格式要求",
    "- domain_accuracy | 领域准确性 | max_deduction=15 | 术语、对象、流程描述是否准确，不误导",
    "- ambiguity_control | 歧义控制 | max_deduction=10 | 是否存在多重解释、前后冲突、指代不清",
    "- communication_efficiency | 表达效率 | max_deduction=10 | 是否冗余、绕、信息密度过低；但简洁且清楚不扣分",
    "",
    "model_reply 评分维度：",
    "- intent_alignment | 意图理解准确性 | max_deduction=25 | 是否真正回答了用户这轮问题，没有答偏",
    "- coverage_completeness | 覆盖完整性 | max_deduction=20 | 是否覆盖关键问题点，没有遗漏核心要求",
    "- actionability | 可执行性 | max_deduction=20 | 是否给出可落地、可操作的方案或明确下一步",
    "- constraint_following | 约束遵循度 | max_deduction=15 | 是否遵守用户要求、边界和限制",
    "- consistency_correctness | 一致性与正确性 | max_deduction=10 | 是否逻辑自洽、事实和结论无明显错误",
    "- structure_readability | 结构可读性 | max_deduction=10 | 是否结构清晰、便于快速理解与执行",
    "",
    "当前轮用户输入：",
    input.user_text,
    "",
    "被保存的计划文本：",
    input.plan_text,
    "",
    "额外判分提示：",
    "- goal_clarity 看“用户要什么”是否明确，不等于整体就是高质量计划输入。",
    "- context_completeness / constraint_specificity / domain_accuracy 要真实反映这轮输入是否足以支撑计划模式工作。",
    "- 若用户输入与计划任务基本无关，即使表达清楚，也不能让 user_input.score 接近满分。",
    "- 若模型回复没有产出计划模式下应保存的实质内容，即使礼貌、通顺，也不能让 model_reply.score 接近满分。",
    "- 满分只留给真正高质量、几乎无缺口的计划输入或计划回复。",
    "",
    "输出 JSON schema：",
    JSON.stringify(
      {
        rubric_version: rubric,
        prompt_version: prompt,
        summary: "一句话总结本轮质量评价结论",
        major_issue_side: "user_input | model_reply | both | none",
        user_input: {
          score: 100,
          dimensions: user.map((dim) => ({
            code: dim.code,
            name: dim.name,
            max_deduction: dim.max,
            deducted_score: 0,
            final_score: dim.max,
            reason: "无明显扣分项",
            evidence: [],
          })),
        },
        model_reply: {
          score: 100,
          dimensions: reply.map((dim) => ({
            code: dim.code,
            name: dim.name,
            max_deduction: dim.max,
            deducted_score: 0,
            final_score: dim.max,
            reason: "无明显扣分项",
            evidence: [],
          })),
        },
      },
      null,
      2,
    ),
    "",
    "再次强调：只输出单个 JSON 对象，不要输出任何解释文字。",
  ]
  return lines.join("\n")
}

function extractObject(input: string) {
  const text = input.trim()
  const start = text.indexOf("{")
  if (start < 0) throw new Error("plan_eval_json_missing")
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") quoted = false
      continue
    }
    if (char === "\"") {
      quoted = true
      continue
    }
    if (char === "{") {
      depth += 1
      continue
    }
    if (char !== "}") continue
    depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  throw new Error("plan_eval_json_incomplete")
}

function int(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input)
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function strings(input: unknown) {
  if (Array.isArray(input)) return input.map((x) => String(x).trim()).filter(Boolean)
  if (typeof input === "string") {
    const value = input.trim()
    return value ? [value] : []
  }
  return []
}

function toRecord(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function cardFromRecord(
  dims: readonly { code: string; name: string; max: number }[],
  input: unknown,
) {
  const record = toRecord(input)
  const dimensions = dims.map((dim) => {
    const raw = toRecord(record[dim.code])
    const deducted_score = Math.max(0, Math.min(dim.max, int(raw.deducted_score)))
    return {
      code: dim.code,
      name: dim.name,
      max_deduction: dim.max,
      deducted_score,
      final_score: dim.max - deducted_score,
      reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "无明显扣分项",
      evidence: strings(raw.evidence),
    }
  })
  return {
    score: 100 - dimensions.reduce((sum, x) => sum + x.deducted_score, 0),
    dimensions,
  }
}

function cardFromList(
  dims: readonly { code: string; name: string; max: number }[],
  input: unknown,
) {
  const list = Array.isArray(input) ? input : []
  const map = new Map(
    list.map((item) => {
      const row = toRecord(item)
      return [String(row.dimension ?? row.code ?? ""), row] as const
    }),
  )
  const dimensions = dims.map((dim) => {
    const raw = map.get(dim.code) ?? {}
    const deducted_score = Math.max(0, Math.min(dim.max, int(raw.deducted_score)))
    return {
      code: dim.code,
      name: dim.name,
      max_deduction: dim.max,
      deducted_score,
      final_score: dim.max - deducted_score,
      reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "无明显扣分项",
      evidence: strings(raw.evidence),
    }
  })
  return {
    score: 100 - dimensions.reduce((sum, x) => sum + x.deducted_score, 0),
    dimensions,
  }
}

function coerceOutput(input: unknown) {
  const parsed = output.safeParse(input)
  if (parsed.success) return parsed.data
  const record = toRecord(input)
  const user_input =
    Array.isArray(record.user_input_scores)
      ? cardFromList(user, record.user_input_scores)
      : cardFromRecord(user, record.user_input_evaluation ?? record.user_input)
  const model_reply =
    Array.isArray(record.model_reply_scores)
      ? cardFromList(reply, record.model_reply_scores)
      : cardFromRecord(reply, record.model_reply_evaluation ?? record.model_reply)
  const major_issue_side = major({
    user_score: user_input.score,
    assistant_score: model_reply.score,
  })
  return output.parse({
    rubric_version: typeof record.rubric_version === "string" ? record.rubric_version : rubric,
    prompt_version: typeof record.prompt_version === "string" ? record.prompt_version : prompt,
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim()
        : "模型返回了兼容格式结果，已自动转换。",
    major_issue_side:
      record.major_issue_side === "user_input" ||
      record.major_issue_side === "model_reply" ||
      record.major_issue_side === "both" ||
      record.major_issue_side === "none"
        ? record.major_issue_side
        : major_issue_side,
    user_input,
    model_reply,
  })
}

async function model(input: { providerID: string; modelID: string; scoped: boolean; user_id: string; org_id: string; department_id?: string; project_id: string }) {
  const run = async () => {
    const found = await Provider.getModel(input.providerID, input.modelID)
    const language = await Provider.getLanguage(found)
    const auth = await Auth.get(found.providerID)
    return { found, language, auth }
  }
  if (!input.scoped) return run()
  return AccountCurrent.provide(
    {
      user_id: input.user_id,
      org_id: input.org_id,
      department_id: input.department_id,
      context_project_id: input.project_id,
      roles: [],
      permissions: [],
    },
    run,
  )
}

async function judge(input: {
  plan_id: string
  providerID: string
  modelID: string
  scoped: boolean
  user_id: string
  org_id: string
  department_id?: string
  project_id: string
  body: string
}) {
  const picked = await model(input)
  const messages = [
    { role: "system", content: system() },
    { role: "user", content: input.body },
  ] satisfies ModelMessage[]
  log.info("plan eval judge request", {
    plan_id: input.plan_id,
    providerID: input.providerID,
    modelID: input.modelID,
    body: input.body,
  })
  const params = {
    temperature: 0,
    messages,
    model: picked.language,
    schema: output,
  } satisfies Parameters<typeof generateObject>[0]

  if (picked.found.providerID === "openai" && picked.auth?.type === "oauth") {
    const result = streamObject({
      ...params,
      providerOptions: ProviderTransform.providerOptions(picked.found, {
        instructions: SystemPrompt.instructions(),
        store: false,
      }),
      onError: () => {},
    })
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error
    }
    return {
      providerID: picked.found.providerID,
      modelID: picked.found.id,
      request_body: input.body,
      response_text: JSON.stringify(result.object),
      response_mode: "object" as const,
      object: await result.object,
    }
  }

  try {
    const result = await generateObject(params)
    log.info("plan eval judge response", {
      plan_id: input.plan_id,
      providerID: picked.found.providerID,
      modelID: picked.found.id,
      mode: "object",
      text: JSON.stringify(result.object),
    })
      return {
        providerID: picked.found.providerID,
        modelID: picked.found.id,
        request_body: input.body,
        response_text: JSON.stringify(result.object),
        response_mode: "object" as const,
        object: coerceOutput(result.object),
      }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const parseLike =
      message.includes("No object generated") ||
      message.includes("could not parse the response") ||
      message.includes("JSON")
    if (!parseLike) throw error
    const result = await generateText({
      temperature: 0,
      model: picked.language,
      messages: [
        ...messages,
        {
          role: "user",
          content: "严格输出单个 JSON 对象，不要 markdown 代码块，不要额外解释。",
        },
      ],
    })
    try {
      const parsed = coerceOutput(JSON.parse(extractObject(result.text)))
      log.info("plan eval judge response", {
        plan_id: input.plan_id,
        providerID: picked.found.providerID,
        modelID: picked.found.id,
        mode: "text",
        text: result.text,
      })
      return {
        providerID: picked.found.providerID,
        modelID: picked.found.id,
        request_body: input.body,
        response_text: result.text,
        response_mode: "text" as const,
        object: parsed,
      }
    } catch (error) {
      throw new Error(`plan_eval_text_parse_failed: ${result.text}`)
    }
  }
}

async function choose(input: Start & { org_id: string; department_id?: string; project_id: string; user_message_id: string; assistant_message_id: string; user_text: string; plan_text: string }) {
  const picked = [
    { providerID: input.user_model_provider_id, modelID: input.user_model_id, scoped: true },
    { providerID: input.assistant_model_provider_id, modelID: input.assistant_model_id, scoped: true },
  ]
    .filter((x) => x.providerID && x.modelID)
    .filter((x, i, list) => list.findIndex((y) => y.providerID === x.providerID && y.modelID === x.modelID && y.scoped === x.scoped) === i)
  const errors = [] as string[]

  const body = promptText(input)
  const attempt = async (item: { providerID: string; modelID: string; scoped: boolean }) => {
    const result = await judge({
      ...item,
      plan_id: input.plan_id,
      user_id: input.user_id,
      org_id: input.org_id,
      department_id: input.department_id,
      project_id: input.project_id,
      body,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))
    if (!result.ok) {
      const error = result.error instanceof Error ? result.error.message : String(result.error)
      errors.push(`${item.providerID}/${item.modelID}: ${error}`)
      log.warn("plan eval judge failed", {
        plan_id: input.plan_id,
        providerID: item.providerID,
        modelID: item.modelID,
        scoped: item.scoped,
        error: result.error,
      })
      return
    }
    return result.value
  }
  for (const item of picked) {
    const judged = await attempt(item)
    if (!judged) continue
    return judged
  }
  const mirrored = await AccountCurrent.provide(
    {
      user_id: input.user_id,
      org_id: input.org_id,
      department_id: input.department_id,
      context_project_id: input.project_id,
      roles: [],
      permissions: [],
    },
    async () => {
      const providers = await Provider.list().catch(() => ({}))
      const account = await AccountProviderState.load(input.user_id).catch(() => undefined)
      if (!account) return [] as { providerID: string; modelID: string; scoped: boolean }[]
      const preferred = [input.user_model_id, input.assistant_model_id].filter(Boolean)
      return Object.entries(providers)
        .filter(([providerID]) => providerID !== input.user_model_provider_id && providerID !== input.assistant_model_provider_id)
        .filter(([providerID]) => account.providers[providerID]?.auth && !account.providers[providerID]?.disabled)
        .flatMap(([providerID, provider]) =>
          preferred
            .filter((modelID, index, list) => list.indexOf(modelID) === index)
            .filter((modelID) => !!provider.models[modelID])
            .map((modelID) => ({ providerID, modelID, scoped: true })),
        )
    },
  )
  for (const item of mirrored) {
    const judged = await attempt(item)
    if (!judged) continue
    return judged
  }
  const fallback = await AccountCurrent.provide(
    {
      user_id: input.user_id,
      org_id: input.org_id,
      department_id: input.department_id,
      context_project_id: input.project_id,
      roles: [],
      permissions: [],
    },
    () => Provider.defaultModel().catch(() => undefined),
  )
  if (!fallback) throw new Error("judge_model_unavailable")
  const judged = await attempt({
    providerID: fallback.providerID,
    modelID: fallback.modelID,
    scoped: true,
  })
  if (judged) return judged
  throw new Error(`judge_model_unavailable: ${errors.join(" | ")}`)
}

async function collect(input: Start) {
  const plan = await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, input.plan_id)).get())
  if (!plan) throw new Error("plan_eval_plan_missing")
  const session = await Database.use((db) =>
    db
      .select({
        project_id: SessionTable.project_id,
        context_project_id: SessionTable.context_project_id,
        directory: SessionTable.directory,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, plan.session_id))
      .get(),
  )
  const effective_project_id =
    input.context_project_id ??
    (plan.project_id !== "global" ? plan.project_id : undefined) ??
    session?.context_project_id ??
    session?.project_id ??
    plan.project_id
  const effective_project = await Project.get(effective_project_id).catch(() => undefined)
  const assistant = await MessageV2.get({
    sessionID: plan.session_id,
    messageID: plan.message_id,
  }).catch(() => undefined)
  if (!assistant || assistant.info.role !== "assistant") throw new Error("plan_eval_assistant_missing")
  const plan_text = plan.plan_content.trim()
  if (!plan_text) throw new Error("plan_eval_part_missing")
  const parent = await MessageV2.get({
    sessionID: plan.session_id,
    messageID: assistant.info.parentID,
  }).catch(() => undefined)
  if (!parent || parent.info.role !== "user") throw new Error("plan_eval_user_missing")
  const user_text = text(parent.parts)
  if (!user_text) throw new Error("plan_eval_user_text_missing")
  return {
    plan,
    project_id: effective_project_id,
    project_worktree: effective_project?.worktree ?? session?.directory ?? plan.project_worktree,
    user_message_id: parent.info.id,
    assistant_message_id: assistant.info.id,
    user_model_provider_id: parent.info.model.providerID,
    user_model_id: parent.info.model.modelID,
    assistant_model_provider_id: assistant.info.providerID,
    assistant_model_id: assistant.info.modelID,
    user_text,
    plan_text,
  }
}

async function save(input: {
  eval_id: string
  plan_id: string
  vho_feedback_no?: string
  user_text: string
  plan_text: string
  judged: {
    providerID: string
    modelID: string
    request_body: string
    response_text: string
    response_mode: "object" | "text"
    object: z.infer<typeof output>
  }
}) {
  const summary = input.judged.object.summary.trim()
  if (!summary) throw new Error("plan_eval_summary_missing")
  if (input.judged.object.rubric_version !== rubric) throw new Error("plan_eval_rubric_invalid")
  if (input.judged.object.prompt_version !== prompt) throw new Error("plan_eval_prompt_invalid")
  const user_card = normalize(user, repair(input.judged.object.user_input.dimensions, input.user_text), input.judged.object.user_input.score)
  const reply_card = normalize(reply, repair(input.judged.object.model_reply.dimensions, input.plan_text), input.judged.object.model_reply.score)
  const major_issue_side = major({
    user_score: user_card.score,
    assistant_score: reply_card.score,
  })
  const time_finished = Date.now()
  await Database.transaction(async (db) => {
    await db.delete(TpSavedPlanEvalItemTable).where(eq(TpSavedPlanEvalItemTable.eval_id, input.eval_id)).run()
    await db.update(TpSavedPlanEvalTable)
      .set({
        status: "completed",
        rubric_version: rubric,
        prompt_version: prompt,
        judge_provider_id: input.judged.providerID,
        judge_model_id: input.judged.modelID,
        user_score: user_card.score,
        assistant_score: reply_card.score,
        summary,
        major_issue_side,
        result_json: {
          rubric_version: rubric,
          prompt_version: prompt,
          summary,
          major_issue_side,
          user_input: user_card,
          model_reply: reply_card,
          debug: {
            request_body: input.judged.request_body,
            response_text: input.judged.response_text,
            response_mode: input.judged.response_mode,
            judge_provider_id: input.judged.providerID,
            judge_model_id: input.judged.modelID,
          },
        },
        error_code: null,
        error_message: null,
        time_finished,
        time_updated: time_finished,
      })
      .where(eq(TpSavedPlanEvalTable.id, input.eval_id))
      .run()
    await db.insert(TpSavedPlanEvalItemTable)
      .values(
        [user_card, reply_card].flatMap((card, idx) =>
          card.dimensions.map((dim, position) => ({
            id: ulid(),
            eval_id: input.eval_id,
            plan_id: input.plan_id,
            vho_feedback_no: input.vho_feedback_no,
            subject: idx === 0 ? "user_input" : "model_reply",
            dimension_code: dim.code,
            dimension_name: dim.name,
            max_deduction: dim.max_deduction,
            deducted_score: dim.deducted_score,
            final_score: dim.final_score,
            reason: dim.reason,
            evidence_json: dim.evidence,
            position,
            time_created: time_finished,
            time_updated: time_finished,
          })),
        ),
      )
      .run()
  })
}

async function fail(input: { plan_id: string; error: unknown }) {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const code = message.split(":")[0]
  const row = await Database.use((db) => db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, input.plan_id)).get())
  if (!row) return
  const status = code === "judge_model_unavailable" ? "skipped" : "failed"
  const now = Date.now()
  await Database.use((db) =>
    db.update(TpSavedPlanEvalTable)
      .set({
        status,
        error_code: code,
        error_message: message,
        time_finished: now,
        time_updated: now,
      })
      .where(eq(TpSavedPlanEvalTable.id, row.id))
      .run(),
  )
}

export namespace PlanEvalService {
  export function start(input: Start) {
    queueMicrotask(() => {
      void run(input)
        .catch(async (error) => {
          await fail({
            plan_id: input.plan_id,
            error,
          })
          log.error("plan eval run failed", {
            plan_id: input.plan_id,
            error,
          })
        })
    })
  }

  export async function run(input: Start) {
    const existing = await Database.use((db) => db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, input.plan_id)).get())
    if (existing && !input.retry) return
    if (existing && input.retry && !["failed", "skipped"].includes(existing.status)) throw new Error("plan_eval_retry_invalid")
    const now = Date.now()
    const eval_id = existing?.id ?? ulid()
    await Database.transaction(async (db) => {
      if (!existing) {
        await db.insert(TpSavedPlanEvalTable)
          .values({
            id: eval_id,
            plan_id: input.plan_id,
            vho_feedback_no: input.vho_feedback_no,
            user_id: input.user_id,
            session_id: input.session_id,
            user_message_id: "",
            assistant_message_id: input.message_id,
            part_id: input.part_id,
            status: "running",
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
        return
      }
      await db.delete(TpSavedPlanEvalItemTable).where(eq(TpSavedPlanEvalItemTable.eval_id, eval_id)).run()
      await db.update(TpSavedPlanEvalTable)
        .set({
          vho_feedback_no: input.vho_feedback_no,
          status: "running",
          judge_provider_id: null,
          judge_model_id: null,
          user_score: null,
          assistant_score: null,
          summary: null,
          major_issue_side: null,
          result_json: null,
          error_code: null,
          error_message: null,
          time_started: now,
          time_finished: null,
          time_updated: now,
        })
        .where(eq(TpSavedPlanEvalTable.id, eval_id))
        .run()
    })

    const picked = await collect(input)
    await Database.use((db) =>
      db.update(TpSavedPlanEvalTable)
        .set({
          user_message_id: picked.user_message_id,
          assistant_message_id: picked.assistant_message_id,
          result_json: {
            debug: {
              request_body: promptText({
                plan_id: input.plan_id,
                session_id: input.session_id,
                vho_feedback_no: input.vho_feedback_no,
                user_message_id: picked.user_message_id,
                assistant_message_id: picked.assistant_message_id,
                user_text: picked.user_text,
                plan_text: picked.plan_text,
              }),
            },
          },
          time_updated: Date.now(),
        })
        .where(eq(TpSavedPlanEvalTable.id, eval_id))
        .run(),
    )
    await Instance.provide({
      directory: picked.project_worktree,
      fn: async () => {
        const judged = await choose({
          ...input,
          org_id: picked.plan.org_id,
          department_id: picked.plan.department_id ?? undefined,
          project_id: picked.project_id,
          user_model_provider_id: picked.user_model_provider_id,
          user_model_id: picked.user_model_id,
          assistant_model_provider_id: picked.assistant_model_provider_id,
          assistant_model_id: picked.assistant_model_id,
          user_message_id: picked.user_message_id,
          assistant_message_id: picked.assistant_message_id,
          user_text: picked.user_text,
          plan_text: picked.plan_text,
        })
        await save({
          eval_id,
          plan_id: input.plan_id,
          vho_feedback_no: input.vho_feedback_no,
          user_text: picked.user_text,
          plan_text: picked.plan_text,
          judged,
        })
      },
    })
  }

  export async function retry(input: { plan_id: string; actor_user_id: string; context_project_id?: string }) {
    const row = await Database.use((db) => db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, input.plan_id)).get())
    if (!row) return { ok: false as const, code: "plan_eval_missing" as const }
    if (!["failed", "skipped"].includes(row.status)) return { ok: false as const, code: "plan_eval_retry_invalid" as const }
    const plan = await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, input.plan_id)).get())
    if (!plan) return { ok: false as const, code: "plan_eval_plan_missing" as const }
    if (plan.user_id !== input.actor_user_id) return { ok: false as const, code: "forbidden" as const }
    const assistant = await MessageV2.get({
      sessionID: plan.session_id,
      messageID: plan.message_id,
    }).catch(() => undefined)
    if (!assistant || assistant.info.role !== "assistant") {
      return { ok: false as const, code: "plan_eval_assistant_missing" as const }
    }
    const parent = await MessageV2.get({
      sessionID: plan.session_id,
      messageID: assistant.info.parentID,
    }).catch(() => undefined)
    if (!parent || parent.info.role !== "user") {
      return { ok: false as const, code: "plan_eval_user_missing" as const }
    }
    start({
      plan_id: plan.id,
      session_id: plan.session_id,
      user_id: plan.user_id,
      message_id: plan.message_id,
      part_id: plan.part_id,
      vho_feedback_no: plan.vho_feedback_no ?? undefined,
      user_model_provider_id: parent.info.model.providerID,
      user_model_id: parent.info.model.modelID,
      assistant_model_provider_id: assistant.info.providerID,
      assistant_model_id: assistant.info.modelID,
      context_project_id: input.context_project_id,
      retry: true,
    })
    return { ok: true as const, plan_id: plan.id }
  }

  export async function get(input: { plan_id: string; actor_user_id: string }) {
    const row = await Database.use((db) => db.select().from(TpSavedPlanEvalTable).where(eq(TpSavedPlanEvalTable.plan_id, input.plan_id)).get())
    if (!row) return { ok: false as const, code: "plan_eval_missing" as const }
    if (row.user_id !== input.actor_user_id) return { ok: false as const, code: "forbidden" as const }
    const items = await Database.use((db) =>
      db.select().from(TpSavedPlanEvalItemTable).where(eq(TpSavedPlanEvalItemTable.eval_id, row.id)).all(),
    )
    return {
      ok: true as const,
      eval: row,
      items,
    }
  }
}
