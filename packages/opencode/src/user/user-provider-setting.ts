import z from "zod"
import { Database, eq } from "@/storage/db"
import { TpUserProviderSettingTable } from "./user-provider-setting.sql"
import { Config } from "@/config/config"
import { ModelsDev } from "@/provider/models"
import { UserCipher } from "./cipher"
import { Flag } from "@/flag/flag"

const UserProviderControl = z.object({
  enabled_providers: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
})

const OauthAuth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  accountId: z.string().optional(),
  enterpriseUrl: z.string().optional(),
})

const ApiAuth = z.object({
  type: z.literal("api"),
  key: z.string(),
})

const WellKnownAuth = z.object({
  type: z.literal("wellknown"),
  key: z.string(),
  token: z.string(),
})

const ProviderAuth = z.discriminatedUnion("type", [OauthAuth, ApiAuth, WellKnownAuth])
const ProviderAuthMap = z.record(z.string(), ProviderAuth)
const ProviderConfigMap = z.record(z.string(), Config.Provider)

type ProviderConfig = z.output<typeof Config.Provider>
type ProviderModelConfig = NonNullable<ProviderConfig["models"]>[string]

/** 中文注释：读取用户级模型配置原始记录。 */
async function row(user_id: string) {
  return Database.use((db) =>
    db
      .select()
      .from(TpUserProviderSettingTable)
      .where(eq(TpUserProviderSettingTable.user_id, user_id))
      .get(),
  )
}

/** 中文注释：统一写入用户级模型配置记录。 */
async function write(input: {
  user_id: string
  provider_auth_cipher?: string
  provider_control_json?: z.output<typeof UserProviderControl>
  provider_configs_json?: z.output<typeof ProviderConfigMap>
}) {
  await Database.use((db) =>
    db
      .insert(TpUserProviderSettingTable)
      .values({
        user_id: input.user_id,
        provider_auth_cipher: input.provider_auth_cipher ?? null,
        provider_control_json: input.provider_control_json ?? null,
        provider_configs_json: input.provider_configs_json ?? null,
        time_updated: Date.now(),
      })
      .onConflictDoUpdate({
        target: TpUserProviderSettingTable.user_id,
        set: {
          provider_auth_cipher: input.provider_auth_cipher ?? null,
          provider_control_json: input.provider_control_json ?? null,
          provider_configs_json: input.provider_configs_json ?? null,
          time_updated: Date.now(),
        },
      })
      .run(),
  )
}

/** 中文注释：从加密列中解析用户认证映射。 */
function readAuths(value?: string | null) {
  if (!value?.trim()) return {} as z.output<typeof ProviderAuthMap>
  const decoded = UserCipher.decode(value)
  if (!decoded?.raw) return {} as z.output<typeof ProviderAuthMap>
  const parsed = ProviderAuthMap.safeParse(JSON.parse(decoded.raw))
  if (parsed.success) return parsed.data
  return {} as z.output<typeof ProviderAuthMap>
}

/** 中文注释：解析用户级控制项。 */
function readControl(value: unknown) {
  const parsed = UserProviderControl.safeParse(value)
  if (parsed.success) return parsed.data
  return {} as z.output<typeof UserProviderControl>
}

/** 中文注释：解析用户级 provider 配置映射。 */
function readConfigs(value: unknown) {
  const parsed = ProviderConfigMap.safeParse(value)
  if (parsed.success) return parsed.data
  return {} as z.output<typeof ProviderConfigMap>
}

/** 中文注释：对模型引用字符串做 provider/model 解析。 */
function parseModel(value?: string) {
  if (!value?.trim()) return
  const [provider_id, ...rest] = value.trim().split("/")
  if (!provider_id || rest.length === 0) return
  return {
    provider_id,
    model_id: rest.join("/"),
  }
}

/** 中文注释：生成用户配置中出现过的 provider 列表。 */
function ids(input: {
  auth?: Record<string, z.output<typeof ProviderAuth>>
  config?: Record<string, ProviderConfig>
}) {
  return [...new Set([...Object.keys(input.auth ?? {}), ...Object.keys(input.config ?? {})])].sort()
}

/** 中文注释：推导 provider 展示名称。 */
function providerName(input: { provider_id: string; base?: ModelsDev.Provider; config?: ProviderConfig }) {
  return input.config?.name ?? input.base?.name ?? input.provider_id
}

/** 中文注释：推导模型展示名称。 */
function modelName(input: {
  model_id: string
  base?: ModelsDev.Model
  config?: ProviderModelConfig
}) {
  if (input.config?.name) return input.config.name
  if (input.config?.id && input.config.id !== input.model_id) return input.model_id
  return input.base?.name ?? input.model_id
}

/** 中文注释：判断模型是否允许进入目录。 */
function allowed(input: {
  model_id: string
  base?: ModelsDev.Model
  config?: ProviderConfig
  patch?: ProviderModelConfig
}) {
  const status = input.patch?.status ?? input.base?.status
  if (status === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) return false
  if (status === "deprecated") return false
  if (input.config?.blacklist?.includes(input.model_id)) return false
  if (input.config?.whitelist && !input.config.whitelist.includes(input.model_id)) return false
  return true
}

