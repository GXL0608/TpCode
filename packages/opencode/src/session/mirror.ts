import * as AI from "ai"
import type { ModelMessage } from "ai"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { AccountCurrent } from "@/user/current"
import { AccountSystemSettingService } from "@/user/system-setting"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { SessionModelCall } from "./model-call"
import { SystemPrompt } from "./system"
import { Log } from "@/util/log"
import { mergeDeep } from "remeda"
import { Installation } from "@/installation"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "session.mirror" })

type MirrorUsage = Record<string, unknown>

/** 中文注释：从学生模型结果中提取可落库的思考文本，兼容不同 SDK 返回字段。 */
function reasoning(input: unknown) {
  if (!input || typeof input !== "object") return ""
  const value =
    ("reasoning" in input && input.reasoning) ||
    ("reasoningText" in input && input.reasoningText) ||
    ("reasoning_text" in input && input.reasoning_text)
  return typeof value === "string" ? value : ""
}

/** 中文注释：仅允许 plan/build 主会话触发学生模型镜像采样。 */
function enabledAgent(agent: string) {
  return agent === "plan" || agent === "build"
}

/** 中文注释：把当前账号上下文降级为仅使用系统级 provider 配置，避免误用个人渠道配置。 */
function withGlobalScope<T>(fn: () => Promise<T>) {
  const current = AccountCurrent.optional()
  if (!current) return fn()
  return AccountCurrent.provide(
    {
      ...current,
      roles: [],
      permissions: [],
    },
    fn,
  )
}

/** 中文注释：读取当前全局学生镜像模型配置。 */
async function mirrorModel() {
  const control = await AccountSystemSettingService.providerControl()
  if (!control.mirror_model) return
  return withGlobalScope(() => Provider.getModel(control.mirror_model!.provider_id, control.mirror_model!.model_id))
}

/** 中文注释：截取到当前教师用户消息为止的会话历史，并转换为标准模型消息。 */
async function snapshot(input: { sessionID: string; userMessageID: string; model: Provider.Model }) {
  const all = await Session.messages({ sessionID: input.sessionID })
  const until = all.findIndex((item) => item.info.id === input.userMessageID)
  if (until < 0) return [] as ModelMessage[]
  return MessageV2.toModelMessages(all.slice(0, until + 1), input.model)
}

/** 中文注释：组装学生模型非流式调用所需的系统提示、消息、请求头和 provider 选项。 */
async function request(input: {
  sessionID: string
  agentName: string
  user: MessageV2.User
  model: Provider.Model
  messages: ModelMessage[]
}) {
  const [agent, language, provider, auth] = await Promise.all([
    Agent.get(input.agentName),
    withGlobalScope(() => Provider.getLanguage(input.model)),
    withGlobalScope(() => Provider.getProvider(input.model.providerID)),
    withGlobalScope(() => Auth.get(input.model.providerID)),
  ])
  const isCodex = provider.id === "openai" && auth?.type === "oauth"
  const options = mergeDeep(
    ProviderTransform.options({
      model: input.model,
      sessionID: input.sessionID,
      providerOptions: provider.options,
    }),
    mergeDeep(input.model.options, agent.options),
  ) as Record<string, unknown>
  if (isCodex) options.instructions = SystemPrompt.instructions()
  const system = [
    ...(agent.prompt ? [agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
    ...(await SystemPrompt.environment(input.model)),
  ]
  const headers =
    input.model.providerID.startsWith("opencode")
      ? {
          "x-opencode-project": Instance.project.id,
          "x-opencode-session": input.sessionID,
          "x-opencode-request": input.user.id,
          "x-opencode-client": Flag.OPENCODE_CLIENT,
        }
      : input.model.providerID !== "anthropic"
        ? {
            "User-Agent": `opencode/${Installation.VERSION}`,
          }
        : {}
  const maxOutputTokens =
    isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

  return {
    language,
    system,
    headers,
    options,
    maxOutputTokens,
    temperature: input.model.capabilities.temperature
      ? (agent.temperature ?? ProviderTransform.temperature(input.model))
      : undefined,
    topP: agent.topP ?? ProviderTransform.topP(input.model),
    messages: [
      ...system.map(
        (content): ModelMessage => ({
          role: "system",
          content,
        }),
      ),
      ...input.messages,
    ],
  }
}

/** 中文注释：执行一条镜像采样记录的学生模型非流式调用。 */
async function run(input: {
  recordID: string
  sessionID: string
  teacher: MessageV2.User
  student: Provider.Model
  messages: ModelMessage[]
}) {
  try {
    const prepared = await request({
      sessionID: input.sessionID,
      agentName: input.teacher.agent,
      user: input.teacher,
      model: input.student,
      messages: input.messages,
    })
    const result = await SessionModelCall.provideCapture(
      {
        recordID: input.recordID,
        role: "student",
      },
      () =>
        AI.generateText({
          model: prepared.language,
          temperature: prepared.temperature,
          topP: prepared.topP,
          headers: {
            ...input.student.headers,
            ...prepared.headers,
          },
          maxRetries: 0,
          maxOutputTokens: prepared.maxOutputTokens,
          providerOptions: ProviderTransform.providerOptions(input.student, prepared.options),
          messages: prepared.messages,
        }),
    )
    SessionModelCall.completeStudent({
      recordID: input.recordID,
      responseText: result.text,
      reasoningText: reasoning(result),
      usage: (result as { usage?: MirrorUsage }).usage,
    })
  } catch (error) {
    SessionModelCall.completeStudent({
      recordID: input.recordID,
      responseText: "",
      reasoningText: "",
      usage: null,
      error,
    })
    log.warn("mirror run failed", {
      sessionID: input.sessionID,
      id: input.recordID,
      error,
    })
  }
}

export namespace SessionMirror {
  /** 中文注释：在主会话成功接收用户消息后，后台异步补写学生模型数据到统一记录表。 */
  export async function schedule(input: { recordID?: string; sessionID: string; message: MessageV2.WithParts }) {
    if (!input.recordID) return
    const info = input.message.info
    if (info.role !== "user") return
    if (!enabledAgent(info.agent)) return
    const student = await mirrorModel().catch((error) => {
      log.warn("mirror model unavailable", {
        sessionID: input.sessionID,
        error,
      })
      return
    })
    if (!student) return
    const messages = await snapshot({
      sessionID: input.sessionID,
      userMessageID: info.id,
      model: student,
    })
    SessionModelCall.bindStudent({
      recordID: input.recordID,
      providerID: student.providerID,
      modelID: student.id,
    })
    void run({
      recordID: input.recordID,
      sessionID: input.sessionID,
      teacher: info,
      student,
      messages,
    })
  }
}
