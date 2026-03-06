import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  const override = new Headers(init?.headers ?? {})
  for (const [key, value] of override.entries()) {
    headers.set(key, value)
  }
  return headers
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const fallbackAuth = (() => {
    if (!server.password) return
    return `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`
  })()

  const delegated = config.fetch ?? globalThis.fetch
  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const send = (auth?: string) => {
      const headers = requestHeaders(input, init)
      if (auth) {
        headers.set("authorization", `Bearer ${auth}`)
      } else if (fallbackAuth && !headers.has("authorization")) {
        headers.set("authorization", fallbackAuth)
      }
      return delegated(input, {
        ...init,
        headers,
      })
    }

    const token = AccountToken.access()
    const response = await send(token)
    if (response.status !== 401) return response
    const replaced = AccountToken.replacedAccess(token)
    if (replaced) return send(replaced)
    if (!token) return response
    const refreshed = await AccountToken.refreshIfNeeded({
      baseUrl: server.url,
      fetcher: delegated,
    })
    const access = refreshed ?? AccountToken.replacedAccess(token)
    if (!access) {
      AccountToken.handleUnauthorized()
      return response
    }
    return send(access)
  }

  return createOpencodeClient({
    ...config,
    fetch: wrappedFetch as typeof fetch,
    headers: { ...config.headers },
    baseUrl: server.url,
  })
}
