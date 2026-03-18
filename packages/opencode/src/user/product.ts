import path from "path"
import { ulid } from "ulid"
import { Database, and, eq, inArray, isNull } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { TpProjectRoleAccessTable } from "./project-role-access.sql"
import { TpProductTable } from "./product.sql"
import { TpProductSolutionBindingTable } from "./product-solution-binding.sql"
import { ProductSolutionService, type ProductSolutionItem } from "./product-solution"
import { anchorBySolutions, ensureProjectByDirectory, invalidateProductAnchorCache, projectIDsBySolutions } from "./product-anchor"
import { TpRoleProductAccessTable } from "./role-product-access.sql"
import { TpRoleTable } from "./role.sql"
import { Filesystem } from "@/util/filesystem"

export type ProductItem = {
  id: string
  name: string
  project_id?: string
  worktree?: string
  vcs?: string
  related_project_ids: string[]
  paths: string[]
  solutions?: ProductSolutionItem[]
  time_created: number
  time_updated: number
}

type ProductViewMode = "runtime" | "light"

/** 中文注释：统一约束产品只读取未逻辑删除的记录，避免各个列表重复漏加条件。 */
function activeProduct() {
  return isNull(TpProductTable.time_deleted)
}

/** 中文注释：对产品标识去重，避免后续数据库查询与映射出现重复记录。 */
function unique(input: string[]) {
  return [...new Set(input)]
}

/** 中文注释：统一按产品名称排序，保证产品列表和权限配置页展示稳定。 */
function byName(items: ProductItem[]) {
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

/** 中文注释：为没有显式名称的目录生成友好标签，兼容旧的项目回退展示。 */
function itemName(project: { name?: string | null; worktree: string }) {
  const name = project.name?.trim()
  if (name) return name
  const base = path.basename(project.worktree).trim()
  if (base) return base
  return project.worktree
}

/** 中文注释：把产品解决方案根目录规整成稳定的展示路径，界面应展示用户配置的原始路径而不是本机映射路径。 */
function itemPaths(input: { solutions: ProductSolutionItem[]; fallback?: string }) {
  const roots = input.solutions.flatMap((solution) =>
    solution.roots
      .filter((root) => root.enabled)
      .flatMap((root) => {
        if (root.root_type === "virtual_group") return root.meta?.directories ?? []
        return [root.directory]
      })
      .map((directory) => Filesystem.stablePath(directory.trim()))
      .filter(Boolean),
  )
  if (roots.length > 0) return unique(roots)
  if (!input.fallback) return []
  return [Filesystem.stablePath(input.fallback)]
}

/** 中文注释：前端产品上下文只需要真实解决方案 roots 对应的项目集合，不能再把兼容主项目锚点混进来。 */
async function relatedProjectIDs(solutions: ProductSolutionItem[]) {
  const rows = await Promise.all(
    solutions.flatMap((solution) =>
      solution.roots
        .filter((root) => root.enabled)
        .flatMap((root) => {
          if (root.root_type === "virtual_group") return root.meta?.directories ?? []
          return [root.directory]
        })
        .map((directory) => ensureProjectByDirectory(directory)),
    ),
  )
  const derived = unique(rows.flatMap((project) => (project?.id ? [project.id] : [])))
  return derived
}

/** 中文注释：轻量模式优先读取解决方案显式主项目，避免登录和产品列表同步探测共享目录。 */
async function relatedProjectIDsLight(input: { row: typeof TpProductTable.$inferSelect; solutions: ProductSolutionItem[] }) {
  const derived = await relatedProjectIDs(input.solutions)
  if (derived.length > 0) return derived
  return unique([input.row.project_id ?? ""].filter(Boolean))
}

/** 中文注释：按产品分组解决方案，供产品列表、权限推导和锚点解析统一复用。 */
function solutionMap(items: ProductSolutionItem[]) {
  const map = new Map<string, ProductSolutionItem[]>()
  for (const item of items) {
    const list = map.get(item.product_id) ?? []
    list.push(item)
    map.set(item.product_id, list)
  }
  return map
}

/** 中文注释：把产品主表记录补齐为前后端共用的产品视图；轻量模式不扫描共享盘，运行时模式再做完整锚点推导。 */
async function productsByRows(rows: (typeof TpProductTable.$inferSelect)[], mode: ProductViewMode = "runtime") {
  const solutions = await ProductSolutionService.listByProductIDs(rows.map((item) => item.id))
  const grouped = solutionMap(solutions)
  const fallback_ids = unique(
    rows
      .flatMap((item) => {
        const current = grouped.get(item.id) ?? []
        if (mode === "light") return [item.project_id ?? ""]
        return [item.project_id ?? ""]
      })
      .filter(Boolean),
  )
  const project_rows =
    fallback_ids.length === 0
      ? []
      : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, fallback_ids)).all())
  const legacy = new Map(project_rows.map((item) => [item.id, item]))
  const list = await Promise.all(
    rows.map(async (row) => {
      const current = grouped.get(row.id) ?? []
      const related_project_ids = current.length > 0
        ? mode === "light"
          ? await relatedProjectIDsLight({ row, solutions: current })
          : await relatedProjectIDs(current)
        : unique([row.project_id ?? ""].filter(Boolean))
      const preferred_project_id = related_project_ids[0] ?? row.project_id ?? undefined
      const fallback =
        legacy.get(preferred_project_id ?? "") ??
        legacy.get(row.project_id ?? "") ??
        (preferred_project_id
          ? await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, preferred_project_id)).get())
          : undefined)
      const anchor = mode === "light"
        ? fallback
          ? {
              project_id: fallback.id,
              worktree: fallback.worktree,
              vcs: fallback.vcs ?? undefined,
            }
          : preferred_project_id
            ? {
                project_id: preferred_project_id,
                worktree: fallback?.worktree,
                vcs: fallback?.vcs ?? undefined,
              }
            : undefined
        : await anchorBySolutions(current)
      return {
        id: row.id,
        name: row.name,
        project_id: anchor?.project_id ?? row.project_id ?? undefined,
        worktree: anchor?.worktree ?? fallback?.worktree ?? undefined,
        vcs: anchor?.vcs ?? fallback?.vcs ?? undefined,
        related_project_ids,
        paths: itemPaths({
          solutions: current,
          fallback: anchor?.worktree ?? fallback?.worktree ?? undefined,
        }),
        solutions: current,
        time_created: row.time_created,
        time_updated: row.time_updated,
      } satisfies ProductItem
    }),
  )
  return byName(list)
}

