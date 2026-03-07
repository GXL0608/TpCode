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

export function resolveDefaultServerUrl(input: Input) {
  const runtime = normalizeServerUrl(input.runtime)
  // 网关注入的运行时地址优先级最高，确保打包后的 Web 默认走统一入口。
  if (runtime) return runtime
  const stored = normalizeServerUrl(input.stored)
  if (stored) return stored
  if (input.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (input.dev) {
    return `http://${input.devHost ?? "localhost"}:${input.devPort ?? "4096"}`
  }
  return input.origin
}