export namespace AccountUserProviderSettingService {
  export type ProviderControl = z.output<typeof UserProviderControl>
  export type ProviderAuth = z.output<typeof ProviderAuth>

  export type ProviderRow = {
    type?: z.output<typeof ProviderAuth>["type"]
    has_auth: boolean
    has_config: boolean
  }

  export type CatalogProvider = {
    provider_id: string
    provider_name: string
    models: Array<{
      model_id: string
      model_name: string
    }>
  }

  /** 中文注释：读取用户级控制项。 */
  export async function providerControl(user_id: string) {
    return readControl((await row(user_id))?.provider_control_json)
  }

  /** 中文注释：写入用户级控制项。 */
  export async function setProviderControl(user_id: string, input: unknown) {
    const parsed = UserProviderControl.parse(input)
    const current = await row(user_id)
    await write({
      user_id,
      provider_auth_cipher: current?.provider_auth_cipher ?? undefined,
      provider_control_json: Object.keys(parsed).length > 0 ? parsed : undefined,
      provider_configs_json: readConfigs(current?.provider_configs_json),
    })
    return parsed
  }

  /** 中文注释：读取用户级 provider 认证映射。 */
  export async function providerAuths(user_id: string) {
    return readAuths((await row(user_id))?.provider_auth_cipher)
  }

  /** 中文注释：读取指定用户 provider 认证。 */
  export async function providerAuth(user_id: string, provider_id: string) {
    return providerAuths(user_id).then((items) => items[provider_id])
  }

  /** 中文注释：写入指定用户 provider 认证。 */
  export async function setProviderAuth(user_id: string, provider_id: string, input: unknown) {
    const parsed = ProviderAuth.parse(input)
    const current = await row(user_id)
    const next = {
      ...readAuths(current?.provider_auth_cipher),
      [provider_id]: parsed,
    }
    await write({
      user_id,
      provider_auth_cipher: UserCipher.encrypt(JSON.stringify(next)),
      provider_control_json: readControl(current?.provider_control_json),
      provider_configs_json: readConfigs(current?.provider_configs_json),
    })
    return parsed
  }

  /** 中文注释：删除指定用户 provider 认证。 */
  export async function removeProviderAuth(user_id: string, provider_id: string) {
    const current = await row(user_id)
    const next = { ...readAuths(current?.provider_auth_cipher) }
    delete next[provider_id]
    await write({
      user_id,
      provider_auth_cipher: Object.keys(next).length > 0 ? UserCipher.encrypt(JSON.stringify(next)) : undefined,
      provider_control_json: readControl(current?.provider_control_json),
      provider_configs_json: readConfigs(current?.provider_configs_json),
    })
  }

  /** 中文注释：读取用户级 provider 配置映射。 */
  export async function providerConfigs(user_id: string) {
    return readConfigs((await row(user_id))?.provider_configs_json)
  }

  /** 中文注释：读取指定用户 provider 配置。 */
  export async function providerConfig(user_id: string, provider_id: string) {
    return providerConfigs(user_id).then((items) => items[provider_id])
  }

  /** 中文注释：写入指定用户 provider 配置。 */
  export async function setProviderConfig(user_id: string, provider_id: string, input: unknown) {
    const parsed = Config.Provider.parse(input)
    const current = await row(user_id)
    const next = {
      ...readConfigs(current?.provider_configs_json),
      [provider_id]: parsed,
    }
    await write({
      user_id,
      provider_auth_cipher: current?.provider_auth_cipher ?? undefined,
      provider_control_json: readControl(current?.provider_control_json),
      provider_configs_json: next,
    })
    return parsed
  }

  /** 中文注释：删除指定用户 provider 配置。 */
  export async function removeProviderConfig(user_id: string, provider_id: string) {
    const current = await row(user_id)
    const next = { ...readConfigs(current?.provider_configs_json) }
    delete next[provider_id]
    await write({
      user_id,
      provider_auth_cipher: current?.provider_auth_cipher ?? undefined,
      provider_control_json: readControl(current?.provider_control_json),
      provider_configs_json: Object.keys(next).length > 0 ? next : undefined,
    })
  }

