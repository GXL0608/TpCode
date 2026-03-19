#!/usr/bin/env bun

type LoginResult = {
  ok: boolean
  access_token?: string
  refresh_token?: string
  user?: {
    context_product_id?: string
    context_project_id?: string
  }
  code?: string
}

type ProductItem = {
  id: string
  name: string
}

type SessionInfo = {
  id: string
  directory: string
  title: string
}

type MessageResponse = {
  info: {
    id: string
    role?: string
    finish?: string
    parentID?: string
  }
  parts: Array<{
    id: string
    type: string
    text?: string
  }>
}

type MessageList = MessageResponse[]

type SavedPlanResult = {
  ok: boolean
  id?: string
  code?: string
}

type BuildCreateResult = {
  ok: boolean
  job?: {
    id: string
  }
  code?: string
}

type BuildDetail = {
  job: {
    id: string
    status: string
    current_stage?: string
    error_code?: string
    error_message?: string
  }
  stages: Array<{
    stage: string
    status: string
    detail_json?: Record<string, unknown>
    error_code?: string
    error_message?: string
  }>
  artifacts: Array<{
    file_name: string
    file_path: string
    solution_id?: string
  }>
}

const base = (process.env["TPCODE_SMOKE_URL"] ?? "http://127.0.0.1:4108").replace(/\/$/, "")
const username = process.env["TPCODE_SMOKE_USERNAME"] ?? "admin"
const password = process.env["TPCODE_SMOKE_PASSWORD"] ?? "TpCode@2026"
const productName = process.env["TPCODE_SMOKE_PRODUCT"] ?? "CSHIS"
const promptText =
  process.env["TPCODE_SMOKE_PROMPT"] ??
  "请生成一个最小闭环计划：在 CSHIS 登录窗体中新增一个名为 CSHIS闭环测试 的提示标签，只给出清晰的实施计划。"
const pollIntervalMs = Number(process.env["TPCODE_SMOKE_POLL_INTERVAL_MS"] ?? "2000")
const pollTimeoutMs = Number(process.env["TPCODE_SMOKE_POLL_TIMEOUT_MS"] ?? "900000")
const allowFailureCode = process.env["TPCODE_SMOKE_ALLOW_FAILURE_CODE"]?.trim()

/** 中文注释：统一打印带时间戳的 smoke 过程日志，方便在 Windows 节点直接看出当前卡在哪一步。 */
function note(step: string, detail?: Record<string, unknown>) {
  const payload = detail ? ` ${JSON.stringify(detail, null, 2)}` : ""
  console.log(`[${new Date().toISOString()}] ${step}${payload}`)
}

