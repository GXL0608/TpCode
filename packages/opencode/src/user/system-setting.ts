import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { Flag } from "@/flag/flag"
import z from "zod"
import { Config } from "@/config/config"
import { Database, eq } from "@/storage/db"
import { TpSystemProviderSettingTable } from "./system-provider-setting.sql"
import { State } from "@/project/state"
import { ModelsDev } from "@/provider/models"

const ProviderControl = z
  .object({
    enabled_providers: z.array(z.string()).optional(),
    disabled_providers: z.array(z.string()).optional(),
    model: z.string().optional(),
    small_model: z.string().optional(),
  })

const ProviderConfigMap = z.record(z.string(), Config.Provider)
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

type Data = {
  project_scan_root?: string
}

type ProviderConfig = z.output<typeof Config.Provider>
type ProviderModelConfig = NonNullable<ProviderConfig["models"]>[string]

const filepath = path.join(Global.Path.data, "tp-system-settings.json")
const GLOBAL_PROVIDER_SETTING_ID = "global"

async function read() {
  return (await Filesystem.readJson<Data>(filepath).catch(() => undefined)) ?? {}
}

async function write(data: Data) {
  await Filesystem.writeJson(filepath, data, 0o600)
}

async function globalProviderSetting() {
  return Database.use((db) =>
    db
      .select()
      .from(TpSystemProviderSettingTable)
      .where(eq(TpSystemProviderSettingTable.id, GLOBAL_PROVIDER_SETTING_ID))
      .get(),
  )
}

async function setGlobalProviderSetting(input: {
  provider_control_json?: z.output<typeof ProviderControl>
  provider_configs_json?: z.output<typeof ProviderConfigMap>
  provider_auth_json?: z.output<typeof ProviderAuthMap>
}) {
  const provider_control_json = input.provider_control_json ?? null
  const provider_configs_json = input.provider_configs_json ?? null
  const provider_auth_json = input.provider_auth_json ?? null
  await Database.use((db) =>
    db
      .insert(TpSystemProviderSettingTable)
      .values({
        id: GLOBAL_PROVIDER_SETTING_ID,
        provider_control_json,
        provider_configs_json,
        provider_auth_json,
        time_updated: Date.now(),
      })
      .onConflictDoUpdate({
        target: TpSystemProviderSettingTable.id,
        set: {
          provider_control_json,
          provider_configs_json,
          provider_auth_json,
          time_updated: Date.now(),
        },
      })
      .run(),
  )
  await State.disposeAll()
}

function readProviderControl(row: Awaited<ReturnType<typeof globalProviderSetting>>) {
  const parsed = ProviderControl.safeParse(row?.provider_control_json)
  if (parsed.success) return parsed.data
}

function readProviderConfigs(row: Awaited<ReturnType<typeof globalProviderSetting>>) {
  const parsed = ProviderConfigMap.safeParse(row?.provider_configs_json)
  if (parsed.success) return parsed.data
}

function readProviderAuths(row: Awaited<ReturnType<typeof globalProviderSetting>>) {
  const parsed = ProviderAuthMap.safeParse(row?.provider_auth_json)
  if (parsed.success) return parsed.data
}

function configuredProviderIDs(input: {
  auth?: Record<string, z.output<typeof ProviderAuth>>
  config?: Record<string, ProviderConfig>
}) {
  return [...new Set([...Object.keys(input.auth ?? {}), ...Object.keys(input.config ?? {})])].sort()
}

function parseModel(value?: string) {
  if (!value?.trim()) return
  const [provider_id, ...rest] = value.trim().split("/")
  if (!provider_id || rest.length === 0) return
  return {
    provider_id,
    model_id: rest.join("/"),
  }
}

function providerModelName(input: {
  model_id: string
  base?: ModelsDev.Model
  config?: ProviderModelConfig
}) {
  if (input.config?.name) return input.config.name
  if (input.config?.id && input.config.id !== input.model_id) return input.model_id
  return input.base?.name ?? input.model_id
}

function providerName(input: { provider_id: string; base?: ModelsDev.Provider; config?: ProviderConfig }) {
  return input.config?.name ?? input.base?.name ?? input.provider_id
}

