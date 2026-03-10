import { AccountSystemSettingService } from "@/user/system-setting"
import { Config } from "@/config/config"
import z from "zod"
import { Instance } from "@/project/instance"
import { Event } from "@/server/event"
import { GlobalBus } from "@/bus/global"

type ProviderConfig = z.output<typeof Config.Provider>

type ProviderState = {
  auth?: AccountSystemSettingService.ProviderAuth
  auth_source?: "global" | "user"
  config?: ProviderConfig
  config_source?: "global" | "user"
  disabled?: boolean
}

export namespace AccountProviderState {
  export type Effective = {
    control: AccountSystemSettingService.ProviderControl
    global_control: AccountSystemSettingService.ProviderControl
    global_auth: Record<string, AccountSystemSettingService.ProviderAuth>
    global_configs: Record<string, ProviderConfig>
    providers: Record<string, ProviderState>
  }

  export async function load(_user_id: string): Promise<Effective> {
    const [global_auth, global_control, global_configs] = await Promise.all([
      AccountSystemSettingService.providerAuths(),
      AccountSystemSettingService.providerControl(),
      AccountSystemSettingService.providerConfigs(),
    ])
    const disabled = new Set(global_control.disabled_providers ?? [])
    const ids = new Set([
      ...Object.keys(global_auth),
      ...Object.keys(global_configs),
    ])
    const providers = [...ids].reduce(
      (acc, provider_id) => {
        const auth = global_auth[provider_id]
        const config = global_configs[provider_id]
        const state = {
          auth,
          auth_source: global_auth[provider_id] ? ("global" as const) : undefined,
          config,
          config_source: global_configs[provider_id] ? ("global" as const) : undefined,
          disabled: disabled.has(provider_id),
        }
        if (!state.auth && !state.config && state.disabled === undefined) return acc
        acc[provider_id] = state
        return acc
      },
      {} as Record<string, ProviderState>,
    )
    return {
      control: global_control,
      global_control,
      global_auth,
      global_configs,
      providers,
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