/** 中文注释：按产品集合推导关联的全部项目，用于角色授权和产品可见性判断。 */
async function productProjectIDs(product_ids: string[]) {
  const ids = unique(product_ids.filter(Boolean))
  if (ids.length === 0) return [] as string[]
  const rows = await Database.use((db) =>
    db
      .select()
      .from(TpProductTable)
      .where(and(inArray(TpProductTable.id, ids), activeProduct()))
      .all(),
  )
  const products = await productsByRows(rows)
  const legacy = new Map(rows.map((item) => [item.id, item.project_id ?? undefined]))
  const derived = await Promise.all(
    products.map(async (item) => {
      const current = item.solutions ?? []
      const ids = await projectIDsBySolutions(current)
      return [...(legacy.get(item.id) ? [legacy.get(item.id)!] : []), ...(item.project_id ? [item.project_id] : []), ...ids]
    }),
  )
  return unique(derived.flat())
}

/** 中文注释：同步角色的项目访问镜像，保证旧的项目权限链仍能感知产品关联的解决方案目录。 */
async function syncRoleProjects(role_id: string, product_ids: string[]) {
  const project_ids = await productProjectIDs(product_ids)
  await Database.use(async (db) => {
    await db.delete(TpProjectRoleAccessTable).where(eq(TpProjectRoleAccessTable.role_id, role_id)).run()
    if (project_ids.length === 0) return
    await db.insert(TpProjectRoleAccessTable)
      .values(
        project_ids.map((project_id) => ({
          project_id,
          role_id,
          time_created: Date.now(),
        })),
      )
      .run()
  })
}

export namespace AccountProductService {
  /** 中文注释：列出所有产品，并自动附带从解决方案推导出来的上下文锚点。 */
  export async function list(mode: ProductViewMode = "runtime") {
    const rows = await Database.use((db) => db.select().from(TpProductTable).where(activeProduct()).all())
    return productsByRows(rows, mode)
  }

