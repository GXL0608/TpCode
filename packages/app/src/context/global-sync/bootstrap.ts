import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"

type GlobalStore = {
  ready: boolean
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

function flag(key: string, fallback = true) {
  if (typeof window !== "object") return fallback
  const value = window.localStorage.getItem(key)?.toLowerCase()
  if (!value) return fallback
  if (value === "1" || value === "true" || value === "on") return true
  if (value === "0" || value === "false" || value === "off") return false
  return fallback
}

/** 中文注释：目录已被删除或对应资源不存在时，不再提示误导性的 reload 失败 toast。 */
function missingDirectory(err: unknown) {
  const data =
    err && typeof err === "object" && "data" in err
      ? (err as { data?: { message?: unknown } }).data
      : undefined
  const message: string =
    err instanceof Error
      ? err.message
      : typeof data?.message === "string"
        ? data.message
        : ""
  return message.includes("No such file or directory") || message.includes("NotFoundError")
}

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  connectErrorTitle: string
  connectErrorDescription: string
  requestFailedTitle: string
  unknownError: string
  invalidConfigurationError: string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  rootPath?: () => Path | undefined
  rootProvider?: () => ProviderListResponse | undefined
  waitRootProvider?: () => Promise<ProviderListResponse | undefined>
}) {
  const deferredBootstrap = flag("opencode.perf.bootstrap.deferred", true)
  const health = await input.globalSDK.global
    .health()
    .then((x) => x.data)
    .catch(() => undefined)
  if (!health?.healthy) {
    showToast({
      variant: "error",
      title: input.connectErrorTitle,
      description: input.connectErrorDescription,
    })
    input.setGlobalStore("ready", true)
    return
  }

  const notifyErrors = (errors: unknown[]) => {
    if (errors.length === 0) return
    const message = formatServerError(errors[0], {
      unknown: input.unknownError,
      invalidConfiguration: input.invalidConfigurationError,
    })
    const more = errors.length > 1 ? input.formatMoreCount(errors.length - 1) : ""
    showToast({
      variant: "error",
      title: input.requestFailedTitle,
      description: message + more,
    })
  }

  const coreTasks = [
    input.globalSDK.project.list().then((x) => {
      const projects = (x.data ?? [])
        .filter((p) => !!p?.id)
        .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
        .slice()
        .sort((a, b) => cmp(a.id, b.id))
      input.setGlobalStore("project", projects)
    }),
  ]

  const coreResults = await Promise.allSettled(coreTasks)
  const coreErrors = coreResults.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason)
  notifyErrors(coreErrors)
  input.setGlobalStore("ready", true)
  if (!deferredBootstrap) return

  const deferredTasks = [
    (() => {
      const cached = input.rootPath?.()
      if (cached?.directory === "/") {
        input.setGlobalStore("path", cached)
        return Promise.resolve()
      }
      return input.globalSDK.path.get().then((x) => {
        input.setGlobalStore("path", x.data!)
      })
    })(),
    input.globalSDK.global.config.get().then((x) => {
      input.setGlobalStore("config", x.data!)
    }),
    await (async () => {
      const cached = input.rootProvider?.()
      if (cached?.all.length) {
        input.setGlobalStore("provider", cached)
        return
      }
      const shared = await input.waitRootProvider?.()
      if (shared?.all.length) {
        input.setGlobalStore("provider", shared)
        return
      }
      await input.globalSDK.provider.list().then((x) => {
        input.setGlobalStore("provider", normalizeProviderList(x.data!))
      })
    })(),
    input.globalSDK.provider.auth().then((x) => {
      input.setGlobalStore("provider_auth", x.data ?? {})
    }),
  ]
  void Promise.allSettled(deferredTasks).then((deferredResults) => {
    const deferredErrors = deferredResults
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason)
    notifyErrors(deferredErrors)
  })
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  unknownError: string
  invalidConfigurationError: string
  shouldIgnoreError?: () => boolean
}) {
  if (input.store.status !== "complete") input.setStore("status", "loading")

  const blockingRequests = {
    agent: () => input.sdk.app.agents().then((x) => input.setStore("agent", x.data ?? [])),
    config: () => input.sdk.config.get().then((x) => input.setStore("config", x.data!)),
  }

  try {
    await Promise.all(Object.values(blockingRequests).map((p) => p()))
  } catch (err) {
    console.error("Failed to bootstrap instance", err)
    if (input.shouldIgnoreError?.()) {
      input.setStore("status", "partial")
      return
    }
    if (missingDirectory(err)) {
      input.setStore("status", "partial")
      return
    }
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: `Failed to reload ${project}`,
      description: formatServerError(err, {
        unknown: input.unknownError,
        invalidConfiguration: input.invalidConfigurationError,
      }),
    })
    input.setStore("status", "partial")
    return
  }

  if (input.store.status !== "complete") input.setStore("status", "partial")

  Promise.all([
    input.sdk.path.get().then((x) => input.setStore("path", x.data!)),
    input.sdk.command.list().then((x) => input.setStore("command", x.data ?? [])),
    input.sdk.session.status().then((x) => input.setStore("session_status", reconcile(x.data ?? {}))),
    input.loadSessions(input.directory),
    input.sdk.mcp.status().then((x) => input.setStore("mcp", x.data!)),
    input.sdk.lsp.status().then((x) => input.setStore("lsp", x.data!)),
    input.sdk.vcs.get().then((x) => {
      const next = x.data ?? input.store.vcs
      input.setStore("vcs", next)
      if (next?.branch) input.vcsCache.setStore("value", next)
    }),
    input.sdk.permission.list().then((x) => {
      const grouped = groupBySession(
        (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
      )
      batch(() => {
        for (const sessionID of Object.keys(input.store.permission)) {
          if (grouped[sessionID]) continue
          input.setStore("permission", sessionID, [])
        }
        for (const [sessionID, permissions] of Object.entries(grouped)) {
          input.setStore(
            "permission",
            sessionID,
            reconcile(
              permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
    input.sdk.question.list().then((x) => {
      const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
      batch(() => {
        for (const sessionID of Object.keys(input.store.question)) {
          if (grouped[sessionID]) continue
          input.setStore("question", sessionID, [])
        }
        for (const [sessionID, questions] of Object.entries(grouped)) {
          input.setStore(
            "question",
            sessionID,
            reconcile(
              questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
  ]).then(() => {
    input.setStore("status", "complete")
  })
}
