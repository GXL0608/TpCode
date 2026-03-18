type Input = {
  runtime?: string
  stored?: string | null
  hostname: string
  origin: string
  dev: boolean
  devHost?: string
  devPort?: string
}

function loop(input: string) {
  return input === "localhost" || input === "127.0.0.1" || input === "::1" || input === "[::1]"
}

export function normalizeServerUrl(input?: string | null) {
  if (!input) return
  const value = input.trim()
  if (!value) return
  return value.replace(/\/+$/, "")
}

export function resolveDefaultServerUrl(input: Input) {
  const runtime = normalizeServerUrl(input.runtime)
  // 网关注入的运行时地址优先级最高，确保打包后的 Web 默认走统一入口。
  if (runtime) return runtime
  const stored = normalizeServerUrl(input.stored)
  if (stored) return stored
  if (input.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (input.dev) {
    const host = input.devHost ?? "localhost"
    const local = loop(host)
    const page = input.hostname
    const target = local && !loop(page) ? page : host
    return `http://${target}:${input.devPort ?? "4096"}`
  }
  return input.origin
}
