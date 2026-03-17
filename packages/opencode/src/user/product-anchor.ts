import { createHash } from "crypto"
import { Database, eq, inArray } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { Project } from "@/project/project"
import { ProjectTable } from "@/project/project.sql"
import type { ProductSolutionItem, ProductSolutionRootInput, ProductSolutionRootItem } from "./product-solution"

type RootLike = ProductSolutionRootInput | ProductSolutionRootItem
type Anchor = {
  project_id: string
  worktree: string
  vcs?: string
}

const CACHE_TTL_MS = 300_000
const projectCache = new Map<string, { expires_at: number; value: Project.Info | undefined }>()
const anchorCache = new Map<string, { expires_at: number; value: Anchor | undefined }>()
const projectIDsCache = new Map<string, { expires_at: number; value: string[] }>()
const projectPending = new Map<string, Promise<Project.Info | undefined>>()
const anchorPending = new Map<string, Promise<Anchor | undefined>>()
const projectIDsPending = new Map<string, Promise<string[]>>()

/** 中文注释：把任意目录字符串规整成稳定路径键，便于为非 Git 目录创建持久项目记录。 */
function key(input: string) {
  return Filesystem.stablePath(input).toLowerCase()
}

/** 中文注释：为非 Git 目录生成稳定 project_id，保证同一路径多次解析得到同一个项目锚点。 */
function folderID(input: string) {
  const digest = createHash("sha1").update(key(input)).digest("hex").slice(0, 24)
  return `folder_${digest}`
}

/** 中文注释：从解决方案根目录中挑出最适合作为上下文锚点的第一个真实目录。 */
function rootDirectory(root: RootLike) {
  if (root.root_type === "virtual_group") return root.meta?.directories?.find((item) => item.trim())
  const current = root.directory?.trim()
  if (!current) return
  return current
}

/** 中文注释：按 TTL 读取缓存条目，过期时自动剔除，避免网络共享目录被重复探测。 */
function cached<Value>(map: Map<string, { expires_at: number; value: Value }>, item: string) {
  const hit = map.get(item)
  if (!hit) return { hit: false as const }
  if (hit.expires_at > Date.now()) return { hit: true as const, value: hit.value }
  map.delete(item)
  return { hit: false as const }
}

/** 中文注释：把当前结果写入缓存，统一控制产品锚点与项目解析的过期时间。 */
function remember<Value>(map: Map<string, { expires_at: number; value: Value }>, item: string, value: Value) {
  map.set(item, {
    expires_at: Date.now() + CACHE_TTL_MS,
    value,
  })
  return value
}

