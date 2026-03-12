import z from "zod"
import { Database, eq } from "@/storage/db"
import { TpSystemProviderSettingTable } from "@/user/system-provider-setting.sql"
import { AccountCurrent } from "@/user/current"
import { Flag } from "@/flag/flag"
import { TpUserProviderSettingTable } from "@/user/user-provider-setting.sql"
import { UserCipher } from "@/user/cipher"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"
export const ACCOUNT_META_DUMMY_KEY = "__tpcode_meta__"

const GLOBAL_PROVIDER_SETTING_ID = "global"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  function parseMap(input: unknown): Record<string, Info> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {}
    return Object.entries(input).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  async function systemAll(): Promise<Record<string, Info>> {
    const row = await Database.use((db) =>
      db
        .select({
          provider_auth_json: TpSystemProviderSettingTable.provider_auth_json,
        })
        .from(TpSystemProviderSettingTable)
        .where(eq(TpSystemProviderSettingTable.id, GLOBAL_PROVIDER_SETTING_ID))
        .get(),
    )
    return parseMap(row?.provider_auth_json)
  }

  async function writeSystemAll(input: Record<string, Info>) {
    await Database.use((db) =>
      db
        .insert(TpSystemProviderSettingTable)
        .values({
          id: GLOBAL_PROVIDER_SETTING_ID,
          provider_auth_json: Object.keys(input).length > 0 ? input : null,
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: TpSystemProviderSettingTable.id,
          set: {
            provider_auth_json: Object.keys(input).length > 0 ? input : null,
            time_updated: Date.now(),
          },
        })
        .run(),
    )
  }

  /** 中文注释：读取指定用户的个人认证映射。 */
  async function readUserAll(user_id: string): Promise<Record<string, Info>> {
    const row = await Database.use((db) =>
      db
        .select({
          provider_auth_cipher: TpUserProviderSettingTable.provider_auth_cipher,
        })
        .from(TpUserProviderSettingTable)
        .where(eq(TpUserProviderSettingTable.user_id, user_id))
        .get(),
    )
    const decoded = row?.provider_auth_cipher ? UserCipher.decode(row.provider_auth_cipher) : undefined
    if (!decoded?.raw) return {} as Record<string, Info>
    return parseMap(JSON.parse(decoded.raw))
  }

  /** 中文注释：写回指定用户的个人认证映射。 */
  async function writeUserAll(user_id: string, input: Record<string, Info>) {
    await Database.use((db) =>
      db
        .insert(TpUserProviderSettingTable)
        .values({
          user_id,
          provider_auth_cipher: Object.keys(input).length > 0 ? UserCipher.encrypt(JSON.stringify(input)) : null,
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: TpUserProviderSettingTable.user_id,
          set: {
            provider_auth_cipher: Object.keys(input).length > 0 ? UserCipher.encrypt(JSON.stringify(input)) : null,
            time_updated: Date.now(),
          },
        })
        .run(),
    )
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    if (Flag.TPCODE_ACCOUNT_ENABLED) {
      const current = AccountCurrent.optional()
      if (!current?.user_id) return systemAll()
      return {
        ...(await systemAll()),
        ...(await readUserAll(current.user_id)),
      }
    }
    return systemAll()
  }

  export async function userAll() {
    const current = AccountCurrent.optional()
    if (!current?.user_id) return {} as Record<string, Info>
    return userAllByID(current.user_id)
  }

  export async function userAllByID(uid: string) {
    return readUserAll(uid)
  }

  export async function sharedAll() {
    return systemAll()
  }

  export async function setGlobal(key: string, info: Info) {
    const current = await systemAll()
    await writeSystemAll({
      ...current,
      [key]: info,
    })
  }

  export async function removeGlobal(key: string) {
    const current = await systemAll()
    const next = { ...current }
    delete next[key]
    await writeSystemAll(next)
  }

  export async function setUser(user_id: string, key: string, info: Info, _source: "self" | "admin" = "self") {
    const current = await readUserAll(user_id)
    await writeUserAll(user_id, {
      ...current,
      [key]: info,
    })
  }

  export async function removeUser(user_id: string, key: string, _source: "self" | "admin" = "self") {
    const current = await readUserAll(user_id)
    const next = { ...current }
    delete next[key]
    await writeUserAll(user_id, next)
  }

  export async function purgeUser(user_id: string, key: string) {
    await removeUser(user_id, key)
  }

  export async function set(_key: string, _info: Info) {
    throw new Error("account_user_provider_config_disabled")
  }

  export async function remove(_key: string) {
    throw new Error("account_user_provider_config_disabled")
  }
}
