export type PoolRow = {
  provider_id: string
  weight: string
  models: Array<{
    model_id: string
    weight: string
  }>
}

export type PoolValue = {
  provider_id: string
  weight: number
  models: Array<{
    model_id: string
    weight: number
  }>
}

function int(value: string | number) {
  const n = typeof value === "number" ? value : Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(n) || n <= 0) return
  return n
}

export function draftPool(input: unknown) {
  if (!Array.isArray(input)) return [] as PoolRow[]
  return input
    .flatMap((provider) => {
      if (!provider || typeof provider !== "object") return []
      const item = provider as {
        provider_id?: unknown
        weight?: unknown
        models?: unknown
      }
      return [
        {
          provider_id: typeof item.provider_id === "string" ? item.provider_id : "",
          weight: typeof item.weight === "number" ? String(item.weight) : "1",
          models: Array.isArray(item.models)
            ? item.models.flatMap((model) => {
                if (!model || typeof model !== "object") return []
                const value = model as { model_id?: unknown; weight?: unknown }
                return [
                  {
                    model_id: typeof value.model_id === "string" ? value.model_id : "",
                    weight: typeof value.weight === "number" ? String(value.weight) : "1",
                  },
                ]
              })
            : [],
        },
      ]
    })
}

export function normalizePool(input: PoolRow[]) {
  return input.map((provider) => ({
    provider_id: provider.provider_id.trim(),
    weight: int(provider.weight) ?? 0,
    models: provider.models.map((model) => ({
      model_id: model.model_id.trim(),
      weight: int(model.weight) ?? 0,
    })),
  }))
}

export function validatePool(input: PoolRow[]) {
  const errors: string[] = []
  const providers = new Set<string>()

  for (const provider of normalizePool(input)) {
    if (!provider.provider_id) {
      errors.push("渠道不能为空")
    } else if (providers.has(provider.provider_id)) {
      errors.push("渠道不能重复")
    } else {
      providers.add(provider.provider_id)
    }

    if (!provider.weight) {
      errors.push("渠道权重必须是正整数")
    }
    if (provider.models.length === 0) {
      errors.push("每个渠道至少配置 1 个模型")
    }

    const models = new Set<string>()
    for (const model of provider.models) {
      if (!model.model_id) {
        errors.push("模型不能为空")
      } else if (models.has(model.model_id)) {
        errors.push("同一渠道下模型不能重复")
      } else {
        models.add(model.model_id)
      }

      if (!model.weight) {
        errors.push("模型权重必须是正整数")
      }
    }
  }

  if (errors.length > 0) {
    return {
      ok: false as const,
      errors: [...new Set(errors)],
    }
  }

  return {
    ok: true as const,
    errors: [] as string[],
  }
}

export function validatePoolControl(input: { model: string; pool: PoolRow[] }) {
  const valid = validatePool(input.pool)
  const errors = [...valid.errors]
  if (input.pool.length > 0 && !input.model.trim()) {
    errors.unshift("当前模型不能为空，作为 Session 模型池回退项使用")
  }
  if (errors.length > 0) {
    return {
      ok: false as const,
      errors: [...new Set(errors)],
    }
  }
  return {
    ok: true as const,
    errors: [] as string[],
  }
}
