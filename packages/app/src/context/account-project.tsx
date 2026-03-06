import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  type AccountProjectState,
  type AccountProjectStatePatch,
  useAccountAuth,
} from "./account-auth"
import { useGlobalSync } from "./global-sync"
import { projectDirectories, resolveProjectByDirectory, sanitizeProjectWorkspaceOrder } from "./project-resolver"

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

export const { use: useAccountProject, provider: AccountProjectProvider } = createSimpleContext({
  name: "AccountProject",
  init: () => {
    const auth = useAccountAuth()
    const globalSync = useGlobalSync()
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore({
      data: empty(),
      pending: false,
    })

    const projects = createMemo(() => globalSync.data.project)
    const list = createMemo(() =>
      store.data.open_project_ids
        .map((project_id) => projects().find((project) => project.id === project_id))
        .filter((project): project is Project => !!project)
        .map((project) => ({ ...project, expanded: true })),
    )

    const current = createMemo(() => projects().find((project) => project.id === store.data.current_project_id))

    const replace = (next?: AccountProjectState) => {
      setStore("data", next ?? empty(auth.user()?.context_project_id))
    }

    const reload = async () => {
      if (!auth.ready()) return store.data
      if (!auth.enabled() || !auth.authenticated()) {
        replace(empty(auth.user()?.context_project_id))
        setReady(true)
        return store.data
      }
      setReady(false)
      const next = await auth.contextState()
      replace(next)
      setReady(true)
      return next ?? store.data
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

    const touch = async (project_id: string) =>
      patch({
        last_project_id: project_id,
      })

    const open = async (project_id: string) => {
      const next = [project_id, ...store.data.open_project_ids.filter((item) => item !== project_id)]
      return patch({
        last_project_id: project_id,
        open_project_ids: next,
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

    const setWorkspaceMode = async (project_id: string, value: boolean) =>
      patch({
        workspace_mode_by_project: {
          ...store.data.workspace_mode_by_project,
          [project_id]: value,
        },
      })

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

    const setWorkspaceExpanded = async (directory: string, value: boolean) =>
      patch({
        workspace_expanded_by_directory: {
          ...store.data.workspace_expanded_by_directory,
          [directory]: value,
        },
      })

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
      if (auth.user()?.context_project_id !== project_id) {
        const result = await auth.selectContext(project_id)
        if (!result.ok) return { ok: false as const }
      }
      await globalSync.bootstrap()
      const next = await reload()
      if (ensure_open) {
        await open(project_id)
      }
      return {
        ok: true as const,
        state: next,
      }
    }

    createEffect(() => {
      if (!auth.ready()) return
      auth.enabled()
      auth.authenticated()
      auth.user()?.context_project_id
      void reload()
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
