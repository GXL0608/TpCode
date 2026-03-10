import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import { createEffect, createMemo, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useAccountAuth } from "@/context/account-auth"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createStore } from "solid-js/store"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import type { ProviderSettingsScope } from "./provider-settings-scope"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]
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

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function icon(id: string): IconName {
  if (iconNames.includes(id as IconName)) return id as IconName
  return "synthetic"
}

function note(id: string) {
  return PROVIDER_NOTES.find((item) => item.match(id))?.key
}

function resolveScope(auth: ReturnType<typeof useAccountAuth>, scope?: ProviderSettingsScope): ProviderSettingsScope {
  if (auth.enabled()) return { kind: "global" }
  if (scope) return scope
  return { kind: "local" }
}

const ManagedProviders: Component<{ scope: Extract<ProviderSettingsScope, { kind: "global" }> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const auth = useAccountAuth()
  const accountRequest = useAccountRequest()
  const globalSDK = useGlobalSDK()
  const providers = useProviders()

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
  const canManage = createMemo(() => (auth.user()?.roles ?? []).includes("super_admin"))
  const title = createMemo(() => "全局提供商配置")
  const description = createMemo(() => "管理员在这里统一配置供应商、模型和默认项，所有成员直接生效。")
  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    providerID: "",
    providerConfigText: "{}",
    rows: [] as ManagedRow[],
    model: "",
    smallModel: "",
    enabledProviders: "",
    disabledProviders: "",
  })
  let configRef: HTMLDivElement | undefined
  let configInputRef: HTMLInputElement | undefined

  const configuredIDs = createMemo(() => new Set(state.rows.map((item) => item.provider_id)))
  const disabledSet = createMemo(() => new Set(parseList(state.disabledProviders)))
  const modelOptions = createMemo(() => {
    const all = providers.all()
    const rows = state.rows.filter((item) => !item.disabled && !disabledSet().has(item.provider_id))
    const list = [] as ManagedModelOption[]
    for (const row of rows) {
      const provider = all.find((item) => item.id === row.provider_id)
      if (!provider) continue
      const provider_name = provider.name?.trim() || provider.id
      for (const model of Object.values(provider.models)) {
        const model_id = model.id
        const model_name = model.name?.trim() || model.id
        list.push({
          value: `${provider.id}/${model.id}`,
          provider_id: provider.id,
          provider_name,
          model_id,
          model_name,
        })
      }
    }
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
  const selectedProviderID = createMemo(() => state.model.trim().split("/")[0] ?? "")
  const selectedModelID = createMemo(() => {
    const raw = state.model.trim()
    const [providerID, ...rest] = raw.split("/")
    if (!providerID || rest.length === 0) return ""
    return rest.join("/")
  })
  const selectedProviderModels = createMemo(() =>
    modelOptions().filter((item) => item.provider_id === selectedProviderID()),
  )
  const selectedProviderKnown = createMemo(() =>
    providerOptions().some((item) => item.provider_id === selectedProviderID()),
  )
  const selectedModelKnown = createMemo(() =>
    selectedProviderModels().some((item) => item.model_id === selectedModelID()),
  )
  const currentModelText = createMemo(() => {
    const value = state.model.trim()
    if (!value) return "未指定（自动回退）"
    const found = modelOptions().find((item) => item.value === value)
    if (found) return `${found.provider_name} / ${found.model_name}`
    return value
  })
  const popular = createMemo(() =>
    popularProviders
      .map((id) => catalogMap().get(id))
      .filter((item): item is { id: string; name: string } => !!item && !configuredIDs().has(item.id)),
  )
  const available = createMemo(() => catalog().filter((item) => !configuredIDs().has(item.id)))
  const name = (providerID: string) => catalogMap().get(providerID)?.name ?? providerID

  const paths = () => {
    return {
      rows: "/account/admin/provider/global",
      control: "/account/admin/provider-control/global",
      config: (providerID: string) => `/account/admin/providers/${encodeURIComponent(providerID)}/config/global`,
      key: (providerID: string) => `/account/admin/provider/${encodeURIComponent(providerID)}/global`,
    }
  }

  const controlBody = (disabledProviders = state.disabledProviders) => {
    const enabled = parseList(state.enabledProviders)
    const disabled = parseList(disabledProviders)
    return {
      model: state.model.trim() || undefined,
      small_model: state.smallModel.trim() || undefined,
      enabled_providers: enabled.length > 0 ? enabled : undefined,
      disabled_providers: disabled.length > 0 ? disabled : undefined,
    }
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
    const controlResponse = await accountRequest({ path: paths().control }).catch(() => undefined)

    if (!rowsResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(rowsResponse))
      return
    }
    if (!controlResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(controlResponse))
      return
    }

    const control = (await controlResponse.json().catch(() => undefined)) as
      | { model?: unknown; small_model?: unknown; enabled_providers?: unknown; disabled_providers?: unknown }
      | undefined
    const disabled = new Set(list<string>(control?.disabled_providers))
    const rows = Object.entries(
      ((await rowsResponse.json().catch(() => undefined)) as Record<string, { type?: unknown }> | undefined) ?? {},
    ).map(([provider_id, auth]) => ({
      provider_id,
      configured: true,
      auth_type: typeof auth?.type === "string" ? auth.type : undefined,
      disabled: disabled.has(provider_id),
    }))

    const providerID =
      state.providerID.trim() ||
      rows[0]?.provider_id ||
      popularProviders.find((item) => catalogMap().has(item)) ||
      catalog()[0]?.id ||
      "openai"

    setState("rows", rows)
    setState("providerID", providerID)
    setState("model", typeof control?.model === "string" ? control.model : "")
    setState("smallModel", typeof control?.small_model === "string" ? control.small_model : "")
    setState("enabledProviders", list<string>(control?.enabled_providers).join(", "))
    setState("disabledProviders", list<string>(control?.disabled_providers).join(", "))
    setState("loading", false)
    await loadConfig(providerID)
  }

  const saveControl = async () => {
    if (!canManage()) return
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
    await complete("全局模型控制已更新")
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

  const removeProviderKey = async (providerID: string) => {
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await accountRequest({
      method: "DELETE",
      path: paths().key(providerID),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    await complete(`${name(providerID)} 密钥已删除`)
  }

  const toggleDisabled = async (providerID: string, disabled: boolean) => {
    const next = disabled
      ? [...new Set([...parseList(state.disabledProviders), providerID])]
      : parseList(state.disabledProviders).filter((item) => item !== providerID)
    const enabled = parseList(state.enabledProviders)
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
                          onClick={() => void removeProviderKey(item.provider_id)}
                          disabled={state.pending}
                        >
                          删除密钥
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
          <div class="text-14-medium text-text-strong">当前模型（全员生效）</div>
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
          <div class="text-12-regular text-text-weak">
            未指定时会自动回退到第一个全局默认模型。
          </div>
          <div class="flex items-center gap-2">
            <Button type="button" onClick={() => void saveControl()} disabled={state.pending}>
              {state.pending ? "保存中..." : "保存控制项"}
            </Button>
          </div>
        </div>

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

const LegacyProviders: Component<{ scope: Extract<ProviderSettingsScope, { kind: "local" | "self" }> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const auth = useAccountAuth()
  const accountRequest = useAccountRequest()
  const providers = useProviders()

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"
  const canManageProvider = createMemo(() => {
    if (props.scope.kind === "local") return true
    return auth.has("provider:config_own")
  })
  const key = (item: ProviderItem) => {
    if (!("key" in item)) return
    return typeof item.key === "string" ? item.key : undefined
  }
  const optionKey = (item: ProviderItem) => {
    if (!("options" in item)) return
    const options = item.options as Record<string, unknown> | undefined
    if (!options || typeof options !== "object") return
    const apiKey = options["apiKey"]
    if (typeof apiKey === "string" && apiKey.trim()) return apiKey
    const apiKeySnake = options["api_key"]
    if (typeof apiKeySnake === "string" && apiKeySnake.trim()) return apiKeySnake
    return
  }

  const isConfigCustom = (providerID: string) => {
    if (auth.enabled()) return false
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    if (auth.enabled()) {
      const response = await accountRequest({
        method: "PATCH",
        path: `/account/me/providers/${encodeURIComponent(providerID)}/disabled`,
        body: { disabled: true },
      }).catch(() => undefined)
      if (!response?.ok) {
        const message = await parseAccountError(response)
        showToast({ title: language.t("common.requestFailed"), description: message })
        return
      }
      await globalSDK.client.global.dispose().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
        description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
      })
      return
    }

    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    globalSync.set("config", "disabled_providers", next)

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(async () => {
        await globalSDK.client.global.dispose().catch(() => undefined)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (item: ProviderItem) => {
    const providerID = item.id
    const name = item.name
    const current = source(item)

    await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
    if (auth.enabled()) {
      await disableProvider(providerID, name)
      return
    }

    if (current === "config" || current === "custom" || isConfigCustom(providerID)) {
      await disableProvider(providerID, name)
      return
    }

    await globalSDK.client.global.dispose().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
      description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
    })
  }

  const keyText = (item: ProviderItem) => {
    if (!providerKey(item)) return "未配置"
    return "••••••••••••••••"
  }
  const providerKey = (item: ProviderItem) => {
    const value = key(item)?.trim() || optionKey(item)?.trim()
    if (!value) return
    return value
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <Show when={!canManageProvider()}>
          <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/10 px-4 py-3 text-13-regular text-text-warning-base">
            当前账号无“提供商配置”权限，仅可查看已连接状态。
          </div>
        </Show>
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <div class="flex flex-col gap-2">
            <Show
              when={connected().length > 0}
              fallback={
                <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="group rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-3">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="flex flex-col gap-2 min-w-0 flex-1">
                        <div class="flex items-center gap-3 min-w-0">
                          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-base border border-border-weak-base">
                            <ProviderIcon id={icon(item.id)} class="size-4 icon-strong-base" />
                          </div>
                          <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                          <Tag>{type(item)}</Tag>
                        </div>
                        <Show when={source(item) !== "env"}>
                          <div class="pl-11 flex flex-wrap items-center gap-2">
                            <span class="text-12-regular text-text-weak">当前密钥</span>
                            <code
                              class={
                                providerKey(item)
                                  ? "text-12-regular text-text-strong bg-surface-base px-2 py-1 rounded border border-border-weak-base break-all"
                                  : "text-12-regular text-text-weak bg-surface-base px-2 py-1 rounded border border-border-weak-base"
                              }
                            >
                              {keyText(item)}
                            </code>
                          </div>
                        </Show>
                      </div>
                      <Show
                        when={canManageProvider()}
                        fallback={<span class="text-13-regular text-text-weak pr-1 cursor-default">只读</span>}
                      >
                        <div class="flex items-center gap-2">
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              dialog.show(() => <DialogConnectProvider provider={item.id} scope={props.scope} />)
                            }}
                          >
                            更新密钥
                          </Button>
                          <Show
                            when={canDisconnect(item)}
                            fallback={
                              <span class="text-12-regular text-text-weak pr-1 cursor-default">
                                {language.t("settings.providers.connected.environmentDescription")}
                              </span>
                            }
                          >
                            <Button size="large" variant="ghost" onClick={() => void disconnect(item)}>
                              {language.t("common.disconnect")}
                            </Button>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={icon(item.id)} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={item.id === "opencode"}>
                        <span class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</span>
                      </Show>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={item.id === "opencode-go"}>
                        <>
                          <span class="text-14-regular text-text-weak">{language.t("dialog.provider.opencodeGo.tagline")}</span>
                          <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                        </>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(key) => <span class="text-12-regular text-text-weak pl-8">{language.t(key())}</span>}
                    </Show>
                  </div>
                  <Show when={canManageProvider()}>
                    <Button
                      size="large"
                      variant="secondary"
                      icon="plus-small"
                      onClick={() => {
                        dialog.show(() => <DialogConnectProvider provider={item.id} scope={props.scope} />)
                      }}
                    >
                      {language.t("common.connect")}
                    </Button>
                  </Show>
                </div>
              )}
            </For>

            <div
              class="flex items-center justify-between gap-4 min-h-16 border-b border-border-weak-base last:border-none flex-wrap py-3"
              data-component="custom-provider-section"
            >
              <div class="flex flex-col min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProviderIcon id={icon("synthetic")} class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span class="text-12-regular text-text-weak pl-8">{language.t("settings.providers.custom.description")}</span>
              </div>
              <Show when={canManageProvider()}>
                <Button
                  size="large"
                  variant="secondary"
                  icon="plus-small"
                  onClick={() => {
                    dialog.show(() => <DialogCustomProvider back="close" scope={props.scope} />)
                  }}
                >
                  {language.t("common.connect")}
                </Button>
              </Show>
            </div>
          </div>

          <Show when={canManageProvider()}>
            <Button
              variant="ghost"
              class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
              onClick={() => {
                dialog.show(() => <DialogSelectProvider scope={props.scope} />)
              }}
            >
              {language.t("dialog.provider.viewAll")}
            </Button>
          </Show>
        </div>
      </div>
    </div>
  )
}

export const SettingsProviders: Component<{ scope?: ProviderSettingsScope }> = (props) => {
  const auth = useAccountAuth()
  const view = createMemo(() => {
    const current = resolveScope(auth, props.scope)
    if (current.kind === "global" || current.kind === "user") return <ManagedProviders scope={{ kind: "global" }} />
    return <LegacyProviders scope={current} />
  })
  return view()
}
