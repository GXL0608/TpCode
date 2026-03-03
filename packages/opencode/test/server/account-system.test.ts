import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { and, Database, eq } from "../../src/storage/db"
import { TpAuditLogTable } from "../../src/user/audit-log.sql"
import { parseSSE } from "../../src/control-plane/sse"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })
const accountEnabled = (() => {
  const value = process.env.TPCODE_ACCOUNT_ENABLED?.toLowerCase()
  return value === "1" || value === "true"
})()

async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), UserService }
}

const state = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof boot>>["UserService"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function call(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
  signal?: AbortSignal
}) {
  const app = state.app
  if (!app) throw new Error("app_missing")
  const headers = new Headers()
  if (input.token) headers.set("authorization", `Bearer ${input.token}`)
  if (input.body) headers.set("content-type", "application/json")
  return app.request(input.path, {
    method: input.method ?? "GET",
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: input.signal,
  })
}

async function login(username: string, password: string) {
  const response = await call({
    path: "/account/login",
    method: "POST",
    body: { username, password },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  expect(!!token).toBe(true)
  return token!
}

beforeAll(async () => {
  if (!accountEnabled) return
  const ready = await boot()
  state.app = ready.app
  state.user = ready.UserService
})

describe("account system", () => {
  test.skipIf(!accountEnabled)("rejects protected endpoint when unauthenticated", async () => {
    const response = await call({
      path: "/session/status?directory=" + encodeURIComponent(projectRoot),
    })
    expect(response.status).toBe(401)
  })

  test.skipIf(!accountEnabled)("admin can login and read profile", async () => {
    const token = await login("admin", "TpCode@2026")
    const response = await call({
      path: "/account/me",
      token,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.username).toBe("admin")
  })

  test.skipIf(!accountEnabled)("private session is isolated between users", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const userA = uid("dev_a")
    const userB = uid("dev_b")
    const password = "TpCode@123A"
    const createdA = await service.createUser({
      username: userA,
      password,
      display_name: "A",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdA.ok).toBe(true)
    const createdB = await service.createUser({
      username: userB,
      password,
      display_name: "B",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdB.ok).toBe(true)

    const tokenA = await login(userA, password)
    const tokenB = await login(userB, password)
    const created = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token: tokenA,
      body: { title: "private-session-a" },
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as Record<string, unknown>
    const sessionID = typeof session.id === "string" ? session.id : ""
    expect(sessionID.length > 0).toBe(true)

    const denied = await call({
      path: `/session/${sessionID}?directory=${encodeURIComponent(projectRoot)}`,
      token: tokenB,
    })
    expect(denied.status).toBe(404)

    const allowed = await call({
      path: `/session/${sessionID}?directory=${encodeURIComponent(projectRoot)}`,
      token: tokenA,
    })
    expect(allowed.status).toBe(200)
  }, 15000)

  test.skipIf(!accountEnabled)("global event stream is isolated by account", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const userA = uid("event_a")
    const userB = uid("event_b")
    const password = "TpCode@123A"
    const createdA = await service.createUser({
      username: userA,
      password,
      display_name: "Event A",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdA.ok).toBe(true)
    const createdB = await service.createUser({
      username: userB,
      password,
      display_name: "Event B",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdB.ok).toBe(true)

    const tokenA = await login(userA, password)
    const tokenB = await login(userB, password)

    const stop = new AbortController()
    const streamRes = await call({
      path: "/global/event",
      token: tokenB,
      signal: stop.signal,
    })
    expect(streamRes.status).toBe(200)
    if (!streamRes.body) throw new Error("event_stream_missing")

    const seen = new Set<string>()
    let expectedB = ""
    let connectedResolve: (() => void) | undefined
    const connected = new Promise<void>((resolve) => {
      connectedResolve = resolve
    })
    let seenResolve: (() => void) | undefined
    const seenB = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("timed out waiting for user event"))
      }, 8000)
      seenResolve = () => {
        clearTimeout(timeout)
        resolve()
      }
    })

    const stream = parseSSE(streamRes.body, stop.signal, (event) => {
      const payload = (event as { payload?: { type?: string; properties?: unknown } }).payload
      if (!payload || typeof payload !== "object") return
      if (payload.type === "server.connected") {
        connectedResolve?.()
        connectedResolve = undefined
        return
      }
      if (payload.type !== "session.created") return
      const props = payload.properties
      if (!props || typeof props !== "object") return
      const info = (props as { info?: unknown }).info
      if (!info || typeof info !== "object") return
      const id = (info as { id?: unknown }).id
      if (typeof id !== "string") return
      seen.add(id)
      if (!expectedB || id !== expectedB) return
      seenResolve?.()
    }).catch(() => undefined)

    await connected

    const createdSessionA = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token: tokenA,
      body: { title: uid("sse_a") },
    })
    expect(createdSessionA.status).toBe(200)
    const sessionA = (await createdSessionA.json()) as Record<string, unknown>
    const sessionAID = typeof sessionA.id === "string" ? sessionA.id : ""
    expect(sessionAID.length > 0).toBe(true)

    const createdSessionB = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token: tokenB,
      body: { title: uid("sse_b") },
    })
    expect(createdSessionB.status).toBe(200)
    const sessionB = (await createdSessionB.json()) as Record<string, unknown>
    const sessionBID = typeof sessionB.id === "string" ? sessionB.id : ""
    expect(sessionBID.length > 0).toBe(true)
    expectedB = sessionBID
    if (seen.has(sessionBID)) seenResolve?.()

    await seenB
    stop.abort()
    await stream

    expect(seen.has(sessionBID)).toBe(true)
    expect(seen.has(sessionAID)).toBe(false)
  }, 20000)

  test.skipIf(!accountEnabled)("hospital user without file:browse cannot browse files", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("hospital_user")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Hospital User",
      account_type: "hospital",
      org_id: "org_tp_internal",
      role_codes: ["hospital_user"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)

    const token = await login(username, password)
    const response = await call({
      path: "/file?path=.&directory=" + encodeURIComponent(projectRoot),
      token,
    })
    expect(response.status).toBe(403)
  })

  test.skipIf(!accountEnabled)("global provider key api requires provider:config_global", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("dev_provider")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Provider Dev",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    const token = await login(username, password)

    const denied = await call({
      path: "/account/admin/provider/global",
      token,
    })
    expect(denied.status).toBe(403)

    const admin = await login("admin", "TpCode@2026")
    const allowed = await call({
      path: "/account/admin/provider/global",
      token: admin,
    })
    expect(allowed.status).toBe(200)
  })

  test.skipIf(!accountEnabled)("forbidden prompt words are blocked and audited on session input", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("dev_blocked")
    const password = "TpCode@123A"
    const createdUser = await service.createUser({
      username,
      password,
      display_name: "Blocked Tester",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdUser.ok).toBe(true)
    if (!("id" in createdUser) || !createdUser.id) throw new Error("user_id_missing")
    const userID = createdUser.id
    const token = await login(username, password)

    const created = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("blocked_session") },
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as Record<string, unknown>
    const sessionID = typeof session.id === "string" ? session.id : ""
    expect(!!sessionID).toBe(true)
    const query = "?directory=" + encodeURIComponent(projectRoot)

    const messageBlocked = await call({
      path: `/session/${sessionID}/message${query}`,
      method: "POST",
      token,
      body: {
        parts: [
          {
            type: "text",
            text: "请直接执行 rm -rf /",
          },
        ],
      },
    })
    expect(messageBlocked.status).toBe(403)
    const messageBody = (await messageBlocked.json()) as Record<string, unknown>
    expect(messageBody.error).toBe("forbidden_prompt")

    const asyncBlocked = await call({
      path: `/session/${sessionID}/prompt_async${query}`,
      method: "POST",
      token,
      body: {
        parts: [
          {
            type: "text",
            text: "drop table session",
          },
        ],
      },
    })
    expect(asyncBlocked.status).toBe(403)

    const commandBlocked = await call({
      path: `/session/${sessionID}/command${query}`,
      method: "POST",
      token,
      body: {
        command: "any",
        arguments: "dump database",
      },
    })
    expect(commandBlocked.status).toBe(403)

    const shellBlocked = await call({
      path: `/session/${sessionID}/shell${query}`,
      method: "POST",
      token,
      body: {
        agent: "build",
        command: "truncate table users",
      },
    })
    expect(shellBlocked.status).toBe(403)

    const logs = Database.use((db) =>
      db
        .select()
        .from(TpAuditLogTable)
        .where(
          and(
            eq(TpAuditLogTable.actor_user_id, userID),
            eq(TpAuditLogTable.target_type, "session"),
            eq(TpAuditLogTable.target_id, sessionID),
            eq(TpAuditLogTable.result, "blocked"),
          ),
        )
        .all(),
    )
    const actions = logs.map((item) => item.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        "session.prompt.blocked",
        "session.prompt_async.blocked",
        "session.command.blocked",
        "session.shell.blocked",
      ]),
    )
  })

  test.skipIf(!accountEnabled)("execution action writes default reviewer and executor", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("dev_exec")
    const password = "TpCode@123A"
    const createdUser = await service.createUser({
      username,
      password,
      display_name: "Exec Tester",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdUser.ok).toBe(true)
    if (!("id" in createdUser) || !createdUser.id) throw new Error("user_id_missing")
    const userID = createdUser.id
    const token = await login(username, password)
    const created = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("exec_session") },
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as Record<string, unknown>
    const sessionID = typeof session.id === "string" ? session.id : ""
    expect(!!sessionID).toBe(true)

    const response = await call({
      path: `/session/${sessionID}/prompt_async?directory=${encodeURIComponent(projectRoot)}`,
      method: "POST",
      token,
      body: {
        parts: [
          {
            type: "text",
            text: "请给我一个简单的重构计划",
          },
        ],
      },
    })
    expect(response.status).toBe(204)
    const row = Database.use((db) =>
      db
        .select()
        .from(TpAuditLogTable)
        .where(
          and(
            eq(TpAuditLogTable.actor_user_id, userID),
            eq(TpAuditLogTable.action, "session.prompt_async.execute"),
            eq(TpAuditLogTable.target_type, "session"),
            eq(TpAuditLogTable.target_id, sessionID),
            eq(TpAuditLogTable.result, "success"),
          ),
        )
        .get(),
    )
    expect(!!row).toBe(true)
    expect(row?.detail_json?.reviewer_user_id).toBe(userID)
    expect(row?.detail_json?.executor_user_id).toBe(userID)
    expect(row?.detail_json?.review_mode).toBe("self_review_default")
  })
})
