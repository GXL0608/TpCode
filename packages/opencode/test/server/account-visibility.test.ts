import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { and, Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { TpUserProviderTable } from "../../src/user/user-provider.sql"
import { Flag } from "../../src/flag/flag"

const root = path.join(__dirname, "../..")
Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

const mem = {
  app: undefined as Awaited<ReturnType<typeof init>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof init>>["user"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function init() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), user: UserService }
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
  const body = (await response.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  expect(!!token).toBe(true)
  return token!
}

beforeAll(async () => {
  if (!on) return
  const ready = await init()
  mem.app = ready.app
  mem.user = ready.user
})

describe("account visibility", () => {
  test.skipIf(!on)("department visibility requires context project", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const org = await svc.createOrganization({
      name: uid("hospital"),
      code: uid("org"),
      org_type: "hospital",
      actor_user_id: "user_tp_admin",
    })
    expect(org.ok).toBe(true)
    if (!("id" in org) || !org.id) throw new Error("org_id_missing")
    const orgID = org.id
    const d1 = await svc.createDepartment({
      org_id: orgID,
      name: uid("dept_a"),
      actor_user_id: "user_tp_admin",
    })
    const d2 = await svc.createDepartment({
      org_id: orgID,
      name: uid("dept_b"),
      actor_user_id: "user_tp_admin",
    })
    expect(d1.ok).toBe(true)
    expect(d2.ok).toBe(true)
    if (!("id" in d1) || !d1.id) throw new Error("dept1_id_missing")
    if (!("id" in d2) || !d2.id) throw new Error("dept2_id_missing")
    const d1ID = d1.id
    const d2ID = d2.id

    const pass = "TpCode@123A"
    const ua = uid("dept_creator")
    const ub = uid("dept_peer")
    const uc = uid("dept_other")
    expect(
      (
        await svc.createUser({
          username: ua,
          password: pass,
          account_type: "hospital",
          org_id: orgID,
          department_id: d1ID,
          role_codes: ["dept_director"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await svc.createUser({
          username: ub,
          password: pass,
          account_type: "hospital",
          org_id: orgID,
          department_id: d1ID,
          role_codes: ["dept_director"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await svc.createUser({
          username: uc,
          password: pass,
          account_type: "hospital",
          org_id: orgID,
          department_id: d2ID,
          role_codes: ["dept_director"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)

    const ta = await login(ua, pass)
    const tb = await login(ub, pass)
    const tc = await login(uc, pass)
    const created = await req({
      path: "/session?directory=" + encodeURIComponent(root),
      method: "POST",
      token: ta,
      body: { title: uid("dept_session"), visibility: "department" },
    })
    expect(created.status).toBe(428)
    return
    const session = (await created.json()) as Record<string, unknown>
    const id = typeof session.id === "string" ? session.id : ""
    expect(!!id).toBe(true)

    const same = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      token: tb,
    })
    expect(same.status).toBe(404)
    const other = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      token: tc,
    })
    expect(other.status).toBe(404)
  })

  test.skipIf(!on)("org visibility requires context project", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const orgA = await svc.createOrganization({
      name: uid("hospital_a"),
      code: uid("orga"),
      org_type: "hospital",
      actor_user_id: "user_tp_admin",
    })
    const orgB = await svc.createOrganization({
      name: uid("hospital_b"),
      code: uid("orgb"),
      org_type: "hospital",
      actor_user_id: "user_tp_admin",
    })
    expect(orgA.ok).toBe(true)
    expect(orgB.ok).toBe(true)
    if (!("id" in orgA) || !orgA.id) throw new Error("orga_id_missing")
    if (!("id" in orgB) || !orgB.id) throw new Error("orgb_id_missing")
    const orgAID = orgA.id
    const orgBID = orgB.id
    const da = await svc.createDepartment({
      org_id: orgAID,
      name: uid("dept_1"),
      actor_user_id: "user_tp_admin",
    })
    const db = await svc.createDepartment({
      org_id: orgBID,
      name: uid("dept_2"),
      actor_user_id: "user_tp_admin",
    })
    expect(da.ok).toBe(true)
    expect(db.ok).toBe(true)
    if (!("id" in da) || !da.id) throw new Error("depta_id_missing")
    if (!("id" in db) || !db.id) throw new Error("deptb_id_missing")
    const daID = da.id
    const dbID = db.id

    const pass = "TpCode@123A"
    const ua = uid("org_creator")
    const ub = uid("org_peer")
    const uc = uid("org_other")
    expect(
      (
        await svc.createUser({
          username: ua,
          password: pass,
          account_type: "hospital",
          org_id: orgAID,
          department_id: daID,
          role_codes: ["hospital_admin"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await svc.createUser({
          username: ub,
          password: pass,
          account_type: "hospital",
          org_id: orgAID,
          department_id: daID,
          role_codes: ["hospital_admin"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await svc.createUser({
          username: uc,
          password: pass,
          account_type: "hospital",
          org_id: orgBID,
          department_id: dbID,
          role_codes: ["hospital_admin"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)

    const ta = await login(ua, pass)
    const tb = await login(ub, pass)
    const tc = await login(uc, pass)
    const created = await req({
      path: "/session?directory=" + encodeURIComponent(root),
      method: "POST",
      token: ta,
      body: { title: uid("org_session"), visibility: "org" },
    })
    expect(created.status).toBe(428)
    return
    const session = (await created.json()) as Record<string, unknown>
    const id = typeof session.id === "string" ? session.id : ""
    expect(!!id).toBe(true)

    const same = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      token: tb,
    })
    expect(same.status).toBe(404)
    const other = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      token: tc,
    })
    expect(other.status).toBe(404)
  })

  test.skipIf(!on)("public visibility update requires context project", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const user = uid("public_dev")
    const pass = "TpCode@123A"
    expect(
      (
        await svc.createUser({
          username: user,
          password: pass,
          account_type: "internal",
          org_id: "org_tp_internal",
          role_codes: ["developer"],
          actor_user_id: "user_tp_admin",
        })
      ).ok,
    ).toBe(true)
    const dev = await login(user, pass)
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")

    const created = await req({
      path: "/session?directory=" + encodeURIComponent(root),
      method: "POST",
      token: dev,
      body: { title: uid("public_patch") },
    })
    expect(created.status).toBe(428)
    return
    const session = (await created.json()) as Record<string, unknown>
    const id = typeof session.id === "string" ? session.id : ""

    const denied = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      method: "PATCH",
      token: dev,
      body: { visibility: "public" },
    })
    expect(denied.status).toBe(403)

    const ok = await req({
      path: `/session/${id}?directory=${encodeURIComponent(root)}`,
      method: "PATCH",
      token: admin,
      body: { visibility: "public" },
    })
    expect(ok.status).toBe(404)
  })

  test.skipIf(!on)("provider keys are isolated per user", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const a = uid("key_a")
    const b = uid("key_b")
    const pass = "TpCode@123A"
    const ua = await svc.createUser({
      username: a,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    const ub = await svc.createUser({
      username: b,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(ua.ok).toBe(true)
    expect(ub.ok).toBe(true)
    if (!("id" in ua) || !ua.id) throw new Error("usera_id_missing")
    if (!("id" in ub) || !ub.id) throw new Error("userb_id_missing")
    const uaID = ua.id
    const ubID = ub.id

    const ta = await login(a, pass)
    const tb = await login(b, pass)
    const ra = await req({
      path: "/auth/openai",
      method: "PUT",
      token: ta,
      body: { type: "api", key: "sk-user-a" },
    })
    const rb = await req({
      path: "/auth/openai",
      method: "PUT",
      token: tb,
      body: { type: "api", key: "sk-user-b" },
    })
    expect(ra.status).toBe(200)
    expect(rb.status).toBe(200)

    const ownA = await req({
      path: "/account/me/provider/openai",
      token: ta,
    })
    const ownB = await req({
      path: "/account/me/provider/openai",
      token: tb,
    })
    expect(ownA.status).toBe(200)
    expect(ownB.status).toBe(200)
    const ownABody = (await ownA.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    const ownBBody = (await ownB.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(ownABody.configured).toBe(true)
    expect(ownABody.source).toBe("user")
    expect(ownABody.auth_type).toBe("api")
    expect(ownBBody.configured).toBe(true)
    expect(ownBBody.source).toBe("user")
    expect(ownBBody.auth_type).toBe("api")

    const updateA = await req({
      path: "/auth/openai",
      method: "PUT",
      token: ta,
      body: { type: "api", key: "sk-user-a-2" },
    })
    expect(updateA.status).toBe(200)

    const activeA = await req({
      path: "/account/me/provider/openai",
      token: ta,
    })
    expect(activeA.status).toBe(200)
    const activeABody = (await activeA.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(activeABody.configured).toBe(true)
    expect(activeABody.source).toBe("user")
    expect(activeABody.auth_type).toBe("api")

    const keepB = await req({
      path: "/account/me/provider/openai",
      token: tb,
    })
    expect(keepB.status).toBe(200)
    const keepBBody = (await keepB.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(keepBBody.configured).toBe(true)
    expect(keepBBody.source).toBe("user")
    expect(keepBBody.auth_type).toBe("api")

    const rowA = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, uaID), eq(TpUserProviderTable.provider_id, "openai")))
        .get(),
    )
    const rowB = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, ubID), eq(TpUserProviderTable.provider_id, "openai")))
        .get(),
    )
    expect(!!rowA).toBe(true)
    expect(!!rowB).toBe(true)
    const keyA = rowA ? (JSON.parse(rowA.secret_cipher) as { key?: string }).key : undefined
    const keyB = rowB ? (JSON.parse(rowB.secret_cipher) as { key?: string }).key : undefined
    expect(keyA).toContain("sk-user-a")
    expect(keyB).toContain("sk-user-b")
    expect(keyA).not.toBe(keyB)
  })

  test.skipIf(!on)("non super_admin cannot manage other user providers even with provider:config_user", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const role = uid("delegate_role")
    const createRole = await svc.createRole({
      code: role,
      name: role,
      scope: "system",
      permission_codes: ["provider:config_user"],
      actor_user_id: "user_tp_admin",
    })
    expect(createRole.ok).toBe(true)

    const username = uid("delegate_user")
    const password = "TpCode@123A"
    const created = await svc.createUser({
      username,
      password,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: [role],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)

    const token = await login(username, password)
    const denied = await req({
      path: "/account/admin/users/user_tp_admin/providers",
      token,
    })
    expect(denied.status).toBe(403)
    const body = (await denied.json()) as { permission?: string; error?: string }
    expect(body.error).toBe("forbidden")
    expect(body.permission).toBe("role:super_admin")
  })

  test.skipIf(!on)("super_admin can manage target user provider and does not use target config for self", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const superName = uid("sa_delegate")
    const targetName = uid("sa_target")
    const pass = "TpCode@123A"
    const sa = await svc.createUser({
      username: superName,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["super_admin"],
      actor_user_id: "user_tp_admin",
    })
    const target = await svc.createUser({
      username: targetName,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(sa.ok).toBe(true)
    expect(target.ok).toBe(true)
    if (!("id" in target) || !target.id) throw new Error("target_id_missing")

    const admin = await login(superName, pass)
    const setTarget = await req({
      path: `/account/admin/users/${encodeURIComponent(target.id)}/providers/openai`,
      method: "PUT",
      token: admin,
      body: { type: "api", key: "sk-target-user-openai" },
    })
    expect(setTarget.status).toBe(200)

    const targetOwn = await req({
      path: `/account/me/provider/openai`,
      token: await login(targetName, pass),
    })
    expect(targetOwn.status).toBe(200)
    const targetBody = (await targetOwn.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(targetBody.configured).toBe(true)
    expect(targetBody.source).toBe("user")
    expect(targetBody.auth_type).toBe("api")

    const adminOwn = await req({
      path: "/account/me/provider/openai",
      token: admin,
    })
    expect(adminOwn.status).toBe(200)
    const adminBody = (await adminOwn.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(adminBody.configured).toBe(false)
    expect(adminBody.source).toBe("none")
    expect(adminBody.auth_type).toBeUndefined()
  })

  test.skipIf(!on)("shared provider key does not auto-apply to normal user in strict mode", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")

    const setGlobal = await req({
      path: "/account/admin/provider/openai/global",
      method: "PUT",
      token: admin,
      body: { type: "api", key: "sk-global-openai" },
    })
    expect(setGlobal.status).toBe(403)

    const username = uid("strict_scope")
    const password = "TpCode@123A"
    const created = await svc.createUser({
      username,
      password,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)

    const token = await login(username, password)
    const provider = await req({
      path: "/account/me/provider/openai",
      token,
    })
    expect(provider.status).toBe(200)
    const body = (await provider.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(body.configured).toBe(false)
    expect(body.source).toBe("none")
    expect(body.auth_type).toBeUndefined()

    const list = await req({
      path: "/provider",
      token,
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      connected?: string[]
    }
    expect((listBody.connected ?? []).includes("openai")).toBe(false)
  })
})
