import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

function jsonObj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

function isJSON(response?: Response) {
  if (!response) return false
  const type = response.headers.get("content-type")?.toLowerCase() ?? ""
  return type.includes("application/json")
}

function invalidAPIResponse() {
  return new Response(JSON.stringify({ error: "account_api_invalid_response" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  })
}

export async function parseAccountError(response?: Response) {
  if (!response) return "请求失败"
  const payload = jsonObj(await response.json().catch(() => undefined))
  const code = typeof payload?.code === "string" ? payload.code : typeof payload?.error === "string" ? payload.error : ""
  if (!code) return "请求失败"
  if (code === "forbidden") return "无权限操作"
  if (code === "password_invalid") return "密码格式不正确或当前密码错误"
  if (code === "new_password_invalid") return "新密码格式不正确（至少 8 位，且包含字母和数字）"
  if (code === "username_exists") return "用户名已存在"
  if (code === "org_missing") return "组织不存在"
  if (code === "department_missing") return "部门不存在"
  if (code === "role_missing") return "角色不存在"
  if (code === "role_exists") return "角色编码已存在"
  if (code === "role_builtin_forbidden") return "系统预置角色不允许删除"
  if (code === "role_code_invalid") return "角色编码格式不正确（小写字母开头，仅支持小写字母、数字、下划线）"
  if (code === "role_name_invalid") return "角色名称不能为空"
  if (code === "permission_missing") return "权限项不存在"
  if (code === "user_missing") return "用户不存在"
  if (code === "user_self_delete_forbidden") return "不允许删除当前登录账号"
  if (code === "user_builtin_forbidden") return "系统管理员账号不允许删除"
  if (code === "project_missing") return "项目不存在"
  if (code === "product_missing") return "产品不存在"
  if (code === "product_exists") return "产品名称已存在"
  if (code === "product_name_invalid") return "产品名称不能为空"
  if (code === "product_directory_exists") return "该目录已绑定其他产品"
  if (code === "phone_invalid") return "手机号格式不正确（示例：13800138000）"
  if (code === "api_key_invalid") return "API 密钥不能为空"
  if (code === "api_key_not_found") return "未找到对应的 API 密钥"
  if (code === "directory_missing") return "目录不存在或不可访问"
  if (code === "invalid_credentials") return "账号或密码错误"
  if (code === "user_locked") return "账号已被锁定，请稍后再试"
  if (code === "account_disabled") return "账号系统未启用"
  if (code === "account_route_missing") return "当前后端版本不支持该接口，请重启并升级后端服务"
  if (code === "account_api_invalid_response") return "后端接口响应异常（可能服务地址错误，或后端版本过旧）"
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
    headers.set("accept", "application/json")
    if (input.body) headers.set("content-type", "application/json")

    const response = await fetcher(endpoint, {
      method: input.method ?? "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })

    if (response.status !== 401 || !token) {
      if (response.ok && !isJSON(response)) return invalidAPIResponse()
      return response
    }

    const refreshed = await AccountToken.refreshIfNeeded({
      baseUrl: current.http.url,
      fetcher,
    })
    if (!refreshed) {
      AccountToken.handleUnauthorized()
      return response
    }

    const retry = new Headers(headers)
    retry.set("authorization", `Bearer ${refreshed}`)
    const next = await fetcher(endpoint, {
      method: input.method ?? "GET",
      headers: retry,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
    if (next.ok && !isJSON(next)) return invalidAPIResponse()
    return next
  }
}
