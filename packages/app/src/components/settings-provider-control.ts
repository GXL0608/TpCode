import { draftPool, normalizePool, type PoolRow } from "./settings-provider-pool"
import { iife } from "@opencode-ai/util/iife"

export function parseProviderList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function providerFromModel(value: string | undefined) {
  if (!value) return
  const [provider] = value.split("/")
  if (!provider) return
  return provider.trim() || undefined
}

function mirrorModelValue(input: unknown) {
  if (!input || typeof input !== "object") return ""
  const value = input as { provider_id?: unknown; model_id?: unknown }
  if (typeof value.provider_id !== "string" || typeof value.model_id !== "string") return ""
  return `${value.provider_id}/${value.model_id}`
}

function stringList(input: unknown) {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : []
}

export function draftProviderControl(input?: {
  mirror_model?: unknown
  model?: unknown
  small_model?: unknown
  session_model_pool?: unknown
  enabled_providers?: unknown
  disabled_providers?: unknown
}) {
  return {
    mirrorModel: mirrorModelValue(input?.mirror_model),
    model: typeof input?.model === "string" ? input.model : "",
    smallModel: typeof input?.small_model === "string" ? input.small_model : "",
    sessionModelPool: draftPool(input?.session_model_pool),
    enabledProviders: stringList(input?.enabled_providers).join(", "),
    disabledProviders: stringList(input?.disabled_providers).join(", "),
  }
}

export function buildProviderControl(input: {
  model: string
  smallModel: string
  mirrorModel?: string
  sessionModelPool: PoolRow[]
  enabledProviders: string
  disabledProviders: string
  configuredProviders?: string[]
}) {
  const configured = input.configuredProviders ? new Set(input.configuredProviders) : undefined
  const referenced = new Set(
    [
      providerFromModel(input.model.trim() || undefined),
      providerFromModel(input.smallModel.trim() || undefined),
      providerFromModel(input.mirrorModel?.trim() || undefined),
      ...normalizePool(input.sessionModelPool).map((item) => item.provider_id || undefined),
    ].filter((item): item is string => !!item && (!configured || configured.has(item))),
  )

  const enabled = [...new Set([...parseProviderList(input.enabledProviders), ...referenced])].filter(
    (item) => !configured || configured.has(item),
  )
  const disabled = parseProviderList(input.disabledProviders).filter(
    (item) => (!configured || configured.has(item)) && !referenced.has(item),
  )

  return {
    mirror_model: input.mirrorModel?.trim()
      ? iife(() => {
          const [provider_id, ...rest] = input.mirrorModel!.trim().split("/")
          const model_id = rest.join("/")
          if (!provider_id || !model_id) return undefined
          if (configured && !configured.has(provider_id)) return undefined
          return {
            provider_id,
            model_id,
          }
        })
      : undefined,
    model: input.model.trim() || undefined,
    small_model: input.smallModel.trim() || undefined,
    session_model_pool: input.sessionModelPool.length > 0 ? normalizePool(input.sessionModelPool) : undefined,
    enabled_providers: enabled.length > 0 ? enabled : undefined,
    disabled_providers: disabled.length > 0 ? disabled : undefined,
  }
}
