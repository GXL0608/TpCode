import z from "zod"
import { Database, eq } from "@/storage/db"
import { TpSystemProviderSettingTable } from "@/user/system-provider-setting.sql"

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

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    return systemAll()
  }

  export async function userAll() {
    return {} as Record<string, Info>
  }

  export async function userAllByID(_uid: string) {
    return {} as Record<string, Info>
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

  export async function setUser(_user_id: string, _key: string, _info: Info, _source: "self" | "admin" = "self") {
    throw new Error("account_user_provider_config_disabled")
  }

  export async function removeUser(_user_id: string, _key: string, _source: "self" | "admin" = "self") {
    throw new Error("account_user_provider_config_disabled")
  }

  export async function purgeUser(_user_id: string, _key: string) {
    throw new Error("account_user_provider_config_disabled")
  }

  export async function set(_key: string, _info: Info) {
    throw new Error("account_user_provider_config_disabled")
  }

  export async function remove(_key: string) {
    throw new Error("account_user_provider_config_disabled")
  }
}
