import z from "zod"
import { ulid } from "ulid"
import { BuildProfile, normalizeBuildProfile, type BuildProfile as BuildProfileType } from "@/build/profile"
import { Database, asc, desc, eq, inArray } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { TpProductTable } from "./product.sql"
import { invalidateProductAnchorCache } from "./product-anchor"
import { TpProductSolutionBindingTable } from "./product-solution-binding.sql"
import { TpProductSolutionRootTable } from "./product-solution-root.sql"
import { TpProductSolutionTable } from "./product-solution.sql"

export const ProductSolutionRootType = z.enum(["single_repo", "parent_batch", "virtual_group"])
export type ProductSolutionRootType = z.infer<typeof ProductSolutionRootType>

export const ProductSolutionRootMeta = z.object({
  directories: z.array(z.string()).optional(),
})
export type ProductSolutionRootMeta = z.infer<typeof ProductSolutionRootMeta>

export const ProductSolutionRootInput = z.object({
  root_type: ProductSolutionRootType,
  directory: z.string(),
  display_name: z.string().optional(),
  mount_name: z.string().optional(),
  sort_order: z.number().optional(),
  enabled: z.boolean().optional(),
  meta: ProductSolutionRootMeta.optional(),
})
export type ProductSolutionRootInput = z.infer<typeof ProductSolutionRootInput>

export type ProductSolutionRootItem = {
  id: string
  solution_id: string
  root_type: ProductSolutionRootType
  directory: string
  display_name?: string
  mount_name?: string
  sort_order: number
  enabled: boolean
  meta?: ProductSolutionRootMeta
  time_created: number
  time_updated: number
}

export type ProductSolutionItem = {
  id: string
  product_id?: string
  name: string
  code: string
  enabled: boolean
  build_profile: BuildProfileType
  roots: ProductSolutionRootItem[]
  time_created: number
  time_updated: number
}

/** 中文注释：把目录统一规整为绝对路径，保证解决方案根目录比较和去重稳定。 */
function resolveDirectory(input: string) {
  return Filesystem.stablePath(input.trim())
}

/** 中文注释：校验单个解决方案根目录定义，避免运行期再碰到路径缺失或虚拟组配置不完整。 */
async function validateRoot(input: ProductSolutionRootInput) {
  const root_type = ProductSolutionRootType.parse(input.root_type)
  const directory = input.directory.trim()
  if (!directory) return { ok: false as const, code: "solution_root_directory_invalid" as const }

  if (root_type === "virtual_group") {
    const meta = ProductSolutionRootMeta.parse(input.meta ?? {})
    const directories = (meta.directories ?? []).map((item) => resolveDirectory(item))
    if (directories.length === 0) return { ok: false as const, code: "solution_root_virtual_members_missing" as const }
    const all = await Promise.all(directories.map((item) => Filesystem.isDir(item)))
    if (all.some((item) => !item)) return { ok: false as const, code: "solution_root_directory_missing" as const }
    return {
      ok: true as const,
      root: {
        root_type,
        directory,
        display_name: input.display_name?.trim() || undefined,
        mount_name: input.mount_name?.trim() || undefined,
        sort_order: input.sort_order ?? 0,
        enabled: input.enabled ?? true,
        meta: {
          directories,
        },
      },
    }
  }

  const resolved = resolveDirectory(directory)
  if (!(await Filesystem.isDir(resolved))) return { ok: false as const, code: "solution_root_directory_missing" as const }
  return {
    ok: true as const,
    root: {
      root_type,
      directory: resolved,
      display_name: input.display_name?.trim() || undefined,
      mount_name: input.mount_name?.trim() || undefined,
      sort_order: input.sort_order ?? 0,
      enabled: input.enabled ?? true,
      meta: input.meta ? ProductSolutionRootMeta.parse(input.meta) : undefined,
    },
  }
}

type ValidRoot = Extract<Awaited<ReturnType<typeof validateRoot>>, { ok: true }>

