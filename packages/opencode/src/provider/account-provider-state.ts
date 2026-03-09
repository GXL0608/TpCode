import { Auth } from "@/auth"
import { UserProviderConfig } from "./user-provider-config"
import { AccountSystemSettingService } from "@/user/system-setting"
import { Config } from "@/config/config"
import z from "zod"
import { Instance } from "@/project/instance"
import { Event } from "@/server/event"
import { GlobalBus } from "@/bus/global"
import { AccountCurrent } from "@/user/current"

type ProviderConfig = z.output<typeof Config.Provider>

type ProviderState = {
  auth?: Auth.Info
  auth_source?: "global" | "user"
  config?: ProviderConfig
  config_source?: "global" | "user"
  disabled?: boolean
}

export namespace AccountProviderState {
  export type Effective = {
    control: UserProviderConfig.Control
    global_control: UserProviderConfig.Control
    global_auth: Record<string, Auth.Info>
    global_configs: Record<string, ProviderConfig>
    user: UserProviderConfig.State
    providers: Record<string, ProviderState>
  }

  function useOwn(user_id: string) {
    const current = AccountCurrent.optional()
    if (!current) return true
    if (current.user_id !== user_id) return true
    return current.permissions.includes("provider:use_own")
  }

  export async function load(user_id: string): Promise<Effective> {
    const [global_auth, global_control, global_configs, user] = await Promise.all([
      Auth.sharedAll(),
      AccountSystemSettingService.providerControl(),
      AccountSystemSettingService.providerConfigs(),
      UserProviderConfig.state(user_id),
    ])
    const own = useOwn(user_id)
      ? user
      : ({
          control: {} as UserProviderConfig.Control,
          providers: {},
        } satisfies UserProviderConfig.State)
    const ids = new Set([
      ...Object.keys(global_auth),
      ...Object.keys(global_configs),
      ...Object.keys(own.providers),
    ])
    const providers = [...ids].reduce(
      (acc, provider_id) => {
        const user_row = own.providers[provider_id]
        const auth = user_row?.auth ?? global_auth[provider_id]
        const config = user_row?.meta.provider_config ?? global_configs[provider_id]
        const state = {
          auth,
          auth_source: user_row?.auth ? ("user" as const) : global_auth[provider_id] ? ("global" as const) : undefined,
          config,
          config_source: user_row?.meta.provider_config
            ? ("user" as const)
            : global_configs[provider_id]
              ? ("global" as const)
              : undefined,
          disabled: user_row?.meta.flags?.disabled,
        }
        if (!state.auth && !state.config && state.disabled === undefined) return acc
        acc[provider_id] = state
        return acc
      },
      {} as Record<string, ProviderState>,
    )
    return {
      control: {
        ...global_control,
        ...own.control,
      },
      global_control,
      global_auth,
      global_configs,
      user: own,
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
