import path from "path"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, eq, inArray } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { AccountContextService } from "./context"
import { TpUserProjectStateTable } from "./user-project-state.sql"

type LastSession = {
  session_id: string
  directory: string
  time_updated: number
}

type Info = {
  current_project_id?: string
  last_project_id?: string
  open_project_ids: string[]
  last_session_by_project: Record<string, LastSession>
  workspace_mode_by_project: Record<string, boolean>
  workspace_order_by_project: Record<string, string[]>
  workspace_expanded_by_directory: Record<string, boolean>
  workspace_alias_by_project_branch: Record<string, Record<string, string>>
}

type Patch = Partial<Omit<Info, "current_project_id" | "last_project_id">> & {
  last_project_id?: string | null
}

function uniq(input: string[]) {
  return [...new Set(input)]
}

function norm(input: string) {
  return Filesystem.windowsPath(path.resolve(input)).toLowerCase()
}

function empty(input?: { current_project_id?: string; last_project_id?: string }): Info {
  return {
    current_project_id: input?.current_project_id,
    last_project_id: input?.last_project_id,
    open_project_ids: [],
    last_session_by_project: {},
    workspace_mode_by_project: {},
    workspace_order_by_project: {},
    workspace_expanded_by_directory: {},
    workspace_alias_by_project_branch: {},
  }
}

function rowState(
  row?: typeof TpUserProjectStateTable.$inferSelect,
  input?: { current_project_id?: string },
): Info {
  if (!row) return empty({ current_project_id: input?.current_project_id })
  return {
    current_project_id: input?.current_project_id,
    last_project_id: row.last_project_id ?? undefined,
    open_project_ids: row.open_project_ids ?? [],
    last_session_by_project: row.last_session_by_project ?? {},
    workspace_mode_by_project: row.workspace_mode_by_project ?? {},
    workspace_order_by_project: row.workspace_order_by_project ?? {},
    workspace_expanded_by_directory: row.workspace_expanded_by_directory ?? {},
    workspace_alias_by_project_branch: row.workspace_alias_by_project_branch ?? {},
  }
}

function merge(base: Info, patch?: Patch): Info {
  if (!patch) return base
  return {
    current_project_id: base.current_project_id,
    last_project_id: patch.last_project_id === null ? undefined : (patch.last_project_id ?? base.last_project_id),
    open_project_ids: patch.open_project_ids ?? base.open_project_ids,
    last_session_by_project: patch.last_session_by_project ?? base.last_session_by_project,
    workspace_mode_by_project: patch.workspace_mode_by_project ?? base.workspace_mode_by_project,
    workspace_order_by_project: patch.workspace_order_by_project ?? base.workspace_order_by_project,
    workspace_expanded_by_directory: patch.workspace_expanded_by_directory ?? base.workspace_expanded_by_directory,
    workspace_alias_by_project_branch:
      patch.workspace_alias_by_project_branch ?? base.workspace_alias_by_project_branch,
  }
}

export namespace AccountProjectStateService {
  export type State = Info
  export type StatePatch = Patch

