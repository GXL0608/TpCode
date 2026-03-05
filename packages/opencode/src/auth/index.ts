import path from "path"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { Flag } from "@/flag/flag"
import { AccountCurrent } from "@/user/current"
import { Database, and, eq } from "@/storage/db"
import { TpUserProviderTable } from "@/user/user-provider.sql"
import { UserCipher } from "@/user/cipher"
import { Log } from "@/util/log"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"
export const ACCOUNT_META_DUMMY_KEY = "__tpcode_meta__"
const log = Log.create({ service: "auth" })

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

  const filepath = path.join(Global.Path.data, "auth.json")

  function userID() {
    if (!Flag.TPCODE_ACCOUNT_ENABLED) return
    return AccountCurrent.optional()?.user_id
  }

  function parseJson(raw: string) {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return
    }
  }

  async function globalAll(): Promise<Record<string, Info>> {
    const data = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  async function fromDb(uid: string): Promise<Record<string, Info>> {
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, uid), eq(TpUserProviderTable.is_active, true)))
        .all(),
    )
    const fixed = [] as { id: string; auth: Info }[]
    const result = rows.reduce(
      (acc, row) => {
        const resolved = UserCipher.decode(row.secret_cipher)
        if (!resolved) {
          log.warn("user provider auth decode failed", {
            user_id: uid,
            provider_id: row.provider_id,
          })
          return acc
        }
        const json = parseJson(resolved.raw)
        if (json === undefined) {
          log.warn("user provider auth parse failed", {
            user_id: uid,
            provider_id: row.provider_id,
          })
          return acc
        }
        const parsed = Info.safeParse(json)
        if (!parsed.success) {
          log.warn("user provider auth invalid", {
            user_id: uid,
            provider_id: row.provider_id,
          })
          return acc
        }
        if (parsed.data.type === "api" && parsed.data.key === ACCOUNT_META_DUMMY_KEY) return acc
        if (resolved.encrypted) fixed.push({ id: row.id, auth: parsed.data })
        acc[row.provider_id] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
    if (fixed.length > 0) {
      void Database.use((db) =>
        Promise.all(
          fixed.map((item) =>
            db
              .update(TpUserProviderTable)
              .set({
                auth_type: item.auth.type,
                secret_cipher: JSON.stringify(item.auth),
                time_updated: Date.now(),
              })
              .where(eq(TpUserProviderTable.id, item.id))
              .run(),
          ),
        ),
      ).catch((error) =>
        log.warn("user provider auth decode fallback write failed", {
          user_id: uid,
          count: fixed.length,
          error,
        }),
      )
    }
    return result
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const uid = userID()
    if (Flag.TPCODE_ACCOUNT_ENABLED) {
      if (!uid) return {}
      return fromDb(uid)
    }
    if (!uid) return globalAll()
    return fromDb(uid)
  }

  export async function userAll() {
    const uid = userID()
    if (!uid) return {} as Record<string, Info>
    return fromDb(uid)
  }

  export async function userAllByID(uid: string) {
    return fromDb(uid)
  }

  export async function sharedAll() {
    return globalAll()
  }

  export async function setGlobal(key: string, info: Info) {
    const data = await globalAll()
    await Filesystem.writeJson(filepath, { ...data, [key]: info }, 0o600)
  }

  export async function removeGlobal(key: string) {
    const data = await globalAll()
    delete data[key]
    await Filesystem.writeJson(filepath, data, 0o600)
  }

  export async function setUser(user_id: string, key: string, info: Info) {
    const secret = JSON.stringify(info)
    await Database.use(async (db) => {
      await db
        .insert(TpUserProviderTable)
        .values({
          id: crypto.randomUUID(),
          user_id,
          provider_id: key,
          auth_type: info.type,
          secret_cipher: secret,
          is_active: true,
        })
        .onConflictDoUpdate({
          target: [TpUserProviderTable.user_id, TpUserProviderTable.provider_id],
          set: {
            auth_type: info.type,
            secret_cipher: secret,
            is_active: true,
            time_updated: Date.now(),
          },
        })
        .run()
    })
  }

  export async function removeUser(user_id: string, key: string) {
    const secret = JSON.stringify({ type: "api", key: ACCOUNT_META_DUMMY_KEY } satisfies Info)
    await Database.use(async (db) => {
      await db
        .insert(TpUserProviderTable)
        .values({
          id: crypto.randomUUID(),
          user_id,
          provider_id: key,
          auth_type: "api",
          secret_cipher: secret,
          is_active: true,
        })
        .onConflictDoUpdate({
          target: [TpUserProviderTable.user_id, TpUserProviderTable.provider_id],
          set: {
            auth_type: "api",
            secret_cipher: secret,
            is_active: true,
            time_updated: Date.now(),
          },
        })
        .run()
    })
  }

  export async function purgeUser(user_id: string, key: string) {
    await Database.use(async (db) => {
      await db
        .delete(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, user_id), eq(TpUserProviderTable.provider_id, key)))
        .run()
    })
  }

  export async function set(key: string, info: Info) {
    const uid = userID()
    if (Flag.TPCODE_ACCOUNT_ENABLED) {
      if (!uid) throw new Error("account_user_missing")
      await setUser(uid, key, info)
      return
    }
    await setGlobal(key, info)
  }

  export async function remove(key: string) {
    const uid = userID()
    if (Flag.TPCODE_ACCOUNT_ENABLED) {
      if (!uid) throw new Error("account_user_missing")
      await removeUser(uid, key)
      return
    }
    await removeGlobal(key)
  }
}
