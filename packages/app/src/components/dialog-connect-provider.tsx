import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, Match, onCleanup, onMount, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { DialogSelectModel } from "./dialog-select-model"
import { DialogSelectProvider } from "./dialog-select-provider"
import type { ProviderSettingsScope } from "./provider-settings-scope"

export function DialogConnectProvider(props: { provider: string; scope?: ProviderSettingsScope; onComplete?: () => void }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const account = useAccountAuth()
  const accountRequest = useAccountRequest()
  const scope = () => props.scope ?? (account.enabled() ? ({ kind: "self" } satisfies ProviderSettingsScope) : ({ kind: "local" } satisfies ProviderSettingsScope))
  const canManage = () => {
    const current = scope()
    if (current.kind === "global") return account.has("provider:config_global")
    if (current.kind === "user") return account.has("provider:config_user")
    return !account.enabled() || account.has("provider:config_own")
  }

  if (!canManage()) {
    return (
      <Dialog title={language.t("command.provider.connect")} transition>
        <div class="text-14-regular text-text-weak">当前账号没有供应商配置权限。</div>
      </Dialog>
    )
  }

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    alive.value = false
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const provider = createMemo(() => {
    const found = globalSync.data.provider.all.find((x) => x.id === props.provider)
    if (found) return found
    return {
      id: props.provider,
      name: props.provider,
      env: [],
      models: {},
    }
  })
  const methods = createMemo(
    () => {
      const current = scope()
      if (current.kind === "global" || current.kind === "user") {
        return [
          {
            type: "api",
            label: language.t("provider.connect.method.apiKey"),
          },
        ]
      }
      return (
        globalSync.data.provider_auth[props.provider] ?? [
          {
            type: "api",
            label: language.t("provider.connect.method.apiKey"),
          },
        ]
      )
    },
  )
  const [store, setStore] = createStore({
    methodIndex: undefined as undefined | number,
    authorization: undefined as undefined | ProviderAuthAuthorization,
    state: "pending" as undefined | "pending" | "complete" | "error",
    error: undefined as string | undefined,
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.pending" }
    | { type: "auth.complete"; authorization: ProviderAuthAuthorization }
    | { type: "auth.error"; error: string }

  function dispatch(action: Action) {
    setStore(
      produce((draft) => {
        if (action.type === "method.select") {
          draft.methodIndex = action.index
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.reset") {
          draft.methodIndex = undefined
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined
          return
        }
        if (action.type === "auth.complete") {
          draft.state = "complete"
          draft.authorization = action.authorization
          draft.error = undefined
          return
        }
        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const method = createMemo(() => (store.methodIndex !== undefined ? methods().at(store.methodIndex!) : undefined))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  function formatError(value: unknown, fallback: string): string {
    if (value && typeof value === "object" && "data" in value) {
      const data = (value as { data?: { message?: unknown } }).data
      if (typeof data?.message === "string" && data.message) return data.message
    }
    if (value && typeof value === "object" && "error" in value) {
      const nested = formatError((value as { error?: unknown }).error, "")
      if (nested) return nested
    }
    if (value && typeof value === "object" && "message" in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === "string" && message) return message
    }
    if (value instanceof Error && value.message) return value.message
    if (typeof value === "string" && value) return value
    return fallback
  }

  async function selectMethod(index: number) {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    const method = methods()[index]
    dispatch({ type: "method.select", index })

    if (method.type === "oauth") {
      dispatch({ type: "auth.pending" })
      const start = Date.now()
      await globalSDK.client.provider.oauth
        .authorize(
          {
            providerID: props.provider,
            method: index,
          },
          { throwOnError: true },
        )
        .then((x) => {
          if (!alive.value) return
          const elapsed = Date.now() - start
          const delay = 1000 - elapsed

          if (delay > 0) {
            if (timer.current !== undefined) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              timer.current = undefined
              if (!alive.value) return
              dispatch({ type: "auth.complete", authorization: x.data! })
            }, delay)
            return
          }
          dispatch({ type: "auth.complete", authorization: x.data! })
        })
        .catch((e) => {
          if (!alive.value) return
          dispatch({ type: "auth.error", error: formatError(e, language.t("common.requestFailed")) })
        })
    }
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  onMount(() => {
    if (methods().length === 1) {
      selectMethod(0)
    }
  })

  async function complete() {
    await globalSDK.client.global.dispose()
    dialog.close()
    props.onComplete?.()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })
  }

  async function enableProvider() {
    if (!account.enabled()) {
      const disabled = globalSync.data.config.disabled_providers ?? []
      const enabled = globalSync.data.config.enabled_providers
      const nextDisabled = disabled.filter((item) => item !== props.provider)
      const nextEnabled =
        enabled && enabled.length > 0 && !enabled.includes(props.provider) ? [...enabled, props.provider] : enabled
      if (nextDisabled.length === disabled.length && nextEnabled === enabled) return
      await globalSync.updateConfig({
        disabled_providers: nextDisabled,
        enabled_providers: nextEnabled,
      })
      return
    }
    const current = scope()
    if (current.kind === "self") {
      const control = await accountRequest({
        path: "/account/me/provider-control",
      }).catch(() => undefined)
      const body = control?.ok
        ? ((await control.json().catch(() => undefined)) as {
            model?: string
            small_model?: string
            enabled_providers?: string[]
            disabled_providers?: string[]
            model_prefs?: Record<string, unknown>
          } | undefined)
        : undefined
      const enabled =
        body?.enabled_providers && body.enabled_providers.length > 0 && !body.enabled_providers.includes(props.provider)
          ? [...body.enabled_providers, props.provider]
          : body?.enabled_providers
      const response = await accountRequest({
        method: "PUT",
        path: "/account/me/provider-control",
        body: {
          enabled_providers: enabled,
          disabled_providers: (body?.disabled_providers ?? []).filter((item) => item !== props.provider),
        },
      }).catch(() => undefined)
      if (response?.ok) return
      throw new Error(await parseAccountError(response))
    }
    if (current.kind === "user") {
      const control = await accountRequest({
        path: `/account/admin/users/${encodeURIComponent(current.userID)}/provider-control`,
      }).catch(() => undefined)
      const body = control?.ok
        ? ((await control.json().catch(() => undefined)) as {
            model?: string
            small_model?: string
            enabled_providers?: string[]
            disabled_providers?: string[]
            model_prefs?: Record<string, unknown>
          } | undefined)
        : undefined
      const enabled =
        body?.enabled_providers && body.enabled_providers.length > 0 && !body.enabled_providers.includes(props.provider)
          ? [...body.enabled_providers, props.provider]
          : body?.enabled_providers
      const response = await accountRequest({
        method: "PUT",
        path: `/account/admin/users/${encodeURIComponent(current.userID)}/provider-control`,
        body: {
          enabled_providers: enabled,
          disabled_providers: (body?.disabled_providers ?? []).filter((item) => item !== props.provider),
        },
      }).catch(() => undefined)
      if (response?.ok) return
      throw new Error(await parseAccountError(response))
    }
    if (current.kind === "global") {
      const control = await accountRequest({
        path: "/account/admin/provider-control/global",
      }).catch(() => undefined)
      const body = control?.ok
        ? ((await control.json().catch(() => undefined)) as {
            model?: string
            small_model?: string
            enabled_providers?: string[]
            disabled_providers?: string[]
            model_prefs?: Record<string, unknown>
          } | undefined)
        : undefined
      const enabled =
        body?.enabled_providers && body.enabled_providers.length > 0 && !body.enabled_providers.includes(props.provider)
          ? [...body.enabled_providers, props.provider]
          : body?.enabled_providers
      const response = await accountRequest({
        method: "PUT",
        path: "/account/admin/provider-control/global",
        body: {
          model: body?.model,
          small_model: body?.small_model,
          enabled_providers: enabled,
          disabled_providers: (body?.disabled_providers ?? []).filter((item) => item !== props.provider),
          model_prefs: body?.model_prefs,
        },
      }).catch(() => undefined)
      if (response?.ok) return
      throw new Error(await parseAccountError(response))
    }
  }

  async function writeAPIKey(apiKey: string) {
    const current = scope()
    if (current.kind === "global") {
      const response = await accountRequest({
        method: "PUT",
        path: `/account/admin/provider/${encodeURIComponent(props.provider)}/global`,
        body: {
          type: "api",
          key: apiKey,
        },
      }).catch(() => undefined)
      if (!response?.ok) throw new Error(await parseAccountError(response))
      return
    }
    if (current.kind === "user") {
      const response = await accountRequest({
        method: "PUT",
        path: `/account/admin/users/${encodeURIComponent(current.userID)}/providers/${encodeURIComponent(props.provider)}`,
        body: {
          type: "api",
          key: apiKey,
        },
      }).catch(() => undefined)
      if (!response?.ok) throw new Error(await parseAccountError(response))
      return
    }
    await globalSDK.client.auth.set({
      providerID: props.provider,
      auth: {
        type: "api",
        key: apiKey,
      },
    })
  }

  function goBack() {
    if (methods().length === 1) {
      dialog.show(() => <DialogSelectProvider scope={scope()} onComplete={props.onComplete} />)
      return
    }
    if (store.authorization) {
      dispatch({ type: "method.reset" })
      return
    }
    if (store.methodIndex !== undefined) {
      dispatch({ type: "method.reset" })
      return
    }
    dialog.show(() => <DialogSelectProvider scope={scope()} onComplete={props.onComplete} />)
  }

  function MethodSelection() {
    return (
      <>
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div>
          <List
            ref={(ref) => {
              listRef = ref
            }}
            items={methods}
            key={(m) => m?.label}
            onSelect={async (selected, index) => {
              if (!selected) return
              selectMethod(index)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2">
                <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                  <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                </div>
                <span>{methodLabel(i)}</span>
              </div>
            )}
          </List>
        </div>
      </>
    )
  }

  function ApiAuthView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const apiKey = formData.get("apiKey") as string

      if (!apiKey?.trim()) {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      setFormStore("error", undefined)
      await writeAPIKey(apiKey)
      await enableProvider()
      await complete()
    }

    return (
      <div class="flex flex-col gap-6">
        <Switch>
          <Match when={provider().id === "opencode"}>
            <div class="flex flex-col gap-4">
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line1")}</div>
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line2")}</div>
              <div class="text-14-regular text-text-base">
                {language.t("provider.connect.opencodeZen.visit.prefix")}
                <Link href="https://opencode.ai/zen" tabIndex={-1}>
                  {language.t("provider.connect.opencodeZen.visit.link")}
                </Link>
                {language.t("provider.connect.opencodeZen.visit.suffix")}
              </div>
            </div>
          </Match>
          <Match when={true}>
            <div class="text-14-regular text-text-base">
              {language.t("provider.connect.apiKey.description", { provider: provider().name })}
            </div>
          </Match>
        </Switch>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
            placeholder={language.t("provider.connect.apiKey.placeholder")}
            name="apiKey"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.submit")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    onMount(() => {
      if (store.authorization?.method === "code" && store.authorization?.url) {
        platform.openLink(store.authorization.url)
      }
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const code = formData.get("code") as string

      if (!code?.trim()) {
        setFormStore("error", language.t("provider.connect.oauth.code.required"))
        return
      }

      setFormStore("error", undefined)
      const result = await globalSDK.client.provider.oauth
        .callback({
          providerID: props.provider,
          method: store.methodIndex,
          code,
        })
        .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))
      if (result.ok) {
        await enableProvider()
        await complete()
        return
      }
      setFormStore("error", formatError(result.error, language.t("provider.connect.oauth.code.invalid")))
    }

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.code.visit.link")}</Link>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
            placeholder={language.t("provider.connect.oauth.code.placeholder")}
            name="code"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.submit")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    const code = createMemo(() => {
      const instructions = store.authorization?.instructions
      if (instructions?.includes(":")) {
        return instructions.split(":")[1]?.trim()
      }
      return instructions
    })

    onMount(() => {
      void (async () => {
        if (store.authorization?.url) {
          platform.openLink(store.authorization.url)
        }

        const result = await globalSDK.client.provider.oauth
          .callback({
            providerID: props.provider,
            method: store.methodIndex,
          })
          .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
          .catch((error) => ({ ok: false as const, error }))

        if (!alive.value) return

        if (!result.ok) {
          const message = formatError(result.error, language.t("common.requestFailed"))
          dispatch({ type: "auth.error", error: message })
          return
        }

        await enableProvider()
        await complete()
      })()
    })

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.auto.visit.link")}</Link>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
        </div>
        <TextField
          label={language.t("provider.connect.oauth.auto.confirmationCode")}
          class="font-mono"
          value={code()}
          readOnly
          copyable
        />
        <div class="text-14-regular text-text-base flex items-center gap-4">
          <Spinner />
          <span>{language.t("provider.connect.status.waiting")}</span>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.provider as IconName} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            <Switch>
              <Match when={props.provider === "anthropic" && method()?.label?.toLowerCase().includes("max")}>
                {language.t("provider.connect.title.anthropicProMax")}
              </Match>
              <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
            </Switch>
          </div>
        </div>
        <div class="px-2.5 pb-10 flex flex-col gap-6">
          <div onKeyDown={handleKey} tabIndex={0} autofocus={store.methodIndex === undefined ? true : undefined}>
            <Switch>
              <Match when={store.methodIndex === undefined}>
                <MethodSelection />
              </Match>
              <Match when={store.state === "pending"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={store.state === "error"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                    <span>{language.t("provider.connect.status.failed", { error: store.error ?? "" })}</span>
                  </div>
                </div>
              </Match>
              <Match when={method()?.type === "api"}>
                <ApiAuthView />
              </Match>
              <Match when={method()?.type === "oauth"}>
                <Switch>
                  <Match when={store.authorization?.method === "code"}>
                    <OAuthCodeView />
                  </Match>
                  <Match when={store.authorization?.method === "auto"}>
                    <OAuthAutoView />
                  </Match>
                </Switch>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
