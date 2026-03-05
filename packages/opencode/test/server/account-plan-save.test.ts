import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Identifier } from "../../src/id/id"
import { Session } from "../../src/session"
import { and, Database, eq } from "../../src/storage/db"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { TpAuditLogTable } from "../../src/user/audit-log.sql"
import { Log } from "../../src/util/log"
import { Flag } from "../../src/flag/flag"

const root = path.join(__dirname, "../..")
Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), user: UserService }
}

const mem = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof boot>>["user"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function req(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
}) {
  const app = mem.app
  if (!app) throw new Error("app_missing")
  const headers = new Headers()
  if (input.token) headers.set("authorization", `Bearer ${input.token}`)
  if (input.body) headers.set("content-type", "application/json")
  return app.request(input.path, {
    method: input.method ?? "GET",
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
}

async function login(username: string, password: string) {
  const response = await req({
    path: "/account/login",
    method: "POST",
    body: { username, password },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    access_token?: string
    user?: {
      id: string
      username: string
      display_name: string
      account_type: string
      org_id: string
      department_id?: string
    }
  }
  const token = body.access_token
  const user = body.user
  expect(typeof token).toBe("string")
  expect(!!user).toBe(true)
  return { token: token!, user: user! }
}

async function createSession(token: string) {
  const response = await req({
    path: `/session?directory=${encodeURIComponent(root)}`,
    method: "POST",
    token,
    body: { title: uid("plan_session") },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id).toBe("string")
  return body.id!
}

async function createMessage(input: { sessionID: string; agent: string; text: string }) {
  const messageID = Identifier.ascending("message")
  const partID = Identifier.ascending("part")
  const created = Date.now()
  await Session.updateMessage({
    id: messageID,
    sessionID: input.sessionID,
    role: "assistant",
    time: {
      created,
      completed: created,
    },
    parentID: Identifier.ascending("message"),
    modelID: "gpt-4.1-mini",
    providerID: "openai",
    mode: "chat",
    agent: input.agent,
    path: {
      cwd: root,
      root,
    },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  })
  await Session.updatePart({
    id: partID,
    sessionID: input.sessionID,
    messageID,
    type: "text",
    text: input.text,
  })
  return {
    messageID,
    partID,
    created,
  }
}

beforeAll(async () => {
  if (!on) return
  const ready = await boot()
  mem.app = ready.app
  mem.user = ready.user
})

describe("account plan save", () => {
  test.skipIf(!on)("saves plan with vho feedback and writes audit", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const plan = await createMessage({
      sessionID,
      agent: "plan",
      text: "# Plan\n- Step 1\n- Step 2",
    })

    const response = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: plan.messageID,
        part_id: plan.partID,
        vho_feedback_no: "VHO-12345",
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok?: boolean
      id?: string
      session_id?: string
      message_id?: string
      part_id?: string
      saved_at?: number
    }
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe("string")

    const row = await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, body.id!)).get())
    expect(!!row).toBe(true)
    expect(row?.session_id).toBe(sessionID)
    expect(row?.message_id).toBe(plan.messageID)
    expect(row?.part_id).toBe(plan.partID)
    expect(row?.vho_feedback_no).toBe("VHO-12345")

    await new Promise((resolve) => setTimeout(resolve, 20))
    const audit = await Database.use((db) =>
      db
        .select()
        .from(TpAuditLogTable)
        .where(
          and(
            eq(TpAuditLogTable.action, "plan.save"),
            eq(TpAuditLogTable.target_type, "tp_saved_plan"),
            eq(TpAuditLogTable.target_id, body.id!),
          ),
        )
        .get(),
    )
    expect(!!audit).toBe(true)
  })

  test.skipIf(!on)("empty vho feedback should be stored as null", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const plan = await createMessage({
      sessionID,
      agent: "plan",
      text: "# plan",
    })
    const response = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: plan.messageID,
        part_id: plan.partID,
        vho_feedback_no: "    ",
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id?: string }
    const row = await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, body.id!)).get())
    expect(row?.vho_feedback_no ?? null).toBeNull()
  })

  test.skipIf(!on)("saving same plan twice creates two rows", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const plan = await createMessage({
      sessionID,
      agent: "plan",
      text: "repeat plan",
    })

    const first = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: plan.messageID,
        part_id: plan.partID,
      },
    })
    const second = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: plan.messageID,
        part_id: plan.partID,
      },
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpSavedPlanTable)
        .where(and(eq(TpSavedPlanTable.session_id, sessionID), eq(TpSavedPlanTable.message_id, plan.messageID)))
        .all(),
    )
    expect(rows.length).toBe(2)
  })

  test.skipIf(!on)("non-plan message returns plan_message_required", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const msg = await createMessage({
      sessionID,
      agent: "build",
      text: "not a plan",
    })

    const response = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: msg.messageID,
        part_id: msg.partID,
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe("plan_message_required")
  })

  test.skipIf(!on)("missing part returns part_missing", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const msg = await createMessage({
      sessionID,
      agent: "plan",
      text: "plan with missing part",
    })

    const response = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: msg.messageID,
        part_id: "prt_missing",
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe("part_missing")
  })

  test.skipIf(!on)("blank plan text returns plan_text_missing", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const msg = await createMessage({
      sessionID,
      agent: "plan",
      text: "   ",
    })

    const response = await req({
      path: "/account/plan/save",
      method: "POST",
      token: admin.token,
      body: {
        session_id: sessionID,
        message_id: msg.messageID,
        part_id: msg.partID,
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe("plan_text_missing")
  })

  test.skipIf(!on)("returns 401 for unauthenticated and 403 for missing permission", async () => {
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const sessionID = await createSession(admin.token)
    const msg = await createMessage({
      sessionID,
      agent: "plan",
      text: "plan text",
    })

    const unauthorized = await req({
      path: "/account/plan/save",
      method: "POST",
      body: {
        session_id: sessionID,
        message_id: msg.messageID,
        part_id: msg.partID,
      },
    })
    expect(unauthorized.status).toBe(401)

    const user = mem.user
    if (!user) throw new Error("user_service_missing")
    const username = uid("plan_forbidden")
    const password = "TpCode@123A"
    const created = await user.createUser({
      username,
      password,
      phone: "13800000000",
      display_name: "plan forbidden",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const role = await user.setUserRoles({
      user_id: created.id,
      role_codes: [],
      actor_user_id: "user_tp_admin",
    })
    expect(role.ok).toBe(true)

    const blocked = await login(username, password)
    const forbidden = await req({
      path: "/account/plan/save",
      method: "POST",
      token: blocked.token,
      body: {
        session_id: sessionID,
        message_id: msg.messageID,
        part_id: msg.partID,
      },
    })
    expect(forbidden.status).toBe(403)
    const body = (await forbidden.json()) as { code?: string; permission?: string }
    expect(body.code).toBe("forbidden")
    expect(body.permission).toBe("agent:use_plan")
  })
})