  /** 中文注释：删除指定用户 provider 的认证、配置和关联控制项。 */
  export async function removeProvider(user_id: string, provider_id: string) {
    const current = await row(user_id)
    const auth = { ...readAuths(current?.provider_auth_cipher) }
    const config = { ...readConfigs(current?.provider_configs_json) }
    const control = readControl(current?.provider_control_json)
    delete auth[provider_id]
    delete config[provider_id]
    const nextControl = {
      ...control,
      enabled_providers: control.enabled_providers?.filter((item) => item !== provider_id),
      disabled_providers: control.disabled_providers?.filter((item) => item !== provider_id),
      model: parseModel(control.model)?.provider_id === provider_id ? undefined : control.model,
      small_model: parseModel(control.small_model)?.provider_id === provider_id ? undefined : control.small_model,
    }
    await write({
      user_id,
      provider_auth_cipher: Object.keys(auth).length > 0 ? UserCipher.encrypt(JSON.stringify(auth)) : undefined,
      provider_control_json: Object.fromEntries(
        Object.entries(nextControl).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined)),
      ) as z.output<typeof UserProviderControl>,
      provider_configs_json: Object.keys(config).length > 0 ? config : undefined,
    })
  }

  /** 中文注释：按禁用状态更新用户级 provider 控制项。 */
  export async function setProviderDisabled(user_id: string, provider_id: string, disabled: boolean) {
    const control = await providerControl(user_id)
    const next = new Set(control.disabled_providers ?? [])
    if (disabled) next.add(provider_id)
    if (!disabled) next.delete(provider_id)
    return setProviderControl(user_id, {
      ...control,
      disabled_providers: next.size > 0 ? [...next].sort() : undefined,
      enabled_providers: control.enabled_providers?.filter((item) => item !== provider_id),
    })
  }

  /** 中文注释：读取用户级 provider 行摘要。 */
  export async function providerRows(user_id: string) {
    const current = await row(user_id)
    const auth = readAuths(current?.provider_auth_cipher)
    const config = readConfigs(current?.provider_configs_json)
    return Object.fromEntries(
      ids({ auth, config }).map((provider_id) => [
        provider_id,
        {
          type: auth[provider_id]?.type,
          has_auth: !!auth[provider_id],
          has_config: !!config[provider_id],
        },
      ]),
    ) as Record<string, ProviderRow>
  }

  /** 中文注释：构建用户级 provider 目录。 */
  export async function providerCatalog(user_id: string) {
    const current = await row(user_id)
    const auth = readAuths(current?.provider_auth_cipher)
    const config = readConfigs(current?.provider_configs_json)
    const models = await ModelsDev.get()
    const providers = ids({ auth, config })
      .map((provider_id) => {
        const base = models[provider_id]
        const patch = config[provider_id]
        const items = new Map<string, { model_id: string; model_name: string }>()

        for (const [model_id, model] of Object.entries(base?.models ?? {})) {
          if (!allowed({ model_id, base: model, config: patch })) continue
          items.set(model_id, {
            model_id,
            model_name: modelName({ model_id, base: model }),
          })
        }

        for (const [model_id, model] of Object.entries(patch?.models ?? {})) {
          if (!allowed({ model_id, base: base?.models?.[model_id], config: patch, patch: model })) continue
          items.set(model_id, {
            model_id,
            model_name: modelName({ model_id, base: base?.models?.[model_id], config: model }),
          })
        }

        return {
          provider_id,
          provider_name: providerName({ provider_id, base, config: patch }),
          models: [...items.values()].sort((a, b) => a.model_name.localeCompare(b.model_name)),
        } satisfies CatalogProvider
      })
      .filter((item) => item.models.length > 0)
      .sort((a, b) => a.provider_name.localeCompare(b.provider_name))

    return {
      rows: await providerRows(user_id),
      control: readControl(current?.provider_control_json),
      providers,
    }
  }

  /** 中文注释：校验用户级 provider 控制项只能引用个人 provider 目录。 */
  export async function validateProviderControl(user_id: string, input: unknown) {
    const value = UserProviderControl.parse(input)
    const catalog = await providerCatalog(user_id)
    const map = new Map(catalog.providers.map((item) => [item.provider_id, new Set(item.models.map((model) => model.model_id))]))
    const enabled = value.enabled_providers ? new Set(value.enabled_providers) : undefined
    const disabled = new Set(value.disabled_providers ?? [])

    const providerError = (provider_id: string, field: string) => ({
      ok: false as const,
      code: "provider_not_configured" as const,
      message: `${field} 引用了未配置的供应商：${provider_id}`,
    })
    const modelError = (value: string, field: string) => ({
      ok: false as const,
      code: "model_not_configured" as const,
      message: `${field} 引用了未配置供应商下不可用的模型：${value}`,
    })
    const isAllowed = (provider_id: string) => {
      if (enabled && !enabled.has(provider_id)) return false
      if (disabled.has(provider_id)) return false
      return true
    }

    for (const provider_id of value.enabled_providers ?? []) {
      if (!map.has(provider_id)) return providerError(provider_id, "enabled_providers")
    }
    for (const provider_id of value.disabled_providers ?? []) {
      if (!map.has(provider_id)) return providerError(provider_id, "disabled_providers")
    }
    for (const [field, raw] of [
      ["model", value.model],
      ["small_model", value.small_model],
    ] as const) {
      const parsed = parseModel(raw)
      if (!parsed) continue
      const models = map.get(parsed.provider_id)
      if (!models) return providerError(parsed.provider_id, field)
      if (!isAllowed(parsed.provider_id)) return providerError(parsed.provider_id, field)
      if (!models.has(parsed.model_id)) return modelError(raw!, field)
    }
    return {
      ok: true as const,
      value,
    }
  }
}
