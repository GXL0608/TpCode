import { beforeAll, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { TpSystemProviderSettingTable } from "../../src/user/system-provider-setting.sql"
import { AccountSystemSettingService } from "../../src/user/system-setting"
import { TpUserProviderSettingTable } from "../../src/user/user-provider-setting.sql"
import { AccountUserProviderSettingService } from "../../src/user/user-provider-setting"

const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED

const state = {
  user: undefined as Awaited<typeof import("../../src/user/service")>["UserService"] | undefined,
}

/** 中文注释：生成隔离测试账号名，避免与库中的既有用户冲突。 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

beforeAll(async () => {
  if (!accountEnabled) return
  const { UserService } = await import("../../src/user/service")
  await UserService.ensureSeed()
  state.user = UserService
})

describe("provider setting soft delete", () => {
  test.skipIf(!accountEnabled)("system provider deletion keeps tombstones and hides deleted entries from reads", async () => {
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-soft-delete-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
        },
      })

      await AccountSystemSettingService.removeProviderConfig("openai")
      expect(await AccountSystemSettingService.providerConfig("openai")).toBeUndefined()

      let row = await Database.use((db) =>
        db.select().from(TpSystemProviderSettingTable).where(eq(TpSystemProviderSettingTable.id, "global")).get(),
      )
      expect(row?.provider_configs_json?.["openai"]).toBeUndefined()
      expect(row?.provider_config_deleted_json?.["openai"]).toBeDefined()
      expect(row?.provider_config_deleted_json?.["openai"]?.time_deleted).toBeNumber()

      await AccountSystemSettingService.removeProvider("openai")
      expect(await AccountSystemSettingService.providerAuth("openai")).toBeUndefined()
      expect(await AccountSystemSettingService.providerConfig("openai")).toBeUndefined()
      expect((await AccountSystemSettingService.providerRows())["openai"]).toBeUndefined()

      row = await Database.use((db) =>
        db.select().from(TpSystemProviderSettingTable).where(eq(TpSystemProviderSettingTable.id, "global")).get(),
      )
      expect(row?.provider_auth_json?.["openai"]).toBeUndefined()
      expect(row?.provider_auth_deleted_json?.["openai"]).toBeDefined()
      expect(row?.provider_deleted_json?.["openai"]).toBeNumber()
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

  test.skipIf(!accountEnabled)("user provider deletion keeps tombstones and hides deleted entries from reads", async () => {
    const user = state.user
    if (!user) throw new Error("user_service_missing")
    const username = uid("provider_soft_delete")
    const password = "TpCode@123A"
    const created = await user.createUser({
      username,
      password,
      display_name: "Provider Soft Delete",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["super_admin"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    if (!("id" in created) || !created.id) throw new Error("user_id_missing")
    const user_id = created.id

    try {
      await AccountUserProviderSettingService.setProviderAuth(user_id, "openrouter", {
        type: "api",
        key: "sk-user-openrouter",
      })
      await AccountUserProviderSettingService.setProviderConfig(user_id, "openrouter", {
        models: {
          "openai/gpt-4o-mini": {},
        },
      })

      await AccountUserProviderSettingService.removeProviderAuth(user_id, "openrouter")
      expect(await AccountUserProviderSettingService.providerAuth(user_id, "openrouter")).toBeUndefined()

      let row = await Database.use((db) =>
        db.select().from(TpUserProviderSettingTable).where(eq(TpUserProviderSettingTable.user_id, user_id)).get(),
      )
      expect(row?.provider_auth_cipher).toBeFalsy()
      expect(row?.provider_auth_deleted_json?.["openrouter"]).toBeDefined()
      expect(row?.provider_auth_deleted_json?.["openrouter"]?.time_deleted).toBeNumber()

      await AccountUserProviderSettingService.removeProvider(user_id, "openrouter")
      expect(await AccountUserProviderSettingService.providerConfig(user_id, "openrouter")).toBeUndefined()
      expect((await AccountUserProviderSettingService.providerRows(user_id))["openrouter"]).toBeUndefined()

      row = await Database.use((db) =>
        db.select().from(TpUserProviderSettingTable).where(eq(TpUserProviderSettingTable.user_id, user_id)).get(),
      )
      expect(row?.provider_configs_json?.["openrouter"]).toBeUndefined()
      expect(row?.provider_config_deleted_json?.["openrouter"]).toBeDefined()
      expect(row?.provider_deleted_json?.["openrouter"]).toBeNumber()
    } finally {
      const cleanup = await user.deleteUser({
        user_id,
        actor_user_id: "user_tp_admin",
      })
      expect(cleanup.ok).toBe(true)
    }
  })
})
