import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, onCleanup, Switch, Match, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  VoiceAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { Button } from "@opencode-ai/ui/button"
import { DockShellForm, DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { uuid } from "@/utils/uuid"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useAccountAuth } from "@/context/account-auth"
import { useAccountProject } from "@/context/account-project"
import { useAccountRequest } from "./settings-account-api"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import { createPromptAttachments, ACCEPTED_FILE_TYPES } from "./prompt-input/attachments"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  promptLength,
} from "./prompt-input/history"
import { createPromptSubmit } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type SlashCommand } from "./prompt-input/slash-popover"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { PromptVoiceAttachments } from "./prompt-input/voice-attachments"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { shouldClearVoiceDraft, shouldResetPromptDraft } from "./prompt-input/draft"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { canUseRuntimeModelSelector } from "./prompt-input/runtime-model-access"
import { buildPromptDockFlags } from "./prompt-input/dock-actions"
import { canUseBuildCapability } from "@/utils/account-build-access"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { createSpeechRecognition } from "@/utils/speech"
import { DialogVhoFeedback } from "./dialog-vho-feedback"
import {
  buildVhoFeedbackPrompt,
  findAssignedVhoProject,
  vhoFeedbackApplyFailure,
} from "./vho-feedback"
import { base64Encode } from "@opencode-ai/util/encode"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  onSubmit?: () => void
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

