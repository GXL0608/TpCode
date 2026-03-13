import type { Message } from "@opencode-ai/sdk/v2/client"
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
import { resolveProjectByDirectory } from "@/context/project-resolver"
import { type ImageAttachmentPart, type Prompt, type VoiceAttachmentPart, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
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

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const statusCompensationTimers = new Map<string, number>()

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
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  /** 中文注释：异步发送成功后主动补拉消息，避免仅靠事件流时乐观消息长期停留。 */
  const refreshSessionMessages = (directory: string, sessionID: string) => {
    const run = () => sync.session.sync(sessionID).catch(() => undefined)
    void run()
    if (typeof window === "undefined") return
    window.setTimeout(() => {
      void run()
    }, 1200)
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

    const agent = currentAgent?.name ?? "build"
    const projectDirectory = routeDirectory() ?? decode(params.dir) ?? sdk.directory
    const routeID = params.id
    const isNewSession = !routeID
    const worktreeSelection = input.newSessionWorktree?.() || "main"

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
    if (!sessionID && !routeID) {
      const created = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        sessionID = created.id
        layout.handoff.setTabs(base64Encode(sessionDirectory), created.id)
        navigate(`/${base64Encode(sessionDirectory)}/session/${created.id}`)
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

    input.onSubmit?.()

    /** 中文注释：首次 build 切到新的 session worktree 后，立即把目录补进当前项目 sandboxes，并等待会话列表预加载完成，确保左侧工作区展开后立刻能看到 session。 */
    const registerWorkspace = async (directory: string) => {
      const project =
        resolveProjectByDirectory(globalSync.data.project, sessionDirectory) ??
        resolveProjectByDirectory(globalSync.data.project, projectDirectory)
      if (!project) return
      layout.sidebar.setWorkspaces(project.worktree, true)
      layout.sidebar.setWorkspaceExpanded(directory, true)
      globalSync.child(directory)
      await globalSync.project.loadSessions(directory)
      if (project.worktree === directory) return
      if ((project.sandboxes ?? []).includes(directory)) return
      globalSync.set(
        "project",
        produce((draft) => {
          const item = draft.find((entry) => entry.id === project.id)
          if (!item) return
          item.sandboxes = [...new Set([...(item.sandboxes ?? []), directory])]
        }),
      )
    }

    const switchDirectory = async (directory: string) => {
      await registerWorkspace(directory)
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
      refreshSessionMessages(sessionDirectory, sessionID)
      if (sessionDirectory !== projectDirectory) return
      sync.set("session_status", sessionID, { type: "busy" })
      if (typeof document === "undefined") return
      const key = `${sessionDirectory}\n${sessionID}`
      const existing = statusCompensationTimers.get(key)
      if (existing !== undefined) {
        clearTimeout(existing)
      }
      const timer = window.setTimeout(() => {
        statusCompensationTimers.delete(key)
        const status = sync.data.session_status[sessionID]
        if (status?.type !== "busy") return
        const [, setStore] = globalSync.child(sessionDirectory)
        client.session
          .status()
          .then((x) => {
            setStore("session_status", reconcile(x.data ?? {}))
          })
          .catch((error) => {
            console.error("[prompt-submit] failed to compensate session status", {
              directory: sessionDirectory,
              sessionID,
              error,
            })
          })
      }, 20_000)
      statusCompensationTimers.set(key, timer)
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

  return {
    abort,
    handleSubmit,
  }
}
