type ManagedCatalogProvider = {
  provider_id: string
  provider_name: string
  models: Array<{
    model_id: string
    model_name: string
  }>
}

export function getManagedCatalogState(input: {
  providers: ManagedCatalogProvider[]
  model?: string
}) {
  const providerOptions = [...input.providers].sort((a, b) => a.provider_name.localeCompare(b.provider_name))
  const value = input.model?.trim() ?? ""
  const [selectedProviderID, ...rest] = value.split("/")
  const selectedModelID = selectedProviderID && rest.length > 0 ? rest.join("/") : ""
  const selectedProviderModels = providerOptions.find((item) => item.provider_id === selectedProviderID)?.models ?? []
  const selectedProviderKnown = providerOptions.some((item) => item.provider_id === selectedProviderID)
  const selectedModelKnown = selectedProviderModels.some((item) => item.model_id === selectedModelID)
  const currentModel = providerOptions
    .flatMap((item) => item.models.map((model) => ({ ...model, provider_id: item.provider_id, provider_name: item.provider_name })))
    .find((item) => item.provider_id === selectedProviderID && item.model_id === selectedModelID)

  return {
    providerOptions,
    selectedProviderID,
    selectedModelID,
    selectedProviderModels,
    selectedProviderKnown,
    selectedModelKnown,
    currentModelText: currentModel ? `${currentModel.provider_name} / ${currentModel.model_name}` : value || "未指定（自动回退）",
  }
}
