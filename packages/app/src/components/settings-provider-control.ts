import { normalizePool, type PoolRow } from "./settings-provider-pool"

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

export function buildProviderControl(input: {
  model: string
  smallModel: string
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
    model: input.model.trim() || undefined,
    small_model: input.smallModel.trim() || undefined,
    session_model_pool: input.sessionModelPool.length > 0 ? normalizePool(input.sessionModelPool) : undefined,
    enabled_providers: enabled.length > 0 ? enabled : undefined,
    disabled_providers: disabled.length > 0 ? disabled : undefined,
  }
}
