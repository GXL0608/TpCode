import { Project } from "@/project/project"
import { ProjectTable } from "@/project/project.sql"
import { Database, eq, inArray } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { createHash } from "crypto"
import path from "path"
import { ulid } from "ulid"
import { TpRoleProductAccessTable } from "./role-product-access.sql"
import { TpRoleTable } from "./role.sql"
import { TpProductTable } from "./product.sql"

export type ProductItem = {
  id: string
  name: string
  project_id: string
  worktree: string
  vcs?: string
  time_created: number
  time_updated: number
}

function unique(input: string[]) {
  return [...new Set(input)]
}

function key(input: string) {
  return Filesystem.windowsPath(path.resolve(input)).toLowerCase()
}

function folderID(input: string) {
  const digest = createHash("sha1").update(key(input)).digest("hex").slice(0, 24)
  return `folder_${digest}`
}

function byName(items: ProductItem[]) {
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

function itemName(project: { name?: string | null; worktree: string }) {
  const name = project.name?.trim()
  if (name) return name
  const base = path.basename(project.worktree).trim()
  if (base) return base
  return project.worktree
}

async function ensureProject(directory: string) {
  const worktree = path.resolve(directory)
  if (!(await Filesystem.isDir(worktree))) return { ok: false as const, code: "directory_missing" as const }
  const result = await Project.fromDirectory(worktree)
    .then((item) => item.project)
    .catch(() => undefined)
  if (result && result.id !== "global") return { ok: true as const, project: result }
  const id = folderID(worktree)
  const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (row) return { ok: true as const, project: Project.fromRow(row) }
  const now = Date.now()
  await Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id,
        worktree,
        vcs: null,
        name: path.basename(worktree) || undefined,
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .onConflictDoNothing()
      .run(),
  )
  const created = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!created) return { ok: false as const, code: "project_missing" as const }
  return { ok: true as const, project: Project.fromRow(created) }
}

async function productsByRows(rows: (typeof TpProductTable.$inferSelect)[]) {
  const project_ids = unique(rows.map((item) => item.project_id))
  const projects =
    project_ids.length === 0
      ? []
      : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, project_ids)).all())
  const map = new Map(projects.map((item) => [item.id, item]))
  const list = rows.map((item) => {
    const project = map.get(item.project_id)
    return {
      id: item.id,
      name: item.name,
      project_id: item.project_id,
      worktree: project?.worktree ?? item.project_id,
      vcs: project?.vcs ?? undefined,
      time_created: item.time_created,
      time_updated: item.time_updated,
    } satisfies ProductItem
  })
  return byName(list)
}

export namespace AccountProductService {
  export async function list() {
    const rows = await Database.use((db) => db.select().from(TpProductTable).all())
    return productsByRows(rows)
  }

  export async function listByProjectIDs(project_ids: string[]) {
    const ids = unique(project_ids)
    if (ids.length === 0) return [] as ProductItem[]
    const rows = await Database.use((db) => db.select().from(TpProductTable).where(inArray(TpProductTable.project_id, ids)).all())
    return productsByRows(rows)
  }

