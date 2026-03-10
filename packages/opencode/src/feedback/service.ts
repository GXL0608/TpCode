import { Project } from "@/project/project"
import { and, Database, desc, eq, type SQL } from "@/storage/db"
import { AccountContextService } from "@/user/context"
import { AccountProductService } from "@/user/product"
import { UserService } from "@/user/service"
import { ulid } from "ulid"
import { TpFeedbackPostTable } from "./post.sql"
import { TpFeedbackThreadTable } from "./thread.sql"

type Actor = {
  user_id: string
  username: string
  display_name: string
  org_id: string
  department_id?: string
  permissions: string[]
  context_project_id: string
}

type ThreadRow = typeof TpFeedbackThreadTable.$inferSelect
type PostRow = typeof TpFeedbackPostTable.$inferSelect

function canResolve(permissions: string[]) {
  return permissions.includes("feedback:resolve") || permissions.includes("feedback:manage")
}

function page(input: { page_name?: string; menu_path?: string }) {
  const name = input.page_name?.trim()
  if (name) return name
  const menu = input.menu_path?.trim()
  if (menu) return menu
  return "当前页面"
}

function productName(input: { name?: string; worktree: string }) {
  const name = input.name?.trim()
  if (name) return name
  return AccountProductService.label({
    name: "",
    worktree: input.worktree,
  })
}

async function context(input: { user_id: string; project_id: string }) {
  const list = await AccountContextService.listProducts({
    user_id: input.user_id,
    context_project_id: input.project_id,
  })
  const hit =
    list.products.find((item) => item.project_id === input.project_id && item.selected) ??
    list.products.find((item) => item.project_id === input.project_id)
  if (hit) {
    return {
      product_id: hit.id,
      product_name: productName({
        name: hit.name,
        worktree: hit.worktree,
      }),
    }
  }
  const project = await Project.get(input.project_id)
  return {
    product_id: `project_${input.project_id}`,
    product_name: productName({
      name: project?.name ?? undefined,
      worktree: project?.worktree ?? input.project_id,
    }),
  }
}

