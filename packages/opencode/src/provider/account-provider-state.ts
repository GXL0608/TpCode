import { AccountSystemSettingService } from "@/user/system-setting"
import { Config } from "@/config/config"
import z from "zod"
import { Instance } from "@/project/instance"
import { Event } from "@/server/event"
import { GlobalBus } from "@/bus/global"
import { AccountUserProviderSettingService } from "@/user/user-provider-setting"

type ProviderConfig = z.output<typeof Config.Provider>

type ProviderState = {
  auth?: AccountSystemSettingService.ProviderAuth
  auth_source?: "global" | "user"
  config?: ProviderConfig
  config_source?: "global" | "user"
  disabled?: boolean
}

type SelectableModel = {
  value: string
  provider_id: string
  provider_name: string
  model_id: string
  model_name: string
  source: "user" | "global" | "pool"
}

/** 中文注释：解析 provider/model 字符串。 */
function parseModel(value?: string) {
  if (!value?.trim()) return
  const [provider_id, ...rest] = value.trim().split("/")
  if (!provider_id || rest.length === 0) return
  return {
    provider_id,
    model_id: rest.join("/"),
  }
}

export namespace AccountProviderState {
  export type Effective = {
    control: AccountSystemSettingService.ProviderControl
    global_control: AccountSystemSettingService.ProviderControl
    user_control: AccountUserProviderSettingService.ProviderControl
    global_auth: Record<string, AccountSystemSettingService.ProviderAuth>
    user_auth: Record<string, AccountUserProviderSettingService.ProviderAuth>
    global_configs: Record<string, ProviderConfig>
    user_configs: Record<string, ProviderConfig>
    providers: Record<string, ProviderState>
    selectable_models: SelectableModel[]
  }

  export async function load(user_id: string): Promise<Effective> {
    const [global_auth, global_control, global_configs, user_auth, user_control, user_configs, global_catalog, user_catalog] =
      await Promise.all([
      AccountSystemSettingService.providerAuths(),
      AccountSystemSettingService.providerControl(),
      AccountSystemSettingService.providerConfigs(),
      AccountUserProviderSettingService.providerAuths(user_id),
      AccountUserProviderSettingService.providerControl(user_id),
      AccountUserProviderSettingService.providerConfigs(user_id),
      AccountSystemSettingService.providerCatalog(),
      AccountUserProviderSettingService.providerCatalog(user_id),
    ])
    const global_disabled = new Set(global_control.disabled_providers ?? [])
    const user_disabled = new Set(user_control.disabled_providers ?? [])
    const user_ids = new Set([...Object.keys(user_auth), ...Object.keys(user_configs)])
    const ids = new Set([
      ...Object.keys(global_auth),
      ...Object.keys(global_configs),
      ...Object.keys(user_auth),
      ...Object.keys(user_configs),
    ])
    const providers = [...ids].reduce(
      (acc, provider_id) => {
        const auth = user_auth[provider_id] ?? global_auth[provider_id]
        const config = user_configs[provider_id] ?? global_configs[provider_id]
        const state = {
          auth,
          auth_source: user_auth[provider_id] ? ("user" as const) : global_auth[provider_id] ? ("global" as const) : undefined,
          config,
          config_source: user_configs[provider_id] ? ("user" as const) : global_configs[provider_id] ? ("global" as const) : undefined,
          disabled: user_ids.has(provider_id) ? user_disabled.has(provider_id) : global_disabled.has(provider_id),
        }
        if (!state.auth && !state.config && state.disabled === undefined) return acc
        acc[provider_id] = state
        return acc
      },
      {} as Record<string, ProviderState>,
    )
    const select = new Map<string, SelectableModel>()
    const push = (item: SelectableModel) => {
      const rank = {
        user: 3,
        global: 2,
        pool: 1,
      } as const
      const current = select.get(item.value)
      if (!current || rank[item.source] > rank[current.source]) {
        select.set(item.value, item)
      }
    }

    for (const provider of user_catalog.providers) {
      for (const model of provider.models) {
        push({
          value: `${provider.provider_id}/${model.model_id}`,
          provider_id: provider.provider_id,
          provider_name: provider.provider_name,
          model_id: model.model_id,
          model_name: model.model_name,
          source: "user",
        })
      }
    }

    const global_index = new Map(
      global_catalog.providers.map((provider) => [
        provider.provider_id,
        {
          provider_name: provider.provider_name,
          models: new Map(provider.models.map((model) => [model.model_id, model.model_name])),
        },
      ]),
    )

    const single = parseModel(global_control.model)
    if (single) {
      const provider = global_index.get(single.provider_id)
      const name = provider?.models.get(single.model_id)
      if (provider && name) {
        push({
          value: `${single.provider_id}/${single.model_id}`,
          provider_id: single.provider_id,
          provider_name: provider.provider_name,
          model_id: single.model_id,
          model_name: name,
          source: "global",
        })
      }
    }

    for (const item of global_control.session_model_pool ?? []) {
      const provider = global_index.get(item.provider_id)
      if (!provider) continue
      for (const model of item.models) {
        const name = provider.models.get(model.model_id)
        if (!name) continue
        push({
          value: `${item.provider_id}/${model.model_id}`,
          provider_id: item.provider_id,
          provider_name: provider.provider_name,
          model_id: model.model_id,
          model_name: name,
          source: "pool",
        })
      }
    }

    return {
      control: global_control,
      global_control,
      user_control,
      global_auth,
      user_auth,
      global_configs,
      user_configs,
      providers,
      selectable_models: [...select.values()].sort((a, b) => {
        const left = a.provider_name.localeCompare(b.provider_name)
        if (left !== 0) return left
        return a.model_name.localeCompare(b.model_name)
      }),
    }
  }

  export function authSource(input: Effective, provider_id: string) {
    const provider = input.providers[provider_id]
    return provider?.auth_source ?? "none"
  }

  export function auth(input: Effective, provider_id: string) {
    return input.providers[provider_id]?.auth
  }

  export async function invalidate() {
    await Instance.disposeAll()
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Event.Disposed.type,
        properties: {},
      },
    })
  }
}
