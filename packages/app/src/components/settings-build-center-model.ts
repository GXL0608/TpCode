type ModelOptionInput = {
  value?: string
  source?: string
}

type BuildCenterModelOption = {
  value: string
  label: string
}

type BuildCenterJobInput = {
  product_id: string
  solution_id: string
  saved_plan_ids: string[]
  model: string
}

/** 中文注释：把模型来源翻译成构建中心可读标签。 */
function sourceLabel(source?: string) {
  if (source === "user") return "个人"
  if (source === "pool") return "系统模型池"
  return "系统指定"
}

/** 中文注释：把构建中心模型选择值拆成 providerID 和 modelID。 */
export function parseBuildCenterModel(value: string) {
  if (!value || value === "__auto__") return
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return
  return {
    providerID,
    modelID,
  }
}

/** 中文注释：把 selectable_models 转成构建中心下拉选项，并补一个系统自动入口。 */
export function buildBuildCenterModelOptions(input: ModelOptionInput[]) {
  return [
    {
      value: "__auto__",
      label: "系统自动",
    },
    ...input
      .filter((item): item is { value: string; source?: string } => typeof item.value === "string" && item.value.trim().length > 0)
      .map((item) => ({
        value: item.value.trim(),
        label: `${sourceLabel(item.source)} · ${item.value.trim()}`,
      })),
  ] satisfies BuildCenterModelOption[]
}

/** 中文注释：统一组装构建中心批量执行请求体，按需附带本次显式选择的模型。 */
export function buildBuildCenterJobBody(input: BuildCenterJobInput) {
  const model = parseBuildCenterModel(input.model)
  return {
    product_id: input.product_id,
    solution_id: input.solution_id || undefined,
    saved_plan_ids: input.saved_plan_ids,
    run_mode: "async" as const,
    providerID: model?.providerID,
    modelID: model?.modelID,
  }
}