function thread(row: ThreadRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    product_id: row.product_id,
    product_name: row.product_name,
    page_name: row.page_name,
    menu_path: row.menu_path ?? undefined,
    source_platform: row.source_platform,
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    org_id: row.org_id,
    department_id: row.department_id ?? undefined,
    title: row.title,
    content: row.content,
    status: row.status,
    resolved_by: row.resolved_by ?? undefined,
    resolved_name: row.resolved_name ?? undefined,
    resolved_at: row.resolved_at ?? undefined,
    last_reply_at: row.last_reply_at,
    reply_count: row.reply_count,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

function post(row: PostRow) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    org_id: row.org_id,
    department_id: row.department_id ?? undefined,
    content: row.content,
    official_reply: row.official_reply,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

async function row(input: { thread_id: string; project_id: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(TpFeedbackThreadTable)
      .where(and(eq(TpFeedbackThreadTable.id, input.thread_id), eq(TpFeedbackThreadTable.project_id, input.project_id)))
      .get(),
  )
}

export namespace FeedbackService {
  export async function list(input: {
    actor: Actor
    status?: "open" | "processing" | "resolved"
    mine?: boolean
    limit?: number
  }) {
    const where: SQL[] = [eq(TpFeedbackThreadTable.project_id, input.actor.context_project_id)]
    if (input.status) where.push(eq(TpFeedbackThreadTable.status, input.status))
    if (input.mine) where.push(eq(TpFeedbackThreadTable.user_id, input.actor.user_id))
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpFeedbackThreadTable)
        .where(and(...where))
        .orderBy(desc(TpFeedbackThreadTable.last_reply_at), desc(TpFeedbackThreadTable.time_created))
        .limit(input.limit ?? 100)
        .all(),
    )
    return rows.map(thread)
  }

  export async function get(input: { actor: Actor; thread_id: string }) {
    const item = await row({
      thread_id: input.thread_id,
      project_id: input.actor.context_project_id,
    })
    if (!item) return { ok: false as const, code: "thread_missing" as const }
    const posts = await Database.use((db) =>
      db
        .select()
        .from(TpFeedbackPostTable)
        .where(eq(TpFeedbackPostTable.thread_id, input.thread_id))
        .orderBy(TpFeedbackPostTable.time_created)
        .all(),
    )
    return {
      ok: true as const,
      thread: thread(item),
      posts: posts.map(post),
    }
  }

  export async function create(input: {
    actor: Actor
    title: string
    content: string
    page_name?: string
    menu_path?: string
    source_platform: "pc_web" | "mobile_web"
    ip?: string
    user_agent?: string
  }) {
    const title = input.title.trim()
    if (!title) return { ok: false as const, code: "title_invalid" as const }
    const content = input.content.trim()
    if (!content) return { ok: false as const, code: "content_invalid" as const }
    const meta = await context({
      user_id: input.actor.user_id,
      project_id: input.actor.context_project_id,
    })
    const now = Date.now()
    const id = ulid()
    await Database.transaction(async (db) => {
      await db.insert(TpFeedbackThreadTable)
        .values({
          id,
          project_id: input.actor.context_project_id,
          product_id: meta.product_id,
          product_name: meta.product_name,
          page_name: page({
            page_name: input.page_name,
            menu_path: input.menu_path,
          }),
          menu_path: input.menu_path?.trim() || undefined,
          source_platform: input.source_platform,
          user_id: input.actor.user_id,
          username: input.actor.username,
          display_name: input.actor.display_name,
          org_id: input.actor.org_id,
          department_id: input.actor.department_id,
          title,
          content,
          status: "open",
          last_reply_at: now,
          reply_count: 0,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    const item = await row({
      thread_id: id,
      project_id: input.actor.context_project_id,
    })
    if (!item) return { ok: false as const, code: "thread_missing" as const }
    UserService.auditLater({
      actor_user_id: input.actor.user_id,
      action: "feedback.thread.create",
      target_type: "tp_feedback_thread",
      target_id: id,
      result: "success",
      detail_json: {
        project_id: input.actor.context_project_id,
        product_id: meta.product_id,
        status: "open",
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      thread: thread(item),
    }
  }

  export async function reply(input: {
    actor: Actor
    thread_id: string
    content: string
    ip?: string
    user_agent?: string
  }) {
    const content = input.content.trim()
    if (!content) return { ok: false as const, code: "content_invalid" as const }
    const now = Date.now()
    const id = ulid()
    const result = await Database.transaction(async (db) => {
      const item = await db
        .select()
        .from(TpFeedbackThreadTable)
        .where(and(eq(TpFeedbackThreadTable.id, input.thread_id), eq(TpFeedbackThreadTable.project_id, input.actor.context_project_id)))
        .get()
      if (!item) return { ok: false as const, code: "thread_missing" as const }
      await db.insert(TpFeedbackPostTable)
        .values({
          id,
          thread_id: input.thread_id,
          user_id: input.actor.user_id,
          username: input.actor.username,
          display_name: input.actor.display_name,
          org_id: input.actor.org_id,
          department_id: input.actor.department_id,
          content,
          official_reply: canResolve(input.actor.permissions),
          time_created: now,
          time_updated: now,
        })
        .run()
      await db.update(TpFeedbackThreadTable)
        .set({
          last_reply_at: now,
          reply_count: item.reply_count + 1,
          time_updated: now,
        })
        .where(eq(TpFeedbackThreadTable.id, input.thread_id))
        .run()
      const created = await db.select().from(TpFeedbackPostTable).where(eq(TpFeedbackPostTable.id, id)).get()
      if (!created) return { ok: false as const, code: "post_missing" as const }
      return {
        ok: true as const,
        post: post(created),
      }
    })
    if (!result.ok) return result
    UserService.auditLater({
      actor_user_id: input.actor.user_id,
      action: "feedback.post.create",
      target_type: "tp_feedback_post",
      target_id: result.post.id,
      result: "success",
      detail_json: {
        thread_id: input.thread_id,
        official_reply: result.post.official_reply,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return result
  }

  export async function updateStatus(input: {
    actor: Actor
    thread_id: string
    status: "open" | "processing" | "resolved"
    ip?: string
    user_agent?: string
  }) {
    const now = Date.now()
    const result = await Database.transaction(async (db) => {
      const item = await db
        .select()
        .from(TpFeedbackThreadTable)
        .where(and(eq(TpFeedbackThreadTable.id, input.thread_id), eq(TpFeedbackThreadTable.project_id, input.actor.context_project_id)))
        .get()
      if (!item) return { ok: false as const, code: "thread_missing" as const }
      await db.update(TpFeedbackThreadTable)
        .set({
          status: input.status,
          resolved_by: input.status === "resolved" ? input.actor.user_id : null,
          resolved_name: input.status === "resolved" ? input.actor.display_name : null,
          resolved_at: input.status === "resolved" ? now : null,
          time_updated: now,
        })
        .where(eq(TpFeedbackThreadTable.id, input.thread_id))
        .run()
      const next = await db
        .select()
        .from(TpFeedbackThreadTable)
        .where(eq(TpFeedbackThreadTable.id, input.thread_id))
        .get()
      if (!next) return { ok: false as const, code: "thread_missing" as const }
      return {
        ok: true as const,
        thread: thread(next),
      }
    })
    if (!result.ok) return result
    UserService.auditLater({
      actor_user_id: input.actor.user_id,
      action: "feedback.thread.status",
      target_type: "tp_feedback_thread",
      target_id: input.thread_id,
      result: "success",
      detail_json: {
        status: input.status,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return result
  }
}
