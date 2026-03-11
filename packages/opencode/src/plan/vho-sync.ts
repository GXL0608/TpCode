import { TaskFeedbackService } from "./task-feedback"
import { TpSavedPlanTable } from "./saved-plan.sql"
import { Database, and, asc, eq, inArray, isNotNull } from "@/storage/db"

const default_password = "2026888"
const production_db = {
  hostname: "182.92.74.187",
  port: "9124",
  pathname: "/opencode",
}

type MarkInput = Parameters<typeof TaskFeedbackService.markAiPlan>[0]
type Mark = (input: MarkInput) => ReturnType<typeof TaskFeedbackService.markAiPlan>

type Row = {
  id: string
  session_id: string
  message_id: string
  vho_feedback_no: string
}

function feedback(input: string) {
  return input.trim()
}

function pending(rows: Row[]) {
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const key = feedback(row.vho_feedback_no)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [key]
  })
}

function matches(url: string) {
  const value = new URL(url)
  const port = value.port || "5432"
  return value.hostname === production_db.hostname && port === production_db.port && value.pathname === production_db.pathname
}

export namespace VhoSyncService {
  export function password() {
    return process.env.OPENCODE_VHO_SYNC_PASSWORD?.trim() || default_password
  }

  export function checkPassword(input: string) {
    return input === password()
  }

  export function canRun() {
    if (process.env.NODE_ENV !== "production") return false
    return matches(Database.url())
  }

  export async function syncAll(input?: { mark?: Mark; rows?: Row[] }) {
    const rows = input?.rows ?? await Database.use((db) =>
      db
        .select({
          id: TpSavedPlanTable.id,
          session_id: TpSavedPlanTable.session_id,
          message_id: TpSavedPlanTable.message_id,
          vho_feedback_no: TpSavedPlanTable.vho_feedback_no,
        })
        .from(TpSavedPlanTable)
        .where(
          and(
            isNotNull(TpSavedPlanTable.vho_feedback_no),
            eq(TpSavedPlanTable.vho_synced, 0),
          ),
        )
        .orderBy(asc(TpSavedPlanTable.time_created), asc(TpSavedPlanTable.id))
        .all(),
    )
    const list = rows
      .filter((row): row is Row => !!row.vho_feedback_no?.trim())
      .filter((row) => row.vho_feedback_no.trim().length > 0)
      .filter((row) => row.vho_feedback_no !== null)
    const keys = pending(list)
    const mark = input?.mark ?? TaskFeedbackService.markAiPlan
    const groups = new Map<string, Row[]>()
    list.forEach((row) => {
      const key = feedback(row.vho_feedback_no)
      const items = groups.get(key)
      if (items) {
        items.push(row)
        return
      }
      groups.set(key, [row])
    })

    const failed_feedback_ids: string[] = []
    let synced = 0
    for (const key of keys) {
      const group = groups.get(key)
      if (!group?.length) continue
      const first = group[0]
      if (!first) continue
      const result = await mark({
        vho_feedback_no: key,
        plan_id: first.id,
        session_id: first.session_id,
        message_id: first.message_id,
      })
      if (!result.ok) {
        failed_feedback_ids.push(key)
        continue
      }
      synced += 1
      const ids = group.map((item) => item.id)
      await Database.use((db) =>
        db.update(TpSavedPlanTable)
          .set({
            vho_synced: 1,
            time_updated: Date.now(),
          })
          .where(inArray(TpSavedPlanTable.id, ids))
          .run(),
      )
    }

    return {
      ok: true as const,
      scanned: list.length,
      deduped: keys.length,
      synced,
      failed: failed_feedback_ids.length,
      skipped: 0,
      failed_feedback_ids,
    }
  }
}
