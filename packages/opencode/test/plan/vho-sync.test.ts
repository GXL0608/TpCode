import { beforeEach, describe, expect, test } from "bun:test"
import { Database, and, eq, inArray, isNotNull } from "../../src/storage/db"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"

const { VhoSyncService } = await import("../../src/plan/vho-sync")

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function seed(input: Array<{ feedback: string | null; synced?: number }>) {
  const now = Date.now()
  const ids = input.map(() => uid("plan"))
  await Database.use((db) =>
    db.insert(TpSavedPlanTable)
      .values(input.map((item, index) => ({
        id: ids[index]!,
        session_id: uid("session"),
        message_id: uid("message"),
        part_id: uid("part"),
        project_id: "global",
        project_name: "global",
        project_worktree: process.cwd(),
        session_title: "title",
        user_id: "vho_sync_test",
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
        department_id: "",
        agent: "plan",
        provider_id: "openai",
        model_id: "gpt-4.1-mini",
        message_created_at: now,
        plan_content: "# plan",
        vho_feedback_no: item.feedback ?? undefined,
        vho_synced: item.synced ?? 0,
        time_created: now + index,
        time_updated: now + index,
      })))
      .run(),
  )
  return ids
}

beforeEach(async () => {
  await Database.use((db) => db.delete(TpSavedPlanTable).where(eq(TpSavedPlanTable.user_id, "vho_sync_test")).run())
})

describe("plan.vho-sync", () => {
  test("uses env password when provided", () => {
    const prev = process.env.OPENCODE_VHO_SYNC_PASSWORD
    process.env.OPENCODE_VHO_SYNC_PASSWORD = "custom-secret"

    expect(VhoSyncService.password()).toBe("custom-secret")
    expect(VhoSyncService.checkPassword("custom-secret")).toBe(true)
    expect(VhoSyncService.checkPassword("2026888")).toBe(false)

    if (prev === undefined) delete process.env.OPENCODE_VHO_SYNC_PASSWORD
    else process.env.OPENCODE_VHO_SYNC_PASSWORD = prev
  })

  test("syncs deduped pending feedbacks and marks all matching rows synced", async () => {
    await seed([
      { feedback: "FK_DUP", synced: 0 },
      { feedback: " FK_DUP ", synced: 0 },
      { feedback: "FK_OK", synced: 0 },
      { feedback: "FK_DONE", synced: 1 },
      { feedback: null, synced: 0 },
    ])
    const seeded = await Database.use((db) =>
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
            eq(TpSavedPlanTable.user_id, "vho_sync_test"),
            eq(TpSavedPlanTable.vho_synced, 0),
            isNotNull(TpSavedPlanTable.vho_feedback_no),
          ),
        )
        .all(),
    )

    const result = await VhoSyncService.syncAll({
      rows: seeded.filter((row): row is typeof seeded[number] & { vho_feedback_no: string } => row.vho_feedback_no !== null),
      mark: async ({ vho_feedback_no }) => {
        if (vho_feedback_no !== "FK_OK") return { ok: true }
        return {
          ok: false as const,
          code: "third_party_feedback_update_failed",
          message: "upstream failed",
        }
      },
    })

    expect(result).toEqual({
      ok: true,
      scanned: 3,
      deduped: 2,
      synced: 1,
      failed: 1,
      skipped: 0,
      failed_feedback_ids: ["FK_OK"],
    })

    const rows = await Database.use((db) =>
      db.select().from(TpSavedPlanTable).where(inArray(TpSavedPlanTable.vho_feedback_no, ["FK_DUP", " FK_DUP ", "FK_OK", "FK_DONE"])).all(),
    )
    const dup = rows.filter((item) => item.vho_feedback_no?.trim() === "FK_DUP")
    const fail = rows.find((item) => item.vho_feedback_no === "FK_OK")
    const done = rows.find((item) => item.vho_feedback_no === "FK_DONE")
    expect(dup.map((item) => item.vho_synced)).toEqual([1, 1])
    expect(fail?.vho_synced).toBe(0)
    expect(done?.vho_synced).toBe(1)
  })
})
