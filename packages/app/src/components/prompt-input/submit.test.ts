import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const syncedDirectories: string[] = []
const toasts: { title?: string; description?: string }[] = []
const shellCalls: { directory: string; sessionID: string }[] = []
const commandCalls: Array<{ directory: string; sessionID: string; command: string; model?: string; variant?: string }> =
  []
const promptAsyncCalls: Array<{
  directory: string
  sessionID: string
  model?: { providerID: string; modelID: string }
  variant?: string
}> = []

let selected = "/repo/worktree-a"
let route: { id?: string } = {}
let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
let commands: { name: string }[] = []
let promptAsyncError: Error | undefined
let clearDraftCalls = 0
let localModel: { id: string; provider: { id: string } } | undefined = { id: "model", provider: { id: "provider" } }

const event = { preventDefault: () => undefined } as unknown as Event

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async () => {
        createdSessions.push(directory)
        return { data: { id: `session-${createdSessions.length}` } }
      },
      shell: async (input: { sessionID: string }) => {
        shellCalls.push({ directory, sessionID: input.sessionID })
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async (input: {
        sessionID: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }) => {
        promptAsyncCalls.push({ directory, sessionID: input.sessionID, model: input.model, variant: input.variant })
        if (promptAsyncError) throw promptAsyncError
        return { data: undefined }
      },
      status: async () => ({ data: {} }),
      command: async (input: { sessionID: string; command: string; model?: string; variant?: string }) => {
        commandCalls.push({
          directory,
          sessionID: input.sessionID,
          command: input.command,
          model: input.model,
          variant: input.variant,
        })
        return { data: undefined }
      },
      abort: async () => ({ data: undefined }),
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => route,
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (input: { title?: string; description?: string }) => {
      toasts.push(input)
      return 0
    },
  }))

  mock.module("@opencode-ai/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => localModel,
        variant: { current: () => undefined },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => undefined,
      set: () => undefined,
      context: {
        add: () => undefined,
        remove: () => undefined,
        items: () => [],
      },
    }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => ({
      directory: "/repo/main",
      client: rootClient,
      url: "http://localhost:4096",
      createClient: (opts: { directory: string; throwOnError?: boolean }) => clientFor(opts.directory),
    }),
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: commands, session_status: {} },
      session: {
        optimistic: {
          add: () => undefined,
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      child: (directory: string) => {
        syncedDirectories.push(directory)
        return [{}, () => undefined]
      },
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

beforeEach(() => {
  createdClients.length = 0
  createdSessions.length = 0
  syncedDirectories.length = 0
  toasts.length = 0
  shellCalls.length = 0
  commandCalls.length = 0
  promptAsyncCalls.length = 0
  selected = "/repo/worktree-a"
  route = {}
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  commands = []
  promptAsyncError = undefined
  clearDraftCalls = 0
  localModel = { id: "model", provider: { id: "provider" } }
})

function createSubmit(input?: {
  mode?: "normal" | "shell"
  info?: () => { id: string } | undefined
}) {
  return createPromptSubmit({
    info: input?.info ?? (() => undefined),
    imageAttachments: () => [],
    commentCount: () => 0,
    mode: () => input?.mode ?? "normal",
    working: () => false,
    editor: () => undefined,
    queueScroll: () => undefined,
    promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
    addToHistory: () => undefined,
    resetHistoryNavigation: () => undefined,
    clearDraft: () => {
      clearDraftCalls += 1
    },
    setMode: () => undefined,
    setPopover: () => undefined,
    newSessionWorktree: () => selected,
    onNewSessionWorktreeReset: () => undefined,
    onSubmit: () => undefined,
  })
}

describe("prompt submit session resolution", () => {
  test("blocks sending voice-only draft without text", async () => {
    route = { id: "session-route-voice-only" }
    promptValue = [
      {
        type: "voice",
        id: "voice_1",
        filename: "voice.webm",
        mime: "audio/webm",
        dataUrl: "data:audio/webm;base64,AAA",
        duration_ms: 1200,
      },
    ]
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(promptAsyncCalls).toEqual([])
    expect(clearDraftCalls).toBe(0)
    expect(toasts).toEqual([
      {
        title: "prompt.toast.voiceNoSpeech.title",
        description: "prompt.toast.voiceNoSpeech.description",
      },
    ])
  })

  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createSubmit({ mode: "shell" })

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(shellCalls.map((item) => item.directory)).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
  })

  test("uses route session id for normal mode without creating a session", async () => {
    route = { id: "session-route-normal" }
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual([])
    expect(clearDraftCalls).toBe(1)
    expect(promptAsyncCalls).toEqual([
      { directory: "/repo/main", sessionID: "session-route-normal", model: undefined, variant: undefined },
    ])
  })

  test("uses route session id for shell mode without creating a session", async () => {
    route = { id: "session-route-shell" }
    const submit = createSubmit({ mode: "shell", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(shellCalls).toEqual([{ directory: "/repo/main", sessionID: "session-route-shell" }])
  })

  test("uses route session id for slash command mode without creating a session", async () => {
    route = { id: "session-route-command" }
    promptValue = [{ type: "text", content: "/deploy --fast", start: 0, end: 14 }]
    commands = [{ name: "deploy" }]
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(commandCalls).toEqual([
      {
        directory: "/repo/main",
        sessionID: "session-route-command",
        command: "deploy",
        model: undefined,
        variant: undefined,
      },
    ])
  })

  test("does not require a local model to send a prompt", async () => {
    route = { id: "session-route-no-local-model" }
    localModel = undefined
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(toasts).toEqual([])
    expect(promptAsyncCalls).toEqual([
      { directory: "/repo/main", sessionID: "session-route-no-local-model", model: undefined, variant: undefined },
    ])
  })

  test("route session not found shows backend error instead of preflight missing-session toast", async () => {
    route = { id: "session-route-missing" }
    promptAsyncError = new Error("Session not found: session-route-missing")
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual([])
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.title).toBe("prompt.toast.promptSendFailed.title")
    expect(toasts[0]?.description).toBe("Session not found: session-route-missing")
    expect(toasts[0]?.description).not.toBe("prompt.toast.promptSendFailed.description")
  })
})