function modelAllowed(input: {
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

export namespace AccountSystemSettingService {
  export type ProviderControl = z.output<typeof ProviderControl>
  export type ProviderAuth = z.output<typeof ProviderAuth>
  export type GlobalProviderRow = {
    type?: z.output<typeof ProviderAuth>["type"]
    has_auth: boolean
    has_config: boolean
  }
  export type ManagedCatalog = {
    rows: Record<string, GlobalProviderRow>
    control: z.output<typeof ProviderControl>
    providers: Array<{
      provider_id: string
      provider_name: string
      models: Array<{
        model_id: string
        model_name: string
      }>
    }>
  }

  export async function projectScanRoot() {
    const env = Flag.TPCODE_PROJECT_SCAN_ROOT?.trim()
    if (env) return { project_scan_root: env, source: "env" as const }
    const data = await read()
    const value = data.project_scan_root?.trim()
    if (value) return { project_scan_root: value, source: "setting" as const }
    return { project_scan_root: "", source: "default" as const }
  }

  export async function setProjectScanRoot(input: { project_scan_root?: string }) {
    const value = input.project_scan_root?.trim() ?? ""
    const data = await read()
    if (value) data.project_scan_root = value
    else delete data.project_scan_root
    await write(data)
    if (value) process.env["TPCODE_PROJECT_SCAN_ROOT"] = value
    else delete process.env["TPCODE_PROJECT_SCAN_ROOT"]
    return { ok: true as const, project_scan_root: value || undefined }
  }

  export async function providerControl() {
    const row = await globalProviderSetting()
    const parsed = readProviderControl(row)
    if (parsed) return parsed
    return {} as z.output<typeof ProviderControl>
  }

  export async function setProviderControl(input: unknown) {
    const parsed = ProviderControl.parse(input)
    const row = await globalProviderSetting()
    const currentConfigs = readProviderConfigs(row)
    const currentAuth = readProviderAuths(row)
    await setGlobalProviderSetting({
      provider_control_json: Object.keys(parsed).length === 0 ? undefined : parsed,
      provider_configs_json: currentConfigs,
      provider_auth_json: currentAuth,
    })
    return parsed
  }

  export async function providerConfigs() {
    const row = await globalProviderSetting()
    const parsed = readProviderConfigs(row)
    if (parsed) return parsed
    return {} as z.output<typeof ProviderConfigMap>
  }

  export async function providerConfig(provider_id: string) {
    return providerConfigs().then((items) => items[provider_id])
  }

  export async function setProviderConfig(provider_id: string, input: unknown) {
    const parsed = Config.Provider.parse(input)
    const row = await globalProviderSetting()
    const current = readProviderConfigs(row)
    const next = {
      ...(current ?? {}),
      [provider_id]: parsed,
    }
    const control = readProviderControl(row)
    const auth = readProviderAuths(row)
    await setGlobalProviderSetting({
      provider_control_json: control,
      provider_configs_json: next,
      provider_auth_json: auth,
    })
    return parsed
  }

  export async function removeProviderConfig(provider_id: string) {
    const row = await globalProviderSetting()
    const current = readProviderConfigs(row)
    const control = readProviderControl(row)
    const auth = readProviderAuths(row)
    if (!current) {
      await setGlobalProviderSetting({
        provider_control_json: control,
        provider_configs_json: undefined,
        provider_auth_json: auth,
      })
      return
    }
    const next = { ...current }
    delete next[provider_id]
    await setGlobalProviderSetting({
      provider_control_json: control,
      provider_configs_json: Object.keys(next).length === 0 ? undefined : next,
      provider_auth_json: auth,
    })
  }

  export async function providerAuths() {
    const row = await globalProviderSetting()
    const parsed = readProviderAuths(row)
    if (parsed) return parsed
    return {} as z.output<typeof ProviderAuthMap>
  }

  export async function providerRows() {
    const row = await globalProviderSetting()
    const auth = readProviderAuths(row) ?? {}
    const config = readProviderConfigs(row) ?? {}
    const ids = configuredProviderIDs({ auth, config })
    return Object.fromEntries(
      ids.map((provider_id) => [
        provider_id,
        {
          type: auth[provider_id]?.type,
          has_auth: !!auth[provider_id],
          has_config: !!config[provider_id],
        },
      ]),
    ) as Record<string, GlobalProviderRow>
  }

  export async function providerCatalog(): Promise<ManagedCatalog> {
    const row = await globalProviderSetting()
    const auth = readProviderAuths(row) ?? {}
    const config = readProviderConfigs(row) ?? {}
    const control = readProviderControl(row) ?? ({} as z.output<typeof ProviderControl>)
    const models = await ModelsDev.get()
    const providers = configuredProviderIDs({ auth, config })
      .map((provider_id) => {
        const base = models[provider_id]
        const patch = config[provider_id]
        const items = new Map<string, { model_id: string; model_name: string }>()

        for (const [model_id, model] of Object.entries(base?.models ?? {})) {
          if (!modelAllowed({ model_id, base: model, config: patch })) continue
          items.set(model_id, {
            model_id,
            model_name: providerModelName({ model_id, base: model }),
          })
        }

        for (const [model_id, model] of Object.entries(patch?.models ?? {})) {
          if (!modelAllowed({ model_id, base: base?.models?.[model_id], config: patch, patch: model })) continue
          items.set(model_id, {
            model_id,
            model_name: providerModelName({ model_id, base: base?.models?.[model_id], config: model }),
          })
        }

        return {
          provider_id,
          provider_name: providerName({ provider_id, base, config: patch }),
          models: [...items.values()].sort((a, b) => a.model_name.localeCompare(b.model_name)),
        }
      })
      .filter((item) => item.models.length > 0)
      .sort((a, b) => a.provider_name.localeCompare(b.provider_name))

    return {
      rows: await providerRows(),
      control,
      providers,
    }
  }

  export async function validateProviderControl(input: unknown) {
    const value = ProviderControl.parse(input)
    const catalog = await providerCatalog()
    const providerMap = new Map(catalog.providers.map((item) => [item.provider_id, new Set(item.models.map((model) => model.model_id))]))

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

    for (const provider_id of value.enabled_providers ?? []) {
      if (!providerMap.has(provider_id)) return providerError(provider_id, "enabled_providers")
    }
    for (const provider_id of value.disabled_providers ?? []) {
      if (!providerMap.has(provider_id)) return providerError(provider_id, "disabled_providers")
    }
    for (const [field, raw] of [
      ["model", value.model],
      ["small_model", value.small_model],
    ] as const) {
      const parsed = parseModel(raw)
      if (!parsed) continue
      const models = providerMap.get(parsed.provider_id)
      if (!models) return providerError(parsed.provider_id, field)
      if (!models.has(parsed.model_id)) return modelError(raw!, field)
    }

    return {
      ok: true as const,
      value,
    }
  }

  export async function providerAuth(provider_id: string) {
    return providerAuths().then((items) => items[provider_id])
  }

  export async function setProviderAuth(provider_id: string, input: unknown) {
    const parsed = ProviderAuth.parse(input)
    const row = await globalProviderSetting()
    const current = readProviderAuths(row)
    const next = {
      ...(current ?? {}),
      [provider_id]: parsed,
    }
    await setGlobalProviderSetting({
      provider_control_json: readProviderControl(row),
      provider_configs_json: readProviderConfigs(row),
      provider_auth_json: next,
    })
    return parsed
  }

  export async function removeProviderAuth(provider_id: string) {
    const row = await globalProviderSetting()
    const current = readProviderAuths(row)
    if (!current) return
    const next = { ...current }
    delete next[provider_id]
    await setGlobalProviderSetting({
      provider_control_json: readProviderControl(row),
      provider_configs_json: readProviderConfigs(row),
      provider_auth_json: Object.keys(next).length === 0 ? undefined : next,
    })
  }

  export async function removeProvider(provider_id: string) {
    const row = await globalProviderSetting()
    const control = readProviderControl(row) ?? {}
    const auth = readProviderAuths(row)
    const config = readProviderConfigs(row)
    const nextAuth = auth ? { ...auth } : undefined
    const nextConfig = config ? { ...config } : undefined
    if (nextAuth) delete nextAuth[provider_id]
    if (nextConfig) delete nextConfig[provider_id]

    const nextControl = {
      ...control,
      enabled_providers: control.enabled_providers?.filter((item) => item !== provider_id),
      disabled_providers: control.disabled_providers?.filter((item) => item !== provider_id),
      model: parseModel(control.model)?.provider_id === provider_id ? undefined : control.model,
      small_model: parseModel(control.small_model)?.provider_id === provider_id ? undefined : control.small_model,
    }

    await setGlobalProviderSetting({
      provider_control_json: Object.fromEntries(
        Object.entries(nextControl).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0
          return value !== undefined
        }),
      ) as z.output<typeof ProviderControl>,
      provider_configs_json: nextConfig && Object.keys(nextConfig).length > 0 ? nextConfig : undefined,
      provider_auth_json: nextAuth && Object.keys(nextAuth).length > 0 ? nextAuth : undefined,
    })
  }
}
