import { beforeAll, expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Database, eq } from "../../src/storage/db"
import { UserService } from "../../src/user/service"
import { TpUserProviderSettingTable } from "../../src/user/user-provider-setting.sql"
import { UserCipher } from "../../src/user/cipher"

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

beforeAll(async () => {
  await UserService.ensureSeed()
})

test("Auth.userAllByID reads encrypted and plaintext provider_auth_cipher", async () => {
  const now = Date.now()
  const encryptedProvider = uid("cipher")
  const plainProvider = uid("plain")

  await Database.use((db) =>
    db
      .insert(TpUserProviderSettingTable)
      .values({
        user_id: "user_tp_admin",
        provider_auth_cipher: UserCipher.encrypt(
          JSON.stringify({
            [encryptedProvider]: { type: "api", key: "sk-cipher" },
            [plainProvider]: { type: "api", key: "sk-plain" },
          }),
        ),
        provider_control_json: {},
        provider_configs_json: {},
        time_created: now,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: TpUserProviderSettingTable.user_id,
        set: {
          provider_auth_cipher: UserCipher.encrypt(
            JSON.stringify({
              [encryptedProvider]: { type: "api", key: "sk-cipher" },
              [plainProvider]: { type: "api", key: "sk-plain" },
            }),
          ),
          provider_control_json: {},
          provider_configs_json: {},
          time_updated: now,
        },
      })
      .run(),
  )

  try {
    const all = await Auth.userAllByID("user_tp_admin")
    expect(all[encryptedProvider]).toMatchObject({ type: "api", key: "sk-cipher" })
    expect(all[plainProvider]).toMatchObject({ type: "api", key: "sk-plain" })

    await Database.use((db) =>
      db
        .update(TpUserProviderSettingTable)
        .set({
          provider_auth_cipher: JSON.stringify({
            [encryptedProvider]: { type: "api", key: "sk-cipher" },
            [plainProvider]: { type: "api", key: "sk-plain" },
          }),
          time_updated: Date.now(),
        })
        .where(eq(TpUserProviderSettingTable.user_id, "user_tp_admin"))
        .run(),
    )

    const plain = await Auth.userAllByID("user_tp_admin")
    expect(plain[encryptedProvider]).toMatchObject({ type: "api", key: "sk-cipher" })
    expect(plain[plainProvider]).toMatchObject({ type: "api", key: "sk-plain" })
  } finally {
    await Database.use((db) =>
      db
        .delete(TpUserProviderSettingTable)
        .where(eq(TpUserProviderSettingTable.user_id, "user_tp_admin"))
        .run(),
    )
  }
})

test("Auth.setUser stores provider_auth_cipher as encrypted json", async () => {
  const providerID = uid("save")
  await Auth.setUser("user_tp_admin", providerID, { type: "api", key: "sk-write-encrypted" })
  try {
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderSettingTable)
        .where(eq(TpUserProviderSettingTable.user_id, "user_tp_admin"))
        .get(),
    )
    expect(!!row).toBe(true)
    expect(row?.provider_auth_cipher?.startsWith("{")).toBe(false)
    const decoded = UserCipher.decrypt(row?.provider_auth_cipher ?? "")
    expect(!!decoded).toBe(true)
    expect((JSON.parse(decoded ?? "{}") as Record<string, { key?: string }>)[providerID]?.key).toBe("sk-write-encrypted")
  } finally {
    await Database.use((db) =>
      db
        .delete(TpUserProviderSettingTable)
        .where(eq(TpUserProviderSettingTable.user_id, "user_tp_admin"))
        .run(),
    )
  }
})
