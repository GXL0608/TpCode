import path from "path"
import { ProjectTable } from "@/project/project.sql"
import { MessageTable, SessionTable } from "@/session/session.sql"
import { Database, eq, inArray, or } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { AccountContextService } from "./context"
import { AccountProductService } from "./product"
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
  last_session_by_product: Record<string, LastSession>
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
  return Filesystem.normalizePath(input).toLowerCase()
}

/** 中文注释：从 overlay 或 worktree 目录中反推出所属项目，保证隐藏沙盒会话刷新后仍能恢复。 */
function derivedProjectID(input: string) {
  const match = input
    .replace(/\\/g, "/")
    .match(/(?:^|\/)(?:(?:batch-)?worktree|build-overlay)\/([^/]+)(?:\/|$)/i)
  return match?.[1]?.toLowerCase()
}

/** 中文注释：判断会话目录是否仍然属于目标项目，避免把其他项目或失效沙盒误当成当前产品历史会话。 */
function belongsProject(input: {
  directory: string
  project_id: string
  directories: Map<string, string>
}) {
  const direct = input.directories.get(norm(input.directory))
  const derived = derivedProjectID(input.directory)
  return direct === input.project_id || derived === input.project_id.toLowerCase()
}

/** 中文注释：当前产品上下文应把绑定解决方案的项目一并纳入有效项目集合，否则产品下的前后端目录会在状态清洗时被错误裁掉。 */
async function scopedProjectRows(input: { user_id: string; current_product_id?: string }) {
  const ids = new Set(await AccountContextService.projectIDs(input.user_id))
  if (input.current_product_id) {
    const product = await AccountProductService.get(input.current_product_id, "light")
    for (const project_id of [product?.project_id, ...(product?.related_project_ids ?? [])].filter(Boolean)) {
      ids.add(project_id)
    }
  }
  const rows =
    ids.size === 0
      ? []
      : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, [...ids])).all())
  return {
    ids: [...ids],
    rows,
  }
}

/** 中文注释：为每个项目挑选最近一条真正有消息的会话，供刷新页面和重新登录后兜底恢复历史对话。 */
async function fallbackSessions(input: {
  user_id: string
  project_ids: string[]
  projectByID: Map<string, typeof ProjectTable.$inferSelect>
  directories: Map<string, string>
}) {
  const project_ids = uniq(input.project_ids.filter((project_id) => input.projectByID.has(project_id)))
  if (project_ids.length === 0) return new Map<string, typeof SessionTable.$inferSelect>()
  const sessions = await Database.use((db) =>
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
      .where(
        or(
          inArray(SessionTable.project_id, project_ids),
          inArray(SessionTable.context_project_id, project_ids),
        ),
      )
      .all(),
  )
  const own = sessions.filter((session) => session.user_id === input.user_id)
  const message_ids = own.map((session) => session.id)
  const nonempty =
    message_ids.length === 0
      ? new Set<string>()
      : new Set(
          (
            await Database.use((db) =>
              db
                .select({ session_id: MessageTable.session_id })
                .from(MessageTable)
                .where(inArray(MessageTable.session_id, message_ids))
                .all(),
            )
          ).map((row) => row.session_id),
        )
  const map = new Map<string, typeof own[number]>()
  for (const session of own.sort((a, b) => b.time_updated - a.time_updated)) {
    const project_id = session.context_project_id ?? session.project_id
    if (!project_id || map.has(project_id)) continue
    if (!nonempty.has(session.id)) continue
    if (!belongsProject({ directory: session.directory, project_id, directories: input.directories })) continue
    map.set(project_id, session)
  }
  return map
}

