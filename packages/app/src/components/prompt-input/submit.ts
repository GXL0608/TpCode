import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate, useParams } from "@solidjs/router"
import type { Accessor } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { resolveProjectByDirectory } from "@/context/project-resolver"
import { type ImageAttachmentPart, type Prompt, type VoiceAttachmentPart, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useAccountAuth } from "@/context/account-auth"
import { AccountToken } from "@/utils/account-auth"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildToastDescription } from "@/components/build-job-summary"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

const forbidden = [
  { term: "rm -rf", pattern: /(?:^|\s)rm\s+-rf(?:\s|$)/i },
  { term: "drop table", pattern: /\bdrop\s+table\b/i },
  { term: "truncate table", pattern: /\btruncate\s+table\b/i },
  { term: "dump database", pattern: /\bdump\s+database\b/i },
  { term: "delete database", pattern: /\bdelete\s+database\b/i },
  { term: "删除数据库", pattern: /删除数据库/ },
  { term: "删除核心数据", pattern: /删除核心数据/ },
  { term: "删除全部数据", pattern: /删除(?:全部|所有)?数据/ },
  { term: "导出全部数据", pattern: /导出(?:全部|所有)?数据/ },
  { term: "修改管理员密码", pattern: /修改管理员密码/ },
  { term: "提升权限", pattern: /提升权限|提权/ },
]

function blocked(text: string) {
  return [...new Set(forbidden.filter((item) => item.pattern.test(text)).map((item) => item.term))]
}

function decode(value: string | undefined) {
  if (!value) return
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
    return decodeURIComponent(escape(atob(padded)))
  } catch {
    return
  }
}

function routeDirectory() {
  if (typeof window === "undefined") return
  const [, dir] = window.location.pathname.split("/")
  return decode(dir)
}

