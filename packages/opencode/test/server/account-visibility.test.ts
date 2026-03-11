import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { and, Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { TpUserProviderTable } from "../../src/user/user-provider.sql"
import { Flag } from "../../src/flag/flag"
import { AccountSystemSettingService } from "../../src/user/system-setting"

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

  test.skipIf(!on)("self-configured provider routes stay forbidden even if a role still carries provider:config_own", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const role = uid("self_provider")
    const createdRole = await svc.createRole({
      code: role,
      name: role,
      scope: "system",
      actor_user_id: "user_tp_admin",
    })
    expect(createdRole.ok).toBe(true)
    const a = uid("key_a")
    const pass = "TpCode@123A"
    const ua = await svc.createUser({
      username: a,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: [role],
      actor_user_id: "user_tp_admin",
    })
    expect(ua.ok).toBe(true)
    if (!("id" in ua) || !ua.id) throw new Error("usera_id_missing")

    const ta = await login(a, pass)
    const ra = await req({
      path: "/auth/openai",
      method: "PUT",
      token: ta,
      body: { type: "api", key: "sk-user-a" },
    })
    expect(ra.status).toBe(403)

    const ownA = await req({
      path: "/account/me/provider/openai",
      token: ta,
    })
    expect(ownA.status).toBe(200)
    const ownABody = (await ownA.json()) as {
      configured?: boolean
      source?: string
      auth_type?: string
    }
    expect(ownABody.configured).toBe(false)
    expect(ownABody.source).toBe("none")
    expect(ownABody.auth_type).toBeUndefined()
    const rowA = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, ua.id), eq(TpUserProviderTable.provider_id, "openai")))
        .get(),
    )
    expect(rowA).toBeUndefined()
  })

  test.skipIf(!on)("personal provider config is ignored while global provider config still applies", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const role = uid("self_provider_disabled")
    const createdRole = await svc.createRole({
      code: role,
      name: role,
      scope: "system",
      actor_user_id: "user_tp_admin",
    })
    expect(createdRole.ok).toBe(true)

    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const setGlobal = await req({
      path: "/account/admin/provider/openai/global",
      method: "PUT",
      token: admin,
      body: { type: "api", key: "sk-global-openai-use-own" },
    })
    expect(setGlobal.status).toBe(200)
    const setControl = await req({
      path: "/account/admin/provider-control/global",
      method: "PUT",
      token: admin,
      body: { model: "openai/gpt-4.1-mini", small_model: "openai/gpt-4.1-mini" },
    })
    expect(setControl.status).toBe(200)

    const username = uid("use_own_off")
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
    const ownKey = await req({
      path: "/auth/openrouter",
      method: "PUT",
      token,
      body: { type: "api", key: "sk-own-openrouter" },
    })
    expect(ownKey.status).toBe(403)
    const ownModel = await req({
      path: "/account/me/provider-control",
      method: "PUT",
      token,
      body: { model: "openrouter/openai/gpt-4o-mini" },
    })
    expect(ownModel.status).toBe(403)

    const openrouter = await req({
      path: "/account/me/provider/openrouter",
      token,
    })
    expect(openrouter.status).toBe(200)
    const openrouterBody = (await openrouter.json()) as {
      configured?: boolean
      source?: string
    }
    expect(openrouterBody.configured).toBe(false)
    expect(openrouterBody.source).toBe("none")

    const openai = await req({
      path: "/account/me/provider/openai",
      token,
    })
    expect(openai.status).toBe(200)
    const openaiBody = (await openai.json()) as {
      configured?: boolean
      source?: string
    }
    expect(openaiBody.configured).toBe(true)
    expect(openaiBody.source).toBe("global")

    const control = await req({
      path: "/account/me/provider-control",
      token,
    })
    expect(control.status).toBe(200)
    const controlBody = (await control.json()) as {
      model?: string
      small_model?: string
    }
    expect(controlBody.model).toBe("openai/gpt-4.1-mini")
    expect(controlBody.small_model).toBe("openai/gpt-4.1-mini")

    const list = await req({
      path: "/provider",
      token,
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      connected?: string[]
    }
    expect((listBody.connected ?? []).includes("openai")).toBe(true)
    expect((listBody.connected ?? []).includes("openrouter")).toBe(false)
  })

  test.skipIf(!on)("provider:config_user allows delegated user provider management", async () => {
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
    const allowed = await req({
      path: "/account/admin/users/user_tp_admin/providers",
      token,
    })
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
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

  test.skipIf(!on)("global provider key and control auto-apply to normal user in strict mode", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")

    const setGlobal = await req({
      path: "/account/admin/provider/openai/global",
      method: "PUT",
      token: admin,
      body: { type: "api", key: "sk-global-openai" },
    })
    expect(setGlobal.status).toBe(200)
    const setControl = await req({
      path: "/account/admin/provider-control/global",
      method: "PUT",
      token: admin,
      body: { model: "openai/gpt-4.1-mini", small_model: "openai/gpt-4.1-mini" },
    })
    expect(setControl.status).toBe(200)

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
    expect(body.configured).toBe(true)
    expect(body.source).toBe("global")
    expect(body.auth_type).toBe("api")

    const control = await req({
      path: "/account/me/provider-control",
      token,
    })
    expect(control.status).toBe(200)
    const controlBody = (await control.json()) as {
      model?: string
      small_model?: string
    }
    expect(controlBody.model).toBe("openai/gpt-4.1-mini")
    expect(controlBody.small_model).toBe("openai/gpt-4.1-mini")

    const list = await req({
      path: "/provider",
      token,
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      connected?: string[]
    }
    expect((listBody.connected ?? []).includes("openai")).toBe(true)
  })

  test.skipIf(!on)("global autoload provider stays connected for normal users in strict mode", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")
    const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")

    const setControl = await req({
      path: "/account/admin/provider-control/global",
      method: "PUT",
      token: admin,
      body: {
        enabled_providers: ["opencode"],
        disabled_providers: [],
        model: "opencode/gpt-5-nano",
        small_model: "opencode/gpt-5-nano",
      },
    })
    expect(setControl.status).toBe(200)

    const username = uid("strict_opencode")
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
    const control = await req({
      path: "/account/me/provider-control",
      token,
    })
    expect(control.status).toBe(200)
    const controlBody = (await control.json()) as {
      model?: string
      small_model?: string
    }
    expect(controlBody.model).toBe("opencode/gpt-5-nano")
    expect(controlBody.small_model).toBe("opencode/gpt-5-nano")

    const list = await req({
      path: "/provider",
      token,
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      connected?: string[]
      all?: Array<{ id?: string }>
    }
    expect((listBody.all ?? []).some((item) => item.id === "opencode")).toBe(true)
    expect((listBody.connected ?? []).includes("opencode")).toBe(true)
  })

  test.skipIf(!on)("super_admin sees the same managed provider visibility as normal user", async () => {
    const svc = mem.user
    if (!svc) throw new Error("user_service_missing")

    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      const admin = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-global-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        model: "openai/gpt-5.2-chat-latest",
        small_model: "openai/gpt-5.2-chat-latest",
        enabled_providers: ["openai"],
      })

      const username = uid("managed_scope")
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

      const normal = await login(username, password)
      const [adminProviders, userProviders, adminConfigProviders, userConfigProviders] = await Promise.all([
        req({ path: "/provider", token: admin }),
        req({ path: "/provider", token: normal }),
        req({ path: "/config/providers", token: admin }),
        req({ path: "/config/providers", token: normal }),
      ])

      expect(adminProviders.status).toBe(200)
      expect(userProviders.status).toBe(200)
      expect(adminConfigProviders.status).toBe(200)
      expect(userConfigProviders.status).toBe(200)

      const adminProviderBody = (await adminProviders.json()) as {
        all?: Array<{ id: string; models?: Record<string, unknown> }>
        connected?: string[]
      }
      const userProviderBody = (await userProviders.json()) as {
        all?: Array<{ id: string; models?: Record<string, unknown> }>
        connected?: string[]
      }
      const adminConfigBody = (await adminConfigProviders.json()) as {
        providers?: Array<{ id: string; models?: Record<string, unknown> }>
      }
      const userConfigBody = (await userConfigProviders.json()) as {
        providers?: Array<{ id: string; models?: Record<string, unknown> }>
      }

      expect(adminProviderBody).toEqual(userProviderBody)
      expect(adminConfigBody).toEqual(userConfigBody)
      expect(adminProviderBody.all?.map((item) => item.id)).toEqual(["openai"])
      expect(Object.keys(adminProviderBody.all?.[0]?.models ?? {})).toEqual(["gpt-5.2-chat-latest"])
      expect(adminProviderBody.connected).toEqual(["openai"])
      expect(adminConfigBody.providers?.map((item) => item.id)).toEqual(["openai"])
      expect(Object.keys(adminConfigBody.providers?.[0]?.models ?? {})).toEqual(["gpt-5.2-chat-latest"])
    } finally {
      await AccountSystemSettingService.setProviderControl(control)
      for (const providerID of Object.keys(await AccountSystemSettingService.providerAuths())) {
        if (auths[providerID]) continue
        await AccountSystemSettingService.removeProviderAuth(providerID)
      }
      for (const [providerID, auth] of Object.entries(auths)) {
        await AccountSystemSettingService.setProviderAuth(providerID, auth)
      }
      for (const providerID of Object.keys(await AccountSystemSettingService.providerConfigs())) {
        if (configs[providerID]) continue
        await AccountSystemSettingService.removeProviderConfig(providerID)
      }
      for (const [providerID, config] of Object.entries(configs)) {
        await AccountSystemSettingService.setProviderConfig(providerID, config)
      }
    }
  })
})
