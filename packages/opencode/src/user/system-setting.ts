import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { Flag } from "@/flag/flag"
import z from "zod"
import { Config } from "@/config/config"

const ModelPrefs = z
  .object({
    visibility: z.record(z.string(), z.enum(["show", "hide"])).optional(),
    favorite: z.array(z.string()).optional(),
    recent: z.array(z.string()).optional(),
    variant: z.record(z.string(), z.string()).optional(),
  })
  .catchall(z.any())

const ProviderControl = z
  .object({
    enabled_providers: z.array(z.string()).optional(),
    disabled_providers: z.array(z.string()).optional(),
    model: z.string().optional(),
    small_model: z.string().optional(),
    model_prefs: ModelPrefs.optional(),
  })
  .catchall(z.any())

const ProviderConfigMap = z.record(z.string(), Config.Provider)

type Data = {
  project_scan_root?: string
  provider_control?: z.output<typeof ProviderControl>
  provider_configs?: z.output<typeof ProviderConfigMap>
}

const filepath = path.join(Global.Path.data, "tp-system-settings.json")

async function read() {
  return (await Filesystem.readJson<Data>(filepath).catch(() => undefined)) ?? {}
}

async function write(data: Data) {
  await Filesystem.writeJson(filepath, data, 0o600)
}

export namespace AccountSystemSettingService {
  export type ProviderControl = z.output<typeof ProviderControl>

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
    const data = await read()
    const parsed = ProviderControl.safeParse(data.provider_control)
    if (parsed.success) return parsed.data
    return {} as z.output<typeof ProviderControl>
  }

  export async function setProviderControl(input: unknown) {
    const parsed = ProviderControl.parse(input)
    const data = await read()
    if (Object.keys(parsed).length === 0) delete data.provider_control
    else data.provider_control = parsed
    await write(data)
    return parsed
  }

  export async function providerConfigs() {
    const data = await read()
    const parsed = ProviderConfigMap.safeParse(data.provider_configs)
    if (parsed.success) return parsed.data
    return {} as z.output<typeof ProviderConfigMap>
  }

  export async function providerConfig(provider_id: string) {
    return providerConfigs().then((items) => items[provider_id])
  }

  export async function setProviderConfig(provider_id: string, input: unknown) {
    const parsed = Config.Provider.parse(input)
    const data = await read()
    const current = ProviderConfigMap.safeParse(data.provider_configs)
    const next = {
      ...(current.success ? current.data : {}),
      [provider_id]: parsed,
    }
    data.provider_configs = next
    await write(data)
    return parsed
  }

  export async function removeProviderConfig(provider_id: string) {
    const data = await read()
    const current = ProviderConfigMap.safeParse(data.provider_configs)
    if (!current.success) {
      delete data.provider_configs
      await write(data)
      return
    }
    const next = { ...current.data }
    delete next[provider_id]
    if (Object.keys(next).length === 0) delete data.provider_configs
    else data.provider_configs = next
    await write(data)
  }
}