/** 中文注释：overlay 会话目录属于临时产品沙盒，不应被登记成用户长期可见的项目沙盒。 */
function hiddenWorkspaceDirectory(directory: string) {
  return /(?:^|[\\/])build-overlay(?:[\\/]|$)/i.test(directory)
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  currentRuntimeModel?: Accessor<{ providerID: string; modelID: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  clearDraft?: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  syncRuntimeModel?: (sessionID: string) => Promise<void>
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  onSubmit?: () => void
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

type BuildStageDetail = {
  stage?: string
  detail_json?: Record<string, unknown>
}

type BuildArtifactDetail = {
  id: string
  file_name: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const auth = useAccountAuth()
  const platform = usePlatform()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const server = useServer()
  const params = useParams()
  const statusCompensationTimers = new Map<string, number>()
  const fetcher = platform.fetch ?? globalThis.fetch

  /** 中文注释：账号模式下优先展示当前 session 已锁定的运行模型，避免乐观消息误显示为 managed/managed。 */
  const optimisticModel = () => {
    const runtime = input.currentRuntimeModel?.()
    if (runtime) return runtime
    const model = local.model.current()
    if (!model) return
    return {
      providerID: model.provider.id,
      modelID: model.id,
    }
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { name?: string; message?: string } }).data
      if (data?.name === "BuildMainWorktreeWriteDeniedError") {
        return language.t("toast.build.mainWorktreeWriteDenied.description")
      }
      if (data?.name === "BuildProtectedBranchPushDeniedError") {
        return language.t("toast.build.protectedBranchPushDenied.description")
      }
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  /** 中文注释：直接调用后端 build job 闭环接口，并在完成后返回构建会话目录，供前端跳转到执行会话。 */
  const runBuildPipeline = async (prompt_text: string, session_id?: string) => {
    const current = server.current
    const user = auth.user()
    if (!current || !user) return
    if (!user.permissions.includes("agent:use_build")) return
    const payload = await auth.contextProducts()
    const product =
      payload?.products?.find((item) => item.id === user.context_product_id) ??
      payload?.products?.find((item) => item.project_id === user.context_project_id)
    if (!product) return
    const token = AccountToken.access()
    if (!token) return
    const response = await fetcher(new URL("/build/job", current.http.url).toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product_id: product.id,
        source_type: "prompt",
        prompt_text,
        session_id,
        run_mode: "sync",
      }),
    })
    const body = (await response.json().catch(() => undefined)) as
      | {
          ok?: boolean
          code?: string
          error?: string
          detail?: {
            job?: {
              session_id?: string
              solution_scope?: string
            }
            session_directory?: string
            stages?: BuildStageDetail[]
            artifacts?: BuildArtifactDetail[]
          }
        }
      | undefined
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.code ?? body?.error ?? "build_pipeline_failed")
    }
    return {
      session_id: body.detail?.job?.session_id,
      session_directory: body.detail?.session_directory,
      solution_scope: body.detail?.job?.solution_scope,
      stages: body.detail?.stages ?? [],
      artifacts: body.detail?.artifacts ?? [],
    }
  }

  /** 中文注释：在本地 child store 里预写入新会话，避免首次 build 切目录时迁移不到 session 条目。 */
  const upsertSession = (directory: string, session: Session) => {
    const [store, setStore] = globalSync.child(directory)
    const next = [...store.session.filter((item) => item.id !== session.id), session].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    setStore("session", reconcile(next, { key: "id" }))
  }

  /** 中文注释：异步提示词在事件流丢失时也要能把回复补拉回来，因此这里按固定节奏轮询消息与状态。 */
  const refreshSessionMessages = (
    directory: string,
    sessionID: string,
    client: {
      session: {
        status: () => Promise<{ data?: Record<string, SessionStatus> }>
      }
    },
  ) => {
    const run = () => sync.session.syncAt({ directory, sessionID }).catch(() => undefined)
    void run()
    if (typeof window === "undefined") return
    const key = `${directory}\n${sessionID}`
    const existing = statusCompensationTimers.get(key)
    if (existing !== undefined) clearTimeout(existing)
    const schedule = [1200, 3000, 6000, 12000, 20000, 30000, 45000]
    const tick = (index: number) => {
      const timer = window.setTimeout(async () => {
        try {
          await run()
          const [, setStore] = globalSync.child(directory)
          const status = await client.session.status().then((result) => {
            setStore("session_status", reconcile(result.data ?? {}))
            return result.data?.[sessionID]
          })
          if (index > 0 && status?.type && status.type !== "busy") {
            statusCompensationTimers.delete(key)
            return
          }
        } catch {
          // 中文注释：补偿刷新不应打断当前会话，只在下一个轮次继续兜底。
        }
        if (index >= schedule.length - 1) {
          statusCompensationTimers.delete(key)
          return
        }
        tick(index + 1)
      }, schedule[index])
      statusCompensationTimers.set(key, timer)
    }
    tick(0)
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()
    const key = `${sdk.directory}\n${sessionID}`
    const timer = statusCompensationTimers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      statusCompensationTimers.delete(key)
    }

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("todo", sessionID, [])

    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      return Promise.resolve()
    }
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      prompt.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      prompt.context.remove(item.key)
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const voices = currentPrompt.filter((part): part is VoiceAttachmentPart => part.type === "voice")
    const mode = input.mode()

    if (text.trim().length === 0 && images.length === 0 && voices.length === 0 && input.commentCount() === 0) {
      if (input.working()) abort()
      return
    }
    if (text.trim().length === 0 && images.length === 0 && voices.length > 0 && input.commentCount() === 0) {
      showToast({
        title: language.t("prompt.toast.voiceNoSpeech.title"),
        description: language.t("prompt.toast.voiceNoSpeech.description"),
      })
      return
    }
    const terms = blocked(text)
    if (terms.length > 0) {
      showToast({
        title: "提示词被拦截",
        description: `该提示词不通过，包含禁用操作词：${terms.join("、")}`,
      })
      return
    }

    const currentAgent = local.agent.current()
    const selectedAgent = local.agent.selected?.()
    /** 中文注释：未显式选择模式时回到 plan，只有手动切到 build 才触发构建闭环。 */
    const agent = currentAgent?.name ?? "plan"
    const currentModel = local.model.current()
    const model =
      currentModel &&
      currentModel.provider.id &&
      currentModel.id &&
      !(currentModel.provider.id === "managed" && currentModel.id === "managed")
        ? {
            providerID: currentModel.provider.id,
            modelID: currentModel.id,
          }
        : undefined
    const variant = local.model.variant.current()

    if (!model) {
      showToast({
        title: language.t("toast.model.unavailable.title"),
        description: language.t("toast.model.unavailable.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()
    const projectDirectory = routeDirectory() ?? decode(params.dir) ?? sdk.directory
    const routeID = params.id
    const isNewSession = !routeID
    const worktreeSelection = input.newSessionWorktree?.() || "main"
    let createdWorkspace: { directory: string; branch?: string } | undefined

    let sessionDirectory = projectDirectory
    let client =
      projectDirectory === sdk.directory
        ? sdk.client
        : sdk.createClient({
            directory: projectDirectory,
            throwOnError: true,
          })

    if (isNewSession && agent !== "build") {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
        createdWorkspace = {
          directory: createdWorktree.directory,
          branch: createdWorktree.branch,
        }
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk.createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let sessionID = routeID ?? input.info()?.id

    /** 中文注释：首次 build 切到新的 session worktree 后，立即把目录补进当前项目 sandboxes，并等待会话列表预加载完成，确保左侧工作区展开后立刻能看到 session。 */
    const registerWorkspace = async (directory: string) => {
      const project =
        resolveProjectByDirectory(globalSync.data.project, sessionDirectory) ??
        resolveProjectByDirectory(globalSync.data.project, projectDirectory)
      if (!project) return
      if (!hiddenWorkspaceDirectory(directory) && project.worktree !== directory && !(project.sandboxes ?? []).includes(directory)) {
        globalSync.set(
          "project",
          produce((draft) => {
            const item = draft.find((entry) => entry.id === project.id)
            if (!item) return
            item.sandboxes = [...new Set([...(item.sandboxes ?? []), directory])]
          }),
        )
      }
      layout.sidebar.setWorkspaces(project.worktree, true)
      if (!hiddenWorkspaceDirectory(directory)) {
        layout.sidebar.setWorkspaceExpanded(directory, true)
      }
      globalSync.child(directory)
      await globalSync.project.loadSessions(directory)
    }

    const switchDirectory = async (directory: string, targetSessionID: string) => {
      const previousDirectory = sessionDirectory
      await registerWorkspace(directory)
      sync.session.migrate({
        from: previousDirectory,
        to: directory,
        sessionID: targetSessionID,
      })
      await sync.session.syncAt({
        directory,
        sessionID: targetSessionID,
      })
      await globalSync.project.loadSessions(directory)
      sessionDirectory = directory
      client =
        directory === projectDirectory
          ? sdk.client
          : sdk.createClient({
              directory,
              throwOnError: true,
            })
      layout.handoff.setTabs(base64Encode(directory), targetSessionID)
      navigate(`/${base64Encode(directory)}/session/${targetSessionID}`)
    }

    if (!sessionID && !routeID) {
      const ownedWorkspace = layout.handoff.workspace(sessionDirectory)
      const created = await client.session
        .create(createdWorkspace || ownedWorkspace ? { workspace: createdWorkspace ?? ownedWorkspace } : undefined)
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        const nextDirectory = created.directory || sessionDirectory
        upsertSession(nextDirectory, created)
        if (createdWorkspace || ownedWorkspace) layout.handoff.clearWorkspace(sessionDirectory)
        sessionID = created.id
        if (nextDirectory !== sessionDirectory) {
          /** 中文注释：新会话创建后优先切到服务端返回的真实目录，避免产品 overlay 会话继续停留在旧根目录路由。 */
          await switchDirectory(nextDirectory, created.id)
        } else {
          layout.handoff.setTabs(base64Encode(sessionDirectory), created.id)
          navigate(`/${base64Encode(sessionDirectory)}/session/${created.id}`)
        }
        await input.syncRuntimeModel?.(created.id)
      }
    }
    if (!sessionID) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    if (
      mode === "normal" &&
      selectedAgent?.name === "build" &&
      images.length === 0 &&
      voices.length === 0 &&
      input.commentCount() === 0
    ) {
      try {
        const created = await runBuildPipeline(text, sessionID)
        if (!created) {
          // 中文注释：非账号模式或上下文尚未准备好时，回退到原有会话式 build 流程。
        } else {
          input.clearDraft?.()
          prompt.reset()
          input.setMode("normal")
          input.setPopover(null)
          if (created.session_id && created.session_directory) {
            if (created.session_id === sessionID && created.session_directory !== sessionDirectory) {
              await switchDirectory(created.session_directory, created.session_id)
            } else if (created.session_id === sessionID) {
              /** 中文注释：同步构建直接复用当前会话且目录不变时，也要立即补拉消息和列表，避免用户看到“构建成功”但页面内容没有刷新。 */
              await sync.session.syncAt({
                directory: created.session_directory,
                sessionID: created.session_id,
              })
              await globalSync.project.loadSessions(created.session_directory)
            } else {
              navigate(`/${base64Encode(created.session_directory)}/session/${created.session_id}`)
            }
          }
          showToast({
            title: "构建闭环已完成",
            description: buildToastDescription(created ?? {}),
          })
          return
        }
      } catch (error) {
        showToast({
          title: "构建闭环执行失败",
          description: errorMessage(error),
        })
      }
    }

    input.onSubmit?.()

    const prepareBuild = async () => {
      if (agent !== "build") return true
      const prepared = await sdk.client.session
        .prepareBuild({ sessionID })
        .then((x) => x.data)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      const nextDirectory = prepared?.directory
      if (!nextDirectory) return false
      if (nextDirectory !== sessionDirectory) {
        await switchDirectory(nextDirectory, sessionID)
      }
      if (isNewSession) input.onNewSessionWorktreeReset?.()
      return true
    }

    if (mode === "normal" && !(await prepareBuild())) {
      return
    }

    const clearInput = () => {
      input.clearDraft?.()
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    if (mode === "shell") {
      if (!(await prepareBuild())) return
      clearInput()
      client.session
        .shell({
          sessionID,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      if (!(await prepareBuild())) return
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        client.session
          .command({
            sessionID,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: [
              ...images.map((attachment) => ({
                id: Identifier.ascending("part"),
                type: "file" as const,
                mime: attachment.mime,
                url: attachment.dataUrl,
                filename: attachment.filename,
              })),
              ...voices.map((attachment) => ({
                id: Identifier.ascending("part"),
                type: "file" as const,
                mime: attachment.mime,
                url: attachment.dataUrl,
                filename: attachment.filename,
                duration_ms: attachment.duration_ms,
                forModel: false,
              })),
            ],
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: errorMessage(err),
            })
            restoreInput()
          })
        return
      }
    }

    const context = prompt.context.items().slice()
    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())

    const messageID = Identifier.ascending("message")
    const { requestParts, optimisticParts } = buildRequestParts({
      prompt: currentPrompt,
      context,
      images,
      text,
      sessionID,
      messageID,
      sessionDirectory,
    })

    const optimisticMessage: Message = {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent,
      model: optimisticModel() ?? model,
    }

    const addOptimisticMessage = () =>
      sync.session.optimistic.add({
        directory: sessionDirectory,
        sessionID,
        message: optimisticMessage,
        parts: optimisticParts,
      })

    const removeOptimisticMessage = () =>
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID,
        messageID,
      })

    removeCommentItems(commentItems)
    clearInput()
    addOptimisticMessage()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", sessionID, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", sessionID, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(sessionID, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(sessionID)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    const send = async () => {
      const ok = await waitForWorktree()
      if (!ok) return
      /** 中文注释：对可选模型用户，在真正发消息前强制把当前选择同步到 session，避免模型切换与发送请求竞争。 */
      await input.syncRuntimeModel?.(sessionID)
      await client.session.promptAsync({
        sessionID,
        agent,
        messageID,
        model,
        variant,
        parts: requestParts,
      })
      refreshSessionMessages(sessionDirectory, sessionID, client)
      sync.set("session_status", sessionID, { type: "busy" })
    }

    void send().catch((err) => {
      pending.delete(sessionID)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", sessionID, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    })
  }

  /** 中文注释：发送一条固定系统提示词，不消费当前草稿与附件，专供“编译打包”等系统动作按钮复用。 */
  const submitFixedText = async (text: string) => {
    if (!text.trim()) return

    const currentAgent = local.agent.current()
    const currentModel = local.model.current()
    const model =
      currentModel &&
      currentModel.provider.id &&
      currentModel.id &&
      !(currentModel.provider.id === "managed" && currentModel.id === "managed")
        ? {
            providerID: currentModel.provider.id,
            modelID: currentModel.id,
          }
        : undefined
    const variant = local.model.variant.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.unavailable.title"),
        description: language.t("toast.model.unavailable.description"),
      })
      return
    }

    /** 中文注释：固定提示词动作默认也回到 plan，避免用户未切 build 时误触发构建流程。 */
    const agent = currentAgent?.name ?? "plan"
    const projectDirectory = routeDirectory() ?? decode(params.dir) ?? sdk.directory
    const sessionID = params.id ?? input.info()?.id
    if (!sessionID) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    let sessionDirectory = projectDirectory
    let client =
      projectDirectory === sdk.directory
        ? sdk.client
        : sdk.createClient({
            directory: projectDirectory,
            throwOnError: true,
          })

    const registerWorkspace = async (directory: string) => {
      const project =
        resolveProjectByDirectory(globalSync.data.project, sessionDirectory) ??
        resolveProjectByDirectory(globalSync.data.project, projectDirectory)
      if (!project) return
      if (project.worktree !== directory && !(project.sandboxes ?? []).includes(directory)) {
        globalSync.set(
          "project",
          produce((draft) => {
            const item = draft.find((entry) => entry.id === project.id)
            if (!item) return
            item.sandboxes = [...new Set([...(item.sandboxes ?? []), directory])]
          }),
        )
      }
      layout.sidebar.setWorkspaces(project.worktree, true)
      layout.sidebar.setWorkspaceExpanded(directory, true)
      globalSync.child(directory)
      await globalSync.project.loadSessions(directory)
    }

    const switchDirectory = async (directory: string) => {
      const previousDirectory = sessionDirectory
      await registerWorkspace(directory)
      sync.session.migrate({
        from: previousDirectory,
        to: directory,
        sessionID,
      })
      await sync.session.syncAt({
        directory,
        sessionID,
      })
      await globalSync.project.loadSessions(directory)
      sessionDirectory = directory
      client =
        directory === projectDirectory
          ? sdk.client
          : sdk.createClient({
              directory,
              throwOnError: true,
            })
      layout.handoff.setTabs(base64Encode(directory), sessionID)
      navigate(`/${base64Encode(directory)}/session/${sessionID}`)
    }

    const prepareBuild = async () => {
      if (agent !== "build") return true
      const prepared = await sdk.client.session
        .prepareBuild({ sessionID })
        .then((x) => x.data)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      const nextDirectory = prepared?.directory
      if (!nextDirectory) return false
      if (nextDirectory !== sessionDirectory) {
        await switchDirectory(nextDirectory)
      }
      return true
    }

    if (!(await prepareBuild())) return

    const messageID = Identifier.ascending("message")
    const syntheticPrompt: Prompt = [
      {
        type: "text",
        content: text,
        start: 0,
        end: text.length,
      },
    ]
    const { requestParts, optimisticParts } = buildRequestParts({
      prompt: syntheticPrompt,
      context: [],
      images: [],
      text,
      sessionID,
      messageID,
      sessionDirectory,
    })

    const optimisticMessage: Message = {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent,
      model: optimisticModel() ?? model,
    }

    const addOptimisticMessage = () =>
      sync.session.optimistic.add({
        directory: sessionDirectory,
        sessionID,
        message: optimisticMessage,
        parts: optimisticParts,
      })

    const removeOptimisticMessage = () =>
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID,
        messageID,
      })

    addOptimisticMessage()

    const send = async () => {
      await input.syncRuntimeModel?.(sessionID)
      await client.session.promptAsync({
        sessionID,
        agent,
        messageID,
        model,
        variant,
        parts: requestParts,
      })
      refreshSessionMessages(sessionDirectory, sessionID, client)
      sync.set("session_status", sessionID, { type: "busy" })
    }

    void send().catch((err) => {
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", sessionID, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
    })
  }

  return {
    abort,
    handleSubmit,
    submitFixedText,
  }
}