  export async function create(input: { name: string; directory: string }) {
    const name = input.name.trim()
    if (!name) return { ok: false as const, code: "product_name_invalid" as const }
    const resolved = await ensureProject(input.directory)
    if (!resolved.ok) return resolved
    const project = resolved.project
    const nameHit = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.name, name)).get())
    if (nameHit) return { ok: false as const, code: "product_exists" as const }
    const projectHit = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.project_id, project.id)).get())
    if (projectHit) return { ok: false as const, code: "product_directory_exists" as const }
    const now = Date.now()
    const id = ulid()
    await Database.use((db) =>
      db
        .insert(TpProductTable)
        .values({
          id,
          name,
          project_id: project.id,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    return {
      ok: true as const,
      item: {
        id,
        name,
        project_id: project.id,
        worktree: project.worktree,
        vcs: project.vcs,
        time_created: now,
        time_updated: now,
      } satisfies ProductItem,
    }
  }

  export async function update(input: { product_id: string; name?: string; directory?: string }) {
    const row = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, input.product_id)).get())
    if (!row) return { ok: false as const, code: "product_missing" as const }
    const name = input.name === undefined ? row.name : input.name.trim()
    if (!name) return { ok: false as const, code: "product_name_invalid" as const }
    const resolved = input.directory ? await ensureProject(input.directory) : undefined
    if (resolved && !resolved.ok) return resolved
    const project_id = resolved?.project.id ?? row.project_id
    const nameHit = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.name, name)).get())
    if (nameHit && nameHit.id !== input.product_id) return { ok: false as const, code: "product_exists" as const }
    const projectHit = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.project_id, project_id)).get())
    if (projectHit && projectHit.id !== input.product_id) return { ok: false as const, code: "product_directory_exists" as const }
    const now = Date.now()
    await Database.use((db) =>
      db
        .update(TpProductTable)
        .set({
          name,
          project_id,
          time_updated: now,
        })
        .where(eq(TpProductTable.id, input.product_id))
        .run(),
    )
    const next = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, input.product_id)).get())
    if (!next) return { ok: false as const, code: "product_missing" as const }
    const items = await productsByRows([next])
    const item = items[0]
    if (!item) return { ok: false as const, code: "project_missing" as const }
    return { ok: true as const, item }
  }

  export async function remove(product_id: string) {
    const row = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, product_id)).get())
    if (!row) return { ok: false as const, code: "product_missing" as const }
    await Database.use((db) => db.delete(TpProductTable).where(eq(TpProductTable.id, product_id)).run())
    return { ok: true as const }
  }

  export async function roleProducts(role_code: string) {
    const role = await Database.use((db) => db.select().from(TpRoleTable).where(eq(TpRoleTable.code, role_code)).get())
    if (!role) return { ok: false as const, code: "role_missing" as const }
    const links = await Database.use((db) =>
      db.select().from(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.role_id, role.id)).all(),
    )
    const product_ids = unique(links.map((item) => item.product_id))
    const products =
      product_ids.length === 0
        ? []
        : await Database.use((db) => db.select().from(TpProductTable).where(inArray(TpProductTable.id, product_ids)).all())
    return {
      ok: true as const,
      role_code,
      product_ids,
      products: await productsByRows(products),
    }
  }

  export async function setRoleProducts(input: { role_code: string; product_ids: string[] }) {
    const role = await Database.use((db) => db.select().from(TpRoleTable).where(eq(TpRoleTable.code, input.role_code)).get())
    if (!role) return { ok: false as const, code: "role_missing" as const }
    const product_ids = unique(input.product_ids)
    const products =
      product_ids.length === 0
        ? []
        : await Database.use((db) => db.select({ id: TpProductTable.id }).from(TpProductTable).where(inArray(TpProductTable.id, product_ids)).all())
    if (products.length !== product_ids.length) return { ok: false as const, code: "product_missing" as const }
    await Database.use(async (db) => {
      await db.delete(TpRoleProductAccessTable).where(eq(TpRoleProductAccessTable.role_id, role.id)).run()
      if (product_ids.length > 0) {
        await db.insert(TpRoleProductAccessTable)
          .values(
            product_ids.map((product_id) => ({
              product_id,
              role_id: role.id,
              time_created: Date.now(),
            })),
          )
          .run()
      }
    })
    return { ok: true as const }
  }

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
    const product_ids = unique(links.map((item) => item.product_id))
    if (product_ids.length === 0) return [] as string[]
    const rows = await Database.use((db) =>
      db
        .select({ project_id: TpProductTable.project_id })
        .from(TpProductTable)
        .where(inArray(TpProductTable.id, product_ids))
        .all(),
    )
    return unique(rows.map((item) => item.project_id))
  }

  export function label(input: { name: string; worktree: string }) {
    return itemName(input)
  }
}
