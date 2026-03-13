import { Session } from "@/session"
import { and, desc, eq, ne } from "@/storage/db"
import { Database } from "@/storage/db"
import { UserService } from "@/user/service"
import { extension as mimeExtension } from "mime-types"
import path from "path"
import { ulid } from "ulid"
import { TpPrototypeAssetTable } from "./prototype.sql"
import { PrototypeStorage } from "./storage"

type Row = typeof TpPrototypeAssetTable.$inferSelect

type Actor = {
  user_id?: string
  org_id?: string
  department_id?: string
}

type SaveInput = {
  actor: Actor
  session_id: string
  message_id?: string
  title: string
  description?: string
  route?: string
  page_key: string
  agent_mode: string
  bytes: Uint8Array | Buffer
  mime: string
  source_type: "manual_upload" | "playwright_capture"
  source_url?: string
  viewport?: {
    width?: number
    height?: number
    device_scale_factor?: number
  }
  test_run_id?: string
  test_result?: "passed" | "failed" | "unknown"
}

function normalize(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "page"
}

function url(id: string, variant: "original" | "thumbnail") {
  return `/prototype/${id}/file?variant=${variant}`
}

function item(row: Row) {
  return {
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id ?? undefined,
    user_id: row.user_id ?? undefined,
    org_id: row.org_id ?? undefined,
    department_id: row.department_id ?? undefined,
    agent_mode: row.agent_mode,
    title: row.title,
    description: row.description ?? undefined,
    route: row.route ?? undefined,
    page_key: row.page_key,
    viewport_width: row.viewport_width ?? undefined,
    viewport_height: row.viewport_height ?? undefined,
    device_scale_factor: row.device_scale_factor ?? undefined,
    mime: row.mime,
    size_bytes: row.size_bytes,
    storage_driver: row.storage_driver,
    storage_key: row.storage_key,
    image_url: row.image_url ?? url(row.id, "original"),
    thumbnail_url: row.thumbnail_url ?? url(row.id, "thumbnail"),
    source_type: row.source_type as "manual_upload" | "playwright_capture",
    source_url: row.source_url ?? undefined,
    test_run_id: row.test_run_id ?? undefined,
    test_result: (row.test_result as "passed" | "failed" | "unknown" | null) ?? undefined,
    version: row.version,
    is_latest: row.is_latest,
    status: row.status as "ready" | "archived" | "deleted",
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

async function version(session_id: string, page_key: string) {
  const row = await Database.use((db) =>
    db
      .select({ version: TpPrototypeAssetTable.version })
      .from(TpPrototypeAssetTable)
      .where(and(eq(TpPrototypeAssetTable.session_id, session_id), eq(TpPrototypeAssetTable.page_key, page_key)))
      .orderBy(desc(TpPrototypeAssetTable.version))
      .get(),
  )
  return (row?.version ?? 0) + 1
}

async function save(input: SaveInput) {
  const target = input.session_id.trim()
  const session = await Session.get(target)
  if (input.agent_mode !== "build") return { ok: false as const, code: "prototype_invalid_mode" as const }

  const title = input.title.trim()
  if (!title) return { ok: false as const, code: "prototype_title_required" as const }
  const page_key = normalize(input.page_key)
  const mime = input.mime.trim().toLowerCase()
  if (!mime.startsWith("image/")) return { ok: false as const, code: "prototype_invalid_source" as const }

  const id = ulid()
  const nextVersion = await version(target, page_key)
  const ext = mimeExtension(mime) || path.extname("x." + mime.split("/").at(-1)).replace(/^\./, "") || "png"
  const storage_key = PrototypeStorage.key({
    directory: session.directory,
    session_id: target,
    page_key,
    version: nextVersion,
    extension: ext,
  })
  const image_url = url(id, "original")
  const thumbnail_url = url(id, "thumbnail")
  const bytes = Buffer.from(input.bytes)

  await PrototypeStorage.put({
    key: storage_key,
    bytes,
  })

  const now = Date.now()
  const result = await Database.transaction(async (db) => {
    const previous = await db
      .select()
      .from(TpPrototypeAssetTable)
      .where(
        and(
          eq(TpPrototypeAssetTable.session_id, target),
          eq(TpPrototypeAssetTable.status, "ready"),
        ),
      )
      .all()

    await db
      .update(TpPrototypeAssetTable)
      .set({
        status: "deleted",
        is_latest: false,
        time_updated: now,
      })
      .where(and(eq(TpPrototypeAssetTable.session_id, target), eq(TpPrototypeAssetTable.status, "ready")))
      .run()

    await db
      .insert(TpPrototypeAssetTable)
      .values({
        id,
        session_id: target,
        message_id: input.message_id,
        user_id: input.actor.user_id,
        org_id: input.actor.org_id,
        department_id: input.actor.department_id,
        agent_mode: input.agent_mode,
        title,
        description: input.description?.trim() || undefined,
        route: input.route?.trim() || undefined,
        page_key,
        viewport_width: input.viewport?.width,
        viewport_height: input.viewport?.height,
        device_scale_factor: input.viewport?.device_scale_factor,
        mime,
        size_bytes: bytes.byteLength,
        storage_driver: "local",
        storage_key,
        image_url,
        thumbnail_url,
        source_type: input.source_type,
        source_url: input.source_url?.trim() || undefined,
        test_run_id: input.test_run_id?.trim() || undefined,
        test_result: input.test_result,
        version: nextVersion,
        is_latest: true,
        status: "ready",
        time_created: now,
        time_updated: now,
      })
      .run()

    const row = await db.select().from(TpPrototypeAssetTable).where(eq(TpPrototypeAssetTable.id, id)).get()
    return {
      row,
      previous,
    }
  })

  if (!result.row) return { ok: false as const, code: "prototype_missing" as const }
  await Promise.all(result.previous.map((item) => PrototypeStorage.remove({ key: item.storage_key })))
  UserService.auditLater({
    actor_user_id: input.actor.user_id,
    action: input.source_type === "manual_upload" ? "prototype.upload" : "prototype.capture",
    target_type: "tp_prototype_asset",
    target_id: result.row.id,
    result: "success",
    detail_json: {
      session_id: result.row.session_id,
      page_key: result.row.page_key,
      version: result.row.version,
      source_type: result.row.source_type,
    },
  })
  return {
    ok: true as const,
    prototype: item(result.row),
  }
}

export namespace PrototypeService {
  export async function listBySession(input: {
    session_id: string
    page_key?: string
    latest?: boolean
    limit?: number
  }) {
    await Session.peek(input.session_id)
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpPrototypeAssetTable)
        .where(
          and(
            eq(TpPrototypeAssetTable.session_id, input.session_id),
            eq(TpPrototypeAssetTable.status, "ready"),
            input.page_key ? eq(TpPrototypeAssetTable.page_key, normalize(input.page_key)) : undefined,
            input.latest ? eq(TpPrototypeAssetTable.is_latest, true) : undefined,
          ),
        )
        .orderBy(desc(TpPrototypeAssetTable.time_created), desc(TpPrototypeAssetTable.version))
        .limit(input.limit ?? 50)
        .all(),
    )
    return rows.map(item)
  }

  export async function getByID(id: string) {
    const row = await Database.use((db) => db.select().from(TpPrototypeAssetTable).where(eq(TpPrototypeAssetTable.id, id)).get())
    if (!row || row.status === "deleted") return
    await Session.peek(row.session_id)
    return item(row)
  }

  export async function file(id: string) {
    const row = await Database.use((db) => db.select().from(TpPrototypeAssetTable).where(eq(TpPrototypeAssetTable.id, id)).get())
    if (!row || row.status === "deleted") return
    await Session.peek(row.session_id)
    const file = await PrototypeStorage.read({ key: row.storage_key })
    if (!file) return
    return {
      file,
      mime: row.mime,
      size_bytes: row.size_bytes,
    }
  }

  export async function upload(input: {
    actor: Actor
    session_id: string
    agent_mode?: string
    message_id?: string
    title: string
    description?: string
    route?: string
    page_key: string
    filename: string
    content_type: string
    data_base64: string
    source_url?: string
    viewport?: {
      width?: number
      height?: number
      device_scale_factor?: number
    }
    test_run_id?: string
    test_result?: "passed" | "failed" | "unknown"
  }) {
    return save({
      actor: input.actor,
      session_id: input.session_id,
      message_id: input.message_id,
      title: input.title,
      description: input.description,
      route: input.route,
      page_key: input.page_key,
      agent_mode: input.agent_mode ?? "build",
      bytes: Buffer.from(input.data_base64, "base64"),
      mime: input.content_type,
      source_type: "manual_upload",
      source_url: input.source_url,
      viewport: input.viewport,
      test_run_id: input.test_run_id,
      test_result: input.test_result,
    })
  }

  export async function capture(input: {
    actor: Actor
    session_id: string
    agent_mode?: string
    message_id?: string
    title: string
    description?: string
    route?: string
    page_key: string
    source_url: string
    wait_until?: "load" | "domcontentloaded" | "networkidle"
    ready_selector?: string
    delay_ms?: number
    viewport?: {
      width?: number
      height?: number
      device_scale_factor?: number
    }
    test_run_id?: string
    test_result?: "passed" | "failed" | "unknown"
  }) {
    const pkg = "@playwright/test"
    const { chromium } = await import(pkg)
    const browser = await chromium.launch()
    const page = await browser.newPage({
      viewport:
        input.viewport?.width && input.viewport?.height
          ? {
              width: input.viewport.width,
              height: input.viewport.height,
            }
          : undefined,
      deviceScaleFactor: input.viewport?.device_scale_factor,
    })
    await page.goto(input.source_url, {
      waitUntil: input.wait_until ?? "load",
    })
    if (input.ready_selector) {
      await page.waitForSelector(input.ready_selector, {
        state: "visible",
        timeout: 15000,
      })
    }
    if (input.delay_ms) {
      await page.waitForTimeout(input.delay_ms)
    }
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
    })
    await browser.close()
    return save({
      actor: input.actor,
      session_id: input.session_id,
      message_id: input.message_id,
      title: input.title,
      description: input.description,
      route: input.route,
      page_key: input.page_key,
      agent_mode: input.agent_mode ?? "build",
      bytes: screenshot,
      mime: "image/png",
      source_type: "playwright_capture",
      source_url: input.source_url,
      viewport: input.viewport,
      test_run_id: input.test_run_id,
      test_result: input.test_result,
    })
  }

  export async function remove(input: { id: string }) {
    const row = await Database.use((db) => db.select().from(TpPrototypeAssetTable).where(eq(TpPrototypeAssetTable.id, input.id)).get())
    if (!row || row.status === "deleted") return { ok: false as const, code: "prototype_missing" as const }
    await Session.peek(row.session_id)
    const now = Date.now()
    await Database.transaction(async (db) => {
      await db
        .update(TpPrototypeAssetTable)
        .set({
          status: "deleted",
          is_latest: false,
          time_updated: now,
        })
        .where(eq(TpPrototypeAssetTable.id, input.id))
        .run()

      if (!row.is_latest) return
      const next = await db
        .select()
        .from(TpPrototypeAssetTable)
        .where(
          and(
            eq(TpPrototypeAssetTable.session_id, row.session_id),
            eq(TpPrototypeAssetTable.page_key, row.page_key),
            ne(TpPrototypeAssetTable.id, row.id),
            eq(TpPrototypeAssetTable.status, "ready"),
          ),
        )
        .orderBy(desc(TpPrototypeAssetTable.version))
        .get()
      if (!next) return
      await db
        .update(TpPrototypeAssetTable)
        .set({
          is_latest: true,
          time_updated: now,
        })
        .where(eq(TpPrototypeAssetTable.id, next.id))
        .run()
    })
    await PrototypeStorage.remove({ key: row.storage_key })
    UserService.auditLater({
      action: "prototype.delete",
      target_type: "tp_prototype_asset",
      target_id: row.id,
      result: "success",
      detail_json: {
        session_id: row.session_id,
        page_key: row.page_key,
        version: row.version,
      },
    })
    return { ok: true as const }
  }
}
