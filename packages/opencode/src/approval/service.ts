import { and, asc, Database, desc, eq, inArray, or, type SQL } from "@/storage/db"
import { ulid } from "ulid"
import { TpChangeRequestTable } from "./change-request.sql"
import { TpApprovalTable } from "./approval.sql"
import { TpTimelineTable } from "./timeline.sql"
import { SessionTable } from "@/session/session.sql"
import { TpUserTable } from "@/user/user.sql"
import { UserService } from "@/user/service"

type Actor = {
  user_id: string
  org_id: string
  department_id?: string
  permissions: string[]
}

const status = {
  draft: "draft",
  confirmed: "confirmed",
  pending_review: "pending_review",
  approved: "approved",
  rejected: "rejected",
  executing: "executing",
  completed: "completed",
} as const

const editable = new Set<string>([status.draft, status.confirmed, status.rejected])
const confirmable = new Set<string>([status.draft, status.rejected])
const completable = new Set<string>([status.executing, status.approved])

function can(input: { permissions: string[]; code: string }) {
  return input.permissions.includes(input.code)
}

function reviewable(permissions: string[]) {
  return (
    permissions.includes("code:review") || permissions.includes("prototype:approve") || permissions.includes("session:update_any")
  )
}

async function reviewerChangeIDs(user_id: string) {
  const rows = await Database.use((db) =>
    db
      .select({ change_request_id: TpApprovalTable.change_request_id })
      .from(TpApprovalTable)
      .where(eq(TpApprovalTable.reviewer_id, user_id))
      .all(),
  )
  return [...new Set(rows.map((item) => item.change_request_id))]
}

function canRead(input: {
  row: typeof TpChangeRequestTable.$inferSelect
  actor: Actor
  reviewer_ids: string[]
}) {
  if (input.row.user_id === input.actor.user_id) return true
  if (can({ permissions: input.actor.permissions, code: "session:view_all" })) return true
  if (input.reviewer_ids.includes(input.row.id)) return true
  if (can({ permissions: input.actor.permissions, code: "session:view_org" }) && input.row.org_id === input.actor.org_id) return true
  if (!input.actor.department_id) return false
  if (!input.row.department_id) return false
  if (!can({ permissions: input.actor.permissions, code: "session:view_dept" })) return false
  return input.row.department_id === input.actor.department_id
}

function canWrite(input: { row: typeof TpChangeRequestTable.$inferSelect; actor: Actor }) {
  if (input.row.user_id === input.actor.user_id) return true
  return can({ permissions: input.actor.permissions, code: "session:update_any" })
}

function canOperate(input: { row: typeof TpChangeRequestTable.$inferSelect; actor: Actor }) {
  if (canWrite(input)) return true
  if (can({ permissions: input.actor.permissions, code: "session:view_all" })) return true
  if (!can({ permissions: input.actor.permissions, code: "session:view_org" })) return false
  return input.row.org_id === input.actor.org_id
}

function visibilityScope(input: { actor: Actor; reviewer_ids: string[] }) {
  if (can({ permissions: input.actor.permissions, code: "session:view_all" })) return
  const conditions: SQL[] = [eq(TpChangeRequestTable.user_id, input.actor.user_id)]
  if (input.reviewer_ids.length > 0) {
    conditions.push(inArray(TpChangeRequestTable.id, input.reviewer_ids))
  }
  if (can({ permissions: input.actor.permissions, code: "session:view_org" })) {
    conditions.push(eq(TpChangeRequestTable.org_id, input.actor.org_id))
  }
  if (input.actor.department_id && can({ permissions: input.actor.permissions, code: "session:view_dept" })) {
    conditions.push(eq(TpChangeRequestTable.department_id, input.actor.department_id))
  }
  return or(...conditions)
}

async function timeline(input: {
  change_request_id: string
  actor_id: string
  action: string
  detail?: string
  attachment_url?: string
}) {
  await Database.use(async (db) => {
    await db.insert(TpTimelineTable)
      .values({
        id: ulid(),
        change_request_id: input.change_request_id,
        actor_id: input.actor_id,
        action: input.action,
        detail: input.detail,
        attachment_url: input.attachment_url,
      })
      .run()
  })
}

async function audit(input: {
  actor: Actor
  action: string
  change_request_id: string
  result: "success" | "failed" | "blocked"
  detail?: Record<string, unknown>
  ip?: string
  user_agent?: string
}) {
  await UserService.audit({
    actor_user_id: input.actor.user_id,
    action: input.action,
    target_type: "tp_change_request",
    target_id: input.change_request_id,
    result: input.result,
    detail_json: input.detail,
    ip: input.ip,
    user_agent: input.user_agent,
  })
}

