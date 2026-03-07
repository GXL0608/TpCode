type ResolveInput = {
  enabled?: boolean
  url?: string
  defaultEnabled: boolean
}

type ResolveOutput = {
  enabled: boolean
  url?: string
}

export function normalizeWebURL(input?: string) {
  if (!input) return
  const value = input.trim()
  if (!value) return
  return value.replace(/\/+$/, "")
}

export function resolveWebGateway(input: ResolveInput): ResolveOutput {
  const enabled = input.enabled ?? input.defaultEnabled
  const url = normalizeWebURL(input.url)
  if (!enabled) {
    return {
      enabled: false,
      url: undefined,
    }
  }
  if (url) {
    return {
      enabled: true,
      url,
    }
  }
  // 打包后如果要求 Web 默认走网关，就必须显式给出统一入口，禁止静默回退到本机地址。
  throw new Error(
    "Gateway web is enabled but webUrl is missing. Set server.gateway.webUrl, TPCODE_GATEWAY_WEB_URL, or --gateway-web-url.",
  )
}

export function webGatewayBootstrap(input: { enabled: boolean; url?: string }) {
  if (!input.enabled || !input.url) return
  // 使用 meta 注入而不是内联脚本，避免被当前 CSP 拦截。
  return `<meta name="opencode-server-url" content=${JSON.stringify(input.url)} />`
}
