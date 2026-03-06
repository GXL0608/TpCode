import z from "zod"
import { and, Database, eq } from "@/storage/db"
import { TpUserProviderTable } from "@/user/user-provider.sql"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { UserCipher } from "@/user/cipher"
import { Log } from "@/util/log"

const log = Log.create({ service: "user-provider-config" })

export const USER_PROVIDER_CONTROL_ID = "__tpcode_user_config__"
export const USER_PROVIDER_DUMMY_KEY = "__tpcode_meta__"

const ModelPrefs = z
  .object({
    visibility: z.record(z.string(), z.enum(["show", "hide"])).optional(),
    favorite: z.array(z.string()).optional(),
    recent: z.array(z.string()).optional(),
    variant: z.record(z.string(), z.string()).optional(),
  })
  .catchall(z.any())

const Control = z
  .object({
    enabled_providers: z.array(z.string()).optional(),
    disabled_providers: z.array(z.string()).optional(),
    model: z.string().optional(),
    small_model: z.string().optional(),
    model_prefs: ModelPrefs.optional(),
  })
  .catchall(z.any())

const ProviderMeta = z
  .object({
    provider_config: Config.Provider.optional(),
    flags: z
      .object({
        disabled: z.boolean().optional(),
      })
      .optional(),
  })
  .catchall(z.any())

export namespace UserProviderConfig {
  export type ModelPrefs = z.output<typeof ModelPrefs>
  export type Control = z.output<typeof Control>
  export type ProviderMeta = z.output<typeof ProviderMeta>

  export type ProviderState = {
    auth?: Auth.Info
    meta: ProviderMeta
    raw: Record<string, unknown>
  }

  export type State = {
    control: Control
    providers: Record<string, ProviderState>
  }

  function obj(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {}
    return input as Record<string, unknown>
  }

  function parse(input: string) {
    try {
      return JSON.parse(input) as unknown
    } catch {
      return
    }
  }

  function fromAuth(raw: string, user_id: string, provider_id: string) {
    const resolved = UserCipher.decode(raw)
    if (!resolved) {
      log.warn("provider auth decode failed", { user_id, provider_id })
      return
    }
    const value = parse(resolved.raw)
    if (value === undefined) {
      log.warn("provider auth parse failed", { user_id, provider_id })
      return
    }
    const parsed = Auth.Info.safeParse(value)
    if (!parsed.success) {
      log.warn("provider auth invalid", { user_id, provider_id })
      return
    }
    if (parsed.data.type === "api" && parsed.data.key === USER_PROVIDER_DUMMY_KEY) return
    return parsed.data
  }

  function fromControl(raw: Record<string, unknown>) {
    const parsed = Control.safeParse(raw)
    if (parsed.success) return parsed.data
    return {} as Control
  }

  function fromProviderMeta(raw: Record<string, unknown>) {
    const parsed = ProviderMeta.safeParse(raw)
    if (parsed.success) return parsed.data
    return {} as ProviderMeta
  }

  async function rows(user_id: string) {
    return Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, user_id), eq(TpUserProviderTable.is_active, true)))
        .all(),
    )
  }

  async function row(user_id: string, provider_id: string) {
    return Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(
          and(
            eq(TpUserProviderTable.user_id, user_id),
            eq(TpUserProviderTable.provider_id, provider_id),
            eq(TpUserProviderTable.is_active, true),
          ),
        )
        .get(),
    )
  }

  async function writeMeta(user_id: string, provider_id: string, next: Record<string, unknown>) {
    const dummy = JSON.stringify({ type: "api", key: USER_PROVIDER_DUMMY_KEY })
    return Database.use((db) =>
      db
        .insert(TpUserProviderTable)
        .values({
          id: crypto.randomUUID(),
          user_id,
          provider_id,
          auth_type: "api",
          secret_cipher: dummy,
          meta_json: next,
          is_active: true,
        })
        .onConflictDoUpdate({
          target: [TpUserProviderTable.user_id, TpUserProviderTable.provider_id],
          set: {
            meta_json: next,
            is_active: true,
            time_updated: Date.now(),
          },
        })
        .run(),
    )
  }

  async function patchMeta(user_id: string, provider_id: string, fn: (current: Record<string, unknown>) => Record<string, unknown>) {
    const current = await row(user_id, provider_id)
    const base = obj(current?.meta_json)
    const next = fn(base)
    await writeMeta(user_id, provider_id, next)
    return next
  }

  export async function state(user_id: string): Promise<State> {
    const result = await rows(user_id)
    const control = {} as Control
    const providers = {} as Record<string, ProviderState>

    for (const item of result) {
      const raw = obj(item.meta_json)
      if (item.provider_id === USER_PROVIDER_CONTROL_ID) {
        Object.assign(control, fromControl(raw))
        continue
      }
      providers[item.provider_id] = {
        auth: fromAuth(item.secret_cipher, user_id, item.provider_id),
        meta: fromProviderMeta(raw),
        raw,
      }
    }

    return {
      control,
      providers,
    }
  }

  export async function getProviderConfig(user_id: string, provider_id: string) {
    return state(user_id).then((x) => x.providers[provider_id]?.meta.provider_config)
  }

  export async function setProviderConfig(user_id: string, provider_id: string, config: unknown) {
    const parsed = Config.Provider.parse(config)
    return patchMeta(user_id, provider_id, (current) => ({
      ...current,
      provider_config: parsed,
    }))
  }

  export async function removeProviderConfig(user_id: string, provider_id: string) {
    return patchMeta(user_id, provider_id, (current) => {
      const next = { ...current }
      delete next.provider_config
      return next
    })
  }

  export async function setProviderDisabled(user_id: string, provider_id: string, disabled: boolean) {
    return patchMeta(user_id, provider_id, (current) => ({
      ...current,
      flags: {
        ...obj(current.flags),
        disabled,
      },
    }))
  }

  export async function getUserControl(user_id: string) {
    return state(user_id).then((x) => x.control)
  }

  export async function setUserControl(user_id: string, control: unknown) {
    const parsed = Control.parse(control)
    return patchMeta(user_id, USER_PROVIDER_CONTROL_ID, (current) => ({
      ...current,
      ...parsed,
    }))
  }

  export async function getModelPrefs(user_id: string) {
    return getUserControl(user_id).then((x) => x.model_prefs ?? ({} as ModelPrefs))
  }

  export async function setModelPrefs(user_id: string, prefs: unknown) {
    const parsed = ModelPrefs.parse(prefs)
    return patchMeta(user_id, USER_PROVIDER_CONTROL_ID, (current) => ({
      ...current,
      model_prefs: parsed,
    }))
  }

  export async function removeProvider(user_id: string, provider_id: string) {
    if (provider_id === USER_PROVIDER_CONTROL_ID) return
    await Database.use((db) =>
      db
        .delete(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, user_id), eq(TpUserProviderTable.provider_id, provider_id)))
        .run(),
    )
  }
}