export namespace ApprovalService {
  export async function listChange(input: {
    actor: Actor
    status?: string
    mine?: boolean
    reviewer_only?: boolean
    limit?: number
  }) {
    const reviewer_ids = await reviewerChangeIDs(input.actor.user_id)
    const filters: SQL[] = []
    if (input.status) filters.push(eq(TpChangeRequestTable.status, input.status))
    if (input.mine) filters.push(eq(TpChangeRequestTable.user_id, input.actor.user_id))
    if (input.reviewer_only) {
      if (reviewer_ids.length === 0) return []
      filters.push(inArray(TpChangeRequestTable.id, reviewer_ids))
    }
    const scope = visibilityScope({
      actor: input.actor,
      reviewer_ids,
    })
    if (scope) filters.push(scope)
    return await Database.use((db) => {
      const size = input.limit ?? 100
      if (filters.length === 0) {
        return db
          .select()
          .from(TpChangeRequestTable)
          .orderBy(desc(TpChangeRequestTable.time_created), desc(TpChangeRequestTable.id))
          .limit(size)
          .all()
      }
      return db
        .select()
        .from(TpChangeRequestTable)
        .where(and(...filters))
        .orderBy(desc(TpChangeRequestTable.time_created), desc(TpChangeRequestTable.id))
        .limit(size)
        .all()
    })
  }