function empty(input?: { current_project_id?: string; last_project_id?: string }): Info {
  return {
    current_project_id: input?.current_project_id,
    last_project_id: input?.last_project_id,
    open_project_ids: [],
    last_session_by_project: {},
    last_session_by_product: {},
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
    last_session_by_product: row.last_session_by_product ?? {},
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
    last_session_by_product: patch.last_session_by_product ?? base.last_session_by_product,
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

  export async function get(input: { user_id: string; current_project_id?: string; current_product_id?: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpUserProjectStateTable).where(eq(TpUserProjectStateTable.user_id, input.user_id)).get(),
    )
    return sanitize({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
      current_product_id: input.current_product_id,
      state: rowState(row, input),
    })
  }

  export async function update(input: {
    user_id: string
    current_project_id?: string
    current_product_id?: string
    patch: Patch
  }) {
    const current = await get({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
      current_product_id: input.current_product_id,
    })
    const next = await sanitize({
      user_id: input.user_id,
      current_project_id: input.current_project_id,
      current_product_id: input.current_product_id,
      state: merge(current, input.patch),
    })
    await Database.use((db) =>
      db.insert(TpUserProjectStateTable)
        .values({
          user_id: input.user_id,
          last_project_id: next.last_project_id,
          open_project_ids: next.open_project_ids,
          last_session_by_project: next.last_session_by_project,
          last_session_by_product: next.last_session_by_product,
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
            last_session_by_product: next.last_session_by_product,
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

  export async function sanitize(input: {
    user_id: string
    current_project_id?: string
    current_product_id?: string
    state: Info
  }) {
    const scoped = await scopedProjectRows({
      user_id: input.user_id,
      current_product_id: input.current_product_id,
    })
    const projects = scoped.rows
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
      [
        ...Object.entries(input.state.last_session_by_project)
          .filter(([project_id]) => projectByID.has(project_id))
          .map(([, value]) => value?.session_id),
        ...Object.values(input.state.last_session_by_product).map((value) => value?.session_id),
      ]
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
    const nonempty =
      last_session_ids.length === 0
        ? new Set<string>()
        : new Set(
            (
              await Database.use((db) =>
                db
                  .select({ session_id: MessageTable.session_id })
                  .from(MessageTable)
                  .where(inArray(MessageTable.session_id, last_session_ids))
                  .all(),
              )
            ).map((row) => row.session_id),
          )
    const candidate_project_ids = uniq(
      [
        ...Object.keys(input.state.last_session_by_project),
        ...open_project_ids,
        last_project_id,
        input.current_project_id,
      ].filter((project_id): project_id is string => !!project_id && projectByID.has(project_id)),
    )
    const fallback = await fallbackSessions({
      user_id: input.user_id,
      project_ids: candidate_project_ids,
      projectByID,
      directories,
    })

    const last_session_by_project = Object.fromEntries(
      candidate_project_ids.flatMap((project_id) => {
        const value = input.state.last_session_by_project[project_id]
        const session = value ? sessionByID.get(value.session_id) : undefined
        const current = session?.context_project_id ?? session?.project_id
        const remembered =
          session &&
          current === project_id &&
          session.user_id === input.user_id &&
          nonempty.has(session.id) &&
          belongsProject({ directory: session.directory, project_id, directories })
            ? {
                session_id: session.id,
                directory: session.directory,
                time_updated: value?.time_updated || session.time_updated,
              }
            : undefined
        if (remembered) {
          return [[project_id, remembered] as const]
        }
        const next = fallback.get(project_id)
        if (!next) return []
        return [
          [
            project_id,
            {
              session_id: next.id,
              directory: next.directory,
              time_updated: next.time_updated,
            } satisfies LastSession,
          ] as const,
        ]
      }),
    )

    /** 中文注释：产品级最近会话只校验会话存在、属于当前用户且包含真实消息，避免共享项目下不同产品继续共用同一条历史。 */
    const last_session_by_product = Object.fromEntries(
      Object.entries(input.state.last_session_by_product).flatMap(([product_id, value]) => {
        const session = value ? sessionByID.get(value.session_id) : undefined
        if (!session || session.user_id !== input.user_id || !nonempty.has(session.id)) return []
        return [
          [
            product_id,
            {
              session_id: session.id,
              directory: session.directory,
              time_updated: value?.time_updated || session.time_updated,
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
      last_session_by_product,
      workspace_mode_by_project,
      workspace_order_by_project,
      workspace_expanded_by_directory,
      workspace_alias_by_project_branch,
    } satisfies Info
  }
}