  export async function get(input: { user_id: string; current_project_id?: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpUserProjectStateTable).where(eq(TpUserProjectStateTable.user_id, input.user_id)).get(),
    )
    return sanitize({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
      state: rowState(row, input),
    })
  }

  export async function update(input: { user_id: string; current_project_id?: string; patch: Patch }) {
    const current = await get({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
    })
    const next = await sanitize({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
      state: merge(current, input.patch),
    })
    await Database.use((db) =>
      db.insert(TpUserProjectStateTable)
        .values({
          user_id: input.user_id,
          last_project_id: next.last_project_id,
          open_project_ids: next.open_project_ids,
          last_session_by_project: next.last_session_by_project,
          workspace_mode_by_project: next.workspace_mode_by_project,
          workspace_order_by_project: next.workspace_order_by_project,
          workspace_expanded_by_directory: next.workspace_expanded_by_directory,
          workspace_alias_by_project_branch: next.workspace_alias_by_project_branch,
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: TpUserProjectStateTable.user_id,
          set: {
            last_project_id: next.last_project_id,
            open_project_ids: next.open_project_ids,
            last_session_by_project: next.last_session_by_project,
            workspace_mode_by_project: next.workspace_mode_by_project,
            workspace_order_by_project: next.workspace_order_by_project,
            workspace_expanded_by_directory: next.workspace_expanded_by_directory,
            workspace_alias_by_project_branch: next.workspace_alias_by_project_branch,
            time_updated: Date.now(),
          },
        })
        .run(),
    )
    return next
  }

  export async function sanitize(input: { user_id: string; current_project_id?: string; state: Info }) {
    const allowed = await AccountContextService.projectIDs(input.user_id)
    const projects =
      allowed.length === 0
        ? []
        : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, allowed)).all())
    const projectByID = new Map(projects.map((project) => [project.id, project]))
    const directories = new Map(
      projects.flatMap((project) =>
        [project.worktree, ...(project.sandboxes ?? [])].map((directory) => [norm(directory), project.id] as const),
      ),
    )

    const open_project_ids = uniq(input.state.open_project_ids).filter((project_id) => projectByID.has(project_id))
    const last_project_id = input.state.last_project_id && projectByID.has(input.state.last_project_id)
      ? input.state.last_project_id
      : undefined

    const last_session_ids = uniq(
      Object.entries(input.state.last_session_by_project)
        .filter(([project_id]) => projectByID.has(project_id))
        .map(([, value]) => value?.session_id)
        .filter((session_id): session_id is string => !!session_id),
    )
    const sessions =
      last_session_ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select({
                id: SessionTable.id,
                project_id: SessionTable.project_id,
                context_project_id: SessionTable.context_project_id,
                user_id: SessionTable.user_id,
                directory: SessionTable.directory,
                time_updated: SessionTable.time_updated,
              })
              .from(SessionTable)
              .where(inArray(SessionTable.id, last_session_ids))
              .all(),
          )
    const sessionByID = new Map(sessions.map((session) => [session.id, session]))

    const last_session_by_project = Object.fromEntries(
      Object.entries(input.state.last_session_by_project).flatMap(([project_id, value]) => {
        if (!value || !projectByID.has(project_id)) return []
        const session = sessionByID.get(value.session_id)
        if (!session) return []
        if (session.user_id !== input.user_id) return []
        const current = session.context_project_id ?? session.project_id
        if (session.project_id !== project_id || current !== project_id) return []
        if (directories.get(norm(session.directory)) !== project_id) return []
        return [
          [
            project_id,
            {
              session_id: session.id,
              directory: session.directory,
              time_updated: value.time_updated || session.time_updated,
            } satisfies LastSession,
          ] as const,
        ]
      }),
    )

    const workspace_mode_by_project = Object.fromEntries(
      Object.entries(input.state.workspace_mode_by_project).flatMap(([project_id, value]) =>
        projectByID.has(project_id) ? [[project_id, !!value] as const] : [],
      ),
    )

    const workspace_order_by_project = Object.fromEntries(
      projects.map((project) => {
        const all = [project.worktree, ...(project.sandboxes ?? [])]
        const keep = uniq((input.state.workspace_order_by_project[project.id] ?? []).filter((directory) => {
          return directories.get(norm(directory)) === project.id
        }))
        const order = [project.worktree, ...keep.filter((directory) => norm(directory) !== norm(project.worktree))]
        const missing = all.filter((directory) => !order.some((item) => norm(item) === norm(directory)))
        return [project.id, [...order, ...missing]]
      }),
    )

    const workspace_expanded_by_directory = Object.fromEntries(
      Object.entries(input.state.workspace_expanded_by_directory).flatMap(([directory, value]) =>
        directories.has(norm(directory)) ? [[directory, !!value] as const] : [],
      ),
    )

    const workspace_alias_by_project_branch = Object.fromEntries(
      Object.entries(input.state.workspace_alias_by_project_branch).flatMap(([project_id, branches]) => {
        if (!projectByID.has(project_id) || !branches || typeof branches !== "object") return []
        const next = Object.fromEntries(
          Object.entries(branches).flatMap(([branch, value]) => {
            if (!branch.trim()) return []
            if (typeof value !== "string") return []
            const alias = value.trim()
            if (!alias) return []
            return [[branch, alias] as const]
          }),
        )
        if (Object.keys(next).length === 0) return []
        return [[project_id, next] as const]
      }),
    )

    return {
      current_project_id: input.current_project_id,
      last_project_id,
      open_project_ids,
      last_session_by_project,
      workspace_mode_by_project,
      workspace_order_by_project,
      workspace_expanded_by_directory,
      workspace_alias_by_project_branch,
    } satisfies Info
  }
}
