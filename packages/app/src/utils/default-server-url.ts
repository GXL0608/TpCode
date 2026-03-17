type Input = {
  runtime?: string
  stored?: string | null
  hostname: string
  origin: string
  dev: boolean
  devHost?: string
  devPort?: string
}

export function normalizeServerUrl(input?: string | null) {
  if (!input) return
  const value = input.trim()
  if (!value) return
  return value.replace(/\/+$/, "")
}

/** 中文注释：开发态未显式指定后端端口时，根据当前前端端口推导配对的本地后端地址。 */
function resolveDerivedLocalDevServerUrl(input: Pick<Input, "dev" | "hostname" | "origin" | "devHost" | "devPort">) {
  if (!input.dev) return
  if (input.devHost && input.devPort) return
  if (input.hostname !== "127.0.0.1" && input.hostname !== "localhost") return
  if (!URL.canParse(input.origin)) return
  const port = Number(new URL(input.origin).port)
  if (!Number.isInteger(port)) return
  if (port < 3000 || port > 3099) return
  return `http://${input.hostname}:${port + 1100}`
}

/** 中文注释：统一解析 Web 端默认服务器地址，确保显式运行时和开发配置优先于浏览器旧缓存。 */
export function resolveDefaultServerUrl(input: Input) {
  const runtime = normalizeServerUrl(input.runtime)
  // 网关注入的运行时地址优先级最高，确保打包后的 Web 默认走统一入口。
  if (runtime) return runtime
  if (input.dev && input.devHost && input.devPort) {
    return `http://${input.devHost}:${input.devPort}`
  }
  const derived = resolveDerivedLocalDevServerUrl(input)
  if (derived) return derived
  const stored = normalizeServerUrl(input.stored)
  if (stored) return stored
  if (input.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (input.dev) {
    return `http://${input.devHost ?? "localhost"}:${input.devPort ?? "4096"}`
  }
  return input.origin
}