/** 中文注释：统一发起 JSON 请求，并在失败时保留响应体，便于直接定位后端返回的错误码。 */
async function json<T>(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
}) {
  const response = await fetch(`${base}${input.path}`, {
    method: input.method ?? (input.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  if (response.ok) return body as T
  throw new Error(`${input.path} -> ${response.status} ${text}`)
}

/** 中文注释：登录并拿到 access token，后续所有产品、会话、构建操作都复用这条正式登录链。 */
async function login() {
  note("开始登录", { base, username })
  const result = await json<LoginResult>({
    path: "/account/login",
    body: {
      username,
      password,
    },
  })
  if (!result.ok || !result.access_token) {
    throw new Error(`登录失败: ${JSON.stringify(result)}`)
  }
  note("登录成功", {
    context_product_id: result.user?.context_product_id,
    context_project_id: result.user?.context_project_id,
  })
  return result.access_token
}

/** 中文注释：按产品名称选择用户要测试的产品，确保 smoke 不依赖手工在前端点选。 */
async function selectProduct(token: string) {
  const products = await json<{ products: ProductItem[] }>({
    path: "/account/context/products",
    token,
  })
  const product = products.products.find((item) => item.name === productName)
  if (!product) {
    throw new Error(`未找到产品: ${productName}`)
  }
  note("找到产品", { product_id: product.id, product_name: product.name })
  const selected = await json<LoginResult>({
    path: "/account/context/select",
    token,
    body: {
      product_id: product.id,
    },
  })
  if (!selected.ok || !selected.access_token) {
    throw new Error(`产品切换失败: ${JSON.stringify(selected)}`)
  }
  note("切换产品成功", {
    product_id: product.id,
    context_product_id: selected.user?.context_product_id,
    context_project_id: selected.user?.context_project_id,
  })
  return {
    token: selected.access_token,
    product_id: product.id,
  }
}

/** 中文注释：创建会话，让后端按当前产品上下文自动进入产品级 overlay 工作区。 */
async function createSession(token: string) {
  const session = await json<SessionInfo>({
    path: "/session",
    token,
    body: {},
  })
  note("创建会话成功", {
    session_id: session.id,
    directory: session.directory,
    title: session.title,
  })
  return session
}

/** 中文注释：查询当前会话消息列表，供异步计划 smoke 轮询 assistant 消息完成状态。 */
async function messages(token: string, sessionID: string) {
  return await json<MessageList>({
    path: `/session/${encodeURIComponent(sessionID)}/message?limit=50`,
    token,
  })
}

/** 中文注释：按真实前端链路使用 prompt_async 发起计划生成，避免被 nginx 对长连接同步请求截断。 */
async function createPlan(token: string, session: SessionInfo) {
  note("开始生成计划", {
    session_id: session.id,
    prompt_text: promptText,
  })
  const before = await messages(token, session.id)
  const beforeIDs = new Set(before.map((item) => item.info.id))
  await json<void>({
    path: `/session/${encodeURIComponent(session.id)}/prompt_async`,
    method: "POST",
    token,
    body: {
      agent: "plan",
      parts: [
        {
          type: "text",
          text: promptText,
        },
      ],
    },
  })
  const started = Date.now()
  while (Date.now() - started < pollTimeoutMs) {
    const current = await messages(token, session.id)
    const message = current
      .filter((item) => !beforeIDs.has(item.info.id))
      .filter((item) => item.info.role === "assistant")
      .sort((a, b) => a.info.id.localeCompare(b.info.id))
      .at(-1)
    if (!message) {
      await Bun.sleep(pollIntervalMs)
      continue
    }
    if (!message.info.finish || message.info.finish === "tool-calls") {
      await Bun.sleep(pollIntervalMs)
      continue
    }
    const part = message.parts.find((item) => item.type === "text") ?? message.parts[0]
    if (!part?.id) {
      throw new Error(`计划消息缺少可保存 part: ${JSON.stringify(message)}`)
    }
    note("计划生成成功", {
      message_id: message.info.id,
      part_id: part.id,
      finish: message.info.finish,
      preview: part.text?.slice(0, 160),
    })
    return {
      message_id: message.info.id,
      part_id: part.id,
    }
  }
  throw new Error(`计划生成超时: ${session.id}`)
}

/** 中文注释：把当前计划落到 tp_saved_plan，为构建中心执行做真实输入。 */
async function savePlan(token: string, session: SessionInfo, message: { message_id: string; part_id: string }) {
  const result = await json<SavedPlanResult>({
    path: "/account/plan/save",
    token,
    body: {
      session_id: session.id,
      message_id: message.message_id,
      part_id: message.part_id,
    },
  })
  if (!result.ok || !result.id) {
    throw new Error(`保存计划失败: ${JSON.stringify(result)}`)
  }
  note("保存计划成功", {
    saved_plan_id: result.id,
  })
  return result.id
}

/** 中文注释：创建异步 build job，让后端按真实构建中心链路继续执行 coding、compile、package。 */
async function createBuildJob(token: string, product_id: string, saved_plan_id: string) {
  const result = await json<BuildCreateResult>({
    path: "/build/job",
    token,
    body: {
      source_type: "saved_plan",
      product_id,
      saved_plan_id,
      run_mode: "async",
    },
  })
  if (!result.ok || !result.job?.id) {
    throw new Error(`创建构建任务失败: ${JSON.stringify(result)}`)
  }
  note("创建构建任务成功", {
    job_id: result.job.id,
  })
  return result.job.id
}

/** 中文注释：轮询 build job，持续输出阶段状态和关键路径信息，方便在后台运行时也能看到真实进度。 */
async function waitBuild(token: string, job_id: string) {
  const started = Date.now()
  let last = ""
  while (Date.now() - started < pollTimeoutMs) {
    const detail = await json<BuildDetail>({
      path: `/build/job/${encodeURIComponent(job_id)}`,
      token,
    })
    const summary = `${detail.job.status}:${detail.job.current_stage ?? ""}:${detail.job.error_code ?? ""}`
    if (summary !== last) {
      const coding = detail.stages.find((item) => item.stage === "coding")
      const compile = detail.stages.find((item) => item.stage === "compile")
      note("构建任务状态更新", {
        job_id,
        status: detail.job.status,
        current_stage: detail.job.current_stage,
        error_code: detail.job.error_code,
        coding: coding?.detail_json,
        compile: compile?.detail_json,
      })
      last = summary
    }
    if (detail.job.status === "completed") return detail
    if (detail.job.status === "failed") return detail
    await Bun.sleep(pollIntervalMs)
  }
  throw new Error(`构建任务轮询超时: ${job_id}`)
}

const token = await login()
const selected = await selectProduct(token)
const session = await createSession(selected.token)
const message = await createPlan(selected.token, session)
const saved_plan_id = await savePlan(selected.token, session, message)
const job_id = await createBuildJob(selected.token, selected.product_id, saved_plan_id)
const detail = await waitBuild(selected.token, job_id)

note("闭环 smoke 结束", {
  session_id: session.id,
  saved_plan_id,
  job_id,
  status: detail.job.status,
  current_stage: detail.job.current_stage,
  error_code: detail.job.error_code,
  error_message: detail.job.error_message,
  artifacts: detail.artifacts.map((item) => ({
    file_name: item.file_name,
    file_path: item.file_path,
  })),
})

if (detail.job.status !== "completed") {
  if (allowFailureCode && detail.job.error_code === allowFailureCode) {
    note("命中允许的失败码，按预期结束", {
      allow_failure_code: allowFailureCode,
    })
    process.exitCode = 0
    process.exit()
  }
  process.exitCode = 1
}
