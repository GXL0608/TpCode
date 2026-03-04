import { Button } from "@opencode-ai/ui/button"
import { createSignal, Show } from "solid-js"
import { A } from "@solidjs/router"
import { useAccountAuth } from "@/context/account-auth"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

export default function AccountApiKeys() {
  const auth = useAccountAuth()
  const server = useServer()
  const platform = usePlatform()
  const [providerID, setProviderID] = createSignal("openai")
  const [key, setKey] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")

  const fetcher = platform.fetch ?? globalThis.fetch

  const parseError = async (response?: Response) => {
    if (!response) return "请求失败"
    const payload = await response
      .json()
      .catch(() => undefined)
      .then((value) => (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined))
    const code = typeof payload?.code === "string" ? payload.code : undefined
    if (code === "forbidden") return "无权限操作该供应商配置"
    if (code) return `操作失败：${code}`
    return "请求失败"
  }

  const request = async (input: { method: "PUT" | "DELETE"; path: string; body?: Record<string, unknown> }) => {
    const current = server.current
    if (!current) return
    const endpoint = new URL(input.path, current.http.url).toString()
    const headers = new Headers()
    const token = AccountToken.access()
    if (token) headers.set("authorization", `Bearer ${token}`)
    if (input.body) headers.set("content-type", "application/json")
    const response = await fetcher(endpoint, {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
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
    if (input.body) retry.set("content-type", "application/json")
    return fetcher(endpoint, {
      method: input.method,
      headers: retry,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
  }

  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setMessage("")
    setError("")
    const response = await request({
      method: "PUT",
      path: `/auth/${encodeURIComponent(providerID().trim())}`,
      body: { type: "api", key: key() },
    }).catch(() => undefined)
    setPending(false)
    if (!response?.ok) {
      setError(await parseError(response))
      return
    }
    setMessage("已保存")
    setKey("")
  }

  const remove = async () => {
    setPending(true)
    setMessage("")
    setError("")
    const response = await request({
      method: "DELETE",
      path: `/auth/${encodeURIComponent(providerID().trim())}`,
    }).catch(() => undefined)
    setPending(false)
    if (!response?.ok) {
      setError(await parseError(response))
      return
    }
    setMessage("已删除")
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={save}>
        <div class="text-20-medium text-text-strong">我的接口密钥</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="供应商标识（如 openai / anthropic）"
          value={providerID()}
          onInput={(event) => setProviderID(event.currentTarget.value)}
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="接口密钥"
          value={key()}
          onInput={(event) => setKey(event.currentTarget.value)}
        />
        <Show when={error()}>
          <div class="text-12-regular text-icon-critical-base">{error()}</div>
        </Show>
        <Show when={message()}>
          <div class="text-12-regular text-icon-success-base">{message()}</div>
        </Show>
        <div class="flex gap-2">
          <Button type="submit" disabled={pending() || !providerID().trim() || !key()}>
            {pending() ? "保存中..." : "保存"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending() || !providerID().trim()} onClick={remove}>
            {pending() ? "处理中..." : "删除"}
          </Button>
        </div>
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
