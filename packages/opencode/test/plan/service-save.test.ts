import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { eq, Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable, MessageTable, PartTable } from "../../src/session/session.sql"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { TpProjectUserAccessTable } from "../../src/user/project-user-access.sql"
import type { MessageV2 } from "../../src/session/message-v2"

const { PlanEvalService } = await import("../../src/plan/eval-service")
const calls: Parameters<typeof PlanEvalService.start>[0][] = []
const { PlanService } = await import("../../src/plan/service")

afterEach(() => {
  calls.length = 0
})

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function seed() {
  const now = Date.now()
  const project_id = uid("project")
  const session_id = Identifier.ascending("session")
  const user_message_id = Identifier.ascending("message")
  const assistant_message_id = Identifier.ascending("message")
  const assistant_part_id = Identifier.ascending("part")
  const user_info = {
    role: "user",
    time: { created: now },
    agent: "user",
    model: { providerID: "openai", modelID: "gpt-4.1-mini" },
    tools: {},
  } satisfies Omit<MessageV2.User, "id" | "sessionID">
  const assistant_info = {
    role: "assistant",
    time: { created: now, completed: now },
    parentID: user_message_id,
    modelID: "gpt-4.1-mini",
    providerID: "openai",
    mode: "chat",
    agent: "plan",
    path: { cwd: process.cwd(), root: process.cwd() },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } satisfies Omit<MessageV2.Assistant, "id" | "sessionID">
  const assistant_part = {
    type: "text",
    text: "# Plan\n- async eval",
  } satisfies Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID">

  await Database.transaction(async (db) => {
    await db.insert(ProjectTable)
      .values({
        id: project_id,
        worktree: process.cwd(),
        vcs: "git",
        name: "save test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    await db.insert(SessionTable)
      .values({
        id: session_id,
        project_id: "global",
        context_project_id: project_id,
        slug: session_id,
        directory: process.cwd(),
        title: "save session",
        version: "1",
        user_id: "user_tp_admin",
        org_id: "org_tp_internal",
        visibility: "private",
        time_created: now,
        time_updated: now,
      })
      .run()
    await db.insert(MessageTable)
      .values({
        id: user_message_id,
        session_id,
        time_created: now,
        time_updated: now,
        data: user_info,
      })
      .run()
    await db.insert(MessageTable)
      .values({
        id: assistant_message_id,
        session_id,
        time_created: now,
        time_updated: now,
        data: assistant_info,
      })
      .run()
    await db.insert(PartTable)
      .values({
        id: assistant_part_id,
        session_id,
        message_id: assistant_message_id,
        time_created: now,
        time_updated: now,
        data: assistant_part,
      })
      .run()
  })

  return {
    project_id,
    session_id,
    assistant_message_id,
    assistant_part_id,
  }
}

describe("plan service save", () => {
  test("starts async eval after local save", async () => {
    const start = spyOn(PlanEvalService, "start").mockImplementation((input) => {
      calls.push(input)
    })
    const seeded = await seed()

    const result = await PlanService.save({
      session_id: seeded.session_id,
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      vho_feedback_no: "VHO-SAVE-1",
      actor: {
        id: "user_tp_admin",
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, result.id)).get(),
    )
    expect(row?.vho_feedback_no).toBe("VHO-SAVE-1")
    expect(row?.project_id).toBe(seeded.project_id)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.plan_id).toBe(result.id)
    expect(calls[0]?.vho_feedback_no).toBe("VHO-SAVE-1")
    start.mockRestore()
  })

  test("accepts explicit project_id when user can access the project", async () => {
    const start = spyOn(PlanEvalService, "start").mockImplementation((input) => {
      calls.push(input)
    })
    const seeded = await seed()

    await Database.use((db) =>
      db.insert(TpProjectUserAccessTable)
        .values({
          project_id: seeded.project_id,
          user_id: "user_tp_admin",
          mode: "allow",
          time_created: Date.now(),
        })
        .run(),
    )

    const result = await PlanService.save({
      session_id: seeded.session_id,
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      project_id: seeded.project_id,
      vho_feedback_no: "VHO-SAVE-2",
      actor: {
        id: "user_tp_admin",
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    const row = await Database.use((db) =>
      db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, result.id)).get(),
    )
    expect(row?.project_id).toBe(seeded.project_id)
    start.mockRestore()
  })

  test("rejects explicit project_id when user cannot access the project", async () => {
    const start = spyOn(PlanEvalService, "start").mockImplementation((input) => {
      calls.push(input)
    })
    const seeded = await seed()

    const result = await PlanService.save({
      session_id: seeded.session_id,
      message_id: seeded.assistant_message_id,
      part_id: seeded.assistant_part_id,
      project_id: seeded.project_id,
      vho_feedback_no: "VHO-SAVE-3",
      actor: {
        id: "user_tp_admin",
        username: "admin",
        display_name: "admin",
        account_type: "internal",
        org_id: "org_tp_internal",
      },
    })

    expect(result).toEqual({
      ok: false,
      code: "project_forbidden",
    })
    expect(calls).toHaveLength(0)
    start.mockRestore()
  })
})
