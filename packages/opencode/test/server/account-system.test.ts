import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { pbkdf2Sync } from "crypto"
import { Log } from "../../src/util/log"
import { and, Database, eq } from "../../src/storage/db"
import { TpAuditLogTable } from "../../src/user/audit-log.sql"
import { TpUserTable } from "../../src/user/user.sql"
import { parseSSE } from "../../src/control-plane/sse"
import { Flag } from "../../src/flag/flag"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })
const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED

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

  test.skipIf(!accountEnabled)("role manager can create role and assign it to user", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const admin = await login("admin", "TpCode@2026")
    const roleCode = uid("role_custom")
    const roleName = `自定义角色_${Date.now()}`

    const createdRole = await call({
      path: "/account/admin/roles",
      method: "POST",
      token: admin,
      body: {
        code: roleCode,
        name: roleName,
        scope: "system",
      },
    })
    expect(createdRole.status).toBe(200)
    const createdRoleBody = (await createdRole.json()) as Record<string, unknown>
    expect(createdRoleBody.ok).toBe(true)
    expect(createdRoleBody.code).toBe(roleCode)
    expect(createdRoleBody.name).toBe(roleName)

    const duplicateRole = await call({
      path: "/account/admin/roles",
      method: "POST",
      token: admin,
      body: {
        code: roleCode,
        name: roleName,
      },
    })
    expect(duplicateRole.status).toBe(400)
    const duplicateRoleBody = (await duplicateRole.json()) as Record<string, unknown>
    expect(duplicateRoleBody.code).toBe("role_exists")

    const listedRoles = await call({
      path: "/account/admin/roles",
      token: admin,
    })
    expect(listedRoles.status).toBe(200)
    const roles = (await listedRoles.json()) as Array<Record<string, unknown>>
    const role = roles.find((item) => item.code === roleCode)
    expect(role?.name).toBe(roleName)
    const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : []
    expect(rolePermissions).toEqual(
      expect.arrayContaining(["session:create", "session:view_own", "code:generate", "prototype:view", "file:browse", "agent:use_plan"]),
    )

    const username = uid("role_user")
    const password = "TpCode@123A"
    const createdUser = await service.createUser({
      username,
      password,
      display_name: "Role User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: [roleCode],
      actor_user_id: "user_tp_admin",
    })
    expect(createdUser.ok).toBe(true)

    const userToken = await login(username, password)
    const me = await call({
      path: "/account/me",
      token: userToken,
    })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as Record<string, unknown>
    expect(Array.isArray(meBody.roles) ? meBody.roles : []).toContain(roleCode)
    expect(Array.isArray(meBody.permissions) ? meBody.permissions : []).toEqual(
      expect.arrayContaining(["session:create", "code:generate"]),
    )
  }, 60000)

  test.skipIf(!accountEnabled)("role change invalidates auth cache immediately", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("cache_role")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Cache Role",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const token = await login(username, password)
    const warm = await call({
      path: "/account/me",
      token,
    })
    expect(warm.status).toBe(200)

    const allowedBefore = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("cache_role_before") },
    })
    expect(allowedBefore.status).toBe(200)

    const admin = await login("admin", "TpCode@2026")
    const updated = await call({
      path: `/account/admin/users/${encodeURIComponent(created.id)}/roles`,
      method: "POST",
      token: admin,
      body: { role_codes: [] },
    })
    expect(updated.status).toBe(200)

    const deniedAfter = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("cache_role_after") },
    })
    expect(deniedAfter.status).toBe(403)
  })

  test.skipIf(!accountEnabled)("user deactivation invalidates auth cache immediately", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("cache_status")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Cache Status",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const token = await login(username, password)
    const warm = await call({
      path: "/account/me",
      token,
    })
    expect(warm.status).toBe(200)

    const admin = await login("admin", "TpCode@2026")
    const patched = await call({
      path: `/account/admin/users/${encodeURIComponent(created.id)}`,
      method: "PATCH",
      token: admin,
      body: { status: "inactive" },
    })
    expect(patched.status).toBe(200)

    const denied = await call({
      path: "/account/me",
      token,
    })
    expect(denied.status).toBe(401)
  })

  test.skipIf(!accountEnabled)("user deletion invalidates auth cache immediately", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("cache_delete")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Cache Delete",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const token = await login(username, password)
    const warm = await call({
      path: "/account/me",
      token,
    })
    expect(warm.status).toBe(200)

    const admin = await login("admin", "TpCode@2026")
    const deleted = await call({
      path: `/account/admin/users/${encodeURIComponent(created.id)}`,
      method: "DELETE",
      token: admin,
    })
    expect(deleted.status).toBe(200)

    const denied = await call({
      path: "/account/me",
      token,
    })
    expect(denied.status).toBe(401)
  })

  test.skipIf(!accountEnabled)("custom role deletion invalidates affected user permissions immediately", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const admin = await login("admin", "TpCode@2026")
    const roleCode = uid("role_delete")
    const createdRole = await call({
      path: "/account/admin/roles",
      method: "POST",
      token: admin,
      body: {
        code: roleCode,
        name: "Delete Role",
        scope: "system",
      },
    })
    expect(createdRole.status).toBe(200)

    const username = uid("role_delete_user")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Role Delete User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: [roleCode],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)

    const token = await login(username, password)
    const allowedBefore = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("role_delete_before") },
    })
    expect(allowedBefore.status).toBe(200)

    const deleted = await call({
      path: `/account/admin/roles/${encodeURIComponent(roleCode)}`,
      method: "DELETE",
      token: admin,
    })
    expect(deleted.status).toBe(200)

    const deniedAfter = await call({
      path: "/session?directory=" + encodeURIComponent(projectRoot),
      method: "POST",
      token,
      body: { title: uid("role_delete_after") },
    })
    expect(deniedAfter.status).toBe(403)
  })

  test.skipIf(!accountEnabled)("built-in role deletion is rejected", async () => {
    const admin = await login("admin", "TpCode@2026")
    const response = await call({
      path: "/account/admin/roles/developer",
      method: "DELETE",
      token: admin,
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe("role_builtin_forbidden")
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

    const logs = await Database.use((db) =>
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
    const row = await Database.use((db) =>
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

  test.skipIf(!accountEnabled)("imported VHO user can login with employee password and is marked bound", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("vho_user")
    const password = "Pass1234"
    const salt = "0123456789abcdef0123456789abcdef"
    const password_hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 1000, 8, "sha1").toString("hex")
    const vho_user_id = uid("vho_id")
    const imported = await service.importVhoUsers({
      rows: [
        {
          user_id: vho_user_id,
          username,
          password_hash,
          password_salt: salt,
          display_name: "VHO User",
        },
      ],
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error("import_failed")
    expect(imported.created).toBe(1)

    const token = await login(username, password)
    const response = await call({
      path: "/account/me/vho-bind",
      token,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.vho_user_id).toBe(vho_user_id)
    expect(body.bound).toBe(true)
  })

  test.skipIf(!accountEnabled)("supports VHO url login by phone", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("vho_url")
    const phone = `13${String(Date.now()).slice(-9)}`
    const created = await service.createUser({
      username,
      password: "TpCode@123A",
      display_name: "VHO URL User",
      account_type: "internal",
      org_id: "org_tp_internal",
      phone,
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)

    const response = await call({
      path: "/account/login/vho",
      method: "POST",
      body: {
        user_id: phone,
        login_type: "vho",
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      access_token?: unknown
      user?: {
        username?: unknown
      }
    }
    expect(typeof body.access_token).toBe("string")
    expect(body.user?.username).toBe(username)
  })

  test.skipIf(!accountEnabled)("rejects VHO login when loginType is not vho", async () => {
    const response = await call({
      path: "/account/login/vho",
      method: "POST",
      body: {
        user_id: `13${String(Date.now()).slice(-9)}`,
        login_type: "VHO",
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe("vho_login_type_invalid")
  })

  test.skipIf(!accountEnabled)("rejects VHO login when phone does not exist", async () => {
    const response = await call({
      path: "/account/login/vho",
      method: "POST",
      body: {
        user_id: `13${String(Date.now()).slice(-9)}`,
        login_type: "vho",
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe("vho_user_not_found")
  })

  test.skipIf(!accountEnabled)("VHO login picks first active user by user id", async () => {
    const phone = `13${String(Date.now()).slice(-9)}`
    const base = uid("vho_dup")
    const a = `${base}_a`
    const b = `${base}_b`
    const ua = uid("vho_dup_user_a")
    const ub = uid("vho_dup_user_b")
    await Database.use((db) =>
      db.insert(TpUserTable)
        .values([
          {
            id: a,
            username: ua,
            password_hash: "vho_dup_hash",
            display_name: "VHO Dup A",
            phone,
            account_type: "internal",
            org_id: "org_tp_internal",
            status: "active",
            force_password_reset: false,
            external_source: "vho",
          },
          {
            id: b,
            username: ub,
            password_hash: "vho_dup_hash",
            display_name: "VHO Dup B",
            phone,
            account_type: "internal",
            org_id: "org_tp_internal",
            status: "active",
            force_password_reset: false,
            external_source: "vho",
          },
        ])
        .run(),
    )

    const response = await call({
      path: "/account/login/vho",
      method: "POST",
      body: {
        user_id: phone,
        login_type: "vho",
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      user?: {
        id?: unknown
        username?: unknown
      }
    }
    expect(body.user?.id).toBe(a)
    expect(body.user?.username).toBe(ua)
  })

  test.skipIf(!accountEnabled)("VHO login does not fallback when first active user is locked", async () => {
    const phone = `13${String(Date.now()).slice(-9)}`
    const base = uid("vho_locked")
    const a = `${base}_a`
    const b = `${base}_b`
    await Database.use((db) =>
      db.insert(TpUserTable)
        .values([
          {
            id: a,
            username: uid("vho_locked_user_a"),
            password_hash: "vho_locked_hash",
            display_name: "VHO Locked A",
            phone,
            account_type: "internal",
            org_id: "org_tp_internal",
            status: "active",
            force_password_reset: false,
            locked_until: Date.now() + 60_000,
            external_source: "vho",
          },
          {
            id: b,
            username: uid("vho_locked_user_b"),
            password_hash: "vho_locked_hash",
            display_name: "VHO Locked B",
            phone,
            account_type: "internal",
            org_id: "org_tp_internal",
            status: "active",
            force_password_reset: false,
            external_source: "vho",
          },
        ])
        .run(),
    )

    const response = await call({
      path: "/account/login/vho",
      method: "POST",
      body: {
        user_id: phone,
        login_type: "vho",
      },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe("user_locked")
  })

  test.skipIf(!accountEnabled)("user affiliation import updates customer fields without changing account department", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("affiliation_user")
    const created = await service.createUser({
      username,
      password: "TpCode@123A",
      display_name: "Affiliation User",
      account_type: "internal",
      org_id: "org_tp_internal",
      department_id: "dept_tp_rnd",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error("user_create_failed")

    const preview = await service.importUserAffiliations({
      rows: [
        {
          username,
          customer_id: "customer_1",
          customer_name: "示例客户",
          customer_department_id: "08",
          customer_department_name: "客户中心",
        },
        {
          username: uid("affiliation_missing"),
          customer_id: "customer_missing",
          customer_name: "未命中客户",
          customer_department_id: "03",
          customer_department_name: "工程中心",
        },
      ],
      dry_run: true,
    })
    expect(preview.ok).toBe(true)
    expect(preview.updated).toBe(1)
    expect(preview.unchanged).toBe(0)
    expect(preview.missing_user).toBe(1)
    expect(preview.skipped).toBe(0)
    expect(preview.dry_run).toBe(true)

    const dry = await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.id, created.id)).get())
    expect(dry?.customer_id).toBeNull()
    expect(dry?.customer_name).toBeNull()
    expect(dry?.customer_department_id).toBeNull()
    expect(dry?.customer_department_name).toBeNull()
    expect(dry?.department_id).toBe("dept_tp_rnd")

    const imported = await service.importUserAffiliations({
      rows: [
        {
          username,
          customer_id: "customer_1",
          customer_name: "示例客户",
          customer_department_id: "08",
          customer_department_name: "客户中心",
        },
      ],
    })
    expect(imported.ok).toBe(true)
    expect(imported.updated).toBe(1)
    expect(imported.unchanged).toBe(0)
    expect(imported.missing_user).toBe(0)
    expect(imported.skipped).toBe(0)
    expect(imported.dry_run).toBe(false)

    const saved = await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.id, created.id)).get())
    expect(saved?.customer_id).toBe("customer_1")
    expect(saved?.customer_name).toBe("示例客户")
    expect(saved?.customer_department_id).toBe("08")
    expect(saved?.customer_department_name).toBe("客户中心")
    expect(saved?.department_id).toBe("dept_tp_rnd")

    const cleared = await service.importUserAffiliations({
      rows: [
        {
          username,
          customer_id: "",
          customer_name: "",
          customer_department_id: "",
          customer_department_name: "",
        },
      ],
    })
    expect(cleared.ok).toBe(true)
    expect(cleared.updated).toBe(1)

    const empty = await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.id, created.id)).get())
    expect(empty?.customer_id).toBeNull()
    expect(empty?.customer_name).toBeNull()
    expect(empty?.customer_department_id).toBeNull()
    expect(empty?.customer_department_name).toBeNull()
    expect(empty?.department_id).toBe("dept_tp_rnd")
  })

  test.skipIf(!accountEnabled)("admin user list returns affiliation fields and patch ignores them", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("affiliation_api")
    const created = await service.createUser({
      username,
      password: "TpCode@123A",
      display_name: "Affiliation API User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error("user_create_failed")

    const imported = await service.importUserAffiliations({
      rows: [
        {
          username,
          customer_id: "customer_api",
          customer_name: "接口客户",
          customer_department_id: "03",
          customer_department_name: "工程中心",
        },
      ],
    })
    expect(imported.ok).toBe(true)

    const admin = await login("admin", "TpCode@2026")
    const pageResponse = await call({
      path: "/account/admin/users?page=1&page_size=20",
      token: admin,
    })
    expect(pageResponse.status).toBe(200)
    const pageBody = (await pageResponse.json()) as {
      items?: Array<Record<string, unknown>>
    }
    const paged = pageBody.items?.find((item) => item.id === created.id)
    expect(paged?.customer_name).toBe("接口客户")
    expect(paged?.customer_department_name).toBe("工程中心")

    const listResponse = await call({
      path: "/account/admin/users",
      token: admin,
    })
    expect(listResponse.status).toBe(200)
    const listBody = (await listResponse.json()) as Array<Record<string, unknown>>
    const listed = listBody.find((item) => item.id === created.id)
    expect(listed?.customer_id).toBe("customer_api")
    expect(listed?.customer_name).toBe("接口客户")
    expect(listed?.customer_department_id).toBe("03")
    expect(listed?.customer_department_name).toBe("工程中心")

    const patched = await call({
      path: `/account/admin/users/${encodeURIComponent(created.id)}`,
      method: "PATCH",
      token: admin,
      body: {
        display_name: "Affiliation API User Updated",
        customer_name: "不允许修改",
        customer_department_name: "不允许修改",
      },
    })
    expect(patched.status).toBe(200)

    const row = await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.id, created.id)).get())
    expect(row?.display_name).toBe("Affiliation API User Updated")
    expect(row?.customer_name).toBe("接口客户")
    expect(row?.customer_department_name).toBe("工程中心")
  })

  test.skipIf(!accountEnabled)("imported VHO user does not overwrite existing local account", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("vho_conflict")
    const local_password = "TpCode@123A"
    const local = await service.createUser({
      username,
      password: local_password,
      display_name: "Local User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(local.ok).toBe(true)

    const password = "Pass1234"
    const salt = "fedcba9876543210fedcba9876543210"
    const password_hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 1000, 8, "sha1").toString("hex")
    const imported = await service.importVhoUsers({
      rows: [
        {
          user_id: uid("vho_conflict_id"),
          username,
          password_hash,
          password_salt: salt,
          display_name: "VHO Conflict",
        },
      ],
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error("import_failed")
    expect(imported.conflict).toBe(1)

    const token = await login(username, local_password)
    const me = await call({
      path: "/account/me",
      token,
    })
    expect(me.status).toBe(200)

    const denied = await call({
      path: "/account/login",
      method: "POST",
      body: { username, password },
    })
    expect(denied.status).toBe(400)
    const body = (await denied.json()) as Record<string, unknown>
    expect(body.code).toBe("invalid_credentials")
  })
})