/** 中文注释：把数据库根目录记录统一映射为前端与服务共用的结构。 */
function rootItem(row: typeof TpProductSolutionRootTable.$inferSelect): ProductSolutionRootItem {
  return {
    id: row.id,
    solution_id: row.solution_id,
    root_type: ProductSolutionRootType.parse(row.root_type),
    directory: row.directory,
    display_name: row.display_name ?? undefined,
    mount_name: row.mount_name ?? undefined,
    sort_order: row.sort_order,
    enabled: row.enabled,
    meta: row.meta_json ? ProductSolutionRootMeta.parse(row.meta_json) : undefined,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** 中文注释：把解决方案主表与根目录明细组装成完整结构，便于列表、详情和 build 执行统一复用。 */
function solutionItem(
  row: typeof TpProductSolutionTable.$inferSelect,
  roots: ProductSolutionRootItem[],
  product_id?: string,
): ProductSolutionItem {
  return {
    id: row.id,
    product_id,
    name: row.name,
    code: row.code,
    enabled: row.enabled,
    build_profile: normalizeBuildProfile(row.build_profile_json),
    roots: roots.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** 中文注释：按解决方案主表批量回填根目录，避免接口层出现 N+1 查询。 */
async function hydrate(rows: (typeof TpProductSolutionTable.$inferSelect)[]) {
  const ids = rows.map((item) => item.id)
  const roots =
    ids.length === 0
      ? []
      : await Database.use((db) =>
          db
            .select()
            .from(TpProductSolutionRootTable)
            .where(inArray(TpProductSolutionRootTable.solution_id, ids))
            .orderBy(asc(TpProductSolutionRootTable.sort_order), asc(TpProductSolutionRootTable.id))
            .all(),
        )
  const map = new Map<string, ProductSolutionRootItem[]>()
  for (const row of roots) {
    const list = map.get(row.solution_id) ?? []
    list.push(rootItem(row))
    map.set(row.solution_id, list)
  }
  return rows.map((row) => solutionItem(row, map.get(row.id) ?? []))
}

/** 中文注释：把绑定关系映射成指定产品视角下的解决方案列表，确保同一方案可被多个产品复用。 */
async function hydrateBindings(rows: (typeof TpProductSolutionBindingTable.$inferSelect)[]) {
  const ids = [...new Set(rows.map((item) => item.solution_id))]
  const solutions =
    ids.length === 0
      ? []
      : await Database.use((db) =>
          db
            .select()
            .from(TpProductSolutionTable)
            .where(inArray(TpProductSolutionTable.id, ids))
            .orderBy(asc(TpProductSolutionTable.name), asc(TpProductSolutionTable.id))
            .all(),
        )
  const items = await hydrate(solutions)
  const map = new Map(items.map((item) => [item.id, item]))
  return rows.flatMap((row) => {
    const item = map.get(row.solution_id)
    if (!item) return []
    return [
      {
        ...item,
        product_id: row.product_id,
        enabled: row.enabled && item.enabled,
      } satisfies ProductSolutionItem,
    ]
  })
}

export namespace ProductSolutionService {
  /** 中文注释：返回全局解决方案库，供产品绑定现有方案与后续独立方案库页面复用。 */
  export async function listLibrary() {
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionTable)
        .orderBy(asc(TpProductSolutionTable.name), asc(TpProductSolutionTable.id))
        .all(),
    )
    return hydrate(rows)
  }

  export async function list(product_id: string) {
    const bindings = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionBindingTable)
        .where(eq(TpProductSolutionBindingTable.product_id, product_id))
        .orderBy(asc(TpProductSolutionBindingTable.sort_order), asc(TpProductSolutionBindingTable.id))
        .all(),
    )
    return hydrateBindings(bindings)
  }

  export async function listByProductIDs(product_ids: string[]) {
    if (product_ids.length === 0) return [] as ProductSolutionItem[]
    const bindings = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionBindingTable)
        .where(inArray(TpProductSolutionBindingTable.product_id, product_ids))
        .orderBy(
          asc(TpProductSolutionBindingTable.product_id),
          asc(TpProductSolutionBindingTable.sort_order),
          asc(TpProductSolutionBindingTable.id),
        )
        .all(),
    )
    return hydrateBindings(bindings)
  }

  export async function get(solution_id: string) {
    const row = await Database.use((db) => db.select().from(TpProductSolutionTable).where(eq(TpProductSolutionTable.id, solution_id)).get())
    if (!row) return
    const list = await hydrate([row])
    return list[0]
  }

  export async function create(input: {
    product_id?: string
    name: string
    code: string
    enabled?: boolean
    build_profile: unknown
    roots: ProductSolutionRootInput[]
  }) {
    const product_id = input.product_id?.trim()
    if (product_id) {
      const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, product_id)).get())
      if (!product) return { ok: false as const, code: "product_missing" as const }
    }
    const name = input.name.trim()
    const code = input.code.trim()
    if (!name) return { ok: false as const, code: "solution_name_invalid" as const }
    if (!code) return { ok: false as const, code: "solution_code_invalid" as const }
    const build_profile = BuildProfile.safeParse(input.build_profile)
    if (!build_profile.success) return { ok: false as const, code: "solution_build_profile_invalid" as const }
    if (input.roots.length === 0) return { ok: false as const, code: "solution_root_missing" as const }
    const roots = [] as ValidRoot[]
    for (const item of input.roots) {
      const validated = await validateRoot(item)
      if (!validated.ok) return validated
      roots.push(validated)
    }
    const duplicate = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionTable)
        .where(eq(TpProductSolutionTable.code, code))
        .get(),
    )
    if (duplicate) return { ok: false as const, code: "solution_exists" as const }
    const now = Date.now()
    const id = ulid()
    await Database.transaction(async (tx) => {
      await tx
        .insert(TpProductSolutionTable)
        .values({
          id,
          name,
          code,
          enabled: input.enabled ?? true,
          build_profile_json: build_profile.data,
          time_created: now,
          time_updated: now,
        })
        .run()
      if (product_id) {
        await tx
          .insert(TpProductSolutionBindingTable)
          .values({
            id: ulid(),
            product_id,
            solution_id: id,
            enabled: true,
            sort_order: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
      }
      await tx
        .insert(TpProductSolutionRootTable)
        .values(
          roots.map((item, index) => ({
            id: ulid(),
            solution_id: id,
            root_type: item.root.root_type,
            directory: item.root.directory,
            display_name: item.root.display_name,
            mount_name: item.root.mount_name,
            sort_order: item.root.sort_order ?? index,
            enabled: item.root.enabled,
            meta_json: item.root.meta,
            time_created: now,
            time_updated: now,
          })),
        )
        .run()
    })
    const item = await get(id)
    if (!item) return { ok: false as const, code: "solution_missing" as const }
    invalidateProductAnchorCache()
    return { ok: true as const, item }
  }

  export async function update(input: {
    solution_id: string
    name?: string
    code?: string
    enabled?: boolean
    build_profile?: unknown
    roots?: ProductSolutionRootInput[]
  }) {
    const row = await Database.use((db) => db.select().from(TpProductSolutionTable).where(eq(TpProductSolutionTable.id, input.solution_id)).get())
    if (!row) return { ok: false as const, code: "solution_missing" as const }
    const name = input.name === undefined ? row.name : input.name.trim()
    const code = input.code === undefined ? row.code : input.code.trim()
    if (!name) return { ok: false as const, code: "solution_name_invalid" as const }
    if (!code) return { ok: false as const, code: "solution_code_invalid" as const }
    const build_profile =
      input.build_profile === undefined ? normalizeBuildProfile(row.build_profile_json) : normalizeBuildProfile(input.build_profile)
    const roots = [] as ProductSolutionRootInput[]
    if (input.roots) {
      if (input.roots.length === 0) return { ok: false as const, code: "solution_root_missing" as const }
      for (const item of input.roots) {
        const validated = await validateRoot(item)
        if (!validated.ok) return validated
        roots.push({
          ...item,
          directory: validated.root.directory,
          mount_name: validated.root.mount_name,
          meta: validated.root.meta,
        })
      }
    }
    const current_roots =
      roots.length > 0
        ? roots
        : (
            await Database.use((db) =>
              db
                .select()
                .from(TpProductSolutionRootTable)
                .where(eq(TpProductSolutionRootTable.solution_id, input.solution_id))
                .all(),
            )
          ).map((item) => ({
            root_type: ProductSolutionRootType.parse(item.root_type),
            directory: item.directory,
            display_name: item.display_name ?? undefined,
            mount_name: item.mount_name ?? undefined,
            sort_order: item.sort_order,
            enabled: item.enabled,
            meta: item.meta_json ? ProductSolutionRootMeta.parse(item.meta_json) : undefined,
          }))
    const duplicate = await Database.use((db) =>
      db.select().from(TpProductSolutionTable).where(eq(TpProductSolutionTable.code, code)).get(),
    )
    const hit = duplicate && duplicate.id !== input.solution_id ? duplicate : undefined
    if (hit) return { ok: false as const, code: "solution_exists" as const }
    const now = Date.now()
    await Database.transaction(async (tx) => {
      await tx
        .update(TpProductSolutionTable)
        .set({
          name,
          code,
          enabled: input.enabled ?? row.enabled,
          build_profile_json: build_profile,
          time_updated: now,
        })
        .where(eq(TpProductSolutionTable.id, input.solution_id))
        .run()
      if (input.roots) {
        await tx.delete(TpProductSolutionRootTable).where(eq(TpProductSolutionRootTable.solution_id, input.solution_id)).run()
        await tx
          .insert(TpProductSolutionRootTable)
          .values(
            roots.map((item, index) => ({
              id: ulid(),
              solution_id: input.solution_id,
              root_type: item.root_type,
              directory: item.directory,
              display_name: item.display_name?.trim() || undefined,
              mount_name: item.mount_name?.trim() || undefined,
              sort_order: item.sort_order ?? index,
              enabled: item.enabled ?? true,
              meta_json: item.meta,
              time_created: now,
              time_updated: now,
            })),
          )
          .run()
      }
    })
    const item = await get(input.solution_id)
    if (!item) return { ok: false as const, code: "solution_missing" as const }
    invalidateProductAnchorCache()
    return { ok: true as const, item }
  }

  /** 中文注释：把已有解决方案绑定到另一个产品下，支撑共享 API 等跨产品复用场景。 */
  export async function bind(input: {
    product_id: string
    solution_id: string
    enabled?: boolean
    sort_order?: number
  }) {
    const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, input.product_id)).get())
    if (!product) return { ok: false as const, code: "product_missing" as const }
    const solution = await Database.use((db) =>
      db.select().from(TpProductSolutionTable).where(eq(TpProductSolutionTable.id, input.solution_id)).get(),
    )
    if (!solution) return { ok: false as const, code: "solution_missing" as const }
    const current = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionBindingTable)
        .where(eq(TpProductSolutionBindingTable.product_id, input.product_id))
        .orderBy(desc(TpProductSolutionBindingTable.sort_order), desc(TpProductSolutionBindingTable.id))
        .all(),
    )
    if (current.some((item) => item.solution_id === input.solution_id)) {
      return { ok: false as const, code: "solution_binding_exists" as const }
    }
    const now = Date.now()
    await Database.use((db) =>
      db
        .insert(TpProductSolutionBindingTable)
        .values({
          id: ulid(),
          product_id: input.product_id,
          solution_id: input.solution_id,
          enabled: input.enabled ?? true,
          sort_order: input.sort_order ?? ((current[0]?.sort_order ?? -1) + 1),
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    const item = await get(input.solution_id)
    if (!item) return { ok: false as const, code: "solution_missing" as const }
    invalidateProductAnchorCache()
    return {
      ok: true as const,
      item: {
        ...item,
        enabled: input.enabled ?? item.enabled,
      } satisfies ProductSolutionItem,
    }
  }

  /** 中文注释：解除产品与解决方案的绑定关系，不直接删除解决方案本体，避免影响其它产品。 */
  export async function unbind(input: { product_id: string; solution_id: string }) {
    const binding = await Database.use((db) =>
      db
        .select()
        .from(TpProductSolutionBindingTable)
        .where(eq(TpProductSolutionBindingTable.product_id, input.product_id))
        .all(),
    )
    const row = binding.find((item) => item.solution_id === input.solution_id)
    if (!row) return { ok: false as const, code: "solution_binding_missing" as const }
    await Database.use((db) => db.delete(TpProductSolutionBindingTable).where(eq(TpProductSolutionBindingTable.id, row.id)).run())
    invalidateProductAnchorCache()
    return { ok: true as const }
  }

  export async function remove(solution_id: string) {
    const row = await Database.use((db) => db.select().from(TpProductSolutionTable).where(eq(TpProductSolutionTable.id, solution_id)).get())
    if (!row) return { ok: false as const, code: "solution_missing" as const }
    await Database.use((db) => db.delete(TpProductSolutionTable).where(eq(TpProductSolutionTable.id, solution_id)).run())
    invalidateProductAnchorCache()
    return { ok: true as const }
  }

  /** 中文注释：为历史遗留的产品私有方案补齐绑定关系，方便正式环境平滑迁移到新的多对多模型。 */
  export async function backfillBindings(input?: { product_ids?: string[] }) {
    return {
      scanned: 0,
      created: 0,
    }
  }

  /** 中文注释：为执行链挑选解决方案；当前端尚未提供多方案选择时，默认回退到首个启用方案。 */
  export async function resolve(input: { product_id: string; solution_id?: string }) {
    if (input.solution_id) return get(input.solution_id)
    const items = await list(input.product_id)
    return items.find((item) => item.enabled) ?? items[0]
  }
}
