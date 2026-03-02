import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

function jsonObj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

export async function parseAccountError(response?: Response) {
  if (!response) return "请求失败"
  const payload = jsonObj(await response.json().catch(() => undefined))
  const code = typeof payload?.code === "string" ? payload.code : typeof payload?.error === "string" ? payload.error : ""
  if (!code) return "请求失败"
  if (code === "forbidden") return "无权限操作"
  if (code === "password_invalid") return "当前密码错误"
  if (code === "new_password_invalid") return "新密码至少需要 8 位"
  if (code === "username_exists") return "用户名已存在"
  if (code === "org_missing") return "组织不存在"
  if (code === "department_missing") return "部门不存在"
  if (code === "role_missing") return "角色不存在"
  if (code === "permission_missing") return "权限项不存在"
  if (code === "user_missing") return "用户不存在"
  if (code === "api_key_invalid") return "API 密钥不能为空"
  if (code === "api_key_not_found") return "未找到对应的 API 密钥"
  if (code === "invalid_credentials") return "账号或密码错误"
  if (code === "user_locked") return "账号已被锁定，请稍后再试"
  if (code === "account_disabled") return "账号系统未启用"
  return `操作失败：${code}`
}

export function useAccountRequest() {
  const server = useServer()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  return async (input: {
    path: string
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
    body?: Record<string, unknown>
  }) => {
    const current = server.current
    if (!current) return
    const endpoint = new URL(input.path, current.http.url).toString()
    const headers = new Headers()
    const token = AccountToken.access()
    if (token) headers.set("authorization", `Bearer ${token}`)
    if (input.body) headers.set("content-type", "application/json")

    const response = await fetcher(endpoint, {
      method: input.method ?? "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })

    if (response.status !== 401 || !token) return response

    const refreshed = await AccountToken.refreshIfNeeded({
      baseUrl: current.http.url,
      fetcher,
    })
    if (!refreshed) return response

    const retry = new Headers(headers)
    retry.set("authorization", `Bearer ${refreshed}`)
    return fetcher(endpoint, {
      method: input.method ?? "GET",
      headers: retry,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
  }
}
