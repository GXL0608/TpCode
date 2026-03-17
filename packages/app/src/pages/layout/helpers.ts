import { getFilename } from "@opencode-ai/util/path"
import { type Project, type Session } from "@opencode-ai/sdk/v2/client"

type ProjectRef = Pick<Project, "worktree"> & { sandboxes?: string[] }

export const workspaceKey = (directory: string) => {
  const drive = directory.match(/^([A-Za-z]:)[\\/]+$/)
  if (drive) return `${drive[1]}${directory.includes("\\") ? "\\" : "/"}`
  if (/^[\\/]+$/.test(directory)) return directory.includes("\\") ? "\\" : "/"
  return directory.replace(/[\\/]+$/, "")
}

/** 中文注释：产品会话与 build 使用的 overlay 目录属于临时工作区，不应作为常驻沙盒直接暴露给侧栏。 */
export const hiddenWorkspaceDirectory = (directory: string) =>
  /(?:^|[\\/])build-overlay(?:[\\/]|$)/i.test(directory)

/** 中文注释：统一计算项目在侧栏中可见的工作区目录，默认隐藏旧 overlay，但保留当前激活的临时会话目录。 */
export function projectWorkspaceDirectories(input: {
  project?: ProjectRef
  currentDir?: string
}) {
  if (!input.project) return [] as string[]
  const root = input.project.worktree
  const visible = [
    root,
    ...(input.project.sandboxes ?? []).filter((directory) => !hiddenWorkspaceDirectory(directory)),
  ].filter((directory, index, list) => list.findIndex((item) => workspaceKey(item) === workspaceKey(directory)) === index)
  const current = input.currentDir
  if (!current) return visible
  if (workspaceKey(current) === workspaceKey(root)) return visible
  if (visible.some((directory) => workspaceKey(directory) === workspaceKey(current))) return visible
  return [root, current, ...visible.filter((directory) => workspaceKey(directory) !== workspaceKey(root))]
}

export function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

export const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

export const sortedRootSessions = (store: { session: Session[]; path: { directory: string } }, now: number) =>
  store.session.filter((session) => isRootVisibleSession(session, store.path.directory)).sort(sortSessions(now))

export const latestRootSession = (stores: { session: Session[]; path: { directory: string } }[], now: number) =>
  stores
    .flatMap((store) => store.session.filter((session) => isRootVisibleSession(session, store.path.directory)))
    .sort(sortSessions(now))[0]

/** 中文注释：根据当前项目、激活目录与工作区展开状态，生成唯一的目录加载计划，确保切换项目时只对激活目录做 bootstrap，其它可见目录只拉 session 列表。 */
export function buildDirectoryLoadPlan(input: {
  project?: ProjectRef
  currentDir?: string
  workspaces: boolean
  expanded: Record<string, boolean | undefined>
}) {
  if (!input.project) {
    return {
      bootstrap: input.currentDir,
      sessions: [] as string[],
    }
  }

  const bootstrap = input.currentDir
  const project = input.project
  if (!input.workspaces) {
    const root = project.worktree
    return {
      bootstrap,
      sessions: bootstrap && workspaceKey(bootstrap) === workspaceKey(root) ? [] : [root],
    }
  }

  const sessions = projectWorkspaceDirectories({
    project,
    currentDir: bootstrap,
  }).filter((directory) => {
    if (bootstrap && workspaceKey(directory) === workspaceKey(bootstrap)) return false
    return input.expanded[directory] ?? directory === project.worktree
  })

  return {
    bootstrap,
    sessions,
  }
}

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined>,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request).some((list) => list?.some(include))
}

export const childMapByParent = (sessions: Session[]) => {
  const map = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export function getDraggableId(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined
  if (!("draggable" in event)) return undefined
  const draggable = (event as { draggable?: { id?: unknown } }).draggable
  if (!draggable) return undefined
  return typeof draggable.id === "string" ? draggable.id : undefined
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

/** 中文注释：Git 项目在没有用户显式配置时默认开启工作区模式，非 Git 项目默认关闭。 */
export const projectSupportsWorkspace = (
  project?: Partial<Pick<Project, "id" | "vcs" | "sandboxes">>,
) => {
  if (!project?.id) return false
  if (project.vcs === "git") return true
  if (project.id.startsWith("batch_")) return true
  return (project.sandboxes?.length ?? 0) > 0
}

/** 中文注释：支持工作区能力的项目统一强制开启工作区视图，不再允许用户关闭。 */
export const workspaceModeEnabled = (
  value: boolean | undefined,
  project?: Partial<Pick<Project, "id" | "vcs" | "sandboxes">>,
) => {
  if (!projectSupportsWorkspace(project)) return false
  return true
}

export const syncWorkspaceOrder = (local: string, dirs: string[], existing?: string[]) => {
  if (!existing) return dirs
  const keep = existing.filter((d) => d !== local && dirs.includes(d))
  const missing = dirs.filter((d) => d !== local && !existing.includes(d))
  return [local, ...missing, ...keep]
}
