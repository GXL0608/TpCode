import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import { createEffect, createMemo, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useAccountAuth } from "@/context/account-auth"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createStore } from "solid-js/store"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import type { ProviderSettingsScope } from "./provider-settings-scope"
import { getManagedCatalogState } from "./settings-providers-catalog"
import { canViewReadonlySystemCandidates } from "./settings-provider-access"
import { draftPool, normalizePool, type PoolRow, validatePoolControl } from "./settings-provider-pool"
import { canUseBuildCapability } from "@/utils/account-build-access"
import { buildProviderControl, draftProviderControl, parseProviderList } from "./settings-provider-control"

type ManagedRow = {
  provider_id: string
  configured: boolean
  auth_type?: string
  has_config?: boolean
  disabled?: boolean
}
type ManagedModelOption = {
  value: string
  provider_id: string
  provider_name: string
  model_id: string
  model_name: string
}
type ManagedProviderOption = {
  provider_id: string
  provider_name: string
}
type ManagedCatalogProvider = ManagedProviderOption & {
  models: Array<{
    model_id: string
    model_name: string
  }>
}
type SelectableModelRow = {
  value: string
  source: string
}

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function icon(id: string): IconName {
  if (iconNames.includes(id as IconName)) return id as IconName
  return "synthetic"
}

function note(id: string) {
  return PROVIDER_NOTES.find((item) => item.match(id))?.key
}

/** 中文注释：解析 provider/model 组合值，便于模型选择器复用。 */
function parseManagedValue(value: string) {
  const [provider_id, ...rest] = value.split("/")
  const model_id = rest.join("/")
  if (!provider_id || !model_id) return
  return {
    provider_id,
    model_id,
  }
}