  export async function getChange(input: { actor: Actor; change_request_id: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    const reviewer_ids = await reviewerChangeIDs(input.actor.user_id)
    if (!canRead({ row, actor: input.actor, reviewer_ids })) return { ok: false as const, code: "forbidden" }
    const approvals = await Database.use((db) =>
      db.select().from(TpApprovalTable).where(eq(TpApprovalTable.change_request_id, input.change_request_id)).orderBy(asc(TpApprovalTable.step_order)).all(),
    )
    const timeline_rows = await Database.use((db) =>
      db.select().from(TpTimelineTable).where(eq(TpTimelineTable.change_request_id, input.change_request_id)).orderBy(asc(TpTimelineTable.time_created), asc(TpTimelineTable.id)).all(),
    )
    return {
      ok: true as const,
      change_request: row,
      approvals,
      timeline: timeline_rows,
    }
  }

  export async function listReviewer(input: { actor: Actor }) {
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpUserTable)
        .where(eq(TpUserTable.status, "active"))
        .orderBy(asc(TpUserTable.username))
        .all(),
    )
    const visible = rows.filter((item) => {
      if (can({ permissions: input.actor.permissions, code: "session:view_all" })) return true
      return item.org_id === input.actor.org_id
    })
    const pairs = await Promise.all(
      visible.map(async (item) => {
        const permissions = await UserService.permissionsByUser(item.id)
        if (item.id !== input.actor.user_id && !reviewable(permissions)) return
        return {
          id: item.id,
          username: item.username,
          display_name: item.display_name,
          org_id: item.org_id,
          department_id: item.department_id ?? undefined,
          roles: await UserService.rolesByUser(item.id),
          permissions,
        }
      }),
    )
    return pairs.filter((item) => !!item)
  }

  export async function create(input: {
    actor: Actor
    page_id?: string
    session_id?: string
    title: string
    description: string
    ai_plan?: string
    ai_prototype_url?: string
    ai_score?: number
    ai_revenue_assessment?: string
    ip?: string
    user_agent?: string
  }) {
    if (input.ai_score !== undefined && (input.ai_score < 0 || input.ai_score > 100)) {
      return { ok: false as const, code: "ai_score_invalid" }
    }
    if (input.session_id) {
      const session = await Database.use((db) => db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.session_id!)).get())
      if (!session) return { ok: false as const, code: "session_missing" }
    }
    const id = ulid()
    await Database.use(async (db) => {
      await db.insert(TpChangeRequestTable)
        .values({
          id,
          page_id: input.page_id,
          session_id: input.session_id,
          user_id: input.actor.user_id,
          org_id: input.actor.org_id,
          department_id: input.actor.department_id,
          title: input.title,
          description: input.description,
          ai_plan: input.ai_plan,
          ai_prototype_url: input.ai_prototype_url,
          ai_score: input.ai_score,
          ai_revenue_assessment: input.ai_revenue_assessment,
        })
        .run()
    })
    await timeline({
      change_request_id: id,
      actor_id: input.actor.user_id,
      action: "created",
      detail: input.title,
    })
    await audit({
      actor: input.actor,
      action: "approval.change_request.create",
      change_request_id: id,
      result: "success",
      detail: {
        session_id: input.session_id,
        title: input.title,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const, id }
  }

  export async function update(input: {
    actor: Actor
    change_request_id: string
    title?: string
    description?: string
    ai_plan?: string
    ai_prototype_url?: string
    ai_score?: number
    ai_revenue_assessment?: string
    ip?: string
    user_agent?: string
  }) {
    if (input.ai_score !== undefined && (input.ai_score < 0 || input.ai_score > 100)) {
      return { ok: false as const, code: "ai_score_invalid" }
    }
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    if (!canWrite({ row, actor: input.actor })) return { ok: false as const, code: "forbidden" }
    if (!editable.has(row.status)) {
      return { ok: false as const, code: "status_invalid" }
    }
    await Database.use(async (db) => {
      await db.update(TpChangeRequestTable)
        .set({
          title: input.title,
          description: input.description,
          ai_plan: input.ai_plan,
          ai_prototype_url: input.ai_prototype_url,
          ai_score: input.ai_score,
          ai_revenue_assessment: input.ai_revenue_assessment,
          time_updated: Date.now(),
        })
        .where(eq(TpChangeRequestTable.id, input.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: input.change_request_id,
      actor_id: input.actor.user_id,
      action: "updated",
      detail: input.title,
    })
    await audit({
      actor: input.actor,
      action: "approval.change_request.update",
      change_request_id: input.change_request_id,
      result: "success",
      detail: {
        title: input.title,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function confirm(input: { actor: Actor; change_request_id: string; ip?: string; user_agent?: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    if (!canWrite({ row, actor: input.actor })) return { ok: false as const, code: "forbidden" }
    if (!confirmable.has(row.status)) {
      return { ok: false as const, code: "status_invalid" }
    }
    await Database.use(async (db) => {
      await db.update(TpChangeRequestTable)
        .set({
          status: status.confirmed,
          confirmed_at: Date.now(),
          time_updated: Date.now(),
        })
        .where(eq(TpChangeRequestTable.id, input.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: input.change_request_id,
      actor_id: input.actor.user_id,
      action: "confirmed",
    })
    await audit({
      actor: input.actor,
      action: "approval.change_request.confirm",
      change_request_id: input.change_request_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function submit(input: {
    actor: Actor
    change_request_id: string
    reviewer_ids?: string[]
    ai_score?: number
    ai_revenue_assessment?: string
    ip?: string
    user_agent?: string
  }) {
    if (input.ai_score !== undefined && (input.ai_score < 0 || input.ai_score > 100)) {
      return { ok: false as const, code: "ai_score_invalid" }
    }
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    if (!canWrite({ row, actor: input.actor })) return { ok: false as const, code: "forbidden" }
    if (!editable.has(row.status)) {
      return { ok: false as const, code: "status_invalid" }
    }
    const reviewers = [...new Set((input.reviewer_ids ?? []).map((item) => item.trim()).filter((item) => !!item))]
    if (reviewers.length > 0) {
      const rows = await Database.use((db) => db.select().from(TpUserTable).where(inArray(TpUserTable.id, reviewers)).all())
      if (rows.length !== reviewers.length) return { ok: false as const, code: "reviewer_missing" }
      const checks = await Promise.all(
        reviewers.map(async (reviewer) => {
          const permissions = await UserService.permissionsByUser(reviewer)
          return { reviewer, ok: reviewable(permissions) }
        }),
      )
      const invalid = checks.find((item) => !item.ok)?.reviewer
      if (invalid) return { ok: false as const, code: "reviewer_permission_missing" }
    }
    const now = Date.now()
    await Database.use(async (db) => {
      await db.delete(TpApprovalTable).where(eq(TpApprovalTable.change_request_id, input.change_request_id)).run()
      if (reviewers.length === 0) {
        await db.insert(TpApprovalTable)
          .values({
            id: ulid(),
            change_request_id: input.change_request_id,
            reviewer_id: input.actor.user_id,
            step_order: 1,
            status: "approved",
            comment: "self_review_default",
            reviewed_at: now,
          })
          .run()
        await db.update(TpChangeRequestTable)
          .set({
            status: status.approved,
            current_step: 1,
            submitted_at: now,
            approved_at: now,
            rejected_at: null,
            ai_score: input.ai_score ?? row.ai_score,
            ai_revenue_assessment: input.ai_revenue_assessment ?? row.ai_revenue_assessment,
            time_updated: now,
          })
          .where(eq(TpChangeRequestTable.id, input.change_request_id))
          .run()
        return
      }
      await db.insert(TpApprovalTable)
        .values(
          reviewers.map((reviewer_id, idx) => ({
            id: ulid(),
            change_request_id: input.change_request_id,
            reviewer_id,
            step_order: idx + 1,
          })),
        )
        .run()
      await db.update(TpChangeRequestTable)
        .set({
          status: status.pending_review,
          current_step: 1,
          submitted_at: now,
          approved_at: null,
          rejected_at: null,
          ai_score: input.ai_score ?? row.ai_score,
          ai_revenue_assessment: input.ai_revenue_assessment ?? row.ai_revenue_assessment,
          time_updated: now,
        })
        .where(eq(TpChangeRequestTable.id, input.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: input.change_request_id,
      actor_id: input.actor.user_id,
      action: "submitted",
      detail: reviewers.length === 0 ? "self_review_default" : reviewers.join(","),
    })
    if (reviewers.length === 0) {
      await timeline({
        change_request_id: input.change_request_id,
        actor_id: input.actor.user_id,
        action: "approved",
        detail: "self_review_default",
      })
    }
    await audit({
      actor: input.actor,
      action: "approval.change_request.submit",
      change_request_id: input.change_request_id,
      result: "success",
      detail: {
        reviewer_ids: reviewers,
        review_mode: reviewers.length === 0 ? "self_review_default" : "chain_review",
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      status: reviewers.length === 0 ? status.approved : status.pending_review,
      current_step: 1,
    }
  }

  export async function review(input: {
    actor: Actor
    approval_id: string
    action: "approved" | "rejected"
    comment?: string
    ip?: string
    user_agent?: string
  }) {
    const row = await Database.use((db) => db.select().from(TpApprovalTable).where(eq(TpApprovalTable.id, input.approval_id)).get())
    if (!row) return { ok: false as const, code: "approval_missing" }
    const change = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, row.change_request_id)).get(),
    )
    if (!change) return { ok: false as const, code: "change_request_missing" }
    const is_assignee = row.reviewer_id === input.actor.user_id
    const can_override = reviewable(input.actor.permissions)
    if (!is_assignee && !can_override) return { ok: false as const, code: "forbidden" }
    if (row.status !== "pending") return { ok: false as const, code: "reviewed" }
    if (change.status !== status.pending_review) return { ok: false as const, code: "status_invalid" }
    if (row.step_order !== change.current_step && !can({ permissions: input.actor.permissions, code: "session:update_any" })) {
      return { ok: false as const, code: "not_current_step" }
    }
    const next = input.action === "approved" ? "approved" : "rejected"
    const now = Date.now()
    await Database.use(async (db) => {
      await db.update(TpApprovalTable)
        .set({
          status: next,
          comment: input.comment,
          reviewed_at: now,
          time_updated: now,
        })
        .where(eq(TpApprovalTable.id, input.approval_id))
        .run()
    })
    if (next === "rejected") {
      await Database.use(async (db) => {
        await db.update(TpChangeRequestTable)
          .set({
            status: status.rejected,
            rejected_at: now,
            current_step: row.step_order,
            time_updated: now,
          })
          .where(eq(TpChangeRequestTable.id, row.change_request_id))
          .run()
      })
      await timeline({
        change_request_id: row.change_request_id,
        actor_id: input.actor.user_id,
        action: "rejected",
        detail: input.comment,
      })
      await audit({
        actor: input.actor,
        action: "approval.review.reject",
        change_request_id: row.change_request_id,
        result: "success",
        detail: {
          approval_id: row.id,
          step_order: row.step_order,
          reviewer_id: row.reviewer_id,
          comment: input.comment,
        },
        ip: input.ip,
        user_agent: input.user_agent,
      })
      return { ok: true as const, status: status.rejected, current_step: row.step_order }
    }
    const pending = await Database.use((db) =>
      db
        .select({ step_order: TpApprovalTable.step_order })
        .from(TpApprovalTable)
        .where(and(eq(TpApprovalTable.change_request_id, row.change_request_id), eq(TpApprovalTable.status, "pending")))
        .orderBy(asc(TpApprovalTable.step_order))
        .all(),
    )
    if (pending.length === 0) {
      await Database.use(async (db) => {
        await db.update(TpChangeRequestTable)
          .set({
            status: status.approved,
            approved_at: now,
            current_step: row.step_order,
            time_updated: now,
          })
          .where(eq(TpChangeRequestTable.id, row.change_request_id))
          .run()
      })
      await timeline({
        change_request_id: row.change_request_id,
        actor_id: input.actor.user_id,
        action: "approved",
        detail: input.comment,
      })
      await audit({
        actor: input.actor,
        action: "approval.review.approve",
        change_request_id: row.change_request_id,
        result: "success",
        detail: {
          approval_id: row.id,
          step_order: row.step_order,
          reviewer_id: row.reviewer_id,
          comment: input.comment,
          final: true,
        },
        ip: input.ip,
        user_agent: input.user_agent,
      })
      return { ok: true as const, status: status.approved, current_step: row.step_order }
    }
    const step = pending[0]?.step_order ?? row.step_order
    await Database.use(async (db) => {
      await db.update(TpChangeRequestTable)
        .set({
          status: status.pending_review,
          current_step: step,
          time_updated: now,
        })
        .where(eq(TpChangeRequestTable.id, row.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: row.change_request_id,
      actor_id: input.actor.user_id,
      action: "approved",
      detail: input.comment,
    })
    await audit({
      actor: input.actor,
      action: "approval.review.approve",
      change_request_id: row.change_request_id,
      result: "success",
      detail: {
        approval_id: row.id,
        step_order: row.step_order,
        reviewer_id: row.reviewer_id,
        comment: input.comment,
        next_step: step,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const, status: status.pending_review, current_step: step }
  }

  export async function listReview(input: {
    actor: Actor
    status?: "pending" | "approved" | "rejected"
    limit?: number
    mine?: boolean
  }) {
    const filters: SQL[] = []
    if (input.status) filters.push(eq(TpApprovalTable.status, input.status))
    if (input.mine !== false || !reviewable(input.actor.permissions)) {
      filters.push(eq(TpApprovalTable.reviewer_id, input.actor.user_id))
    }
    const size = input.limit ?? 100
    const rows = await Database.use((db) => {
      if (filters.length === 0) {
        return db
          .select()
          .from(TpApprovalTable)
          .orderBy(desc(TpApprovalTable.time_created), desc(TpApprovalTable.id))
          .limit(size)
          .all()
      }
      return db
        .select()
        .from(TpApprovalTable)
        .where(and(...filters))
        .orderBy(desc(TpApprovalTable.time_created), desc(TpApprovalTable.id))
        .limit(size)
        .all()
    })
    const ids = [...new Set(rows.map((item) => item.change_request_id))]
    if (ids.length === 0) return []
    const changes = await Database.use((db) => db.select().from(TpChangeRequestTable).where(inArray(TpChangeRequestTable.id, ids)).all())
    const map = new Map(changes.map((item) => [item.id, item]))
    return rows
      .filter((item) => map.has(item.change_request_id))
      .map((item) => ({
        ...item,
        change_request: map.get(item.change_request_id)!,
      }))
  }

  export async function executing(input: { actor: Actor; change_request_id: string; ip?: string; user_agent?: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    if (!canOperate({ row, actor: input.actor })) return { ok: false as const, code: "forbidden" }
    if (row.status !== status.approved) return { ok: false as const, code: "status_invalid" }
    const now = Date.now()
    await Database.use(async (db) => {
      await db.update(TpChangeRequestTable)
        .set({
          status: status.executing,
          executing_at: now,
          time_updated: now,
        })
        .where(eq(TpChangeRequestTable.id, input.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: input.change_request_id,
      actor_id: input.actor.user_id,
      action: "executing",
    })
    await audit({
      actor: input.actor,
      action: "approval.change_request.executing",
      change_request_id: input.change_request_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function completed(input: { actor: Actor; change_request_id: string; ip?: string; user_agent?: string }) {
    const row = await Database.use((db) =>
      db.select().from(TpChangeRequestTable).where(eq(TpChangeRequestTable.id, input.change_request_id)).get(),
    )
    if (!row) return { ok: false as const, code: "change_request_missing" }
    if (!canOperate({ row, actor: input.actor })) return { ok: false as const, code: "forbidden" }
    if (!completable.has(row.status)) {
      return { ok: false as const, code: "status_invalid" }
    }
    const now = Date.now()
    await Database.use(async (db) => {
      await db.update(TpChangeRequestTable)
        .set({
          status: status.completed,
          completed_at: now,
          time_updated: now,
        })
        .where(eq(TpChangeRequestTable.id, input.change_request_id))
        .run()
    })
    await timeline({
      change_request_id: input.change_request_id,
      actor_id: input.actor.user_id,
      action: "completed",
    })
    await audit({
      actor: input.actor,
      action: "approval.change_request.completed",
      change_request_id: input.change_request_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }
}
