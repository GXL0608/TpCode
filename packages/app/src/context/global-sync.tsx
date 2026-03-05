import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import {
  createContext,
  createEffect,
  getOwner,
  Match,
  onCleanup,
  type ParentProps,
  Switch,
  untrack,
  useContext,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { sanitizeProject } from "./global-sync/utils"
import { usePlatform } from "./platform"
import { useAccountAuth } from "./account-auth"
import { formatServerError } from "@/utils/server-errors"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function createGlobalSync() {
  const auth = useAccountAuth()
  const accountID = auth.user()?.id ?? "anonymous"
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()
  const statusLoads = new Map<string, Promise<void>>()
  const degradedPullAt = new Map<string, number>()
  const busySince = new Map<string, number>()
  const progressAt = new Map<string, number>()
  const stalledPullAt = new Map<string, number>()
  const STATUS_REFRESH_COOLDOWN_MS = 5000
  const STALLED_BUSY_MS = 60_000
  const STALLED_POLL_MS = 15_000

  const [projectCache, setProjectCache, , projectCacheReady] = persisted(
    Persist.global(`acct:${accountID}:globalSync.project`),
    createStore({ value: [] as Project[] }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: projectCache.value,
    session_todo: {},
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
    config: {},
    reload: undefined,
  })

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    bootstrap,
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queue.clear(directory)
      sessionMeta.delete(directory)
      sdkCache.delete(directory)
      statusLoads.delete(directory)
      degradedPullAt.delete(directory)
      for (const key of [...busySince.keys()]) {
        if (!key.startsWith(`${directory}\n`)) continue
        busySince.delete(key)
        progressAt.delete(key)
        stalledPullAt.delete(key)
      }
    },
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  const sessionKey = (directory: string, sessionID: string) => `${directory}\n${sessionID}`

  const refreshStatus = (directory: string, setStore: ReturnType<typeof children.child>[1], reason: string) => {
    const pending = statusLoads.get(directory)
    if (pending) return pending
    const promise = sdkFor(directory)
      .session.status()
      .then((x) => {
        setStore("session_status", reconcile(x.data ?? {}))
      })
      .catch((error) => {
        console.error("[global-sync] failed to refresh session status", { directory, reason, error })
      })
      .finally(() => {
        statusLoads.delete(directory)
      })
    statusLoads.set(directory, promise)
    return promise
  }

  const noteBusy = (directory: string, sessionID: string) => {
    const key = sessionKey(directory, sessionID)
    if (!busySince.has(key)) {
      busySince.set(key, Date.now())
    }
  }

  const clearBusy = (directory: string, sessionID: string) => {
    const key = sessionKey(directory, sessionID)
    busySince.delete(key)
    progressAt.delete(key)
    stalledPullAt.delete(key)
  }

  const noteProgress = (directory: string, sessionID: string) => {
    progressAt.set(sessionKey(directory, sessionID), Date.now())
  }

  const refreshStalledBusy = () => {
    const now = Date.now()
    for (const [directory, child] of Object.entries(children.children)) {
      const [, setStore] = child
      const sessions = child[0].session_status
      const live = new Set<string>()
      const stalled = Object.entries(sessions).some(([sessionID, status]) => {
        const key = sessionKey(directory, sessionID)
        live.add(key)
        if (status?.type !== "busy") {
          clearBusy(directory, sessionID)
          return false
        }
        noteBusy(directory, sessionID)
        const started = busySince.get(key) ?? now
        const progressed = progressAt.get(key) ?? started
        const pulled = stalledPullAt.get(key) ?? 0
        if (now - started < STALLED_BUSY_MS) return false
        if (now - progressed < STALLED_BUSY_MS) return false
        if (now - pulled < STATUS_REFRESH_COOLDOWN_MS) return false
        stalledPullAt.set(key, now)
        return true
      })
      for (const key of [...busySince.keys()]) {
        if (!key.startsWith(`${directory}\n`)) continue
        if (live.has(key)) continue
        busySince.delete(key)
        progressAt.delete(key)
        stalledPullAt.delete(key)
      }
      if (!stalled) continue
      void refreshStatus(directory, setStore, "busy_stalled")
    }
  }

  createEffect(() => {
    if (!projectCacheReady()) return
    if (globalStore.project.length !== 0) return
    const cached = projectCache.value
    if (cached.length === 0) return
    setGlobalStore("project", cached)
  })

  createEffect(() => {
    if (!projectCacheReady()) return
    const projects = globalStore.project
    if (projects.length === 0) {
      const cachedLength = untrack(() => projectCache.value.length)
      if (cachedLength !== 0) return
    }
    setProjectCache("value", projects.map(sanitizeProject))
  })

  createEffect(() => {
    if (globalStore.reload !== "complete") return
    setGlobalStore("reload", undefined)
    queue.refresh()
  })

  async function loadSessions(directory: string) {
    const pending = sessionLoads.get(directory)
    if (pending) return pending

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(directory)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
      }
      children.unpin(directory)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = loadRootSessionsWithFallback({
      directory,
      limit,
      list: (query) => globalSDK.client.session.list(query),
    })
      .then((x) => {
        const nonArchived = (x.data ?? [])
          .filter((s) => !!s?.id)
          .filter((s) => !s.time?.archived)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const limit = store.limit
        const childSessions = store.session.filter((s) => !!s.parentID)
        const sessions = trimSessions([...nonArchived, ...childSessions], {
          limit,
          permission: store.permission,
        })
        setStore(
          "sessionTotal",
          estimateRootSessionTotal({
            count: nonArchived.length,
            limit: x.limit,
            limited: x.limited,
          }),
        )
        setStore("session", reconcile(sessions, { key: "id" }))
        sessionMeta.set(directory, { limit })
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        const project = getFilename(directory)
        showToast({
          variant: "error",
          title: language.t("toast.session.listFailed.title", { project }),
          description: formatServerError(err, {
            unknown: language.t("error.chain.unknown"),
            invalidConfiguration: language.t("error.server.invalidConfiguration"),
          }),
        })
      })

    sessionLoads.set(directory, promise)
    promise.finally(() => {
      sessionLoads.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const pending = booting.get(directory)
    if (pending) return pending

    children.pin(directory)
    const promise = (async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        unknownError: language.t("error.chain.unknown"),
        invalidConfigurationError: language.t("error.server.invalidConfiguration"),
      })
    })()

    booting.set(directory, promise)
    promise.finally(() => {
      booting.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details
    const type = (event as { type?: string }).type

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: queue.refresh,
        setGlobalProject(next) {
          if (typeof next === "function") {
            setGlobalStore("project", produce(next))
            return
          }
          setGlobalStore("project", next)
        },
      })
      if (type === "server.connected" || type === "global.disposed" || type === "server.degraded") {
        for (const [directory, child] of Object.entries(children.children)) {
          const [, setStore] = child
          if (type === "global.disposed" || type === "server.connected") {
            queue.push(directory)
          }
          if (type === "global.disposed") continue
          if (type === "server.degraded") {
            const now = Date.now()
            const last = degradedPullAt.get(directory) ?? 0
            if (now - last < STATUS_REFRESH_COOLDOWN_MS) continue
            degradedPullAt.set(directory, now)
          }
          void refreshStatus(directory, setStore, type === "server.degraded" ? "degraded" : "reconnect")
        }
      }
      return
    }

    const existing = children.children[directory]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(directory),
      loadLsp: () => {
        sdkFor(directory)
          .lsp.status()
          .then((x) => setStore("lsp", x.data ?? []))
      },
    })
    if (type === "session.status") {
      const props = event.properties as { sessionID?: string; status?: { type?: string } } | undefined
      const sessionID = props?.sessionID
      if (!sessionID) return
      if (props.status?.type === "busy") noteBusy(directory, sessionID)
      else clearBusy(directory, sessionID)
      return
    }
    if (type === "message.updated") {
      const props = event.properties as { info?: { sessionID?: string } } | undefined
      const sessionID = props?.info?.sessionID
      if (!sessionID) return
      noteProgress(directory, sessionID)
      return
    }
    if (type === "message.part.updated") {
      const props = event.properties as { part?: { sessionID?: string } } | undefined
      const sessionID = props?.part?.sessionID
      if (!sessionID) return
      noteProgress(directory, sessionID)
      return
    }
    if (type === "message.part.delta" || type === "message.part.removed") {
      const props = event.properties as { sessionID?: string } | undefined
      const sessionID = props?.sessionID
      if (!sessionID) return
      noteProgress(directory, sessionID)
      return
    }
  })

  const stalledWatch = setInterval(refreshStalledBusy, STALLED_POLL_MS)

  onCleanup(unsub)
  onCleanup(() => {
    clearInterval(stalledWatch)
  })
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  async function bootstrap() {
    await bootstrapGlobal({
      globalSDK: globalSDK.client,
      connectErrorTitle: language.t("dialog.server.add.error"),
      connectErrorDescription: language.t("error.globalSync.connectFailed", {
        url: globalSDK.url,
      }),
      requestFailedTitle: language.t("common.requestFailed"),
      unknownError: language.t("error.chain.unknown"),
      invalidConfigurationError: language.t("error.server.invalidConfiguration"),
      formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
      setGlobalStore,
    })
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (auth.enabled() && auth.needsProjectContext()) {
      setGlobalStore("ready", true)
      return
    }
    void bootstrap()
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ config })
      .then(bootstrap)
      .then(() => {
        setGlobalStore("reload", "complete")
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

  return {
    data: globalStore,
    set: setGlobalStore,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    bootstrap,
    updateConfig,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return (
    <Switch>
      <Match when={value.ready}>
        <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
      </Match>
    </Switch>
  )
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
export { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
