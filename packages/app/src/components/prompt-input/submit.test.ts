import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2/client"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const syncedDirectories: string[] = []
const toasts: { title?: string; description?: string }[] = []
const shellCalls: { directory: string; sessionID: string }[] = []
const commandCalls: Array<{ directory: string; sessionID: string; command: string; model?: string; variant?: string }> =
  []
const prepareBuildCalls: Array<{ directory: string; sessionID: string }> = []
const promptAsyncCalls: Array<{
  directory: string
  sessionID: string
  model?: { providerID: string; modelID: string }
  variant?: string
}> = []
const syncCalls: string[] = []
const optimisticAdds: Array<{
  directory: string
  sessionID: string
  message: Message
}> = []
const navigations: string[] = []
const setCalls: Array<{ path: string }> = []
const workspaceModeCalls: Array<{ directory: string; value: boolean }> = []
const workspaceExpandedCalls: Array<{ directory: string; value: boolean }> = []
const workspaceSessionLoads: string[] = []

let selected = "/repo/worktree-a"
let route: { id?: string } = {}
let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
let commands: { name: string }[] = []
let promptAsyncError: Error | undefined
let clearDraftCalls = 0
let localModel: { id: string; provider: { id: string } } | undefined = { id: "model", provider: { id: "provider" } }
let syncRuntimeModelCalls: string[] = []
let syncRuntimeModelPending:
  | {
      promise: Promise<void>
      resolve: () => void
    }
  | undefined
let currentAgentName = "agent"
let projects = [{ id: "project-main", worktree: "/repo/main", sandboxes: [] as string[] }]

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
      prepareBuild: async (input: { sessionID: string }) => {
        prepareBuildCalls.push({ directory, sessionID: input.sessionID })
        return {
          data: {
            id: input.sessionID,
            directory: `${directory}/prepared/${input.sessionID}`,
          },
        }
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
    useNavigate: () => (value: string) => {
      navigations.push(value)
    },
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
        current: () => ({ name: currentAgentName }),
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
      sidebar: {
        setWorkspaces: (directory: string, value: boolean) => {
          workspaceModeCalls.push({ directory, value })
        },
        setWorkspaceExpanded: (directory: string, value: boolean) => {
          workspaceExpandedCalls.push({ directory, value })
        },
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
          add: (input: { directory: string; sessionID: string; message: Message }) => {
            optimisticAdds.push(input)
          },
          remove: () => undefined,
        },
        sync: async (sessionID: string) => {
          syncCalls.push(sessionID)
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      data: {
        get project() {
          return projects
        },
      },
      project: {
        loadSessions: async (directory: string) => {
          workspaceSessionLoads.push(directory)
        },
      },
      set: (...args: unknown[]) => {
        if (args[0] !== "project") return
        setCalls.push({ path: "project" })
        const next = args[1]
        if (typeof next !== "function") return
        projects = next(projects)
      },
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
  prepareBuildCalls.length = 0
  promptAsyncCalls.length = 0
  navigations.length = 0
  selected = "/repo/worktree-a"
  route = {}
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  commands = []
  promptAsyncError = undefined
  clearDraftCalls = 0
  localModel = { id: "model", provider: { id: "provider" } }
  optimisticAdds.length = 0
  syncCalls.length = 0
  syncRuntimeModelCalls.length = 0
  syncRuntimeModelPending = undefined
  currentAgentName = "agent"
  projects = [{ id: "project-main", worktree: "/repo/main", sandboxes: [] }]
  setCalls.length = 0
  workspaceModeCalls.length = 0
  workspaceExpandedCalls.length = 0
  workspaceSessionLoads.length = 0
})