  /** 中文注释：按产品标识读取单个产品，避免登录恢复上次产品时再把全量产品全部做一轮锚点推导。 */
  export async function get(product_id: string, mode: ProductViewMode = "runtime") {
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.id, product_id), activeProduct()))
        .get(),
    )
    if (!row) return
    return (await productsByRows([row], mode))[0]
  }

  /** 中文注释：按项目过滤产品时，改为匹配产品关联解决方案的全部锚点项目，而不是产品自身目录。 */
  export async function listByProjectIDs(project_ids: string[], mode: ProductViewMode = "runtime") {
    const ids = new Set(unique(project_ids.filter(Boolean)))
    if (ids.size === 0) return [] as ProductItem[]
    const rows = await Database.use((db) => db.select().from(TpProductTable).where(activeProduct()).all())
    const items = await productsByRows(rows, mode)
    const legacy = new Map(rows.map((item) => [item.id, item.project_id ?? undefined]))
    const derived = await Promise.all(items.map(async (item) => ({
      item,
      project_ids: new Set([
        ...(legacy.get(item.id) ? [legacy.get(item.id)!] : []),
        ...(item.project_id ? [item.project_id] : []),
        ...(item.related_project_ids ?? []),
        ...(mode === "light" ? [] : await projectIDsBySolutions(item.solutions ?? [])),
      ]),
    })))
    return derived.filter((item) => [...item.project_ids].some((project_id) => ids.has(project_id))).map((item) => item.item)
  }

  /** 中文注释：按角色显式绑定的产品读取列表，供用户侧产品可见性从“项目驱动”切回“产品驱动”。 */
  export async function listByRoleIDs(role_ids: string[], mode: ProductViewMode = "runtime") {
    const ids = unique(role_ids.filter(Boolean))
    if (ids.length === 0) return [] as ProductItem[]
    const links = await Database.use((db) =>
      db
        .select({ product_id: TpRoleProductAccessTable.product_id })
        .from(TpRoleProductAccessTable)
        .where(inArray(TpRoleProductAccessTable.role_id, ids))
        .all(),
    )
    const product_ids = unique(links.map((item) => item.product_id))
    if (product_ids.length === 0) return [] as ProductItem[]
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(inArray(TpProductTable.id, product_ids), activeProduct()))
        .all(),
    )
    return productsByRows(rows, mode)
  }

  /** 中文注释：创建产品时允许目录为空；若显式提供目录，则仅把它作为兼容上下文项目保存。 */
  export async function create(input: { name: string; directory?: string }) {
    const name = input.name.trim()
    if (!name) return { ok: false as const, code: "product_name_invalid" as const }
    const directory = input.directory?.trim()
    const project = directory ? await ensureProjectByDirectory(directory) : undefined
    if (directory && !project) return { ok: false as const, code: "directory_missing" as const }
    const nameHit = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.name, name), activeProduct()))
        .get(),
    )
    if (nameHit) return { ok: false as const, code: "product_exists" as const }
    if (project) {
      const projectHit = await Database.use((db) =>
        db
          .select()
          .from(TpProductTable)
          .where(and(eq(TpProductTable.project_id, project.id), activeProduct()))
          .get(),
      )
      if (projectHit) return { ok: false as const, code: "product_directory_exists" as const }
    }
    const now = Date.now()
    const id = ulid()
    await Database.use((db) =>
      db
        .insert(TpProductTable)
        .values({
          id,
          name,
          project_id: project?.id,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.id, id), activeProduct()))
        .all(),
    )
    const item = (await productsByRows(rows))[0]
    if (!item) return { ok: false as const, code: "product_missing" as const }
    invalidateProductAnchorCache()
    return { ok: true as const, item }
  }

  /** 中文注释：更新产品时允许清空目录绑定，让产品退化为纯虚拟组合。 */
  export async function update(input: { product_id: string; name?: string; directory?: string }) {
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.id, input.product_id), activeProduct()))
        .get(),
    )
    if (!row) return { ok: false as const, code: "product_missing" as const }
    const name = input.name === undefined ? row.name : input.name.trim()
    if (!name) return { ok: false as const, code: "product_name_invalid" as const }
    const directory = input.directory === undefined ? undefined : input.directory.trim()
    const project = directory ? await ensureProjectByDirectory(directory) : undefined
    if (input.directory !== undefined && directory && !project) {
      return { ok: false as const, code: "directory_missing" as const }
    }
    const project_id = input.directory === undefined ? row.project_id ?? undefined : project?.id
    const nameHit = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.name, name), activeProduct()))
        .get(),
    )
    if (nameHit && nameHit.id !== input.product_id) return { ok: false as const, code: "product_exists" as const }
    if (project_id) {
      const projectHit = await Database.use((db) =>
        db
          .select()
          .from(TpProductTable)
          .where(and(eq(TpProductTable.project_id, project_id), activeProduct()))
          .get(),
      )
      if (projectHit && projectHit.id !== input.product_id) return { ok: false as const, code: "product_directory_exists" as const }
    }
    await Database.use((db) =>
      db
        .update(TpProductTable)
        .set({
          name,
          project_id: project_id ?? null,
          time_updated: Date.now(),
        })
        .where(eq(TpProductTable.id, input.product_id))
        .run(),
    )
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.id, input.product_id), activeProduct()))
        .all(),
    )
    const item = (await productsByRows(rows))[0]
    if (!item) return { ok: false as const, code: "product_missing" as const }
    invalidateProductAnchorCache()
    return { ok: true as const, item }
  }

  /** 中文注释：删除产品时仅清理产品本体与角色产品绑定，避免再把共享解决方案误删。 */
  export async function remove(product_id: string) {
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpProductTable)
        .where(and(eq(TpProductTable.id, product_id), activeProduct()))
        .get(),
    )
    if (!row) return { ok: false as const, code: "product_missing" as const }
    const role_links = await Database.use((db) =>
      db.select().from(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.product_id, product_id)).all(),
    )
    await Database.use((db) =>
      db
        .update(TpProductTable)
        .set({
          time_deleted: Date.now(),
          time_updated: Date.now(),
        })
        .where(eq(TpProductTable.id, product_id))
        .run(),
    )
    for (const link of role_links) {
      const links = await Database.use((db) =>
        db.select().from(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.role_id, link.role_id)).all(),
      )
      await syncRoleProjects(link.role_id, links.map((item) => item.product_id))
    }
    invalidateProductAnchorCache()
    return { ok: true as const }
  }

  /** 中文注释：读取角色关联产品时，返回的产品锚点同样基于解决方案动态推导。 */
  export async function roleProducts(role_code: string) {
    const role = await Database.use((db) =>
      db
        .select()
        .from(TpRoleTable)
        .where(and(eq(TpRoleTable.code, role_code), isNull(TpRoleTable.time_deleted)))
        .get(),
    )
    if (!role) return { ok: false as const, code: "role_missing" as const }
    const links = await Database.use((db) =>
      db.select().from(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.role_id, role.id)).all(),
    )
    const ids = unique(links.map((item) => item.product_id))
    const products =
      ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select()
              .from(TpProductTable)
              .where(and(inArray(TpProductTable.id, ids), activeProduct()))
              .all(),
          )
    return {
      ok: true as const,
      role_code,
      product_ids: products.map((item) => item.id),
      products: await productsByRows(products),
    }
  }

  /** 中文注释：设置角色可访问产品时，同时重建衍生的项目授权镜像，保持旧链路兼容。 */
  export async function setRoleProducts(input: { role_code: string; product_ids: string[] }) {
    const role = await Database.use((db) =>
      db
        .select()
        .from(TpRoleTable)
        .where(and(eq(TpRoleTable.code, input.role_code), isNull(TpRoleTable.time_deleted)))
        .get(),
    )
    if (!role) return { ok: false as const, code: "role_missing" as const }
    const product_ids = unique(input.product_ids)
    const products =
      product_ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select({ id: TpProductTable.id })
              .from(TpProductTable)
              .where(and(inArray(TpProductTable.id, product_ids), activeProduct()))
              .all(),
          )
    if (products.length !== product_ids.length) return { ok: false as const, code: "product_missing" as const }
    const now = Date.now()
    await Database.use(async (db) => {
      await db.delete(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.role_id, role.id)).run()
      if (product_ids.length === 0) return
      await db.insert(TpRoleProductAccessTable)
        .values(
          product_ids.map((product_id) => ({
            product_id,
            role_id: role.id,
            time_created: now,
          })),
        )
        .run()
    })
    await syncRoleProjects(role.id, product_ids)
    return { ok: true as const }
  }

  /** 中文注释：角色产品权限映射到项目权限时，改为读取产品关联解决方案的全部项目锚点。 */
  export async function roleProjectIDs(role_ids: string[]) {
    const ids = unique(role_ids)
    if (ids.length === 0) return [] as string[]
    const links = await Database.use((db) =>
      db
        .select({ product_id: TpRoleProductAccessTable.product_id })
        .from(TpRoleProductAccessTable)
        .where(inArray(TpRoleProductAccessTable.role_id, ids))
        .all(),
    )
    return productProjectIDs(links.map((item) => item.product_id))
  }

  /** 中文注释：统一生成项目回退展示名称，兼容上下文产品列表中的历史项目入口。 */
  export function label(input: { name: string; worktree: string }) {
    return itemName(input)
  }
}
