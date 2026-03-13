import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { VcsInfo } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import type { State, VcsCache } from "./types"

let bootstrapDirectory: typeof import("./bootstrap").bootstrapDirectory
const toasts: Array<{ title?: string; description?: string }> = []

function state() {
  return createStore<State>({
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    status: "loading",
    agent: [],
    command: [],
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
  })
}

function cache(): VcsCache {
  const [store, setStore] = createStore<{ value: VcsInfo | undefined }>({ value: undefined })
  return {
    store,
    setStore,
    ready: () => true,
  }
}

beforeAll(async () => {
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (input: { title?: string; description?: string }) => {
      toasts.push(input)
      return 0
    },
  }))
  const mod = await import("./bootstrap")
  bootstrapDirectory = mod.bootstrapDirectory
})

describe("bootstrapDirectory", () => {
  test("does not request providers during directory bootstrap", async () => {
    toasts.length = 0
    const [store, setStore] = state()
    let provider = 0
    await bootstrapDirectory({
      directory: "/repo",
      sdk: {
        provider: {
          list: async () => {
            provider += 1
            return { data: { all: [], connected: [], default: {} } }
          },
        },
        app: {
          agents: async () => ({ data: [] }),
        },
        config: {
          get: async () => ({ data: {} }),
        },
        path: {
          get: async () => ({ data: { state: "", config: "", worktree: "", directory: "/repo", home: "" } }),
        },
        command: {
          list: async () => ({ data: [] }),
        },
        session: {
          status: async () => ({ data: {} }),
        },
        mcp: {
          status: async () => ({ data: {} }),
        },
        lsp: {
          status: async () => ({ data: [] }),
        },
        vcs: {
          get: async () => ({ data: undefined }),
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as never,
      store,
      setStore,
      vcsCache: cache(),
      loadSessions: async () => {},
      unknownError: "unknown",
      invalidConfigurationError: "invalid",
    })

    expect(provider).toBe(0)
  })

  test("does not show reload toast when the workspace directory is already missing", async () => {
    toasts.length = 0
    const [store, setStore] = state()
    await bootstrapDirectory({
      directory: "/repo/deleted-workspace",
      sdk: {
        app: {
          agents: async () => {
            throw new Error("No such file or directory")
          },
        },
        config: {
          get: async () => ({ data: {} }),
        },
      } as never,
      store,
      setStore,
      vcsCache: cache(),
      loadSessions: async () => {},
      unknownError: "unknown",
      invalidConfigurationError: "invalid",
    })

    expect(store.status).toBe("partial")
    expect(toasts).toEqual([])
  })

  test("does not show reload toast when the workspace was disposed before bootstrap failed", async () => {
    toasts.length = 0
    const [store, setStore] = state()
    await bootstrapDirectory({
      directory: "/repo/disposed-workspace",
      sdk: {
        app: {
          agents: async () => {
            throw new Error("Forbidden")
          },
        },
        config: {
          get: async () => ({ data: {} }),
        },
      } as never,
      store,
      setStore,
      vcsCache: cache(),
      loadSessions: async () => {},
      unknownError: "unknown",
      invalidConfigurationError: "invalid",
      shouldIgnoreError: () => true,
    })

    expect(store.status).toBe("partial")
    expect(toasts).toEqual([])
  })
})