function createSubmit(input?: {
  mode?: "normal" | "shell"
  info?: () => { id: string } | undefined
  currentRuntimeModel?: () => { providerID: string; modelID: string } | undefined
}) {
  return createPromptSubmit({
    info: input?.info ?? (() => undefined),
    currentRuntimeModel: input?.currentRuntimeModel ?? (() => undefined),
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
    syncRuntimeModel: async (sessionID: string) => {
      syncRuntimeModelCalls.push(sessionID)
      if (!syncRuntimeModelPending) return
      await syncRuntimeModelPending.promise
    },
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
      {
        directory: "/repo/main",
        sessionID: "session-route-normal",
        model: { providerID: "provider", modelID: "model" },
        variant: undefined,
      },
    ])
  })

  test("uses route session id for shell mode without creating a session", async () => {
    route = { id: "session-route-shell" }
    const submit = createSubmit({ mode: "shell", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(shellCalls).toEqual([{ directory: "/repo/main", sessionID: "session-route-shell" }])
  })

  test("prepares a build workspace before sending a shell command", async () => {
    route = { id: "session-route-build-shell" }
    currentAgentName = "build"
    const submit = createSubmit({ mode: "shell", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(prepareBuildCalls).toEqual([{ directory: "/repo/main", sessionID: "session-route-build-shell" }])
    expect(shellCalls).toEqual([
      { directory: "/repo/main/prepared/session-route-build-shell", sessionID: "session-route-build-shell" },
    ])
    expect(navigations).toContain("//repo/main/prepared/session-route-build-shell/session/session-route-build-shell")
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
        model: "provider/model",
        variant: undefined,
      },
    ])
  })

  test("blocks normal prompt when no local model is available", async () => {
    route = { id: "session-route-no-local-model" }
    localModel = undefined
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual([])
    expect(prepareBuildCalls).toEqual([])
    expect(promptAsyncCalls).toEqual([])
    expect(toasts).toEqual([
      {
        title: "toast.model.unavailable.title",
        description: "toast.model.unavailable.description",
      },
    ])
  })

  test("blocks shell command when no local model is available", async () => {
    route = { id: "session-route-no-local-model-shell" }
    localModel = undefined
    const submit = createSubmit({ mode: "shell", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(prepareBuildCalls).toEqual([])
    expect(shellCalls).toEqual([])
    expect(toasts).toEqual([
      {
        title: "toast.model.unavailable.title",
        description: "toast.model.unavailable.description",
      },
    ])
  })

  test("blocks slash command when no local model is available", async () => {
    route = { id: "session-route-no-local-model-command" }
    localModel = undefined
    promptValue = [{ type: "text", content: "/deploy --fast", start: 0, end: 14 }]
    commands = [{ name: "deploy" }]
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)

    expect(createdSessions).toEqual([])
    expect(prepareBuildCalls).toEqual([])
    expect(commandCalls).toEqual([])
    expect(toasts).toEqual([
      {
        title: "toast.model.unavailable.title",
        description: "toast.model.unavailable.description",
      },
    ])
  })

  test("uses session runtime model for optimistic user message", async () => {
    route = { id: "session-route-runtime-model" }
    const submit = createSubmit({
      mode: "normal",
      currentRuntimeModel: () => ({
        providerID: "openrouter",
        modelID: "openai/gpt-4o-mini",
      }),
    })

    await submit.handleSubmit(event)
    await flush()

    expect((optimisticAdds.at(-1)?.message as UserMessage | undefined)?.model).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-4o-mini",
    })
  })

  test("refreshes session messages after async prompt submit", async () => {
    route = { id: "session-route-refresh" }
    const submit = createSubmit({ mode: "normal" })

    await submit.handleSubmit(event)
    await flush()

    expect(syncCalls).toContain("session-route-refresh")
  })

  test("waits for runtime model sync before sending prompt", async () => {
    route = { id: "session-route-sync-model" }
    let resolve!: () => void
    syncRuntimeModelPending = {
      promise: new Promise<void>((done) => {
        resolve = done
      }),
      resolve,
    }
    const submit = createSubmit({ mode: "normal" })

    const task = submit.handleSubmit(event)
    await flush()

    expect(syncRuntimeModelCalls).toEqual(["session-route-sync-model"])
    expect(promptAsyncCalls).toEqual([])

    syncRuntimeModelPending.resolve()
    await task
    await flush()

    expect(promptAsyncCalls).toEqual([
      {
        directory: "/repo/main",
        sessionID: "session-route-sync-model",
        model: { providerID: "provider", modelID: "model" },
        variant: undefined,
      },
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

  test("prepares a build workspace lazily for an existing session before sending the first prompt", async () => {
    route = { id: "session-route-build" }
    currentAgentName = "build"
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual([])
    expect(prepareBuildCalls).toEqual([{ directory: "/repo/main", sessionID: "session-route-build" }])
    expect(createdClients).toContain("/repo/main/prepared/session-route-build")
    expect(syncedDirectories).toContain("/repo/main/prepared/session-route-build")
    expect(promptAsyncCalls).toEqual([
      {
        directory: "/repo/main/prepared/session-route-build",
        sessionID: "session-route-build",
        model: { providerID: "provider", modelID: "model" },
        variant: undefined,
      },
    ])
    expect(projects[0]?.sandboxes).toContain("/repo/main/prepared/session-route-build")
    expect(setCalls).toEqual([{ path: "project" }])
    expect(workspaceModeCalls).toEqual([{ directory: "/repo/main", value: true }])
    expect(workspaceExpandedCalls).toEqual([
      { directory: "/repo/main/prepared/session-route-build", value: true },
    ])
    expect(workspaceSessionLoads).toEqual(["/repo/main/prepared/session-route-build"])
    expect(navigations).toContain("//repo/main/prepared/session-route-build/session/session-route-build")
  })

  test("does not prepare a workspace for non-build prompts", async () => {
    route = { id: "session-route-no-build-prepare" }
    currentAgentName = "plan"
    const submit = createSubmit({ mode: "normal", info: () => undefined })

    await submit.handleSubmit(event)
    await flush()

    expect(prepareBuildCalls).toEqual([])
    expect(promptAsyncCalls).toEqual([
      {
        directory: "/repo/main",
        sessionID: "session-route-no-build-prepare",
        model: { providerID: "provider", modelID: "model" },
        variant: undefined,
      },
    ])
  })
})
