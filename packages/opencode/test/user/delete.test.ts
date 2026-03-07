import { beforeAll, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"

const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED

const state = {
  user: undefined as Awaited<typeof import("../../src/user/service")>["UserService"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function login(username: string, password: string) {
  const user = state.user
  if (!user) throw new Error("user_service_missing")
  const result = await user.login({ username, password })
  expect(result.ok).toBe(true)
  if (!("access_token" in result) || !result.access_token) throw new Error("access_token_missing")
  return result.access_token
}

beforeAll(async () => {
  if (!accountEnabled) return
  const { UserService } = await import("../../src/user/service")
  await UserService.ensureSeed()
  state.user = UserService
})

describe("account delete", () => {
  test.skipIf(!accountEnabled)("deleting a user revokes cached authorization immediately", async () => {
    const user = state.user
    if (!user) throw new Error("user_service_missing")
    const username = uid("delete_user")
    const password = "TpCode@123A"
    const created = await user.createUser({
      username,
      password,
      display_name: "Delete User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const token = await login(username, password)
    const warm = await user.authorize(token)
    expect(warm?.username).toBe(username)

    const deleted = await user.deleteUser({
      user_id: created.id,
      actor_user_id: "user_tp_admin",
    })
    expect(deleted.ok).toBe(true)

    const denied = await user.authorize(token)
    expect(denied).toBeUndefined()
  })

  test.skipIf(!accountEnabled)("cannot delete current user", async () => {
    const user = state.user
    if (!user) throw new Error("user_service_missing")
    const username = uid("self_delete")
    const password = "TpCode@123A"
    const created = await user.createUser({
      username,
      password,
      display_name: "Self Delete",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")

    const blocked = await user.deleteUser({
      user_id: created.id,
      actor_user_id: created.id,
    })
    expect(blocked).toEqual({ ok: false, code: "user_self_delete_forbidden" })

    const cleanup = await user.deleteUser({
      user_id: created.id,
      actor_user_id: "user_tp_admin",
    })
    expect(cleanup.ok).toBe(true)
  })

  test.skipIf(!accountEnabled)("deleting a custom role invalidates cached permissions immediately", async () => {
    const user = state.user
    if (!user) throw new Error("user_service_missing")
    const roleCode = uid("role_delete")
    const createdRole = await user.createRole({
      code: roleCode,
      name: "Delete Role",
      actor_user_id: "user_tp_admin",
    })
    expect(createdRole.ok).toBe(true)

    const username = uid("role_delete_user")
    const password = "TpCode@123A"
    const createdUser = await user.createUser({
      username,
      password,
      display_name: "Role Delete User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: [roleCode],
      actor_user_id: "user_tp_admin",
    })
    expect(createdUser.ok).toBe(true)

    const token = await login(username, password)
    const warm = await user.authorize(token)
    expect(warm?.roles).toContain(roleCode)
    expect(warm?.permissions).toContain("session:create")

    const deleted = await user.deleteRole({
      role_code: roleCode,
      actor_user_id: "user_tp_admin",
    })
    expect(deleted.ok).toBe(true)

    const refreshed = await user.authorize(token)
    expect(refreshed?.roles).not.toContain(roleCode)
    expect(refreshed?.permissions).not.toContain("session:create")

    if ("id" in createdUser && createdUser.id) {
      const cleanup = await user.deleteUser({
        user_id: createdUser.id,
        actor_user_id: "user_tp_admin",
      })
      expect(cleanup.ok).toBe(true)
    }
  })

  test.skipIf(!accountEnabled)("built-in roles cannot be deleted", async () => {
    const user = state.user
    if (!user) throw new Error("user_service_missing")
    const blocked = await user.deleteRole({
      role_code: "developer",
      actor_user_id: "user_tp_admin",
    })
    expect(blocked).toEqual({ ok: false, code: "role_builtin_forbidden" })
  })
})
