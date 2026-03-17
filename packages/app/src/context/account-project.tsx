import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  type AccountProjectState,
  type AccountProjectStatePatch,
  type AccountProjectStateLastSession,
  useAccountAuth,
} from "./account-auth"
import { useGlobalSync } from "./global-sync"
import { directoryKey, projectDirectories, resolveProjectByDirectory, sanitizeProjectWorkspaceOrder } from "./project-resolver"

export function visibleProjectIDs(input: {
  projects: readonly Pick<Project, "id">[]
  open_project_ids: string[]
  current_project_id?: string
}) {
  const ids = input.projects.map((project) => project.id)
  const open = [...new Set(input.open_project_ids.filter((project_id) => ids.includes(project_id)))]
  if (!input.current_project_id) return open
  if (!ids.includes(input.current_project_id)) return open
  if (open.includes(input.current_project_id)) return open
  return [...open, input.current_project_id]
}

/** 中文注释：同一真实目录可能同时以 UNC、盘符或挂载路径出现，侧栏只保留一个项目条目并优先显示当前项目。 */
export function collapseVisibleProjects<T extends Pick<Project, "id" | "worktree">>(input: {
  projects: readonly T[]
  current_project_id?: string
}) {
  const map = new Map<string, T>()
  for (const project of input.projects) {
    const key = directoryKey(project.worktree)
    const current = map.get(key)
    if (!current) {
      map.set(key, project)
      continue
    }
    if (current.id === input.current_project_id) continue
    if (project.id === input.current_project_id) {
      map.set(key, project)
      continue
    }
  }
  return [...map.values()]
}

export function nextOpenProjectIDs(input: {
  open_project_ids: string[]
  project_id: string
}) {
  if (input.open_project_ids.includes(input.project_id)) return input.open_project_ids
  return [...input.open_project_ids, input.project_id]
}

/** 中文注释：产品上下文优先使用后端返回的关联项目集合；旧数据仍回退到单个 project_id。 */
export function productProjectIDs(input?: {
  project_id?: string
  related_project_ids?: string[]
}) {
  const ids = [...new Set((input?.related_project_ids ?? []).filter(Boolean))]
  if (ids.length > 0) return ids
  if (!input?.project_id) return []
  return [input.project_id]
}

/** 中文注释：为产品挑选当前要进入的项目，优先使用产品内最近一次选中的项目，再回退到首个关联项目。 */
export function productEntryProjectID(input: {
  product?: {
    project_id?: string
    related_project_ids?: string[]
  }
  current_project_id?: string
  last_project_id?: string
}) {
  const ids = productProjectIDs(input.product)
  if (ids.length === 0) return
  if (input.current_project_id && ids.includes(input.current_project_id)) return input.current_project_id
  if (input.last_project_id && ids.includes(input.last_project_id)) return input.last_project_id
  return ids[0]
}

/** 中文注释：为产品路由选择一个稳定目录，避免继续落回过期锚点或空 worktree。 */
export function productEntryDirectory<T extends Pick<Project, "id" | "worktree">>(input: {
  product?: {
    project_id?: string
    related_project_ids?: string[]
    worktree?: string
  }
  projects: readonly T[]
  current_project_id?: string
  last_project_id?: string
}) {
  const project_id = productEntryProjectID(input)
  const project = input.projects.find((item) => item.id === project_id)
  if (project?.worktree) return project.worktree
  return input.product?.worktree
}

/** 中文注释：从产品关联项目里挑出最近一次会话，供刷新页面和重新登录后恢复到正确的产品会话。 */
export function latestRememberedProductSession(input: {
  product?: {
    project_id?: string
    related_project_ids?: string[]
  }
  last_session_by_project: Record<string, AccountProjectStateLastSession>
}) {
  return productProjectIDs(input.product)
    .map((project_id) => input.last_session_by_project[project_id])
    .filter((item): item is AccountProjectStateLastSession => !!item?.session_id)
    .sort((a, b) => b.time_updated - a.time_updated)[0]
}

export function repairProjectID(input: {
  ready: boolean
  hydrated: boolean
  authenticated: boolean
  pending: boolean
  projects: readonly Pick<Project, "id">[]
  open_project_ids: string[]
  current_project_id?: string
}) {
  if (!input.ready || !input.hydrated || !input.authenticated || input.pending) return
  if (!input.current_project_id) return
  if (!input.projects.some((project) => project.id === input.current_project_id)) return
  if (input.open_project_ids.includes(input.current_project_id)) return
  return input.current_project_id
}

/** 中文注释：主动切换项目上下文后，跳过同一 project_id 触发的那次 effect 补拉，避免 account/context/state 重复请求。 */
export function shouldSkipAccountProjectReload(input: {
  skip_for?: string
  context_project_id?: string
}) {
  return !!input.skip_for && input.skip_for === input.context_project_id
}