const MAX_VOICE_DURATION_MS = 60_000
const MAX_VOICE_BYTES = 3 * 1024 * 1024
const VOICE_MIME_FALLBACK = "audio/webm"
const SPEECH_LOCALE: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  zht: "zh-TW",
  ko: "ko-KR",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  da: "da-DK",
  ja: "ja-JP",
  pl: "pl-PL",
  ru: "ru-RU",
  ar: "ar-SA",
  no: "nb-NO",
  br: "pt-BR",
  th: "th-TH",
  bs: "bs-BA",
  tr: "tr-TR",
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const layout = useLayout()
  const accountProject = useAccountProject()
  const comments = useComments()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  const platform = usePlatform()
  const auth = useAccountAuth()
  const accountRequest = useAccountRequest()
  const accountID = auth.user()?.id ?? "anonymous"
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let chunks: Blob[] = []
  let timer: number | undefined
  let startedAt = 0
  let finalizing = false
  let voiceRun = 0
  let activeVoiceRun = 0

  const mirror = { input: false }
  const inset = 44
  const speech = createSpeechRecognition()

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image" && part.type !== "voice"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = () => {
    requestAnimationFrame(scrollCursorIntoView)
  }

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  const commentInReview = (path: string) => {
    const sessionID = params.id
    if (!sessionID) return false

    const diffs = sync.data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const queueCommentFocus = (attempts = 6) => {
      const schedule = (left: number) => {
        requestAnimationFrame(() => {
          comments.setFocus({ ...focus })
          if (left <= 0) return
          requestAnimationFrame(() => {
            const current = comments.focus()
            if (!current) return
            if (current.file !== focus.file || current.id !== focus.id) return
            schedule(left - 1)
          })
        })
      }

      schedule(attempts)
    }

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
      layout.fileTree.setTab("changes")
      tabs().setActive("review")
      queueCommentFocus()
      return
    }

    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    tabs().open(tab)
    tabs().setActive(tab)
    Promise.resolve(files.load(item.path)).finally(() => queueCommentFocus())
  }

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = tabs().active()
    const order = active ? [active, ...all.filter((x) => x !== active)] : all
    const seen = new Set<string>()
    const paths: string[] = []

    for (const tab of order) {
      const path = files.pathFromTab(tab)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }

    return paths
  })
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const canSelectRuntimeModel = createMemo(() =>
    canUseRuntimeModelSelector({
      hasBuild: canUseBuildCapability(auth.user()),
      isSuperAdmin: (auth.user()?.roles ?? []).includes("super_admin"),
      agent: local.agent.current()?.name,
    }),
  )
  const dockFlags = createMemo(() =>
    buildPromptDockFlags({
      agent: local.agent.current()?.name,
      session_id: params.id,
      can_select_runtime_model: canSelectRuntimeModel(),
    }),
  )
  const [runtimeValue, setRuntimeValue] = createSignal("__auto__")
  const [runtimeOptions, setRuntimeOptions] = createSignal<Array<{ value: string; label: string }>>([])
  const status = createMemo(
    () =>
      sync.data.session_status[params.id ?? ""] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )
  const voiceAttachments = createMemo(() =>
    prompt.current().filter((part): part is VoiceAttachmentPart => part.type === "voice"),
  )
  const [voicePhase, setVoicePhase] = createSignal<"idle" | "recording" | "transcribing" | "failed">("idle")
  const [voiceError, setVoiceError] = createSignal("")
  const supportsVoiceCapture = () =>
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  const voiceUnsupportedDescription = () => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "当前页面不是 HTTPS 安全上下文，手机浏览器会禁用麦克风。请使用 HTTPS 域名访问。"
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      return "当前浏览器不支持麦克风采集接口。"
    }
    if (typeof MediaRecorder === "undefined") {
      return "当前浏览器不支持录音能力。建议使用最新版 Chrome 或 Safari。"
    }
    return language.t("prompt.toast.voiceUnsupported.description")
  }
  const supportsSpeech = () => speech.isSupported()
  const clearVoiceTimer = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  const clearVoiceDraft = () => {
    voiceRun += 1
    clearVoiceTimer()
    const active = recorder
    recorder = undefined
    if (active && active.state !== "inactive") {
      active.ondataavailable = null
      active.onerror = null
      active.onstop = null
      active.stop()
    }
    chunks = []
    startedAt = 0
    finalizing = false
    speech.stop()
    speech.reset()
    clearVoiceStream()
    setVoiceError("")
    setVoicePhase("idle")
  }
  const clearVoiceStream = () => {
    if (!stream) return
    for (const track of stream.getTracks()) {
      track.stop()
    }
    stream = undefined
  }
  const pickVoiceMime = () => {
    if (typeof MediaRecorder === "undefined") return
    const preferred = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ]
    return preferred.find((item) => MediaRecorder.isTypeSupported(item))
  }

  /** 中文注释：把选择器值拆成 providerID 和 modelID。 */
  const parseRuntimeValue = (value: string) => {
    const [providerID, ...rest] = value.split("/")
    const modelID = rest.join("/")
    if (!providerID || !modelID) return
    return { providerID, modelID }
  }

  const transcribeVoice = async (input: { mime: string; dataUrl: string }) => {
    const selected = runtimeValue() !== "__auto__" ? parseRuntimeValue(runtimeValue()) : undefined
    const model = selected ?? info()?.runtime_model
    const result = await sdk.client.session
      .voiceTranscribe({
        mime: input.mime,
        data_url: input.dataUrl,
        providerID: model?.providerID,
        modelID: model?.modelID,
      })
      .then((response) => response.data)
      .catch(() => undefined)
    return result?.text?.trim() ?? ""
  }

  /** 中文注释：把当前选择同步到 session 手动模型接口。 */
  const updateRuntimeModel = async (sessionID: string, value: string) => {
    if (value === "__auto__") {
      const response = await accountRequest({
        method: "DELETE",
        path: `/session/${encodeURIComponent(sessionID)}/runtime-model?directory=${encodeURIComponent(sdk.directory)}`,
      }).catch(() => undefined)
      if (!response?.ok) throw new Error(language.t("common.requestFailed"))
      return
    }
    const parsed = parseRuntimeValue(value)
    if (!parsed) return
    const response = await accountRequest({
      method: "PUT",
      path: `/session/${encodeURIComponent(sessionID)}/runtime-model?directory=${encodeURIComponent(sdk.directory)}`,
      body: parsed,
    }).catch(() => undefined)
    if (!response?.ok) throw new Error(language.t("common.requestFailed"))
  }

  createEffect(() => {
    const runtime = info()?.runtime_model
    if (!params.id) return
    setRuntimeValue(runtime ? `${runtime.providerID}/${runtime.modelID}` : "__auto__")
  })

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    if (!canSelectRuntimeModel()) return
    void accountRequest({ path: "/account/me/providers/catalog" })
      .then((response) => response?.json().catch(() => undefined))
      .then((body) => {
        const items = Array.isArray((body as { selectable_models?: unknown })?.selectable_models)
          ? ((body as { selectable_models: Array<{ value?: string; source?: string }> }).selectable_models ?? [])
          : []
        setRuntimeOptions(
          items
            .filter((item) => !!item.value)
            .map((item) => ({
              value: item.value!,
              label: `${item.source === "user" ? "个人" : item.source === "pool" ? "系统模型池" : "系统指定"} · ${item.value}`,
            })),
        )
      })
  })
  const voiceFilename = (mime: string, now = Date.now()) => {
    const subtype = mime.split("/")[1]?.split(";")[0] || "webm"
    return `voice-${now}.${subtype}`
  }
  const voiceStatus = createMemo(() => {
    if (voicePhase() === "recording") return language.t("prompt.voice.status.recording")
    if (voicePhase() === "transcribing") return language.t("prompt.voice.status.transcribing")
    if (voicePhase() === "failed") return voiceError() || language.t("prompt.voice.status.failed")
    return ""
  })
  const speechLocale = () => SPEECH_LOCALE[language.locale()] ?? (typeof navigator !== "undefined" ? navigator.language : "en-US")

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: "normal" | "shell"
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
  })

  const commentCount = createMemo(() => {
    if (store.mode === "shell") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return false
    const messages = sync.data.message[sessionID]
    if (!messages) return false
    return messages.some((m) => m.role === "user")
  })

  const [history, setHistory] = persisted(
    Persist.global(`acct:${accountID}:prompt-history`),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global(`acct:${accountID}:prompt-history-shell`),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )

  const suggest = createMemo(() => !hasUserPrompt())

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? language.t(EXAMPLES[store.placeholder]) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    }),
  )

  const historyComments = () => {
    const byID = new Map(comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))
    return prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined
      const nextSelection =
        selection ??
        (item.selection
          ? ({
              start: item.selection.startLine,
              end: item.selection.endLine,
            } satisfies SelectedLineRange)
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  const getCaretState = () => {
    const selection = window.getSelection()
    const textLength = promptLength(prompt.current())
    if (!selection || selection.rangeCount === 0) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    const anchorNode = selection.anchorNode
    if (!anchorNode || !editorRef.contains(anchorNode)) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    return {
      collapsed: selection.isCollapsed,
      cursorPosition: getCursorPosition(editorRef),
      textLength,
    }
  }

  const isFocused = createFocusSignal(() => editorRef)
  const escBlur = () => platform.platform === "desktop" && platform.os === "macos"

  const pick = () => fileInputRef?.click()

  command.register("prompt-input", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      disabled: store.mode !== "normal",
      onSelect: pick,
    },
  ])

  const closePopover = () => setStore("popover", null)

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const clearEditor = () => {
    editorRef.innerHTML = ""
  }

  const setEditorText = (text: string) => {
    clearEditor()
    editorRef.textContent = text
  }

  const focusEditorEnd = () => {
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const currentCursor = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) return null
    return getCursorPosition(editorRef)
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderEditor(parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  createEffect(() => {
    params.id
    if (params.id) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const handleBlur = () => {
    closePopover()
    setComposing(false)
  }

  const agentList = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )
  const agentNames = createMemo(() => local.agent.list().map((agent) => agent.name))
  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
    } else {
      addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
    }
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      const agents = agentList()
      const open = recent()
      const seen = new Set(open)
      const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
      const paths = await files.searchFilesAndDirectories(query)
      const fileOptions: AtOption[] = paths
        .filter((path) => !seen.has(path))
        .map((path) => ({ type: "file", path, display: path }))
      return [...agents, ...pinned, ...fileOptions]
    },
    key: atKey,
    filterKeys: ["display"],
    groupBy: (item) => {
      if (item.type === "agent") return "agent"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "agent") return 0
        if (category === "recent") return 1
        return 2
      }
      return rank(a.category) - rank(b.category)
    },
    onSelect: handleAtSelect,
  })

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const builtin = command.options
      .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash!,
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))

    const custom = sync.data.command.map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
      source: cmd.source,
    }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    closePopover()

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      setEditorText(text)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      focusEditorEnd()
      return
    }

    clearEditor()
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    command.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
    refetch: slashRefetch,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") pill.setAttribute("data-path", part.path)
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const isNormalizedEditor = () =>
    Array.from(editorRef.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ""
        if (!text.includes("\u200B")) return true
        if (text !== "\u200B") return false

        const prev = node.previousSibling
        const next = node.nextSibling
        const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
        return !!prevIsBr && !next
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    clearEditor()
    for (const part of parts) {
      if (part.type === "text") {
        editorRef.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        editorRef.appendChild(createPill(part))
      }
    }

    const last = editorRef.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      editorRef.appendChild(document.createTextNode("\u200B"))
    }
  }

  createEffect(
    on(
      () => sync.data.command,
      () => slashRefetch(),
      { defer: true },
    ),
  )

  // Auto-scroll active command into view when navigating with keyboard
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })

  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const items = atFlat()
      if (items.length === 0) return
      const active = atActive()
      const item = items.find((entry) => atKey(entry) === active) ?? items[0]
      handleAtSelect(item)
      return
    }

    if (store.popover === "slash") {
      const items = slashFlat()
      if (items.length === 0) return
      const active = slashActive()
      const item = items.find((entry) => entry.id === active) ?? items[0]
      handleSlashSelect(item)
    }
  }

  createEffect(
    on(
      () => prompt.current(),
      (currentParts) => {
        const inputParts = currentParts.filter((part) => part.type !== "image" && part.type !== "voice")

        if (mirror.input) {
          mirror.input = false
          if (isNormalizedEditor()) return

          renderEditorWithCursor(inputParts)
          return
        }

        const domParts = parseFromDOM()
        if (isNormalizedEditor() && isPromptEqual(inputParts, domParts)) return

        renderEditorWithCursor(inputParts)
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      let content = buffer
      if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
      if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const pushAgent = (agent: HTMLElement) => {
      const content = agent.textContent ?? ""
      parts.push({
        type: "agent",
        name: agent.dataset.name!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        flushText()
        pushFile(el)
        return
      }
      if (el.dataset.type === "agent") {
        flushText()
        pushAgent(el)
        return
      }
      if (el.tagName === "BR") {
        buffer += "\n"
        return
      }

      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    const children = Array.from(editorRef.childNodes)
    children.forEach((child, index) => {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
      visit(child)
      if (isBlock && index < children.length - 1) {
        buffer += "\n"
      }
    })

    flushText()

    if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
    return parts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const images = imageAttachments()
    const voices = voiceAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = shouldResetPromptDraft({
      raw: rawText,
      has_non_text: hasNonText,
      image_count: images.length,
      voice_count: voices.length,
    })
    const shouldClearVoice = shouldClearVoiceDraft({
      raw: rawText,
      has_non_text: hasNonText,
      image_count: images.length,
      voice_count: voices.length,
    })

    if (shouldReset || shouldClearVoice) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        if (shouldClearVoice) clearVoiceDraft()
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (atMatch) {
        atOnInput(atMatch[1])
        setStore("popover", "at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      } else {
        closePopover()
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...images, ...voices], cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image" || part.type === "voice") return false

    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    if (part.type === "file" || part.type === "agent") {
      const cursorPosition = getCursorPosition(editorRef)
      const rawText = prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join("")
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const atMatch = textBeforeCursor.match(/@(\S*)$/)
      const pill = createPill(part)
      const gap = document.createTextNode(" ")

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setRangeEdge(editorRef, range, "start", start)
        setRangeEdge(editorRef, range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (part.type === "text") {
      const fragment = createTextFragment(part.content)
      const last = fragment.lastChild
      range.deleteContents()
      range.insertNode(fragment)
      if (last) {
        if (last.nodeType === Node.TEXT_NODE) {
          const text = last.textContent ?? ""
          if (text === "\u200B") {
            range.setStart(last, 0)
          }
          if (text !== "\u200B") {
            range.setStart(last, text.length)
          }
        }
        if (last.nodeType !== Node.TEXT_NODE) {
          const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
          const next = last.nextSibling
          const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
          if (isBreak && (!next || emptyText)) {
            const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
            if (!next) last.parentNode?.insertBefore(placeholder, null)
            placeholder.textContent = "\u200B"
            range.setStart(placeholder, 0)
          } else {
            range.setStartAfter(last)
          }
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const next = prependHistoryEntry(currentHistory.entries, prompt, mode === "shell" ? [] : historyComments())
    if (next === currentHistory.entries) return
    setCurrentHistory("entries", next)
  }

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: store.mode === "shell" ? shellHistory.entries : history.entries,
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  const { addImageAttachment, removeImageAttachment, handlePaste } = createPromptAttachments({
    editor: () => editorRef,
    isFocused,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    readClipboardImage: platform.readClipboardImage,
  })

  const removeVoiceAttachment = (id: string) => {
    const next = prompt.current().filter((part) => part.type !== "voice" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const voiceDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(new Error("read_failed"))
      reader.readAsDataURL(blob)
    })

  const failVoice = (title: string, description?: string) => {
    setVoicePhase("failed")
    setVoiceError(description ?? title)
    showToast({ title, description })
  }

  const completeVoice = async (run: number) => {
    if (finalizing) return
    finalizing = true

    const active = recorder
    recorder = undefined

    clearVoiceTimer()
    clearVoiceStream()

    const elapsed = Math.max(0, Date.now() - startedAt)
    const duration = Math.min(elapsed, MAX_VOICE_DURATION_MS)
    const mime = active?.mimeType || pickVoiceMime() || VOICE_MIME_FALLBACK
    const blob = new Blob(chunks, { type: mime })
    chunks = []

    if (blob.size <= 0) {
      finalizing = false
      failVoice(language.t("prompt.toast.voiceRecordFailed.title"), language.t("prompt.toast.voiceRecordFailed.description"))
      return
    }

    if (blob.size > MAX_VOICE_BYTES) {
      finalizing = false
      failVoice(language.t("prompt.toast.voiceTooLarge.title"), language.t("prompt.toast.voiceTooLarge.description"))
      return
    }

    const dataUrl = await voiceDataUrl(blob).catch(() => "")
    if (run !== voiceRun) {
      finalizing = false
      return
    }
    if (!dataUrl) {
      finalizing = false
      failVoice(language.t("prompt.toast.voiceRecordFailed.title"), language.t("prompt.toast.voiceRecordFailed.description"))
      return
    }

    const attachment: VoiceAttachmentPart = {
      type: "voice",
      id: uuid(),
      filename: voiceFilename(mime),
      mime,
      dataUrl,
      duration_ms: duration,
    }
    await speech.settle()
    if (run !== voiceRun) {
      finalizing = false
      return
    }
    const cursorPosition = prompt.cursor() ?? getCursorPosition(editorRef)
    prompt.set([...prompt.current(), attachment], cursorPosition)

    const browserTranscript = speech.committed().trim()
    const transcript = browserTranscript || (await transcribeVoice({ mime, dataUrl }))
    if (transcript) {
      editorRef.focus()
      addPart({
        type: "text",
        content: transcript,
        start: 0,
        end: 0,
      })
    } else {
      showToast({
        title: language.t("prompt.toast.voiceNoSpeech.title"),
        description: language.t("prompt.toast.voiceNoSpeech.description"),
      })
    }

    setVoiceError("")
    setVoicePhase("idle")
    finalizing = false
  }

  const stopVoiceInput = () => {
    if (voicePhase() !== "recording") return
    setVoicePhase("transcribing")
    clearVoiceTimer()
    speech.stop()

    if (!recorder || recorder.state === "inactive") {
      void completeVoice(activeVoiceRun)
      return
    }
    recorder.stop()
  }

  const startVoiceInput = async () => {
    if (!supportsVoiceCapture()) {
      failVoice(language.t("prompt.toast.voiceUnsupported.title"), voiceUnsupportedDescription())
      return
    }
    if (voicePhase() === "recording" || voicePhase() === "transcribing") return

    const media = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => error)
    if (!(typeof MediaStream !== "undefined" && media instanceof MediaStream)) {
      const blocked = media instanceof DOMException && media.name === "NotAllowedError"
      if (blocked) {
        failVoice(
          language.t("prompt.toast.voicePermissionDenied.title"),
          language.t("prompt.toast.voicePermissionDenied.description"),
        )
        return
      }
      failVoice(language.t("prompt.toast.voiceRecordFailed.title"), language.t("prompt.toast.voiceRecordFailed.description"))
      return
    }

    stream = media
    chunks = []
    finalizing = false
    startedAt = Date.now()
    activeVoiceRun = ++voiceRun

    const mime = pickVoiceMime()
    const next = (() => {
      if (!mime) return new MediaRecorder(media)
      return new MediaRecorder(media, { mimeType: mime })
    })()

    recorder = next
    next.ondataavailable = (event) => {
      if (event.data.size <= 0) return
      chunks.push(event.data)
    }
    next.onerror = () => {
      clearVoiceTimer()
      clearVoiceStream()
      speech.stop()
      recorder = undefined
      chunks = []
      failVoice(language.t("prompt.toast.voiceRecordFailed.title"), language.t("prompt.toast.voiceRecordFailed.description"))
    }
    next.onstop = () => {
      void completeVoice(activeVoiceRun)
    }

    speech.reset()
    speech.setLang(speechLocale())
    setVoiceError("")
    setVoicePhase("recording")
    if (supportsSpeech()) {
      speech.start()
    }
    const started = (() => {
      try {
        next.start(200)
        return true
      } catch {
        return false
      }
    })()
    if (!started) {
      speech.stop()
      clearVoiceStream()
      recorder = undefined
      chunks = []
      failVoice(language.t("prompt.toast.voiceRecordFailed.title"), language.t("prompt.toast.voiceRecordFailed.description"))
      return
    }
    timer = window.setTimeout(() => {
      showToast({
        title: language.t("prompt.toast.voiceTooLong.title"),
        description: language.t("prompt.toast.voiceTooLong.description"),
      })
      stopVoiceInput()
    }, MAX_VOICE_DURATION_MS)
  }

  onCleanup(() => {
    clearVoiceTimer()
    speech.stop()
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null
      recorder.onerror = null
      recorder.stop()
    }
    recorder = undefined
    chunks = []
    clearVoiceStream()
  })

  const { abort, handleSubmit } = createPromptSubmit({
    info,
    currentRuntimeModel: () => info()?.runtime_model,
    imageAttachments,
    commentCount,
    mode: () => store.mode,
    working,
    editor: () => editorRef,
    queueScroll,
    promptLength,
    addToHistory,
    resetHistoryNavigation: () => {
      resetHistoryNavigation(true)
    },
    clearDraft: clearVoiceDraft,
    setMode: () => setStore("mode", "normal"),
    setPopover: (popover) => setStore("popover", popover),
    syncRuntimeModel: async (sessionID) => {
      if (!canSelectRuntimeModel()) return
      await updateRuntimeModel(sessionID, runtimeValue())
    },
    newSessionWorktree: () => props.newSessionWorktree,
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    onSubmit: props.onSubmit,
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (voicePhase() === "recording") {
        stopVoiceInput()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (voicePhase() === "transcribing") {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (escBlur()) {
        editorRef.blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (working()) {
        abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      handleSubmit(event)
    }
  }

  const accepting = createMemo(() => {
    const id = params.id
    if (!id) return false
    return permission.isAutoAccepting(id, sdk.directory)
  })

  /**
   * 中文注释：根据反馈关联计划切换到目标项目的新建会话页，并把回填文本交接给目标输入框。
   */
  const applyVhoFeedback = async (input: {
    prompt_text?: string
    feedback_des?: string
    plan_content: string
    project_id: string
    project_worktree: string
    project_name?: string
  }) => {
    const next =
      input.prompt_text?.trim() ||
      buildVhoFeedbackPrompt({
        feedback_des: input.feedback_des,
        plan_content: input.plan_content,
      })
    const payload = await auth.contextProducts()
    if (!payload) {
      return vhoFeedbackApplyFailure({
        reason: "products_failed",
      })
    }

    const target = findAssignedVhoProject({
      project_id: input.project_id,
      project_worktree: input.project_worktree,
      products: payload.products.map((item) => ({
        id: item.id,
        project_id: item.project_id,
        worktree: item.worktree,
      })),
    })
    if (!target) {
      return vhoFeedbackApplyFailure({
        reason: "project_missing",
      })
    }

    const activated = await accountProject.activate(target.project_id, true)
    if (!activated.ok) {
      return vhoFeedbackApplyFailure({
        reason: "project_activate_failed",
      })
    }

    const slug = base64Encode(target.worktree)
    layout.handoff.setPrompt(slug, next, next.length)
    navigate(`/${slug}/session`)
    return {
      ok: true,
    } as const
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-0">
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        commandKeybind={command.keybind}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <DockShellForm
        onSubmit={handleSubmit}
        classList={{
          "group/prompt-input": true,
          "focus-within:shadow-xs-border": true,
          "border-icon-info-active border-dashed": store.draggingType !== null,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <PromptDragOverlay
          type={store.draggingType}
          label={language.t(store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label")}
        />
        <PromptContextItems
          items={contextItems()}
          active={(item) => {
            const active = comments.active()
            return !!item.commentID && item.commentID === active?.id && item.path === active?.file
          }}
          openComment={openComment}
          remove={(item) => {
            if (item.commentID) comments.remove(item.path, item.commentID)
            prompt.context.remove(item.key)
          }}
          t={(key) => language.t(key as Parameters<typeof language.t>[0])}
        />
        <PromptImageAttachments
          attachments={imageAttachments()}
          onOpen={(attachment) =>
            dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
          }
          onRemove={removeImageAttachment}
          removeLabel={language.t("prompt.attachment.remove")}
        />
        <PromptVoiceAttachments
          attachments={voiceAttachments()}
          onRemove={removeVoiceAttachment}
          removeLabel={language.t("prompt.attachment.remove")}
        />
        <div
          class="relative"
          onMouseDown={(e) => {
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (
              target.closest(
                '[data-action="prompt-voice"], [data-action="prompt-attach"], [data-action="prompt-submit"], [data-action="prompt-permissions"]',
              )
            ) {
              return
            }
            editorRef?.focus()
          }}
        >
          <div class="relative max-h-[240px] overflow-y-auto no-scrollbar" ref={(el) => (scrollRef = el)}>
            <div
              data-component="prompt-input"
              ref={(el) => {
                editorRef = el
                props.ref?.(el)
              }}
              role="textbox"
              aria-multiline="true"
              aria-label={placeholder()}
              contenteditable="true"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              onInput={handleInput}
              onPaste={handlePaste}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              classList={{
                "select-text": true,
                "w-full pl-3 pr-2 pt-2 pb-11 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                "[&_[data-type=file]]:text-syntax-property": true,
                "[&_[data-type=agent]]:text-syntax-type": true,
                "font-mono!": store.mode === "shell",
              }}
            />
            <Show when={!prompt.dirty()}>
              <div
                class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 pb-11 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                classList={{ "font-mono!": store.mode === "shell" }}
              >
                {placeholder()}
              </div>
            </Show>
          </div>

          <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) addImageAttachment(file)
                e.currentTarget.value = ""
              }}
            />

            <div
              aria-hidden={store.mode !== "normal"}
              class="flex items-center gap-1 transition-all duration-200 ease-out"
              classList={{
                "opacity-100 translate-y-0 scale-100 pointer-events-auto": store.mode === "normal",
                "opacity-0 translate-y-2 scale-95 pointer-events-none": store.mode !== "normal",
              }}
            >
              <Show when={voiceStatus()}>
                <span
                  class="mr-1 px-1.5 py-0.5 rounded bg-surface-base text-10-regular text-text-weak max-w-36 truncate"
                  classList={{
                    "text-icon-info-active": voicePhase() === "recording",
                    "text-icon-warning-base": voicePhase() === "failed",
                  }}
                  title={voiceStatus()}
                >
                  {voiceStatus()}
                </span>
              </Show>

              <Tooltip
                placement="top"
                value={
                  voicePhase() === "recording"
                    ? language.t("prompt.action.voiceStop")
                    : language.t("prompt.action.voiceInput")
                }
              >
                <Button
                  data-action="prompt-voice"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  classList={{
                    "text-icon-info-active": voicePhase() === "recording",
                    "animate-pulse": voicePhase() === "recording",
                  }}
                  onClick={() => {
                    if (voicePhase() === "recording") {
                      stopVoiceInput()
                      return
                    }
                    if (voicePhase() === "transcribing") return
                    if (!supportsVoiceCapture()) {
                      failVoice(language.t("prompt.toast.voiceUnsupported.title"), voiceUnsupportedDescription())
                      return
                    }
                    void startVoiceInput()
                  }}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label={
                    voicePhase() === "recording"
                      ? language.t("prompt.action.voiceStop")
                      : language.t("prompt.action.voiceInput")
                  }
                >
                  <Icon name={voicePhase() === "recording" ? "stop" : "microphone"} class="size-4.5" />
                </Button>
              </Tooltip>

              <TooltipKeybind
                placement="top"
                title={language.t("prompt.action.attachFile")}
                keybind={command.keybind("file.attach")}
              >
                <Button
                  data-action="prompt-attach"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  onClick={pick}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label={language.t("prompt.action.attachFile")}
                >
                  <Icon name="plus" class="size-4.5" />
                </Button>
              </TooltipKeybind>

              <Tooltip
                placement="top"
                inactive={!prompt.dirty() && !working()}
                value={
                  <Switch>
                    <Match when={working()}>
                      <div class="flex items-center gap-2">
                        <span>{language.t("prompt.action.stop")}</span>
                        <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
                      </div>
                    </Match>
                    <Match when={true}>
                      <div class="flex items-center gap-2">
                        <span>{language.t("prompt.action.send")}</span>
                        <Icon name="enter" size="small" class="text-icon-base" />
                      </div>
                    </Match>
                  </Switch>
                }
              >
                <IconButton
                  data-action="prompt-submit"
                  type="submit"
                  disabled={store.mode !== "normal" || (!prompt.dirty() && !working() && commentCount() === 0)}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  icon={working() ? "stop" : "arrow-up"}
                  variant="primary"
                  class="size-8"
                  aria-label={working() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                />
              </Tooltip>
            </div>
          </div>

          <div class="pointer-events-none absolute bottom-2 left-2">
            <div class="pointer-events-auto">
              <TooltipKeybind
                placement="top"
                gutter={8}
                title={language.t(
                  accepting() ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable",
                )}
                keybind={command.keybind("permissions.autoaccept")}
              >
                <Button
                  data-action="prompt-permissions"
                  variant="ghost"
                  disabled={!params.id}
                  onClick={() => {
                    if (!params.id) return
                    permission.toggleAutoAccept(params.id, sdk.directory)
                  }}
                  classList={{
                    "size-6 flex items-center justify-center": true,
                    "text-text-base": !accepting(),
                    "hover:bg-surface-success-base": accepting(),
                  }}
                  aria-label={
                    accepting()
                      ? language.t("command.permissions.autoaccept.disable")
                      : language.t("command.permissions.autoaccept.enable")
                  }
                  aria-pressed={accepting()}
                >
                  <Icon
                    name="chevron-double-right"
                    size="small"
                    classList={{ "text-icon-success-base": accepting() }}
                  />
                </Button>
              </TooltipKeybind>
            </div>
          </div>
        </div>
      </DockShellForm>
      <DockTray attach="top">
        <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <TooltipKeybind
              placement="top"
              gutter={4}
              title={language.t("command.agent.cycle")}
              keybind={command.keybind("agent.cycle")}
            >
              <Select
                size="normal"
                options={agentNames()}
                current={local.agent.current()?.name ?? ""}
                onSelect={local.agent.set}
                class="capitalize max-w-[160px]"
                valueClass="truncate text-13-regular"
                triggerStyle={{ height: "28px" }}
                variant="ghost"
              />
            </TooltipKeybind>
            <Show when={dockFlags().runtime_model}>
              <Select
                size="normal"
                options={["__auto__", ...runtimeOptions().map((item) => item.value)]}
                current={runtimeValue()}
                label={(option) => {
                  if (option === "__auto__") return "系统自动"
                  return runtimeOptions().find((item) => item.value === option)?.label ?? option
                }}
                onSelect={(value) => {
                  if (!value) return
                  setRuntimeValue(value)
                  if (!params.id) return
                  void updateRuntimeModel(params.id, value).catch(() => {
                    showToast({
                      title: language.t("common.requestFailed"),
                      description: "模型切换失败",
                    })
                  })
                }}
                class="max-w-[260px]"
                valueClass="truncate text-13-regular"
                triggerStyle={{ height: "28px" }}
                variant="ghost"
              />
            </Show>
            <Show when={dockFlags().vho_feedback}>
              <Button
                type="button"
                variant="ghost"
                class="h-7 px-2 text-13-regular"
                onClick={() =>
                  dialog.show(() => (
                    <DialogVhoFeedback
                      onSelect={(input) =>
                        applyVhoFeedback({
                          prompt_text: input.prompt_text,
                          feedback_des: input.feedback_des,
                          plan_content: input.plan_content,
                          project_id: input.project_id,
                          project_worktree: input.project_worktree,
                          project_name: input.project_name,
                        })
                      }
                    />
                  ))
                }
              >
                {language.t("prompt.action.selectFeedback")}
              </Button>
            </Show>
          </div>
        </div>
      </DockTray>
    </div>
  )
}
