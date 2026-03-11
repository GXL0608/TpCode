const default_base_url = "http://123.57.5.73:9527/prod-api"
const default_timeout_ms = 5000

type FailCode = "request_failed" | "invalid_json"

type Result<T> =
  | {
      ok: true
      status: number
      data: T
    }
  | {
      ok: false
      code: FailCode
      message: string
      status?: number
    }

function text(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function baseUrl() {
  const value = process.env["TPCODE_THIRD_API_BASE_URL"]?.trim() || default_base_url
  return value.replace(/\/+$/, "")
}

function timeoutMs() {
  const value = Number(process.env["TPCODE_THIRD_API_TIMEOUT_MS"]?.trim() || default_timeout_ms)
  return Number.isFinite(value) && value > 0 ? value : default_timeout_ms
}

function pathUrl(path: string) {
  return path.startsWith("/") ? path : `/${path}`
}

export namespace ThirdPartyClient {
  export async function post<T>(path: string, body: unknown): Promise<Result<T>> {
    const response = await fetch(`${baseUrl()}${pathUrl(path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    if (!response.ok) {
      return {
        ok: false as const,
        code: "request_failed",
        message: `第三方接口请求失败：${text(response.error)}`,
      }
    }

    const payload = await response.value.json()
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const }))
    if (!payload.ok) {
      return {
        ok: false as const,
        code: "invalid_json",
        status: response.value.status,
        message: "第三方接口响应不是合法 JSON",
      }
    }

    return {
      ok: true as const,
      status: response.value.status,
      data: payload.value as T,
    }
  }
}