const ManagedProviders: Component<{ scope: Extract<ProviderSettingsScope, { kind: "global" | "self" }> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const auth = useAccountAuth()
  const accountRequest = useAccountRequest()
  const globalSDK = useGlobalSDK()
  const providers = useProviders()
  const self = createMemo(() => props.scope.kind === "self")

  const catalog = createMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const item of providers.all()) {
      map.set(item.id, {
        id: item.id,
        name: item.name?.trim() || item.id,
      })
    }
    for (const id of popularProviders) {
      if (map.has(id)) continue
      map.set(id, {
        id,
        name: id,
      })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  })
  const catalogMap = createMemo(() => new Map(catalog().map((item) => [item.id, item])))
  const canManage = createMemo(() => {
    if (self()) return canUseBuildCapability(auth.user())
    return (auth.user()?.roles ?? []).includes("super_admin")
  })
  const canViewSystemReadonly = createMemo(() =>
    canViewReadonlySystemCandidates({
      isSelf: self(),
      roles: auth.user()?.roles ?? [],
    }),
  )
  const title = createMemo(() => (self() ? "个人模型配置" : "全局提供商配置"))
  const description = createMemo(() =>
    self()
      ? canViewSystemReadonly()
        ? "在这里维护你自己的渠道商、模型和默认项；系统模型池与系统指定模型会在下方只读展示。"
        : "在这里维护你自己的渠道商、模型和默认项，不会改写系统默认执行路径。"
      : "管理员在这里统一配置供应商、模型和默认项，所有成员直接生效。",
  )
  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    providerID: "",
    providerConfigText: "{}",
    rows: [] as ManagedRow[],
    managedProviders: [] as ManagedCatalogProvider[],
    selectableModels: [] as SelectableModelRow[],
    globalModel: "",
    globalSmallModel: "",
    globalSessionModelPool: [] as PoolRow[],
    mirrorModel: "",
    model: "",
    smallModel: "",
    sessionModelPool: [] as PoolRow[],
    enabledProviders: "",
    disabledProviders: "",
  })
  let configRef: HTMLDivElement | undefined
  let configInputRef: HTMLInputElement | undefined

  const configuredIDs = createMemo(() => new Set(state.rows.map((item) => item.provider_id)))
  const disabledSet = createMemo(() => new Set(parseProviderList(state.disabledProviders)))
  const modelOptions = createMemo(() => {
    const list = state.managedProviders
      .filter((provider) => !disabledSet().has(provider.provider_id))
      .flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.provider_id}/${model.model_id}`,
          provider_id: provider.provider_id,
          provider_name: provider.provider_name,
          model_id: model.model_id,
          model_name: model.model_name,
        })),
      )
    return list.sort((a, b) => {
      const providerDiff = a.provider_name.localeCompare(b.provider_name)
      if (providerDiff !== 0) return providerDiff
      return a.model_name.localeCompare(b.model_name)
    })
  })
  const providerOptions = createMemo(() => {
    const map = new Map<string, ManagedProviderOption>()
    for (const item of modelOptions()) {
      if (map.has(item.provider_id)) continue
      map.set(item.provider_id, {
        provider_id: item.provider_id,
        provider_name: item.provider_name,
      })
    }
    return [...map.values()].sort((a, b) => a.provider_name.localeCompare(b.provider_name))
  })
  const poolProviderOptions = createMemo(() =>
    [...state.managedProviders]
      .map((item) => ({
        provider_id: item.provider_id,
        provider_name: item.provider_name,
      }))
      .sort((a, b) => a.provider_name.localeCompare(b.provider_name)),
  )
  const poolProviderMap = createMemo(() => new Map(state.managedProviders.map((item) => [item.provider_id, item])))
  const managedCatalog = createMemo(() =>
    getManagedCatalogState({
      providers: state.managedProviders,
      model: state.model,
    }),
  )
  const selectedProviderID = createMemo(() => managedCatalog().selectedProviderID)
  const selectedModelID = createMemo(() => managedCatalog().selectedModelID)
  const selectedProviderModels = createMemo(() => managedCatalog().selectedProviderModels)
  const selectedProviderKnown = createMemo(() => managedCatalog().selectedProviderKnown)
  const selectedModelKnown = createMemo(() => managedCatalog().selectedModelKnown)
  const currentModelText = createMemo(() => managedCatalog().currentModelText)
  const mirrorProviderID = createMemo(() => parseManagedValue(state.mirrorModel)?.provider_id ?? "")
  const mirrorModelID = createMemo(() => parseManagedValue(state.mirrorModel)?.model_id ?? "")
  const mirrorProviderModels = createMemo(() => poolProviderMap().get(mirrorProviderID())?.models ?? [])
  const mirrorProviderKnown = createMemo(() => !mirrorProviderID() || !!poolProviderMap().get(mirrorProviderID()))
  const mirrorModelKnown = createMemo(
    () => !mirrorProviderID() || !mirrorModelID() || mirrorProviderModels().some((item) => item.model_id === mirrorModelID()),
  )
  const mirrorCurrentText = createMemo(() => {
    if (!state.mirrorModel.trim()) return "未开启"
    const parsed = parseManagedValue(state.mirrorModel.trim())
    if (!parsed) return state.mirrorModel.trim()
    const provider = poolProviderMap().get(parsed.provider_id)
    const model = provider?.models.find((item) => item.model_id === parsed.model_id)
    return model ? `${provider?.provider_name} / ${model.model_name}` : state.mirrorModel.trim()
  })
  const popular = createMemo(() =>
    popularProviders
      .map((id) => catalogMap().get(id))
      .filter((item): item is { id: string; name: string } => !!item && !configuredIDs().has(item.id)),
  )
  const available = createMemo(() => catalog().filter((item) => !configuredIDs().has(item.id)))
  const name = (providerID: string) => catalogMap().get(providerID)?.name ?? providerID

  const paths = () => {
    if (self()) {
      return {
        rows: "/account/me/providers/catalog",
        control: "/account/me/provider-control",
        catalog: "/account/me/providers/catalog",
        config: (providerID: string) => `/account/me/providers/${encodeURIComponent(providerID)}/config`,
        key: (providerID: string) => `/account/me/provider/${encodeURIComponent(providerID)}`,
        provider: (providerID: string) => `/account/me/providers/${encodeURIComponent(providerID)}`,
        disabled: (providerID: string) => `/account/me/providers/${encodeURIComponent(providerID)}/disabled`,
      }
    }
    return {
      rows: "/account/admin/provider/global",
      control: "/account/admin/provider-control/global",
      catalog: "/account/admin/providers/catalog/global",
      config: (providerID: string) => `/account/admin/providers/${encodeURIComponent(providerID)}/config/global`,
      key: (providerID: string) => `/account/admin/provider/${encodeURIComponent(providerID)}/global`,
      provider: (providerID: string) => `/account/admin/providers/${encodeURIComponent(providerID)}/global`,
      disabled: (_providerID: string) => "",
    }
  }

  const controlBody = (disabledProviders = state.disabledProviders) => {
    return buildProviderControl({
      model: state.model,
      smallModel: state.smallModel,
      mirrorModel: self() ? undefined : state.mirrorModel,
      sessionModelPool: state.sessionModelPool,
      enabledProviders: state.enabledProviders,
      disabledProviders,
      configuredProviders: state.managedProviders.map((item) => item.provider_id),
    })
  }

  const complete = async (message: string) => {
    await globalSDK.client.global.dispose().catch(() => undefined)
    setState("message", message)
    setState("error", "")
    await load()
  }

  const loadConfig = async (providerID: string) => {
    if (!providerID.trim()) {
      setState("providerConfigText", "{}")
      return
    }
    const response = await accountRequest({
      path: paths().config(providerID.trim()),
    }).catch(() => undefined)
    if (!response?.ok) {
      setState("providerConfigText", "{}")
      setState("error", await parseAccountError(response))
      return
    }
    const row = (await response.json().catch(() => undefined)) as { config?: unknown } | undefined
    setState("providerConfigText", row?.config ? JSON.stringify(row.config, null, 2) : "{}")
  }

  const load = async () => {
    if (!canManage()) return
    setState("loading", true)
    setState("error", "")

    const rowsResponse = await accountRequest({ path: paths().rows }).catch(() => undefined)
    const catalogResponse = await accountRequest({ path: paths().catalog }).catch(() => undefined)

    if (!rowsResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(rowsResponse))
      return
    }
    if (!catalogResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(catalogResponse))
      return
    }

    const catalogBody = (await catalogResponse.json().catch(() => undefined)) as
      | {
          control?: {
            mirror_model?: unknown
            model?: unknown
            small_model?: unknown
            session_model_pool?: unknown
            enabled_providers?: unknown
            disabled_providers?: unknown
          }
          user_control?: {
            model?: unknown
            small_model?: unknown
            enabled_providers?: unknown
            disabled_providers?: unknown
          }
          global_control?: {
            mirror_model?: unknown
            model?: unknown
            small_model?: unknown
            session_model_pool?: unknown
          }
          selectable_models?: unknown
          providers?: unknown
        }
      | undefined
    const control = self() ? catalogBody?.user_control : catalogBody?.control
    const globalControl = self() ? catalogBody?.global_control : catalogBody?.control
    const disabled = new Set(list<string>(control?.disabled_providers))
    const rowsBody = (await rowsResponse.json().catch(() => undefined)) as
      | Record<string, { type?: unknown; has_config?: unknown }>
      | {
          rows?: Record<string, { type?: unknown; has_config?: unknown }>
        }
      | undefined
    const rowMap = (self() ? rowsBody?.rows : rowsBody) as Record<string, { type?: unknown; has_config?: unknown }> | undefined
    const rows = Object.entries(rowMap ?? {})
      .map(([provider_id, row]) => ({
        provider_id,
        configured: true,
        auth_type: typeof row?.type === "string" ? row.type : undefined,
        has_config: row?.has_config === true,
        disabled: disabled.has(provider_id),
      }))
      .sort((a, b) => {
      const left = name(a.provider_id)
      const right = name(b.provider_id)
      return left.localeCompare(right)
    })

    const providerID =
      state.providerID.trim() ||
      rows[0]?.provider_id ||
      popularProviders.find((item) => catalogMap().has(item)) ||
      catalog()[0]?.id ||
      "openai"

    setState("rows", rows)
    setState(
      "managedProviders",
      list<ManagedCatalogProvider>(catalogBody?.providers)
        .map((item) => ({
          provider_id: item.provider_id,
          provider_name: item.provider_name,
          models: list<{ model_id: string; model_name: string }>(item.models)
            .map((model) => ({
              model_id: model.model_id,
              model_name: model.model_name,
            }))
            .filter((model) => !!model.model_id),
        }))
        .filter((item) => !!item.provider_id),
    )
    setState(
      "selectableModels",
      list<SelectableModelRow>(catalogBody?.selectable_models).filter((item) => !!item?.value && !!item?.source),
    )
    const globalDraft = draftProviderControl(globalControl)
    const controlDraft = draftProviderControl(control)
    setState("globalModel", globalDraft.model)
    setState("globalSmallModel", globalDraft.smallModel)
    setState("globalSessionModelPool", globalDraft.sessionModelPool)
    setState("mirrorModel", globalDraft.mirrorModel)
    setState("providerID", providerID)
    setState("model", controlDraft.model)
    setState("smallModel", controlDraft.smallModel)
    setState("sessionModelPool", self() ? [] : controlDraft.sessionModelPool)
    setState("enabledProviders", controlDraft.enabledProviders)
    setState("disabledProviders", controlDraft.disabledProviders)
    setState("loading", false)
    await loadConfig(providerID)
  }

  const saveControl = async () => {
    if (!canManage()) return
    if (!self()) {
      const valid = validatePoolControl({
        model: state.model,
        pool: state.sessionModelPool,
      })
      if (!valid.ok) {
        setState("error", valid.errors.join("；"))
        setState("message", "")
        return
      }
    }
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await accountRequest({
      method: "PUT",
      path: paths().control,
      body: controlBody(),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    await complete(self() ? "个人模型控制已更新" : "全局模型控制已更新")
  }

  const saveMirrorControl = async () => {
    if (!canManage() || self()) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const latestResponse = await accountRequest({
      path: paths().control,
    }).catch(() => undefined)
    if (!latestResponse?.ok) {
      setState("pending", false)
      setState("error", await parseAccountError(latestResponse))
      return
    }
    const latestBody = (await latestResponse.json().catch(() => undefined)) as
      | {
          mirror_model?: unknown
          model?: unknown
          small_model?: unknown
          session_model_pool?: unknown
          enabled_providers?: unknown
          disabled_providers?: unknown
        }
      | undefined
    const latest = draftProviderControl(latestBody)
    const response = await accountRequest({
      method: "PUT",
      path: paths().control,
      body: buildProviderControl({
        ...latest,
        mirrorModel: state.mirrorModel,
      }),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    await globalSDK.client.global.dispose().catch(() => undefined)
    setState("message", "学生模型镜像配置已更新")
    setState("error", "")
  }

  const addPoolProvider = () => {
    const used = new Set(state.sessionModelPool.map((item) => item.provider_id))
    const providerID =
      poolProviderOptions().find((item) => !used.has(item.provider_id))?.provider_id ?? poolProviderOptions()[0]?.provider_id ?? ""
    const modelID = poolProviderMap().get(providerID)?.models[0]?.model_id ?? ""
    setState("sessionModelPool", (items) => [
      ...items,
      {
        provider_id: providerID,
        weight: "1",
        models: modelID ? [{ model_id: modelID, weight: "1" }] : [],
      },
    ])
  }

  const updatePoolProvider = (index: number, providerID: string) => {
    const modelID = poolProviderMap().get(providerID)?.models[0]?.model_id ?? ""
    setState("sessionModelPool", (items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              provider_id: providerID,
              weight: item.weight,
              models: modelID ? [{ model_id: modelID, weight: "1" }] : [],
            }
          : item,
      ),
    )
  }

  const addPoolModel = (index: number) => {
    const providerID = state.sessionModelPool[index]?.provider_id ?? ""
    const models = poolProviderMap().get(providerID)?.models ?? []
    const used = new Set((state.sessionModelPool[index]?.models ?? []).map((item) => item.model_id))
    const modelID = models.find((item) => !used.has(item.model_id))?.model_id ?? models[0]?.model_id ?? ""
    if (!modelID) return
    setState("sessionModelPool", (items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              models: [...item.models, { model_id: modelID, weight: "1" }],
            }
          : item,
      ),
    )
  }

  const saveProviderConfig = async () => {
    const providerID = state.providerID.trim()
    if (!providerID) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const parsed = await Promise.resolve()
      .then(() => JSON.parse(state.providerConfigText || "{}") as Record<string, unknown>)
      .catch(() => undefined)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setState("pending", false)
      setState("error", "提供商配置 JSON 格式无效")
      return
    }
    const response = await accountRequest({
      method: "PUT",
      path: paths().config(providerID),
      body: parsed,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    await complete(`${name(providerID)} 配置已更新`)
  }

  const removeProviderConfig = async () => {
    const providerID = state.providerID.trim()
    if (!providerID) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await accountRequest({
      method: "DELETE",
      path: paths().config(providerID),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("providerConfigText", "{}")
    await complete(`${name(providerID)} 配置已删除`)
  }

  const removeProvider = async (providerID: string) => {
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await accountRequest({
      method: "DELETE",
      path: paths().provider(providerID),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    if (state.providerID.trim() === providerID) setState("providerID", "")
    await complete(`${name(providerID)} 已删除`)
  }

  const toggleDisabled = async (providerID: string, disabled: boolean) => {
    if (self()) {
      setState("pending", true)
      setState("error", "")
      setState("message", "")
      const response = await accountRequest({
        method: "PATCH",
        path: paths().disabled(providerID),
        body: { disabled },
      }).catch(() => undefined)
      setState("pending", false)
      if (!response?.ok) {
        setState("error", await parseAccountError(response))
        return
      }
      await complete(`${name(providerID)} 已${disabled ? "禁用" : "启用"}`)
      return
    }
    const next = disabled
      ? [...new Set([...parseProviderList(state.disabledProviders), providerID])]
      : parseProviderList(state.disabledProviders).filter((item) => item !== providerID)
    const enabled = parseProviderList(state.enabledProviders)
    const nextEnabled =
      !disabled && enabled.length > 0 && !enabled.includes(providerID) ? [...enabled, providerID] : enabled
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await accountRequest({
      method: "PUT",
      path: paths().control,
      body: {
        ...controlBody(next.join(", ")),
        enabled_providers: nextEnabled.length > 0 ? nextEnabled : undefined,
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    await complete(`${name(providerID)} 已${disabled ? "禁用" : "启用"}`)
  }

  const openConnect = (providerID: string) => {
    dialog.show(() => <DialogConnectProvider provider={providerID} scope={props.scope} onComplete={() => void load()} />)
  }

  const openCustom = () => {
    dialog.show(() => <DialogCustomProvider back="close" scope={props.scope} onComplete={() => void load()} />)
  }

  const editProviderConfig = (providerID: string) => {
    setState("providerID", providerID)
    void loadConfig(providerID)
    queueMicrotask(() => {
      configRef?.scrollIntoView({ behavior: "smooth", block: "start" })
      configInputRef?.focus()
    })
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    const providerID = state.providerID.trim()
    if (!providerID) return
    void loadConfig(providerID)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[860px]">
          <h2 class="text-16-medium text-text-strong">{title()}</h2>
          <div class="text-13-regular text-text-weak">{description()}</div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[860px]">
        <Show when={state.message}>
          <div class="rounded-lg border border-icon-success-base/20 bg-icon-success-base/10 px-4 py-3 text-13-regular text-icon-success-base">
            {state.message}
          </div>
        </Show>
        <Show when={state.error}>
          <div class="rounded-lg border border-icon-critical-base/20 bg-icon-critical-base/10 px-4 py-3 text-13-regular text-icon-critical-base">
            {state.error}
          </div>
        </Show>

        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between pb-2">
            <h3 class="text-14-medium text-text-strong">已配置供应商</h3>
            <Show when={state.loading}>
              <span class="text-12-regular text-text-weak">加载中...</span>
            </Show>
          </div>
          <div class="flex flex-col gap-2">
            <Show
              when={state.rows.length > 0}
              fallback={
                <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-4 text-14-regular text-text-weak">
                  暂无已配置供应商
                </div>
              }
            >
              <For each={state.rows}>
                {(item) => (
                  <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-3">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="flex flex-col gap-2 min-w-0 flex-1">
                        <div class="flex items-center gap-3 min-w-0">
                          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-base border border-border-weak-base">
                            <ProviderIcon id={icon(item.provider_id)} class="size-4 icon-strong-base" />
                          </div>
                          <span class="text-14-medium text-text-strong truncate">{name(item.provider_id)}</span>
                          <Show when={item.auth_type}>
                            <Tag>{item.auth_type}</Tag>
                          </Show>
                          <Show when={item.has_config}>
                            <Tag>config</Tag>
                          </Show>
                          <Show when={item.disabled}>
                            <Tag>disabled</Tag>
                          </Show>
                        </div>
                        <div class="pl-11 text-12-regular text-text-weak">{item.provider_id}</div>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            setState("providerID", item.provider_id)
                            openConnect(item.provider_id)
                          }}
                          disabled={state.pending}
                        >
                          更新密钥
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => editProviderConfig(item.provider_id)}
                          disabled={state.pending}
                        >
                          编辑配置
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => void toggleDisabled(item.provider_id, !item.disabled)}
                          disabled={state.pending}
                        >
                          {item.disabled ? "启用" : "禁用"}
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => void removeProvider(item.provider_id)}
                          disabled={state.pending}
                        >
                          删除供应商
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-3">
          <div class="text-14-medium text-text-strong">{self() ? "我的默认模型" : "当前模型（全员生效）"}</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={selectedProviderID()}
              onChange={(event) => {
                const providerID = event.currentTarget.value.trim()
                if (!providerID) {
                  setState("model", "")
                  return
                }
                const first = modelOptions().find((item) => item.provider_id === providerID)
                setState("model", first?.value ?? "")
              }}
            >
              <option value="">选择供应商（未指定则自动回退）</option>
              <Show when={selectedProviderID() && !selectedProviderKnown()}>
                <option value={selectedProviderID()}>{selectedProviderID()}（当前已设置）</option>
              </Show>
              <For each={providerOptions()}>
                {(item) => (
                  <option value={item.provider_id}>{item.provider_name}</option>
                )}
              </For>
            </select>
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={selectedModelID()}
              disabled={!selectedProviderID()}
              onChange={(event) => {
                const modelID = event.currentTarget.value.trim()
                const providerID = selectedProviderID()
                if (!providerID || !modelID) {
                  setState("model", "")
                  return
                }
                setState("model", `${providerID}/${modelID}`)
              }}
            >
              <option value="">
                {selectedProviderID() ? "选择模型" : "请先选择供应商"}
              </option>
              <Show when={selectedModelID() && !selectedModelKnown()}>
                <option value={selectedModelID()}>{selectedModelID()}（当前已设置）</option>
              </Show>
              <For each={selectedProviderModels()}>
                {(item) => <option value={item.model_id}>{item.model_name}</option>}
              </For>
            </select>
          </div>
          <div class="text-12-regular text-text-weak">当前设置：{currentModelText()}</div>
          <div class="text-12-regular text-text-weak">{self() ? "这里只影响你的个人默认模型，不会改写系统默认执行路径。" : "未指定时会自动回退到第一个全局默认模型。"}</div>
          <div class="flex items-center gap-2">
            <Button type="button" onClick={() => void saveControl()} disabled={state.pending}>
              {state.pending ? "保存中..." : "保存控制项"}
            </Button>
          </div>
        </div>

        <Show when={canViewSystemReadonly()}>
          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">系统候选（只读）</div>
            <div class="text-12-regular text-text-weak">系统指定模型：{state.globalModel || "-"}</div>
            <div class="text-12-regular text-text-weak">系统小模型：{state.globalSmallModel || "-"}</div>
            <div class="text-12-regular text-text-weak">
              系统模型池：
              {state.globalSessionModelPool.length > 0
                ? state.globalSessionModelPool
                    .flatMap((item) => item.models.map((model) => `${item.provider_id}/${model.model_id}`))
                    .join(", ")
                : "未配置"}
            </div>
            <div class="flex flex-wrap gap-2">
              <For each={state.selectableModels.filter((item) => item.source !== "user")}>
                {(item) => <Tag>{item.source === "pool" ? `池:${item.value}` : `系统:${item.value}`}</Tag>}
              </For>
            </div>
          </div>
        </Show>

        <Show when={!self()}>
          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">学生模型镜像配置</div>
            <div class="text-12-regular text-text-weak">
              这里配置后台异步采样使用的学生模型，不会改变当前教师模型的选择与路由。
            </div>
            <div class="text-12-regular text-text-weak">
              单独保存镜像配置时，不会提交当前页面其他尚未保存的全局模型控制修改。
            </div>
            <div class="text-12-regular text-text-weak">
              保存成功后会保留你当前页面里其他尚未提交的编辑内容，便于继续调整。
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select
                class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                value={mirrorProviderID()}
                onChange={(event) => {
                  const providerID = event.currentTarget.value.trim()
                  if (!providerID) {
                    setState("mirrorModel", "")
                    return
                  }
                  const first = poolProviderMap().get(providerID)?.models[0]?.model_id
                  setState("mirrorModel", first ? `${providerID}/${first}` : "")
                }}
              >
                <option value="">关闭镜像采样</option>
                <Show when={mirrorProviderID() && !mirrorProviderKnown()}>
                  <option value={mirrorProviderID()}>{mirrorProviderID()}（当前已设置）</option>
                </Show>
                <For each={poolProviderOptions()}>
                  {(item) => <option value={item.provider_id}>{item.provider_name}</option>}
                </For>
              </select>
              <select
                class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                value={mirrorModelID()}
                disabled={!mirrorProviderID()}
                onChange={(event) => {
                  const modelID = event.currentTarget.value.trim()
                  if (!mirrorProviderID() || !modelID) {
                    setState("mirrorModel", "")
                    return
                  }
                  setState("mirrorModel", `${mirrorProviderID()}/${modelID}`)
                }}
              >
                <option value="">{mirrorProviderID() ? "选择学生模型" : "请先选择学生渠道"}</option>
                <Show when={mirrorModelID() && !mirrorModelKnown()}>
                  <option value={mirrorModelID()}>{mirrorModelID()}（当前已设置）</option>
                </Show>
                <For each={mirrorProviderModels()}>
                  {(item) => <option value={item.model_id}>{item.model_name}</option>}
                </For>
              </select>
            </div>
            <div class="text-12-regular text-text-weak">当前设置：{mirrorCurrentText()}</div>
            <div class="flex items-center gap-2">
              <Button type="button" onClick={() => void saveMirrorControl()} disabled={state.pending}>
                {state.pending ? "保存中..." : "保存镜像配置"}
              </Button>
            </div>
          </div>

          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="text-14-medium text-text-strong">Session 模型池</div>
              <div class="text-12-regular text-text-weak">先按渠道权重抽签，再按渠道下模型权重抽签；命中后整段 session 固定使用该模型。</div>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={addPoolProvider}
              disabled={state.pending || poolProviderOptions().length === 0}
            >
              添加渠道
            </Button>
          </div>

          <Show
            when={state.sessionModelPool.length > 0}
            fallback={<div class="text-12-regular text-text-weak">未配置时继续使用上面的单模型回退。</div>}
          >
            <For each={state.sessionModelPool}>
              {(provider, providerIndex) => (
                <div class="rounded-lg border border-border-weak-base bg-surface-base p-3 flex flex-col gap-3">
                  <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-2">
                    <select
                      class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                      value={provider.provider_id}
                      onChange={(event) => updatePoolProvider(providerIndex(), event.currentTarget.value.trim())}
                    >
                      <option value="">选择渠道</option>
                      <For each={poolProviderOptions()}>
                        {(item) => <option value={item.provider_id}>{item.provider_name}</option>}
                      </For>
                    </select>
                    <input
                      class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                      inputMode="numeric"
                      placeholder="渠道权重"
                      value={provider.weight}
                      onInput={(event) => setState("sessionModelPool", providerIndex(), "weight", event.currentTarget.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setState("sessionModelPool", (items) => items.filter((_, index) => index !== providerIndex()))}
                      disabled={state.pending}
                    >
                      删除渠道
                    </Button>
                  </div>

                  <div class="flex flex-col gap-2">
                    <For each={provider.models}>
                      {(model, modelIndex) => (
                        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-2">
                          <select
                            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                            value={model.model_id}
                            onChange={(event) =>
                              setState("sessionModelPool", providerIndex(), "models", modelIndex(), "model_id", event.currentTarget.value)
                            }
                          >
                            <option value="">选择模型</option>
                            <For each={poolProviderMap().get(provider.provider_id)?.models ?? []}>
                              {(item) => <option value={item.model_id}>{item.model_name}</option>}
                            </For>
                          </select>
                          <input
                            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                            inputMode="numeric"
                            placeholder="模型权重"
                            value={model.weight}
                            onInput={(event) =>
                              setState("sessionModelPool", providerIndex(), "models", modelIndex(), "weight", event.currentTarget.value)
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setState("sessionModelPool", providerIndex(), "models", (items) =>
                                items.filter((_, index) => index !== modelIndex()),
                              )
                            }
                            disabled={state.pending}
                          >
                            删除模型
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => addPoolModel(providerIndex())} disabled={state.pending}>
                      添加模型
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </Show>

          <div class="flex items-center gap-2">
            <Button type="button" onClick={() => void saveControl()} disabled={state.pending}>
              {state.pending ? "保存中..." : "保存模型池"}
            </Button>
          </div>
          </div>
        </Show>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">添加供应商</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={icon(item.id)} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(value) => <span class="text-12-regular text-text-weak pl-8">{language.t(value())}</span>}
                    </Show>
                  </div>
                  <Button size="large" variant="secondary" icon="plus-small" onClick={() => openConnect(item.id)} disabled={state.pending}>
                    连接
                  </Button>
                </div>
              )}
            </For>

            <div class="flex items-center justify-between gap-4 min-h-16 border-b border-border-weak-base last:border-none flex-wrap py-3">
              <div class="flex flex-col min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProviderIcon id={icon("synthetic")} class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span class="text-12-regular text-text-weak pl-8">{language.t("settings.providers.custom.description")}</span>
              </div>
              <Button size="large" variant="secondary" icon="plus-small" onClick={openCustom} disabled={state.pending}>
                连接
              </Button>
            </div>
          </div>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => dialog.show(() => <DialogSelectProvider scope={props.scope} onComplete={() => void load()} />)}
            disabled={state.pending}
          >
            查看全部供应商
          </Button>
        </div>

        <div ref={configRef} class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <div class="text-14-medium text-text-strong">供应商配置</div>
            <Show when={state.providerID.trim()}>
              <div class="text-12-regular text-text-weak">当前编辑：{name(state.providerID.trim())}</div>
            </Show>
          </div>
          <input
            ref={configInputRef}
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
            placeholder="供应商标识（编码）"
            value={state.providerID}
            onInput={(event) => setState("providerID", event.currentTarget.value)}
            list="provider-config-catalog-global"
          />
          <datalist id="provider-config-catalog-global">
            <For each={catalog()}>
              {(item) => <option value={item.id}>{item.name}</option>}
            </For>
          </datalist>
          <textarea
            class="min-h-48 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-13-regular font-mono"
            placeholder="当前供应商的 provider config JSON"
            value={state.providerConfigText}
            onInput={(event) => setState("providerConfigText", event.currentTarget.value)}
          />
          <div class="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveProviderConfig()} disabled={state.pending || !state.providerID.trim()}>
              保存供应商配置
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void removeProviderConfig()}
              disabled={state.pending || !state.providerID.trim()}
            >
              删除供应商配置
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openConnect(state.providerID.trim())}
              disabled={state.pending || !state.providerID.trim()}
            >
              设置或更新密钥
            </Button>
          </div>
          <Show when={available().length > 0}>
            <div class="text-12-regular text-text-weak">未配置但可直接选择的供应商：{available().slice(0, 12).map((item) => item.id).join(", ")}</div>
          </Show>
        </div>
      </div>
    </div>
  )
}

// Legacy per-user/local provider configuration has been fully removed by design.

export const SettingsProviders: Component<{ scope?: ProviderSettingsScope }> = (props) => {
  const auth = useAccountAuth()
  const scope = createMemo<Extract<ProviderSettingsScope, { kind: "global" | "self" }>>(() => {
    if (props.scope?.kind === "self" || props.scope?.kind === "global") return props.scope
    return canUseBuildCapability(auth.user()) && !(auth.user()?.roles ?? []).includes("super_admin")
      ? { kind: "self" }
      : { kind: "global" }
  })
  return <ManagedProviders scope={scope()} />
}