/** 中文注释：把解决方案集合压缩成稳定签名，供产品锚点和项目列表缓存复用。 */
function signature(solutions: ProductSolutionItem[]) {
  return solutions
    .map((item) => ({
      id: item.id,
      time_updated: item.time_updated,
      primary_project_id: item.primary_project_id ?? "",
      roots: item.roots.map((root) => ({
        root_type: root.root_type,
        directory: root.directory,
        meta: root.meta?.directories ?? [],
      })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => JSON.stringify(item))
    .join("|")
}

/** 中文注释：在产品或解决方案配置变更后主动清空锚点缓存，避免列表和权限短时间读到旧目录。 */
export function invalidateProductAnchorCache() {
  projectCache.clear()
  anchorCache.clear()
  projectIDsCache.clear()
  projectPending.clear()
  anchorPending.clear()
  projectIDsPending.clear()
}

/** 中文注释：按目录确保存在对应项目记录，供产品和解决方案在无产品目录时派生上下文项目。 */
export async function ensureProjectByDirectory(directory?: string) {
  const current = directory?.trim()
  if (!current) return
  const stable = Filesystem.stablePath(current)
  const cachedProject = cached(projectCache, stable)
  if (cachedProject.hit) return cachedProject.value
  const pending = projectPending.get(stable)
  if (pending) return pending
  /** 中文注释：共享目录解析经常会被并发触发，必须复用同一个 Promise，避免同一路径同时重复执行 Project.fromDirectory。 */
  const task = (async () => {
    const worktree = Filesystem.accessPath(stable)
    if (!(await Filesystem.isDir(stable))) return remember(projectCache, stable, undefined)
    const result = await Project.fromDirectory(worktree)
      .then((item) => item.project)
      .catch(() => undefined)
    if (result && result.id !== "global") return remember(projectCache, stable, result)
    const now = Date.now()
    const id = folderID(stable)
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (row) {
      if (row.worktree !== worktree) {
        await Database.use((db) =>
          db
            .update(ProjectTable)
            .set({
              worktree,
              name: Filesystem.baseName(stable) || row.name || undefined,
              time_updated: now,
            })
            .where(eq(ProjectTable.id, id))
            .run(),
        )
        const updated = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (updated) return remember(projectCache, stable, Project.fromRow(updated))
      }
      return remember(projectCache, stable, Project.fromRow(row))
    }
    await Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id,
          worktree,
          vcs: null,
          name: Filesystem.baseName(stable) || undefined,
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing()
        .run(),
    )
    const created = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!created) return remember(projectCache, stable, undefined)
    return remember(projectCache, stable, Project.fromRow(created))
  })().finally(() => {
    projectPending.delete(stable)
  })
  projectPending.set(stable, task)
  return task
}

/** 中文注释：为解决方案推导默认主项目，优先显式配置，其次取 roots 中第一个真实目录。 */
export async function solutionProjectID(input: {
  primary_project_id?: string
  roots: RootLike[]
}) {
  const explicit = input.primary_project_id?.trim()
  if (explicit) return explicit
  for (const root of input.roots) {
    const project = await ensureProjectByDirectory(rootDirectory(root))
    if (project) return project.id
  }
}

/** 中文注释：为运行时入口优先挑选 roots 对应的真实项目，只有 roots 无法解析时才回退到显式主项目。 */
async function runtimeProjectID(input: {
  primary_project_id?: string
  roots: RootLike[]
}) {
  for (const root of input.roots) {
    const project = await ensureProjectByDirectory(rootDirectory(root))
    if (project) return project.id
  }
  return input.primary_project_id?.trim() || undefined
}

/** 中文注释：为单个解决方案推导全部项目锚点，供产品权限与上下文可见性统一复用。 */
export async function solutionProjectIDs(input: {
  primary_project_id?: string
  roots: RootLike[]
}) {
  const ids = new Set<string>()
  const explicit = input.primary_project_id?.trim()
  if (explicit) ids.add(explicit)
  for (const root of input.roots) {
    const project = await ensureProjectByDirectory(rootDirectory(root))
    if (project) ids.add(project.id)
  }
  return [...ids]
}

/** 中文注释：按项目 ID 批量回填项目行，供产品锚点和权限推导统一复用。 */
export async function projectMap(project_ids: string[]) {
  const ids = [...new Set(project_ids.filter(Boolean))]
  if (ids.length === 0) return new Map<string, typeof ProjectTable.$inferSelect>()
  const rows = await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, ids)).all())
  return new Map(rows.map((item) => [item.id, item]))
}

/** 中文注释：从一组解决方案中推导产品运行所需的锚点项目，供产品列表和 build 主链复用。 */
export async function anchorBySolutions(solutions: ProductSolutionItem[]) {
  const key = signature(solutions)
  const item = cached(anchorCache, key)
  if (item.hit) return item.value
  const pending = anchorPending.get(key)
  if (pending) return pending
  /** 中文注释：产品锚点会被产品列表、上下文恢复和 build 主链同时请求，复用同一 Promise 可以显著降低首屏卡顿。 */
  const task = (async () => {
    const ids = (
      await Promise.all(
        solutions.map((item) =>
          runtimeProjectID({
            primary_project_id: item.primary_project_id,
            roots: item.roots,
          }),
        ),
      )
    ).filter((item): item is string => Boolean(item))
    const project_id = ids[0]
    if (!project_id) return remember(anchorCache, key, undefined)
    const map = await projectMap([project_id])
    const row = map.get(project_id)
    if (!row) return remember(anchorCache, key, undefined)
    return remember(anchorCache, key, {
      project_id: row.id,
      worktree: row.worktree,
      vcs: row.vcs ?? undefined,
    })
  })().finally(() => {
    anchorPending.delete(key)
  })
  anchorPending.set(key, task)
  return task
}

/** 中文注释：从一组解决方案中推导产品相关的全部项目，用于产品可见性、角色授权和旧链路兼容。 */
export async function projectIDsBySolutions(solutions: ProductSolutionItem[]) {
  const key = signature(solutions)
  const item = cached(projectIDsCache, key)
  if (item.hit) return item.value
  const pending = projectIDsPending.get(key)
  if (pending) return pending
  /** 中文注释：产品权限和产品列表都会读取关联项目集合，缓存进行中的解析可以避免同一批解决方案重复扫盘。 */
  const task = (async () => {
    const ids = (
      await Promise.all(
        solutions.map((item) =>
          solutionProjectIDs({
            primary_project_id: item.primary_project_id,
            roots: item.roots,
          }),
        ),
      )
    ).flat()
    return remember(projectIDsCache, key, [...new Set(ids)])
  })().finally(() => {
    projectIDsPending.delete(key)
  })
  projectIDsPending.set(key, task)
  return task
}
