import { Button } from "@opencode-ai/ui/button"
import { createEffect, createSignal, Show } from "solid-js"
import { A } from "@solidjs/router"
import { useAccountAuth } from "@/context/account-auth"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

type Status = {
  provider_id: string
  configured: boolean
  source: "none" | "user" | "global"
  auth_type?: string
}

type Vho = {
  user_id: string
  phone?: string
  phone_bound?: boolean
  vho_user_id?: string
  vho_bound?: boolean
  bound: boolean
}

export default function AccountApiKeys() {
  const auth = useAccountAuth()
  const server = useServer()
  const platform = usePlatform()
  const [providerID, setProviderID] = createSignal("openai")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [status, setStatus] = createSignal<Status | undefined>()
  const [vho, setVho] = createSignal<Vho | undefined>()

  const fetcher = platform.fetch ?? globalThis.fetch

  const request = async (path: string) => {
    const current = server.current
    if (!current) return
    const endpoint = new URL(path, current.http.url).toString()
    const headers = new Headers()
    const token = AccountToken.access()
    if (token) headers.set("authorization", `Bearer ${token}`)
    const response = await fetcher(endpoint, {
      method: "GET",
      headers,
    })
    if (response.status !== 401 || !token) return response
    const refreshed = await AccountToken.refreshIfNeeded({
      baseUrl: current.http.url,
      fetcher,
    })
    if (!refreshed) {
      AccountToken.handleUnauthorized()
      return response
    }
    const retry = new Headers()
    retry.set("authorization", `Bearer ${refreshed}`)
    return fetcher(endpoint, {
      method: "GET",
      headers: retry,
    })
  }

  const query = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const id = providerID().trim()
    const response = await request(`/account/me/provider/${encodeURIComponent(id)}`).catch(() => undefined)
    setPending(false)
    if (!response?.ok) {
      setStatus(undefined)
      setError("查询失败")
      return
    }
    const body = await response
      .json()
      .catch(() => undefined)
      .then((item) => (item && typeof item === "object" ? (item as Status) : undefined))
    if (!body) {
      setError("查询失败")
      setStatus(undefined)
      return
    }
    setStatus(body)
  }

  const loadVho = async () => {
    const response = await request("/account/me/vho-bind").catch(() => undefined)
    if (!response?.ok) {
      setVho(undefined)
      return
    }
    const body = await response
      .json()
      .catch(() => undefined)
      .then((item) => (item && typeof item === "object" ? (item as Vho) : undefined))
    setVho(body)
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void loadVho()
  })

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={query}>
        <div class="text-20-medium text-text-strong">模型配置状态</div>
        <div class="text-12-regular text-text-weak">当前账号仅可查看供应商配置状态，密钥由管理员统一维护。</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="供应商标识（如 openai / anthropic）"
          value={providerID()}
          onInput={(event) => setProviderID(event.currentTarget.value)}
        />
        <Show when={error()}>
          <div class="text-12-regular text-icon-critical-base">{error()}</div>
        </Show>
        <Show when={status()}>
          {(item) => (
            <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
              <div>供应商: {item().provider_id}</div>
              <div>是否配置: {item().configured ? "已配置" : "未配置"}</div>
              <div>配置来源: {item().source === "global" ? "全局" : item().source === "user" ? "个人" : "无"}</div>
              <div>认证类型: {item().auth_type ?? "-"}</div>
            </div>
          )}
        </Show>
        <Show when={vho()}>
          {(item) => (
            <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
              <div>手机号绑定: {item().phone_bound || item().phone ? "已绑定" : "未绑定"}</div>
              <div>VHO 绑定: {item().vho_bound || item().bound ? "已绑定" : "未绑定"}</div>
              <div>手机号: {item().phone ?? "-"}</div>
              <div>VHO 用户ID: {item().vho_user_id ?? "-"}</div>
            </div>
          )}
        </Show>
        <Button type="submit" disabled={pending() || !providerID().trim()}>
          {pending() ? "查询中..." : "查询状态"}
        </Button>
        <div class="flex items-center justify-between text-12-regular text-text-weak">
          <A href="/settings/security" class="hover:text-text-strong">
            账号安全
          </A>
          <A href="/approval" class="hover:text-text-strong">
            审批流
          </A>
          <Show
            when={
              auth.has("org:manage") ||
              auth.has("user:manage") ||
              auth.has("role:manage") ||
              auth.has("audit:view") ||
              auth.has("provider:config_global")
            }
          >
            <A href="/settings/account-admin" class="hover:text-text-strong">
              账号管理
            </A>
          </Show>
          <A href="/" class="hover:text-text-strong">
            返回应用
          </A>
        </div>
      </form>
    </div>
  )
}