/** 中文注释：产品上下文没有锚点项目时，不能继续沿用上一个产品残留的 current_project_id。 */
export function currentProjectID(input: {
  context_project_id?: string
  context_product_id?: string
  state_current_project_id?: string
}) {
  if (input.context_product_id && !input.context_project_id) return
  return input.context_project_id ?? input.state_current_project_id
}

function empty(current_project_id?: string): AccountProjectState {
  return {
    current_project_id,
    last_project_id: undefined,
    open_project_ids: [],
    last_session_by_project: {},
    workspace_mode_by_project: {},
    workspace_order_by_project: {},
    workspace_expanded_by_directory: {},
    workspace_alias_by_project_branch: {},
  }
}

function optimisticState(input: {
  state: AccountProjectState
  project_id: string
  ensure_open: boolean
}) {
  return {
    ...input.state,
    current_project_id: input.project_id,
    last_project_id: input.project_id,
    open_project_ids: input.ensure_open
      ? nextOpenProjectIDs({
          open_project_ids: input.state.open_project_ids,
          project_id: input.project_id,
        })
      : input.state.open_project_ids,
  }
}

export const { use: useAccountProject, provider: AccountProjectProvider } = createSimpleContext({
  name: "AccountProject",
  init: () => {
    const auth = useAccountAuth()
    const globalSync = useGlobalSync()
    const [ready, setReady] = createSignal(false)
    const [hydrated, setHydrated] = createSignal(false)
    const [store, setStore] = createStore({
      data: empty(),
      pending: false,
    })

    const projects = createMemo(() => globalSync.data.project)
    const currentID = createMemo(() =>
      currentProjectID({
        context_project_id: auth.user()?.context_project_id,
        context_product_id: auth.user()?.context_product_id,
        state_current_project_id: store.data.current_project_id,
      }),
    )
    const list = createMemo(() =>
      collapseVisibleProjects({
        projects: visibleProjectIDs({
          projects: projects(),
          open_project_ids: store.data.open_project_ids,
          current_project_id: currentID(),
        })
          .map((project_id) => projects().find((project) => project.id === project_id))
          .filter((project): project is Project => !!project),
        current_project_id: currentID(),
      }).map((project) => ({ ...project, expanded: true })),
    )

    const current = createMemo(() => projects().find((project) => project.id === currentID()))
    let reloading: Promise<AccountProjectState> | undefined
    let skipReloadForContext: string | undefined

    const replace = (next?: AccountProjectState) => {
      setStore("data", next ?? empty(auth.user()?.context_project_id))
    }

    const apply = (next: AccountProjectState) => {
      setStore("data", next)
      return next
    }

    /** 中文注释：账号项目状态只允许一个 in-flight 拉取，避免切项目时 account/context/state 并发重复请求。 */
    const reload = async () => {
      const pending = reloading
      if (pending) return pending
      const task = (async () => {
        if (!auth.ready()) return store.data
        if (!auth.enabled() || !auth.authenticated()) {
          replace(empty(auth.user()?.context_project_id))
          setHydrated(false)
          setReady(true)
          return store.data
        }
        const next = await auth.contextState()
        if (next) {
          replace(next)
          setHydrated(true)
        }
        if (!next) {
          setHydrated(false)
        }
        setReady(true)
        return next ?? store.data
      })().finally(() => {
        reloading = undefined
      })
      reloading = task
      return task
    }

    const patch = async (input: AccountProjectStatePatch) => {
      if (!auth.ready()) return store.data
      if (!auth.enabled() || !auth.authenticated()) return store.data
      setStore("pending", true)
      const next = await auth.updateContextState(input)
      if (next) replace(next)
      setStore("pending", false)
      return next ?? store.data
    }

    const touch = async (project_id: string) => {
      if (store.data.last_project_id === project_id) return store.data
      apply({
        ...store.data,
        last_project_id: project_id,
      })
      return patch({
        last_project_id: project_id,
      })
    }

    const open = async (project_id: string) => {
      const next = optimisticState({
        state: store.data,
        project_id,
        ensure_open: true,
      })
      apply(next)
      return patch({
        last_project_id: project_id,
        open_project_ids: next.open_project_ids,
      })
    }

    const close = async (project_id: string) => {
      const next = store.data.open_project_ids.filter((item) => item !== project_id)
      return patch({
        last_project_id: store.data.last_project_id === project_id ? next[0] ?? null : store.data.last_project_id,
        open_project_ids: next,
      })
    }

    const move = async (project_id: string, toIndex: number) => {
      const current = store.data.open_project_ids.filter((item) => item !== project_id)
      const index = Math.max(0, Math.min(toIndex, current.length))
      current.splice(index, 0, project_id)
      return patch({
        open_project_ids: current,
      })
    }

    /** 中文注释：工作区模式切换先做本地乐观更新，确保侧边栏能立刻反映当前项目的 workspace 视图。 */
    const setWorkspaceMode = async (project_id: string, value: boolean) => {
      apply({
        ...store.data,
        workspace_mode_by_project: {
          ...store.data.workspace_mode_by_project,
          [project_id]: value,
        },
      })
      return patch({
        workspace_mode_by_project: {
          ...store.data.workspace_mode_by_project,
          [project_id]: value,
        },
      })
    }

    const setWorkspaceOrder = async (project_id: string, order: string[]) => {
      const project = projects().find((item) => item.id === project_id)
      if (!project) return store.data
      return patch({
        workspace_order_by_project: {
          ...store.data.workspace_order_by_project,
          [project_id]: sanitizeProjectWorkspaceOrder(project, order),
        },
      })
    }

    /** 中文注释：工作区展开状态先做本地乐观更新，确保新 worktree 加入侧边栏后能立即展开显示 session。 */
    const setWorkspaceExpanded = async (directory: string, value: boolean) => {
      const optimistic = {
        ...store.data,
        workspace_expanded_by_directory: {
          ...store.data.workspace_expanded_by_directory,
          [directory]: value,
        },
      }
      apply(optimistic)
      const next = await patch({
        workspace_expanded_by_directory: {
          ...store.data.workspace_expanded_by_directory,
          [directory]: value,
        },
      })
      const project = resolveProjectByDirectory(projects(), directory)
      if (!project) return next
      if (!projectDirectories(project).some((item) => item === directory)) return next
      if (next.workspace_expanded_by_directory[directory] === value) return next
      const merged = {
        ...next,
        workspace_expanded_by_directory: {
          ...next.workspace_expanded_by_directory,
          [directory]: value,
        },
      }
      apply(merged)
      return merged
    }

    const setWorkspaceAlias = async (project_id: string, branch: string, value?: string) => {
      const current = {
        ...(store.data.workspace_alias_by_project_branch[project_id] ?? {}),
      }
      if (value?.trim()) current[branch] = value.trim()
      if (!value?.trim()) delete current[branch]
      return patch({
        workspace_alias_by_project_branch: {
          ...store.data.workspace_alias_by_project_branch,
          ...(Object.keys(current).length === 0
            ? {}
            : {
                [project_id]: current,
              }),
        },
      })
    }

    const rememberSession = async (project_id: string, session: { id: string; directory: string; at?: number }) =>
      patch({
        last_project_id: project_id,
        last_session_by_project: {
          ...store.data.last_session_by_project,
          [project_id]: {
            session_id: session.id,
            directory: session.directory,
            time_updated: session.at ?? Date.now(),
          },
        },
      })

    const activate = async (project_id: string, ensure_open = true) => {
      const contextChanged = auth.user()?.context_project_id !== project_id
      if (contextChanged) {
        const result = await auth.selectContext(project_id)
        if (!result.ok) return { ok: false as const }
        skipReloadForContext = project_id
      }
      const state = apply(
        optimisticState({
          state: store.data,
          project_id,
          ensure_open,
        }),
      )
      const sync = (async () => {
        void globalSync.refreshProjects()
        const next = await reload()
        if (!ensure_open) return next
        const open_project_ids = nextOpenProjectIDs({
          open_project_ids: next.open_project_ids,
          project_id,
        })
        if (next.last_project_id === project_id && open_project_ids === next.open_project_ids) return next
        return patch({
          last_project_id: project_id,
          open_project_ids,
        })
      })()
      return {
        ok: true as const,
        state,
        sync,
      }
    }

    createEffect(() => {
      if (!auth.ready()) return
      auth.enabled()
      auth.authenticated()
      const context_project_id = auth.user()?.context_project_id
      if (
        shouldSkipAccountProjectReload({
          skip_for: skipReloadForContext,
          context_project_id,
        })
      ) {
        skipReloadForContext = undefined
        return
      }
      void reload()
    })

    createEffect(() => {
      if (!auth.ready()) return
      const project_id = repairProjectID({
        ready: ready(),
        hydrated: hydrated(),
        authenticated: auth.enabled() && auth.authenticated(),
        pending: store.pending,
        projects: projects(),
        open_project_ids: store.data.open_project_ids,
        current_project_id: currentID(),
      })
      if (!project_id) return
      void open(project_id)
    })

    return {
      ready,
      pending: createMemo(() => store.pending),
      data: createMemo(() => store.data),
      list,
      current,
      reload,
      patch,
      touch,
      open,
      close,
      move,
      activate,
      rememberSession,
      setWorkspaceMode,
      setWorkspaceOrder,
      setWorkspaceExpanded,
      setWorkspaceAlias,
      projectIDForDirectory(directory: string) {
        return resolveProjectByDirectory(projects(), directory)?.id
      },
      projectForDirectory(directory: string) {
        return resolveProjectByDirectory(projects(), directory)
      },
      directories(project_id: string) {
        const project = projects().find((item) => item.id === project_id)
        if (!project) return []
        return projectDirectories(project)
      },
    }
  },
})
